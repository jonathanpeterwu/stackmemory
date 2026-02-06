# Linear Chrome Extension - Implementation Plan

## Philosophy

**Types are everything.** Define the shape of all data first. The interfaces ARE the spec.

## Phase 1: Core Types (First)

Create `packages/linear-extension/src/types.ts` - this file defines the ENTIRE system:

```typescript
// === EXTENSION DOMAIN ===

/** What the user captures from a webpage */
export interface CapturedContent {
  text: string;
  sourceUrl: string;
  timestamp: Date;
  // GitHub-specific (optional)
  github?: {
    repo: string;
    filePath: string;
    lineStart?: number;
    lineEnd?: number;
    prNumber?: number;
  };
}

/** User's ticket creation input */
export interface TicketDraft {
  title: string;
  description: string;
  projectId: string;
  priority?: 'urgent' | 'high' | 'medium' | 'low' | 'none';
  labels?: string[];
  captured: CapturedContent;
}

// === LINEAR API DOMAIN ===

/** Linear OAuth tokens (stored in chrome.storage) */
export interface LinearAuth {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  teamId: string;
  userId: string;
}

/** Linear issue creation request */
export interface LinearIssueCreate {
  title: string;
  description: string;
  teamId: string;
  projectId?: string;
  priority?: number;  // 0-4
  labelIds?: string[];
}

/** Linear issue response */
export interface LinearIssue {
  id: string;
  identifier: string;  // "STA-123"
  title: string;
  url: string;
}

// === WEBHOOK DOMAIN ===

/** Incoming Linear webhook payload */
export interface LinearWebhookPayload {
  action: 'create' | 'update' | 'remove';
  type: 'Issue' | 'Comment' | 'Project';
  createdAt: string;
  data: {
    id: string;
    identifier: string;
    title: string;
    description?: string;
    url: string;
    labels: Array<{ id: string; name: string }>;
    team: { id: string; key: string };
    project?: { id: string; name: string };
  };
  url: string;
  organizationId: string;
}

/** Webhook validation result */
export interface WebhookValidation {
  valid: boolean;
  error?: string;
  payload?: LinearWebhookPayload;
}

// === SUBAGENT DOMAIN ===

/** Config for spawning a Claude Code subagent */
export interface SubagentSpawnConfig {
  agentType: 'general-purpose' | 'code-reviewer' | 'debugger' | 'github-workflow';
  task: string;
  context: SubagentContext;
  options: SubagentOptions;
}

export interface SubagentContext {
  linearIssueId: string;
  linearIdentifier: string;  // "STA-123"
  linearUrl: string;
  sourceUrl: string;
  sourceText: string;
  github?: CapturedContent['github'];
}

export interface SubagentOptions {
  autoCloseIssue: boolean;
  postResultsToLinear: boolean;
  timeout?: number;
  model?: 'sonnet' | 'opus' | 'haiku';
}

/** Subagent execution result */
export interface SubagentResult {
  sessionId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: string;
  error?: string;
  duration?: number;
}

// === ERROR DOMAIN ===

export type ExtensionError =
  | { code: 'AUTH_REQUIRED'; message: string }
  | { code: 'AUTH_EXPIRED'; message: string }
  | { code: 'LINEAR_API_ERROR'; message: string; status: number }
  | { code: 'WEBHOOK_INVALID'; message: string }
  | { code: 'SUBAGENT_SPAWN_FAILED'; message: string };
```

**Review checkpoint:** These types define EVERYTHING. If the types are wrong, everything cascades.

## Phase 2: Contracts / Pure Functions

### 2.1 Validation functions (pure, testable)

```typescript
// src/validation.ts - ZERO side effects

export function validateWebhookPayload(raw: unknown): WebhookValidation;
export function shouldTriggerSubagent(payload: LinearWebhookPayload): boolean;
export function extractGitHubContext(url: string): CapturedContent['github'] | undefined;
export function buildSubagentTask(payload: LinearWebhookPayload): string;
export function mapLinearPriority(priority: TicketDraft['priority']): number;
```

### 2.2 Transformation functions (pure, testable)

```typescript
// src/transforms.ts - ZERO side effects

export function capturedToDescription(captured: CapturedContent): string;
export function draftToLinearCreate(draft: TicketDraft, auth: LinearAuth): LinearIssueCreate;
export function webhookToSpawnConfig(payload: LinearWebhookPayload): SubagentSpawnConfig;
```

**Tests written FIRST for all pure functions.**

## Phase 3: Edge Logic (Boundaries)

### 3.1 Linear API Client

```typescript
// src/linear-client.ts
export class LinearClient {
  constructor(auth: LinearAuth);

  async createIssue(issue: LinearIssueCreate): Promise<LinearIssue>;
  async addComment(issueId: string, body: string): Promise<void>;
  async getProjects(teamId: string): Promise<Array<{id: string; name: string}>>;
  async getLabels(teamId: string): Promise<Array<{id: string; name: string}>>;
}
```

### 3.2 Chrome Storage

```typescript
// src/storage.ts
export async function getAuth(): Promise<LinearAuth | null>;
export async function setAuth(auth: LinearAuth): Promise<void>;
export async function clearAuth(): Promise<void>;
```

### 3.3 Webhook Handler (StackMemory side)

```typescript
// src/webhook-handler.ts
export async function handleLinearWebhook(
  req: Request,
  signature: string
): Promise<SubagentResult | ExtensionError>;
```

### 3.4 Subagent Spawner

```typescript
// src/subagent-spawner.ts
export async function spawnSubagent(
  config: SubagentSpawnConfig
): Promise<SubagentResult>;
```

## Phase 4: UI Components (Isolated)

### 4.1 Popup (`popup/`)
- Project selector dropdown
- Priority selector
- Title input (prefilled)
- Description textarea (prefilled with captured text)
- Submit button
- Status display

### 4.2 Context Menu
- "Create Linear Ticket" on right-click
- Opens popup with selection pre-filled

**Built in isolation, screenshot tested.**

## Phase 5: Integration

### 5.1 Wire extension → Linear
- Popup calls `LinearClient.createIssue()`
- Success shows ticket link

### 5.2 Wire Linear → Webhook
- Configure Linear webhook in workspace settings
- Point to StackMemory endpoint

### 5.3 Wire Webhook → Subagent
- Webhook handler calls `spawnSubagent()`
- Subagent updates Linear issue with results

### 5.4 E2E Test
```
1. Select text on GitHub PR
2. Create ticket via extension
3. Verify Linear issue created
4. Verify webhook received
5. Verify subagent spawned
6. Verify results posted back to Linear
```

## File Structure

```
packages/linear-extension/
├── src/
│   ├── types.ts           # Phase 1: ALL types
│   ├── validation.ts      # Phase 2: Pure validation
│   ├── transforms.ts      # Phase 2: Pure transforms
│   ├── linear-client.ts   # Phase 3: Linear API
│   ├── storage.ts         # Phase 3: Chrome storage
│   ├── background.ts      # Service worker
│   └── popup/
│       ├── popup.html
│       ├── popup.ts
│       └── popup.css
├── manifest.json
├── tests/
│   ├── validation.test.ts
│   └── transforms.test.ts
└── package.json

src/integrations/linear/
├── webhook-handler.ts     # Phase 3: Webhook endpoint
└── subagent-spawner.ts    # Phase 3: Spawn logic

docker/
├── Dockerfile.webhook
└── docker-compose.yml
```

## Implementation Order

1. **types.ts** - Define everything (30 min, REVIEW CAREFULLY)
2. **validation.ts + tests** - Pure logic, TDD (1 hr)
3. **transforms.ts + tests** - Pure logic, TDD (1 hr)
4. **linear-client.ts** - API wrapper (1 hr)
5. **webhook-handler.ts** - StackMemory integration (1 hr)
6. **subagent-spawner.ts** - Spawn logic (1 hr)
7. **popup/** - UI (1 hr)
8. **Integration + E2E** - Wire together (2 hr)

## Container Setup

```yaml
# docker-compose.yml
services:
  webhook:
    build:
      context: .
      dockerfile: docker/Dockerfile.webhook
    ports:
      - "3456:3456"
    environment:
      - LINEAR_WEBHOOK_SECRET=${LINEAR_WEBHOOK_SECRET}
      - STACKMEMORY_PATH=/app/stackmemory
    volumes:
      - stackmemory-data:/app/.stackmemory

  tunnel:
    image: cloudflare/cloudflared
    command: tunnel --url http://webhook:3456
```

## Success Metrics

- [ ] Types compile with strict mode
- [ ] 100% test coverage on validation/transforms
- [ ] Extension installs without errors
- [ ] OAuth flow completes
- [ ] Ticket created in <3 clicks
- [ ] Webhook triggers subagent within 10s
- [ ] Results posted back to Linear
