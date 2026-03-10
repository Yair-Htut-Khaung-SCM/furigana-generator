$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Join-Path $root "manifest.json"
$color = Join-Path $root "color.png"
$outline = Join-Path $root "outline.png"
$output = Join-Path $root "furigana-generator-teams.zip"

if (!(Test-Path $manifest) -or !(Test-Path $color) -or !(Test-Path $outline)) {
  throw "manifest.json, color.png, and outline.png must exist in teams-app folder."
}

if (Test-Path $output) {
  Remove-Item $output -Force
}

Compress-Archive -Path $manifest, $color, $outline -DestinationPath $output
Write-Host "Created package: $output"
