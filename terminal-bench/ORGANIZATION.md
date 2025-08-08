# Terminal-bench File Organization

## Current Structure (MESSY - needs cleanup)

### Core Files (KEEP)
- `opencode_agent.py` - OpenCode agent implementation
- `claude_opus4_agent.py` - Claude agent implementation  
- `run-benchmark.sh` - Main benchmark runner script
- `terminal-bench-dashboard/` - Web UI for monitoring runs

### Modal Files (TOO MANY - consolidate)
- `modal_app.py` - Basic Modal app
- `modal_terminal_bench.py` - Main Modal runner
- `modal_real_runner.py` - Real agent runner
- `modal_simple_runner.py` - Simple runner
- `deploy_modal.sh` - Modal deployment script

**Action**: Keep only `modal_terminal_bench.py` and `deploy_modal.sh`

### AWS Runner (NEW - organize)
- `aws-runner/orchestrator.py` - AWS ECS parallel orchestrator
- `aws-runner/run.py` - Simple CLI for AWS
- `aws-runner/TEST_PLAN.md` - AWS test plan

**Action**: This should be its own clean module

### Monitoring Scripts (consolidate)
- `monitor-live.sh` - Live monitoring
- `monitor-run.sh` - Run monitoring  
- `status.sh` - Status checker
- `review-task.sh` - Task reviewer
- `share-logs.sh` - Log sharing
- `show-kill-logs.sh` - Kill log viewer
- `start-dashboard-with-logs.sh` - Dashboard with logging

**Action**: Move to `scripts/` subdirectory

### Build/Setup Scripts (organize)
- `build-opencode.sh` - Build OpenCode binary
- `opencode-setup.sh` - OpenCode setup
- `test-modal-integration.sh` - Modal testing

**Action**: Move to `setup/` subdirectory

## Proposed Clean Structure

```
terminal-bench/
├── agents/
│   ├── opencode_agent.py
│   └── claude_opus4_agent.py
├── aws-runner/
│   ├── orchestrator.py
│   ├── run.py
│   └── README.md
├── modal-runner/
│   ├── runner.py (renamed from modal_terminal_bench.py)
│   └── deploy.sh
├── dashboard/
│   └── [existing dashboard files]
├── scripts/
│   ├── monitor.sh (consolidated monitoring)
│   ├── status.sh
│   └── review-task.sh
├── setup/
│   ├── build-opencode.sh
│   └── opencode-setup.sh
├── run-benchmark.sh (main entry point)
└── README.md (updated documentation)
```

## Files to Remove
- `modal_app.py` - redundant
- `modal_real_runner.py` - redundant
- `modal_simple_runner.py` - redundant
- Multiple monitoring scripts - consolidate into one
- `test-modal-integration.sh` - move to tests/
- Old log files and debug outputs