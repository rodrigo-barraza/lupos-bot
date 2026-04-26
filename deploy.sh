#!/bin/bash
# ============================================================
# Lupos — Build & Deploy to Synology NAS
#
# Builds the Docker image locally, pipes it over SSH to the
# NAS, copies the .env, and restarts the container — zero
# manual UI steps.
#
# Usage:
#   npm run deploy              # full deploy
#   npm run deploy -- --dry-run # validate without deploying
#   npm run deploy -- --skip-pull
#   npm run deploy -- --no-cache
# ============================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="lupos"
NAS_HOST="nas"                            # SSH config alias
NAS_COMPOSE_DIR="/volume1/docker/lupos"   # Synology path where compose lives
NAS_SMB_DIR="/mnt/k/lupos"               # Fallback: Windows SMB mount
DOCKER_BIN="/usr/local/bin/docker"        # Synology puts docker outside default PATH

# ── Flags ─────────────────────────────────────────────────────
DRY_RUN=false
SKIP_PULL=false
NO_CACHE=""

for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY_RUN=true ;;
    --skip-pull)  SKIP_PULL=true ;;
    --no-cache)   NO_CACHE="--no-cache" ;;
  esac
done

# ── Colors ────────────────────────────────────────────────────
BOLD="\033[1m"
DIM="\033[2m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

step()  { echo -e "\n${CYAN}${BOLD}▸ $1${RESET}"; }
info()  { echo -e "  ${DIM}$1${RESET}"; }
ok()    { echo -e "  ${GREEN}✔ $1${RESET}"; }
warn()  { echo -e "  ${YELLOW}⚠ $1${RESET}"; }
fail()  { echo -e "  ${RED}✖ $1${RESET}"; exit 1; }

# ── Timer ─────────────────────────────────────────────────────
DEPLOY_START=$SECONDS

# ── Header ────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}══════════════════════════════════════════════════════${RESET}"
echo -e "${CYAN}${BOLD}  🐺 Lupos — Deploy to Synology${RESET}"
if $DRY_RUN; then
  echo -e "${YELLOW}${BOLD}  ⚠  DRY RUN — no changes will be made${RESET}"
fi
echo -e "${CYAN}${BOLD}══════════════════════════════════════════════════════${RESET}"

# ── Validate required files ──────────────────────────────────
step "Validating deployment files"

DEPLOY_ENV="${SCRIPT_DIR}/.env.deploy"
if [ ! -f "$DEPLOY_ENV" ]; then
  fail ".env.deploy not found at ${DEPLOY_ENV} — create it with runtime env vars (VAULT_URL, VAULT_TOKEN, etc.)"
fi
ok ".env.deploy found ($(wc -l < "$DEPLOY_ENV") lines)"

# ── Git info ──────────────────────────────────────────────────
cd "$SCRIPT_DIR"
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
info "Branch: ${GIT_BRANCH} @ ${GIT_SHA}"
info "Time:   ${BUILD_TIME}"

# ── Detect SSH access ────────────────────────────────────────
HAS_SSH=false
if ssh -o ConnectTimeout=3 -o BatchMode=yes "$NAS_HOST" "true" 2>/dev/null; then
  HAS_SSH=true
  ok "SSH access to ${NAS_HOST} confirmed"
else
  warn "SSH to '${NAS_HOST}' unavailable — will fall back to SMB export"
fi

# ── 1. Pull latest ────────────────────────────────────────────
if ! $SKIP_PULL; then
  step "Pulling latest changes"
  if $DRY_RUN; then
    info "(skipped — dry run)"
  else
    git pull --ff-only 2>&1 | sed 's/^/  /'
    GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    ok "Now at ${GIT_SHA}"
  fi
else
  info "Skipping git pull (--skip-pull)"
fi

# ── 2. Build image ────────────────────────────────────────────
TAG_LATEST="${IMAGE_NAME}:latest"
TAG_SHA="${IMAGE_NAME}:${GIT_SHA}"

step "Building Docker image"
info "Tags: ${TAG_LATEST}, ${TAG_SHA}"

if $DRY_RUN; then
  info "(skipped — dry run)"
else
  BUILD_START=$SECONDS
  docker build \
    $NO_CACHE \
    --label "git.sha=${GIT_SHA}" \
    --label "git.branch=${GIT_BRANCH}" \
    --label "build.time=${BUILD_TIME}" \
    -t "$TAG_LATEST" \
    -t "$TAG_SHA" \
    . 2>&1 | tail -5 | sed 's/^/  /'
  ok "Built in $((SECONDS - BUILD_START))s"
fi

# ── 3. Deploy ─────────────────────────────────────────────────
if $HAS_SSH; then
  # ── SSH path: pipe image + copy env + restart ──────────────
  step "Deploying via SSH → ${NAS_HOST}"

  if $DRY_RUN; then
    info "(skipped — dry run)"
  else
    # Ensure compose directory exists on NAS
    ssh "$NAS_HOST" "mkdir -p '${NAS_COMPOSE_DIR}' 2>/dev/null || sudo mkdir -p '${NAS_COMPOSE_DIR}'"

    # Copy docker-compose.yml
    info "Syncing docker-compose.yml..."
    cat "${SCRIPT_DIR}/docker-compose.yml" | ssh "$NAS_HOST" "cat > '${NAS_COMPOSE_DIR}/docker-compose.yml'"

    # Copy .env.deploy → .env on NAS
    info "Syncing .env.deploy → .env..."
    cat "$DEPLOY_ENV" | ssh "$NAS_HOST" "cat > '${NAS_COMPOSE_DIR}/.env'"
    ok ".env synced"

    # Pipe image directly — no temp file, no SMB
    TRANSFER_START=$SECONDS
    info "Piping image over SSH (this may take a moment)..."
    docker save "$TAG_LATEST" | gzip | ssh "$NAS_HOST" "gunzip | sudo ${DOCKER_BIN} load"
    ok "Image transferred in $((SECONDS - TRANSFER_START))s"

    # Restart container
    info "Restarting container..."
    ssh "$NAS_HOST" "cd '${NAS_COMPOSE_DIR}' && sudo ${DOCKER_BIN} compose up -d --force-recreate"
    ok "Container restarted"

    # Clean up old SHA-tagged images (keeps only :latest)
    info "Pruning old images..."
    ssh "$NAS_HOST" "sudo ${DOCKER_BIN} images '${IMAGE_NAME}' --format '{{.Tag}} {{.ID}}' \
      | grep -v 'latest' \
      | awk '{print \$2}' \
      | xargs -r sudo ${DOCKER_BIN} rmi 2>/dev/null || true"
    ssh "$NAS_HOST" "sudo ${DOCKER_BIN} image prune -f" 2>/dev/null | sed 's/^/  /'
  fi

else
  # ── SMB fallback: export tarball to K: ─────────────────────
  step "Exporting via SMB → ${NAS_SMB_DIR}"

  if $DRY_RUN; then
    info "(skipped — dry run)"
  else
    TARBALL="${IMAGE_NAME}.tar.gz"

    info "Saving image..."
    docker save "$TAG_LATEST" | gzip > "/tmp/${TARBALL}"

    info "Copying to NAS..."
    mkdir -p "${NAS_SMB_DIR}"
    cp "/tmp/${TARBALL}" "${NAS_SMB_DIR}/${TARBALL}"
    cp "${SCRIPT_DIR}/docker-compose.yml" "${NAS_SMB_DIR}/docker-compose.yml"
    cp "$DEPLOY_ENV" "${NAS_SMB_DIR}/.env"
    rm -f "/tmp/${TARBALL}"

    ok "Image exported to ${NAS_SMB_DIR}/${TARBALL}"
    echo ""
    warn "Manual steps required in Synology Container Manager:"
    info "  1. Image → Add → From File → select ${TARBALL}"
    info "  2. Project → lupos → Stop → Start"
  fi
fi

# ── Summary ───────────────────────────────────────────────────
TOTAL=$((SECONDS - DEPLOY_START))
echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  ✅ Deploy complete in ${TOTAL}s${RESET}"
echo -e "${DIM}  ${GIT_BRANCH}@${GIT_SHA} → ${NAS_HOST} (${BUILD_TIME})${RESET}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════${RESET}"
echo ""
