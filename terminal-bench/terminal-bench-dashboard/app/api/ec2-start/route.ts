import { NextResponse } from 'next/server';
import { EC2Client, RunInstancesCommand } from '@aws-sdk/client-ec2';
import { IAMClient, CreateRoleCommand, CreateInstanceProfileCommand, AddRoleToInstanceProfileCommand, PutRolePolicyCommand } from '@aws-sdk/client-iam';

const ec2Client = new EC2Client({ region: 'us-east-1' });
const iamClient = new IAMClient({ region: 'us-east-1' });

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { taskIds, parallel = 5 } = body;
    
    if (!taskIds || taskIds.length === 0) {
      return NextResponse.json({ error: 'No tasks specified' }, { status: 400 });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const batchId = `batch-${timestamp}`;
    
    // Launch EC2 instances for each task
    const launchPromises = taskIds.slice(0, parallel).map(async (taskId: string) => {
      const userData = Buffer.from(`#!/bin/bash
set -e
echo "Starting terminal-bench task: ${taskId}"

# NO AUTO-TERMINATION - we'll manage instances manually for faster testing
# echo "shutdown -h now" | at now + 5 minutes 2>/dev/null || true

# Install dependencies
yum update -y
yum install -y docker git at
service docker start
service atd start

# Run terminal-bench with Docker-in-Docker support
echo "Setting up terminal-bench with Docker..." > /var/log/terminal-bench.log

# Use the official terminal-bench Docker image if it exists, or build one
docker run --rm -d --name tb-runner \
  --privileged \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /tmp/results:/tmp/results \
  python:3.12 tail -f /dev/null

# Install Docker CLI, git, and terminal-bench inside the container
docker exec tb-runner apt-get update
docker exec tb-runner apt-get install -y git docker.io
# Install docker-compose plugin for 'docker compose' command
docker exec tb-runner mkdir -p /usr/local/lib/docker/cli-plugins
docker exec tb-runner sh -c 'curl -SL https://github.com/docker/compose/releases/download/v2.20.2/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose'
docker exec tb-runner chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
docker exec tb-runner pip install terminal-bench

# Run the actual task with Docker access
echo "Running terminal-bench task: ${taskId}" >> /var/log/terminal-bench.log
docker exec tb-runner tb run \
  --dataset terminal-bench-core \
  --task-id ${taskId} \
  --agent oracle \
  --output-path /tmp/results 2>&1 | tee -a /var/log/terminal-bench.log || echo "Task failed" >> /var/log/terminal-bench.log

# Clean up
docker stop tb-runner || true
docker rm tb-runner || true

# Capture the exit code
TB_EXIT_CODE=$?

# Upload logs and results to S3
echo "Uploading logs to S3..." | tee -a /var/log/terminal-bench.log
aws s3 cp /var/log/terminal-bench.log s3://terminal-bench-results-522495932155/${batchId}/${taskId}/terminal-bench.log || true
aws s3 cp /tmp/results s3://terminal-bench-results-522495932155/${batchId}/${taskId}/ --recursive || true

# Create a summary JSON
cat > /tmp/summary.json << EOF
{
  "taskId": "${taskId}",
  "batchId": "${batchId}",
  "instanceId": "$(ec2-metadata --instance-id | cut -d ' ' -f 2)",
  "exitCode": $TB_EXIT_CODE,
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": $([ $TB_EXIT_CODE -eq 0 ] && echo '"completed"' || echo '"failed"')
}
EOF
aws s3 cp /tmp/summary.json s3://terminal-bench-results-522495932155/${batchId}/${taskId}/summary.json || true

echo "Task completed, shutting down..."
# Self-terminate immediately after completion
shutdown -h now
`).toString('base64');
      
      const command = new RunInstancesCommand({
        ImageId: 'ami-0c12c782c6284b66c', // Amazon Linux 2 in us-east-1
        InstanceType: 't3.micro',
        MaxCount: 1,
        MinCount: 1,
        UserData: userData,
        IamInstanceProfile: {
          Name: 'terminal-bench-ec2-role' // We'll create this role
        },
        TagSpecifications: [{
          ResourceType: 'instance',
          Tags: [
            { Key: 'Name', Value: `terminal-bench-${taskId}` },
            { Key: 'Task', Value: taskId },
            { Key: 'Batch', Value: batchId },
            { Key: 'AutoTerminate', Value: 'true' }
          ]
        }],
        InstanceMarketOptions: {
          MarketType: 'spot',
          SpotOptions: {
            SpotInstanceType: 'one-time',
            InstanceInterruptionBehavior: 'terminate'
          }
        }
      });
      
      const response = await ec2Client.send(command);
      return {
        taskId,
        instanceId: response.Instances?.[0].InstanceId,
        status: 'launched'
      };
    });
    
    const results = await Promise.all(launchPromises);
    
    return NextResponse.json({
      batchId,
      instances: results,
      message: `Launched ${results.length} EC2 instances`
    });
    
  } catch (error) {
    console.error('Error starting EC2 runs:', error);
    return NextResponse.json({
      error: 'Failed to start EC2 runs',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}