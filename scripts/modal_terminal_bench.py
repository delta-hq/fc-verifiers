"""
Modal app for running terminal-bench tasks concurrently in the cloud.
This allows massive parallelization of terminal-bench evaluations.
"""

import modal
import json
import os
import subprocess
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional
import tempfile
import shutil

# Define the Modal app
app = modal.App("terminal-bench-runner")

# Create a custom Docker image with terminal-bench and dependencies
terminal_bench_image = (
    modal.Image.debian_slim()
    .apt_install(
        "git", "curl", "tmux", "docker.io", "python3-pip", 
        "python3-venv", "build-essential", "nodejs", "npm"
    )
    .run_commands(
        # Install bun for OpenCode building
        "curl -fsSL https://bun.sh/install | bash",
        "export PATH=$HOME/.bun/bin:$PATH",
        # Install terminal-bench
        "pip install terminal-bench",
        # Install uv for package management
        "curl -LsSf https://astral.sh/uv/install.sh | sh",
    )
    .pip_install(
        "terminal-bench",
        "openai",
        "anthropic",
        "google-generativeai",
    )
)

# Create a volume for storing results
results_volume = modal.Volume.from_name("terminal-bench-results", create_if_missing=True)

# Create a network file system for sharing code
code_volume = modal.NetworkFileSystem.from_name("terminal-bench-code", create_if_missing=True)


@app.function(
    image=terminal_bench_image,
    volumes={"/results": results_volume, "/code": code_volume},
    timeout=1800,  # 30 minutes per task
    cpu=2,
    memory=4096,
    secrets=[
        modal.Secret.from_name("openai-api-key"),
        modal.Secret.from_name("anthropic-api-key"),
        modal.Secret.from_name("openrouter-api-key"),
    ]
)
def run_single_task(
    task_id: str,
    agent_type: str = "opencode",
    model: str = "openai/gpt-4o-mini",
    run_id: Optional[str] = None
) -> Dict[str, Any]:
    """Run a single terminal-bench task on Modal."""
    
    if not run_id:
        run_id = datetime.now().strftime("%Y-%m-%d__%H-%M-%S")
    
    # Set up environment variables from secrets
    env = os.environ.copy()
    
    # Determine agent configuration
    if agent_type == "claude":
        agent_path = "agent_benchmarks.terminal_bench.claude_opus4_agent:ClaudeOpus4Agent"
        if model == "openai/gpt-4o-mini":
            model = "anthropic/claude-opus-4"
    else:
        agent_path = "opencode_agent:OpenCodeAgent"
    
    # Create a temporary directory for this run
    temp_dir = Path(f"/tmp/tb-run-{task_id}")
    temp_dir.mkdir(parents=True, exist_ok=True)
    
    # Run the terminal-bench task
    cmd = [
        "tb", "run",
        "--dataset", "terminal-bench-core",
        "--task-id", task_id,
        "--agent-import-path", agent_path,
        "--model", model,
        "--output-dir", str(temp_dir)
    ]
    
    print(f"Running task {task_id} with command: {' '.join(cmd)}")
    
    try:
        result = subprocess.run(
            cmd,
            env=env,
            capture_output=True,
            text=True,
            timeout=1500  # 25 minutes
        )
        
        # Parse results
        results_file = temp_dir / "results.json"
        if results_file.exists():
            with open(results_file) as f:
                task_results = json.load(f)
        else:
            task_results = {
                "task_id": task_id,
                "status": "failed",
                "error": "No results file generated"
            }
        
        # Save results to volume
        results_path = Path(f"/results/{run_id}/{task_id}")
        results_path.mkdir(parents=True, exist_ok=True)
        
        # Copy all output files
        if temp_dir.exists():
            for item in temp_dir.iterdir():
                if item.is_file():
                    shutil.copy2(item, results_path)
                elif item.is_dir():
                    shutil.copytree(item, results_path / item.name, dirs_exist_ok=True)
        
        # Add metadata
        task_results["task_id"] = task_id
        task_results["run_id"] = run_id
        task_results["stdout"] = result.stdout
        task_results["stderr"] = result.stderr
        task_results["return_code"] = result.returncode
        
        return task_results
        
    except subprocess.TimeoutExpired:
        return {
            "task_id": task_id,
            "status": "timeout",
            "error": "Task execution timed out"
        }
    except Exception as e:
        return {
            "task_id": task_id,
            "status": "error",
            "error": str(e)
        }
    finally:
        # Clean up temp directory
        if temp_dir.exists():
            shutil.rmtree(temp_dir)


@app.function(
    image=terminal_bench_image,
    volumes={"/results": results_volume},
    timeout=3600,
)
def run_batch_tasks(
    task_ids: List[str],
    agent_type: str = "opencode",
    model: str = "openai/gpt-4o-mini",
    max_concurrent: int = 10
) -> Dict[str, Any]:
    """Orchestrate running multiple tasks concurrently."""
    
    run_id = datetime.now().strftime("%Y-%m-%d__%H-%M-%S")
    print(f"Starting batch run {run_id} with {len(task_ids)} tasks")
    print(f"Max concurrent: {max_concurrent}")
    
    # Run tasks concurrently using Modal's map
    futures = []
    for task_id in task_ids:
        future = run_single_task.spawn(task_id, agent_type, model, run_id)
        futures.append(future)
    
    # Collect results
    results = []
    passed = 0
    failed = 0
    
    for future in futures:
        try:
            result = future.get()
            results.append(result)
            
            # Check if task passed
            if result.get("status") == "passed" or result.get("return_code") == 0:
                passed += 1
            else:
                failed += 1
                
        except Exception as e:
            print(f"Error getting result: {e}")
            failed += 1
            results.append({
                "status": "error",
                "error": str(e)
            })
    
    # Aggregate results
    summary = {
        "run_id": run_id,
        "total_tasks": len(task_ids),
        "passed": passed,
        "failed": failed,
        "accuracy": passed / len(task_ids) if task_ids else 0,
        "results": results,
        "timestamp": datetime.now().isoformat()
    }
    
    # Save summary to results volume
    summary_path = Path(f"/results/{run_id}/summary.json")
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)
    
    print(f"Batch run complete: {passed}/{len(task_ids)} passed")
    return summary


@app.function(image=terminal_bench_image)
def list_all_tasks() -> List[str]:
    """Get list of all available terminal-bench tasks."""
    
    # This would normally query terminal-bench for available tasks
    # For now, returning the common test tasks
    return [
        "hello-world",
        "sqlite-with-gcov", 
        "fibonacci-server",
        "build-tcc-qemu",
        "password-recovery",
        "crack-7z-hash",
        "create-react-app",
        "flask-todo-app",
        "data-analysis-pandas",
        "web-scraper-beautifulsoup",
        "api-client-requests",
        # Add more tasks as needed
    ]


@app.local_entrypoint()
def main(
    tasks: str = None,
    agent: str = "opencode",
    model: str = "openai/gpt-4o-mini",
    concurrent: int = 10,
    all_tasks: bool = False
):
    """
    Main entrypoint for running terminal-bench on Modal.
    
    Examples:
        # Run specific tasks
        modal run scripts/modal_terminal_bench.py --tasks hello-world,fibonacci-server
        
        # Run all tasks with high concurrency
        modal run scripts/modal_terminal_bench.py --all-tasks --concurrent 50
        
        # Run with Claude agent
        modal run scripts/modal_terminal_bench.py --agent claude --tasks hello-world
    """
    
    if all_tasks:
        task_list = list_all_tasks.remote()
    elif tasks:
        task_list = [t.strip() for t in tasks.split(",")]
    else:
        print("Error: Specify either --tasks or --all-tasks")
        return
    
    print(f"Running {len(task_list)} tasks on Modal with {concurrent} concurrent workers")
    print(f"Agent: {agent}, Model: {model}")
    
    # Run the batch
    results = run_batch_tasks.remote(
        task_ids=task_list,
        agent_type=agent,
        model=model,
        max_concurrent=concurrent
    )
    
    # Print summary
    print("\n" + "="*50)
    print("RESULTS SUMMARY")
    print("="*50)
    print(f"Run ID: {results['run_id']}")
    print(f"Total Tasks: {results['total_tasks']}")
    print(f"Passed: {results['passed']}")
    print(f"Failed: {results['failed']}")
    print(f"Accuracy: {results['accuracy']:.1%}")
    
    if results['failed'] > 0:
        print("\nFailed tasks:")
        for r in results['results']:
            if r.get('status') != 'passed' and r.get('return_code') != 0:
                print(f"  - {r.get('task_id', 'unknown')}: {r.get('error', 'failed')}")
    
    print(f"\nResults saved to Modal volume: terminal-bench-results/{results['run_id']}/")
    
    return results


if __name__ == "__main__":
    # This allows the script to be run directly with Modal CLI
    modal.runner.deploy_app(app)