# Windows PowerShell 5.1+ desktop integration for SES (shortcuts and Startup auto-start).
param(
    [Parameter(Position = 0)][ValidateSet('status', 'create-shortcuts', 'ensure-first-shortcuts', 'set-autostart')][string]$Action = 'status',
    [Parameter(Position = 1)][string]$Enabled = ''
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

$script:SesRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).ProviderPath
$script:SesRun = Join-Path $script:SesRoot '.ses-run'
$script:SesLauncherScript = Join-Path $script:SesRoot 'scripts\ses-windows.ps1'
$script:SesIconFile = Join-Path $script:SesRoot 'scripts\ses.ico'
$script:MarkerFile = Join-Path $script:SesRun 'shortcuts-initialized.json'

function Get-SesFolder([string]$EnvName, [System.Environment+SpecialFolder]$SpecialFolder) {
    $override = [Environment]::GetEnvironmentVariable($EnvName)
    if ($override -and $override.Trim()) { return $override.Trim() }
    return [Environment]::GetFolderPath($SpecialFolder)
}

function Get-SesDesktopShortcutPath {
    return Join-Path (Get-SesFolder 'SES_DESKTOP_DIR' ([Environment+SpecialFolder]::Desktop)) 'SES.lnk'
}

function Get-SesStartMenuShortcutPath {
    return Join-Path (Get-SesFolder 'SES_START_MENU_DIR' ([Environment+SpecialFolder]::Programs)) 'SES.lnk'
}

function Get-SesStartupShortcutPath {
    return Join-Path (Get-SesFolder 'SES_STARTUP_DIR' ([Environment+SpecialFolder]::Startup)) 'SES.lnk'
}

function Get-SesPowerShellPath {
    return Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
}

function Normalize-SesDir([string]$PathValue) {
    if (-not $PathValue) { return '' }
    return $PathValue.Trim().TrimEnd('\', '/').ToLowerInvariant()
}

function Write-SesUtf8NoBom([string]$FilePath, [string]$Content) {
    $parent = Split-Path -Parent $FilePath
    if ($parent -and !(Test-Path -LiteralPath $parent)) {
        [void][IO.Directory]::CreateDirectory($parent)
    }
    [IO.File]::WriteAllText($FilePath, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

function Test-SesShortcutTarget([string]$ShortcutPath) {
    if (!(Test-Path -LiteralPath $ShortcutPath -PathType Leaf)) { return $false }
    $shell = $null
    $shortcut = $null
    try {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($ShortcutPath)
        $expectedRoot = Normalize-SesDir $script:SesRoot
        $actualRoot = Normalize-SesDir ([string]$shortcut.WorkingDirectory)
        return ($actualRoot -ne '') -and ($actualRoot -eq $expectedRoot)
    }
    catch {
        return $false
    }
    finally {
        if ($shortcut) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut) } catch { } }
        if ($shell) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell) } catch { } }
    }
}

function New-SesShortcut([string]$ShortcutPath, [string]$Arguments, [string]$Description) {
    $parent = Split-Path -Parent $ShortcutPath
    if ($parent -and !(Test-Path -LiteralPath $parent)) {
        [void][IO.Directory]::CreateDirectory($parent)
    }
    $shell = $null
    $shortcut = $null
    try {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($ShortcutPath)
        $shortcut.TargetPath = Get-SesPowerShellPath
        $shortcut.Arguments = $Arguments
        $shortcut.WorkingDirectory = $script:SesRoot
        $shortcut.WindowStyle = 7
        $shortcut.Description = $Description
        if (Test-Path -LiteralPath $script:SesIconFile -PathType Leaf) {
            $shortcut.IconLocation = "$($script:SesIconFile),0"
        }
        $shortcut.Save()
    }
    finally {
        if ($shortcut) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut) } catch { } }
        if ($shell) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell) } catch { } }
    }
}

function Get-SesDesktopStatus {
    $desktopPath = Get-SesDesktopShortcutPath
    $startMenuPath = Get-SesStartMenuShortcutPath
    $startupPath = Get-SesStartupShortcutPath
    return [ordered]@{
        desktopShortcut = (Test-SesShortcutTarget $desktopPath)
        startMenuShortcut = (Test-SesShortcutTarget $startMenuPath)
        autoStart = (Test-SesShortcutTarget $startupPath)
    }
}

function Invoke-SesCreateShortcuts {
    $desktopPath = Get-SesDesktopShortcutPath
    $startMenuPath = Get-SesStartMenuShortcutPath
    $shortcutArgs = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $script:SesLauncherScript + '" start -GuiError'
    $description = "SES $([char]0x6807)$([char]0x51C6)$([char]0x5316)$([char]0x6587)$([char]0x4EF6)$([char]0x7F16)$([char]0x8F91)$([char]0x7CFB)$([char]0x7EDF)"
    New-SesShortcut $desktopPath $shortcutArgs $description
    New-SesShortcut $startMenuPath $shortcutArgs $description

    $markerJson = ([ordered]@{
        initializedAt = ([datetime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.000Z'))
        root = $script:SesRoot
        desktopPath = $desktopPath
        startMenuPath = $startMenuPath
    } | ConvertTo-Json -Compress)
    Write-SesUtf8NoBom $script:MarkerFile $markerJson

    return ([ordered]@{
        desktopShortcut = $true
        startMenuShortcut = $true
        desktopPath = $desktopPath
        startMenuPath = $startMenuPath
    } | ConvertTo-Json -Compress)
}

function Invoke-SesEnsureFirstShortcuts {
    if ($env:SES_NO_SHORTCUT -eq '1' -or (Test-Path -LiteralPath $script:MarkerFile -PathType Leaf)) {
        return
    }
    try {
        [void](Invoke-SesCreateShortcuts)
    }
    catch {
        Write-Host "Warning: failed to create desktop shortcuts: $($_.Exception.Message)"
    }
}

function Invoke-SesSetAutoStart([string]$RawEnabled) {
    $normalized = if ($RawEnabled) { $RawEnabled.Trim().ToLowerInvariant() } else { '' }
    if ($normalized -ne 'true' -and $normalized -ne 'false') {
        throw 'Enabled must be true or false.'
    }
    $enable = ($normalized -eq 'true')
    $startupPath = Get-SesStartupShortcutPath
    if ($enable) {
        $shortcutArgs = '-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $script:SesLauncherScript + '" start -NoOpen'
        $description = "SES $([char]0x6807)$([char]0x51C6)$([char]0x5316)$([char]0x6587)$([char]0x4EF6)$([char]0x7F16)$([char]0x8F91)$([char]0x7CFB)$([char]0x7EDF)$([char]0xFF08)$([char]0x5F00)$([char]0x673A)$([char]0x540E)$([char]0x53F0)$([char]0x542F)$([char]0x52A8)$([char]0xFF09)"
        New-SesShortcut $startupPath $shortcutArgs $description
    }
    else {
        if (Test-Path -LiteralPath $startupPath -PathType Leaf) {
            Remove-Item -LiteralPath $startupPath -Force
        }
    }
    $actual = Test-SesShortcutTarget $startupPath
    return ([ordered]@{ autoStart = $actual } | ConvertTo-Json -Compress)
}

if ($MyInvocation.InvocationName -ne '.') {
    switch ($Action) {
        'status' {
            Write-Output ((Get-SesDesktopStatus) | ConvertTo-Json -Compress)
        }
        'create-shortcuts' {
            Write-Output (Invoke-SesCreateShortcuts)
        }
        'ensure-first-shortcuts' {
            Invoke-SesEnsureFirstShortcuts
        }
        'set-autostart' {
            Write-Output (Invoke-SesSetAutoStart $Enabled)
        }
    }
}
