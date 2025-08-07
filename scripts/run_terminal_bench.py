#!/usr/bin/env python3
import sys
import subprocess
import os

# Add current directory to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import to ensure it works
try:
    from terminal_bench_opencode_agent import TerminalBenchOpenCodeAgent
    print("✓ Successfully imported TerminalBenchOpenCodeAgent")
except ImportError as e:
    print(f"✗ Failed to import: {e}")
    sys.exit(1)

# Run terminal-bench with the remaining arguments
cmd = ["tb", "run"] + sys.argv[1:]
print(f"Running: {' '.join(cmd)}")
subprocess.run(cmd, env={**os.environ, "PYTHONPATH": os.path.dirname(os.path.abspath(__file__))})