#!/usr/bin/env bash
# TruOffers deploy: pull, rebuild, restart, verify.
# Usage:  ./deploy.sh            (pull latest, rebuild changed images, restart)
#         ./deploy.sh --no-pull  (rebuild from the working tree as-is)
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found. Run: cp .env.production.example .env && nano .env" >&2
  exit 1
fi

if [[ "${1:-}" != "--no-pull" ]]; then
  echo "==> Pulling latest code"
  git pull --ff-only
fi

echo "==> Building and starting the stack"
docker compose up -d --build

echo "==> Waiting for the API to report healthy"
for i in {1..60}; do
  status="$(docker compose ps --format json api 2>/dev/null | sed -n 's/.*"Health":"\([^"]*\)".*/\1/p' | head -1)"
  if [[ "$status" == "healthy" ]]; then
    echo "    API healthy"
    break
  fi
  if [[ $i -eq 60 ]]; then
    echo "ERROR: API did not become healthy in time. Recent logs:" >&2
    docker compose logs --tail 40 api >&2
    exit 1
  fi
  sleep 2
done

echo "==> Verifying the site responds through the proxy"
site_url="$(grep -E '^SITE_URL=' .env | cut -d= -f2-)"
if curl -fsS --max-time 10 "${site_url}/api/health" > /dev/null; then
  echo "    ${site_url}/api/health OK"
else
  echo "WARNING: ${site_url}/api/health did not respond." >&2
  echo "         If this is a fresh deploy, check DNS points here and see: docker compose logs caddy" >&2
fi

echo "==> Cleaning up dangling images"
docker image prune -f > /dev/null

echo "==> Deployed. Status:"
docker compose ps
