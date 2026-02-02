/**
 * DiffMem Integration Types
 * TypeScript interfaces for user memory management
 */

export interface UserMemory {
  id: string;
  content: string;
  category:
    | 'preference'
    | 'expertise'
    | 'project_knowledge'
    | 'pattern'
    | 'correction';
  confidence: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryQuery {
  categories?: string[];
  query?: string;
  limit?: number;
  timeRange?: 'day' | 'week' | 'month' | 'all';
  minConfidence?: number;
}

export interface LearnedInsight {
  content: string;
  category: UserMemory['category'];
  confidence: number;
  source: string;
  timestamp: number;
  context?: Record<string, unknown>;
}

export interface DiffMemStatus {
  connected: boolean;
  memoryCount: number;
  lastSync: number | null;
  version?: string;
}
