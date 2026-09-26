param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$siteUrl = 'http://127.0.0.1:5173'
$runtimeNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (!(Test-Path -LiteralPath $runtimeNode)) {
    $runtimeNode = (Get-Command node -ErrorAction Stop).Source
}
$nodeVersion = [version]((& $runtimeNode --version).TrimStart('v'))
if ($nodeVersion -lt [version]'22.13.0') { throw 'Node.js 22.13 or newer is required.' }
if (!(Test-Path -LiteralPath 'node_modules/vinext/dist/cli.js')) {
    throw 'Dependencies are missing. Install them with pnpm install --frozen-lockfile first.'
}
$env:Path = (Split-Path -Parent $runtimeNode) + ';' + $env:Path
$siteReady = $false
try {
    $response = Invoke-WebRequest -Uri $siteUrl -UseBasicParsing -TimeoutSec 3
    $siteReady = $response.StatusCode -eq 200 -and $response.Content.Contains('Budapest Signal')
} catch {}
if (!$siteReady) {
    if (Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue) {
        throw 'Port 5173 is already in use by another server.'
    }
    New-Item -ItemType Directory -Force -Path '.sites-runtime' | Out-Null
    $siteProcess = Start-Process -FilePath $runtimeNode -ArgumentList @('scripts/run-framework.mjs', 'dev', '--hostname', '127.0.0.1', '--port', '5173') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot '.sites-runtime/local-server.log') -RedirectStandardError (Join-Path $PSScriptRoot '.sites-runtime/local-server-error.log') -PassThru
    Set-Content -LiteralPath '.sites-runtime/local-server.pid' -Value $siteProcess.Id
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($siteProcess.HasExited) { throw 'Server stopped. See .sites-runtime/local-server-error.log.' }
        try {
            $response = Invoke-WebRequest -Uri $siteUrl -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200 -and $response.Content.Contains('Budapest Signal')) { $siteReady = $true; break }
        } catch {}
        Start-Sleep -Seconds 1
    }
}
if (!$siteReady) { throw 'Server is still starting. Check .sites-runtime/local-server.log.' }
Write-Host "Budapest Signal is running at $siteUrl"
if (!$NoBrowser) { Start-Process $siteUrl }
