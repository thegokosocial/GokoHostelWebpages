$ErrorActionPreference = "Stop"

$repoUrl = if ($env:GOKO_FRRO_REPO_URL) { $env:GOKO_FRRO_REPO_URL } else { "https://github.com/thegokosocial/GokoHostelWebpages.git" }
$targetDir = if ($env:GOKO_FRRO_DIR) { $env:GOKO_FRRO_DIR } else { Join-Path $env:USERPROFILE "GokoWeb" }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git is required: https://git-scm.com/downloads" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 18+ is required: https://nodejs.org/" }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is required (included with Node.js)." }

$nodeMajor = [int](& node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt 18) { throw "Node.js 18+ is required (found $((& node --version)))." }

$gitDir = Join-Path $targetDir ".git"
if ((Test-Path $gitDir) -and (& git -C $targetDir rev-parse --verify HEAD 2>$null)) {
  git -C $targetDir pull --ff-only
} elseif (Test-Path $gitDir) {
  $backupDir = "$targetDir.incomplete-$(Get-Date -Format yyyyMMdd-HHmmss)"
  Write-Host "An incomplete previous clone was found. Moving it to: $backupDir"
  Move-Item $targetDir $backupDir
  git clone $repoUrl $targetDir
} elseif (Test-Path $targetDir) {
  throw "Target exists but is not a GokoWeb Git checkout: $targetDir"
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path $targetDir) | Out-Null
  git clone $repoUrl $targetDir
}

Set-Location $targetDir
try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3456/status -TimeoutSec 2 | Out-Null; Write-Host "FRRO helper is already running on http://localhost:3456."; exit 0 } catch {}
npm install
npm install --prefix scripts
Set-Location (Join-Path $targetDir "scripts")
npx playwright install chromium
Set-Location $targetDir
Write-Host "FRRO desktop helper is ready. Keep this window open while using Review & Submit (Desktop)."
npm run frro:server
