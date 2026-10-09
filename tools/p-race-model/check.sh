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

run_model() {
  local project="$1" safe_test="$2" unsafe_test="$3" dll
  dll="./PGenerated/${project}/PChecker/net8.0/Goko${project}.dll"
  run_p p compile --pproj "${project}.pproj"
  run_p p check "$dll" -tc "$safe_test" -s 100
  if run_p p check "$dll" -tc "$unsafe_test" -s 100; then
    echo "${project} unsafe fixture unexpectedly passed" >&2
    exit 1
  fi
}

run_model FoodOrderRace tcGuardedReserve tcUnsafeReadThenWrite
run_model FoodPaymentRace tcClaimedFoodSettlement tcUnsafeFoodSettlement
run_model BookingPaymentRace tcCasBookingPayment tcUnsafeBookingPayment
run_model NativeHoldRace tcGuardedHold tcUnsafeHold
run_model CheckinRace tcClaimedCheckin tcUnsafeCheckin

echo "P models passed: every guarded contract held and every unsafe fixture was rejected."
