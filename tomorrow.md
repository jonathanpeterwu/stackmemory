# Tomorrow — 2026-02-12

## Publish v1.0.1

npm token expired. Re-auth and publish:

```bash
npm login --scope=@stackmemoryai
npm publish --access public
```

v1.0.1 is committed, pushed, and pre-publish verified (652 tests, lint clean, build OK).

## Graphiti Integration

Untracked files on main — work in progress:

- `src/integrations/graphiti/` — client, types, config
- `src/hooks/graphiti-hooks.ts` — session/file change episode hooks (lint-fixed)
- `docs/graphiti-integration.md` — integration spec

Next steps:
- Wire graphiti client into MCP tools or expose as new tool
- Add tests for graphiti hooks
- Decide: optional dependency or always-on?

## Remaining Doc Cleanup

Lower priority items not addressed in the 1.0 docs refresh:

- `docs/archives/` has 10+ old reports (security, cleanup, migration) — audit for relevance
- `docs/STORAGE_COMPARISON.md` — may be stale (references Redis/S3 tiers)
- `docs/FEATURES.md` — check against actual feature set
- `docs/AGENTIC_PATTERNS_IMPLEMENTATION.md` — check if current
- `docs/testing-agent.md` — check if current
- `docs/session-persistence-design.md` — check if current
- `docs/query-language.md` — check if current
- `vision.md` — confirmed current, keep as-is

## Codex Linear Sync — Verify

The fix is deployed (gated on `LINEAR_API_KEY`, 10s timeout, non-fatal). After publishing v1.0.1:

1. `npm install -g @stackmemoryai/stackmemory@1.0.1`
2. Run `codex-sm` with `LINEAR_API_KEY` set
3. Exit codex and verify Linear sync fires

## Ideas

- Shared `onSessionExit()` utility to deduplicate exit logic across claude-sm/codex-sm/pty-wrapper
- `session_end` hook event should trigger Linear sync via hook system (not just inline execSync)
- Consider adding `CHANGELOG.md` back with proper v0.6-v1.0.1 entries (the old one was deleted because it stopped at v0.5.51)
