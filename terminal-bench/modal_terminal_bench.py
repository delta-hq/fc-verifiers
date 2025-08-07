"""
Modal app for running real terminal-bench tasks in the cloud.
Executes actual terminal-bench benchmarks in parallel.
"""

import modal
import json
import subprocess
import os
import tempfile
import shutil
from datetime import datetime
from typing import Dict, List, Optional, Any
from pathlib import Path
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Create Modal app
app = modal.App("terminal-bench-runner")

# Create Modal image with terminal-bench and dependencies
modal_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install([
        "git", 
        "curl", 
        "build-essential",
        "docker.io",
        "wget",
        "sudo",
        "ca-certificates",
        "gnupg"
    ])
    .pip_install([
        "fastapi",
        "pydantic",
        "openai",
        "anthropic", 
        "boto3",
        "requests",
        "pyyaml",
        "rich",
        "click",
        "typer",
        "pytest",
        "docker"
    ])
    .run_commands([
        # Install Node.js for OpenCode
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs",
        "npm install -g bun",
        
        # Install terminal-bench from GitHub
        "git clone https://github.com/laude-institute/terminal-bench.git /opt/terminal-bench",
        "cd /opt/terminal-bench && pip install -e .",
        
        # Clone OpenCode (we'll build it at runtime)
        "git clone https://github.com/openc0de/opencode.git /opt/opencode || true",
    ])
    .env({"PYTHONPATH": "/opt:/opt/terminal-bench"})
)

# Create FastAPI app
web_app = FastAPI()

# Store results
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
    cpu=4,
    memory=8192,
    timeout=1800,  # 30 minutes per task
    allow_concurrent_inputs=100,
)
def run_terminal_bench_task(task_id: str, agent_type: str, model: str, dataset: str) -> Dict[str, Any]:
    """
    Run a single terminal-bench task in Modal cloud.
    """
    import sys
    sys.path.insert(0, '/opt/terminal-bench')
    
    print(f"[Modal] Starting terminal-bench task: {task_id}")
    print(f"[Modal] Agent: {agent_type}, Model: {model}, Dataset: {dataset}")
    
    start_time = datetime.now()
    
    # Set up environment
    env = os.environ.copy()
    
    # Create temporary directory for this run
    with tempfile.TemporaryDirectory() as temp_dir:
        run_dir = Path(temp_dir) / "run"
        run_dir.mkdir(parents=True, exist_ok=True)
        
        # Determine agent import path
        if agent_type == "opencode":
            # For OpenCode, we'll use a simple wrapper that calls the OpenAI API directly
            agent_import = "agents.openai_agent:OpenAIAgent"
        elif agent_type == "claude":
            agent_import = "agents.claude_agent:ClaudeAgent"
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
            "--output-dir", str(run_dir),
            "--no-docker",  # Don't use Docker inside Modal container
        ]
        
        print(f"[Modal] Command: {' '.join(cmd)}")
        
        try:
            # Run the benchmark
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=1500,  # 25 minute timeout
                env=env,
                cwd="/opt/terminal-bench"
            )
            
            print(f"[Modal] Exit code: {result.returncode}")
            
            # Parse results
            success = result.returncode == 0
            
            # Try to find results.json
            results_file = run_dir / "results.json"
            passed = False
            score = 0
            
            if results_file.exists():
                with open(results_file, "r") as f:
                    task_results = json.load(f)
                    passed = task_results.get("passed", False)
                    score = task_results.get("score", 0)
            else:
                # Try to parse from output
                output_lines = result.stdout.split('\n')
                for line in output_lines:
                    if "passed" in line.lower() or "resolved" in line.lower():
                        if "true" in line.lower() or "1" in line:
                            passed = True
                            break
            
            duration = (datetime.now() - start_time).total_seconds()
            
            # Get last 10KB of output for debugging
            stdout_tail = result.stdout[-10000:] if result.stdout else ""
            stderr_tail = result.stderr[-10000:] if result.stderr else ""
            
            return {
                "task_id": task_id,
                "status": "completed",
                "passed": passed,
                "success": success,
                "score": score,
                "duration": duration,
                "stdout_tail": stdout_tail,
                "stderr_tail": stderr_tail,
                "exit_code": result.returncode,
                "timestamp": datetime.now().isoformat(),
                "executed_in": "Modal Cloud (Real Terminal-Bench)"
            }
            
        except subprocess.TimeoutExpired:
            duration = (datetime.now() - start_time).total_seconds()
            return {
                "task_id": task_id,
                "status": "timeout",
                "passed": False,
                "success": False,
                "duration": duration,
                "error": "Task exceeded 25 minute timeout",
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            duration = (datetime.now() - start_time).total_seconds()
            return {
                "task_id": task_id,
                "status": "error",
                "passed": False,
                "success": False,
                "duration": duration,
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }


@app.function(
    image=modal_image,
    cpu=2,
    memory=4096,
    timeout=7200,  # 2 hours for batch
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
    Coordinate running multiple terminal-bench tasks in parallel.
    """
    print(f"[Coordinator] Starting batch {batch_id} with {len(task_ids)} tasks")
    print(f"[Coordinator] Running {parallel} tasks in parallel")
    print(f"[Coordinator] Agent: {agent_type}, Model: {model}")
    
    # Initialize batch status
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
        future = run_terminal_bench_task.spawn(task_id, agent_type, model, dataset)
        futures.append((task_id, future))
        
        # Limit concurrent tasks
        if len(futures) >= parallel:
            # Wait for some to complete before adding more
            completed_future = futures.pop(0)
            task_id_completed, future_completed = completed_future
            try:
                result = future_completed.get()
                batch_status["tasks"][task_id_completed] = result
                batch_status["completed"] += 1
                
                if result.get("passed", False):
                    batch_status["passed"] += 1
                    print(f"[Coordinator] ✓ {task_id_completed} passed")
                else:
                    batch_status["failed"] += 1
                    print(f"[Coordinator] ✗ {task_id_completed} failed")
                
                results_dict[batch_id] = batch_status
            except Exception as e:
                print(f"[Coordinator] Error with {task_id_completed}: {e}")
                batch_status["failed"] += 1
                batch_status["completed"] += 1
    
    # Collect remaining results
    for task_id, future in futures:
        try:
            result = future.get()
            batch_status["tasks"][task_id] = result
            batch_status["completed"] += 1
            
            if result.get("passed", False):
                batch_status["passed"] += 1
                print(f"[Coordinator] ✓ {task_id} passed")
            else:
                batch_status["failed"] += 1
                print(f"[Coordinator] ✗ {task_id} failed")
            
            results_dict[batch_id] = batch_status
            
        except Exception as e:
            print(f"[Coordinator] Error with {task_id}: {e}")
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
    
    # Calculate total duration
    start = datetime.fromisoformat(batch_status["start_time"])
    end = datetime.fromisoformat(batch_status["end_time"])
    batch_status["total_duration"] = (end - start).total_seconds()
    
    results_dict[batch_id] = batch_status
    
    print(f"[Coordinator] Batch {batch_id} completed!")
    print(f"[Coordinator] Results: {batch_status['passed']}/{batch_status['total']} passed")
    print(f"[Coordinator] Pass rate: {batch_status['pass_rate']:.1%}")
    print(f"[Coordinator] Total time: {batch_status['total_duration']:.1f}s")


@web_app.post("/run")
async def start_run(request: RunRequest) -> RunResponse:
    """
    HTTP endpoint to start a batch of terminal-bench tasks.
    """
    import uuid
    
    batch_id = f"batch_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    
    if not request.task_ids:
        raise HTTPException(status_code=400, detail="No tasks specified")
    
    if request.parallel > 50:
        raise HTTPException(status_code=400, detail="Maximum 50 parallel tasks allowed")
    
    # Start the batch coordinator
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
        message=f"Started {len(request.task_ids)} terminal-bench tasks in Modal cloud",
        task_count=len(request.task_ids)
    )


@web_app.get("/status/{batch_id}")
async def get_status(batch_id: str) -> StatusResponse:
    """
    Get the status of a batch run.
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
    return {
        "status": "healthy",
        "service": "terminal-bench-runner",
        "type": "real-execution",
        "message": "Running actual terminal-bench tasks in Modal cloud"
    }


# Serve the FastAPI app
@app.function(
    image=modal_image,
    cpu=1,
    memory=1024,
    min_containers=1,  # Keep one warm
)
@modal.asgi_app()
def fastapi_app():
    """Serve the FastAPI app as a Modal web endpoint."""
    return web_app


@app.local_entrypoint()
def main():
    """Deploy the app."""
    print("Deploying Terminal-Bench Runner to Modal...")
    print("\nEndpoint will be available at:")
    print("https://openblocklabs--terminal-bench-runner-fastapi-app.modal.run")
    print("\nThis runs REAL terminal-bench tasks in the cloud!")