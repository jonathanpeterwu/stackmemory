#!/usr/bin/env node
/**
 * StackMemory Claude Code Integration Setup
 * Automatically configures Claude Code to use StackMemory MCP server
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CLAUDE_CONFIG_DIR = join(homedir(), '.claude');
const CLAUDE_CONFIG_FILE = join(CLAUDE_CONFIG_DIR, 'config.json');
const STACKMEMORY_MCP_CONFIG = join(CLAUDE_CONFIG_DIR, 'stackmemory-mcp.json');
const HOOKS_DIR = join(CLAUDE_CONFIG_DIR, 'hooks');
const STACKMEMORY_HOOK = join(HOOKS_DIR, 'stackmemory_init.sh');

console.log('🚀 Setting up StackMemory + Claude Code integration...\n');

// 1. Create Claude config directory
if (!existsSync(CLAUDE_CONFIG_DIR)) {
  console.log('📁 Creating ~/.claude directory...');
  mkdirSync(CLAUDE_CONFIG_DIR, { recursive: true });
}

// 2. Create hooks directory
if (!existsSync(HOOKS_DIR)) {
  console.log('📁 Creating ~/.claude/hooks directory...');
  mkdirSync(HOOKS_DIR, { recursive: true });
}

// 3. Create StackMemory MCP configuration
console.log('⚙️  Creating StackMemory MCP configuration...');
const mcpConfig = {
  mcpServers: {
    stackmemory: {
      command: 'stackmemory',
      args: ['mcp-server'],
      env: {
        NODE_ENV: 'production',
      },
    },
  },
};

writeFileSync(STACKMEMORY_MCP_CONFIG, JSON.stringify(mcpConfig, null, 2));
console.log(`✅ Created: ${STACKMEMORY_MCP_CONFIG}`);

// 4. Create session initialization hook
console.log('🪝 Creating StackMemory session hook...');
const hookScript = `#!/bin/bash
# StackMemory Session Initialization Hook
# Automatically loads context and starts frame tracking

if [ -d "./.stackmemory" ]; then
    echo "🧠 StackMemory context tracking active"
    
    # Show current stack status
    STACK_STATUS=$(stackmemory status --project 2>/dev/null)
    if echo "$STACK_STATUS" | grep -q "Stack depth: 0"; then
        echo "📝 Starting fresh work session"
    else
        echo "📚 Resuming context stack:"
        echo "$STACK_STATUS" | grep -E "(Stack depth|Active frames|└─)" | head -5
    fi
    
    # Quick context summary
    ACTIVE_TASKS=$(stackmemory status --project 2>/dev/null | grep -c "└─" || echo "0")
    if [ "$ACTIVE_TASKS" -gt 0 ]; then
        echo "📋 $ACTIVE_TASKS active frames loaded"
    fi
fi
`;

writeFileSync(STACKMEMORY_HOOK, hookScript);
execSync(`chmod +x "${STACKMEMORY_HOOK}"`);
console.log(`✅ Created: ${STACKMEMORY_HOOK}`);

// 4b. Create startup hook with Linear sync
const STARTUP_HOOK = join(HOOKS_DIR, 'on-startup');
console.log('🪝 Creating StackMemory startup hook with Linear sync...');
const startupHookScript = `#!/bin/bash
# Auto-start StackMemory monitor on Claude Code startup

# Start monitor if project has StackMemory
if [ -d ".stackmemory" ]; then
    stackmemory monitor --start 2>/dev/null || true
    echo "🔍 StackMemory monitor started"
fi

# Load previous handoff if exists
if [ -d ".stackmemory/handoffs" ]; then
    stackmemory restore --no-copy 2>/dev/null || true
fi

# Check and restore from ledger if needed
stackmemory clear --restore 2>/dev/null || true

# Trigger Linear sync on StackMemory instance loading
if [ -d ".stackmemory" ] && [ -f "scripts/sync-linear-graphql.js" ]; then
    echo "🔄 Triggering Linear sync..."
    npm run linear:sync >/dev/null 2>&1 || node scripts/sync-linear-graphql.js >/dev/null 2>&1 || true
    echo "✅ Linear sync triggered"
fi
`;

writeFileSync(STARTUP_HOOK, startupHookScript);
execSync(`chmod +x "${STARTUP_HOOK}"`);
console.log(`✅ Created: ${STARTUP_HOOK}`);

// 5. Update or create Claude config.json
console.log('📝 Updating Claude Code configuration...');

let claudeConfig = {};
if (existsSync(CLAUDE_CONFIG_FILE)) {
  try {
    const existing = readFileSync(CLAUDE_CONFIG_FILE, 'utf-8');
    claudeConfig = JSON.parse(existing);
    console.log('   Found existing config, merging...');
  } catch (error) {
    console.log('   Existing config invalid, creating new...');
  }
}

// Merge configuration
if (!claudeConfig.mcp) {
  claudeConfig.mcp = {};
}

if (!claudeConfig.mcp.configFiles) {
  claudeConfig.mcp.configFiles = [];
}

// Add StackMemory MCP config if not already present
if (!claudeConfig.mcp.configFiles.includes(STACKMEMORY_MCP_CONFIG)) {
  claudeConfig.mcp.configFiles.push(STACKMEMORY_MCP_CONFIG);
}

// Update session start hook
if (!claudeConfig.hooks) {
  claudeConfig.hooks = {};
}

if (!claudeConfig.hooks.session_start) {
  claudeConfig.hooks.session_start = [];
} else if (typeof claudeConfig.hooks.session_start === 'string') {
  claudeConfig.hooks.session_start = [claudeConfig.hooks.session_start];
}

// Add StackMemory hook if not already present
if (!claudeConfig.hooks.session_start.includes(STACKMEMORY_HOOK)) {
  claudeConfig.hooks.session_start.unshift(STACKMEMORY_HOOK);
}

writeFileSync(CLAUDE_CONFIG_FILE, JSON.stringify(claudeConfig, null, 2));
console.log(`✅ Updated: ${CLAUDE_CONFIG_FILE}`);

// 6. Verify setup
console.log('\n🔍 Verifying setup...');

try {
  // Check if stackmemory command is available
  execSync('stackmemory --version', { stdio: 'ignore' });
  console.log('✅ StackMemory CLI available');
} catch {
  console.log(
    '⚠️  StackMemory CLI not in PATH - you may need to restart your terminal'
  );
}

try {
  // Check if Claude Code is available
  execSync('claude --help', { stdio: 'ignore' });
  console.log('✅ Claude Code available');
} catch {
  console.log(
    '⚠️  Claude Code not found - install from https://claude.ai/code'
  );
}

// 7. Usage instructions
console.log(`
🎉 Setup complete! 

📋 To use StackMemory with Claude Code:

1. Initialize StackMemory in your project:
   cd your-project
   stackmemory init

2. Start Claude Code (will auto-load StackMemory):
   claude

3. Or explicitly load StackMemory MCP:
   claude --mcp-config ~/.claude/stackmemory-mcp.json

📚 Available MCP tools in Claude Code:
   • start_frame, close_frame - Frame lifecycle
   • create_task, get_active_tasks - Task management  
   • linear_sync, linear_status - Linear integration
   • get_context, add_decision - Context management

📖 Full documentation: docs/claude-code-integration.md

🔧 To reconfigure: npm run claude:setup
`);

console.log('✨ Integration setup successful!');
