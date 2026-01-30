#!/bin/bash
# Test CLAUDE.md format effectiveness
# Compares compact vs verbose configurations

set -e

CLAUDE_DIR="$HOME/.claude"
VERBOSE_FILE="$CLAUDE_DIR/CLAUDE.md"
COMPACT_FILE="$CLAUDE_DIR/CLAUDE.compact.md"
BACKUP_FILE="$CLAUDE_DIR/CLAUDE.backup.md"
RESULTS_DIR="/tmp/claude-config-test-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$RESULTS_DIR"

echo "=== CLAUDE.md A/B Test ==="
echo "Results: $RESULTS_DIR"
echo ""

# Test prompts that exercise CLAUDE.md rules
declare -a TEST_PROMPTS=(
  "What's your communication style preference?"
  "I want to add a feature. Should you ask clarifying questions or just start coding?"
  "Write a function to hash a password"
  "What should you do before editing a file?"
  "How do you handle ESM imports in TypeScript?"
)

# Token counts
VERBOSE_TOKENS=$(cat "$VERBOSE_FILE" 2>/dev/null | wc -c | awk '{print int($1/3.5)}')
COMPACT_TOKENS=$(cat "$COMPACT_FILE" 2>/dev/null | wc -c | awk '{print int($1/3.5)}')

echo "Token comparison:"
echo "  Verbose: ~$VERBOSE_TOKENS tokens"
echo "  Compact: ~$COMPACT_TOKENS tokens"
echo "  Savings: ~$((VERBOSE_TOKENS - COMPACT_TOKENS)) tokens ($(( (VERBOSE_TOKENS - COMPACT_TOKENS) * 100 / VERBOSE_TOKENS ))%)"
echo ""

# Backup current config
cp "$VERBOSE_FILE" "$BACKUP_FILE"

run_test() {
  local config_name=$1
  local config_file=$2
  local output_dir="$RESULTS_DIR/$config_name"
  mkdir -p "$output_dir"

  echo "Testing with $config_name config..."

  # Swap config
  cp "$config_file" "$VERBOSE_FILE"

  local i=0
  for prompt in "${TEST_PROMPTS[@]}"; do
    i=$((i + 1))
    echo "  Prompt $i: ${prompt:0:40}..."

    # Run claude with prompt, capture output
    # Using --print flag for non-interactive mode
    timeout 30 claude --print "$prompt" > "$output_dir/prompt_$i.txt" 2>&1 || true

    # Brief pause to avoid rate limiting
    sleep 1
  done

  echo "  Done. Outputs in $output_dir/"
}

# Test verbose config
if [ -f "$VERBOSE_FILE" ]; then
  # Save original verbose as .verbose for testing
  cp "$VERBOSE_FILE" "$CLAUDE_DIR/CLAUDE.verbose.md"
  run_test "verbose" "$CLAUDE_DIR/CLAUDE.verbose.md"
fi

# Test compact config
if [ -f "$COMPACT_FILE" ]; then
  run_test "compact" "$COMPACT_FILE"
fi

# Restore original config
cp "$BACKUP_FILE" "$VERBOSE_FILE"
rm -f "$BACKUP_FILE"

echo ""
echo "=== Analysis ==="

# Compare output lengths (proxy for verbosity)
echo "Output lengths (chars):"
echo "  Verbose config:"
for f in "$RESULTS_DIR/verbose"/prompt_*.txt; do
  [ -f "$f" ] && echo "    $(basename $f): $(wc -c < "$f")"
done

echo "  Compact config:"
for f in "$RESULTS_DIR/compact"/prompt_*.txt; do
  [ -f "$f" ] && echo "    $(basename $f): $(wc -c < "$f")"
done

# Check for key behaviors
echo ""
echo "Behavior checks:"

check_behavior() {
  local name=$1
  local pattern=$2
  local verbose_match=$(grep -l "$pattern" "$RESULTS_DIR/verbose"/*.txt 2>/dev/null | wc -l)
  local compact_match=$(grep -l "$pattern" "$RESULTS_DIR/compact"/*.txt 2>/dev/null | wc -l)
  echo "  $name: verbose=$verbose_match compact=$compact_match"
}

check_behavior "Concise style" "concise\|brief\|short"
check_behavior "Security mention" "security\|validate\|hash"
check_behavior "ESM/extension" "\.js\|extension\|ESM"
check_behavior "Read before edit" "read\|before\|first"

echo ""
echo "=== Summary ==="
echo "Config files preserved. Review outputs in:"
echo "  $RESULTS_DIR/verbose/"
echo "  $RESULTS_DIR/compact/"
echo ""
echo "To manually compare:"
echo "  diff $RESULTS_DIR/verbose/prompt_1.txt $RESULTS_DIR/compact/prompt_1.txt"
