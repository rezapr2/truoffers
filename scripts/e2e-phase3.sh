#!/usr/bin/env bash
# Scraper Phase 3 end-to-end check, on the same isolated stack plus the render worker. Drives over HTTP:
# rechecks with changed and missing offers → revision and expiry review → rendering a JavaScript-only
# website in the render worker → a claim invitation for the unclaimed listing.
#
#   scripts/e2e-phase3.sh                 run, then tear everything down
#   KEEP_STACK=1 scripts/e2e-phase3.sh    leave the stack running for inspection
set -euo pipefail

source "$(dirname "$0")/e2e/stack.sh"

e2e_start render-worker
e2e_drive phase3.mjs "Phase 3"
e2e_check_fixture_requests

echo "==> Checking the rendered website loaded no images, media or fonts"
if e2e_fixture_requests | grep -E '^spa-only\.test "GET [^"]*\.(png|jpe?g|gif|webp|svg|mp4|webm|woff2?|ttf|otf)'; then
  echo "FAIL: the render worker requested the assets above" >&2
  exit 1
fi
echo "    none requested"

echo "==> Phase 3 end-to-end check passed"
