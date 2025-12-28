export interface LinearWebhookPayload {
  action: string;
  type: string;
  data: any;
  url?: string;
  createdAt: string;
  organizationId?: string;
  webhookId?: string;
  webhookTimestamp?: number;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: {
    id: string;
    name: string;
    type: string;
  };
  assignee?: {
    id: string;
    name: string;
    email: string;
  };
  priority?: number;
  priorityLabel?: string;
  project?: {
    id: string;
    name: string;
  };
  team: {
    id: string;
    key: string;
    name: string;
  };
  labels?: Array<{
    id: string;
    name: string;
    color: string;
  }>;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface LinearComment {
  id: string;
  body: string;
  issue: {
    id: string;
    identifier: string;
  };
  user: {
    id: string;
    name: string;
    email: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface LinearProject {
  id: string;
  name: string;
  description?: string;
  state: string;
  team: {
    id: string;
    key: string;
    name: string;
  };
  createdAt: string;
  updatedAt: string;
  url: string;
}