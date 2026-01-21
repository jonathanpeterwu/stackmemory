# Tool Comparison Results

## Testing Summary
Date: 2026-01-16
Test Feature: "Add a new CLI command 'stackmemory ping' that tests Redis connectivity"

## 1. StackMemory RLM (Recursive Language Model)

**Architecture**: Single orchestrator with specialized subagents
**Status**: ✅ Fixed and working
**Location**: `/Users/jwu/Dev/stackmemory/skills/rlm.ts`

**Strengths**:
- Native integration with StackMemory codebase
- Uses Claude Code directly without API keys
- Lightweight, runs in-process
- Good for complex task decomposition

**Weaknesses**:
- Initial database errors (now fixed)
- Limited to single Claude session
- No persistent state between runs

**Test Result**: Successfully decomposes tasks but requires StackMemory infrastructure

## 2. Zeroshot (Multi-Agent Orchestration)

**Architecture**: Message-passing pub/sub with SQLite ledger
**Status**: ⚠️ Partially working with mock provider
**Location**: `/Users/jwu/Dev/stackmemory/external/zeroshot-main/`

**Key Components**:
- **Conductor**: 2D classification (Complexity × TaskType)
- **Message Bus**: SQLite-based persistent ledger
- **Logic Engine**: JavaScript sandbox for trigger evaluation
- **Cluster Templates**: Configurable agent workflows

**Strengths**:
- Sophisticated multi-agent coordination
- Persistent message history in SQLite
- Flexible trigger-based agent activation
- Support for multiple providers (Claude, Codex, Gemini, OpenCode)
- Docker and git worktree isolation modes
- TUI dashboard for monitoring

**Weaknesses**:
- Requires Claude CLI with proper authentication (currently blocked)
- Complex setup and configuration
- Heavy resource usage for multi-agent runs
- Authentication issues with Claude Code app vs Claude API

**Test Result**: 
- ✅ Core orchestration working
- ✅ Message passing functional
- ✅ Mock provider integration successful
- ❌ Claude CLI authentication blocked

## 3. Bjarne (Single-Agent Loop)

**Architecture**: Simple prompt-response loop
**Status**: ❌ Not tested (requires Claude CLI)
**Location**: `/Users/jwu/Dev/stackmemory/external/bjarne/`

**Strengths**:
- Simple, lightweight design
- Direct Claude CLI integration
- Minimal setup required

**Weaknesses**:
- Requires working Claude CLI
- No multi-agent capabilities
- Limited orchestration features

**Test Result**: Could not test due to Claude CLI authentication issues

## Key Findings

### Authentication Issue (UPDATED)
The main blocker is that the installed Claude app (`/opt/homebrew/bin/claude`) is Claude Code, not the Claude API CLI. Issues found:
1. Claude Code doesn't accept ANTHROPIC_API_KEY environment variable
2. `claude setup-token` fails with raw mode error in non-interactive terminals
3. The ANTHROPIC_API_KEY in environment appears to be invalid (401 authentication error)
4. Both Zeroshot and Bjarne rely on the `claude` CLI command working

### Zeroshot Architecture Insights

**Message Flow**:
```
Agent A → publish() → SQLite Ledger → LogicEngine → trigger match → Agent B executes
```

**Complexity Classification**:
- TRIVIAL: 1 file, mechanical (0 validators)
- SIMPLE: 1 concern (1 validator)  
- STANDARD: Multi-file (3 validators)
- CRITICAL: Auth/payments/security (5 validators)

**Task Types**:
- INQUIRY: Read-only exploration
- TASK: Implement new feature
- DEBUG: Fix broken code

### Implementation Details

**Zeroshot Spawn Issue Fix**:
- Problem: `spawn zeroshot ENOENT`
- Solution: Modified `claude-task-runner.js` to check local installation first
- Files changed:
  - `/Users/jwu/Dev/stackmemory/zeroshot/src/claude-task-runner.js`
  - `/Users/jwu/Dev/stackmemory/zeroshot/src/agent/agent-task-executor.js`

**Mock Provider Creation**:
- Created `/Users/jwu/Dev/stackmemory/zeroshot/src/providers/mock/index.js`
- Added to provider index and preflight checks
- Successfully bypassed Claude authentication for testing

## Attempted Solutions

1. **Configured Zeroshot settings** with API key:
   ```bash
   zeroshot settings set providerSettings.claude.anthropicApiKey "$ANTHROPIC_API_KEY"
   ```
   Result: ✅ Saved but Claude Code app still doesn't use it

2. **Created API wrapper** using Anthropic SDK:
   - Installed `@anthropic-ai/sdk` package
   - Created `tools/wrappers/claude-api-wrapper.cjs` to bypass CLI
   - Result: ❌ API key returns 401 authentication error

3. **Mock Provider** for Zeroshot:
   - Created `/src/providers/mock/index.js`
   - Added to provider registry and preflight checks
   - Result: ✅ Core orchestration works, proves Zeroshot functional

## Recommendations

1. **For immediate use**: StackMemory RLM is the only fully functional option
2. **For production multi-agent**: 
   - Need valid ANTHROPIC_API_KEY (current one appears invalid/revoked)
   - Or use alternative providers (OpenAI, Gemini) if their CLIs are available
3. **Authentication solutions**:
   - Get a valid Anthropic API key and use the wrapper created
   - Install actual Claude API CLI tool (not Claude Code app)
   - Modify Zeroshot/Bjarne to use SDK directly instead of CLI

## Next Steps

1. Obtain valid ANTHROPIC_API_KEY to test the API wrapper
2. Test Zeroshot with alternative providers (OpenAI/Gemini) if available
3. Consider PR to Zeroshot to add SDK-based provider support