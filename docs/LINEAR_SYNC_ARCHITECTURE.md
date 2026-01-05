# Linear Sync Architecture

## Overview

The StackMemory Linear integration now uses a **unidirectional sync architecture** to avoid direct Linear API calls from the TUI and instead relies on automatic syncing via webhooks and scheduled scripts.

## Architecture

```
Linear (Source of Truth)
         ↓
    [Webhooks/Scripts] ← Automatic sync
         ↓
   Local Task Store
         ↓
      TUI Display
```

## Key Components

### 1. **TUI Data Service** (Modified)
- **No direct Linear API calls** from the TUI
- Only loads tasks from local `PebblesTaskStore`
- Maps local task data to TUI display format
- Shows sync status and identifiers

**File**: `src/features/tui/services/data-service.ts`

### 2. **Webhook Handler** (New)
- Processes incoming Linear webhooks
- Updates local tasks when changes occur in Linear
- Handles create, update, and delete operations
- Verifies webhook signatures for security

**File**: `src/integrations/linear/webhook-handler.ts`

### 3. **Auto-Sync Script** (New)
- Scheduled sync script for regular updates
- Can run as one-time sync or in watch mode
- Pulls latest changes from Linear to local store
- Tracks sync state and provides detailed logging

**File**: `scripts/linear-auto-sync.js`

## Benefits

### ✅ **Performance**
- TUI loads instantly (no API calls)
- No rate limiting issues in the TUI
- Offline capability for viewing tasks

### ✅ **Reliability** 
- Webhook ensures real-time updates
- Scheduled sync provides backup mechanism
- Local storage provides fault tolerance

### ✅ **Security**
- Webhook signature verification
- API keys only needed for sync processes
- Reduced API surface area

### ✅ **User Experience**
- Instant task display in TUI
- Real-time updates via webhooks
- Works offline once synced

## Usage

### Automatic Sync (Recommended)
```bash
# One-time sync
npm run linear:sync

# Watch mode (sync every 5 minutes)
npm run linear:sync:watch

# Auto-sync with custom interval (15 minutes)
npm run linear:auto-sync
```

### TUI Display
```bash
# TUI will show locally synced tasks only
npm run tui
```

### Webhook Setup (Optional)
Configure Linear webhook to point to your webhook endpoint:
- URL: `https://your-domain.com/webhook/linear`
- Events: Issue created, updated, deleted
- Secret: Set in environment as `LINEAR_WEBHOOK_SECRET`

## Data Flow

1. **Initial Sync**: Run `npm run linear:sync` to pull all tasks from Linear
2. **Real-time Updates**: Linear webhooks update local tasks automatically
3. **Scheduled Sync**: Periodic sync ensures no missed updates
4. **TUI Display**: Always shows current local task state

## Configuration

### Environment Variables
```bash
# Required for syncing
LINEAR_API_KEY="lin_api_xxxxx"

# Optional for webhooks  
LINEAR_WEBHOOK_SECRET="your-webhook-secret"
```

### Package.json Scripts
```json
{
  "linear:sync": "node scripts/linear-auto-sync.js",
  "linear:sync:watch": "node scripts/linear-auto-sync.js --watch",
  "linear:auto-sync": "node scripts/linear-auto-sync.js --watch --interval 15"
}
```

## Deployment

### Cron Job Example
```bash
# Sync every 15 minutes
*/15 * * * * cd /path/to/project && LINEAR_API_KEY=xxx npm run linear:sync
```

### Webhook Server
Set up Express server to handle webhooks:
```javascript
app.post('/webhook/linear', webhookHandler.handleWebhook);
```

## Monitoring

The auto-sync script provides detailed logging:
- Sync duration and success/failure
- Number of tasks synced and updated  
- Conflict detection and resolution
- Task distribution by state and priority

## Migration

Existing installations will continue to work. To adopt the new architecture:

1. Update to latest version
2. Run initial sync: `npm run linear:sync`
3. Set up scheduled sync or webhooks
4. TUI will automatically use local tasks

## Technical Details

### Task Storage Format
Tasks are stored locally with Linear identifiers preserved:
```typescript
{
  id: "local-task-id",
  identifier: "ENG-123", // Linear identifier
  title: "Task title",
  state: "In Progress",
  syncStatus: "synced",
  lastSyncedAt: "2026-01-05T18:00:00Z"
}
```

### State Mapping
Linear states → TUI columns:
- `backlog` → Backlog
- `unstarted` → To Do  
- `started` → In Progress
- `completed` → Done
- `cancelled` → Done

This architecture provides a robust, scalable foundation for Linear integration while maintaining excellent UX in the TUI.