#!/bin/bash
# Install auto-background hook for Claude Code

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SOURCE="$SCRIPT_DIR/../templates/claude-hooks/auto-background-hook.js"
CLAUDE_DIR="$HOME/.claude"
HOOKS_DIR="$CLAUDE_DIR/hooks"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
CONFIG_DIR="$HOME/.stackmemory"

echo "Installing auto-background hook for Claude Code..."

# Create directories
mkdir -p "$HOOKS_DIR"
mkdir -p "$CONFIG_DIR"

# Copy hook script
HOOK_DEST="$HOOKS_DIR/auto-background-hook.js"
cp "$HOOK_SOURCE" "$HOOK_DEST"
chmod +x "$HOOK_DEST"
echo "Installed hook to $HOOK_DEST"

# Create default config if not exists
CONFIG_FILE="$CONFIG_DIR/auto-background.json"
if [ ! -f "$CONFIG_FILE" ]; then
  cat > "$CONFIG_FILE" << 'EOF'
{
  "enabled": true,
  "timeoutMs": 5000,
  "alwaysBackground": [
    "npm install",
    "npm ci",
    "yarn install",
    "pnpm install",
    "bun install",
    "npm run build",
    "yarn build",
    "pnpm build",
    "cargo build",
    "go build",
    "make",
    "npm test",
    "npm run test",
    "yarn test",
    "pytest",
    "jest",
    "vitest",
    "cargo test",
    "docker build",
    "docker-compose up",
    "docker compose up",
    "git clone",
    "git fetch --all",
    "npx tsc",
    "tsc --noEmit",
    "eslint .",
    "npm run lint"
  ],
  "neverBackground": [
    "vim",
    "nvim",
    "nano",
    "less",
    "more",
    "top",
    "htop",
    "echo",
    "cat",
    "ls",
    "pwd",
    "cd",
    "which",
    "git status",
    "git diff",
    "git log"
  ],
  "verbose": false
}
EOF
  echo "Created config at $CONFIG_FILE"
fi

# Update Claude Code settings
if [ -f "$SETTINGS_FILE" ]; then
  # Check if jq is available
  if command -v jq &> /dev/null; then
    # Backup existing settings
    cp "$SETTINGS_FILE" "$SETTINGS_FILE.bak"

    # Add hook to settings
    HOOK_CMD="node $HOOK_DEST"

    # Check if hooks.pre_tool_use exists
    if jq -e '.hooks.pre_tool_use' "$SETTINGS_FILE" > /dev/null 2>&1; then
      # Check if hook already added
      if ! jq -e ".hooks.pre_tool_use | index(\"$HOOK_CMD\")" "$SETTINGS_FILE" > /dev/null 2>&1; then
        jq ".hooks.pre_tool_use += [\"$HOOK_CMD\"]" "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp"
        mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
        echo "Added hook to existing pre_tool_use array"
      else
        echo "Hook already configured"
      fi
    else
      # Create hooks.pre_tool_use array
      jq ".hooks = (.hooks // {}) | .hooks.pre_tool_use = [\"$HOOK_CMD\"]" "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp"
      mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
      echo "Created hooks.pre_tool_use with auto-background hook"
    fi
  else
    echo ""
    echo "jq not found. Please manually add to $SETTINGS_FILE:"
    echo ""
    echo '  "hooks": {'
    echo '    "pre_tool_use": ["node '$HOOK_DEST'"]'
    echo '  }'
  fi
else
  # Create new settings file
  cat > "$SETTINGS_FILE" << EOF
{
  "hooks": {
    "pre_tool_use": ["node $HOOK_DEST"]
  }
}
EOF
  echo "Created settings file with hook"
fi

echo ""
echo "Auto-background hook installed!"
echo ""
echo "Configuration: $CONFIG_FILE"
echo "  - Edit to customize which commands auto-background"
echo "  - Set 'enabled': false to disable"
echo "  - Set 'verbose': true for debug logging"
echo ""
echo "Commands that will auto-background:"
echo "  - npm install/build/test"
echo "  - yarn/pnpm/bun install"
echo "  - docker build"
echo "  - cargo/go build/test"
echo "  - And more (see config)"
