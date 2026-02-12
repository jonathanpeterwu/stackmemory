# Development Guide

## Current Status (v1.0.0)

- **Production Ready**: Full CLI, MCP server, Linear integration, skills system
- **Storage**: SQLite with FTS5 full-text search and BM25 hybrid scoring
- **Test Coverage**: 652 tests passing across 65 test files

## Testing

```bash
# Run all tests once
npm run test:run

# Run tests in watch mode
npm test

# Lint code
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Build project
npm run build

# Full validation
npm run lint && npm run test:run && npm run build
```

## Quality Gates

After any code changes:
1. `npm run lint` — Fix formatting issues
2. `npm run test:run` — Ensure all tests pass
3. `npm run build` — Verify compilation
4. Test actual functionality

## Architecture

- **Core**: Context management, frame system, session persistence, FTS5 search
- **Integrations**: Linear (OAuth + GraphQL), Claude Code (MCP), Browser MCP
- **Skills**: Spec generator, RLM orchestrator, Linear task runner
- **Storage**: SQLite (better-sqlite3) with FTS5, optional embedding providers

## Key Files

```
src/
├── cli/                  # CLI commands and entry points
│   ├── index.ts          # Main CLI entry
│   ├── claude-sm.ts      # Claude wrapper
│   ├── codex-sm.ts       # Codex wrapper
│   └── commands/         # Command implementations
├── core/
│   ├── context/          # Frame management, context bridge
│   ├── database/         # SQLite adapter, FTS5 search
│   ├── digest/           # Digest generation
│   └── query/            # Query parsing and routing
├── integrations/
│   ├── linear/           # Linear GraphQL + OAuth
│   └── mcp/              # MCP server (25 tools)
├── services/             # Business services
├── skills/               # Skill implementations
└── utils/                # Shared utilities
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
