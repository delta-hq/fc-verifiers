"""
Simple test to verify Modal setup works
"""

import modal
import json
from datetime import datetime

# Create a simple Modal stub (updated API)
stub = modal.Stub("terminal-bench-test")

# Simple image with minimal dependencies
image = modal.Image.debian_slim(python_version="3.11")

@stub.function(image=image)
def test_task(task_name: str) -> dict:
    """Simple test function that runs in Modal cloud"""
    return {
        "task": task_name,
        "status": "completed",
        "timestamp": datetime.now().isoformat(),
        "message": f"Task {task_name} completed successfully in Modal cloud!"
    }

@stub.function(image=image)
def batch_test(num_tasks: int = 3) -> list:
    """Run multiple tasks in parallel to test parallelism"""
    import time
    
    # Spawn tasks in parallel
    results = []
    for i in range(num_tasks):
        result = test_task.spawn(f"task_{i}")
        results.append(result)
    
    # Collect results
    outputs = []
    for result in results:
        outputs.append(result.get())
    
    return outputs

@stub.local_entrypoint()
def main():
    """Test Modal functionality"""
    print("🚀 Testing Modal setup...")
    print("-" * 50)
    
    # Test single task
    print("\n1. Testing single task execution...")
    result = test_task.remote("hello-world")
    print(f"   ✅ Result: {json.dumps(result, indent=2)}")
    
    # Test parallel execution
    print("\n2. Testing parallel execution (3 tasks)...")
    results = batch_test.remote(3)
    print(f"   ✅ Completed {len(results)} tasks in parallel")
    for r in results:
        print(f"      - {r['task']}: {r['status']}")
    
    print("\n" + "=" * 50)
    print("✅ Modal test successful!")
    print("\nThis proves:")
    print("  • Modal is installed and configured")
    print("  • Can execute functions in the cloud")
    print("  • Can run tasks in parallel")
    print("\nReady to deploy the full terminal-bench app!")

if __name__ == "__main__":
    with stub.run():
        main()