#!/bin/bash
# Validate CLAUDE.md configurations - token counts and coverage
set -e

CLAUDE_DIR="$HOME/.claude"
AGENT_DOCS="$CLAUDE_DIR/agent_docs"

echo "=== CLAUDE.md Config Validation ==="
echo ""

# Token estimation function
count_tokens() {
  local file=$1
  if [ -f "$file" ]; then
    local chars=$(wc -c < "$file")
    echo $((chars / 4))  # ~4 chars per token estimate
  else
    echo "0"
  fi
}

# 1. Token Comparison
echo "## Token Counts"
echo ""
printf "%-40s %8s %8s\n" "File" "Lines" "~Tokens"
printf "%-40s %8s %8s\n" "----" "-----" "-------"

total_verbose=0
total_compact=0

for file in "$CLAUDE_DIR"/*.md; do
  [ -f "$file" ] || continue
  name=$(basename "$file")
  lines=$(wc -l < "$file" | tr -d ' ')
  tokens=$(count_tokens "$file")
  printf "%-40s %8s %8s\n" "$name" "$lines" "$tokens"

  if [[ "$name" == *".compact.md" ]]; then
    total_compact=$((total_compact + tokens))
  else
    total_verbose=$((total_verbose + tokens))
  fi
done

echo ""

# 2. Agent Docs Comparison
echo "## Agent Docs"
echo ""
printf "%-40s %8s %8s\n" "File" "Lines" "~Tokens"
printf "%-40s %8s %8s\n" "----" "-----" "-------"

verbose_docs=0
compact_docs=0

for file in "$AGENT_DOCS"/*.md; do
  [ -f "$file" ] || continue
  name=$(basename "$file")
  lines=$(wc -l < "$file" | tr -d ' ')
  tokens=$(count_tokens "$file")
  printf "%-40s %8s %8s\n" "$name" "$lines" "$tokens"

  if [[ "$name" == *".compact.md" ]]; then
    compact_docs=$((compact_docs + tokens))
  else
    verbose_docs=$((verbose_docs + tokens))
  fi
done

echo ""

# 3. Summary
echo "## Summary"
echo ""
echo "Main configs:"
echo "  Verbose total: ~$total_verbose tokens"
echo "  Compact total: ~$total_compact tokens"
if [ $total_verbose -gt 0 ]; then
  savings=$((100 - (total_compact * 100 / total_verbose)))
  echo "  Savings: ${savings}%"
fi

echo ""
echo "Agent docs:"
echo "  Verbose total: ~$verbose_docs tokens"
echo "  Compact total: ~$compact_docs tokens"
if [ $verbose_docs -gt 0 ]; then
  savings=$((100 - (compact_docs * 100 / verbose_docs)))
  echo "  Savings: ${savings}%"
fi

echo ""

# 4. Reference Validation
echo "## Reference Validation"
echo ""

# Check CLAUDE.md references
if [ -f "$CLAUDE_DIR/CLAUDE.md" ]; then
  echo "Checking CLAUDE.md references..."
  refs=$(grep -oE '[A-Z_]+\.compact\.md' "$CLAUDE_DIR/CLAUDE.md" 2>/dev/null || true)

  missing=0
  for ref in $refs; do
    if [ -f "$AGENT_DOCS/$ref" ]; then
      echo "  [OK] $ref"
    else
      echo "  [MISSING] $ref"
      missing=$((missing + 1))
    fi
  done

  if [ $missing -eq 0 ] && [ -n "$refs" ]; then
    echo "  All references valid"
  elif [ -z "$refs" ]; then
    echo "  No compact doc references found"
  else
    echo "  WARNING: $missing missing references"
  fi
else
  echo "  CLAUDE.md not found"
fi

echo ""

# 5. Key Rules Coverage
echo "## Key Rules Coverage"
echo ""

check_rule() {
  local name=$1
  local pattern=$2
  local file=$3

  if grep -qiE "$pattern" "$file" 2>/dev/null; then
    echo "  [OK] $name"
  else
    echo "  [MISSING] $name"
  fi
}

echo "CLAUDE.md rules:"
if [ -f "$CLAUDE_DIR/CLAUDE.md" ]; then
  check_rule "Security/secrets" "secret|credential|api.?key" "$CLAUDE_DIR/CLAUDE.md"
  check_rule "ESM imports" "\.js|ESM|extension" "$CLAUDE_DIR/CLAUDE.md"
  check_rule "Validation" "lint|test|build" "$CLAUDE_DIR/CLAUDE.md"
  check_rule "Git workflow" "commit|branch|push" "$CLAUDE_DIR/CLAUDE.md"
  check_rule "Error handling" "error|throw|undefined" "$CLAUDE_DIR/CLAUDE.md"
  check_rule "Thinking modes" "think|ultra" "$CLAUDE_DIR/CLAUDE.md"
  check_rule "Coverage" "coverage|untested" "$CLAUDE_DIR/CLAUDE.md"
  check_rule "Branch naming" "feature/|fix/|chore/" "$CLAUDE_DIR/CLAUDE.md"
fi

echo ""
echo "=== Validation Complete ==="
