# Development Guide

## Current Status (v0.3.16)

- **Phase 3 Complete**: Shared Context System  
- **Railway Deployment**: Production ready  
- **Linear Integration**: OAuth + GraphQL sync  
- **Claude Code Integration**: 5 essential hooks  
- **Test Coverage**: 294 tests, 100% passing  

## Testing

```bash
# Run all tests
npm test

# Lint code
npm run lint

# Build project
npm run build

# Test specific features
npm run test:linear
npm run test:mcp
npm run test:integration
```

## Quality Gates

After any code changes:
1. `npm run lint` - Fix formatting issues
2. `npm test` - Ensure all tests pass
3. `npm run build` - Verify compilation
4. Test actual functionality

## Architecture

- **Core**: Context management, frame system, session persistence
- **Integrations**: Linear (OAuth), Claude Code (MCP), Railway (deployment)
- **Features**: TUI, browser testing, auto-sync, quality gates
- **Storage**: Two-tier (Redis hot + Railway cold), infinite scaling

## Key Files

```
src/
├── core/context/           # Frame management, context bridge
├── integrations/linear/    # Linear GraphQL + OAuth
├── integrations/mcp/       # Claude Code MCP server  
├── cli/commands/          # CLI command implementations
└── features/tui/          # Terminal interface
```

## Security Requirements

- Never hardcode API keys (use environment variables)
- Add dotenv/config to all Node scripts
- Validate environment variables at startup
- Use pre-commit hooks to prevent secret commits

## Performance Targets

- Context rehydration: <2s
- Linear sync: <5s for 100 tasks
- MCP responses: <100ms
- Memory usage: <500MB per session