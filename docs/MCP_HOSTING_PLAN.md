# StackMemory MCP Server Hosting Plan

## Overview
Plan to host StackMemory as an MCP (Model Context Protocol) server that Claude Code and other AI tools can connect to for persistent context management.

## Architecture

### 1. MCP Server Implementation
- **Location**: `/src/mcp/mcp-server.ts` (already exists)
- **Protocol**: JSON-RPC over stdio
- **Transport**: Local process or network (future)

### 2. Deployment Options

#### Option A: Local Installation (Current)
```bash
npm install -g @stackmemoryai/stackmemory
stackmemory mcp-server
```

**Pros:**
- Simple setup
- No network latency
- Full data privacy
- Works offline

**Cons:**
- Manual installation required
- Per-machine setup
- Version management per user

#### Option B: Claude Desktop Integration
```json
// ~/.claude/claude_desktop_config.json
{
  "mcpServers": {
    "stackmemory": {
      "command": "npx",
      "args": ["@stackmemoryai/stackmemory", "mcp-server"],
      "env": {
        "LINEAR_API_KEY": "${LINEAR_API_KEY}"
      }
    }
  }
}
```

**Pros:**
- Auto-starts with Claude Desktop
- Easy configuration
- Automatic updates via npx
- Environment variable support

**Cons:**
- Claude Desktop only
- Still local execution

#### Option C: Hosted Service (Future)
```yaml
Service Architecture:
  - API Gateway: Handle authentication & routing
  - MCP Proxy: WebSocket to JSON-RPC bridge  
  - StackMemory Core: Multi-tenant context engine
  - Storage: PostgreSQL/SQLite per workspace
  - Cache: Redis for hot contexts
```

**Pros:**
- Zero installation
- Cross-device sync
- Team collaboration
- Centralized updates

**Cons:**
- Network dependency
- Privacy concerns
- Infrastructure costs
- Complexity

## Implementation Phases

### Phase 1: Enhanced Local MCP (Current Sprint)
- [x] Basic MCP server implementation
- [ ] Add update checking to MCP server startup
- [ ] Improve MCP tool descriptions
- [ ] Add MCP-specific configuration file
- [ ] Create setup script for Claude Desktop

### Phase 2: NPX-Based Distribution
- [ ] Ensure npx compatibility
- [ ] Add first-run setup wizard
- [ ] Auto-configure Linear integration
- [ ] Generate claude_desktop_config.json

### Phase 3: Docker Container
```dockerfile
FROM node:20-alpine
RUN npm install -g @stackmemoryai/stackmemory
EXPOSE 3000
CMD ["stackmemory", "mcp-server", "--port", "3000"]
```

- [ ] Create Dockerfile
- [ ] Publish to Docker Hub
- [ ] Add docker-compose.yml
- [ ] Support volume mounts for persistence

### Phase 4: Hosted MVP
- [ ] Build WebSocket → MCP bridge
- [ ] Add authentication layer
- [ ] Implement workspace isolation
- [ ] Deploy to cloud (Fly.io/Railway)
- [ ] Add usage metrics

### Phase 5: Enterprise Features
- [ ] SSO integration
- [ ] Audit logging
- [ ] Role-based access
- [ ] Data retention policies
- [ ] SLA guarantees

## Quick Start Scripts

### 1. Auto-Setup Script
```bash
#!/bin/bash
# install-stackmemory-mcp.sh

# Install StackMemory
npm install -g @stackmemoryai/stackmemory

# Initialize in current project
stackmemory init

# Configure for Claude Desktop
cat > ~/.claude/claude_desktop_config.json << EOF
{
  "mcpServers": {
    "stackmemory": {
      "command": "stackmemory",
      "args": ["mcp-server"],
      "env": {
        "LINEAR_API_KEY": "$LINEAR_API_KEY"
      }
    }
  }
}
EOF

echo "✅ StackMemory MCP configured for Claude Desktop"
```

### 2. Docker Quick Start
```bash
# Run StackMemory MCP in Docker
docker run -d \
  --name stackmemory-mcp \
  -v ~/.stackmemory:/data \
  -e LINEAR_API_KEY=$LINEAR_API_KEY \
  -p 3000:3000 \
  stackmemoryai/stackmemory:latest
```

### 3. Team Setup
```bash
# Deploy for team using docker-compose
curl -L https://stackmemory.ai/team-setup.sh | bash
```

## Configuration File

### ~/.stackmemory/mcp-config.json
```json
{
  "version": "1.0",
  "server": {
    "port": 3000,
    "host": "localhost"
  },
  "features": {
    "autoSync": true,
    "linearIntegration": true,
    "updateCheck": true
  },
  "storage": {
    "type": "sqlite",
    "path": "~/.stackmemory/db"
  },
  "linear": {
    "apiKey": "${LINEAR_API_KEY}",
    "teamId": "auto",
    "syncInterval": 15
  }
}
```

## Environment Variables

```bash
# Required
STACKMEMORY_HOME=~/.stackmemory

# Optional
LINEAR_API_KEY=lin_api_xxx
STACKMEMORY_LOG_LEVEL=info
STACKMEMORY_PORT=3000
STACKMEMORY_UPDATE_CHECK=true
```

## Monitoring & Health

### Health Check Endpoint
```http
GET /health
{
  "status": "healthy",
  "version": "0.2.3",
  "uptime": 3600,
  "connections": 2
}
```

### Metrics
- Active connections
- Memory usage
- Context operations/sec
- Linear sync status
- Error rate

## Security Considerations

1. **Authentication**: Use API keys or OAuth
2. **Encryption**: TLS for network transport
3. **Isolation**: Workspace separation
4. **Audit**: Log all operations
5. **Compliance**: GDPR/SOC2 ready

## Next Steps

1. **Immediate**: Add update checker to MCP server
2. **This Week**: Create Claude Desktop setup script
3. **Next Sprint**: Docker container
4. **Q1 2025**: Hosted MVP
5. **Q2 2025**: Enterprise features

## Resources

- [MCP Specification](https://modelcontextprotocol.io)
- [Claude Desktop Config](https://docs.anthropic.com/claude-desktop)
- [StackMemory Docs](https://stackmemory.ai/docs)