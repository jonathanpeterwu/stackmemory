# Claude Skills Documentation

Claude Skills are custom commands that enhance your workflow when using Claude Code with StackMemory. These skills leverage the frame-based memory system to provide intelligent assistance for common development tasks.

## Available Skills

### 1. Frame Handoff Orchestrator (`/handoff`)

Streamlines frame handoffs between team members by automatically detecting completed work, errors, and pending tasks.

**Usage:**
```bash
stackmemory skills handoff @teammate "Feature complete for review"
stackmemory skills handoff @teammate "Blocked on API issue" --priority critical
stackmemory skills handoff @teammate "Ready for testing" --frames frame1,frame2
```

**Features:**
- Auto-detects frames that need handoff (completed or blocked)
- Generates comprehensive handoff summaries
- Creates action items for the recipient
- Tracks handoff with notifications
- Supports priority levels (low, medium, high, critical)

**Options:**
- `-p, --priority <level>`: Set priority level
- `-f, --frames <frames...>`: Specify specific frames to handoff
- `--no-auto-detect`: Disable auto-detection of frames

### 2. Recovery Checkpoint Manager (`/checkpoint`)

Creates and manages recovery points for your work, enabling quick rollback and comparison between states.

**Usage:**
```bash
# Create checkpoints
stackmemory skills checkpoint create "Before database migration"
stackmemory skills checkpoint create "Stable state" --auto-detect-risky
stackmemory skills checkpoint create "With configs" --files config.json,env.local

# Restore from checkpoint
stackmemory skills checkpoint restore checkpoint-123456

# List checkpoints
stackmemory skills checkpoint list
stackmemory skills checkpoint list --limit 5 --since "2024-01-01"

# Compare checkpoints
stackmemory skills checkpoint diff checkpoint-123 checkpoint-456
```

**Features:**
- Creates full context snapshots
- Auto-detects risky operations (migrations, deployments, deletions)
- Backs up specified files
- Quick restoration to any checkpoint
- Diff between checkpoints to see changes

**Options for create:**
- `--files <files...>`: Include specific files in checkpoint
- `--auto-detect-risky`: Auto-detect and flag risky operations

**Options for list:**
- `-l, --limit <number>`: Limit number of results
- `-s, --since <date>`: Show checkpoints since date

### 3. Context Archaeologist (`/dig`)

Deep historical context retrieval across all your sessions, finding patterns, decisions, and relevant information from the past.

**Usage:**
```bash
# Basic search
stackmemory skills dig "authentication implementation"

# Search with time range
stackmemory skills dig "database optimization" --depth 6months

# Advanced analysis
stackmemory skills dig "API design decisions" --patterns --decisions --timeline

# Search all history
stackmemory skills dig "production issues" --depth all
```

**Features:**
- Semantic search across all historical frames
- Pattern detection (TDD, refactoring, debugging, etc.)
- Decision extraction from past discussions
- Timeline generation of activities
- Configurable search depth

**Options:**
- `-d, --depth <depth>`: Search depth (30days, 6months, 1year, all)
- `--patterns`: Extract recurring patterns
- `--decisions`: Extract key decisions made
- `--timeline`: Generate activity timeline

## Integration with Claude Code

These skills are designed to work seamlessly with Claude Code sessions:

### During Development
1. **Start work**: Create a checkpoint before major changes
2. **Hit a blocker**: Use handoff to pass context to teammate
3. **Need context**: Dig for relevant past decisions or implementations

### Example Workflow
```bash
# Starting a new feature
stackmemory skills checkpoint create "Starting OAuth implementation"

# Found previous implementation
stackmemory skills dig "OAuth" --depth 6months --decisions

# Blocked and need help
stackmemory skills handoff @senior-dev "OAuth flow incomplete, need help with refresh tokens" --priority high

# Before risky change
stackmemory skills checkpoint create "Before OAuth refactor" --auto-detect-risky

# Something went wrong
stackmemory skills checkpoint restore checkpoint-xyz
```

## Advanced Usage

### Combining Skills

Skills work together to provide powerful workflows:

```bash
# Research -> Checkpoint -> Work -> Handoff
stackmemory skills dig "payment integration" --patterns
stackmemory skills checkpoint create "Before payment integration"
# ... do work ...
stackmemory skills handoff @qa-team "Payment integration ready for testing"
```

### Automation Opportunities

Skills can be integrated into your development workflow:

1. **Git Hooks**: Auto-checkpoint before commits
2. **CI/CD**: Create checkpoints before deployments
3. **Team Processes**: Standardized handoff procedures

## Configuration

Skills use your StackMemory configuration and store data in:
- Checkpoints: `~/.stackmemory/checkpoints/<project-id>/`
- Skills config: `~/.stackmemory/skills/config.json`

## Tips and Best Practices

1. **Checkpoint Often**: Create checkpoints before any risky operation
2. **Descriptive Messages**: Use clear descriptions for checkpoints and handoffs
3. **Use Patterns**: Let `dig` find patterns in your workflow to improve processes
4. **Team Coordination**: Establish team conventions for handoff priorities
5. **Time-based Searches**: Use appropriate depth for `dig` to avoid information overload

## Troubleshooting

### Skills not working?
```bash
# Check if StackMemory is initialized
stackmemory status

# View skill help
stackmemory skills help
stackmemory skills help handoff
```

### Performance issues?
- Limit search depth in `dig` command
- Clean old checkpoints periodically
- Use specific frame IDs for handoffs when possible

## Future Enhancements

Planned improvements for Claude Skills:
- Visual diff viewer for checkpoints
- Team templates for common handoffs
- Auto-learning from successful patterns
- Integration with Linear/Jira for handoffs
- Scheduled checkpoint creation
- Cross-project context search