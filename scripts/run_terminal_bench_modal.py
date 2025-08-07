#!/usr/bin/env python3
"""Run terminal-bench evaluations on Modal."""

import modal
import json
from pathlib import Path

stub = modal.Stub("terminal-bench-runner")

terminal_bench_image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "terminal-bench",
    "openai",
    "anthropic",
    "google-generativeai",
)

@stub.function(
    image=terminal_bench_image,
    timeout=1800,  # 30 minutes per task
    cpu=2,
    memory=4096,
    secrets=[
        modal.Secret.from_name("openai-api-key"),
        modal.Secret.from_name("anthropic-api-key"),
    ]
)
def run_terminal_bench_task(task_id: str, model: str = "openai/gpt-4o-mini"):
    """Run a single terminal-bench task on Modal."""
    import subprocess
    import os
    
    # Set up environment
    os.environ["PYTHONPATH"] = "/terminal-bench:."
    
    # Run terminal-bench
    cmd = [
        "tb", "run",
        "--dataset", "terminal-bench-core",
        "--task-id", task_id,
        "--agent-import-path", "terminal-bench.opencode_agent:OpenCodeAgent",
        "--model", model
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    return {
        "task_id": task_id,
        "model": model,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "returncode": result.returncode
    }

@stub.function(
    image=terminal_bench_image,
    timeout=3600,  # 1 hour total
)
def run_multiple_tasks(task_ids: list[str], model: str = "openai/gpt-4o-mini"):
    """Run multiple terminal-bench tasks in parallel."""
    results = []
    
    # Use Modal's parallel map
    for result in run_terminal_bench_task.map(
        task_ids,
        kwargs={"model": model}
    ):
        results.append(result)
    
    return results

@stub.local_entrypoint()
def main(
    tasks: str = "hello-world",
    model: str = "openai/gpt-4o-mini",
    parallel: bool = False
):
    """
    Run terminal-bench tasks on Modal.
    
    Args:
        tasks: Comma-separated list of task IDs (e.g., "hello-world,fibonacci")
        model: Model to use (e.g., "openai/gpt-4o-mini", "anthropic/claude-3-haiku")
        parallel: Whether to run tasks in parallel
    """
    task_list = [t.strip() for t in tasks.split(",")]
    
    print(f"Running tasks: {task_list}")
    print(f"Model: {model}")
    print(f"Parallel: {parallel}")
    
    if parallel and len(task_list) > 1:
        with stub.run():
            results = run_multiple_tasks.remote(task_list, model)
            
        for result in results:
            print(f"\n{'='*60}")
            print(f"Task: {result['task_id']}")
            print(f"Return code: {result['returncode']}")
            print(f"Output:\n{result['stdout']}")
            if result['stderr']:
                print(f"Errors:\n{result['stderr']}")
    else:
        with stub.run():
            for task_id in task_list:
                print(f"\nRunning task: {task_id}")
                result = run_terminal_bench_task.remote(task_id, model)
                
                print(f"Return code: {result['returncode']}")
                print(f"Output:\n{result['stdout']}")
                if result['stderr']:
                    print(f"Errors:\n{result['stderr']}")

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Run terminal-bench on Modal")
    parser.add_argument(
        "--tasks",
        default="hello-world",
        help="Comma-separated list of task IDs"
    )
    parser.add_argument(
        "--model",
        default="openai/gpt-4o-mini",
        help="Model to use"
    )
    parser.add_argument(
        "--parallel",
        action="store_true",
        help="Run tasks in parallel"
    )
    
    args = parser.parse_args()
    main(tasks=args.tasks, model=args.model, parallel=args.parallel)