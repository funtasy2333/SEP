# Windows PowerShell 5.1 upgrade executor (thin shell). The SES server copies it to .ses-update\
# and runs it detached:
#   powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File <root>\.ses-update\ses-upgrade.ps1 -Root <root>
# Flow: stop -> back up database -> extract -> apply files -> start the new version.
# Any failure rolls files back, restores the database and restarts the previous version.
# All file logic lives in apply-update.cjs; the result is written to .ses-run\upgrade-status.json.
param([Parameter(Mandatory = $true)][string]$Root)
$ErrorActionPreference = 'Stop'
$script:Root = (Resolve-Path -LiteralPath $Root).ProviderPath
$script:Upd = Join-Path $script:Root '.ses-update'
$script:Run = Join-Path $script:Root '.ses-run'
$script:PlanFile = Join-Path $script:Upd 'plan.json'
$script:Apply = Join-Path $script:Upd 'apply-update.cjs'
$script:Node = $null
$script:Applier = $null
# apply-update.cjs prints UTF-8 (Chinese) text; keep upgrade.log readable when the console is redirected.
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false) } catch { }
$script:BackedUp = $false
$script:Applied = $false
$script:StartedNew = $false

function Write-SesLog([string]$Message) {
    Write-Host ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
}

function Invoke-SesApply([string[]]$Arguments) {
    & $script:Node $script:Apply @Arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "apply-update.cjs $($Arguments[0]) exited with code $LASTEXITCODE" }
}

# apply / rollback prefer the apply-update.cjs shipped inside the upgrade package (the installed copy may
# know an outdated file list). status, backup-db, restore-db, finalize and plan-get keep using the installed
# copy. The sub-commands are a cross-version contract (see the header of apply-update.cjs).
function Invoke-SesApplier([string[]]$Arguments) {
    $applier = if ($script:Applier) { $script:Applier } else { $script:Apply }
    & $script:Node $applier @Arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "apply-update.cjs $($Arguments[0]) exited with code $LASTEXITCODE" }
}

function Select-SesApplier([string]$Staging) {
    $script:Applier = $null
    $next = Join-Path $script:Upd 'apply-update.next.cjs'
    Remove-Item -LiteralPath $next -Force -ErrorAction SilentlyContinue
    $tops = @(Get-ChildItem -LiteralPath $Staging -Directory | Where-Object { $_.Name -ne '__MACOSX' })
    $candidate = if ($tops.Count -eq 1) { Join-Path $tops[0].FullName 'scripts\apply-update.cjs' } else { $null }
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
        try {
            Copy-Item -LiteralPath $candidate -Destination $next -Force
            & $script:Node --check $next | Out-Host
            if ($LASTEXITCODE -ne 0) { throw 'syntax check failed' }
            $script:Applier = $next
            Write-SesLog 'Using the apply-update.cjs from the upgrade package.'
            return
        }
        catch {
            Write-SesLog 'The apply-update.cjs in the upgrade package is unusable; using the installed copy.'
            Remove-Item -LiteralPath $next -Force -ErrorAction SilentlyContinue
        }
    }
    else { Write-SesLog 'The upgrade package has no apply-update.cjs; using the installed copy.' }
}

function Set-SesStatus([string]$State, [string]$Step, [string]$Message) {
    try {
        $arguments = @('status', '--root', $script:Root, '--state', $State, '--step', $Step, '--plan', $script:PlanFile)
        if ($Message) { $arguments += @('--message', $Message) }
        Invoke-SesApply $arguments
    }
    catch {
        # Minimal hand-written status when Node itself is unusable.
        $clean = ($Message -replace '["\\\r\n]', ' ')
        $json = '{{"state":"{0}","step":"{1}","from":null,"to":null,"message":"{2}","log":".ses-run/upgrade.log","updatedAt":"{3}"}}' -f $State, $Step, $clean, ([datetime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.000Z'))
        [void][IO.Directory]::CreateDirectory($script:Run)
        [IO.File]::WriteAllText((Join-Path $script:Run 'upgrade-status.json'), $json, (New-Object Text.UTF8Encoding($false)))
    }
}

function Invoke-SesChild([string]$OverrideVariable, [string]$ScriptName, [string]$Action) {
    $override = [Environment]::GetEnvironmentVariable($OverrideVariable)
    if ($override) {
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command $override | Out-Host
    }
    else {
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $script:Root "scripts\$ScriptName") $Action | Out-Host
    }
    if ($LASTEXITCODE -ne 0) { throw "$Action exited with code $LASTEXITCODE" }
}

function Stop-SesForUpgrade { Invoke-SesChild 'SES_UPGRADE_STOP_CMD' 'ses-windows.ps1' 'stop' }

function Start-SesAfterUpgrade {
    $savedOpen = $env:SES_NO_OPEN
    $savedPause = $env:SES_NO_PAUSE
    $env:SES_NO_OPEN = '1'
    $env:SES_NO_PAUSE = '1'
    try { Invoke-SesChild 'SES_UPGRADE_START_CMD' 'ses-windows.ps1' 'start' }
    finally { $env:SES_NO_OPEN = $savedOpen; $env:SES_NO_PAUSE = $savedPause }
}

# Failure recovery: roll files back -> stop leftovers -> restore database -> start the previous version.
function Invoke-SesRecovery([string]$Reason) {
    $recovered = $true
    $stopped = $true
    Write-SesLog "Upgrade failed: $Reason"
    Write-SesLog 'Restoring the previous version...'
    Set-SesStatus 'running' 'rolling-back' $Reason
    if ($script:Applied) {
        try { Invoke-SesApplier @('rollback', '--root', $script:Root) }
        catch { $recovered = $false; Write-SesLog "Rollback of program files failed: $($_.Exception.Message)" }
    }
    try { Stop-SesForUpgrade }
    catch { $stopped = $false; Write-SesLog "Stopping services failed; the database will not be overwritten: $($_.Exception.Message)" }
    if ($script:BackedUp) {
        if ($stopped) {
            try { Invoke-SesApply @('restore-db', '--root', $script:Root) }
            catch { $recovered = $false; Write-SesLog "Database restore failed; backup kept in $script:Upd\db-backup: $($_.Exception.Message)" }
        }
        elseif ($script:StartedNew) { $recovered = $false }
    }
    if ($recovered) {
        try {
            Write-SesLog 'Starting the previous version...'
            Start-SesAfterUpgrade
            Set-SesStatus 'rolled-back' 'done' "Upgrade failed and the previous version was restored: $Reason"
            Write-SesLog 'Previous version restored.'
            try { Invoke-SesApply @('finalize', '--root', $script:Root, '--plan', $script:PlanFile) } catch { }
            return
        }
        catch {
            Set-SesStatus 'failed' 'rolling-back' "Upgrade failed ($Reason) and the previous version could not be restarted: $($_.Exception.Message). Run the start script manually."
            Write-SesLog "Previous version failed to start: $($_.Exception.Message)"
            return
        }
    }
    Set-SesStatus 'failed' 'rolling-back' "Upgrade failed ($Reason) and recovery was incomplete. Check the .ses-update folder and run the start script manually."
    Write-SesLog 'Recovery incomplete; manual action required.'
}

$script:ExitCode = 1
try {
    [void][IO.Directory]::CreateDirectory($script:Run)
    Write-SesLog "SES upgrade started (root: $script:Root)"
    if (!(Test-Path -LiteralPath $script:PlanFile) -or !(Test-Path -LiteralPath $script:Apply)) {
        Set-SesStatus 'failed' 'stopping' 'Upgrade files are incomplete (plan.json or apply-update.cjs is missing).'
        throw 'plan.json or apply-update.cjs is missing.'
    }
    $plan = Get-Content -LiteralPath $script:PlanFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $script:Node = $plan.node
    if (!$script:Node -or !(Test-Path -LiteralPath $script:Node)) {
        $found = Get-Command node.exe -ErrorAction SilentlyContinue
        $script:Node = if ($found) { $found.Source } else { $null }
    }
    if (!$script:Node) {
        Set-SesStatus 'failed' 'stopping' 'Node.js was not found; cannot run the upgrade.'
        throw 'Node.js was not found.'
    }
    $zip = if ($plan.zip) { [string]$plan.zip } else { Join-Path $script:Upd 'download.zip' }
    $staging = Join-Path $script:Upd 'staging'
    $env:SES_UPGRADE_ROOT = $script:Root
    $failure = $null
    try {
        Set-SesStatus 'running' 'stopping' ''
        Write-SesLog '[1/5] Stopping SES...'
        Stop-SesForUpgrade

        Set-SesStatus 'running' 'backing-up' ''
        Write-SesLog '[2/5] Backing up the database...'
        Invoke-SesApply @('backup-db', '--root', $script:Root)
        $script:BackedUp = $true

        Set-SesStatus 'running' 'extracting' ''
        Write-SesLog "[3/5] Extracting $zip"
        if (!(Test-Path -LiteralPath $zip)) { throw "Upgrade package not found: $zip" }
        Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
        # .NET extraction: the Expand-Archive cmdlet treats [ ] in the destination as wildcards. The destination must not exist.
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $staging)

        Set-SesStatus 'running' 'applying' ''
        Write-SesLog '[4/5] Replacing program files...'
        Select-SesApplier $staging
        $script:Applied = $true
        Invoke-SesApplier @('apply', '--root', $script:Root, '--staging', $staging, '--plan', $script:PlanFile)

        Set-SesStatus 'running' 'starting' ''
        Write-SesLog '[5/5] Starting the new version...'
        $script:StartedNew = $true
        Start-SesAfterUpgrade
    }
    catch { $failure = $_.Exception.Message }
    if ($failure) {
        Invoke-SesRecovery $failure
    }
    else {
        try { Invoke-SesApply @('finalize', '--root', $script:Root, '--plan', $script:PlanFile) }
        catch { Write-SesLog 'Cleanup failed (the upgrade itself succeeded).' }
        Set-SesStatus 'succeeded' 'done' ''
        Write-SesLog 'Upgrade completed.'
        $script:ExitCode = 0
    }
}
catch { Write-SesLog "SES upgrade error: $($_.Exception.Message)" }
finally {
    Remove-Item -LiteralPath (Join-Path $script:Upd 'apply-update.next.cjs') -Force -ErrorAction SilentlyContinue
    # Always release the lock created by the server.
    Remove-Item -LiteralPath (Join-Path $script:Upd 'lock') -Recurse -Force -ErrorAction SilentlyContinue
}
exit $script:ExitCode
