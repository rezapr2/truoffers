#!/usr/bin/env bash
# Scraper Phase 1 end-to-end check. Builds the API, worker and web images from source, starts the
# stack on an isolated network with fictional fixture websites, and drives the whole flow over HTTP:
# submit → crawl → review → publish → merchant confirmation → removal request → emergency stop.
#
#   scripts/e2e-phase1.sh                 run, then tear everything down
#   KEEP_STACK=1 scripts/e2e-phase1.sh    leave the stack running for inspection
set -euo pipefail

cd "$(dirname "$0")/.."

export JWT_SECRET="e2e-$(openssl rand -hex 16)"
export SITE_URL=http://web:3000
export SITE_DOMAIN=:80
COMPOSE=(docker compose -p truoffers-e2e -f docker-compose.yml -f docker-compose.e2e.yml)

cleanup() {
  local status=$?
  if (( status != 0 )); then
    echo "--- api logs ---" >&2;    "${COMPOSE[@]}" logs --tail 40 api >&2 || true
    echo "--- worker logs ---" >&2; "${COMPOSE[@]}" logs --tail 60 worker >&2 || true
  fi
  if [[ "${KEEP_STACK:-}" != "1" ]]; then
    "${COMPOSE[@]}" down -v --remove-orphans > /dev/null 2>&1 || true
  fi
  exit $status
}
trap cleanup EXIT

echo "==> Building and starting the stack"
"${COMPOSE[@]}" up -d --build --wait mongo redis api worker fixtures web

echo "==> Seeding demo data and running the scraper migration"
"${COMPOSE[@]}" exec -T api node dist/seed/seed.js > /dev/null
"${COMPOSE[@]}" exec -T api node dist/scripts/migrate-scraper.js

echo "==> Driving the Phase 1 flow"
"${COMPOSE[@]}" run --rm e2e

echo "==> Checking what the fixture websites saw"
requests="$("${COMPOSE[@]}" logs --no-log-prefix fixtures | grep '\.test "GET ' || true)"
if [[ -z "$requests" ]]; then
  echo "FAIL: the fixture websites received no requests" >&2
  exit 1
fi
if grep -v '"TruOffersBot/1.0 (+http://web:3000/bot)"$' <<< "$requests"; then
  echo "FAIL: the requests above did not carry the bot's fixed User-Agent" >&2
  exit 1
fi
if grep -E '"GET /(login|basket)' <<< "$requests"; then
  echo "FAIL: the crawler requested account or checkout pages" >&2
  exit 1
fi
echo "    $(wc -l <<< "$requests" | tr -d ' ') requests, all from TruOffersBot, none to account or checkout pages"

echo "==> Phase 1 end-to-end check passed"
