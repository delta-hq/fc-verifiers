# Simplest Solution: Just Use EC2 Instances

## The Problem
- Terminal-bench needs Docker daemon
- ECS Fargate doesn't support Docker-in-Docker
- Modal doesn't support Docker-in-Docker
- EC2-backed ECS is complex

## The Simple Solution: Plain EC2

```bash
# 1. Launch EC2 instance with Docker
aws ec2 run-instances \
  --image-id ami-0c02fb55731490381 \  # Amazon Linux 2
  --instance-type t3.large \
  --key-name your-key \
  --user-data '#!/bin/bash
    yum install -y docker python3-pip
    service docker start
    pip3 install terminal-bench
  '

# 2. SSH into instance
ssh ec2-user@<instance-ip>

# 3. Run terminal-bench normally
tb run --dataset terminal-bench-core --task-id hello-world

# 4. For parallel execution, launch multiple EC2 instances
```

## Better: Use EC2 with a simple orchestrator

```python
import boto3
from concurrent.futures import ThreadPoolExecutor

def run_on_ec2(task_id):
    """Launch EC2 instance, run task, terminate"""
    ec2 = boto3.client('ec2')
    
    # Launch instance
    response = ec2.run_instances(
        ImageId='ami-0c02fb55731490381',
        InstanceType='t3.medium',
        MaxCount=1,
        MinCount=1,
        UserData=f'''#!/bin/bash
            yum install -y docker python3-pip
            service docker start
            pip3 install terminal-bench
            tb run --task-id {task_id} --output-path /tmp/results
            # Upload results to S3
            aws s3 cp /tmp/results s3://my-bucket/results/{task_id}/
            # Self-terminate
            shutdown -h now
        '''
    )
    
    instance_id = response['Instances'][0]['InstanceId']
    return instance_id

# Run 10 tasks in parallel on separate EC2 instances
tasks = ['hello-world', 'fibonacci', 'calculator', ...]
with ThreadPoolExecutor(max_workers=10) as executor:
    instance_ids = list(executor.map(run_on_ec2, tasks))
```

## Why This Is Better

1. **Simple**: Just EC2 + Docker, no complex orchestration
2. **Works**: Docker runs natively, no nesting issues  
3. **Parallel**: Launch as many instances as needed
4. **Cost-effective**: ~$0.04/hour per t3.medium
5. **Self-terminating**: Instances shut down after task

## Even Simpler: Use Existing EC2

If you already have an EC2 instance with Docker:

```python
# Just run multiple terminal-bench processes locally
import subprocess
from concurrent.futures import ProcessPoolExecutor

def run_task(task_id):
    subprocess.run([
        'tb', 'run',
        '--task-id', task_id,
        '--output-path', f'/tmp/{task_id}'
    ])

# Run up to 5 tasks in parallel on same instance
with ProcessPoolExecutor(max_workers=5) as executor:
    executor.map(run_task, ['hello-world', 'fibonacci', 'calculator'])
```

## The Real Answer

For terminal-bench parallel execution:
1. **Local**: Can't run parallel (Docker conflicts)
2. **Modal**: Can't run at all (no Docker daemon)
3. **ECS Fargate**: Can't run (no Docker-in-Docker)
4. **ECS on EC2**: Complex setup required
5. **Plain EC2**: ✅ Simple and works!

Just use EC2 instances with Docker installed. Launch multiple instances for parallelism.