"""
Modal app for running terminal-bench tasks in the cloud.
This creates a web endpoint that the dashboard can call directly via HTTP.
"""

import modal
import subprocess
import json
import os
from typing import Dict, List, Optional, Any
from datetime import datetime
import asyncio
import uuid
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Create Modal app (for Modal v1.1.1)
app = modal.App("terminal-bench-cloud")

# Create FastAPI app for web endpoints
web_app = FastAPI()

# Define the Modal image with all dependencies
modal_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install([
        "git", 
        "curl", 
        "build-essential",
        "docker.io",
        "wget"
    ])
    .pip_install([
        "terminal-bench",
        "openai",
        "anthropic", 
        "boto3",
        "fastapi",
        "pydantic"
    ])
    .run_commands([
        # Install Node.js for OpenCode
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs",
        "npm install -g bun",
        # Clone and build OpenCode
        "git clone https://github.com/your-repo/opencode.git /opt/opencode || true",
    ])
)

# Store results in Modal dict (temporary storage)
results_dict = modal.Dict.from_name("terminal-bench-results", create_if_missing=True)

# Request/Response models
class RunRequest(BaseModel):
    task_ids: List[str]
    agent_type: str = "opencode"
    model: str = "gpt-4o-mini"
    dataset: str = "terminal-bench-core"
    parallel: int = 10

class RunResponse(BaseModel):
    batch_id: str
    status: str
    message: str
    task_count: int

class StatusResponse(BaseModel):
    batch_id: str
    status: str
    completed: int
    total: int
    passed: int
    failed: int
    results: Optional[Dict[str, Any]] = None


@app.function(
    image=modal_image,
    secrets=[
        modal.Secret.from_name("openai-secret"),
        modal.Secret.from_name("anthropic-secret"),
    ],
    cpu=2,
    memory=4096,
    timeout=3600,
)
def run_single_task(task_id: str, agent_type: str, model: str, dataset: str) -> Dict[str, Any]:
    """
    Run a single terminal-bench task in Modal cloud.
    This function executes entirely on Modal's infrastructure.
    """
    print(f"[Modal] Starting task: {task_id}")
    start_time = datetime.now()
    
    # Set up environment variables from secrets
    env = os.environ.copy()
    
    # Determine agent import path
    if agent_type == "opencode":
        agent_import = "terminal-bench.opencode_agent:OpenCodeAgent"
    elif agent_type == "claude":
        agent_import = "terminal-bench.claude_agent:ClaudeAgent"
    else:
        agent_import = agent_type
    
    # Prepare model string
    if "/" not in model:
        if model.startswith("gpt"):
            model = f"openai/{model}"
        elif model.startswith("claude"):
            model = f"anthropic/{model}"
    
    # Run terminal-bench
    cmd = [
        "tb", "run",
        "--dataset", dataset,
        "--task-id", task_id,
        "--agent-import-path", agent_import,
        "--model", model,
        "--no-docker",  # Run without Docker in Modal container
    ]
    
    print(f"[Modal] Executing: {' '.join(cmd)}")
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=1800,  # 30 minute timeout per task
            env=env
        )
        
        success = result.returncode == 0
        
        # Try to parse output for results
        output_lines = result.stdout.split('\n')
        passed = False
        for line in output_lines:
            if "passed" in line.lower() or "resolved" in line.lower():
                passed = True
                break
        
        duration = (datetime.now() - start_time).total_seconds()
        
        return {
            "task_id": task_id,
            "status": "completed",
            "passed": passed,
            "success": success,
            "duration": duration,
            "stdout": result.stdout[-5000:],  # Last 5000 chars
            "stderr": result.stderr[-5000:],
            "exit_code": result.returncode,
            "timestamp": datetime.now().isoformat()
        }
        
    except subprocess.TimeoutExpired:
        return {
            "task_id": task_id,
            "status": "timeout",
            "passed": False,
            "success": False,
            "duration": 1800,
            "error": "Task exceeded 30 minute timeout",
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        return {
            "task_id": task_id,
            "status": "error",
            "passed": False,
            "success": False,
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }


@app.function(
    image=modal_image,
    cpu=1,
    memory=2048,
    timeout=7200,
)
async def run_batch_coordinator(
    batch_id: str,
    task_ids: List[str],
    agent_type: str,
    model: str,
    dataset: str,
    parallel: int
) -> None:
    """
    Coordinate running multiple tasks in parallel.
    This function manages the batch execution and updates results.
    """
    print(f"[Coordinator] Starting batch {batch_id} with {len(task_ids)} tasks")
    print(f"[Coordinator] Running {parallel} tasks in parallel")
    
    # Initialize batch status
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
    
    # Run tasks in parallel using Modal's spawn
    futures = []
    for task_id in task_ids:
        future = run_single_task.spawn(task_id, agent_type, model, dataset)
        futures.append((task_id, future))
    
    # Collect results as they complete
    for task_id, future in futures:
        try:
            result = future.get()
            batch_status["tasks"][task_id] = result
            batch_status["completed"] += 1
            
            if result.get("passed", False):
                batch_status["passed"] += 1
            else:
                batch_status["failed"] += 1
            
            # Update status in dict
            results_dict[batch_id] = batch_status
            
            print(f"[Coordinator] Task {task_id}: {'✓' if result.get('passed') else '✗'} "
                  f"({batch_status['completed']}/{batch_status['total']})")
            
        except Exception as e:
            print(f"[Coordinator] Task {task_id} failed with error: {e}")
            batch_status["tasks"][task_id] = {
                "task_id": task_id,
                "status": "error",
                "error": str(e),
                "passed": False
            }
            batch_status["completed"] += 1
            batch_status["failed"] += 1
            results_dict[batch_id] = batch_status
    
    # Mark batch as completed
    batch_status["status"] = "completed"
    batch_status["end_time"] = datetime.now().isoformat()
    batch_status["pass_rate"] = batch_status["passed"] / batch_status["total"] if batch_status["total"] > 0 else 0
    
    results_dict[batch_id] = batch_status
    print(f"[Coordinator] Batch {batch_id} completed: {batch_status['passed']}/{batch_status['total']} passed")


@web_app.post("/run")
async def start_run(request: RunRequest) -> RunResponse:
    """
    HTTP endpoint to start a batch of terminal-bench tasks.
    This can be called directly from the dashboard.
    """
    batch_id = f"batch_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    
    # Validate request
    if not request.task_ids:
        raise HTTPException(status_code=400, detail="No tasks specified")
    
    if request.parallel > 100:
        raise HTTPException(status_code=400, detail="Maximum 100 parallel tasks allowed")
    
    # Start the batch coordinator asynchronously
    run_batch_coordinator.spawn(
        batch_id=batch_id,
        task_ids=request.task_ids,
        agent_type=request.agent_type,
        model=request.model,
        dataset=request.dataset,
        parallel=request.parallel
    )
    
    return RunResponse(
        batch_id=batch_id,
        status="started",
        message=f"Started batch with {len(request.task_ids)} tasks",
        task_count=len(request.task_ids)
    )


@web_app.get("/status/{batch_id}")
async def get_status(batch_id: str) -> StatusResponse:
    """
    Get the status of a batch run.
    Dashboard can poll this endpoint for progress updates.
    """
    if batch_id not in results_dict:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    batch_status = results_dict[batch_id]
    
    return StatusResponse(
        batch_id=batch_id,
        status=batch_status["status"],
        completed=batch_status["completed"],
        total=batch_status["total"],
        passed=batch_status["passed"],
        failed=batch_status["failed"],
        results=batch_status if batch_status["status"] == "completed" else None
    )


@web_app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "terminal-bench-modal"}


# Mount the FastAPI app to Modal
@app.function(
    image=modal_image,
    cpu=1,
    memory=1024,
    keep_warm=1,  # Keep one instance warm
)
@modal.asgi_app()
def fastapi_app():
    """Serve the FastAPI app as a Modal web endpoint."""
    return web_app


# For local testing and deployment
@app.local_entrypoint()
def main():
    """Deploy the app to Modal."""
    print("Deploying terminal-bench to Modal...")
    print("Web endpoint will be available at:")
    print("https://[your-modal-username]--terminal-bench-cloud-fastapi-app.modal.run")
    print("\nEndpoints:")
    print("  POST /run - Start a batch of tasks")
    print("  GET /status/{batch_id} - Check batch status")
    print("  GET /health - Health check")