# Stages the Windows x64 runtime for package-release.py on a Windows build machine.
param([Parameter(Mandatory = $true)][string]$Output)
$ErrorActionPreference = 'Stop'
$Output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Output)
$node = (Get-Command node.exe).Source
if ((& $node -p "process.platform + '/' + process.arch") -ne 'win32/x64') {
    throw 'The Windows portable package must be built with Windows x64 Node.js.'
}
if (Test-Path -LiteralPath $Output) { throw "Use a new staging directory: $Output" }

function Invoke-Pnpm([string[]]$Parameters) {
    & pnpm @Parameters
    if ($LASTEXITCODE -ne 0) { throw "pnpm $($Parameters[0]) failed with exit code $LASTEXITCODE" }
}

$savedPlaywright = $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD
$savedPuppeteer = $env:PUPPETEER_SKIP_DOWNLOAD
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
$env:PUPPETEER_SKIP_DOWNLOAD = '1'
Push-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
try {
    Invoke-Pnpm @('install', '--frozen-lockfile')
    Invoke-Pnpm @('build')
    $store = (Invoke-Pnpm @('store', 'path', '--silent')).Trim()
    [void][IO.Directory]::CreateDirectory($Output)
    $server = Join-Path $Output 'server'
    Invoke-Pnpm @('--filter', '@ses/server', '--config.inject-workspace-packages=true',
        '--config.node-linker=hoisted', '--config.package-import-method=copy',
        'deploy', '--offline', '--prod', '--store-dir', $store, $server)

    $dist = Join-Path $server 'dist'
    [void][IO.Directory]::CreateDirectory($dist)
    Copy-Item -Path 'packages/server/dist/*' -Destination $dist -Recurse -Force
    Copy-Item -LiteralPath 'packages/client/dist' -Destination (Join-Path $Output 'client') -Recurse
    Copy-Item -LiteralPath $node -Destination (Join-Path $Output 'node.exe')
    Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $node) 'LICENSE') -Destination (Join-Path $Output 'LICENSE.node')

    $manifest = Join-Path $server 'package.json'
    & $node -e "const DB = require('node:module').createRequire(process.argv[1])('better-sqlite3'); new DB(':memory:').close()" $manifest
    if ($LASTEXITCODE -ne 0) { throw 'The bundled SQLite native module did not load.' }
}
finally {
    Pop-Location
    $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = $savedPlaywright
    $env:PUPPETEER_SKIP_DOWNLOAD = $savedPuppeteer
}
