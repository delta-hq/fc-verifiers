# Scripts Directory

## Essential Scripts

### `monitor_wandb.py` 
**Purpose**: W&B training run monitoring and analysis
- Fetches recent training runs from W&B
- Analyzes key metrics (reward, KL divergence, training progress)
- Provides recommendations for hyperparameter tuning
- Supports both individual run analysis and batch summaries
- Usage: `python scripts/monitor_wandb.py --hours 24 --project verifiers`

### `debug_bfcl_rewards.py`
**Purpose**: Debug BFCL (Berkeley Function Calling Leaderboard) reward functions
- Tests reward function parsing and scoring
- Validates function call extraction from completions
- Helpful for debugging GRPO training issues with BFCL tasks
- Usage: `python scripts/debug_bfcl_rewards.py`

## Removed Scripts

The following redundant scripts were consolidated:
- `run_terminal_bench.py` - Local import tester (functionality in dashboard)
- `run_terminal_bench_modal.py` - Basic Modal runner (replaced by modal_terminal_bench.py)
- `run_tb_modal.py` - Simple Modal runner (replaced by modal_terminal_bench.py)  
- `test_modal.py` - Hello world test (not needed)
- `terminal-bench/test_modal.py` - Duplicate test
- `terminal-bench/modal_test_app.py` - Test app (replaced by modal_app.py)

## Usage Patterns

**Local Development**: Use terminal-bench dashboard at `http://localhost:3002`
**Cloud Scaling**: Use AWS ECS (see terminal-bench/aws-runner/)
**Training Monitoring**: Use `monitor_wandb.py` for GRPO training analysis
**Debugging**: Use `debug_bfcl_rewards.py` for reward function issues