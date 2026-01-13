# Railway Deployment Guide

## Automatic Deployment Setup

StackMemory includes automated deployment to Railway via GitHub Actions.

### Quick Setup

1. **Run the setup script:**
   ```bash
   npm run railway:setup
   ```
   This will:
   - Install Railway CLI
   - Link your Railway project
   - Generate required tokens
   - Guide you through GitHub secrets setup

2. **Add GitHub Secrets:**
   Go to your repository Settings → Secrets → Actions and add:
   - `RAILWAY_TOKEN` - Your Railway API token
   - `RAILWAY_PROJECT_ID` - Your Railway project ID

3. **Deploy:**
   Deployments happen automatically when you:
   - Push to `main` or `master` branch → Production deployment
   - Open a pull request → Preview deployment

### Manual Deployment

```bash
# Deploy current branch
npm run railway:deploy

# View logs
npm run railway:logs
```

## GitHub Actions Workflows

### Production Deployment (.github/workflows/railway-deploy.yml)
- Triggers on push to main/master
- Runs tests before deploying
- Posts deployment status as commit comment
- Deploys to production environment

### Preview Deployments (.github/workflows/railway-preview.yml)
- Triggers on pull requests
- Creates isolated preview environment
- Posts preview URL as PR comment
- Auto-cleans up when PR is closed

## Railway Configuration

### railway.json
Configures build and deploy settings:
- Build command: `npm run build`
- Start command: `npm start`
- Health check endpoint: `/health`
- Auto-restart on failure (max 3 retries)

### Environment Variables
Set these in Railway dashboard:

#### Required
- `REDIS_URL` - Redis connection (use Railway Redis addon)
- `LINEAR_API_KEY` - Linear API key for task sync
- `CHROMADB_API_KEY` - ChromaDB for vector storage

#### Optional
- `DATABASE_URL` - PostgreSQL connection (use Railway PostgreSQL addon)
- `GCS_BUCKET_NAME` - Google Cloud Storage for cold tier
- `SENTRY_DSN` - Error tracking
- `PORT` - Server port (Railway sets automatically)

### Railway Addons

1. **Redis** (Required for hot tier storage)
   - Add via Railway dashboard
   - Auto-populates `REDIS_URL`

2. **PostgreSQL** (Optional)
   - For persistent metadata
   - Auto-populates `DATABASE_URL`

## Storage Tiers on Railway

StackMemory uses a 3-tier storage system optimized for Railway:

1. **Hot Tier (Redis)**
   - Recent traces (<24 hours)
   - High-score traces
   - Railway Redis addon
   - LRU eviction, 100MB limit

2. **Warm Tier (Railway Volumes)**
   - Mid-age traces (1-30 days)
   - Railway persistent volumes
   - Compressed storage

3. **Cold Tier (GCS)**
   - Old traces (>30 days)
   - Google Cloud Storage Coldline
   - $0.004/GB/month

## Monitoring

### Health Check
Railway monitors `/health` endpoint:
```javascript
// Automatically included in deployment
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    redis: redisClient.isReady,
    storage: storageSystem.status
  });
});
```

### Logs
```bash
# View live logs
npm run railway:logs

# Via Railway CLI
railway logs --tail

# Filter by service
railway logs --service stackmemory
```

## Troubleshooting

### Deployment Fails
1. Check GitHub Actions logs
2. Verify secrets are set correctly
3. Ensure tests pass locally: `npm test`
4. Check Railway dashboard for errors

### Redis Connection Issues
1. Verify Redis addon is provisioned
2. Check `REDIS_URL` in environment variables
3. Test locally with Railway proxy:
   ```bash
   railway run npm start
   ```

### Preview Deployments Not Working
1. Ensure `RAILWAY_TOKEN` has project access
2. Check PR has no merge conflicts
3. Verify GitHub Actions are enabled

## Cost Optimization

### Railway Free Tier
- 500 hours/month execution time
- 100GB bandwidth
- Suitable for development

### Production Recommendations
- Use Railway Pro for production
- Enable auto-scaling for traffic spikes
- Monitor resource usage in dashboard
- Use Redis maxmemory policies

## Security

### Secrets Management
- Never commit `.env` files
- Use Railway's environment variables
- Rotate tokens regularly
- Use read-only tokens where possible

### Network Security
- Railway provides HTTPS by default
- Private networking between services
- IP allowlisting available on Pro plan

## Support

- Railway Discord: https://discord.gg/railway
- Railway Docs: https://docs.railway.app
- StackMemory Issues: https://github.com/stackmemoryai/stackmemory/issues