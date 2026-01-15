#!/bin/bash

# Setup script for StackMemory Background Sync
# Configures automatic background syncing via cron or launchd

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🚀 StackMemory Background Sync Setup"
echo "===================================="
echo ""

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
    echo "✅ Detected macOS - will use launchd"
else
    OS="linux"
    echo "✅ Detected Linux - will use cron"
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not installed"
    exit 1
fi

echo ""
echo "📋 Available sync tasks:"
echo "  1. Linear task sync (hourly)"
echo "  2. Context & frame sync (15 min)"
echo "  3. Cloud backup (4 hours)"
echo "  4. Redis cache sync (5 min)"
echo "  5. Cross-session sync (10 min)"
echo ""

if [ "$OS" == "macos" ]; then
    # macOS - Create launchd plist
    PLIST_FILE="$HOME/Library/LaunchAgents/com.stackmemory.sync.plist"
    
    echo "Creating launchd service..."
    
    cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.stackmemory.sync</string>
    
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>$PROJECT_DIR/scripts/background-sync-manager.js</string>
    </array>
    
    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>
    
    <key>RunAtLoad</key>
    <true/>
    
    <key>KeepAlive</key>
    <true/>
    
    <key>StandardOutPath</key>
    <string>$HOME/.stackmemory/sync-output.log</string>
    
    <key>StandardErrorPath</key>
    <string>$HOME/.stackmemory/sync-error.log</string>
    
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
</dict>
</plist>
EOF
    
    echo "✅ Launchd service created"
    echo ""
    echo "To start the service now:"
    echo "  launchctl load $PLIST_FILE"
    echo ""
    echo "To stop the service:"
    echo "  launchctl unload $PLIST_FILE"
    echo ""
    echo "The service will start automatically on login."
    
else
    # Linux - Create cron jobs
    echo "Setting up cron jobs..."
    
    # Create cron entries
    CRON_ENTRIES=""
    
    # Linear sync - every hour
    CRON_ENTRIES="$CRON_ENTRIES
0 * * * * cd $PROJECT_DIR && /usr/bin/node scripts/sync-linear-graphql.js >> $HOME/.stackmemory/linear-sync.log 2>&1"
    
    # Context sync - every 15 minutes
    CRON_ENTRIES="$CRON_ENTRIES
*/15 * * * * cd $PROJECT_DIR && /usr/bin/node scripts/sync-context.js >> $HOME/.stackmemory/context-sync.log 2>&1"
    
    # Backup - every 4 hours
    CRON_ENTRIES="$CRON_ENTRIES
0 */4 * * * cd $PROJECT_DIR && /usr/bin/node scripts/backup-stackmemory.js >> $HOME/.stackmemory/backup.log 2>&1"
    
    # Add to crontab
    (crontab -l 2>/dev/null | grep -v "stackmemory"; echo "$CRON_ENTRIES") | crontab -
    
    echo "✅ Cron jobs created"
    echo ""
    echo "Current cron jobs:"
    crontab -l | grep stackmemory
fi

# Create convenience scripts
cat > "$PROJECT_DIR/sync-status.sh" << 'EOF'
#!/bin/bash
if [[ "$OSTYPE" == "darwin"* ]]; then
    launchctl list | grep stackmemory
else
    ps aux | grep -E "background-sync-manager|sync-linear" | grep -v grep
fi
EOF
chmod +x "$PROJECT_DIR/sync-status.sh"

cat > "$PROJECT_DIR/sync-logs.sh" << 'EOF'
#!/bin/bash
LOG_DIR="$HOME/.stackmemory"
echo "📄 Recent sync activity:"
echo ""
if [ -f "$LOG_DIR/sync-manager.log" ]; then
    tail -20 "$LOG_DIR/sync-manager.log"
fi
EOF
chmod +x "$PROJECT_DIR/sync-logs.sh"

echo ""
echo "✅ Setup complete!"
echo ""
echo "📌 Useful commands:"
echo "  ./sync-status.sh  - Check sync status"
echo "  ./sync-logs.sh    - View sync logs"
echo ""
echo "🔑 Environment variables to set in .env:"
echo "  LINEAR_API_KEY    - For Linear sync"
echo "  REDIS_URL         - For Redis cache (optional)"
echo "  AWS_S3_BUCKET     - For S3 backup (optional)"
echo "  GCS_BUCKET        - For GCS backup (optional)"
echo ""

# Ask to start now
read -p "Start background sync now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if [ "$OS" == "macos" ]; then
        launchctl load "$HOME/Library/LaunchAgents/com.stackmemory.sync.plist"
        echo "✅ Background sync started!"
    else
        nohup node "$PROJECT_DIR/scripts/background-sync-manager.js" > "$HOME/.stackmemory/sync-manager.log" 2>&1 &
        echo "✅ Background sync started! PID: $!"
    fi
fi