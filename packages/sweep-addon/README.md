# @stackmemory/sweep-addon

Optional addon for StackMemory that provides next-edit predictions using the Sweep 1.5B model.

## Overview

Sweep 1.5B is a code completion model trained to predict the next edit you'll make based on:
- Current file content
- Recent diffs (what you just changed)
- Context from other files in your codebase

## Requirements

- Node.js 18+
- Python 3.10+
- pip packages: `huggingface_hub`, `llama-cpp-python`

## Installation

### Via CLI

```bash
stackmemory sweep setup
```

This installs the required Python dependencies.

### Manual

```bash
pip install huggingface_hub llama-cpp-python
```

## Usage

### CLI

```bash
# Check status
stackmemory sweep status

# Predict next edit for a file
stackmemory sweep predict src/app.ts

# Setup with model pre-download
stackmemory sweep setup --download
```

### Programmatic (TypeScript)

```typescript
import { predict, checkStatus } from '@stackmemory/sweep-addon';

// Check if addon is ready
const status = await checkStatus();
console.log(status.installed, status.model_downloaded);

// Run prediction
const result = await predict({
  file_path: 'src/app.ts',
  current_content: '...',
  context_files: {
    'src/utils.ts': '...'
  },
  recent_diffs: [{
    file_path: 'src/app.ts',
    original: '...',
    updated: '...'
  }]
});

if (result.success) {
  console.log(result.predicted_content);
}
```

## Model

The Sweep 1.5B model (~1.5GB GGUF Q8 quantized) is downloaded from HuggingFace on first use:
- Repo: `sweepai/sweep-next-edit-1.5B`
- File: `sweep-next-edit-1.5b.q8_0.v2.gguf`
- Location: `~/.stackmemory/models/sweep/`

## License

MIT
