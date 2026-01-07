# Linear Task Update Skill

## Description
Automatically update Linear tasks when work is completed or status changes.

## Triggers
- Task completion detected (keywords: "completed", "done", "finished", "implemented")
- Status change keywords ("in progress", "blocked", "cancelled")
- STA-* or task ID mentioned with status update

## Actions
1. Parse task identifier (STA-XXX or Linear ID)
2. Determine new status from context
3. Update task description with implementation details
4. Change Linear state appropriately
5. Log update result

## Configuration
```yaml
enabled: true
api_key: ${LINEAR_API_KEY}
auto_update: true
states:
  todo: "backlog"
  in_progress: "in_progress"
  completed: "completed"
  blocked: "blocked"
  cancelled: "cancelled"
```

## Usage Examples
- "STA-287 is complete" → Updates task to completed
- "Starting work on STA-288" → Updates task to in_progress
- "STA-289 blocked on dependencies" → Updates task to blocked
- "Implemented STA-290 with [details]" → Updates task with implementation details

## Required Environment
- LINEAR_API_KEY must be set in .env
- Linear workspace access configured