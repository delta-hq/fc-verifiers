#!/usr/bin/env python3
"""
AWS ECS Orchestrator for parallel terminal-bench execution
"""

import json
import os
import time
import boto3
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Any

class TerminalBenchOrchestrator:
    def __init__(self, cluster_name: str, task_definition: str, subnet_ids: List[str], security_group_id: str):
        self.ecs = boto3.client('ecs')
        self.s3 = boto3.client('s3')
        self.logs = boto3.client('logs')
        
        self.cluster_name = cluster_name
        self.task_definition = task_definition
        self.subnet_ids = subnet_ids
        self.security_group_id = security_group_id
        
    def run_task(self, task_id: str, model: str = "openai/gpt-4o-mini", agent: str = "codex") -> str:
        """Launch a single ECS task for a terminal-bench test"""
        
        response = self.ecs.run_task(
            cluster=self.cluster_name,
            taskDefinition=self.task_definition,
            launchType='FARGATE',
            networkConfiguration={
                'awsvpcConfiguration': {
                    'subnets': self.subnet_ids,
                    'securityGroups': [self.security_group_id],
                    'assignPublicIp': 'ENABLED'
                }
            },
            overrides={
                'containerOverrides': [
                    {
                        'name': 'terminal-bench',
                        'environment': [
                            {'name': 'TASK_IDS', 'value': task_id},
                            {'name': 'MODEL', 'value': model},
                            {'name': 'AGENT', 'value': agent},
                        ]
                    }
                ]
            },
            tags=[
                {'key': 'task_id', 'value': task_id},
                {'key': 'model', 'value': model},
                {'key': 'timestamp', 'value': datetime.now().isoformat()}
            ]
        )
        
        if response['tasks']:
            return response['tasks'][0]['taskArn']
        else:
            raise RuntimeError(f"Failed to start task for {task_id}: {response.get('failures', 'Unknown error')}")
    
    def wait_for_task(self, task_arn: str, timeout: int = 1800) -> Dict[str, Any]:
        """Wait for an ECS task to complete and return its status"""
        
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            response = self.ecs.describe_tasks(
                cluster=self.cluster_name,
                tasks=[task_arn]
            )
            
            if not response['tasks']:
                return {'status': 'FAILED', 'error': 'Task not found'}
            
            task = response['tasks'][0]
            status = task['lastStatus']
            
            if status == 'STOPPED':
                # Get exit code
                container = task['containers'][0]
                exit_code = container.get('exitCode', -1)
                
                # Try to get logs
                log_group = '/ecs/terminal-bench'
                log_stream = f"ecs/terminal-bench/{task_arn.split('/')[-1]}"
                
                try:
                    log_response = self.logs.get_log_events(
                        logGroupName=log_group,
                        logStreamName=log_stream,
                        limit=100
                    )
                    logs = [event['message'] for event in log_response['events']]
                except:
                    logs = []
                
                return {
                    'status': 'STOPPED',
                    'exit_code': exit_code,
                    'reason': task.get('stoppedReason', 'Unknown'),
                    'logs': logs[-20:] if logs else []  # Last 20 log lines
                }
            
            time.sleep(10)
        
        # Task timed out
        self.ecs.stop_task(
            cluster=self.cluster_name,
            task=task_arn,
            reason='Timeout exceeded'
        )
        
        return {'status': 'TIMEOUT', 'error': f'Task exceeded {timeout} seconds'}
    
    def run_parallel_tasks(self, task_ids: List[str], max_parallel: int = 10, 
                          model: str = "openai/gpt-4o-mini", agent: str = "codex") -> Dict[str, Any]:
        """Run multiple terminal-bench tasks in parallel"""
        
        print(f"Starting {len(task_ids)} tasks with max parallelism of {max_parallel}")
        
        results = {}
        task_arns = {}
        
        with ThreadPoolExecutor(max_workers=max_parallel) as executor:
            # Submit all tasks
            future_to_task = {}
            for task_id in task_ids:
                future = executor.submit(self.run_task, task_id, model, agent)
                future_to_task[future] = task_id
            
            # Collect task ARNs as they're created
            for future in as_completed(future_to_task):
                task_id = future_to_task[future]
                try:
                    task_arn = future.result()
                    task_arns[task_id] = task_arn
                    print(f"Started task {task_id}: {task_arn.split('/')[-1]}")
                except Exception as e:
                    results[task_id] = {'status': 'FAILED', 'error': str(e)}
                    print(f"Failed to start task {task_id}: {e}")
        
        # Now wait for all tasks to complete
        with ThreadPoolExecutor(max_workers=max_parallel) as executor:
            future_to_task = {}
            for task_id, task_arn in task_arns.items():
                future = executor.submit(self.wait_for_task, task_arn)
                future_to_task[future] = task_id
            
            for future in as_completed(future_to_task):
                task_id = future_to_task[future]
                try:
                    result = future.result()
                    results[task_id] = result
                    status_str = "PASSED" if result.get('exit_code') == 0 else "FAILED"
                    print(f"Task {task_id}: {status_str}")
                except Exception as e:
                    results[task_id] = {'status': 'ERROR', 'error': str(e)}
                    print(f"Error waiting for task {task_id}: {e}")
        
        return results
    
    def save_results_to_s3(self, results: Dict[str, Any], bucket: str) -> str:
        """Save results to S3"""
        
        timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
        key = f"parallel-runs/{timestamp}/results.json"
        
        # Calculate summary
        total = len(results)
        passed = sum(1 for r in results.values() if r.get('exit_code') == 0)
        failed = total - passed
        
        summary = {
            'timestamp': timestamp,
            'total_tasks': total,
            'passed': passed,
            'failed': failed,
            'accuracy': (passed / total * 100) if total > 0 else 0,
            'task_results': results
        }
        
        self.s3.put_object(
            Bucket=bucket,
            Key=key,
            Body=json.dumps(summary, indent=2),
            ContentType='application/json'
        )
        
        return f"s3://{bucket}/{key}"

def main():
    """Main entry point for orchestrator"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Run terminal-bench tasks in parallel on AWS ECS')
    parser.add_argument('--cluster', required=True, help='ECS cluster name')
    parser.add_argument('--task-definition', required=True, help='ECS task definition')
    parser.add_argument('--subnet-ids', required=True, help='Comma-separated subnet IDs')
    parser.add_argument('--security-group', required=True, help='Security group ID')
    parser.add_argument('--s3-bucket', required=True, help='S3 bucket for results')
    parser.add_argument('--task-ids', help='Comma-separated task IDs (default: all core tasks)')
    parser.add_argument('--max-parallel', type=int, default=10, help='Max parallel tasks')
    parser.add_argument('--model', default='openai/gpt-4o-mini', help='Model to use')
    parser.add_argument('--agent', default='codex', help='Agent type')
    
    args = parser.parse_args()
    
    # Default task list if not specified
    if args.task_ids:
        task_ids = args.task_ids.split(',')
    else:
        # Sample of core tasks for testing
        task_ids = [
            "hello-world",
            "fibonacci",
            "web-scraper",
            "calculator",
            "weather-api",
            "todo-app",
            "csv-processor",
            "markdown-generator"
        ]
    
    orchestrator = TerminalBenchOrchestrator(
        cluster_name=args.cluster,
        task_definition=args.task_definition,
        subnet_ids=args.subnet_ids.split(','),
        security_group_id=args.security_group
    )
    
    print(f"Running {len(task_ids)} tasks in parallel (max {args.max_parallel})")
    print(f"Model: {args.model}")
    print(f"Agent: {args.agent}")
    print("="*50)
    
    results = orchestrator.run_parallel_tasks(
        task_ids=task_ids,
        max_parallel=args.max_parallel,
        model=args.model,
        agent=args.agent
    )
    
    # Save results to S3
    s3_path = orchestrator.save_results_to_s3(results, args.s3_bucket)
    
    # Print summary
    total = len(results)
    passed = sum(1 for r in results.values() if r.get('exit_code') == 0)
    failed = total - passed
    
    print("="*50)
    print("PARALLEL EXECUTION SUMMARY")
    print("="*50)
    print(f"Total Tasks: {total}")
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    print(f"Accuracy: {passed/total*100:.1f}%" if total > 0 else "N/A")
    print(f"\nResults saved to: {s3_path}")

if __name__ == "__main__":
    main()