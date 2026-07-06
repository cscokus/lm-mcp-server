#!/bin/bash
# deploy.sh — build & (re)deploy the lm-mcp-server container.
#
# Usage:
#   ./deploy.sh              — git pull, rebuild, restart the MCP container, health-check
#   ./deploy.sh --no-pull    — deploy the current working tree as-is (skip git pull)
#   ./deploy.sh tunnel       — also (re)start the cloudflared sidecar (only if you
#                              front the server with a Cloudflare Tunnel instead of
#                              an A record + reverse-proxy vhost)
#
# The MCP container binds to 127.0.0.1:8930; your reverse-proxy vhost
# (lm-mcp.liquidmindmedia.com -> http://127.0.0.1:8930) sits in front of it.

set -euo pipefail
cd "$(dirname "$0")"

COMPOSE="docker compose -f docker-compose.yml"
SERVICE=lm-mcp
HEALTH_URL="http://127.0.0.1:8930/health"

PULL=1
WITH_TUNNEL=0
for arg in "$@"; do
    case "$arg" in
        --no-pull) PULL=0 ;;
        tunnel)    WITH_TUNNEL=1 ;;
        *)         echo "Unknown option: $arg (valid: --no-pull, tunnel)" >&2; exit 1 ;;
    esac
done

# --- Preflight ---------------------------------------------------------------
# The container reads MCP_AUTH_TOKEN and CRM_BASE_URL from .env at startup and
# exits immediately if they're missing. Fail here with a clear message instead
# of shipping a crash-looping container.
if [ ! -f .env ]; then
    echo "!! .env not found. Copy .env.example to .env and fill in MCP_AUTH_TOKEN," >&2
    echo "   CRM_BASE_URL, and CRM_SERVICE_TOKEN before deploying." >&2
    exit 1
fi

# --- Pull latest -------------------------------------------------------------
if [ "$PULL" -eq 1 ]; then
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1 && git remote get-url origin >/dev/null 2>&1; then
        echo "==> Pulling latest from origin..."
        git pull --ff-only
    else
        echo "==> No git remote configured — skipping pull (deploying working tree)."
    fi
fi

# --- BuildKit hang fix (shared with LiquidMindWebPages) ----------------------
# Docker's embedded BuildKit can deadlock on the post-build provenance step.
# Route builds through a dedicated docker-container builder, which doesn't hang.
# Reuse the same builder name so this repo shares the build cache on the box.
BUILDER=lmbuilder
export BUILDX_BUILDER="$BUILDER"

ensure_builder() {
    if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
        echo "==> Creating dedicated build builder '$BUILDER' (docker-container driver)..."
        docker buildx create --name "$BUILDER" --driver docker-container --bootstrap >/dev/null
    fi
}

BUILD_TIMEOUT_SECS=600

build_with_hang_guard() {
    local service="$1"
    local before after
    before=$($COMPOSE images -q "$service" 2>/dev/null || true)

    set +e
    timeout "$BUILD_TIMEOUT_SECS" $COMPOSE build "$service"
    local rc=$?
    set -e

    if [ "$rc" -eq 0 ]; then return 0; fi
    if [ "$rc" -ne 124 ]; then
        echo "    Build failed (exit $rc)." >&2
        return 1
    fi

    echo "    Build did not return after ${BUILD_TIMEOUT_SECS}s — checking for the known" >&2
    echo "    post-build BuildKit hang before declaring failure..." >&2
    after=$($COMPOSE images -q "$service" 2>/dev/null || true)
    if [ -n "$after" ] && [ "$after" != "$before" ]; then
        echo "    New image $after found — build finished, the CLI just never returned." >&2
        return 0
    fi
    echo "    No new image — this looks like a real failure, not just the hang." >&2
    return 1
}

# --- Build + restart ---------------------------------------------------------
ensure_builder

echo "==> Building $SERVICE..."
if ! build_with_hang_guard "$SERVICE"; then
    echo "    Build failed — leaving the current container running, untouched." >&2
    exit 1
fi

echo "==> Restarting $SERVICE..."
$COMPOSE up -d --no-deps "$SERVICE"

if [ "$WITH_TUNNEL" -eq 1 ]; then
    echo "==> (Re)starting cloudflared sidecar..."
    $COMPOSE up -d --no-deps cloudflared
fi

# --- Health check ------------------------------------------------------------
echo "==> Waiting for health at $HEALTH_URL ..."
ok=0
for i in $(seq 1 15); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then ok=1; break; fi
    sleep 1
done

if [ "$ok" -eq 1 ]; then
    echo "    Healthy: $(curl -fsS "$HEALTH_URL")"
else
    echo "!! Service did not become healthy in 15s. Recent logs:" >&2
    $COMPOSE logs --tail=30 "$SERVICE" >&2
    exit 1
fi

echo ""
echo "==> Deploy complete."
$COMPOSE ps
