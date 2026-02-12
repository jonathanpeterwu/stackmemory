# Graphiti Integration (Temporal Knowledge Graph)

This spike adds a minimal Graphiti integration to StackMemory to capture episodic events and enable temporal queries.

What’s included
- Types: `src/integrations/graphiti/types.ts` (Episode, EntityNode, RelationEdge, TemporalQuery)
- Config: `src/integrations/graphiti/config.ts` with `GRAPHITI_ENDPOINT`, `GRAPHITI_BACKEND`
- Client: `src/integrations/graphiti/client.ts` stub for REST-style endpoints
- Hooks: `src/hooks/graphiti-hooks.ts` to emit episodes on `session_start`, `file_change`, `session_end`
- Daemon wiring: `src/hooks/daemon.ts` registers Graphiti hooks if `GRAPHITI_ENDPOINT` is set

Enable
- Set `GRAPHITI_ENDPOINT=http://localhost:8080` (or your deployment) in environment
- Optionally set `GRAPHITI_BACKEND=neo4j|falkordb|kuzu|neptune`
- Start hooks daemon via existing CLI to emit episodes from file watching and lifecycle events

Mapping to Zep/Graphiti model
- Episode subgraph: Hook events are sent as non-lossy `Episode` records (`session_start`, `file_change`, `session_end`).
- Semantic entity subgraph: Use `GraphitiClient.upsertEntities` and `upsertRelations` from scanners/integrations (Stripe, Salesforce, etc.) to create typed entities and bi-temporal edges with validity windows.
- Community subgraph: Handled by Graphiti backend (community detection/summary), later exposed via MCP or CLI.

Next steps
- Wire scanner events: Emit episodes from external system syncs (Stripe, Salesforce, GitHub) and upsert entities/edges per event.
- Context tools: Add MCP handlers for temporal queries (e.g., “changes for Customer X in last 30 days”).
- Hybrid retrieval: Combine graph traversal with FTS/embedding results to construct compact prompt context.
- Tests: Add unit tests for hook-to-episode conversion and client request flows.

