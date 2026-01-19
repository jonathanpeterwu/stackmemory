# Code Execution MCP Server & Pre-Hook Implementation

## Overview

This implementation provides controlled code execution capabilities for StackMemory, inspired by the `execute_code_py` project. It includes:

1. **MCP Code Execution Handler** - Safe Python/JavaScript/TypeScript execution
2. **Pre-Tool-Use Hook** - Controls and restricts tool usage
3. **Multiple Operation Modes** - Permissive, Restrictive, and Code-Only modes

## Features

### Code Execution Handler
- **Supported Languages**: Python, JavaScript, TypeScript
- **Sandboxed Environment**: Executes code in isolated temp directory
- **Timeout Protection**: Configurable timeout (default 30s)
- **Output Truncation**: Handles large outputs gracefully
- **Security Validation**: Checks for dangerous patterns before execution

### Pre-Tool-Use Hook
- **Three Modes**:
  - `permissive` - All tools allowed, dangerous ones logged
  - `restrictive` - Blocks potentially dangerous tools (Bash, Write, etc.)
  - `code_only` - Only allows code execution (pure computational environment)
- **Audit Logging**: Tracks all tool usage attempts
- **Always-Allowed Tools**: Context saving/loading, TodoWrite/Read

## Installation

```bash
# Install the hooks and handlers
./scripts/install-code-execution-hooks.sh

# Or manually:
cp templates/claude-hooks/pre-tool-use ~/.claude/hooks/
chmod +x ~/.claude/hooks/pre-tool-use
```

## Configuration

### Setting the Mode

```bash
# Option 1: Environment variable
export STACKMEMORY_TOOL_MODE=code_only  # or permissive, restrictive

# Option 2: Configuration file
echo "STACKMEMORY_TOOL_MODE=code_only" > ~/.stackmemory/tool-mode.conf
```

### Mode Descriptions

#### Permissive Mode (Default)
- All tools are allowed
- Dangerous operations are logged
- Best for general development

#### Restrictive Mode
- Blocks: Bash, Write, Edit, Delete, WebFetch
- Allows: Read, Grep, LS, TodoWrite, TodoRead
- Good for safer operations

#### Code-Only Mode
- **Only** code execution tools allowed
- Creates pure computational environment
- Similar to `execute_code_py` behavior
- Ideal for:
  - Algorithm development
  - Data analysis
  - Mathematical computations
  - Problem solving without side effects

## Usage Examples

### Python Code Execution

```python
# Via MCP tool
result = await mcp.call('code.execute', {
  language: 'python',
  code: '''
import numpy as np
import matplotlib.pyplot as plt

# Generate and analyze data
data = np.random.normal(0, 1, 1000)
mean = np.mean(data)
std = np.std(data)

print(f"Mean: {mean:.4f}")
print(f"Std Dev: {std:.4f}")
'''
})
```

### JavaScript Execution

```javascript
// Via MCP tool
result = await mcp.call('code.execute', {
  language: 'javascript',
  code: `
// Fibonacci calculation
function fib(n) {
  if (n <= 1) return n;
  return fib(n-1) + fib(n-2);
}

for (let i = 0; i < 10; i++) {
  console.log(\`fib(\${i}) = \${fib(i)}\`);
}
`
})
```

## Testing

```bash
# Test code execution handler
node scripts/test-code-execution.js

# View tool usage logs
tail -f ~/.stackmemory/tool-use.log

# Check sandbox status
node -e "
import { CodeExecutionHandler } from './dist/integrations/mcp/handlers/code-execution-handlers.js';
const h = new CodeExecutionHandler();
console.log(await h.getSandboxStatus());
"
```

## Security Features

### Code Validation
The handler validates code for dangerous patterns:
- OS module imports
- Subprocess execution
- eval/exec usage
- File system access
- Network operations

### Sandboxing
- Temporary directory isolation
- Process timeout limits
- Output size limits
- No persistent state between executions

### Audit Trail
All tool usage is logged to `~/.stackmemory/tool-use.log`:
```json
{"timestamp":"2024-01-19T08:00:00Z","tool":"Bash","allowed":false,"reason":"Blocked in code_only mode","mode":"code_only"}
{"timestamp":"2024-01-19T08:00:01Z","tool":"mcp__stackmemory__code.execute","allowed":true,"reason":"Code execution tool in code_only mode","mode":"code_only"}
```

## Comparison with execute_code_py

| Feature | execute_code_py | StackMemory Implementation |
|---------|-----------------|---------------------------|
| Language Support | Python only | Python, JavaScript, TypeScript |
| Tool Restriction | All tools blocked | Configurable modes |
| Integration | Separate MCP server | Integrated with StackMemory |
| Context Persistence | None | Full StackMemory integration |
| Audit Logging | Basic | Comprehensive logging |
| Security Validation | Runtime only | Pre-execution validation |

## Architecture

```
Claude Code
    ↓
Pre-Tool-Use Hook (filters based on mode)
    ↓
Allowed Tools Only
    ↓
MCP Server
    ↓
Code Execution Handler
    ↓
Sandboxed Process
    ↓
Results
```

## Benefits

1. **Safety**: Controlled execution environment
2. **Flexibility**: Multiple modes for different use cases
3. **Integration**: Works with existing StackMemory features
4. **Auditability**: Complete tool usage tracking
5. **Pure Computation**: Code-only mode for algorithm focus

## Troubleshooting

### Hook Not Working
```bash
# Check if hook is installed
ls -la ~/.claude/hooks/pre-tool-use

# Check mode setting
echo $STACKMEMORY_TOOL_MODE
cat ~/.stackmemory/tool-mode.conf

# View logs
tail -f ~/.stackmemory/tool-use.log
```

### Code Execution Fails
```bash
# Check Python/Node installation
python3 --version
node --version

# Test handler directly
node scripts/test-code-execution.js

# Check sandbox permissions
ls -la /tmp/stackmemory-sandbox
```

## Future Enhancements

- [ ] Support for more languages (Rust, Go, etc.)
- [ ] Container-based isolation
- [ ] Resource limits (CPU, memory)
- [ ] Persistent workspace option
- [ ] Code snippet library
- [ ] Integration with Jupyter notebooks
- [ ] Real-time collaboration features

## License

MIT - Part of StackMemory project