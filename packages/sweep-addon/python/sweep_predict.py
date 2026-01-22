#!/usr/bin/env python3
"""
Sweep Next-Edit 1.5B prediction script for StackMemory integration.

This script provides next-edit predictions using the Sweep 1.5B model.
It reads input from stdin (JSON) and outputs predictions to stdout.

Usage:
    echo '{"file_path": "...", "current_content": "...", ...}' | python sweep_predict.py
"""
import json
import sys
import os
from pathlib import Path

# Model configuration
MODEL_REPO = "sweepai/sweep-next-edit-1.5B"
MODEL_FILENAME = "sweep-next-edit-1.5b.q8_0.v2.gguf"
MODEL_DIR = Path.home() / ".stackmemory" / "models" / "sweep"


def get_model_path() -> Path:
    """Get path to the model file, downloading if necessary."""
    model_path = MODEL_DIR / MODEL_FILENAME

    if model_path.exists():
        return model_path

    # Download model
    print(json.dumps({"status": "downloading", "message": "Downloading Sweep 1.5B model..."}), file=sys.stderr)

    try:
        from huggingface_hub import hf_hub_download

        MODEL_DIR.mkdir(parents=True, exist_ok=True)

        downloaded_path = hf_hub_download(
            repo_id=MODEL_REPO,
            filename=MODEL_FILENAME,
            repo_type="model",
            local_dir=MODEL_DIR,
            local_dir_use_symlinks=False
        )

        print(json.dumps({"status": "downloaded", "path": str(downloaded_path)}), file=sys.stderr)
        return Path(downloaded_path)

    except ImportError:
        print(json.dumps({
            "error": "huggingface_hub not installed",
            "message": "Run: pip install huggingface_hub llama-cpp-python"
        }))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": "download_failed", "message": str(e)}))
        sys.exit(1)


def build_prompt(
    context_files: dict[str, str],
    recent_diffs: list[dict[str, str]],
    file_path: str,
    original_content: str,
    current_content: str,
) -> str:
    """
    Build a prompt following Sweep Next Edit's training format.

    Format uses <|file_sep|> tokens to separate sections:
    - Context files
    - Recent diffs (original/updated blocks)
    - Original file state
    - Current file state
    - Updated file state (to be predicted)
    """
    prompt_parts = []

    # Add context files
    for path, content in context_files.items():
        prompt_parts.append(f"<|file_sep|>{path}")
        prompt_parts.append(content)

    # Add recent diffs
    for diff in recent_diffs:
        prompt_parts.append(f"<|file_sep|>{diff['file_path']}.diff")
        prompt_parts.append("original:")
        prompt_parts.append(diff['original'])
        prompt_parts.append("updated:")
        prompt_parts.append(diff['updated'])

    # Add original and current states
    prompt_parts.append(f"<|file_sep|>original/{file_path}")
    prompt_parts.append(original_content)
    prompt_parts.append(f"<|file_sep|>current/{file_path}")
    prompt_parts.append(current_content)
    prompt_parts.append(f"<|file_sep|>updated/{file_path}")

    return "\n".join(prompt_parts)


def predict(input_data: dict) -> dict:
    """Run prediction using the Sweep model."""
    try:
        from llama_cpp import Llama
    except ImportError:
        return {
            "error": "llama_cpp not installed",
            "message": "Run: pip install llama-cpp-python"
        }

    model_path = get_model_path()

    # Build prompt
    prompt = build_prompt(
        context_files=input_data.get("context_files", {}),
        recent_diffs=input_data.get("recent_diffs", []),
        file_path=input_data["file_path"],
        original_content=input_data.get("original_content", input_data["current_content"]),
        current_content=input_data["current_content"],
    )

    # Load model and generate
    try:
        llm = Llama(
            model_path=str(model_path),
            n_ctx=8192,
            n_threads=os.cpu_count() or 4,
            verbose=False
        )

        import time
        start_time = time.time()

        output = llm(
            prompt,
            max_tokens=input_data.get("max_tokens", 512),
            temperature=input_data.get("temperature", 0.0),
            stop=["<|file_sep|>", "</s>"],
        )

        end_time = time.time()

        predicted_content = output["choices"][0]["text"]

        return {
            "success": True,
            "predicted_content": predicted_content,
            "file_path": input_data["file_path"],
            "latency_ms": int((end_time - start_time) * 1000),
            "tokens_generated": output["usage"]["completion_tokens"]
        }

    except Exception as e:
        return {
            "error": "prediction_failed",
            "message": str(e)
        }


def main():
    """Main entry point - reads JSON from stdin, outputs prediction to stdout."""
    try:
        # Read input from stdin
        input_text = sys.stdin.read()
        if not input_text.strip():
            print(json.dumps({"error": "no_input", "message": "No input provided"}))
            sys.exit(1)

        input_data = json.loads(input_text)

        # Validate required fields
        if "file_path" not in input_data:
            print(json.dumps({"error": "missing_field", "message": "file_path is required"}))
            sys.exit(1)
        if "current_content" not in input_data:
            print(json.dumps({"error": "missing_field", "message": "current_content is required"}))
            sys.exit(1)

        # Run prediction
        result = predict(input_data)
        print(json.dumps(result))

    except json.JSONDecodeError as e:
        print(json.dumps({"error": "invalid_json", "message": str(e)}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": "unexpected", "message": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
