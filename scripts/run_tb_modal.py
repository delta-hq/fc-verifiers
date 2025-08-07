#!/usr/bin/env python3
"""Run terminal-bench evaluations on Modal."""

import modal
import sys

app = modal.App("terminal-bench")

# Create a custom image with terminal-bench and dependencies
image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("terminal-bench", "openai", "anthropic")
    .run_commands("apt-get update && apt-get install -y git")
)

@app.function(
    image=image,
    timeout=1800,  # 30 minutes
    secrets=[modal.Secret.from_name("my-openai-secret")],
)
def run_task(task_id: str, model: str = "openai/gpt-4o-mini"):
    """Run a single terminal-bench task."""
    import subprocess
    import os
    
    # Run terminal-bench command
    cmd = [
        "tb", "run",
        "--dataset", "terminal-bench-core",
        "--task-id", task_id,
        "--model", model
    ]
    
    print(f"Running command: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    return {
        "task_id": task_id,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "returncode": result.returncode
    }

@app.local_entrypoint()
def main(task: str = "hello-world", model: str = "openai/gpt-4o-mini"):
    """Run a terminal-bench task on Modal."""
    print(f"Running task '{task}' with model '{model}' on Modal...")
    
    result = run_task.remote(task, model)
    
    print(f"\nTask: {result['task_id']}")
    print(f"Return code: {result['returncode']}")
    print(f"\nOutput:\n{result['stdout']}")
    if result['stderr']:
        print(f"\nErrors:\n{result['stderr']}")

if __name__ == "__main__":
    task = sys.argv[1] if len(sys.argv) > 1 else "hello-world"
    model = sys.argv[2] if len(sys.argv) > 2 else "openai/gpt-4o-mini"
    main(task, model)