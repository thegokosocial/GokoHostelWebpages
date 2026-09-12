#!/usr/bin/env bash
set -euo pipefail

on_exit() {
  code=$?
  if [ "$code" -ne 0 ]; then
    echo
    echo "FRRO setup stopped with exit code $code. Read the error above and run the command again after fixing it."
    if [ -t 0 ]; then read -r -p "Press Enter to close..." || true; fi
  fi
  trap - EXIT
  exit "$code"
}
trap on_exit EXIT

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

if [ -d "$target_dir/.git" ] && git -C "$target_dir" rev-parse --verify HEAD >/dev/null 2>&1; then
  git -C "$target_dir" pull --ff-only
elif [ -d "$target_dir/.git" ]; then
  backup_dir="${target_dir}.incomplete-$(date +%Y%m%d-%H%M%S)"
  echo "An incomplete previous clone was found. Moving it to: $backup_dir"
  mv "$target_dir" "$backup_dir"
  git clone "$repo_url" "$target_dir"
elif [ -e "$target_dir" ]; then
  echo "Target exists but is not a GokoWeb Git checkout: $target_dir"
  echo "Choose another location with GOKO_FRRO_DIR=/path/to/GokoWeb and run again."
  exit 1
else
  mkdir -p "$(dirname "$target_dir")"
  git clone "$repo_url" "$target_dir"
fi

cd "$target_dir"
if curl -fsS http://127.0.0.1:3456/status >/dev/null 2>&1; then
  echo "FRRO helper is already running on http://localhost:3456. Keep using the existing helper terminal."
  exit 0
fi
npm install
npm install --prefix scripts
(cd scripts && npx playwright install chromium)
echo "FRRO desktop helper is ready. Keep this terminal open while using Review & Submit (Desktop)."
npm run frro:server
