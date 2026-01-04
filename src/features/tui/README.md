# StackMemory TUI Monitoring Dashboard

## Overview
Interactive Terminal User Interface for monitoring multiple StackMemory sessions, tasks, frames, and integrations.

## Features

### 1. Session Monitor
- Auto-tagged session names based on work context
- Real-time session status (active/idle/completed)
- Token usage and context percentage
- Session duration and activity metrics
- Hierarchical view of parent/child sessions

### 2. Task Management (Linear Integration)
- Live Linear task synchronization
- Task state transitions visualization
- Priority and assignee tracking
- Sprint/cycle progress indicators
- Quick task creation and updates

### 3. Frame Storage Visualization
- Context stack tree display
- Frame lifecycle (hot/warm/cold tiers)
- Compression ratios and storage efficiency
- Frame relationships and dependencies
- Memory usage heat maps

### 4. Subagent Monitoring
- Agent fleet status dashboard
- Task delegation flow visualization
- Performance metrics per agent type
- Error rates and recovery status
- Resource utilization graphs

### 5. PR/Issue Tracking
- GitHub PR status boards
- Issue lifecycle visualization
- Review status and comments
- CI/CD pipeline status
- Merge queue visualization

### 6. Real-time Analytics
- Session velocity trends
- Token consumption graphs
- Task completion rates
- Team contribution metrics
- Quality gate indicators

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   TUI Dashboard                     │
├─────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │   Sessions   │  │    Tasks     │  │  Frames   │ │
│  │  Monitor     │  │   (Linear)   │  │  Storage  │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │  Subagents   │  │   PR/Issue   │  │ Analytics │ │
│  │   Fleet      │  │   Tracking   │  │  Graphs   │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
└─────────────────────────────────────────────────────┘
```

## Technologies
- **blessed**: Terminal UI framework with widget support
- **blessed-contrib**: Charts and graphs for terminal
- **WebSocket**: Real-time data streaming
- **EventEmitter**: Event-driven updates
- **SQLite**: Local session storage
- **Redis**: Hot tier frame caching