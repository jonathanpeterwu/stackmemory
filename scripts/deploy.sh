#!/bin/bash
# StackMemory Deploy Script — NPM + Railway
#
# Usage:
#   ./scripts/deploy.sh [target] [version-type]
#
# Targets:
#   npm       — Publish to NPM only (default)
#   railway   — Deploy to Railway only
#   all       — NPM publish + Railway deploy
#
# Version types (npm target only):
#   patch     — Bump patch version (default)
#   minor     — Bump minor version
#   major     — Bump major version
#   x.y.z     — Set explicit version
#
# Examples:
#   ./scripts/deploy.sh                  # NPM patch release
#   ./scripts/deploy.sh npm minor        # NPM minor release
#   ./scripts/deploy.sh railway          # Railway deploy only
#   ./scripts/deploy.sh all minor        # NPM minor + Railway
#
# Environment:
#   DRY_RUN=true   — Skip destructive steps (push, publish, deploy)
#   SKIP_TESTS=true — Skip quality checks (NOT recommended)

set -e

# ── Color codes ──────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Configuration ────────────────────────────────
TARGET=${1:-npm}
VERSION_TYPE=${2:-patch}
DRY_RUN=${DRY_RUN:-false}
SKIP_TESTS=${SKIP_TESTS:-false}
RAILWAY_SERVICE=${RAILWAY_SERVICE:-stackmemory}

# ── Helpers ──────────────────────────────────────
info()  { echo -e "${CYAN}[info]${NC}  $1"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $1"; }
fail()  { echo -e "${RED}[fail]${NC}  $1"; exit 1; }

prompt_yn() {
  local msg="$1"
  read -p "$(echo -e "${YELLOW}${msg} [y/N]:${NC} ")" answer
  [[ "$answer" =~ ^[Yy]$ ]]
}

# ── Validate target ─────────────────────────────
case "$TARGET" in
  npm|railway|all) ;;
  *)
    echo "Usage: $0 [npm|railway|all] [patch|minor|major|x.y.z]"
    echo ""
    echo "Options:"
    echo "  1) npm      — Publish to NPM (default)"
    echo "  2) railway  — Deploy to Railway"
    echo "  3) all      — Both NPM + Railway"
    exit 1
    ;;
esac

echo ""
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}  StackMemory Deploy${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
info "Target:  $TARGET"
info "Version: $VERSION_TYPE"
info "Dry run: $DRY_RUN"
echo ""

# ── Pre-flight checks ───────────────────────────

# 1. Must be on main
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  fail "Must be on main branch (currently: $CURRENT_BRANCH)"
fi
ok "On main branch"

# 2. Clean working tree
if [ -n "$(git status --porcelain)" ]; then
  fail "Uncommitted changes detected. Commit or stash first."
fi
ok "Working tree clean"

# 3. Pull latest
info "Pulling latest from origin/main..."
git pull origin main --rebase
ok "Up to date with origin/main"

# ── Quality checks ───────────────────────────────
if [ "$SKIP_TESTS" = "true" ]; then
  warn "Skipping quality checks (SKIP_TESTS=true)"
else
  info "Running lint..."
  npm run lint
  ok "Lint passed"

  info "Running tests..."
  npm run test:run
  ok "Tests passed"

  info "Building..."
  npm run build
  ok "Build passed"
fi

# ══════════════════════════════════════════════════
# NPM PUBLISH
# ══════════════════════════════════════════════════
deploy_npm() {
  echo ""
  echo -e "${GREEN}── NPM Publish ────────────────────${NC}"

  # Bump version
  info "Bumping version ($VERSION_TYPE)..."
  if [ "$VERSION_TYPE" = "patch" ] || [ "$VERSION_TYPE" = "minor" ] || [ "$VERSION_TYPE" = "major" ]; then
    NEW_VERSION=$(npm version $VERSION_TYPE --no-git-tag-version)
  else
    NEW_VERSION="v$VERSION_TYPE"
    npm version "$VERSION_TYPE" --no-git-tag-version
  fi
  ok "Version: $NEW_VERSION"

  # Update CLI version constant
  info "Updating CLI version constant..."
  sed -i.bak "s/const VERSION = '[^']*'/const VERSION = '${NEW_VERSION#v}'/" src/cli/index.ts
  rm -f src/cli/index.ts.bak
  ok "CLI version updated"

  # Rebuild with new version
  info "Rebuilding with $NEW_VERSION..."
  npm run build
  ok "Build complete"

  if [ "$DRY_RUN" = "true" ]; then
    warn "DRY RUN — skipping commit, tag, push, publish"
    return
  fi

  # Commit + tag + push
  info "Committing version bump..."
  git add package.json package-lock.json src/cli/index.ts
  git commit -m "chore: bump version to ${NEW_VERSION}

- Bump version to ${NEW_VERSION}
- Update CLI version constant"

  info "Creating tag $NEW_VERSION..."
  git tag "$NEW_VERSION"

  info "Pushing to origin..."
  git push origin main
  git push origin "$NEW_VERSION"

  ok "Pushed $NEW_VERSION to GitHub"
  echo ""
  info "GitHub Actions will auto-publish to NPM on tag push."
  info "Monitor: https://github.com/stackmemoryai/stackmemory/actions"
  echo ""
  echo "Manual publish (if Actions not configured):"
  echo "  npm publish --access public"
  echo ""
  ok "NPM deploy complete"
}

# ══════════════════════════════════════════════════
# RAILWAY DEPLOY
# ══════════════════════════════════════════════════
deploy_railway() {
  echo ""
  echo -e "${GREEN}── Railway Deploy ─────────────────${NC}"

  # Check Railway CLI
  if ! command -v railway &> /dev/null; then
    fail "Railway CLI not installed. Run: npm i -g @railway/cli"
  fi
  ok "Railway CLI found"

  # Check Railway auth
  if ! railway whoami &> /dev/null 2>&1; then
    fail "Not logged in to Railway. Run: railway login"
  fi
  RAILWAY_USER=$(railway whoami 2>/dev/null || echo "unknown")
  ok "Logged in as: $RAILWAY_USER"

  # Check Railway project link
  if ! railway status &> /dev/null 2>&1; then
    warn "No Railway project linked."
    echo ""
    echo "Options:"
    echo "  1) railway link    — Link existing project"
    echo "  2) railway init    — Create new project"
    echo ""
    fail "Link a Railway project first, then re-run."
  fi
  ok "Railway project linked"

  # Confirm
  echo ""
  info "Deploying to Railway..."
  if [ "$DRY_RUN" = "true" ]; then
    warn "DRY RUN — skipping railway up"
    return
  fi

  if ! prompt_yn "Deploy to Railway production?"; then
    info "Aborted."
    return
  fi

  # Deploy
  railway up --detach
  ok "Railway deploy initiated"

  echo ""
  info "Monitor deployment in Railway dashboard."
  echo ""

  # Post-deploy health check
  RAILWAY_URL=${RAILWAY_URL:-""}
  if [ -n "$RAILWAY_URL" ]; then
    info "Running health check against $RAILWAY_URL..."
    sleep 10
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$RAILWAY_URL/health" || echo "000")
    if [ "$HTTP_STATUS" = "200" ]; then
      ok "Health check passed (HTTP 200)"
    else
      warn "Health check returned HTTP $HTTP_STATUS — check logs"
    fi
  else
    info "Set RAILWAY_URL to enable post-deploy health check."
  fi

  ok "Railway deploy complete"
}

# ── Execute ──────────────────────────────────────
case "$TARGET" in
  npm)
    deploy_npm
    ;;
  railway)
    deploy_railway
    ;;
  all)
    deploy_npm
    deploy_railway
    ;;
esac

# ── Summary ──────────────────────────────────────
echo ""
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}  Deploy complete${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
echo "Next steps:"
echo "  1) Verify NPM:     npm info @stackmemoryai/stackmemory"
echo "  2) Verify Railway:  curl \$RAILWAY_URL/health"
echo "  3) Test install:    npm i -g @stackmemoryai/stackmemory@latest"
echo "  4) Update CHANGELOG.md if not auto-generated"
echo ""
