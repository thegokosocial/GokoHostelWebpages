#!/usr/bin/env bash
set -euo pipefail

repo_url="${GOKO_FRRO_REPO_URL:-https://github.com/thegokosocial/GokoHostelWebpages.git}"
target_dir="${GOKO_FRRO_DIR:-$HOME/Downloads/GokoWeb}"

command -v git >/dev/null || { echo "Git is required: https://git-scm.com/downloads"; exit 1; }
command -v node >/dev/null || { echo "Node.js 18+ is required: https://nodejs.org/"; exit 1; }
command -v npm >/dev/null || { echo "npm is required (included with Node.js)."; exit 1; }

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 18 ]; then
  echo "Node.js 18+ is required (found $(node --version))."
  exit 1
fi

if [ -d "$target_dir/.git" ]; then
  git -C "$target_dir" pull --ff-only
else
  mkdir -p "$(dirname "$target_dir")"
  git clone "$repo_url" "$target_dir"
fi

cd "$target_dir"
npm install
npx playwright install chromium
echo "FRRO desktop helper is ready. Keep this terminal open while using Review & Submit (Desktop)."
npm run frro:server
