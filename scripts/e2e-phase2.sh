#!/usr/bin/env bash
# Scraper Phase 2 end-to-end check, on the same isolated stack as Phase 1. Drives over HTTP:
# authorised network discovery → template fingerprint from two example websites → selector adapter
# dry run and approval → extraction across matching websites → rollback and re-run → provider adapter
# precedence → opt-out redaction of builder output.
#
#   scripts/e2e-phase2.sh                 run, then tear everything down
#   KEEP_STACK=1 scripts/e2e-phase2.sh    leave the stack running for inspection
set -euo pipefail

source "$(dirname "$0")/e2e/stack.sh"

e2e_start
e2e_drive phase2.mjs "Phase 2"
e2e_check_fixture_requests
# Opted out before the network was discovered; linked from the studio directory but never listed.
e2e_check_never_requested dragon-wok.test panda-noodles.test

echo "==> Phase 2 end-to-end check passed"
