# [HNI-INFRA-01] Waiver W-004. Idempotent tenant onboarding.
# ⚠️ [HNI-CRED-05] VIOLATION: POC uses a per-tenant client secret instead of a federated credential.
# The secret is printed once. It is not written to the log, git, or a parameter file.
# [HNI-AUTH-01] Adds this app's Easy Auth callback on the shared sign-in registration.
# The tenant pipeline is not granted rights on that registration.
# [HNI-AUTH-08] Does not approve the tenant request. A different person does that before this runs.
# It prints the catalog API call that binds the app and does not write the catalog database.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $Location,

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

    # Shared sign-in registration. This script is the only editor of its redirect URIs.
    [Parameter(Mandatory = $true)]
    [string] $EasyAuthClientId,

    # Must match the identity name container-app.bicep uses: '<container app name>-id'.
    [string] $AppIdentityName = '',

    [Parameter(Mandatory = $true)]
    [string] $PipelineAppDisplayName,

    [Parameter(Mandatory = $true)]
    [string] $Owner,

    [Parameter(Mandatory = $true)]
    [string] $CostCenter,

    [Parameter(Mandatory = $true)]
    [string] $GlAccount,

    [Parameter(Mandatory = $true)]
    [string] $Repository,

    [Parameter(Mandatory = $true)]
    [ValidateSet('synthetic-only')]
    [string] $DataClassification,

    # Only bitbucket is implemented. Any other value stops before Azure changes.
    [string] $CiProvider = 'bitbucket',

    # Bitbucket repository UUID, braces included. Binding key with CiProvider.
    [Parameter(Mandatory = $true)]
    [string] $RepoId,

    # POC client secret lifetime. Default 90 days.
    [ValidateRange(1, 365)]
    [int] $SecretLifetimeDays = 90,

    # Adds a new secret, then removes the previous ones after confirmation.
    [switch] $RotateSecret
)

$ErrorActionPreference = 'Stop'
$logPath = Join-Path $env:TEMP ('launchpad-onboard-{0:yyyyMMdd-HHmmss}.log' -f (Get-Date))

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

function Add-SharedRedirectUri {
    param(
        [string] $ClientId,
        [string] $Uri
    )
    # [HNI-AUTH-01] Web redirect on the shared registration. Do not grant the pipeline principal rights on it.
    # Work or school accounts: 256 redirect URIs per registration. Personal-account audience: 100.
    # The maximum cannot be raised. https://learn.microsoft.com/en-us/entra/identity-platform/reply-url
    if ($Uri.Length -gt 256) {
        throw "Redirect URI exceeds 256 characters, which Entra rejects. uri=$Uri"
    }
    $raw = az ad app show --id $ClientId -o json | Out-String
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) { throw 'az ad app show failed' }
    $app = $raw | ConvertFrom-Json
    $audience = [string]$app.signInAudience
    $limit = 0
    if ($audience -eq 'AzureADMyOrg' -or $audience -eq 'AzureADMultipleOrgs') {
        $limit = 256
    }
    elseif ($audience -eq 'AzureADandPersonalMicrosoftAccount') {
        $limit = 100
    }
    else {
        throw "Unsupported signInAudience '$audience' on the shared sign-in registration."
    }
    $webUris = @()
    if ($null -ne $app.web) {
        $webUris = @($app.web.redirectUris | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    }
    if (@($webUris | Where-Object { [string]$_ -eq $Uri }).Count -gt 0) {
        Write-Log "redirect URI already existed uri=$Uri clientId=$ClientId"
        return
    }
    $registered = New-Object System.Collections.Generic.List[string]
    foreach ($sectionName in @('web', 'spa', 'publicClient')) {
        $node = $app.$sectionName
        if ($null -eq $node) { continue }
        foreach ($existing in @($node.redirectUris)) {
            if ([string]::IsNullOrWhiteSpace([string]$existing)) { continue }
            $registered.Add([string]$existing)
        }
    }
    if ($registered.Count -ge $limit) {
        throw "Shared sign-in registration clientId=$ClientId already has $($registered.Count) redirect URIs. Microsoft allows $limit per registration when signInAudience is $audience (https://learn.microsoft.com/en-us/entra/identity-platform/reply-url). The limit cannot be raised. This script does not add the URI, does not create another registration, and does not grant the tenant pipeline rights on this registration. Retire an unused tenant to remove its callback, then run again."
    }
    $access = 'false'
    $idToken = 'false'
    $home = 'null'
    $logout = 'null'
    if ($null -ne $app.web) {
        $home = Format-JsonStringOrNull $app.web.homePageUrl
        $logout = Format-JsonStringOrNull $app.web.logoutUrl
        if ($null -ne $app.web.implicitGrantSettings) {
            $access = Format-JsonBool $app.web.implicitGrantSettings.enableAccessTokenIssuance
            $idToken = Format-JsonBool $app.web.implicitGrantSettings.enableIdTokenIssuance
        }
    }
    $json = '{"web":{"redirectUris":' + (Format-JsonStringArray (@($webUris) + $Uri)) + ',"homePageUrl":' + $home + ',"logoutUrl":' + $logout + ',"implicitGrantSettings":{"enableAccessTokenIssuance":' + $access + ',"enableIdTokenIssuance":' + $idToken + '}}}'
    $bodyFile = Join-Path $env:TEMP ("launchpad-redirect-{0}.json" -f [guid]::NewGuid())
    $errFile = Join-Path $env:TEMP ("launchpad-redirect-err-{0}.txt" -f [guid]::NewGuid())
    Write-Utf8File -Path $bodyFile -Text $json
    try {
        az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$($app.id)" --body "@$bodyFile" --only-show-errors --output none 2>$errFile
        if ($LASTEXITCODE -ne 0) {
            $detail = ''
            if (Test-Path $errFile) { $detail = Get-Content -Raw -Path $errFile }
            throw "az rest application update failed $detail"
        }
        Write-Log "created redirect URI uri=$Uri clientId=$ClientId"
    }
    finally {
        Remove-Item -Path $bodyFile, $errFile -Force -ErrorAction SilentlyContinue
    }
}

function Get-ClientSecrets {
    param([string] $AppId)
    # hint is a prefix of the secret. Do not request it and do not log it.
    $raw = az ad app credential list --id $AppId --query "[].{keyId:keyId,displayName:displayName,endDateTime:endDateTime}" --only-show-errors -o json | Out-String
    if ($LASTEXITCODE -ne 0) { throw 'az ad app credential list failed' }
    if ([string]::IsNullOrWhiteSpace($raw) -or $raw.Trim() -eq '[]') { return @() }
    return @(($raw | ConvertFrom-Json))
}

function Add-PipelineClientSecret {
    param(
        [string] $ApplicationObjectId,
        [string[]] $PreviousKeyIds
    )
    $PreviousKeyIds = @($PreviousKeyIds | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $end = (Get-Date).ToUniversalTime().AddDays($SecretLifetimeDays).ToString('yyyy-MM-ddTHH:mm:ss') + 'Z'
    $displayName = "ci-$CiProvider"
    $bodyFile = Join-Path $env:TEMP ("launchpad-secret-req-{0}.json" -f [guid]::NewGuid())
    $errFile = Join-Path $env:TEMP ("launchpad-secret-err-{0}.txt" -f [guid]::NewGuid())
    $request = @{
        passwordCredential = @{
            displayName = $displayName
            endDateTime = $end
        }
    }
    Write-Utf8File -Path $bodyFile -Text ($request | ConvertTo-Json -Compress)
    try {
        $raw = az rest --method POST --uri "https://graph.microsoft.com/v1.0/applications/$ApplicationObjectId/addPassword" --body "@$bodyFile" --only-show-errors --output json 2>$errFile | Out-String
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) {
            $detail = ''
            if (Test-Path $errFile) { $detail = Get-Content -Raw -Path $errFile }
            throw "az rest addPassword failed $detail"
        }
        $created = $raw | ConvertFrom-Json
        $secretText = [string]$created.secretText
        $createdKeyId = [string]$created.keyId
        $createdEnd = [string]$created.endDateTime
        $raw = $null
        $created = $null
        if ([string]::IsNullOrWhiteSpace($secretText)) {
            throw 'The new client secret response did not include a secret. Nothing was written to the log.'
        }
        # Printed once, on the console only. Write-Log would copy it into the log file.
        Write-Host $secretText
        Write-Host 'Paste the value above into the CI host secured variable AZURE_CLIENT_SECRET. It is shown only this once and is not written to the log, git, or a parameter file. Set AZURE_CLIENT_ID from the appId in the log.'
        $secretText = $null
        Write-Log "created client secret displayName=$displayName keyId=$createdKeyId end=$createdEnd"
    }
    finally {
        Remove-Item -Path $bodyFile, $errFile -Force -ErrorAction SilentlyContinue
    }

    if ($PreviousKeyIds.Count -eq 0) {
        if ($RotateSecret) { Write-Log 'no previous client secret to remove' }
        return
    }
    $answer = ''
    try {
        $answer = Read-Host 'Type yes to remove the previous client secret. Do this only after the new value is stored in the CI host secured variable AZURE_CLIENT_SECRET'
    }
    catch {
        # [DEBUG] Confirmation could not be read. The previous secret stays so the pipeline can keep using it.
        $answer = ''
    }
    if ([string]::IsNullOrWhiteSpace($answer) -or $answer.Trim().ToLowerInvariant() -ne 'yes') {
        foreach ($oldKeyId in $PreviousKeyIds) {
            Write-Log "previous client secret kept keyId=$oldKeyId"
        }
        return
    }
    foreach ($oldKeyId in $PreviousKeyIds) {
        $removeFile = Join-Path $env:TEMP ("launchpad-secret-del-{0}.json" -f [guid]::NewGuid())
        Write-Utf8File -Path $removeFile -Text (@{ keyId = $oldKeyId } | ConvertTo-Json -Compress)
        az rest --method POST --uri "https://graph.microsoft.com/v1.0/applications/$ApplicationObjectId/removePassword" --body "@$removeFile" --only-show-errors --output none
        $removeExit = $LASTEXITCODE
        Remove-Item -Path $removeFile -Force
        if ($removeExit -ne 0) { throw "az rest removePassword failed keyId=$oldKeyId" }
        Write-Log "removed previous client secret keyId=$oldKeyId"
    }
}

try {
    # [HNI-PRIV-08] Synthetic data acknowledgement. This script has no parameter that accepts a secret.
    if ($CiProvider -ne 'bitbucket') {
        throw "not implemented: CI provider '$CiProvider'. Only the bitbucket client-secret path is implemented."
    }
    $RepoId = $RepoId.Trim().ToLowerInvariant()
    if ($RepoId -notmatch '^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$') {
        throw 'RepoId must be the Bitbucket repository UUID with braces.'
    }
    if ($EasyAuthClientId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
        throw 'EasyAuthClientId must be the shared app registration client id.'
    }
    Write-Log "log=$logPath data=$DataClassification app=$AppName ci=$CiProvider repo=$RepoId"
    if ($AppName -notmatch '^[a-z0-9]+([._-][a-z0-9]+)*$') {
        throw 'AppName must be lowercase and is the repository name under apps/.'
    }
    if ($GlAccount -match '^(?i)(changeme|000000|todo|tbd)$' -or $GlAccount.Trim().Length -lt 4) {
        throw 'GLAccount must be the value Finance issued. Do not pass a placeholder.'
    }

    $repoName = "apps/$AppName"
    if ([string]::IsNullOrWhiteSpace($AppIdentityName)) { $AppIdentityName = "$AppName-id" }
    $tags = [ordered]@{
        Application = 'app-launchpad'
        Environment = 'dev'
        Owner       = $Owner
        CostCenter  = $CostCenter
        GLAccount   = $GlAccount
        ManagedBy   = 'bicep'
        Repository  = $Repository
    }
    $tagArgs = @($tags.GetEnumerator() | ForEach-Object { '{0}={1}' -f $_.Key, $_.Value })

    $subscriptionId = az account show --query id -o tsv
    if ($LASTEXITCODE -ne 0) { throw 'az account show failed' }
    $platformRgId = "/subscriptions/$subscriptionId/resourceGroups/$PlatformResourceGroupName"
    $tenantRgId = "/subscriptions/$subscriptionId/resourceGroups/$TenantResourceGroupName"
    $registryId = "$platformRgId/providers/Microsoft.ContainerRegistry/registries/$AcrName"
    $environmentId = "$platformRgId/providers/Microsoft.App/managedEnvironments/$ContainerEnvironmentName"
    $environmentJoinRoleName = "App Launchpad environment join ($PlatformResourceGroupName)"

    $environmentRaw = az resource show --ids $environmentId --query "{id:id,defaultDomain:properties.defaultDomain}" -o json | Out-String
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($environmentRaw)) {
        throw "Container Apps environment not found: $environmentId"
    }
    $environment = $environmentRaw | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace([string]$environment.id) -or [string]::IsNullOrWhiteSpace([string]$environment.defaultDomain)) {
        throw "Container Apps environment not found: $environmentId"
    }
    if ([string]$environment.defaultDomain -notmatch '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$') {
        throw 'Container Apps environment default domain is not a hostname.'
    }
    # [HNI-AUTH-01] https://<app-name>.<environment default domain>/.auth/login/aad/callback
    $redirectUri = "https://$AppName.$($environment.defaultDomain)/.auth/login/aad/callback"
    Add-SharedRedirectUri -ClientId $EasyAuthClientId -Uri $redirectUri

    $existingAppId = az ad app list --display-name $PipelineAppDisplayName --query "[0].appId" -o tsv
    if ($LASTEXITCODE -ne 0) { throw 'az ad app list failed' }
    if ([string]::IsNullOrWhiteSpace($existingAppId)) {
        $appId = az ad app create --display-name $PipelineAppDisplayName --sign-in-audience AzureADMyOrg --query appId -o tsv
        if ($LASTEXITCODE -ne 0) { throw 'az ad app create failed' }
        Write-Log "created app registration displayName=$PipelineAppDisplayName appId=$appId"
    }
    else {
        $appId = $existingAppId
        Write-Log "app registration already existed displayName=$PipelineAppDisplayName appId=$appId"
    }

    $spId = az ad sp list --filter "appId eq '$appId'" --query "[0].id" -o tsv
    if ($LASTEXITCODE -ne 0) { throw 'az ad sp list failed' }
    if ([string]::IsNullOrWhiteSpace($spId)) {
        $spId = az ad sp create --id $appId --query id -o tsv
        if ($LASTEXITCODE -ne 0) { throw 'az ad sp create failed' }
        Write-Log "created service principal objectId=$spId"
    }
    else {
        Write-Log "service principal already existed objectId=$spId"
    }

    $appObjectId = az ad app show --id $appId --query id -o tsv
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($appObjectId)) { throw 'az ad app show failed' }
    $existingSecrets = @(Get-ClientSecrets -AppId $appId | Where-Object { $_.keyId })
    $previousKeyIds = @($existingSecrets | ForEach-Object { [string]$_.keyId })
    if ($RotateSecret -or $previousKeyIds.Count -eq 0) {
        $keysToReplace = @()
        if ($RotateSecret) { $keysToReplace = $previousKeyIds }
        # ⚠️ [HNI-CRED-05] VIOLATION: create the POC client secret. Do not put secretText in the log or the parameter file.
        Add-PipelineClientSecret -ApplicationObjectId $appObjectId -PreviousKeyIds $keysToReplace
    }
    else {
        foreach ($existingSecret in $existingSecrets) {
            Write-Log "client secret already existed keyId=$($existingSecret.keyId) end=$($existingSecret.endDateTime)"
        }
    }

    # This script owns the tenant resource group. The identity must exist before its
    # registry grant, so the group is created here. tenant-onboarding.bicep does not create it.
    $rgExists = az group exists --name $TenantResourceGroupName
    if ($LASTEXITCODE -ne 0) { throw 'az group exists failed' }
    if ($rgExists -eq 'true') {
        Write-Log "tenant resource group already existed name=$TenantResourceGroupName"
    }
    else {
        az group create --name $TenantResourceGroupName --location $Location --tags @tagArgs --output none
        if ($LASTEXITCODE -ne 0) { throw 'az group create failed' }
        Write-Log "created tenant resource group name=$TenantResourceGroupName"
    }

    # [HNI-CRED-05] Managed identity for runtime image pull. No registry password.
    $appIdentityPrincipalId = az identity list --resource-group $TenantResourceGroupName --query "[?name=='$AppIdentityName'].principalId | [0]" -o tsv
    if ($LASTEXITCODE -ne 0) { throw 'az identity list failed' }
    if ([string]::IsNullOrWhiteSpace($appIdentityPrincipalId)) {
        $appIdentityPrincipalId = az identity create --resource-group $TenantResourceGroupName --name $AppIdentityName --location $Location --tags @tagArgs --query principalId -o tsv
        if ($LASTEXITCODE -ne 0) { throw 'az identity create failed' }
        Write-Log "created app managed identity name=$AppIdentityName principalId=$appIdentityPrincipalId"
    }
    else {
        Write-Log "app managed identity already existed name=$AppIdentityName principalId=$appIdentityPrincipalId"
    }

    $roleBefore = az role definition list --custom-role-only true --name $environmentJoinRoleName --scope $platformRgId --query "[0].id" -o tsv
    if ($LASTEXITCODE -ne 0) { throw 'az role definition list failed' }

    $assignmentsBefore = @()
    foreach ($scope in @($tenantRgId, $registryId, $environmentId)) {
        $ids = az role assignment list --scope $scope --query "[?principalId=='$spId' || principalId=='$appIdentityPrincipalId'].id" -o tsv
        if ($LASTEXITCODE -ne 0) { throw "az role assignment list failed scope=$scope" }
        $assignmentsBefore += @($ids | Where-Object { $_ })
    }

    $paramFile = Join-Path $env:TEMP ("launchpad-onboard-{0}.json" -f [guid]::NewGuid())
    $payload = @{
        '$schema'      = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'
        contentVersion = '1.0.0.0'
        parameters     = @{
            location                  = @{ value = $Location }
            tenantResourceGroupName   = @{ value = $TenantResourceGroupName }
            platformResourceGroupName = @{ value = $PlatformResourceGroupName }
            acrName                   = @{ value = $AcrName }
            pipelinePrincipalId       = @{ value = $spId }
            repositoryName            = @{ value = $repoName }
            appIdentityPrincipalId    = @{ value = $appIdentityPrincipalId }
            containerEnvironmentName  = @{ value = $ContainerEnvironmentName }
            environmentJoinRoleName   = @{ value = $environmentJoinRoleName }
            tags                      = @{ value = $tags }
        }
    }
    Write-Utf8File -Path $paramFile -Text ($payload | ConvertTo-Json -Depth 6)

    $template = Join-Path $PSScriptRoot '..\modules\tenant-onboarding.bicep'
    Write-Log "deploying tenant resource group name=$TenantResourceGroupName repository=$repoName"
    az deployment sub create `
        --location $Location `
        --name "launchpad-onboard-$AppName" `
        --template-file $template `
        --parameters $paramFile `
        --output none
    $deployExit = $LASTEXITCODE
    Remove-Item -Path $paramFile -Force
    if ($deployExit -ne 0) { throw 'az deployment sub create failed' }

    $outputs = az deployment sub show --name "launchpad-onboard-$AppName" --query properties.outputs -o json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'az deployment sub show failed' }

    if ([string]::IsNullOrWhiteSpace($roleBefore)) {
        Write-Log "created custom role name=`"$environmentJoinRoleName`" id=$($outputs.environmentJoinRoleId.value)"
    }
    else {
        Write-Log "custom role already existed name=`"$environmentJoinRoleName`" id=$roleBefore"
    }

    $grants = [ordered]@{
        'Contributor on tenant resource group'          = $outputs.contributorAssignmentId.value
        "Repository Writer on $repoName (pipeline)"     = $outputs.repositoryRoleAssignmentId.value
        "Repository Reader on $repoName (app identity)" = $outputs.repositoryReaderAssignmentId.value
        'Environment join (pipeline)'                   = $outputs.environmentJoinAssignmentId.value
    }
    foreach ($grant in $grants.GetEnumerator()) {
        $state = if ($assignmentsBefore -contains $grant.Value) { 'already existed' } else { 'created' }
        Write-Log "role assignment $state grant=`"$($grant.Key)`" id=$($grant.Value)"
    }

    Write-Log "done appId=$appId principalId=$spId appIdentityPrincipalId=$appIdentityPrincipalId repository=$repoName log=$logPath"
    # [HNI-AUTH-08] Print the call a different person makes. Do not write the catalog database.
    Write-Log "catalog binding app=$AppName ci_provider=$CiProvider repo_id=$RepoId"
    Write-Log 'POST /api/approvals/{approvalId}/decision {"decision":"approved"}'
}
catch {
    # [DEBUG] Read the log path above. Then check: az ad app list --display-name <name>, az ad app credential list --id <appId>, az ad app show --id <easy auth client id>, az identity list -g <tenant rg>, az role definition list --custom-role-only true --scope <platform rg id>, and az deployment sub list --query "[?name=='launchpad-onboard-<app>']"
    # [HNI-CRED-01] Do not copy a client secret into this log to get past a failure.
    Write-Log ("FAILED " + $_.Exception.Message)
    throw
}
