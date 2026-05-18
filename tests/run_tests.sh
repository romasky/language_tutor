#!/bin/bash
# Run all tests in order: unit → integration → e2e
set -euo pipefail

PASS=0
FAIL=0

run_suite() {
  local name="$1"
  local file="$2"
  echo ""
  echo "════════════════════════════════════════════════════"
  echo " $name"
  echo "════════════════════════════════════════════════════"
  if node "$file"; then
    echo "→ $name: PASS"
    PASS=$((PASS+1))
  else
    echo "→ $name: FAIL"
    FAIL=$((FAIL+1))
  fi
}

DIR="$(cd "$(dirname "$0")" && pwd)"

run_suite "Unit: Router"      "$DIR/unit_router.test.js"
run_suite "Unit: Onboarding"  "$DIR/unit_onboarding.test.js"
run_suite "Integration: DB+Redis" "$DIR/integration.test.js"
run_suite "E2E: Full webhook flow" "$DIR/e2e.test.js"

echo ""
echo "════════════════════════════════════════════════════"
echo " TOTAL: $PASS suites passed, $FAIL suites failed"
echo "════════════════════════════════════════════════════"

[ "$FAIL" -eq 0 ] || exit 1
