#!/bin/bash

echo "🚂 Railway Environment Variables Setup"
echo "======================================"
echo ""
echo "You need to add these environment variables in the Railway dashboard:"
echo "https://railway.app/project/90d5083a-4adf-49b8-b2ff-95adfbb610f2/service/b2a145c3-065e-4225-8c84-aa0d8f49d243/settings"
echo ""
echo "Copy and paste these into Railway's environment variables section:"
echo ""

# Load .env file
if [ -f .env ]; then
    source .env
    
    echo "REDIS_URL=$REDIS_URL"
    echo "LINEAR_API_KEY=$LINEAR_API_KEY"
    echo "CHROMADB_API_KEY=$CHROMADB_API_KEY"
    echo "CHROMADB_TENANT=$CHROMADB_TENANT"
    echo "CHROMADB_DATABASE=$CHROMADB_DATABASE"
    echo "LINEAR_TEAM_ID=$LINEAR_TEAM_ID"
    echo "LINEAR_ORGANIZATION=$LINEAR_ORGANIZATION"
    echo ""
    echo "Optional (for cold storage tier):"
    echo "GCS_BUCKET_NAME=stackmemory-cold-storage"
    echo "GCS_PROJECT_ID=your-gcp-project-id"
    echo "GCS_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com"
    echo "GCS_PRIVATE_KEY=your-gcs-private-key"
else
    echo "❌ .env file not found. Please create one first."
    exit 1
fi

echo ""
echo "After adding these variables:"
echo "1. Click 'Deploy' in Railway dashboard"
echo "2. Or run: railway up"
echo "3. Check deployment: railway logs"
echo "4. Visit: https://stackmemory-production.up.railway.app/health"