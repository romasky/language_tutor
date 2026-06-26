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

run_suite "Unit: Router"              "$DIR/unit_router.test.js"
run_suite "Unit: Onboarding"          "$DIR/unit_onboarding.test.js"
run_suite "Unit: Dictation"           "$DIR/unit_dictation.test.js"
run_suite "Unit: Daily Lesson"        "$DIR/unit_daily_lesson.test.js"
run_suite "Integration: DB+Redis"     "$DIR/integration.test.js"
run_suite "Integration: Dictation"    "$DIR/integration_dictation.test.js"
run_suite "Integration: Daily Lesson" "$DIR/integration_daily_lesson.test.js"
run_suite "E2E: Full webhook flow"    "$DIR/e2e.test.js"
run_suite "E2E: Dictation"            "$DIR/e2e_dictation.test.js"
run_suite "E2E: Daily Lesson"         "$DIR/e2e_daily_lesson.test.js"

echo ""
echo "════════════════════════════════════════════════════"
echo " TOTAL: $PASS suites passed, $FAIL suites failed"
echo "════════════════════════════════════════════════════"

[ "$FAIL" -eq 0 ] || exit 1
