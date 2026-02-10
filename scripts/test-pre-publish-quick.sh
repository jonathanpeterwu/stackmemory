#!/bin/bash
# Quick Pre-Publish Test Suite
# Essential tests that must pass before npm publish
#
# Called by prepublishOnly which already runs: npm run build && npm run verify:dist
# So this script skips the redundant build and focuses on tests + lint + git cleanliness.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[PASS]${NC} $1"; }
log_error() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

echo "============================================"
echo "  StackMemory Quick Pre-Publish Tests"
echo "============================================"
echo

cd "$PROJECT_ROOT"

# Git status check — run FIRST before any command can dirty the tree
log_info "Checking git status..."
if git diff --quiet && git diff --cached --quiet; then
    log_success "Git working directory is clean"
else
    echo
    git diff --name-only
    git diff --cached --name-only
    log_error "Git working directory has uncommitted changes (see above)"
fi

# CLI artifact exists (build already ran in prepublishOnly)
log_info "Checking CLI artifact..."
if [ -f "dist/src/cli/index.js" ]; then
    log_success "CLI artifact exists"
else
    log_error "CLI artifact missing — build may have failed"
fi

# Package structure test
log_info "Testing package structure..."
npm pack --dry-run > /dev/null 2>&1 || log_error "npm pack failed"
log_success "Package structure valid"

# Core tests + search benchmark (100-frame smoke)
log_info "Running tests..."
npx vitest run --reporter=dot --bail=3 2>&1 | tail -5
if [ ${PIPESTATUS[0]} -ne 0 ]; then
    log_error "Tests failed"
fi
log_success "Tests pass (including search benchmark)"

# Lint check
log_info "Testing lint..."
npm run lint > /dev/null 2>&1 || log_error "Lint failed"
log_success "Lint passes"

echo
echo -e "${GREEN}✅ All pre-publish checks passed!${NC}"
echo -e "${GREEN}Ready for npm publish.${NC}"
