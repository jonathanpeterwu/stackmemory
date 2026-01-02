# Project ID Consistency

## Problem

StackMemory had inconsistent project ID generation across components, causing:

- Frames from same project stored under different project_ids
- Stats showing incorrect counts (mixing global vs project-scoped)
- Sessions unable to find related frames

## Project ID Algorithm

All components MUST use the same algorithm:

```
1. Try: git config --get remote.origin.url
2. Fallback: directory path

3. Normalize:
   - Remove .git suffix
   - Replace non-alphanumeric with dashes
   - Lowercase
   - Take last 50 characters
```

Example: `git@github.com:user/repo.git` → `github-com-user-repo`

## Components Using Project ID

| Component      | File                                   | Purpose             |
| -------------- | -------------------------------------- | ------------------- |
| SessionManager | `src/core/session/session-manager.ts`  | Session persistence |
| ProjectManager | `src/core/projects/project-manager.ts` | Project detection   |
| MCP Server     | `src/integrations/mcp/server.ts`       | MCP tool context    |

## Database Schema

### Frames Table

- `project_id` - identifies which project owns the frame
- Stats queries filter by `project_id`

### Events Table

- No `project_id` column
- Join through `frame_id` → `frames.project_id` for filtering

### Contexts Table

- No `project_id` column (global cache)
- Contains cached project info (README, git history, etc.)
- Displayed as "global" in stats

## Status Command Stats

```
Database Statistics (this project):
  Frames: X (Y active, Z closed)  ← filtered by project_id
  Events: X                        ← filtered via frames JOIN
  Sessions: X                      ← COUNT(DISTINCT run_id) for project
  Cached contexts: X (global)      ← unfiltered, clearly labeled
```

## Migration

If orphaned data exists under old project_ids:

```sql
-- Find orphaned project_ids
SELECT DISTINCT project_id, COUNT(*) FROM frames GROUP BY project_id;

-- Migrate to correct project_id
UPDATE frames SET project_id = 'correct-id' WHERE project_id IN ('old-id-1', 'old-id-2');
```

## Adding New Components

When adding code that uses project_id:

1. Import or replicate the normalization algorithm
2. Always try git remote first, fall back to path
3. Test that IDs match across CLI, MCP, and direct DB queries
