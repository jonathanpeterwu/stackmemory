# Railway Deployment

## Commands

```bash
npm run railway:deploy   # Deploy
npm run railway:logs     # View logs
```

## Config Files

- railway.json, railway.toml, nixpacks.toml, Dockerfile

## Environment (set in Railway)

```bash
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
NODE_ENV=production
```

## Entry Point

```bash
npm start  # dist/servers/railway/index.js
```

## Health Check

```bash
curl https://stackmemory-production.up.railway.app/health
```
