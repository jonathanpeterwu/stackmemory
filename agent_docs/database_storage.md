# Database and Storage

## Storage Tiers

- Hot: SQLite (~/.stackmemory/projects.db) - <24h
- Warm: ChromaDB - 1-30 days
- Cold: Remote archival - 30+ days

## Local Files

```
~/.stackmemory/
  projects.db       # Main database
  context.db        # Context storage
  sessions/         # Session data
```

## Environment

```bash
CHROMADB_API_KEY=xxxxx
CHROMADB_API_URL=https://api.trychroma.com
REDIS_URL=redis://...
```

## Scripts

```bash
node scripts/recreate-frames-db.js
node scripts/test-chromadb-full.js
```
