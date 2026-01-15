# StackMemory Features

## Core Features

### Context Persistence
- **Shared Context Layer**: Cross-session persistence
- **Frame System**: Hierarchical context storage
- **Auto-Rehydration**: Resume context after restarts
- **Clear Survival**: Context persists through session clears

### Linear Integration
- **OAuth Authentication**: Secure Linear.app integration  
- **GraphQL Sync**: Two-way task synchronization
- **Auto-Sync**: Background task updates
- **Task Management**: Create, update, and track Linear tasks

### Claude Code Integration
- **MCP Server**: 20+ tools for Claude Code
- **Lifecycle Hooks**: Auto-triggers on session events
- **Quality Gates**: Post-task validation
- **Auto-Handoff**: Session transition management

### Terminal Interface (TUI)
- **Interactive Dashboard**: Real-time project status
- **Task Board**: Linear task management
- **Frame Visualizer**: Context hierarchy display
- **Performance Metrics**: Session analytics

## Storage & Performance

### Two-Tier Storage
- **Hot Tier**: Redis (24h, high-score traces)
- **Cold Tier**: Railway Buckets (30+ days, archival)
- **Auto-Migration**: Based on age and usage patterns

### Performance Optimizations
- **Infinite Storage**: Unlimited context handling
- **Context Caching**: 60% faster retrieval
- **Lazy Loading**: On-demand context expansion
- **Compression**: 70% size reduction

## Development Tools

### CLI Commands
```bash
stackmemory status         # Project overview
stackmemory context list   # Saved contexts  
stackmemory linear:sync    # Sync Linear tasks
stackmemory monitor start  # Background monitoring
stackmemory clear          # Smart session clear
stackmemory tui           # Launch terminal interface
```

### Browser Testing
- **MCP Integration**: Test web pages through Claude
- **Screenshot Capture**: Visual testing support
- **DOM Interaction**: Element selection and testing

### Code Search (Coming Soon)
- **BM25 + Trigram**: Fast lexical search
- **RLM Integration**: Semantic code understanding  
- **Ollama Local Models**: Privacy-first AI processing
- **10x Performance**: Sub-200ms search times

## Deployment Options

### Railway (Recommended)
- **PostgreSQL + Redis**: Managed databases
- **Auto-Scaling**: Handle traffic spikes
- **Environment Management**: Secure config
- **Health Monitoring**: Built-in observability

### Local Development
- **SQLite**: Lightweight local storage
- **Docker Support**: Containerized development
- **Hot Reload**: Fast iteration cycles