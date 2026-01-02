#!/bin/bash
# Automated NPM Deployment Script
# Usage: ./scripts/deploy.sh [patch|minor|major|version]

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
VERSION_TYPE=${1:-patch}
DRY_RUN=${DRY_RUN:-false}

echo -e "${GREEN}🚀 Starting deployment process...${NC}"

# Check if we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo -e "${RED}❌ You must be on main branch to deploy${NC}"
    echo "Current branch: $CURRENT_BRANCH"
    exit 1
fi

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${RED}❌ You have uncommitted changes${NC}"
    git status --short
    exit 1
fi

# Pull latest changes
echo -e "${YELLOW}📥 Pulling latest changes...${NC}"
git pull origin main

# Run quality checks
echo -e "${YELLOW}🧪 Running quality checks...${NC}"
npm run lint
npm run test:run
npm run build

# Bump version
echo -e "${YELLOW}📦 Bumping version (${VERSION_TYPE})...${NC}"
if [ "$VERSION_TYPE" = "patch" ] || [ "$VERSION_TYPE" = "minor" ] || [ "$VERSION_TYPE" = "major" ]; then
    NEW_VERSION=$(npm version $VERSION_TYPE --no-git-tag-version)
else
    NEW_VERSION=$VERSION_TYPE
    npm version $VERSION_TYPE --no-git-tag-version
fi

# Update CLI version constant
echo -e "${YELLOW}✏️  Updating CLI version...${NC}"
sed -i.bak "s/const VERSION = '[^']*'/const VERSION = '${NEW_VERSION#v}'/" src/cli/index.ts
rm src/cli/index.ts.bak

# Build with new version
echo -e "${YELLOW}🔨 Building with new version...${NC}"
npm run build

# Commit version changes
echo -e "${YELLOW}📝 Committing version changes...${NC}"
git add -A
git commit -m "chore: Release ${NEW_VERSION}

- Bump version to ${NEW_VERSION}
- Update CLI version constant
- Update package-lock.json"

# Create and push tag
echo -e "${YELLOW}🏷️  Creating tag...${NC}"
git tag ${NEW_VERSION}

# Push changes and tag
echo -e "${YELLOW}📤 Pushing to GitHub...${NC}"
git push origin main
git push origin ${NEW_VERSION}

echo -e "${GREEN}✅ Deployment preparation complete!${NC}"
echo -e "${GREEN}📦 Version ${NEW_VERSION} has been tagged and pushed${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. GitHub Actions will automatically publish to NPM"
echo "2. Monitor the Actions tab for progress"
echo "3. Or manually publish with: npm publish"
echo ""
echo -e "${GREEN}GitHub Actions URL:${NC}"
echo "https://github.com/stackmemoryai/stackmemory/actions"