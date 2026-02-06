# StackMemory — AGENTS.md

> Generated from ONE_PAGER.md, DEV_SPEC.md, PROMPT_PLAN.md

## Repository Structure
```
src/
  cli/           → CLI entry point + commands (commander.js)
  core/          → Business logic (frames, database, query, retrieval)
  integrations/  → External services (Linear, MCP, Claude Code, Ralph)
  skills/        → Claude Code skills (spec, linear-run, orchestrator)
  features/      → Feature modules (tasks, TUI)
  utils/         → Shared utilities
packages/        → Workspace packages (linear-extension)
.claude/         → Claude Code config (hooks, skills, settings)
docs/specs/      → Iterative spec documents
```

## Agent Responsibilities

### When editing `src/core/`
- Frame operations are the foundation — test thoroughly
- FrameManager, DualStackManager, ContextRetriever are hot paths
- SQLiteAdapter uses better-sqlite3 (synchronous API, not async)
- Always use `.js` extensions on relative ESM imports

### When editing `src/skills/`
- Skills return `SkillResult { success, message, data?, action? }`
- Register new skills in `ClaudeSkillsManager.executeSkill()` switch
- Add to `getAvailableSkills()` and `getSkillHelp()` too
- RecursiveAgentOrchestrator has 8 subagent types — don't add without reason

### When editing `src/cli/`
- Feature-flagged commands use async `import()` collected in `lazyCommands[]`
- All lazy commands must resolve before `program.parse()`
- Use `ora` for spinners, `chalk` for colors

### When editing `src/integrations/`
- Linear: always check for `LINEAR_API_KEY` before API calls
- MCP: tools must follow `@modelcontextprotocol/sdk` patterns
- Claude Code: agent bridge maps oracle/worker/reviewer types

## Guardrails
- **Never** commit secrets (`.env`, API keys, tokens)
- **Never** use `--no-verify` on git operations
- **Never** use `jest` — this project uses `vitest`
- **Never** skip `.js` extensions on relative imports (ESM requirement)
- **Always** run `npm run lint && npm run test:run && npm run build` before pushing
- **Always** return `undefined` over throwing exceptions
- **Always** log + continue rather than crash

## Testing
- Framework: Vitest (not Jest)
- Run: `npm run test:run` (single pass) or `npm test` (watch mode)
- Location: `src/**/__tests__/*.test.ts` or colocated `*.test.ts`
- Target: 498 tests, all passing, ~17s
- New features require tests — no untested code paths

## When to Ask the User
- Before creating new subagent types in RecursiveAgentOrchestrator
- Before modifying database schema (migrations needed)
- Before changing feature flag defaults
- Before adding new npm dependencies
- Before modifying `.claude/hooks/` behavior
- When a test fails and the fix isn't obvious
