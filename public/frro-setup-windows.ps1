$ErrorActionPreference = "Stop"

$repoUrl = if ($env:GOKO_FRRO_REPO_URL) { $env:GOKO_FRRO_REPO_URL } else { "https://github.com/thegokosocial/GokoHostelWebpages.git" }
$targetDir = if ($env:GOKO_FRRO_DIR) { $env:GOKO_FRRO_DIR } else { Join-Path $env:USERPROFILE "GokoWeb" }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git is required: https://git-scm.com/downloads" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 18+ is required: https://nodejs.org/" }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is required (included with Node.js)." }

$nodeMajor = [int](& node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt 18) { throw "Node.js 18+ is required (found $((& node --version)))." }

if (Test-Path (Join-Path $targetDir ".git")) { git -C $targetDir pull --ff-only }
else { New-Item -ItemType Directory -Force -Path (Split-Path $targetDir) | Out-Null; git clone $repoUrl $targetDir }

Set-Location $targetDir
npm install
npm install --prefix scripts
Set-Location (Join-Path $targetDir "scripts")
npx playwright install chromium
Set-Location $targetDir
Write-Host "FRRO desktop helper is ready. Keep this window open while using Review & Submit (Desktop)."
npm run frro:server
