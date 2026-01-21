# Linear Integration

## Commands

```bash
npm run linear:sync      # Sync tasks with Linear
npm run linear:mirror    # Full mirror sync
```

## Environment

```bash
LINEAR_API_KEY=lin_api_xxxxx
```

## Key Scripts

- sync-linear-graphql.js - Main sync
- update-linear-status.js - Update status
- fetch-linear-status.js - Get status

## Workflow

1. Create task in Linear (STA-XXX)
2. `npm run linear:sync` to pull locally
3. Work on task
4. Sync updates back

## Troubleshooting

- API errors: Check LINEAR_API_KEY in .env
- Sync issues: Use --mirror flag
