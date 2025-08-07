#!/usr/bin/env python3
"""Test the fibonacci-server task with our custom OpenCode agent."""

import subprocess
import os
import sys
from pathlib import Path

# Add terminal-bench to path
sys.path.insert(0, str(Path(__file__).parent))

from opencode_agent import OpenCodeAgent

def test_fibonacci():
    """Test fibonacci-server task."""
    print("=== Testing fibonacci-server with custom OpenCode agent ===")
    
    # Run the evaluation
    cmd = [
        sys.executable, "-m", "terminal_bench",
        "opencode_agent",
        "--tasks", "fibonacci-server",
        "--max-concurrent", "1"
    ]
    
    print(f"Running: {' '.join(cmd)}")
    
    # Change to project directory
    os.chdir("/Users/daljeet/Documents/fc-verifiers")
    
    # Run the command
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    print(f"Return code: {result.returncode}")
    print(f"STDOUT:\n{result.stdout}")
    print(f"STDERR:\n{result.stderr}")
    
    return result.returncode == 0

if __name__ == "__main__":
    success = test_fibonacci()
    sys.exit(0 if success else 1)