# Agent Programming Principles

## Core Paradigm

Program is your prompt, written in natural language. It specifies initial inputs, "imports" external functions via tool descriptions, and implements business logic through control flow: sequential steps, loops, conditionals, and goto. Tool calls and user input are I/O.

## Input Sources

1. **Prepared information** - Codebase docs, style guides, architecture overviews (baked into prompt or loaded from disk)
2. **User input** - Clarifications, corrections, new requirements during execution
3. **Tool outputs** - File contents, command results, API responses

## State Management

Context is ephemeral: compaction will eventually wipe it. Context limits hit quickly with substantial state.

**Solution:** Serialize to disk using LLM-friendly formats:
- **JSON** - Structured data; LLM can surgically read/update specific fields via jq
- **Markdown** - Smaller unstructured data; load fully into context when needed

**Payoff:** Resume from any point with fresh context, sidestepping compaction entirely.

## Output Types

Outputs aren't limited to generated code. Like traditional programs producing console output, writing files, or displaying GUIs, LLM programs use tool calls to create:

- Generated code and diffs
- Editor actions (open files)
- Codebase statistics
- Change summaries
- Progress artifacts

These outputs serve multiple purposes:
- Help you review the work
- Provide input for next workflow steps
- Show program progress

## Architecture

```
Prompt (program)
  ├─ Inputs: docs + user + tools
  ├─ State: JSON (structured) / MD (unstructured) → disk
  └─ Outputs: code, diffs, summaries via tools
```

## Key Properties

- **Resumable** - Fresh context can pick up from serialized state
- **Compaction-proof** - State survives context resets
- **Explicit I/O** - Clear boundaries between program and environment
- **Composable** - Workflows chain through shared state files
