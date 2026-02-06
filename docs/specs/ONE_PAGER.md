# StackMemory — One-Pager

## Problem
AI coding agents (Claude Code, Cursor, Copilot) lose all context between sessions. Developers repeat themselves, decisions get lost, and handoffs between agents or team members are painful. Current tools treat chat as linear logs — there's no structured memory layer.

## Audience
- Solo developers using AI coding assistants daily
- Engineering teams (2-20) collaborating with AI agents across sessions
- AI-first startups where agents do 50%+ of the coding

## Platform
CLI + MCP server — runs locally alongside Claude Code / VS Code. Optional hosted sync for teams.

## Core Flow
1. Developer works with Claude Code — StackMemory auto-captures context as frames on a call stack
2. Session ends — `stackmemory capture` commits state + generates handoff prompt
3. New session starts — `stackmemory restore` rehydrates full context
4. Team member picks up — frames show decisions, progress, blockers with full provenance
5. Ralph (RLM orchestrator) decomposes complex tasks into parallel subagent execution

## MVP Features
- [x] Frame-based context management (push/pop/query)
- [x] Session capture and restore with handoff prompts
- [x] SQLite local storage with dual-stack manager
- [x] MCP server for Claude Desktop integration
- [x] Linear task sync (bidirectional)
- [x] Recursive Language Model (RLM) orchestrator with 8 subagent types
- [x] Claude Code skills system (/spec, /linear-run, checkpoint, dig)
- [ ] Team collaboration with shared frame stacks
- [ ] Hosted sync service (Railway/Supabase)
- [ ] Browser extension for context capture

## Non-Goals
- Not a replacement for git — complements version control
- Not a chat UI — headless memory layer for existing tools
- Not a project management tool — integrates with Linear, not replaces it

## Metrics
- Session restoration accuracy (% of context successfully rehydrated)
- Handoff quality score (does the next agent/human have sufficient context?)
- Token savings (fewer repeated explanations across sessions)
- Task completion rate via Ralph orchestrator
