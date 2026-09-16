# Shared by scripts/e2e-phase*.sh. Builds the API, worker and web images from source and starts the
# stack on an isolated network with fictional fixture websites. Source it; don't run it.
#
#   KEEP_STACK=1 scripts/e2e-phaseN.sh    leave the stack running for inspection

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

export JWT_SECRET="e2e-$(openssl rand -hex 16)"
export SITE_URL=http://web:3000
export SITE_DOMAIN=:80
COMPOSE=(docker compose -p truoffers-e2e -f docker-compose.yml -f docker-compose.e2e.yml)

e2e_cleanup() {
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
trap e2e_cleanup EXIT

# e2e_start [extra service...]: e.g. render-worker for Phase 3.
e2e_start() {
  echo "==> Building and starting the stack"
  "${COMPOSE[@]}" up -d --build --wait mongo redis api worker fixtures web "$@"

  echo "==> Seeding demo data and running the scraper migration"
  "${COMPOSE[@]}" exec -T api node dist/seed/seed.js > /dev/null
  "${COMPOSE[@]}" exec -T api node dist/scripts/migrate-scraper.js
}

# e2e_drive <script in scripts/e2e> <label>
e2e_drive() {
  echo "==> Driving the $2 flow"
  "${COMPOSE[@]}" run --rm e2e node "$1"
}

# Every request the fixture websites received, one per line: host "GET /path HTTP/1.1" status "user agent".
e2e_fixture_requests() {
  "${COMPOSE[@]}" logs --no-log-prefix fixtures | grep '\.test "GET ' || true
}

# Fails unless the fixture websites were visited, only by TruOffersBot, and never on account or checkout pages.
e2e_check_fixture_requests() {
  echo "==> Checking what the fixture websites saw"
  local requests
  requests="$(e2e_fixture_requests)"
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
}

# e2e_check_never_requested <host>...: fails if any of these fixture websites received a request.
e2e_check_never_requested() {
  local requests host
  requests="$(e2e_fixture_requests)"
  for host in "$@"; do
    if grep -F "$host \"GET " <<< "$requests"; then
      echo "FAIL: $host must never be requested" >&2
      exit 1
    fi
  done
  echo "    no requests to $*"
}
