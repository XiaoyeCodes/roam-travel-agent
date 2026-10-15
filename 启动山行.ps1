$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Please install Node.js 20.15+ (recommended: Node.js 22 LTS).'
}
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
Write-Host 'Roam Travel Agent: http://127.0.0.1:5173/' -ForegroundColor Green
Write-Host 'Press Ctrl+C to stop both the web client and API.'
npm run dev
