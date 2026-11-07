# [HNI-INFRA-01] Waiver W-004. Idempotent tenant retirement.
# [HNI-AUTH-08] Does not approve the retirement. A different person does that before this runs.
# Removes the app managed identity, that tenant's role assignments, and its Easy Auth redirect URI.
# The pipeline app registration and the tenant resource group are left in place.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $TenantResourceGroupName,

    [Parameter(Mandatory = $true)]
    [string] $PlatformResourceGroupName,

    [Parameter(Mandatory = $true)]
    [string] $AcrName,

    [Parameter(Mandatory = $true)]
    [string] $AppName,

    [Parameter(Mandatory = $true)]
    [string] $ContainerEnvironmentName,

    # Must match the identity name container-app.bicep uses: '<container app name>-id'.
    [string] $AppIdentityName = '',

    [Parameter(Mandatory = $true)]
    [string] $PipelineAppDisplayName,

    # Shared Easy Auth app registration. Redirect URIs for every tenant app live here.
    [Parameter(Mandatory = $true)]
    [string] $EasyAuthClientId
)

$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}
$logPath = Join-Path $env:TEMP ('launchpad-retire-{0:yyyyMMdd-HHmmss}.log' -f (Get-Date))

function Write-Log {
    param([string] $Message)
    $line = '{0:o} {1}' -f (Get-Date), $Message
    Add-Content -Path $logPath -Value $line
    Write-Host $line
}

function Write-Utf8File {
    param([string] $Path, [string] $Text)
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($Path, $Text, $utf8)
}

function Format-JsonStringOrNull($Value) {
    if ($null -eq $Value -or [string]::IsNullOrEmpty([string]$Value)) { return 'null' }
    $text = [string]$Value
    $text = $text.Replace('\', '\\').Replace('"', '\"')
    return '"' + $text + '"'
}

function Format-JsonStringArray($Values) {
    $parts = @()
    foreach ($value in @($Values)) {
        if ([string]::IsNullOrWhiteSpace([string]$value)) { continue }
        $parts += (Format-JsonStringOrNull $value)
    }
    return '[' + ($parts -join ',') + ']'
}

function Format-JsonBool($Value) {
    if ($Value) { return 'true' }
    return 'false'
}

function Remove-RoleAssignments {
    param(
        [string] $PrincipalId,
        [string] $Scope,
        [string] $ScopeName
    )
    if ([string]::IsNullOrWhiteSpace($PrincipalId)) {
        Write-Log "role assignment already absent scope=`"$ScopeName`" principal=unknown"
        return
    }
    $ids = az role assignment list --scope $Scope --query "[?principalId=='$PrincipalId'].id" -o tsv
    if ($LASTEXITCODE -ne 0) { throw "az role assignment list failed scope=$Scope" }
    $assignmentIds = @($ids | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($assignmentIds.Count -eq 0) {
        Write-Log "role assignment already absent scope=`"$ScopeName`" principal=$PrincipalId"
        return
    }
    foreach ($assignmentId in $assignmentIds) {
        az role assignment delete --ids $assignmentId --output none
        if ($LASTEXITCODE -ne 0) { throw "az role assignment delete failed id=$assignmentId" }
        Write-Log "removed role assignment scope=`"$ScopeName`" principal=$PrincipalId id=$assignmentId"
    }
}

function Remove-RedirectUri {
    param(
        [string] $ClientId,
        [string] $Uri
    )
    $raw = az ad app show --id $ClientId -o json | Out-String
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) { throw 'az ad app show failed' }
    $app = $raw | ConvertFrom-Json
    $removed = $false
    foreach ($sectionName in @('web', 'spa', 'publicClient')) {
        $node = $app.$sectionName
        if ($null -eq $node) { continue }
        $uris = @($node.redirectUris | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
        $matched = @($uris | Where-Object { [string]$_ -eq $Uri })
        if ($matched.Count -eq 0) { continue }
        $remaining = @($uris | Where-Object { [string]$_ -ne $Uri })
        $json = ''
        if ($sectionName -eq 'web') {
            $access = 'false'
            $idToken = 'false'
            if ($null -ne $node.implicitGrantSettings) {
                $access = Format-JsonBool $node.implicitGrantSettings.enableAccessTokenIssuance
                $idToken = Format-JsonBool $node.implicitGrantSettings.enableIdTokenIssuance
            }
            $home = Format-JsonStringOrNull $node.homePageUrl
            $logout = Format-JsonStringOrNull $node.logoutUrl
            $json = '{"web":{"redirectUris":' + (Format-JsonStringArray $remaining) + ',"homePageUrl":' + $home + ',"logoutUrl":' + $logout + ',"implicitGrantSettings":{"enableAccessTokenIssuance":' + $access + ',"enableIdTokenIssuance":' + $idToken + '}}}'
        }
        else {
            $json = '{"' + $sectionName + '":{"redirectUris":' + (Format-JsonStringArray $remaining) + '}}'
        }
        $bodyFile = Join-Path $env:TEMP ("launchpad-redirect-{0}.json" -f [guid]::NewGuid())
        Write-Utf8File -Path $bodyFile -Text $json
        az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$($app.id)" --body "@$bodyFile" --output none
        $patchExit = $LASTEXITCODE
        Remove-Item -Path $bodyFile -Force
        if ($patchExit -ne 0) { throw "az rest application update failed section=$sectionName" }
        $removed = $true
    }
    if ($removed) {
        Write-Log "removed redirect URI uri=$Uri clientId=$ClientId"
    }
    else {
        Write-Log "redirect URI already absent uri=$Uri clientId=$ClientId"
    }
}

try {
    Write-Log "log=$logPath app=$AppName"
    if ($AppName -notmatch '^[a-z0-9]+([._-][a-z0-9]+)*$') {
        throw 'AppName must be lowercase and is the repository name under apps/.'
    }
    if ($EasyAuthClientId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
        throw 'EasyAuthClientId must be the shared app registration client id.'
    }
    if ([string]::IsNullOrWhiteSpace($AppIdentityName)) { $AppIdentityName = "$AppName-id" }

    $subscriptionId = az account show --query id -o tsv
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($subscriptionId)) { throw 'az account show failed' }
    $platformRgId = "/subscriptions/$subscriptionId/resourceGroups/$PlatformResourceGroupName"
    $tenantRgId = "/subscriptions/$subscriptionId/resourceGroups/$TenantResourceGroupName"
    $registryId = "$platformRgId/providers/Microsoft.ContainerRegistry/registries/$AcrName"
    $environmentId = "$platformRgId/providers/Microsoft.App/managedEnvironments/$ContainerEnvironmentName"

    $appId = az ad app list --display-name $PipelineAppDisplayName --query "[0].appId" -o tsv
    if ($LASTEXITCODE -ne 0) { throw 'az ad app list failed' }
    $spId = ''
    if ([string]::IsNullOrWhiteSpace($appId)) {
        Write-Log "app registration already absent displayName=$PipelineAppDisplayName"
    }
    else {
        Write-Log "app registration reused displayName=$PipelineAppDisplayName appId=$appId"
        $spId = az ad sp list --filter "appId eq '$appId'" --query "[0].id" -o tsv
        if ($LASTEXITCODE -ne 0) { throw 'az ad sp list failed' }
        if ([string]::IsNullOrWhiteSpace($spId)) {
            Write-Log "service principal already absent appId=$appId"
        }
        else {
            Write-Log "service principal reused objectId=$spId"
        }
    }

    $appIdentityPrincipalId = ''
    $identityErr = Join-Path $env:TEMP ("launchpad-retire-id-{0}.txt" -f [guid]::NewGuid())
    $shownPrincipal = az identity show --resource-group $TenantResourceGroupName --name $AppIdentityName --query principalId -o tsv 2>$identityErr
    $identityExit = $LASTEXITCODE
    if ($identityExit -eq 0 -and -not [string]::IsNullOrWhiteSpace($shownPrincipal)) {
        $appIdentityPrincipalId = [string]$shownPrincipal
    }
    else {
        $detail = ''
        if (Test-Path $identityErr) { $detail = Get-Content -Raw -Path $identityErr }
        Remove-Item -Path $identityErr -Force -ErrorAction SilentlyContinue
        if ($detail -match 'NotFound|could not be found|was not found|does not exist') {
            Write-Log "app managed identity already absent name=$AppIdentityName"
        }
        else {
            throw "az identity show failed $detail"
        }
    }
    Remove-Item -Path $identityErr -Force -ErrorAction SilentlyContinue

    $scopes = @(
        @{ Name = 'tenant resource group'; Id = $tenantRgId },
        @{ Name = 'registry'; Id = $registryId },
        @{ Name = 'environment'; Id = $environmentId }
    )
    foreach ($scope in $scopes) {
        if (-not [string]::IsNullOrWhiteSpace($spId)) {
            Remove-RoleAssignments -PrincipalId $spId -Scope $scope.Id -ScopeName $scope.Name
        }
        if (-not [string]::IsNullOrWhiteSpace($appIdentityPrincipalId)) {
            Remove-RoleAssignments -PrincipalId $appIdentityPrincipalId -Scope $scope.Id -ScopeName $scope.Name
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($appIdentityPrincipalId)) {
        az identity delete --resource-group $TenantResourceGroupName --name $AppIdentityName --output none
        if ($LASTEXITCODE -ne 0) { throw 'az identity delete failed' }
        Write-Log "removed app managed identity name=$AppIdentityName principalId=$appIdentityPrincipalId"
    }

    $appErr = Join-Path $env:TEMP ("launchpad-retire-app-{0}.txt" -f [guid]::NewGuid())
    $fqdn = az containerapp show --name $AppName --resource-group $TenantResourceGroupName --query properties.configuration.ingress.fqdn -o tsv 2>$appErr
    $appExit = $LASTEXITCODE
    if ($appExit -ne 0 -or [string]::IsNullOrWhiteSpace($fqdn)) {
        $detail = ''
        if (Test-Path $appErr) { $detail = Get-Content -Raw -Path $appErr }
        Remove-Item -Path $appErr -Force -ErrorAction SilentlyContinue
        if ($appExit -eq 0 -or $detail -match 'NotFound|could not be found|was not found|does not exist') {
            Write-Log "redirect URI already absent name=$AppName"
        }
        else {
            throw "az containerapp show failed $detail"
        }
    }
    else {
        Remove-Item -Path $appErr -Force -ErrorAction SilentlyContinue
        # [HNI-AUTH-01] Easy Auth callback on the shared registration, not on the pipeline app.
        $redirectUri = "https://$fqdn/.auth/login/aad/callback"
        Remove-RedirectUri -ClientId $EasyAuthClientId -Uri $redirectUri
    }

    Write-Log "done app=$AppName log=$logPath"
}
catch {
    # [DEBUG] Read the log path above. Then check: az identity show -g <tenant rg> -n <app>-id, az role assignment list --scope <scope>, az ad app show --id <easy auth client id>, az containerapp show -g <tenant rg> -n <app>.
    Write-Log ("FAILED " + $_.Exception.Message)
    throw
}
