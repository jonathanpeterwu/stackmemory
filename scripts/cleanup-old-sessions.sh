#!/bin/bash

# StackMemory Session Cleanup Script

echo "🧹 StackMemory Session Cleanup"
echo "=============================="

SESSIONS_DIR="$HOME/.stackmemory/sessions"
DAYS_TO_KEEP=7

# Count current sessions
TOTAL_SESSIONS=$(find "$SESSIONS_DIR" -type f -name "*.json" | wc -l | tr -d ' ')
echo "📊 Total sessions: $TOTAL_SESSIONS"

# Count old sessions
OLD_SESSIONS=$(find "$SESSIONS_DIR" -type f -name "*.json" -mtime +$DAYS_TO_KEEP | wc -l | tr -d ' ')
echo "🗓️  Sessions older than $DAYS_TO_KEEP days: $OLD_SESSIONS"

if [ "$OLD_SESSIONS" -eq 0 ]; then
    echo "✨ No old sessions to clean up!"
    exit 0
fi

# Calculate space used
SPACE_BEFORE=$(du -sh "$SESSIONS_DIR" | cut -f1)
echo "💾 Current space used: $SPACE_BEFORE"

# Ask for confirmation
read -p "⚠️  Remove $OLD_SESSIONS sessions older than $DAYS_TO_KEEP days? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Create backup directory
    BACKUP_DIR="$HOME/.stackmemory/session-backups/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    
    echo "📦 Creating backup in $BACKUP_DIR..."
    
    # Move old sessions to backup (sample a few for backup)
    find "$SESSIONS_DIR" -type f -name "*.json" -mtime +$DAYS_TO_KEEP -print0 | \
        head -z -n 100 | \
        xargs -0 -I {} cp {} "$BACKUP_DIR/" 2>/dev/null
    
    # Remove old sessions
    find "$SESSIONS_DIR" -type f -name "*.json" -mtime +$DAYS_TO_KEEP -delete
    
    # Count remaining sessions
    REMAINING=$(find "$SESSIONS_DIR" -type f -name "*.json" | wc -l | tr -d ' ')
    SPACE_AFTER=$(du -sh "$SESSIONS_DIR" | cut -f1)
    
    echo "✅ Cleanup complete!"
    echo "📊 Sessions removed: $((TOTAL_SESSIONS - REMAINING))"
    echo "📊 Sessions remaining: $REMAINING"
    echo "💾 Space after cleanup: $SPACE_AFTER"
    echo "📦 Sample backup saved to: $BACKUP_DIR"
else
    echo "❌ Cleanup cancelled"
fi