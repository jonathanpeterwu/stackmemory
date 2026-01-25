#!/bin/bash
# Install SMS notification hook for Claude Code (optional)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SOURCE="$SCRIPT_DIR/../templates/claude-hooks/notify-review-hook.js"
CLAUDE_DIR="$HOME/.claude"
HOOKS_DIR="$CLAUDE_DIR/hooks"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"

echo "Installing SMS notification hook for Claude Code..."
echo "(Optional feature - requires Twilio setup)"
echo ""

# Create directories
mkdir -p "$HOOKS_DIR"

# Copy hook script
HOOK_DEST="$HOOKS_DIR/notify-review-hook.js"
cp "$HOOK_SOURCE" "$HOOK_DEST"
chmod +x "$HOOK_DEST"
echo "Installed hook to $HOOK_DEST"

# Update Claude Code settings
if [ -f "$SETTINGS_FILE" ]; then
  if command -v jq &> /dev/null; then
    cp "$SETTINGS_FILE" "$SETTINGS_FILE.bak"

    HOOK_CMD="node $HOOK_DEST"

    # Add to post_tool_use hooks
    if jq -e '.hooks.post_tool_use' "$SETTINGS_FILE" > /dev/null 2>&1; then
      if ! jq -e ".hooks.post_tool_use | index(\"$HOOK_CMD\")" "$SETTINGS_FILE" > /dev/null 2>&1; then
        jq ".hooks.post_tool_use += [\"$HOOK_CMD\"]" "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp"
        mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
        echo "Added hook to post_tool_use array"
      else
        echo "Hook already configured"
      fi
    else
      jq ".hooks = (.hooks // {}) | .hooks.post_tool_use = [\"$HOOK_CMD\"]" "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp"
      mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
      echo "Created hooks.post_tool_use with notify hook"
    fi
  else
    echo ""
    echo "jq not found. Please manually add to $SETTINGS_FILE:"
    echo ""
    echo '  "hooks": {'
    echo '    "post_tool_use": ["node '$HOOK_DEST'"]'
    echo '  }'
  fi
else
  cat > "$SETTINGS_FILE" << EOF
{
  "hooks": {
    "post_tool_use": ["node $HOOK_DEST"]
  }
}
EOF
  echo "Created settings file with hook"
fi

echo ""
echo "Notification hook installed!"
echo ""
echo "To enable SMS notifications:"
echo "  1. Set Twilio environment variables:"
echo "     export TWILIO_ACCOUNT_SID=your_sid"
echo "     export TWILIO_AUTH_TOKEN=your_token"
echo "     export TWILIO_FROM_NUMBER=+1234567890"
echo "     export TWILIO_TO_NUMBER=+1234567890"
echo ""
echo "  2. Enable notifications:"
echo "     stackmemory notify enable"
echo ""
echo "  3. Test:"
echo "     stackmemory notify test"
echo ""
echo "Notifications will be sent when:"
echo "  - PR is created (gh pr create)"
echo "  - Package is published (npm publish)"
echo "  - Deployment completes"
