"""
Simple Modal test app to verify cloud execution works.
This will simulate terminal-bench tasks running in parallel.
"""

import modal
import json
import time
import random
from datetime import datetime
from typing import Dict, List, Optional, Any
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Create Modal app
app = modal.App("terminal-bench-test")

# Simple image with basic dependencies
modal_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install([
        "fastapi",
        "pydantic",
        "openai",
        "anthropic"
    ])
)

# Create FastAPI app for web endpoints
web_app = FastAPI()

# Store results in Modal dict
results_dict = modal.Dict.from_name("test-results", create_if_missing=True)

# Request/Response models
class RunRequest(BaseModel):
    task_ids: List[str]
    agent_type: str = "test"
    model: str = "gpt-4o-mini"
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
    cpu=1,
    memory=1024,
    timeout=300,
)
def simulate_task(task_id: str, agent_type: str, model: str) -> Dict[str, Any]:
    """
    Simulate a terminal-bench task running in Modal cloud.
    This is a placeholder that will be replaced with real terminal-bench execution.
    """
    import os
    
    print(f"[Modal Cloud] Starting task: {task_id}")
    print(f"[Modal Cloud] Agent: {agent_type}, Model: {model}")
    
    # Verify we have API keys
    has_openai = "OPENAI_API_KEY" in os.environ
    has_anthropic = "ANTHROPIC_API_KEY" in os.environ
    print(f"[Modal Cloud] API Keys - OpenAI: {has_openai}, Anthropic: {has_anthropic}")
    
    start_time = datetime.now()
    
    # Simulate some work (1-5 seconds)
    work_time = random.uniform(1, 5)
    time.sleep(work_time)
    
    # Simulate pass/fail (80% pass rate)
    passed = random.random() < 0.8
    
    duration = (datetime.now() - start_time).total_seconds()
    
    return {
        "task_id": task_id,
        "status": "completed",
        "passed": passed,
        "duration": duration,
        "message": f"Task {task_id} {'passed' if passed else 'failed'} after {duration:.1f}s",
        "timestamp": datetime.now().isoformat(),
        "executed_in": "Modal Cloud",
        "api_keys_available": {
            "openai": has_openai,
            "anthropic": has_anthropic
        }
    }


@app.function(
    image=modal_image,
    cpu=1,
    memory=1024,
    timeout=600,
)
async def run_batch(
    batch_id: str,
    task_ids: List[str],
    agent_type: str,
    model: str,
    parallel: int
) -> None:
    """
    Run multiple tasks in parallel in Modal cloud.
    """
    print(f"[Batch Coordinator] Starting batch {batch_id}")
    print(f"[Batch Coordinator] Tasks: {len(task_ids)}, Parallel: {parallel}")
    
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
        future = simulate_task.spawn(task_id, agent_type, model)
        futures.append((task_id, future))
    
    # Collect results
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
            
            print(f"[Batch Coordinator] {task_id}: {'✓' if result.get('passed') else '✗'} "
                  f"({batch_status['completed']}/{batch_status['total']})")
            
        except Exception as e:
            print(f"[Batch Coordinator] Task {task_id} error: {e}")
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
    print(f"[Batch Coordinator] Completed: {batch_status['passed']}/{batch_status['total']} passed")


@web_app.post("/run")
async def start_run(request: RunRequest) -> RunResponse:
    """
    Start a batch of tasks in Modal cloud.
    """
    import uuid
    
    batch_id = f"batch_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    
    if not request.task_ids:
        raise HTTPException(status_code=400, detail="No tasks specified")
    
    # Start the batch coordinator
    run_batch.spawn(
        batch_id=batch_id,
        task_ids=request.task_ids,
        agent_type=request.agent_type,
        model=request.model,
        parallel=request.parallel
    )
    
    return RunResponse(
        batch_id=batch_id,
        status="started",
        message=f"Started {len(request.task_ids)} tasks in Modal cloud",
        task_count=len(request.task_ids)
    )


@web_app.get("/status/{batch_id}")
async def get_status(batch_id: str) -> StatusResponse:
    """
    Get the status of a batch.
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
        "service": "terminal-bench-test",
        "message": "Modal cloud execution is working!"
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
    """Test the Modal deployment."""
    print("Deploying test app to Modal...")
    print("\nYour endpoint will be available at:")
    print("https://openblocklabs--terminal-bench-test-fastapi-app.modal.run")
    print("\nTest endpoints:")
    print("  GET  /health - Health check")
    print("  POST /run - Start a batch")
    print("  GET  /status/{batch_id} - Check status")