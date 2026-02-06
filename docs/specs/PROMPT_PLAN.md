# StackMemory — Prompt Plan

> Generated from ONE_PAGER.md, DEV_SPEC.md

## Stage A: Foundation (Complete)
- [x] Initialize repository and tooling
- [x] Configure CI/CD pipeline (lint-staged + pre-commit)
- [x] Set up development environment (esbuild, vitest)
- [x] Define database schema (SQLite frames table)
- [x] Implement FrameManager (push/pop/query)
- [x] Implement DualStackManager (hot + cold stacks)

## Stage B: Core Features (Complete)
- [x] Session capture and restore
- [x] Handoff prompt generation
- [x] Context retrieval with semantic search
- [x] CLI commands (capture, restore, status, context)
- [x] MCP server with SSE transport

## Stage C: Integrations (Complete)
- [x] Linear OAuth + task sync
- [x] Linear webhook handler
- [x] Claude Code agent bridge
- [x] Claude Code hooks system

## Stage D: Skills & Orchestration (Complete)
- [x] RecursiveAgentOrchestrator with 8 subagent types
- [x] ClaudeSkillsManager with skill routing
- [x] SpecGeneratorSkill (4-doc chain)
- [x] LinearTaskRunner (task → RLM → Linear)
- [x] Agent prompt consolidation (structured templates, latest models)
- [x] Workflow integration (hooks, skill-rules, CLI)

## Stage E: Team Collaboration (Next)
- [ ] Shared frame stacks across team members
- [ ] Conflict resolution for concurrent frame edits
- [ ] Team activity feed and notifications
- [ ] Role-based access control for frames

## Stage F: Hosted Service
- [ ] Railway/Supabase hosted database
- [ ] User signup and JWT auth
- [ ] Remote MCP server (HTTP/SSE)
- [ ] Cross-device sync

## Stage G: Polish & Scale
- [ ] Browser extension for context capture
- [ ] Performance optimization (frame indexing, lazy loading)
- [ ] Telemetry and usage analytics
- [ ] Plugin marketplace for custom skills
