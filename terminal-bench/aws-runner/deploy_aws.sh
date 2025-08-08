#!/bin/bash
# Simple AWS deployment test for terminal-bench
# Tests if we can run terminal-bench on AWS ECS

set -e

echo "========================================="
echo "Terminal-bench AWS ECS Test Deployment"
echo "========================================="

# Check AWS CLI is configured
if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo "Error: AWS CLI not configured. Run 'aws configure' first."
    exit 1
fi

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=${AWS_REGION:-us-east-1}

echo "AWS Account: $AWS_ACCOUNT_ID"
echo "AWS Region: $AWS_REGION"

# Test 1: Create minimal ECS cluster
echo ""
echo "Test 1: Creating ECS cluster..."
aws ecs create-cluster --cluster-name terminal-bench-test 2>/dev/null || echo "Cluster already exists"

# Test 2: Check if we can list tasks
echo ""
echo "Test 2: Checking ECS access..."
aws ecs list-tasks --cluster terminal-bench-test

# Test 3: Create a simple task definition for terminal-bench
echo ""
echo "Test 3: Creating task definition..."
cat > /tmp/task-def.json <<EOF
{
  "family": "terminal-bench-test",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "2048",
  "memory": "4096",
  "containerDefinitions": [
    {
      "name": "terminal-bench",
      "image": "public.ecr.aws/docker/library/python:3.11-slim",
      "command": [
        "sh", "-c", 
        "pip install terminal-bench && tb run --dataset terminal-bench-core --task-id hello-world --agent oracle --output-path /tmp/results"
      ],
      "essential": true,
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/terminal-bench-test",
          "awslogs-region": "$AWS_REGION",
          "awslogs-stream-prefix": "ecs",
          "awslogs-create-group": "true"
        }
      }
    }
  ],
  "executionRoleArn": "arn:aws:iam::$AWS_ACCOUNT_ID:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::$AWS_ACCOUNT_ID:role/ecsTaskExecutionRole"
}
EOF

# Register task definition
aws ecs register-task-definition --cli-input-json file:///tmp/task-def.json >/dev/null

echo ""
echo "========================================="
echo "Setup Complete!"
echo "========================================="
echo ""
echo "To run a test task:"
echo ""
echo "aws ecs run-task \\"
echo "  --cluster terminal-bench-test \\"
echo "  --task-definition terminal-bench-test \\"
echo "  --launch-type FARGATE \\"
echo "  --network-configuration \"awsvpcConfiguration={subnets=[YOUR_SUBNET_ID],assignPublicIp=ENABLED}\""
echo ""
echo "Note: You need to replace YOUR_SUBNET_ID with an actual subnet ID from your VPC"
echo ""
echo "To cleanup:"
echo "aws ecs delete-cluster --cluster terminal-bench-test"