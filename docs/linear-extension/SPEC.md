# Linear Chrome Extension - Specification

## Overview

Chrome extension that creates Linear tickets from selected text/code, triggering automated Claude Code subagents via StackMemory webhooks.

## User Flow

```
┌─────────────┐     ┌─────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│  Linear │────▶│ StackMemory │────▶│ Claude Code │
│  Extension  │     │   API   │     │   Webhook   │     │  Subagent   │
└─────────────┘     └─────────┘     └─────────────┘     └─────────────┘
     │                   │                 │                   │
     │ 1. Select text    │                 │                   │
     │ 2. Click "Create" │                 │                   │
     │──────────────────▶│                 │                   │
     │                   │ 3. Create issue │                   │
     │                   │────────────────▶│                   │
     │                   │                 │ 4. Spawn agent    │
     │                   │                 │──────────────────▶│
     │                   │                 │                   │ 5. Work on task
```

## Extension Features

### Content Capture
- Selected text from any webpage
- Source URL
- Optional: GitHub context (repo, file path, line numbers if on GitHub)

### Ticket Creation
- Title (auto-generated from selection, editable)
- Description (captured text + source URL)
- Project selection (dropdown of Linear projects)
- Priority (optional)
- Labels: `automated`, `claude-code` (auto-applied)

### Authentication
- Linear OAuth 2.0 flow
- Store tokens securely in chrome.storage.local

## Linear Webhook → StackMemory

### Webhook Endpoint
```
POST /api/webhooks/linear
```

### Trigger Conditions
- Issue created with label `automated` or `claude-code`
- Issue assigned to specific user/bot

### Payload Processing
```typescript
interface LinearWebhookPayload {
  action: 'create' | 'update';
  type: 'Issue';
  data: {
    id: string;
    identifier: string;  // e.g., "STA-123"
    title: string;
    description: string;
    labels: { name: string }[];
    url: string;
  };
}
```

## StackMemory Subagent Spawning

### On Webhook Receipt
1. Validate webhook signature
2. Parse issue details
3. Create StackMemory frame for the task
4. Spawn Claude Code subagent with context:
   - Issue title as task
   - Description as context
   - Source URL for reference
5. Update Linear issue with agent session ID

### Subagent Configuration
```typescript
interface SubagentSpawnConfig {
  type: 'general-purpose' | 'code-reviewer' | 'debugger';
  task: string;
  context: {
    linearIssueId: string;
    linearUrl: string;
    sourceUrl: string;
    sourceText: string;
  };
  autoClose: boolean;  // Close Linear issue when done
}
```

## Container Architecture

```
┌─────────────────────────────────────────┐
│           Docker Compose                │
├─────────────────────────────────────────┤
│  ┌─────────────────┐  ┌──────────────┐  │
│  │  Webhook Server │  │   ngrok/     │  │
│  │  (Node.js)      │◀─│   Cloudflare │  │
│  │  Port 3456      │  │   Tunnel     │  │
│  └────────┬────────┘  └──────────────┘  │
│           │                              │
│           ▼                              │
│  ┌─────────────────┐                    │
│  │  StackMemory    │                    │
│  │  Daemon         │                    │
│  └─────────────────┘                    │
└─────────────────────────────────────────┘
```

## API Endpoints

### `POST /api/webhooks/linear`
Receives Linear webhook, spawns subagent.

### `GET /api/health`
Health check for container monitoring.

### `GET /api/agents/:sessionId/status`
Check subagent status (for extension polling).

## Security

- Linear webhook signature validation
- HTTPS required for webhook endpoint
- OAuth tokens stored encrypted
- No secrets in extension code (use backend for API calls)

## Extension Manifest (v3)

```json
{
  "manifest_version": 3,
  "name": "Linear + StackMemory",
  "permissions": [
    "activeTab",
    "storage",
    "contextMenus"
  ],
  "host_permissions": [
    "https://api.linear.app/*",
    "https://*.stackmemory.ai/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html"
  }
}
```

## Success Criteria

1. User can select text, create Linear ticket in <3 clicks
2. Webhook fires within 5 seconds of ticket creation
3. Subagent spawns and begins work within 10 seconds
4. Linear issue updated with agent status/results
