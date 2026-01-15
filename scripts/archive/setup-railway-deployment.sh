#!/bin/bash

echo "🚂 Railway Deployment Setup Script"
echo "=================================="
echo ""
echo "This script will guide you through setting up automatic Railway deployments"
echo ""

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "📦 Installing Railway CLI..."
    npm install -g @railway/cli
fi

# Check if logged in to Railway
echo "🔐 Checking Railway authentication..."
if ! railway whoami &> /dev/null; then
    echo "Please log in to Railway:"
    railway login
fi

# Get project ID
echo ""
echo "🔍 Getting Railway project information..."
RAILWAY_PROJECT_ID=$(railway status --json 2>/dev/null | jq -r '.projectId' 2>/dev/null)

if [ -z "$RAILWAY_PROJECT_ID" ]; then
    echo "No Railway project linked. Would you like to:"
    echo "1) Link an existing project"
    echo "2) Create a new project"
    read -p "Choose option (1 or 2): " option
    
    if [ "$option" = "1" ]; then
        railway link
    else
        railway init
    fi
    
    RAILWAY_PROJECT_ID=$(railway status --json | jq -r '.projectId')
fi

# Get Railway token
echo ""
echo "🔑 To enable GitHub Actions deployment, you need a Railway API token."
echo "   Visit: https://railway.app/account/tokens"
echo "   Create a new token and copy it."
echo ""
read -p "Enter your Railway API token (it will be hidden): " -s RAILWAY_TOKEN
echo ""

# Display GitHub secrets to add
echo ""
echo "✅ Setup complete! Now add these secrets to your GitHub repository:"
echo ""
echo "1. Go to: https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/settings/secrets/actions"
echo ""
echo "2. Add these repository secrets:"
echo "   • RAILWAY_TOKEN = (your token - hidden for security)"
echo "   • RAILWAY_PROJECT_ID = $RAILWAY_PROJECT_ID"
echo ""
echo "3. Railway deployments will trigger automatically on:"
echo "   • Push to main/master branch → Production deployment"
echo "   • Pull requests → Preview deployments"
echo ""

# Optional: Test deployment
read -p "Would you like to test the deployment now? (y/n): " test_deploy
if [ "$test_deploy" = "y" ]; then
    echo ""
    echo "🚀 Testing deployment..."
    railway up --detach
    echo "✅ Deployment initiated! Check your Railway dashboard for status."
fi

echo ""
echo "📝 Additional configuration:"
echo "   • Edit railway.json to customize build/deploy settings"
echo "   • Edit .github/workflows/railway-deploy.yml to customize CI/CD"
echo "   • Visit Railway dashboard to configure environment variables"
echo ""
echo "🎉 Railway deployment setup complete!"