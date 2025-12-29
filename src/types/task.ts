export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface LinearMetadata {
  stateId?: string;
  projectId?: string;
  assigneeId?: string;
  [key: string]: unknown;
}

export interface TaskMetadata {
  linear?: LinearMetadata;
  [key: string]: unknown;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority?: TaskPriority;
  tags: string[];
  externalId?: string;
  externalIdentifier?: string;
  externalUrl?: string;
  metadata?: TaskMetadata;
  createdAt: Date;
  updatedAt: Date;
}
