# AWS ECS Runner for Terminal-bench

Run terminal-bench tasks in parallel using AWS ECS with Docker-in-Docker support.

## Why AWS ECS?

- **Docker-in-Docker**: Terminal-bench requires Docker containers for each task
- **True Parallelism**: Run 10-50+ tasks simultaneously 
- **No Local Limits**: Not constrained by local Docker daemon
- **Cost Effective**: ~$0.076/hour per task

## Files

- `orchestrator.py` - Python script that launches parallel ECS tasks
- `run.py` - Simple CLI interface with task groups
- `TEST_PLAN.md` - Step-by-step validation plan

## Setup

1. **Deploy Infrastructure** (one-time):
```bash
# Need to create AWS infrastructure with Terraform
# See TEST_PLAN.md for full deployment steps
```

2. **Configure**:
```bash
# Create .env file with your AWS resources
cp .env.example .env
# Edit .env with cluster name, subnets, etc.
```

3. **Run Tasks**:
```bash
# Quick test (3 simple tasks)
python run.py run --tasks quick

# Run specific tasks
python run.py run --tasks hello-world,fibonacci --max-parallel 5

# Check status
python run.py status
```

## How It Works

1. **Orchestrator** launches multiple ECS tasks (containers)
2. Each container runs terminal-bench with Docker-in-Docker
3. Tasks execute in parallel (up to max-parallel limit)
4. Results collected and saved to S3
5. Summary displayed with pass/fail counts

## Costs

- ECS Fargate: ~$0.076/hour per task
- Running 100 tasks = ~$7.60 (if each takes 1 hour)
- S3 storage: Minimal (pennies)

## Note

This requires AWS infrastructure (ECS cluster, VPC, etc.) to be set up first. 
The full Terraform configuration was started but needs to be completed.