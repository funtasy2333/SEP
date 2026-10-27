# Windows PowerShell 5.1+. Runtime downloads and registry settings are local to SES.
param([ValidateSet('start', 'stop')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$script:SesRoot = Split-Path -Parent $PSScriptRoot
$script:SesRun = Join-Path $script:SesRoot '.ses-run'
$script:SesTools = Join-Path $script:SesRoot '.ses-tools'
$script:OfficialRegistry = 'https://registry.npmjs.org'
$script:MirrorRegistry = 'https://registry.npmmirror.com'

function Test-SesVersion([string]$Actual, [string]$Minimum) {
    if ($Actual -notmatch '^v?(\d+\.\d+\.\d+)$') { return $false }
    return [version]$Matches[1] -ge [version]$Minimum
}

function Test-SesNodeVersion([string]$Actual) {
    if ($Actual -notmatch '^v?(\d+)\.(\d+)\.(\d+)$') { return $false }
    $major = [int]$Matches[1]
    if ($major -eq 20) { return Test-SesVersion $Actual '20.19.0' }
    if ($major -eq 22) { return Test-SesVersion $Actual '22.12.0' }
    return $major -ge 23 -and $major -le 25
}

function Invoke-SesWithFallback([scriptblock]$PrimaryOperation, [scriptblock]$MirrorOperation) {
    try { & $PrimaryOperation }
    catch {
        Write-Host "Official source failed: $($_.Exception.Message)"
        Write-Host 'Retrying with the mainland China mirror...'
        & $MirrorOperation
    }
}

function Invoke-SesDownload([string]$Official, [string]$Mirror, [string]$Target) {
    $partial = "$Target.partial"
    $download = {
        param($Uri)
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $partial -TimeoutSec 30 | Out-Null
            Move-Item -LiteralPath $partial -Destination $Target -Force
        }
        finally { Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue }
    }
    Invoke-SesWithFallback { & $download $Official } { & $download $Mirror }
}

function Assert-SesHash([string]$File, [string]$Expected) {
    if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ne $Expected) {
        throw "SHA256 mismatch: $File. Download aborted."
    }
}

function Invoke-SesCommand([string]$File, [string[]]$Arguments) {
    & $File @Arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "$File exited with code $LASTEXITCODE" }
}

function Initialize-SesRuntime {
    New-Item -ItemType Directory -Force -Path $script:SesTools | Out-Null
    $localNode = Join-Path $script:SesTools 'node/node.exe'
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $script:SesNode = $null
    if (Test-Path -LiteralPath $localNode) {
        if (Test-SesNodeVersion (& $localNode --version)) { $script:SesNode = $localNode }
    }
    if (!$script:SesNode -and $nodeCommand) {
        if (Test-SesNodeVersion (& $nodeCommand.Source --version)) { $script:SesNode = $nodeCommand.Source }
    }
    if (!$script:SesNode) {
        $arch = [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITEW6432')
        if (!$arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
        switch ($arch) {
            'ARM64' { $nodeArch = 'arm64' }
            'AMD64' { $nodeArch = 'x64' }
            default { throw 'SES requires 64-bit Windows (x64 or ARM64).' }
        }
        $version = '22.22.0'
        $name = "node-v$version-win-$nodeArch"
        $archive = Join-Path $script:SesTools "$name.zip"
        $checksums = Join-Path $script:SesTools 'SHASUMS256.txt'
        Write-Host "Installing portable Node.js $version locally..."
        Invoke-SesDownload "https://nodejs.org/dist/v$version/SHASUMS256.txt" "https://npmmirror.com/mirrors/node/v$version/SHASUMS256.txt" $checksums
        $entry = @(Get-Content -LiteralPath $checksums | Where-Object { $_ -match "^[a-fA-F0-9]{64}\s+$([regex]::Escape($name)).zip$" })
        if ($entry.Count -ne 1) { throw 'Node.js SHA256 entry is missing.' }
        Invoke-SesDownload "https://nodejs.org/dist/v$version/$name.zip" "https://npmmirror.com/mirrors/node/v$version/$name.zip" $archive
        Assert-SesHash $archive ($entry[0] -split '\s+')[0]
        $extract = Join-Path $script:SesTools 'node-extract'
        Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
        Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force
        if (Test-Path -LiteralPath (Join-Path $script:SesTools 'node')) { Remove-Item -LiteralPath (Join-Path $script:SesTools 'node') -Recurse -Force }
        Move-Item -LiteralPath (Join-Path $extract $name) -Destination (Join-Path $script:SesTools 'node')
        Remove-Item -LiteralPath $archive, $extract -Recurse -Force
        $script:SesNode = $localNode
    }
    $env:PATH = "$(Split-Path $script:SesNode);$env:PATH"
    # Use a pinned local pnpm; never change a user's global npm registry or pnpm.
    $script:SesPnpm = Join-Path $script:SesTools 'pnpm/node_modules/pnpm/bin/pnpm.cjs'
    if (!(Test-Path -LiteralPath $script:SesPnpm)) {
        $npm = Join-Path (Split-Path $script:SesNode) 'node_modules/npm/bin/npm-cli.js'
        if (!(Test-Path -LiteralPath $npm)) { throw 'npm is missing; install a complete Node.js distribution and retry.' }
        $prefix = Join-Path $script:SesTools 'pnpm'
        $common = @($npm, 'install', '--prefix', $prefix, '--no-audit', '--no-fund', '--fetch-retries=0', '--fetch-timeout=30000', 'pnpm@10.33.0')
        Invoke-SesWithFallback {
            Invoke-SesCommand $script:SesNode ($common + @('--registry', $script:OfficialRegistry))
        } {
            Invoke-SesCommand $script:SesNode ($common + @('--registry', $script:MirrorRegistry))
        }
    }
}

function Get-SesDependencyKey([string]$LockHash) {
    $abi = & $script:SesNode -p process.versions.modules
    $arch = & $script:SesNode -p process.arch
    return "$LockHash|$abi|$arch"
}

function Confirm-SesSqlite {
    $probe = Join-Path $script:SesRoot 'scripts/check-sqlite.cjs'
    try { Invoke-SesCommand $script:SesNode @($probe) }
    catch {
        # pnpm may consider a previously failed lifecycle build installed on retry.
        Invoke-SesCommand $script:SesNode @($script:SesPnpm, '--filter', '@ses/server', 'rebuild', 'better-sqlite3')
        Invoke-SesCommand $script:SesNode @($probe)
    }
}

function Install-SesDependencies {
    $lockHash = (Get-FileHash -LiteralPath (Join-Path $script:SesRoot 'pnpm-lock.yaml') -Algorithm SHA256).Hash
    $dependencyKey = Get-SesDependencyKey $lockHash
    $marker = Join-Path $script:SesRun 'dependencies.sha256'
    $modules = Join-Path $script:SesRoot 'packages/server/node_modules/better-sqlite3/package.json'
    if ((Test-Path -LiteralPath $marker) -and (Test-Path -LiteralPath $modules) -and ((Get-Content -LiteralPath $marker -Raw).Trim() -eq $dependencyKey)) {
        try { Invoke-SesCommand $script:SesNode @((Join-Path $script:SesRoot 'scripts/check-sqlite.cjs')); return }
        catch { Write-Host 'SQLite runtime needs repair; reinstalling dependencies...' }
    }
    Write-Host 'Installing SES dependencies from the official registry...'
    # Browser downloads get their own retry below; a browser CDN outage must not mask npm health.
    $savedSkip = $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD
    $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
    try {
        $common = @($script:SesPnpm, 'install', '--frozen-lockfile', '--fetch-retries=0', '--fetch-timeout=30000')
        Invoke-SesWithFallback {
            Invoke-SesCommand $script:SesNode ($common + @('--registry', $script:OfficialRegistry))
            Confirm-SesSqlite
        } {
            $savedNodeMirror = $env:npm_config_disturl
            $savedSqliteMirror = $env:npm_config_better_sqlite3_binary_host_mirror
            $env:npm_config_disturl = 'https://npmmirror.com/mirrors/node'
            $env:npm_config_better_sqlite3_binary_host_mirror = 'https://npmmirror.com/mirrors/better-sqlite3'
            try {
                Invoke-SesCommand $script:SesNode ($common + @('--registry', $script:MirrorRegistry))
                Confirm-SesSqlite
            }
            finally {
                $env:npm_config_disturl = $savedNodeMirror
                $env:npm_config_better_sqlite3_binary_host_mirror = $savedSqliteMirror
            }
        }
    }
    finally { $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = $savedSkip }
    $browserCli = Join-Path $script:SesRoot 'packages/server/node_modules/playwright-chromium/cli.js'
    $savedHost = $env:PLAYWRIGHT_DOWNLOAD_HOST
    $savedChromiumHost = $env:PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST
    try {
        $env:PLAYWRIGHT_DOWNLOAD_HOST = $null
        $env:PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST = $null
        Invoke-SesWithFallback {
            Invoke-SesCommand $script:SesNode @($browserCli, 'install', 'chromium')
        } {
            $env:PLAYWRIGHT_DOWNLOAD_HOST = 'https://npmmirror.com/mirrors/playwright'
            Invoke-SesCommand $script:SesNode @($browserCli, 'install', 'chromium')
        }
    }
    finally {
        $env:PLAYWRIGHT_DOWNLOAD_HOST = $savedHost
        $env:PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST = $savedChromiumHost
    }
    Set-Content -LiteralPath $marker -Value $dependencyKey -Encoding ASCII
}

function Get-SesState([string]$Role) {
    $file = Join-Path $script:SesRun "$Role.json"
    if (Test-Path -LiteralPath $file) { return Get-Content -LiteralPath $file -Raw | ConvertFrom-Json }
    return $null
}

function Test-SesOwned($State) {
    if (!$State) { return $false }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$State.pid)" -ErrorAction SilentlyContinue
    if (!$process) { return $false }
    return ($process.CreationDate.ToUniversalTime().Ticks.ToString() -eq $State.created) -and
        ($process.ExecutablePath -eq $State.executable) -and
        ($process.CommandLine -and $process.CommandLine.Contains([string]$State.script))
}

function Get-SesListeners([int]$Port) {
    # A query failure is fatal; never interpret it as an available port.
    return @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq $Port | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Assert-SesPort([int]$Port, [string]$Role) {
    $state = Get-SesState $Role
    foreach ($processId in (Get-SesListeners $Port)) {
        if (!(Test-SesOwned $state) -or $processId -ne $state.pid) {
            throw "Port $Port is occupied by another process (PID $processId). Stop that application first."
        }
    }
}

function Stop-SesService([string]$Role) {
    $state = Get-SesState $Role
    if (Test-SesOwned $state) {
        Stop-Process -Id $state.pid -ErrorAction Stop
        Write-Host "Stopped SES $Role."
    }
    Remove-Item -LiteralPath (Join-Path $script:SesRun "$Role.json") -Force -ErrorAction SilentlyContinue
}

function Start-SesService([string]$Role, [string]$Entry, [string[]]$ExtraArguments, [string]$Url) {
    $working = Join-Path $script:SesRoot "packages/$Role"
    $spawner = Join-Path $script:SesRoot 'scripts/start-service.cjs'
    $spawnArguments = @($spawner, $working, (Join-Path $script:SesRun "$Role.log"), (Join-Path $script:SesRun "$Role-error.log"), $Entry) + $ExtraArguments
    $processId = & $script:SesNode @spawnArguments
    if ($LASTEXITCODE -ne 0) { throw "Cannot start SES $Role. Check $script:SesRun/$Role-error.log" }
    $process = Get-Process -Id ([int]$processId) -ErrorAction Stop
    # Record identity immediately so failure cleanup can reclaim a partially started service.
    $script:SesStarted += $Role
    $details = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.Id)"
    if (!$details) { throw "SES $Role exited. Check $script:SesRun/$Role-error.log" }
    @{
        pid = $process.Id
        created = $details.CreationDate.ToUniversalTime().Ticks.ToString()
        executable = $details.ExecutablePath
        script = $Entry
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $script:SesRun "$Role.json") -Encoding UTF8
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $process.Refresh()
        if ($process.HasExited) { break }
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2 | Out-Null
            return
        }
        catch { Start-Sleep -Seconds 1 }
    }
    throw "SES $Role failed to start. Check $script:SesRun/$Role-error.log"
}

function Invoke-SesMain([string]$Mode) {
    if ($env:OS -ne 'Windows_NT') { throw 'This launcher supports Windows only.' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    New-Item -ItemType Directory -Force -Path $script:SesRun | Out-Null
    $lock = $null
    try {
        $lock = [IO.File]::Open((Join-Path $script:SesRun 'launcher.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    }
    catch { throw 'Another SES launcher is running. Wait for it to finish.' }
    $previousLocation = Get-Location
    $script:SesStarted = @()
    $success = $false
    try {
        Set-Location -LiteralPath $script:SesRoot
        if ($Mode -eq 'stop') {
            Stop-SesService 'client'
            Stop-SesService 'server'
            Write-Host 'SES stopped. Documents have been preserved.'
            $success = $true
            return
        }
        Assert-SesPort 3000 'server'
        Assert-SesPort 5173 'client'
        Initialize-SesRuntime
        Install-SesDependencies
        if (!(Get-SesListeners 3000).Count) {
            Write-Host 'Building SES...'
            Invoke-SesCommand $script:SesNode @($script:SesPnpm, '-r', 'run', 'build')
            Invoke-SesCommand $script:SesNode @((Join-Path $script:SesRoot 'scripts/backup-db.cjs'))
            $savedPort = $env:PORT
            $savedHost = $env:SES_LISTEN_HOST
            $env:PORT = '3000'
            $env:SES_LISTEN_HOST = '127.0.0.1'
            try { Start-SesService 'server' (Join-Path $script:SesRoot 'packages/server/dist/main.js') @() 'http://127.0.0.1:3000/api/documents' }
            finally { $env:PORT = $savedPort; $env:SES_LISTEN_HOST = $savedHost }
        }
        if (!(Get-SesListeners 5173).Count) {
            $vite = Join-Path $script:SesRoot 'packages/client/node_modules/vite/bin/vite.js'
            Start-SesService 'client' $vite @('--host', '127.0.0.1', '--port', '5173', '--strictPort') 'http://127.0.0.1:5173/'
        }
        Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/api/documents' -TimeoutSec 5 | Out-Null
        $success = $true
        Write-Host 'SES is running: http://127.0.0.1:5173/'
        Write-Host "Logs: $script:SesRun"
        if ($env:SES_NO_OPEN -ne '1') { Start-Process 'http://127.0.0.1:5173/' }
    }
    finally {
        if (!$success) { foreach ($role in $script:SesStarted) { Stop-SesService $role } }
        Set-Location $previousLocation
        $lock.Dispose()
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try { Invoke-SesMain $Action }
    catch {
        Write-Host "SES error: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host $_.InvocationInfo.PositionMessage
        Write-Host $_.ScriptStackTrace
        exit 1
    }
}
