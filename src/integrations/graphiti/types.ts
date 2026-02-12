/**
 * Graphiti Integration Types
 * Temporal knowledge graph primitives and query options
 */

export type GraphitiBackend = 'neo4j' | 'falkordb' | 'kuzu' | 'neptune';

// Raw episodic input (non-lossy)
export interface Episode {
  id?: string;
  type: string; // e.g., 'file_change', 'commit', 'api_event', 'prompt', 'email'
  content: string | Record<string, unknown>;
  timestamp: number; // event time (T)
  transactionTime?: number; // ingestion time (T')
  source?: string; // system/source identifier
  metadata?: Record<string, unknown>;
}

// Semantic layer
export interface EntityNode {
  id?: string;
  type: string; // e.g., 'Person', 'Customer', 'Repo', 'Issue', 'File'
  name: string;
  summary?: string;
  embedding?: number[];
  properties?: Record<string, unknown>;
}

export interface RelationEdge {
  id?: string;
  fromId: string;
  toId: string;
  type: string; // e.g., 'USES', 'WORKS_ON', 'OWNS', 'CHURNING', 'STALE_DEAL'
  // Bi-temporal validity
  validFrom: number; // t_valid
  validTo?: number | null; // t_invalid
  createdAt?: number; // t'_created
  expiredAt?: number | null; // t'_expired
  properties?: Record<string, unknown>;
}

export interface CommunityCluster {
  id: string;
  label?: string;
  summary?: string;
  size: number;
}

export interface TemporalQuery {
  // Entity or relation search
  query?: string; // semantic text query
  entityTypes?: string[];
  relationTypes?: string[];
  // Time window on event timeline
  validFrom?: number;
  validTo?: number;
  // Retrieval modes
  maxHops?: number; // graph traversal depth
  k?: number; // top-k
  rerank?: boolean; // allow reranking
}

export interface GraphContextChunk {
  text: string;
  citations?: Array<{ episodeId?: string; edgeId?: string; entityId?: string }>;
  tokens?: number;
}

export interface GraphContext {
  chunks: GraphContextChunk[];
  totalTokens: number;
}

export interface GraphitiStatus {
  connected: boolean;
  backend?: GraphitiBackend;
  nodes?: number;
  edges?: number;
  communities?: number;
  version?: string;
}
