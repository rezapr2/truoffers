#!/usr/bin/env bash
# TruOffers deploy — runs on the VPS. Pulls prebuilt images and restarts.
# Nothing is compiled here, so a 1GB box is plenty.
#
#   ./deploy.sh                       pull latest code + images, restart, verify
#   ./deploy.sh --no-git-pull         skip `git pull` (images are still pulled)
#   IMAGE_TAG=sha-abc123 ./deploy.sh  roll back to a specific published build
#
# Publish images first from a build machine: ./build-and-push.sh
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found. Run: cp .env.production.example .env && nano .env" >&2
  exit 1
fi

if [[ "${1:-}" != "--no-git-pull" ]]; then
  echo "==> Pulling latest code"
  git pull --ff-only
fi

echo "==> Pulling images${IMAGE_TAG:+ (tag: ${IMAGE_TAG})}"
if ! docker compose pull; then
  cat >&2 <<'MSG'

ERROR: could not pull the images. The usual causes:

  1. They have not been published yet.
     On your build machine (not here) run:  ./build-and-push.sh

  2. This VPS is not logged in to the registry.
     GHCR packages are PRIVATE by default, so a pull needs credentials:
       echo <GITHUB_PAT> | docker login ghcr.io -u <github-username> --password-stdin
     The token only needs the read:packages scope.
     Alternatively make the package public:
       GitHub -> your profile -> Packages -> truoffers-api/-web -> Package settings
       -> Change visibility -> Public   (then no login is needed)

  3. IMAGE_TAG points at a tag that was never pushed.

MSG
  exit 1
fi

echo "==> Starting the stack"
docker compose up -d

health_of() {
  docker compose ps --format json "$1" 2>/dev/null \
    | sed -n 's/.*"Health":"\([^"]*\)".*/\1/p' | head -1
}

# Mongo replays its journal before accepting connections after an unclean
# shutdown, which can take minutes on a small VPS. Be patient rather than
# aborting and recreating the container mid-recovery.
echo "==> Waiting for services to report healthy"
deadline=$(( SECONDS + 420 ))
last_note=0
while true; do
  api_status="$(health_of api)"
  if [[ "$api_status" == "healthy" ]]; then
    echo "    API healthy"
    break
  fi

  if (( SECONDS >= deadline )); then
    echo "ERROR: services did not become healthy within 7 minutes." >&2
    echo "       mongo=$(health_of mongo)  api=${api_status:-starting}" >&2
    echo "--- mongo logs ---" >&2; docker compose logs --tail 20 mongo >&2
    echo "--- api logs ---" >&2;   docker compose logs --tail 30 api >&2
    exit 1
  fi

  # Progress note every 30s so a slow recovery doesn't look like a hang
  if (( SECONDS - last_note >= 30 )); then
    mongo_status="$(health_of mongo)"
    if [[ "$mongo_status" != "healthy" ]]; then
      echo "    mongo: ${mongo_status:-starting} — if this is the first start after an"
      echo "           unclean shutdown it is replaying its journal; leave it running."
    else
      echo "    mongo healthy; waiting on api (${api_status:-starting})"
    fi
    last_note=$SECONDS
  fi
  sleep 3
done

echo "==> Verifying the site responds through the proxy"
site_url="$(grep -E '^SITE_URL=' .env | cut -d= -f2-)"
if curl -fsS --max-time 10 "${site_url}/api/health" > /dev/null; then
  echo "    ${site_url}/api/health OK"
else
  echo "WARNING: ${site_url}/api/health did not respond." >&2
  echo "         If this is a fresh deploy, check DNS points here and see: docker compose logs caddy" >&2
fi

echo "==> Cleaning up old images"
docker image prune -f > /dev/null

echo "==> Deployed. Status:"
docker compose ps
