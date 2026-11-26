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

if (-not ('SesShellLink' -as [type])) {
    Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

public static class SesShellLink
{
    [ComImport]
    [Guid("00021401-0000-0000-C000-000000000046")]
    private class ShellLink
    {
    }

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("000214F9-0000-0000-C000-000000000046")]
    private interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cch, IntPtr pfd, uint fFlags);
        void GetIDList(out IntPtr ppidl);
        void SetIDList(IntPtr pidl);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cch);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cch);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cch);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
        void GetHotkey(out ushort pwHotkey);
        void SetHotkey(ushort wHotkey);
        void GetShowCmd(out int piShowCmd);
        void SetShowCmd(int iShowCmd);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath, int cch, out int piIcon);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, uint dwReserved);
        void Resolve(IntPtr hwnd, uint fFlags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
    }

    public static void Create(
        string shortcutPath,
        string targetPath,
        string arguments,
        string workingDirectory,
        string description,
        string iconPath,
        int showCmd)
    {
        object obj = new ShellLink();
        try
        {
            IShellLinkW link = (IShellLinkW)obj;
            link.SetPath(targetPath);
            link.SetArguments(arguments ?? string.Empty);
            link.SetWorkingDirectory(workingDirectory ?? string.Empty);
            link.SetDescription(description ?? string.Empty);
            link.SetShowCmd(showCmd);
            if (!string.IsNullOrEmpty(iconPath))
            {
                link.SetIconLocation(iconPath, 0);
            }
            ((IPersistFile)obj).Save(shortcutPath, true);
        }
        finally
        {
            Marshal.FinalReleaseComObject(obj);
        }
    }

    public static string ReadWorkingDirectory(string shortcutPath)
    {
        object obj = new ShellLink();
        try
        {
            ((IPersistFile)obj).Load(shortcutPath, 0);
            IShellLinkW link = (IShellLinkW)obj;
            StringBuilder sb = new StringBuilder(4096);
            link.GetWorkingDirectory(sb, sb.Capacity);
            return sb.ToString();
        }
        finally
        {
            Marshal.FinalReleaseComObject(obj);
        }
    }
}
'@
}

function Test-SesShortcutTarget([string]$ShortcutPath) {
    if (!(Test-Path -LiteralPath $ShortcutPath -PathType Leaf)) { return $false }
    try {
        $expectedRoot = Normalize-SesDir $script:SesRoot
        $actualRoot = Normalize-SesDir ([SesShellLink]::ReadWorkingDirectory($ShortcutPath))
        return ($actualRoot -ne '') -and ($actualRoot -eq $expectedRoot)
    }
    catch {
        return $false
    }
}

function New-SesShortcut([string]$ShortcutPath, [string]$Arguments, [string]$Description) {
    $parent = Split-Path -Parent $ShortcutPath
    if ($parent -and !(Test-Path -LiteralPath $parent)) {
        [void][IO.Directory]::CreateDirectory($parent)
    }
    $iconPath = ''
    if (Test-Path -LiteralPath $script:SesIconFile -PathType Leaf) {
        $iconPath = $script:SesIconFile
    }
    [SesShellLink]::Create(
        $ShortcutPath,
        (Get-SesPowerShellPath),
        $Arguments,
        $script:SesRoot,
        $Description,
        $iconPath,
        7
    )
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
