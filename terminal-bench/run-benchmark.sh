#!/bin/bash
# Run terminal-bench benchmarks with OpenCode agent

# Default values
DATASET="terminal-bench-core"
MODEL="openai/gpt-4o-mini"
CONCURRENT=4
TASKS=""
MAX_CONCURRENT=120  # Allow up to 120 concurrent tasks

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dataset)
            DATASET="$2"
            shift 2
            ;;
        --model)
            MODEL="$2"
            shift 2
            ;;
        --concurrent)
            CONCURRENT="$2"
            shift 2
            ;;
        --tasks)
            # Collect all task IDs
            shift
            while [[ $# -gt 0 ]] && [[ ! "$1" =~ ^-- ]]; do
                TASKS="$TASKS --task-id $1"
                shift
            done
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  --dataset <name>     Dataset to use (default: terminal-bench-core)"
            echo "  --model <name>       Model to use (default: openai/gpt-4o-mini)"
            echo "  --concurrent <n>     Number of concurrent tasks (default: 4)"
            echo "  --tasks <ids...>     Specific task IDs to run (optional)"
            echo ""
            echo "Examples:"
            echo "  $0                           # Run all tasks"
            echo "  $0 --tasks hello-world       # Run single task"
            echo "  $0 --tasks hello-world fibonacci-server  # Run multiple tasks"
            echo "  $0 --concurrent 1            # Run sequentially"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Go up one level from terminal-bench to fc-verifiers
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Change to project directory
cd "$PROJECT_DIR" || exit 1

# Ensure we're in the correct directory
if [ ! -f "terminal-bench/opencode_agent.py" ]; then
    echo "Error: Not in correct directory. Expected to find terminal-bench/opencode_agent.py"
    echo "Current directory: $(pwd)"
    exit 1
fi

# Always rebuild the OpenCode binary to ensure latest changes are included
echo "Building OpenCode binary with latest changes..."
cd terminal-bench/opencode/packages/opencode && bun run build:docker
cd "$PROJECT_DIR"

# Run the benchmark
echo "Running terminal-bench with:"
echo "  Dataset: $DATASET"
echo "  Model: $MODEL"
echo "  Concurrent: $CONCURRENT"
echo "  Tasks: ${TASKS:-all}"
echo ""

# Record start time
START_TIME=$(date +%s)
echo "Started at: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# Run terminal-bench (output will be in logs)
PYTHONPATH=terminal-bench:. tb run \
    --dataset "$DATASET" \
    --agent-import-path "opencode_agent:OpenCodeAgent" \
    --model "$MODEL" \
    --n-concurrent "$CONCURRENT" \
    $TASKS

# Record end time and calculate duration
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

echo ""
echo "Completed at: $(date '+%Y-%m-%d %H:%M:%S')"
echo "Total duration: ${MINUTES}m ${SECONDS}s"

# Show results summary
LATEST_RUN=$(ls -t runs/ | head -1)
if [ -f "runs/$LATEST_RUN/results.json" ]; then
    echo ""
    echo "=== Results Summary ==="
    python -c "
import json
with open('runs/$LATEST_RUN/results.json') as f:
    data = json.load(f)
    total = len(data['results'])
    resolved = data['n_resolved']
    print(f'Total tasks run: {total}')
    print(f'✓ Passed: {resolved}')
    print(f'✗ Failed: {data[\"n_unresolved\"]}')
    print(f'Accuracy: {data[\"accuracy\"]:.1%}')
    print()
    if resolved < total:
        print('Failed tasks:')
        for task_id in data['unresolved_ids']:
            print(f'  - {task_id}')
"
    echo ""
    echo "Run details saved in: runs/$LATEST_RUN/"
    echo ""
    echo "To review agent performance:"
    echo "  - View specific task: cat runs/$LATEST_RUN/<task-name>/*/panes/post-agent.txt"
    echo "  - View test results: cat runs/$LATEST_RUN/<task-name>/*/results.json"
    echo "  - Watch recording: asciinema play runs/$LATEST_RUN/<task-name>/*/sessions/agent.cast"
fi