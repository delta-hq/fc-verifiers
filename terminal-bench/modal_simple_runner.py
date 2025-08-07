"""
Modal app that runs the existing terminal-bench scripts.
Uses the same run-benchmark.sh and agents that already work locally.
"""

import modal
import json
import subprocess
import os
import shutil
from datetime import datetime
from typing import Dict, List, Optional, Any
from pathlib import Path
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Create Modal app
app = modal.App("terminal-bench-runner")

# Mount the parent directory to get everything we need
fc_verifiers_mount = modal.mount.from_local_dir(
    "/Users/daljeet/Documents/fc-verifiers",
    remote_path="/fc-verifiers",
    # Exclude large/unnecessary directories
    condition=lambda path: not any(x in path for x in ['.git', 'node_modules', '__pycache__', 'runs/', '.venv'])
)

# Create Modal image with dependencies
modal_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install([
        "git", 
        "curl", 
        "build-essential",
        "docker.io",
        "wget",
        "sudo"
    ])
    .pip_install([
        "fastapi",
        "pydantic",
        "openai",
        "anthropic",
        "docker",
        "requests",
        "terminal-bench"
    ])
    .run_commands([
        # Install Node.js and bun for OpenCode
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs",
        "npm install -g bun",
        
        # Make directories
        "mkdir -p /runs",
        "mkdir -p /fc-verifiers/terminal-bench",
        "mkdir -p /fc-verifiers/agent_benchmarks",
    ])
)

# Create FastAPI app
web_app = FastAPI()

# Store results
results_dict = modal.Dict.from_name("terminal-bench-results", create_if_missing=True)

# Request/Response models
class RunRequest(BaseModel):
    task_ids: List[str]
    agent_type: str = "opencode"  # or "claude"
    model: str = "gpt-4o-mini"
    dataset: str = "terminal-bench-core"
    parallel: int = 10

class RunResponse(BaseModel):
    batch_id: str
    status: str
    message: str
    task_count: int


@app.function(
    image=modal_image,
    secrets=[
        modal.Secret.from_name("openai-secret"),
        modal.Secret.from_name("anthropic-secret"),
    ],
    mounts=[fc_verifiers_mount],
    cpu=4,
    memory=8192,
    timeout=1800,
    allow_concurrent_inputs=100,
)
def run_single_task(task_id: str, agent_type: str, model: str) -> Dict[str, Any]:
    """
    Run a single terminal-bench task using the existing run-benchmark.sh script.
    """
    print(f"[Modal] Starting task: {task_id}")
    print(f"[Modal] Agent: {agent_type}, Model: {model}")
    
    start_time = datetime.now()
    
    # Files are already in the right place from mount
    # Just ensure the script is executable
    os.system("chmod +x /fc-verifiers/terminal-bench/run-benchmark.sh")
    
    # Set up environment
    env = os.environ.copy()
    env["PYTHONPATH"] = "/fc-verifiers/terminal-bench:/fc-verifiers/agent_benchmarks/terminal_bench:/fc-verifiers"
    
    # Build OpenCode if using opencode agent
    if agent_type == "opencode":
        print("[Modal] Building OpenCode binary...")
        build_cmd = "cd /fc-verifiers/terminal-bench/opencode/packages/opencode && bun install && bun run build:docker"
        subprocess.run(build_cmd, shell=True, env=env)
    
    # Use the existing run-benchmark.sh script
    cmd = [
        "/fc-verifiers/terminal-bench/run-benchmark.sh",
        "--agent", agent_type,
        "--model", model,
        "--concurrent", "1",
        "--tasks", task_id
    ]
    
    print(f"[Modal] Running: {' '.join(cmd)}")
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=1500,
            env=env,
            cwd="/fc-verifiers"
        )
        
        # Parse results
        passed = "✓ Passed: 1" in result.stdout or "Accuracy: 100" in result.stdout
        
        duration = (datetime.now() - start_time).total_seconds()
        
        return {
            "task_id": task_id,
            "status": "completed",
            "passed": passed,
            "duration": duration,
            "exit_code": result.returncode,
            "stdout_tail": result.stdout[-5000:] if result.stdout else "",
            "stderr_tail": result.stderr[-5000:] if result.stderr else "",
            "timestamp": datetime.now().isoformat()
        }
        
    except subprocess.TimeoutExpired:
        return {
            "task_id": task_id,
            "status": "timeout",
            "passed": False,
            "duration": 1500,
            "error": "Task timeout",
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        return {
            "task_id": task_id,
            "status": "error",
            "passed": False,
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }


@app.function(
    image=modal_image,
    cpu=2,
    memory=4096,
    timeout=7200,
)
async def run_batch(
    batch_id: str,
    task_ids: List[str],
    agent_type: str,
    model: str,
    parallel: int
) -> None:
    """
    Run multiple tasks in parallel.
    """
    print(f"[Batch] Starting {len(task_ids)} tasks, parallel={parallel}")
    
    batch_status = {
        "batch_id": batch_id,
        "status": "running",
        "total": len(task_ids),
        "completed": 0,
        "passed": 0,
        "failed": 0,
        "start_time": datetime.now().isoformat(),
        "tasks": {}
    }
    
    results_dict[batch_id] = batch_status
    
    # Run tasks in parallel
    futures = []
    for task_id in task_ids:
        future = run_single_task.spawn(task_id, agent_type, model)
        futures.append((task_id, future))
    
    # Collect results
    for task_id, future in futures:
        try:
            result = future.get()
            batch_status["tasks"][task_id] = result
            batch_status["completed"] += 1
            
            if result.get("passed", False):
                batch_status["passed"] += 1
                print(f"✓ {task_id} passed")
            else:
                batch_status["failed"] += 1
                print(f"✗ {task_id} failed")
            
            results_dict[batch_id] = batch_status
            
        except Exception as e:
            print(f"Error with {task_id}: {e}")
            batch_status["failed"] += 1
            batch_status["completed"] += 1
    
    batch_status["status"] = "completed"
    batch_status["end_time"] = datetime.now().isoformat()
    batch_status["pass_rate"] = batch_status["passed"] / batch_status["total"] if batch_status["total"] > 0 else 0
    
    results_dict[batch_id] = batch_status
    print(f"[Batch] Complete: {batch_status['passed']}/{batch_status['total']} passed")


@web_app.post("/run")
async def start_run(request: RunRequest) -> RunResponse:
    """Start a batch of tasks."""
    import uuid
    
    batch_id = f"batch_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    
    # Start batch coordinator
    run_batch.spawn(
        batch_id=batch_id,
        task_ids=request.task_ids,
        agent_type=request.agent_type,
        model=request.model,
        parallel=min(request.parallel, 20)  # Cap at 20 parallel
    )
    
    return RunResponse(
        batch_id=batch_id,
        status="started",
        message=f"Started {len(request.task_ids)} tasks using existing scripts",
        task_count=len(request.task_ids)
    )


@web_app.get("/status/{batch_id}")
async def get_status(batch_id: str):
    """Get batch status."""
    if batch_id not in results_dict:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    return results_dict[batch_id]


@web_app.get("/health")
async def health_check():
    """Health check."""
    return {
        "status": "healthy",
        "service": "terminal-bench-runner",
        "message": "Using existing run-benchmark.sh script"
    }


@app.function(
    image=modal_image,
    cpu=1,
    memory=1024,
    min_containers=1,
)
@modal.asgi_app()
def fastapi_app():
    """Serve the FastAPI app."""
    return web_app


@app.local_entrypoint()
def main():
    """Deploy the app."""
    print("Deploying Terminal-Bench Runner (using existing scripts)...")
    print("This will run your existing run-benchmark.sh in Modal cloud!")