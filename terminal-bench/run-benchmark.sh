#!/bin/bash
# Run terminal-bench benchmarks with OpenCode or Claude agents

# Load environment variables from .env file if it exists
if [ -f ../.env ]; then
    set -a
    source ../.env
    set +a
elif [ -f .env ]; then
    set -a
    source .env
    set +a
fi

# Default values
DATASET="terminal-bench-core"
MODEL="openai/gpt-4o-mini"
CONCURRENT=4
TASKS=""
MAX_CONCURRENT=120  # Allow up to 120 concurrent tasks
AGENT="opencode"  # Default to opencode, can be "claude" for direct API
TEST_MODE=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --test-5)
            TEST_MODE=true
            TASKS="--task-id sqlite-with-gcov --task-id fibonacci-server --task-id build-tcc-qemu --task-id password-recovery --task-id crack-7z-hash"
            shift
            ;;
        --agent)
            AGENT="$2"
            shift 2
            ;;
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
            echo "  --test-5             Run the 5 test tasks (sqlite-with-gcov, fibonacci-server, etc.)"
            echo "  --agent <type>       Agent to use: opencode or claude (default: opencode)"
            echo "  --dataset <name>     Dataset to use (default: terminal-bench-core)"
            echo "  --model <name>       Model to use (default: openai/gpt-4o-mini)"
            echo "  --concurrent <n>     Number of concurrent tasks (default: 4)"
            echo "  --tasks <ids...>     Specific task IDs to run (optional)"
            echo ""
            echo "Examples:"
            echo "  $0 --test-5 --agent claude   # Run 5 test tasks with Claude"
            echo "  $0                           # Run all tasks with OpenCode"
            echo "  $0 --agent claude            # Run with Claude direct API"
            echo "  $0 --tasks hello-world       # Run single task"
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

# Kill any stuck terminal-bench processes
pkill -f "tb run" 2>/dev/null && echo "Killed stuck tb processes"

# Clean up Docker to prevent network exhaustion
echo "Cleaning up Docker environment..."
docker network prune -f > /dev/null
docker container prune -f > /dev/null

# For more aggressive cleanup if needed
docker ps -q | xargs -r docker stop 2>/dev/null
docker ps -aq | xargs -r docker rm 2>/dev/null

# Set agent-specific configuration
if [ "$AGENT" = "claude" ]; then
    # Claude direct API agent
    AGENT_PATH="agent_benchmarks.terminal_bench.claude_opus4_agent:ClaudeOpus4Agent"
    
    # Check for OPENROUTER_API_KEY
    if [ -z "$OPENROUTER_API_KEY" ]; then
        echo "Error: OPENROUTER_API_KEY environment variable is required for Claude agent"
        exit 1
    fi
    
    # Claude uses anthropic/claude-opus-4 through OpenRouter
    if [ "$MODEL" = "openai/gpt-4o-mini" ]; then
        MODEL="anthropic/claude-opus-4"
        echo "Note: Switching to Claude Opus 4 model for Claude agent"
    fi
else
    # OpenCode agent (default)
    AGENT_PATH="opencode_agent:OpenCodeAgent"
    
    # Ensure we're in the correct directory
    if [ ! -f "terminal-bench/opencode_agent.py" ]; then
        echo "Error: Not in correct directory. Expected to find terminal-bench/opencode_agent.py"
        echo "Current directory: $(pwd)"
        exit 1
    fi
    
    # Build OpenCode binary for OpenCode agent
    echo "Building OpenCode binary with latest changes..."
    cd terminal-bench/opencode/packages/opencode && bun run build:docker
    cd "$PROJECT_DIR"
fi

# Run the benchmark
echo "Running terminal-bench with:"
echo "  Agent: $AGENT"
echo "  Dataset: $DATASET"
echo "  Model: $MODEL"
echo "  Concurrent: $CONCURRENT"
echo "  Tasks: ${TASKS:-all}"
echo ""

# Record start time
START_TIME=$(date +%s)
echo "Started at: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# Run terminal-bench with livestream for real-time progress
PYTHONPATH=terminal-bench:agent_benchmarks/terminal_bench:. tb run \
    --dataset "$DATASET" \
    --agent-import-path "$AGENT_PATH" \
    --model "$MODEL" \
    --n-concurrent "$CONCURRENT" \
    --livestream \
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