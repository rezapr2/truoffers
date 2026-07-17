#!/usr/bin/env bash
# Build the TruOffers images on a machine with real RAM and publish them to the
# registry. The 1GB VPS never compiles anything — it only pulls and runs.
#
#   ./build-and-push.sh              build for the VPS (linux/amd64) and push
#   ./build-and-push.sh --local      build for THIS machine's arch, load locally,
#                                    do not push (used for testing the stack)
#
# Config comes from .env.build (see .env.build.example). Note this file holds no
# production secrets — only the public NEXT_PUBLIC_* values baked into the bundle.
set -euo pipefail

cd "$(dirname "$0")"

LOCAL_ONLY=false
[[ "${1:-}" == "--local" ]] && LOCAL_ONLY=true

if [[ -f .env.build ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.build
  set +a
fi

REGISTRY="${REGISTRY:-ghcr.io/rezapr2}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
# The VPS architecture. Check yours with: uname -m
#   x86_64  -> linux/amd64   (almost all VPS providers)
#   aarch64 -> linux/arm64   (Oracle Ampere, Hetzner ARM, ...)
PLATFORM="${PLATFORM:-linux/amd64}"

if [[ -z "${SITE_URL:-}" ]]; then
  echo "ERROR: SITE_URL is not set." >&2
  echo "       It is baked into the frontend bundle at build time and must be the" >&2
  echo "       public URL (e.g. https://truoffers.co.uk)." >&2
  echo "       Run: cp .env.build.example .env.build && nano .env.build" >&2
  exit 1
fi

API_IMAGE="${REGISTRY}/truoffers-api"
WEB_IMAGE="${REGISTRY}/truoffers-web"
# A content-addressed tag alongside :latest, so a bad deploy can be rolled back
# to a known-good build: IMAGE_TAG=sha-<short> ./deploy.sh
SHA_TAG="sha-$(git rev-parse --short HEAD 2>/dev/null || echo manual)"

BUILD_FLAGS=()
if $LOCAL_ONLY; then
  PLATFORM="$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')"
  BUILD_FLAGS+=(--load)
  echo "==> LOCAL build for ${PLATFORM} (not pushed)"
else
  BUILD_FLAGS+=(--push)
  echo "==> Building for ${PLATFORM} and pushing to ${REGISTRY}"
  # The default builder cannot cross-build; the docker-container driver can.
  if ! docker buildx inspect truoffers-builder > /dev/null 2>&1; then
    echo "==> Creating buildx builder (needed for cross-architecture builds)"
    docker buildx create --name truoffers-builder --driver docker-container --bootstrap > /dev/null
  fi
  BUILD_FLAGS+=(--builder truoffers-builder)
fi

echo "==> Tags: ${IMAGE_TAG} and ${SHA_TAG}"

echo "==> Building API image"
docker buildx build "${BUILD_FLAGS[@]}" \
  --platform "$PLATFORM" \
  -t "${API_IMAGE}:${IMAGE_TAG}" \
  -t "${API_IMAGE}:${SHA_TAG}" \
  ./backend

echo "==> Building web image (SITE_URL=${SITE_URL} baked in)"
docker buildx build "${BUILD_FLAGS[@]}" \
  --platform "$PLATFORM" \
  --build-arg "NEXT_PUBLIC_API_URL=${SITE_URL}/api" \
  --build-arg "NEXT_PUBLIC_SITE_URL=${SITE_URL}" \
  --build-arg "NEXT_PUBLIC_GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-}" \
  --build-arg "NEXT_PUBLIC_APPLE_CLIENT_ID=${APPLE_CLIENT_ID:-}" \
  -t "${WEB_IMAGE}:${IMAGE_TAG}" \
  -t "${WEB_IMAGE}:${SHA_TAG}" \
  ./frontend

if $LOCAL_ONLY; then
  echo "==> Built locally. Images:"
  docker images --format "  {{.Repository}}:{{.Tag}}  {{.Size}}" | grep truoffers | head -4
else
  echo "==> Pushed. On the VPS now run:  ./deploy.sh"
  echo "    Rollback to this exact build:  IMAGE_TAG=${SHA_TAG} ./deploy.sh"
fi
