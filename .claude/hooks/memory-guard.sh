#!/bin/bash
# Memory Guard Hook
# Checks for memory-clear signal file written by the daemon memory service.
# Registered as a UserPromptSubmit hook in ~/.claude/hooks.json.

SIGNAL_FILE="${PROJECT_ROOT:-.}/.stackmemory/.memory-clear-signal"

if [ -f "$SIGNAL_FILE" ]; then
  REASON=$(grep -o '"reason" *: *"[^"]*"' "$SIGNAL_FILE" | head -1 | sed 's/"reason" *: *"//;s/"$//')
  RAM=$(grep -o '"ramPercent" *: *[0-9]*' "$SIGNAL_FILE" | head -1 | sed 's/"ramPercent" *: *//')
  rm -f "$SIGNAL_FILE"
  echo "MEMORY CRITICAL: ${REASON:-RAM/heap exceeded threshold}. Context has been captured."
  echo "RAM: ${RAM:-?}% | Run /clear now, then stackmemory restore to continue."
fi
