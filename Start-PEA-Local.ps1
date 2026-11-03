$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$python = $null
if (Get-Command py -ErrorAction SilentlyContinue) { $python = 'py' }
elseif (Get-Command python -ErrorAction SilentlyContinue) { $python = 'python' }
else { throw 'Python was not found. Install Python 3.10 or newer, then run this file again.' }

$venvPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
    Write-Host 'Preparing PEA Studio (first run only)...' -ForegroundColor Cyan
    if ($python -eq 'py') { & py -3 -m venv .venv } else { & python -m venv .venv }
    if ($LASTEXITCODE -ne 0) { throw 'Python could not create the PEA virtual environment.' }
}

Write-Host 'Checking PEA components...' -ForegroundColor Cyan
& $venvPython -c "import flask, requests" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Installing PEA dependencies (first run only)...' -ForegroundColor Cyan
    & $venvPython -m pip install --disable-pip-version-check -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'PEA dependencies could not be installed. Check your internet connection and run this file again.' }
}

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Warning 'FFmpeg was not found. PEA editing and AI generation can work, but local MP4 conversion needs FFmpeg. Install FFmpeg and reopen PowerShell.'
}

$adminName = Read-Host 'PEA admin name (same value as ADMIN_NAME)'
$securePassword = Read-Host 'PEA admin password (same value as ADMIN_PASSWORD)' -AsSecureString
$credential = [System.Net.NetworkCredential]::new('', $securePassword)
$adminPassword = $credential.Password

try {
    $env:ADMIN_NAME = $adminName
    $env:ADMIN_PASSWORD = $adminPassword
    Write-Host 'Starting PEA Studio at http://127.0.0.1:5000' -ForegroundColor Green
    Write-Host 'Keep this window open. Start ComfyUI first for AI generation.' -ForegroundColor Yellow
    & $venvPython run_local.py
    if ($LASTEXITCODE -ne 0) { throw 'PEA Studio stopped with an error. Read the message above.' }
}
finally {
    Remove-Item Env:ADMIN_NAME -ErrorAction SilentlyContinue
    Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
    $adminPassword = $null
    $credential = $null
    $securePassword = $null
}
