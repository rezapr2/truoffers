#!/usr/bin/env bash
# Scraper Phase 1 end-to-end check. Builds the API, worker and web images from source, starts the
# stack on an isolated network with fictional fixture websites, and drives the whole flow over HTTP:
# submit → crawl → review → publish → merchant confirmation → removal request → emergency stop.
#
#   scripts/e2e-phase1.sh                 run, then tear everything down
#   KEEP_STACK=1 scripts/e2e-phase1.sh    leave the stack running for inspection
set -euo pipefail

source "$(dirname "$0")/e2e/stack.sh"

e2e_start
e2e_drive phase1.mjs "Phase 1"
e2e_check_fixture_requests

echo "==> Phase 1 end-to-end check passed"
