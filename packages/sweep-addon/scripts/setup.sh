#!/bin/bash
# Setup script for Sweep 1.5B addon
# Installs Python dependencies and optionally downloads the model

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"

echo "Setting up Sweep 1.5B addon..."

# Check Python version
PYTHON_CMD=""
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    echo "Error: Python not found. Please install Python 3.10+"
    exit 1
fi

PYTHON_VERSION=$($PYTHON_CMD -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
echo "Found Python $PYTHON_VERSION"

# Check if version is >= 3.10
MAJOR=$($PYTHON_CMD -c 'import sys; print(sys.version_info.major)')
MINOR=$($PYTHON_CMD -c 'import sys; print(sys.version_info.minor)')

if [ "$MAJOR" -lt 3 ] || ([ "$MAJOR" -eq 3 ] && [ "$MINOR" -lt 10 ]); then
    echo "Error: Python 3.10+ required (found $PYTHON_VERSION)"
    exit 1
fi

# Install Python dependencies
echo "Installing Python dependencies..."
$PYTHON_CMD -m pip install --quiet huggingface_hub llama-cpp-python

# Optionally download model now
if [ "$1" = "--download-model" ]; then
    echo "Downloading Sweep 1.5B model (this may take a while)..."
    MODEL_DIR="$HOME/.stackmemory/models/sweep"
    mkdir -p "$MODEL_DIR"

    $PYTHON_CMD -c "
from huggingface_hub import hf_hub_download
import os

model_dir = os.path.expanduser('~/.stackmemory/models/sweep')
os.makedirs(model_dir, exist_ok=True)

print('Downloading sweep-next-edit-1.5b.q8_0.v2.gguf...')
path = hf_hub_download(
    repo_id='sweepai/sweep-next-edit-1.5B',
    filename='sweep-next-edit-1.5b.q8_0.v2.gguf',
    repo_type='model',
    local_dir=model_dir,
    local_dir_use_symlinks=False
)
print(f'Model downloaded to: {path}')
"
    echo "Model downloaded successfully!"
else
    echo "Skipping model download. Model will be downloaded on first use."
    echo "To download now, run: $0 --download-model"
fi

echo ""
echo "Setup complete!"
echo ""
echo "Usage:"
echo "  - Import in TypeScript: import { predict } from '@stackmemory/sweep-addon'"
echo "  - CLI: stackmemory sweep predict <file>"
echo ""
