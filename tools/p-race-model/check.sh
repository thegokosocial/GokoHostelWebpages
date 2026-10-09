#!/usr/bin/env bash
set -euo pipefail

model_dir="$(cd "$(dirname "$0")" && pwd)"
image="ghcr.io/p-org/p:latest"

run_p() {
  if [ -n "${P_BIN:-}" ]; then
    "$P_BIN" "${@:2}"
  elif command -v docker >/dev/null 2>&1; then
    docker run --rm -v "$model_dir:/workspace" -w /workspace "$image" "$@"
  elif command -v p >/dev/null 2>&1; then
    p "${@:2}"
  else
    echo "Install Docker, install P, or set P_BIN to the P CLI path." >&2
    exit 1
  fi
}

run_p p compile --pproj FoodOrderRace.pproj
run_p p check -tc tcGuardedReserve -i 100

if run_p p check -tc tcUnsafeReadThenWrite -i 100; then
  echo "unsafe model unexpectedly passed; the counterexample fixture is no longer exercising a race" >&2
  exit 1
fi

echo "P model passed: guarded reserve is safe and unsafe read-then-write was rejected."
