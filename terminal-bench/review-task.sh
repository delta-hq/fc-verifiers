#!/bin/bash
# Review specific task performance from terminal-bench runs

if [ $# -lt 1 ]; then
    echo "Usage: $0 <task-name> [run-id]"
    echo ""
    echo "Examples:"
    echo "  $0 fibonacci-server                    # Review latest run"
    echo "  $0 grid-pattern-transform 2025-08-06__08-54-04"
    exit 1
fi

TASK_NAME=$1
RUN_ID=${2:-$(ls -t runs/ | head -1)}

TASK_DIR="runs/$RUN_ID/$TASK_NAME"

if [ ! -d "$TASK_DIR" ]; then
    echo "Error: Task '$TASK_NAME' not found in run '$RUN_ID'"
    echo ""
    echo "Available tasks in this run:"
    ls "runs/$RUN_ID" | grep -v -E "\.json|\.log|\.lock" | sed 's/^/  - /'
    exit 1
fi

# Find the trial directory
TRIAL_DIR=$(ls -d "$TASK_DIR"/*/ | head -1)

echo "=== Task: $TASK_NAME ==="
echo "Run ID: $RUN_ID"
echo ""

# Show task instruction
echo "=== Task Instruction ==="
if [ -f "$TRIAL_DIR/results.json" ]; then
    python -c "
import json
with open('$TRIAL_DIR/results.json') as f:
    data = json.load(f)
    print(data.get('instruction', 'No instruction found'))
"
fi

echo ""
echo "=== Agent Output ==="
if [ -f "$TRIAL_DIR/panes/post-agent.txt" ]; then
    # Show last 50 lines of agent output
    tail -50 "$TRIAL_DIR/panes/post-agent.txt"
else
    echo "No agent output found"
fi

echo ""
echo "=== Test Results ==="
if [ -f "$TRIAL_DIR/results.json" ]; then
    python -c "
import json
with open('$TRIAL_DIR/results.json') as f:
    data = json.load(f)
    if data.get('parser_results'):
        for test, result in data['parser_results'].items():
            status = '✓' if result == 'passed' else '✗'
            print(f'{status} {test}: {result}')
    else:
        print('Parse error or no test results')
"
fi

echo ""
echo "=== Options ==="
echo "  - Full agent log: cat $TRIAL_DIR/panes/post-agent.txt"
echo "  - Watch recording: asciinema play $TRIAL_DIR/sessions/agent.cast"
echo "  - View test output: cat $TRIAL_DIR/panes/post-test.txt"