# StackMemory — Prompt Plan

> Generated from ONE_PAGER.md, DEV_SPEC.md, vision.md, SPEC.md

## Stage A: Foundation (Complete)
- [x] Initialize repository and tooling
- [x] Configure CI/CD pipeline (lint-staged + pre-commit)
- [x] Set up development environment (esbuild, vitest)
- [x] Define database schema (SQLite frames table)
- [x] Implement FrameManager (push/pop/query)
- [x] Implement DualStackManager (hot + cold stacks)

## Stage B: Core Features (Complete)
- [x] Session capture and restore
- [x] Handoff prompt generation
- [x] Context retrieval with semantic search
- [x] CLI commands (capture, restore, status, context)
- [x] MCP server with SSE transport

## Stage C: Integrations (Complete)
- [x] Linear OAuth + task sync
- [x] Linear webhook handler
- [x] Claude Code agent bridge
- [x] Claude Code hooks system

## Stage D: Skills & Orchestration (Complete)
- [x] RecursiveAgentOrchestrator with 8 subagent types
- [x] ClaudeSkillsManager with skill routing
- [x] SpecGeneratorSkill (4-doc chain)
- [x] LinearTaskRunner (task → RLM → Linear)
- [x] Agent prompt consolidation (structured templates, latest models)
- [x] Workflow integration (hooks, skill-rules, CLI)

## Stage D.5: Search & Intelligence (v0.7.0 — Complete)

> FTS5, sqlite-vec, @xenova/transformers shipped in v0.6.3. Stage D.5 hardened retrieval quality, added infrastructure, and filled gaps from SPEC.md Phase 4 and vision.md roadmap. Shipped in v0.7.0 with 137 new tests.

### 1. Retrieval quality signals & acceptance criteria
- [x] Add `retrieval_log` table: query, strategy, results returned, latency_ms, timestamp
- [x] Instrument `ContextRetriever.retrieveContext()` to log every query + results
- [ ] CLI command `stackmemory search:stats` — hit rate, avg latency, strategy distribution
- [ ] Add precision proxy: track whether returned frames are referenced in subsequent tool calls

### 2. Cache expiry & LRU correctness
- [x] Fix `getCachedResult()` — currently never expires (no timestamp check)
- [x] Add `cachedAt` timestamp to cache entries; evict when > `cacheExpiryMs`
- [x] Replace Map-based LRU with proper bounded LRU (or use Map insertion-order delete)

### 3. FTS5 query sanitization
- [x] Sanitize MATCH input: escape special chars (`"`, `*`, `OR`, `AND`, `NOT`, `NEAR`)
- [x] Add prefix search support: `term*` for partial matches
- [x] Handle multi-word queries with implicit AND (currently raw pass-through)

### 4. Incremental garbage collection
- [x] Add `retention_policy` column to frames (keep_forever, ttl_days, archive)
- [x] `MaintenanceService.runGC()`: delete/archive frames past TTL
- [x] Cascade: delete orphaned events, anchors, embeddings, FTS entries
- [ ] CLI `stackmemory gc --dry-run` for preview
- [x] Configurable in `daemon-config.ts`: `gcRetentionDays`, `gcBatchSize`

### 5. Embedding backfill progress & resumability
- [x] Track backfill progress in `maintenance_state` table (last_frame_id, total, completed)
- [x] Resume from last checkpoint on daemon restart (not re-scan full table)
- [ ] Add `--force-reembed` flag to re-generate embeddings for changed frames
- [x] Report backfill % in `stackmemory daemon status`

### 6. Hybrid search score normalization
- [x] Normalize BM25 scores to 0-1 range using min-max within result set
- [x] Normalize vector distances to 0-1 similarity using max distance
- [x] Apply Reciprocal Rank Fusion (RRF) as alternative to weighted sum
- [ ] A/B compare weighted-sum vs RRF in retrieval_log

### 7. Remote infinite storage (S3/GCS cold tier)
- [x] `StorageTierManager`: hot (SQLite) → cold (S3/GCS) with archive/rehydrate
- [ ] Background migration: frames older than N days with no recent access → cold
- [x] On-demand rehydration: transparent fetch from cold tier on access
- [x] Config: `coldTierProvider`, `coldTierBucket`, `coldTierMigrationAgeDays`
- [ ] CLI `stackmemory storage stats` — per-tier frame counts and sizes

### 8. Performance optimization (<100ms p50 retrieval)
- [x] Add composite index on `frames(project_id, created_at DESC)` if missing
- [x] Profile FTS5 + vec queries with `EXPLAIN QUERY PLAN`
- [x] Benchmark: p50/p95/p99 retrieval latency with 1k/10k/100k frames
- [x] Add `PRAGMA mmap_size` for memory-mapped I/O on large DBs
- [ ] Connection pooling for concurrent reads (WAL mode allows parallel readers)

### 9. Multi-repository support
- [x] `project_registry` table: project_id, repo_path, display_name, created_at
- [ ] `stackmemory projects list/add/remove` CLI commands
- [x] Scoped search: `--project <name>` flag on all search/context commands
- [ ] Cross-project search: `stackmemory search --all-projects "query"`
- [ ] MCP tool: `switch_project` to change active project context

### 10. Model routing & cost optimization
- [ ] Move embedding model selection to config: `embedding.model`, `embedding.dimension`
- [ ] Support multiple providers: `@xenova/transformers` (local), Ollama, OpenAI API
- [ ] `EmbeddingProviderFactory.create(config)` — factory with fallback chain
- [ ] Cost tracking: log token/compute usage per embedding call
- [ ] CLI `stackmemory config set embedding.provider ollama` for runtime switching

## Stage E: Team Collaboration
- [ ] Shared frame stacks across team members
- [ ] Conflict resolution for concurrent frame edits
- [ ] Team activity feed and notifications
- [ ] Role-based access control for frames

## Stage F: Hosted Service
- [ ] Railway/Supabase hosted database
- [ ] User signup and JWT auth
- [ ] Remote MCP server (HTTP/SSE)
- [ ] Cross-device sync

## Stage G: Polish & Scale
- [ ] Browser extension for context capture
- [ ] Telemetry and usage analytics
- [ ] Plugin marketplace for custom skills

## Stage H: Enterprise & Ecosystem
- [ ] SSO (SAML/OIDC) and audit logs
- [ ] Multi-org support with tenant isolation
- [ ] PostgreSQL production adapter (pgvector, LISTEN/NOTIFY)
- [ ] Specish API — OpenAPI-based tool bridge
- [ ] Linear Chrome extension (ticket → subagent pipeline)
- [ ] SMS/WhatsApp notification system
