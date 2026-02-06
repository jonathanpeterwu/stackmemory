# Spec Generator Skill

## Description
Generate iterative spec documents following the 4-doc VibeScaffold pattern:
ONE_PAGER → DEV_SPEC → PROMPT_PLAN → AGENTS.md

Later documents automatically read earlier ones from disk (progressive context).
All specs are written to `docs/specs/` and tracked in git.

## Usage

### Generate a spec
```
/spec one-pager "Photo Captioner App"
/spec dev-spec
/spec prompt-plan
/spec agents
```

### Interactive mode (no arguments)
```
/spec
```
Prompts for spec type and title interactively.

### List existing specs
```
/spec list
```

### Update (check off items)
```
/spec update prompt-plan "Initialize repository and tooling"
/spec update prompt-plan "Stage A:1"
```

### Validate completeness
```
/spec validate prompt-plan
/spec validate dev-spec
```

## Spec Types

| Type | Output | Reads From |
|------|--------|------------|
| `one-pager` | `docs/specs/ONE_PAGER.md` | — |
| `dev-spec` | `docs/specs/DEV_SPEC.md` | ONE_PAGER |
| `prompt-plan` | `docs/specs/PROMPT_PLAN.md` | ONE_PAGER, DEV_SPEC |
| `agents` | `AGENTS.md` | ONE_PAGER, DEV_SPEC, PROMPT_PLAN |

## Sections

### ONE_PAGER
Problem, Audience, Platform, Core Flow, MVP Features, Non-Goals, Metrics

### DEV_SPEC
Architecture, Tech Stack, API Contracts, Data Models, Auth, Error Handling, Deployment

### PROMPT_PLAN
Stages A-G with `- [ ]` TDD checkboxes per prompt. Check off as tasks complete.

### AGENTS.md
Repo Files, Responsibilities, Guardrails, Testing, When to Ask

## Options
- `--force` — Overwrite existing spec file

## Workflow
1. Start with `/spec one-pager "My App"` to capture the idea
2. Generate `/spec dev-spec` — reads ONE_PAGER for context
3. Generate `/spec prompt-plan` — creates implementation checklist
4. Generate `/spec agents` — creates agent configuration
5. As tasks complete, `/spec update prompt-plan "task name"` checks items off
6. `/spec validate prompt-plan` verifies all items done
