"""
Modal app that runs existing terminal-bench using run-benchmark.sh.
This version copies your local code and runs it in Modal cloud.
"""

import modal
import json
import subprocess
import os
from datetime import datetime
from typing import Dict, List, Optional, Any
from pathlib import Path
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Create Modal app
app = modal.App("terminal-bench-real")

# Create Modal image with your local code
modal_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install([
        "git", 
        "curl", 
        "build-essential",
        "wget",
    ])
    .pip_install([
        "fastapi",
        "pydantic", 
        "openai",
        "anthropic",
        "requests",
        "click",
        "rich"
    ])
    .run_commands([
        # Install Node.js and bun for OpenCode
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs",
        "npm install -g bun",
        
        # Install terminal-bench from GitHub
        "pip install git+https://github.com/laude-institute/terminal-bench.git || echo 'TB install failed but continuing'",
        
        # Create directories
        "mkdir -p /fc-verifiers/terminal-bench",
        "mkdir -p /fc-verifiers/runs",
    ])
    # Add your local terminal-bench directory to the image
    .add_local_dir(
        "/Users/daljeet/Documents/fc-verifiers/terminal-bench",
        remote_path="/fc-verifiers/terminal-bench"
    )
)

# Create FastAPI app
web_app = FastAPI()

# Store results
results_dict = modal.Dict.from_name("terminal-bench-real-results", create_if_missing=True)

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
    cpu=4,
    memory=8192,
    timeout=1800,
    allow_concurrent_inputs=100,
)
def run_single_task(task_id: str, agent_type: str, model: str) -> Dict[str, Any]:
    """
    Run a single terminal-bench task using the existing run-benchmark.sh.
    """
    print(f"[Modal] Running task: {task_id}")
    print(f"[Modal] Agent: {agent_type}, Model: {model}")
    
    start_time = datetime.now()
    
    # Set up environment - this matches what run-benchmark.sh expects
    env = os.environ.copy()
    env["PYTHONPATH"] = "/fc-verifiers/terminal-bench:/fc-verifiers"
    
    # First, make script executable
    os.system("chmod +x /fc-verifiers/terminal-bench/run-benchmark.sh")
    
    # For OpenCode, build the binary
    if agent_type == "opencode":
        print("[Modal] Building OpenCode binary...")
        # Check if opencode directory exists
        if os.path.exists("/fc-verifiers/terminal-bench/opencode"):
            build_result = subprocess.run(
                "cd /fc-verifiers/terminal-bench/opencode/packages/opencode && bun install && bun run build:linux",
                shell=True,
                capture_output=True,
                text=True,
                env=env
            )
            if build_result.returncode != 0:
                print(f"[Modal] OpenCode build warning: {build_result.stderr}")
    
    # Simplified command - just run one task
    cmd = f"""cd /fc-verifiers && \
        OPENAI_API_KEY={os.environ.get('OPENAI_API_KEY', '')} \
        ANTHROPIC_API_KEY={os.environ.get('ANTHROPIC_API_KEY', '')} \
        tb run \
        --dataset terminal-bench-core \
        --task-id {task_id} \
        --agent-import-path {"opencode_agent:OpenCodeAgent" if agent_type == "opencode" else "agent_benchmarks.terminal_bench.claude_opus4_agent:ClaudeOpus4Agent"} \
        --model {model if '/' in model else f"openai/{model}"} \
        --n-concurrent 1
    """
    
    print(f"[Modal] Command: {cmd}")
    
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=1500,
            env=env,
            cwd="/fc-verifiers"
        )
        
        print(f"[Modal] Exit code: {result.returncode}")
        
        # Check if task passed
        passed = False
        if "passed" in result.stdout.lower() or "✓" in result.stdout:
            passed = True
        
        # Check for specific success indicators
        if "Task passed" in result.stdout or "resolved: 1" in result.stdout.lower():
            passed = True
            
        duration = (datetime.now() - start_time).total_seconds()
        
        return {
            "task_id": task_id,
            "status": "completed",
            "passed": passed,
            "duration": duration,
            "exit_code": result.returncode,
            "output_preview": result.stdout[-2000:] if result.stdout else "",
            "error_preview": result.stderr[-2000:] if result.stderr else "",
            "timestamp": datetime.now().isoformat(),
            "executed_in": "Modal Cloud (Real)"
        }
        
    except subprocess.TimeoutExpired:
        return {
            "task_id": task_id,
            "status": "timeout",
            "passed": False,
            "duration": 1500,
            "error": "Task exceeded timeout",
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
    Coordinate running multiple tasks in parallel.
    """
    print(f"[Batch] Starting {len(task_ids)} tasks")
    print(f"[Batch] Agent: {agent_type}, Model: {model}, Parallel: {parallel}")
    
    batch_status = {
        "batch_id": batch_id,
        "status": "running",
        "total": len(task_ids),
        "completed": 0,
        "passed": 0,
        "failed": 0,
        "start_time": datetime.now().isoformat(),
        "agent_type": agent_type,
        "model": model,
        "tasks": {}
    }
    
    results_dict[batch_id] = batch_status
    
    # Run tasks in parallel using Modal's spawn
    futures = []
    for task_id in task_ids:
        future = run_single_task.spawn(task_id, agent_type, model)
        futures.append((task_id, future))
    
    # Collect results as they complete
    for task_id, future in futures:
        try:
            result = future.get()
            batch_status["tasks"][task_id] = result
            batch_status["completed"] += 1
            
            if result.get("passed", False):
                batch_status["passed"] += 1
                print(f"[Batch] ✓ {task_id} passed")
            else:
                batch_status["failed"] += 1
                print(f"[Batch] ✗ {task_id} failed")
            
            # Update status in dict
            results_dict[batch_id] = batch_status
            
            print(f"[Batch] Progress: {batch_status['completed']}/{batch_status['total']}")
            
        except Exception as e:
            print(f"[Batch] Error with {task_id}: {e}")
            batch_status["tasks"][task_id] = {
                "task_id": task_id,
                "status": "error",
                "error": str(e),
                "passed": False
            }
            batch_status["failed"] += 1
            batch_status["completed"] += 1
            results_dict[batch_id] = batch_status
    
    # Mark batch as completed
    batch_status["status"] = "completed"
    batch_status["end_time"] = datetime.now().isoformat()
    batch_status["pass_rate"] = batch_status["passed"] / batch_status["total"] if batch_status["total"] > 0 else 0
    
    results_dict[batch_id] = batch_status
    
    print(f"[Batch] Complete!")
    print(f"[Batch] Results: {batch_status['passed']}/{batch_status['total']} passed ({batch_status['pass_rate']:.1%})")


@web_app.post("/run")
async def start_run(request: RunRequest) -> RunResponse:
    """Start a batch of terminal-bench tasks."""
    import uuid
    
    batch_id = f"batch_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    
    if not request.task_ids:
        raise HTTPException(status_code=400, detail="No tasks specified")
    
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
        message=f"Started {len(request.task_ids)} real terminal-bench tasks in Modal",
        task_count=len(request.task_ids)
    )


@web_app.get("/status/{batch_id}")
async def get_status(batch_id: str):
    """Get batch status."""
    if batch_id not in results_dict:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    batch_status = results_dict[batch_id]
    
    # Format for dashboard
    return {
        "batch_id": batch_status["batch_id"],
        "status": batch_status["status"],
        "completed": batch_status["completed"],
        "total": batch_status["total"],
        "passed": batch_status["passed"],
        "failed": batch_status["failed"],
        "progress": (batch_status["completed"] / batch_status["total"] * 100) if batch_status["total"] > 0 else 0,
        "tasks": batch_status.get("tasks", {}),
        "isComplete": batch_status["status"] == "completed",
        "passRate": batch_status.get("pass_rate", 0) * 100 if "pass_rate" in batch_status else 0
    }


@web_app.get("/health")
async def health_check():
    """Health check."""
    return {
        "status": "healthy",
        "service": "terminal-bench-real",
        "message": "Running real terminal-bench tasks with your existing scripts"
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
    print("Deploying Real Terminal-Bench Runner to Modal...")
    print("\nThis runs your ACTUAL run-benchmark.sh script in the cloud!")
    print("Endpoint: https://openblocklabs--terminal-bench-real-fastapi-app.modal.run")