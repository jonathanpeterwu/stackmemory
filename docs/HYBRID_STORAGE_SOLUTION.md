# Hybrid Storage Solution for Short-Duration VMs

## Overview
Optimal storage strategy for ephemeral virtual machines with 30-minute to 4-hour lifespans.

## Architecture

### Memory-First Approach
```typescript
// Primary: In-memory cache with immediate access
const memoryCache = new Map<string, FrameData>();

// Secondary: File system for persistence  
const fileStorage = './storage/frames/';

// Tertiary: Git repository as backup
const gitBackup = './.storage-backup/';
```

### Implementation Strategy

#### 1. Tiered Storage (Hot/Warm/Cold)
- **Hot (Memory)**: Active frames, recent traces (< 5 minutes)
- **Warm (JSON Files)**: Session data, completed traces (< 30 minutes) 
- **Cold (Git)**: Historical data, backups (> 30 minutes)

#### 2. VM Lifecycle Integration
```typescript
class VMStorage {
  async onStart() {
    // Load from git backup if exists
    await this.loadFromGit();
  }
  
  async onShutdown() {
    // Persist critical data to git
    await this.backupToGit();
  }
  
  async onEvery5Min() {
    // Tier data based on age
    await this.tierData();
  }
}
```

#### 3. Data Persistence Rules
- **Critical**: Agent states, completed tasks → Git backup
- **Session**: Active frames, temporary data → JSON files
- **Cache**: Frequent lookups, hot data → Memory only

## Benefits for VMs

### Storage Efficiency
- **Memory**: 50-100MB typical usage
- **Disk**: 10-50MB for active sessions  
- **Git**: Minimal overhead for critical data only

### Performance
- **Memory access**: < 1ms
- **File system**: < 10ms
- **Git operations**: < 100ms (background only)

### Reliability
- **VM crash**: Critical data preserved in git
- **Network issues**: Local files maintain session continuity
- **Restart**: Fast recovery from combined sources

## Implementation Files

1. **HybridStorageManager** (`src/core/storage/hybrid-vm-storage.ts`)
2. **VMLifecycleHooks** (`src/integrations/vm/lifecycle-hooks.ts`)
3. **TieringScheduler** (`src/core/storage/tiering-scheduler.ts`)

## Usage Example

```typescript
const storage = new HybridVMStorage({
  memoryLimit: '100MB',
  fileBackupInterval: '5min',
  gitBackupInterval: '30min',
  tieringEnabled: true
});

// Automatically handles VM lifecycle
await storage.initialize();
```

## Cost Analysis

### Traditional Database
- **Setup**: 2-5 minutes
- **Memory**: 200-500MB
- **Network**: Constant connection required

### Hybrid Approach
- **Setup**: < 30 seconds  
- **Memory**: 50-100MB
- **Network**: Optional, background only

## Conclusion

The hybrid approach is optimal for short-duration VMs because:
1. **Fast startup** - No database dependencies
2. **Low resource usage** - Memory + files only
3. **Crash resilient** - Git backup preserves critical data
4. **Network independent** - Functions offline

Perfect fit for ephemeral compute environments like Railway, Vercel Functions, or AWS Lambda containers.