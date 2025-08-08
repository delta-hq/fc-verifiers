# Testing AWS ECS for Terminal-bench

## Prerequisites

1. **Configure AWS CLI**:
```bash
aws configure
# Enter your AWS Access Key ID
# Enter your AWS Secret Access Key
# Enter default region (us-east-1)
```

2. **Run deployment test**:
```bash
cd terminal-bench/aws-runner
./deploy_aws.sh
```

## What the test does

1. Creates an ECS cluster called `terminal-bench-test`
2. Creates a task definition that runs terminal-bench
3. Sets up CloudWatch logging

## Manual test (after deploy_aws.sh)

1. **Get your subnet ID**:
```bash
aws ec2 describe-subnets --query "Subnets[0].SubnetId" --output text
```

2. **Run a test task**:
```bash
aws ecs run-task \
  --cluster terminal-bench-test \
  --task-definition terminal-bench-test \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],assignPublicIp=ENABLED}"
```

3. **Check task status**:
```bash
aws ecs list-tasks --cluster terminal-bench-test
aws ecs describe-tasks --cluster terminal-bench-test --tasks <task-arn>
```

4. **View logs**:
```bash
aws logs tail /ecs/terminal-bench-test --follow
```

## Expected Results

- Task should run for ~1-2 minutes
- Logs should show terminal-bench installing and running
- Task should complete with hello-world test passing

## Cleanup

```bash
aws ecs delete-cluster --cluster terminal-bench-test --force
```

## Note on Docker-in-Docker

This simple test uses `oracle` agent which doesn't need Docker. For real tests with Docker-in-Docker, we need:
1. Custom Docker image with Docker daemon
2. Task definition with privileged mode
3. More complex setup (full Terraform)