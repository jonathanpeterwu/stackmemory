#!/bin/bash

echo "🧪 Testing ChromaDB Hooks"
echo "========================"
echo ""

# Test save hook
echo "1. Testing save hook..."
echo "Test content" | $HOME/.claude/hooks/on-save
sleep 1

# Test query hook
echo "2. Testing query hook..."
echo "test query" | $HOME/.claude/hooks/on-query
sleep 1

# Test checkpoint hook
echo "3. Testing checkpoint hook..."
$HOME/.claude/hooks/on-checkpoint
sleep 1

# Check logs
echo ""
echo "📄 Recent hook activity:"
tail -10 "$HOME/.stackmemory/logs/chromadb-hook.log" 2>/dev/null || echo "No logs yet"

echo ""
echo "✅ Hook test complete"
