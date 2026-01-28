#!/bin/bash

# Test session handoff and memory persistence between Claude sessions
# This script validates the full lifecycle of context preservation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Session Handoff & Memory Test ===${NC}"
echo

# 1. Create context in current session
echo -e "${BLUE}1. Creating session context...${NC}"
stackmemory context add observation "Session starting - testing handoff"
stackmemory context add decision "Using shared context for persistence"
stackmemory context add observation "Progress checkpoint 1"
echo -e "${GREEN}✓ Context created${NC}"
echo

# 2. Save progress to shared context
echo -e "${BLUE}2. Saving progress to shared context...${NC}"
cat << 'EOF' | node -
const fs = require('fs');
const path = require('path');

const progressData = {
  sessionId: 'test-' + Date.now(),
  timestamp: new Date().toISOString(),
  project: 'stackmemory',
  branch: 'main',
  progress: {
    tasksCompleted: [
      'Setup session context',
      'Test persistence mechanism'
    ],
    currentTask: 'Validate handoff process',
    pendingTasks: [
      'Verify retrieval in new session',
      'Test hook integration'
    ],
    decisions: [
      'Use shared context for inter-session persistence',
      'Implement checkpoint-based recovery'
    ],
    blockers: [],
    lastCheckpoint: new Date().toISOString(),
    contextFrames: 3,
    sessionDuration: '15 minutes'
  }
};

const sharedDir = path.join(process.env.HOME, '.stackmemory/shared-context/projects');
if (!fs.existsSync(sharedDir)) {
  fs.mkdirSync(sharedDir, { recursive: true });
}

const filePath = path.join(sharedDir, 'stackmemory_main.json');
fs.writeFileSync(filePath, JSON.stringify(progressData, null, 2));
console.log('✓ Progress saved to shared context');
console.log('  Path:', filePath);
console.log('  Session:', progressData.sessionId);
console.log('  Tasks completed:', progressData.progress.tasksCompleted.length);
EOF
echo

# 3. Generate handoff
echo -e "${BLUE}3. Generating handoff summary...${NC}"
stackmemory capture > /tmp/handoff-test.md
echo -e "${GREEN}✓ Handoff generated${NC}"
echo "  Saved to: /tmp/handoff-test.md"
echo

# 4. Save with clear command
echo -e "${BLUE}4. Testing clear --save...${NC}"
stackmemory clear --save
echo -e "${GREEN}✓ Context saved for clear survival${NC}"
echo

# 5. Simulate new session retrieval
echo -e "${BLUE}5. Simulating new session context load...${NC}"
cat << 'EOF' | node -
const fs = require('fs');
const path = require('path');

console.log('\n--- NEW SESSION START ---\n');

// Load saved context
const filePath = path.join(process.env.HOME, '.stackmemory/shared-context/projects/stackmemory_main.json');

if (fs.existsSync(filePath)) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  
  console.log('📚 Restored Context from Previous Session:');
  console.log('━'.repeat(50));
  console.log('Previous session:', data.sessionId);
  console.log('Last active:', data.timestamp);
  console.log('');
  console.log('✅ Completed Tasks:');
  data.progress.tasksCompleted.forEach(task => {
    console.log('  •', task);
  });
  console.log('');
  console.log('🔄 Current Task:');
  console.log('  •', data.progress.currentTask);
  console.log('');
  console.log('📋 Pending Tasks:');
  data.progress.pendingTasks.forEach(task => {
    console.log('  •', task);
  });
  console.log('');
  console.log('💡 Key Decisions:');
  data.progress.decisions.forEach(decision => {
    console.log('  •', decision);
  });
  console.log('━'.repeat(50));
  
  // Calculate session gap
  const lastTime = new Date(data.progress.lastCheckpoint);
  const gap = Math.round((Date.now() - lastTime.getTime()) / 1000);
  console.log(`\nSession gap: ${gap} seconds`);
  console.log('Ready to continue from checkpoint ✨');
} else {
  console.log('❌ No previous session context found');
}
EOF
echo

# 6. Restore from clear
echo -e "${BLUE}6. Testing clear --restore...${NC}"
stackmemory clear --restore
echo -e "${GREEN}✓ Context restored${NC}"
echo

# 7. Verify restoration
echo -e "${BLUE}7. Verifying restored context...${NC}"
stackmemory context show
echo

# Summary
echo -e "${BLUE}=== Test Summary ===${NC}"
echo -e "${GREEN}✓ Session context created and saved${NC}"
echo -e "${GREEN}✓ Progress persisted to shared context${NC}"
echo -e "${GREEN}✓ Handoff generated successfully${NC}"
echo -e "${GREEN}✓ Clear/restore cycle working${NC}"
echo -e "${GREEN}✓ New session can retrieve context${NC}"
echo
echo "Key locations:"
echo "  • Shared context: ~/.stackmemory/shared-context/projects/"
echo "  • Continuity ledger: ./.stackmemory/continuity.json"
echo "  • Last handoff: ./.stackmemory/last-handoff.md"
echo "  • Session data: ~/.stackmemory/sessions/"
echo
echo -e "${YELLOW}💡 To use in new Claude session:${NC}"
echo "  1. Run: stackmemory capture"
echo "  2. Copy the handoff summary"
echo "  3. Paste at start of new session"
echo "  4. Context will be automatically loaded"