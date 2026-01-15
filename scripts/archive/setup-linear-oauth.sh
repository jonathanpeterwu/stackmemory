#!/bin/bash

# Linear OAuth Setup Script
# Sets up environment variables for Linear OAuth integration

echo "🔧 Setting up Linear OAuth environment..."

# Load from .env.linear if it exists
if [ -f ".env.linear" ]; then
    echo "📄 Loading configuration from .env.linear"
    export $(cat .env.linear | grep -v '^#' | xargs)
else
    echo "❌ .env.linear file not found!"
    echo "Creating template .env.linear file..."
    cat > .env.linear << 'EOF'
# Linear OAuth Configuration
# LINEAR_CLIENT_ID=your_client_id_here
# LINEAR_CLIENT_SECRET=your_client_secret_here
# LINEAR_OAUTH_TOKEN=your_oauth_token_here
LINEAR_REDIRECT_URI=http://localhost:3456/auth/linear/callback
EOF
    echo "⚠️  Please edit .env.linear and add your Linear OAuth credentials"
    exit 1
fi

# Verify environment variables are set
if [ -z "$LINEAR_CLIENT_ID" ] || [ -z "$LINEAR_CLIENT_SECRET" ]; then
    echo "❌ Error: LINEAR_CLIENT_ID or LINEAR_CLIENT_SECRET not set"
    echo "Please check your .env.linear file"
    exit 1
fi

echo "✅ Linear OAuth environment configured:"
echo "   CLIENT_ID: ${LINEAR_CLIENT_ID:0:8}..."
echo "   CLIENT_SECRET: ${LINEAR_CLIENT_SECRET:0:20}..."
echo "   REDIRECT_URI: $LINEAR_REDIRECT_URI"
echo ""
echo "📝 Next steps:"
echo "1. Ensure your Linear OAuth app redirect URI is set to:"
echo "   $LINEAR_REDIRECT_URI"
echo ""
echo "2. Run authentication:"
echo "   npx stackmemory linear auth"
echo ""
echo "3. Or use this script to set environment in current shell:"
echo "   source scripts/setup-linear-oauth.sh"