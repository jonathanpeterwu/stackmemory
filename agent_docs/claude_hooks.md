# Claude Code Hooks

## Locations

- Project: .claude/hooks/
- Global: ~/.claude/hooks/

## Auto-Install

```bash
npm run postinstall  # install-claude-hooks-auto.js
```

## Project Hooks

- on-startup.js - Load context
- on-code-change.js - Save on changes
- on-task-complete.js - Update Linear
- periodic-save.js - Auto-save context

## Setup

```bash
npm run claude:setup
./scripts/install-claude-hooks.sh
```

## Test

```bash
./scripts/test-hooks-persistence.sh
```
