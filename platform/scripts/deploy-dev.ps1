# [HNI-INFRA-01] Waiver W-004. Idempotent dev deploy. Writes no secrets.
# [HNI-INFRA-02] Incremental Bicep deployment. Safe to run again.
# [HNI-NET-03] Rejects 0.0.0.0 and Allow Azure services.
# Requires Azure CLI on PATH and rights in the dev subscription.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $ResourceGroupName,

    [Parameter(Mandatory = $true)]
    [string] $Location,

    [Parameter(Mandatory = $true)]
    [string] $NamePrefix,

    [Parameter(Mandatory = $true)]
    [string] $Application,

    [Parameter(Mandatory = $true)]
    [string] $Owner,

    [Parameter(Mandatory = $true)]
    [string] $CostCenter,

    [Parameter(Mandatory = $true)]
    [string] $GlAccount,

    [Parameter(Mandatory = $true)]
    [string] $Repository,

    [Parameter(Mandatory = $true)]
    [string[]] $AllowedDataPlaneIps,

    [Parameter(Mandatory = $true)]
    [string[]] $AllowedIngressIps,

    [Parameter(Mandatory = $true)]
    [int] $LogRetentionDays,

    [Parameter(Mandatory = $true)]
    [int] $BackupRetentionDays,

    [Parameter(Mandatory = $true)]
    [int] $MonthlyBudgetAmount,

    [Parameter(Mandatory = $true)]
    [string] $BudgetStartDate,

    [Parameter(Mandatory = $true)]
    [string[]] $BudgetAlertEmails,

    [Parameter(Mandatory = $true)]
    [string] $EntraTenantId,

    [Parameter(Mandatory = $true)]
    [string] $EasyAuthClientId,

    [Parameter(Mandatory = $true)]
    [string] $PostgresAdminObjectId,

    [Parameter(Mandatory = $true)]
    [string] $PostgresAdminPrincipalName,

    [Parameter(Mandatory = $true)]
    [ValidateSet('User', 'Group', 'ServicePrincipal')]
    [string] $PostgresAdminPrincipalType,

    [Parameter(Mandatory = $true)]
    [ValidateSet('synthetic-only')]
    [string] $DataClassification
)

$ErrorActionPreference = 'Stop'
$logPath = Join-Path $env:TEMP ('launchpad-deploy-{0:yyyyMMdd-HHmmss}.log' -f (Get-Date))

function Write-Log {
    param([string] $Message)
    $line = '{0:o} {1}' -f (Get-Date), $Message
    Add-Content -Path $logPath -Value $line
    Write-Host $line
}

function ConvertTo-ArmArray {
    param([string[]] $Values)
    $quoted = foreach ($value in $Values) { '"' + $value + '"' }
    return '[' + ($quoted -join ',') + ']'
}

function Test-SingleIpv4 {
    param([string] $Value)
    return $Value -match '^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$' -and $Value -ne '0.0.0.0'
}

try {
    # [HNI-PRIV-08] Dev data is synthetic. The parameter exists so the operator has to say so.
    Write-Log "log=$logPath data=$DataClassification"

    if ($GlAccount -match '^(?i)(changeme|000000|todo|tbd)$' -or $GlAccount.Trim().Length -lt 4) {
        throw 'GLAccount must be the value Finance issued. Do not pass a placeholder.'
    }
    if ($NamePrefix -notmatch '^[a-z0-9]{3,12}$') {
        throw 'NamePrefix must be 3 to 12 lowercase letters or digits.'
    }
    foreach ($ip in @($AllowedDataPlaneIps + $AllowedIngressIps)) {
        if (-not (Test-SingleIpv4 $ip)) {
            throw "IP '$ip' is not a single address. 0.0.0.0 and CIDR ranges are rejected."
        }
    }

    $tagArgs = @(
        "Application=$Application",
        'Environment=dev',
        "Owner=$Owner",
        "CostCenter=$CostCenter",
        "GLAccount=$GlAccount",
        'ManagedBy=bicep',
        "Repository=$Repository"
    )

    $groupExists = (az group exists --name $ResourceGroupName).Trim()
    if ($groupExists -eq 'true') {
        Write-Log "resource group already existed name=$ResourceGroupName"
    }
    else {
        Write-Log "creating resource group name=$ResourceGroupName"
    }
    az group create --name $ResourceGroupName --location $Location --tags @tagArgs --output none
    if ($LASTEXITCODE -ne 0) { throw 'az group create failed' }

    $template = Join-Path $PSScriptRoot '..\main.bicep'
    $paramFile = Join-Path $PSScriptRoot '..\params\dev-public.bicepparam'
    $deploymentName = 'launchpad-dev'

    Write-Log "starting deployment name=$deploymentName"
    az deployment group create `
        --resource-group $ResourceGroupName `
        --name $deploymentName `
        --template-file $template `
        --parameters $paramFile `
        --parameters "location=$Location" `
        --parameters "namePrefix=$NamePrefix" `
        --parameters "application=$Application" `
        --parameters "owner=$Owner" `
        --parameters "costCenter=$CostCenter" `
        --parameters "glAccount=$GlAccount" `
        --parameters "repository=$Repository" `
        --parameters "allowedDataPlaneIps=$(ConvertTo-ArmArray $AllowedDataPlaneIps)" `
        --parameters "allowedIngressIps=$(ConvertTo-ArmArray $AllowedIngressIps)" `
        --parameters "logRetentionDays=$LogRetentionDays" `
        --parameters "backupRetentionDays=$BackupRetentionDays" `
        --parameters "monthlyBudgetAmount=$MonthlyBudgetAmount" `
        --parameters "budgetStartDate=$BudgetStartDate" `
        --parameters "budgetAlertEmails=$(ConvertTo-ArmArray $BudgetAlertEmails)" `
        --parameters "entraTenantId=$EntraTenantId" `
        --parameters "easyAuthClientId=$EasyAuthClientId" `
        --parameters "postgresAdminObjectId=$PostgresAdminObjectId" `
        --parameters "postgresAdminPrincipalName=$PostgresAdminPrincipalName" `
        --parameters "postgresAdminPrincipalType=$PostgresAdminPrincipalType" `
        --output none
    if ($LASTEXITCODE -ne 0) { throw 'az deployment group create failed' }

    $acrName = az deployment group show --resource-group $ResourceGroupName --name $deploymentName --query properties.outputs.acrName.value -o tsv
    Write-Log "registry name=$acrName"
    $mode = az acr show --name $acrName --resource-group $ResourceGroupName --query roleAssignmentMode -o tsv
    if ($mode -ne 'AbacRepositoryPermissions') {
        Write-Log 'enabling Entra repository ABAC on the registry'
        az acr update --name $acrName --resource-group $ResourceGroupName --role-assignment-mode rbac-abac --output none
        if ($LASTEXITCODE -ne 0) { throw 'az acr update role-assignment-mode failed' }
    }
    else {
        Write-Log 'registry ABAC mode already set'
    }

    $resources = az resource list --resource-group $ResourceGroupName --query "[].{type:type,name:name}" -o json
    Write-Log 'resources in group after deploy:'
    Write-Log $resources

    $staticIp = az deployment group show --resource-group $ResourceGroupName --name $deploymentName --query properties.outputs.acaStaticIp.value -o tsv
    Write-Log "container apps static IP=$staticIp"
    Write-Log 'Add that IP to AllowedDataPlaneIps and run this script again before an app pulls an image. Do not enable Allow Azure services.'
    Write-Log "done log=$logPath"
}
catch {
    # [DEBUG] Read the log path above, then: az deployment group show -g <rg> -n launchpad-dev --query properties.error
    # [HNI-CRED-01] Do not rerun with a secret pasted into the command.
    Write-Log ("FAILED " + $_.Exception.Message)
    throw
}
