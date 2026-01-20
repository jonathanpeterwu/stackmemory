# Ralph Swarm Deployment Guide

## Overview

The Ralph Swarm system enables parallel execution of multiple specialized AI agents working together on complex projects. This guide covers deployment, monitoring, and management of swarm operations.

## Architecture

### Components

1. **SwarmCoordinator** - Orchestrates multiple agents
2. **Specialized Agents** - Role-based workers (architect, developer, tester, etc.)
3. **Context Sharing** - StackMemory integration for knowledge sharing
4. **Monitoring System** - Real-time tracking and metrics

### Agent Roles

- **Architect**: System design, component modeling, architecture validation
- **Developer**: Code implementation, debugging, refactoring
- **Tester**: Test design, automation, validation
- **Reviewer**: Code review, quality assessment, best practices
- **Optimizer**: Performance analysis, resource optimization
- **Documenter**: Technical writing, API documentation
- **Planner**: Task decomposition, dependency analysis
- **Coordinator**: Task coordination, conflict resolution

## Quick Start

### Prerequisites

```bash
# Ensure project is built
npm run build

# Set up database (optional, falls back to SQLite)
export DATABASE_URL="postgresql://user:pass@localhost/stackmemory"
```

### Launch Single Swarm

```bash
# Basic launch
./scripts/deploy-ralph-swarm.sh start "Build a todo app"

# With specific agents
./scripts/deploy-ralph-swarm.sh start "Build API" "architect,developer,tester" 5
```

### Launch Parallel Swarms

```bash
# Launch predefined parallel swarms
./scripts/deploy-ralph-swarm.sh parallel

# This launches:
# - Architecture & Design swarm
# - Core Implementation swarm
# - Testing & Quality swarm
# - Documentation swarm
```

## Monitoring

### Terminal Dashboard

```bash
# Monitor all swarms
./scripts/deploy-ralph-swarm.sh monitor

# Monitor specific swarm
./scripts/deploy-ralph-swarm.sh monitor swarm-20240120-123456-1234

# Interactive dashboard
./scripts/deploy-ralph-swarm.sh dashboard
```

### Web Monitor

```bash
# Launch web-based monitor
node scripts/swarm-monitor.js web

# Open http://localhost:3456 in browser
```

### Terminal UI Monitor

```bash
# Launch blessed-based terminal UI
node scripts/swarm-monitor.js

# Controls:
# - Arrow keys to navigate
# - Enter to select swarm
# - 'q' to quit
```

## Management Commands

### Stop Swarm

```bash
./scripts/deploy-ralph-swarm.sh stop swarm-20240120-123456-1234
```

### Cleanup

```bash
# Remove stopped swarm data
./scripts/deploy-ralph-swarm.sh cleanup
```

## Configuration

### Swarm Config (`.swarm/config.json`)

```json
{
  "maxAgents": 10,
  "coordinationInterval": 30000,
  "driftDetectionThreshold": 5,
  "freshStartInterval": 3600000,
  "conflictResolutionStrategy": "expertise",
  "enableDynamicPlanning": true,
  "pathologicalBehaviorDetection": true,
  "parallelExecution": true,
  "monitoring": {
    "enabled": true,
    "port": 3456,
    "metricsInterval": 5000
  }
}
```

### Environment Variables

```bash
# Database configuration
export DATABASE_URL="postgresql://..."

# Linear API for task integration
export LINEAR_API_KEY="lin_api_..."

# Monitoring port
export SWARM_MONITOR_PORT=3456

# Max parallel swarms
export MAX_PARALLEL_SWARMS=10
```

## Parallel Execution

### Testing Parallel Swarms

```bash
# Run comprehensive parallel tests
node scripts/test-parallel-swarms.js

# Tests include:
# - Simultaneous launch
# - Resource isolation
# - Inter-swarm coordination
# - Performance under load
# - Failure handling
```

### Performance Metrics

- **Throughput**: 5+ tasks/second
- **Concurrency**: Up to 10 swarms
- **Coordination**: 30-second cycles
- **Memory**: ~50MB per swarm
- **Context Budget**: 3200 tokens

## Advanced Features

### Drift Detection

Swarms automatically detect and recover from:
- Tunnel vision (repeated failing approaches)
- Excessive runtime (stuck tasks)
- Pattern drift (degrading performance)

### Fresh Starts

Agents can trigger fresh starts when:
- Drift threshold exceeded (5 iterations)
- Manual trigger via coordination
- Hourly automatic refresh

### Context Sharing

Agents share knowledge through:
- StackMemory shared context
- Coordination events
- Pattern learning
- Task handoffs

## Troubleshooting

### Common Issues

1. **Swarm won't start**
   - Check build: `npm run build`
   - Verify database: `echo $DATABASE_URL`
   - Check logs: `.swarm/logs/*.log`

2. **Agent coordination failures**
   - Monitor coordination: `./scripts/deploy-ralph-swarm.sh monitor`
   - Check shared context: `.swarm/shared-context.json`
   - Review events: `.swarm/coordination-events.jsonl`

3. **Performance degradation**
   - Check active swarms: `./scripts/deploy-ralph-swarm.sh dashboard`
   - Monitor metrics: `node scripts/swarm-monitor.js`
   - Clean up old swarms: `./scripts/deploy-ralph-swarm.sh cleanup`

### Debug Mode

```bash
# Enable verbose logging
export DEBUG=ralph:*

# Trace execution
export TRACE_ENABLED=true

# Monitor specific swarm
tail -f .swarm/logs/swarm-*.log
```

## Best Practices

1. **Task Decomposition**
   - Break complex projects into clear subtasks
   - Define acceptance criteria upfront
   - Specify agent specializations

2. **Resource Management**
   - Limit concurrent swarms (5-10 recommended)
   - Monitor memory usage
   - Clean up completed swarms

3. **Coordination**
   - Use appropriate conflict resolution strategy
   - Enable drift detection
   - Monitor coordination events

4. **Performance**
   - Use parallel swarms for independent tasks
   - Sequential for dependent workflows
   - Monitor and adjust coordination intervals

## Examples

### Multi-Service Application

```bash
# Launch coordinated swarms for microservices
./scripts/deploy-ralph-swarm.sh start "User Service" "architect,developer,tester"
./scripts/deploy-ralph-swarm.sh start "Auth Service" "developer,tester"
./scripts/deploy-ralph-swarm.sh start "API Gateway" "architect,developer"
./scripts/deploy-ralph-swarm.sh start "Database Layer" "architect,optimizer"
```

### Test-Driven Development

```bash
# TDD workflow with specialized swarms
./scripts/deploy-ralph-swarm.sh start "Write Tests" "tester" 2
./scripts/deploy-ralph-swarm.sh start "Implement Features" "developer" 3
./scripts/deploy-ralph-swarm.sh start "Review & Refactor" "reviewer,optimizer" 2
```

### Documentation Sprint

```bash
# Parallel documentation generation
./scripts/deploy-ralph-swarm.sh start "API Docs" "documenter"
./scripts/deploy-ralph-swarm.sh start "User Guide" "documenter"
./scripts/deploy-ralph-swarm.sh start "Examples" "developer,documenter"
```

## Integration with StackMemory

The swarm system fully integrates with StackMemory for:

- **Context Persistence**: Swarms save and load context
- **Pattern Learning**: Learn from successful task completions
- **Task History**: Track and analyze swarm performance
- **Knowledge Sharing**: Cross-swarm context access

## Security Considerations

1. **Process Isolation**: Each swarm runs in isolated process
2. **Resource Limits**: Configurable max agents and memory
3. **API Key Protection**: Use environment variables
4. **Log Sanitization**: Sensitive data masked in logs

## Support

For issues or questions:
1. Check logs in `.swarm/logs/`
2. Review test results in `.swarm/parallel-test-report.json`
3. Run diagnostic: `node scripts/testing/ralph-swarm-test-scenarios.js`
4. File issues at: https://github.com/stackmemoryai/stackmemory/issues