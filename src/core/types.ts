export interface PersistenceAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  execute(query: string, params?: unknown[]): Promise<QueryResult>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  isConnected(): boolean;
}

export interface QueryResult {
  rows: unknown[];
  rowCount: number;
  fields?: Array<{
    name: string;
    type: string;
  }>;
}

export interface TraceData {
  id: string;
  sessionId: string;
  timestamp: Date;
  type: string;
  data: unknown;
  metadata?: Record<string, unknown>;
}

export interface ContextData {
  id: string;
  projectId: string;
  branch?: string;
  content: string;
  timestamp: Date;
  type: string;
  metadata?: Record<string, unknown>;
}
