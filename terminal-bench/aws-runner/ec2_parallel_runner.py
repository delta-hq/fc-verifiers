#!/usr/bin/env python3
"""
Clean EC2 spot instance runner for parallel terminal-bench execution
Automatically cleans up all resources after completion
"""

import boto3
import time
import json
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Any

class EC2ParallelRunner:
    def __init__(self, s3_bucket: str = None):
        self.ec2 = boto3.client('ec2')
        self.s3 = boto3.client('s3')
        self.timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        self.s3_bucket = s3_bucket or f"terminal-bench-results-{self.timestamp}"
        self.launched_instances = []
        self.cleanup_enabled = True
        
    def create_s3_bucket_if_needed(self):
        """Create S3 bucket for results"""
        try:
            self.s3.create_bucket(Bucket=self.s3_bucket)
            print(f"Created S3 bucket: {self.s3_bucket}")
        except self.s3.exceptions.BucketAlreadyExists:
            print(f"Using existing bucket: {self.s3_bucket}")
        except self.s3.exceptions.BucketAlreadyOwnedByYou:
            print(f"Using existing bucket: {self.s3_bucket}")
            
    def create_iam_role(self):
        """Create IAM role for EC2 instances to access S3"""
        iam = boto3.client('iam')
        role_name = f"terminal-bench-ec2-{self.timestamp}"
        
        try:
            # Create role
            iam.create_role(
                RoleName=role_name,
                AssumeRolePolicyDocument=json.dumps({
                    "Version": "2012-10-17",
                    "Statement": [{
                        "Effect": "Allow",
                        "Principal": {"Service": "ec2.amazonaws.com"},
                        "Action": "sts:AssumeRole"
                    }]
                })
            )
            
            # Attach S3 policy
            iam.put_role_policy(
                RoleName=role_name,
                PolicyName='S3Access',
                PolicyDocument=json.dumps({
                    "Version": "2012-10-17",
                    "Statement": [{
                        "Effect": "Allow",
                        "Action": ["s3:PutObject", "s3:GetObject"],
                        "Resource": f"arn:aws:s3:::{self.s3_bucket}/*"
                    }]
                })
            )
            
            # Create instance profile
            iam.create_instance_profile(InstanceProfileName=role_name)
            iam.add_role_to_instance_profile(
                InstanceProfileName=role_name,
                RoleName=role_name
            )
            
            print(f"Created IAM role: {role_name}")
            time.sleep(10)  # Wait for IAM propagation
            return role_name
            
        except iam.exceptions.EntityAlreadyExistsException:
            print(f"IAM role already exists: {role_name}")
            return role_name
    
    def launch_instance_for_task(self, task_id: str, iam_role: str) -> Dict[str, Any]:
        """Launch a single EC2 spot instance for one task"""
        
        user_data = f'''#!/bin/bash
set -e

# Log output
exec > >(tee /var/log/user-data.log)
exec 2>&1

echo "Starting terminal-bench task: {task_id}"

# Install dependencies
yum update -y
yum install -y docker python3-pip git
service docker start

# Install AWS CLI and terminal-bench
pip3 install awscli terminal-bench

# Set up OpenAI API key (you'll need to add this)
export OPENAI_API_KEY="YOUR_KEY_HERE"  # TODO: Use Secrets Manager

# Run terminal-bench
echo "Running terminal-bench for {task_id}..."
tb run --dataset terminal-bench-core \
       --task-id {task_id} \
       --agent oracle \
       --output-path /tmp/results

# Upload results to S3
echo "Uploading results to S3..."
aws s3 cp /tmp/results s3://{self.s3_bucket}/{self.timestamp}/{task_id}/ --recursive

# Signal completion
echo "Task {task_id} completed"

# Self-terminate after 5 minutes (safety margin)
shutdown -h +5
'''
        
        try:
            # Request spot instance
            response = self.ec2.run_instances(
                ImageId='ami-0c02fb55731490381',  # Amazon Linux 2
                InstanceType='t3.small',  # Cheapest option for testing
                MaxCount=1,
                MinCount=1,
                InstanceMarketOptions={
                    'MarketType': 'spot',
                    'SpotOptions': {
                        'SpotInstanceType': 'one-time',
                        'InstanceInterruptionBehavior': 'terminate'
                    }
                },
                UserData=user_data,
                IamInstanceProfile={'Name': iam_role},
                TagSpecifications=[{
                    'ResourceType': 'instance',
                    'Tags': [
                        {'Key': 'Name', 'Value': f'terminal-bench-{task_id}'},
                        {'Key': 'Task', 'Value': task_id},
                        {'Key': 'Batch', 'Value': self.timestamp},
                        {'Key': 'AutoTerminate', 'Value': 'true'}
                    ]
                }]
            )
            
            instance_id = response['Instances'][0]['InstanceId']
            self.launched_instances.append(instance_id)
            
            return {
                'task_id': task_id,
                'instance_id': instance_id,
                'status': 'launched'
            }
            
        except Exception as e:
            return {
                'task_id': task_id,
                'error': str(e),
                'status': 'failed'
            }
    
    def wait_for_completion(self, timeout: int = 3600) -> List[Dict]:
        """Wait for all instances to complete and terminate"""
        print(f"Waiting for {len(self.launched_instances)} instances to complete...")
        
        start_time = time.time()
        results = []
        
        while time.time() - start_time < timeout:
            # Check instance states
            if not self.launched_instances:
                break
                
            response = self.ec2.describe_instances(
                InstanceIds=self.launched_instances
            )
            
            still_running = []
            for reservation in response['Reservations']:
                for instance in reservation['Instances']:
                    state = instance['State']['Name']
                    instance_id = instance['InstanceId']
                    
                    if state in ['terminated', 'shutting-down']:
                        # Instance completed
                        task_id = next((tag['Value'] for tag in instance.get('Tags', []) 
                                      if tag['Key'] == 'Task'), 'unknown')
                        results.append({
                            'instance_id': instance_id,
                            'task_id': task_id,
                            'state': state
                        })
                    elif state in ['running', 'pending']:
                        still_running.append(instance_id)
            
            self.launched_instances = still_running
            
            if still_running:
                print(f"Still running: {len(still_running)} instances")
                time.sleep(30)
            else:
                print("All instances completed")
                break
        
        return results
    
    def cleanup_instances(self):
        """Force terminate any remaining instances"""
        if not self.cleanup_enabled:
            return
            
        if self.launched_instances:
            print(f"Cleaning up {len(self.launched_instances)} remaining instances...")
            try:
                self.ec2.terminate_instances(InstanceIds=self.launched_instances)
                print("Terminated remaining instances")
            except Exception as e:
                print(f"Error terminating instances: {e}")
    
    def cleanup_iam(self, role_name: str):
        """Clean up IAM role and instance profile"""
        if not self.cleanup_enabled:
            return
            
        iam = boto3.client('iam')
        try:
            # Remove role from instance profile
            iam.remove_role_from_instance_profile(
                InstanceProfileName=role_name,
                RoleName=role_name
            )
            # Delete instance profile
            iam.delete_instance_profile(InstanceProfileName=role_name)
            # Delete role policy
            iam.delete_role_policy(RoleName=role_name, PolicyName='S3Access')
            # Delete role
            iam.delete_role(RoleName=role_name)
            print(f"Cleaned up IAM role: {role_name}")
        except Exception as e:
            print(f"Error cleaning up IAM: {e}")
    
    def run_parallel_tasks(self, task_ids: List[str], max_parallel: int = 10):
        """Main execution function"""
        print(f"Starting {len(task_ids)} tasks with max {max_parallel} parallel")
        
        # Setup
        self.create_s3_bucket_if_needed()
        iam_role = self.create_iam_role()
        
        try:
            # Launch instances in parallel
            launch_results = []
            with ThreadPoolExecutor(max_workers=max_parallel) as executor:
                futures = {executor.submit(self.launch_instance_for_task, task_id, iam_role): task_id 
                          for task_id in task_ids}
                
                for future in as_completed(futures):
                    result = future.result()
                    launch_results.append(result)
                    status = "✓" if result['status'] == 'launched' else "✗"
                    print(f"{status} {result['task_id']}: {result.get('instance_id', result.get('error'))}")
            
            # Wait for completion
            if self.launched_instances:
                completion_results = self.wait_for_completion()
                
                # Get results from S3
                print(f"\nResults available in S3 bucket: {self.s3_bucket}")
                print(f"Path: s3://{self.s3_bucket}/{self.timestamp}/")
            
        finally:
            # Always cleanup
            print("\nCleaning up resources...")
            self.cleanup_instances()
            self.cleanup_iam(iam_role)
            
        return launch_results


def main():
    """Test with a small batch first"""
    
    # Start with just 3 tasks for testing
    test_tasks = [
        "hello-world",
        "fibonacci", 
        "calculator"
    ]
    
    print("="*50)
    print("Terminal-bench EC2 Parallel Runner")
    print("="*50)
    print(f"Tasks: {test_tasks}")
    print("Instance type: t3.small (spot)")
    print("Estimated cost: ~$0.01 total")
    print("="*50)
    
    runner = EC2ParallelRunner()
    
    try:
        results = runner.run_parallel_tasks(
            task_ids=test_tasks,
            max_parallel=3
        )
        
        # Summary
        successful = sum(1 for r in results if r['status'] == 'launched')
        print(f"\nSummary: {successful}/{len(results)} tasks launched successfully")
        
    except KeyboardInterrupt:
        print("\n\nInterrupted! Cleaning up...")
        runner.cleanup_instances()
        
    except Exception as e:
        print(f"Error: {e}")
        runner.cleanup_instances()


if __name__ == "__main__":
    main()