#!/usr/bin/env python3
"""
Simple CLI for running terminal-bench on AWS ECS
Reads configuration from .env file for easier usage
"""

import os
import click
from pathlib import Path
from dotenv import load_dotenv
from orchestrator import TerminalBenchOrchestrator

# Load environment variables
env_file = Path(__file__).parent / '.env'
if env_file.exists():
    load_dotenv(env_file)

# All terminal-bench-core tasks
ALL_TASKS = [
    # Basic tasks
    "hello-world", "fibonacci", "calculator", "prime-checker",
    
    # File operations
    "file-organizer", "csv-processor", "json-transformer", "log-analyzer",
    
    # Web/API tasks
    "weather-api", "web-scraper", "rest-api", "webhook-handler",
    
    # Development tasks
    "todo-app", "markdown-generator", "code-formatter", "test-runner",
    
    # Data tasks
    "data-pipeline", "sql-query", "data-validator", "report-generator",
    
    # System tasks
    "backup-script", "cron-job", "system-monitor", "process-manager"
]

TASK_GROUPS = {
    "quick": ["hello-world", "fibonacci", "calculator"],
    "basic": ["hello-world", "fibonacci", "calculator", "prime-checker"],
    "web": ["weather-api", "web-scraper", "rest-api", "webhook-handler"],
    "data": ["csv-processor", "json-transformer", "data-pipeline", "sql-query"],
    "dev": ["todo-app", "markdown-generator", "code-formatter", "test-runner"],
}

@click.group()
def cli():
    """Terminal-bench AWS ECS Runner"""
    pass

@cli.command()
@click.option('--tasks', help='Comma-separated task IDs or group name (quick/basic/web/data/dev/all)')
@click.option('--model', default=None, help='Model to use')
@click.option('--max-parallel', type=int, default=None, help='Max parallel tasks')
@click.option('--dry-run', is_flag=True, help='Show what would be run without executing')
def run(tasks, model, max_parallel, dry_run):
    """Run terminal-bench tasks on AWS ECS"""
    
    # Get configuration from environment
    cluster_name = os.getenv('ECS_CLUSTER_NAME')
    task_definition = os.getenv('ECS_TASK_DEFINITION')
    subnet_ids = os.getenv('ECS_SUBNET_IDS', '').split(',')
    security_group = os.getenv('ECS_SECURITY_GROUP')
    s3_bucket = os.getenv('S3_BUCKET')
    
    if not all([cluster_name, task_definition, subnet_ids, security_group, s3_bucket]):
        click.echo("Error: Missing ECS configuration. Run deploy.sh first or check .env file")
        return
    
    # Parse tasks
    if not tasks:
        task_list = TASK_GROUPS["quick"]
    elif tasks == "all":
        task_list = ALL_TASKS
    elif tasks in TASK_GROUPS:
        task_list = TASK_GROUPS[tasks]
    else:
        task_list = tasks.split(',')
    
    # Get defaults
    model = model or os.getenv('DEFAULT_MODEL', 'openai/gpt-4o-mini')
    max_parallel = max_parallel or int(os.getenv('MAX_PARALLEL_TASKS', '10'))
    
    click.echo(f"Running {len(task_list)} tasks")
    click.echo(f"Model: {model}")
    click.echo(f"Max parallel: {max_parallel}")
    click.echo(f"Tasks: {', '.join(task_list)}")
    
    if dry_run:
        click.echo("\n[DRY RUN] Would execute above configuration")
        return
    
    click.echo("\nStarting execution...")
    
    orchestrator = TerminalBenchOrchestrator(
        cluster_name=cluster_name,
        task_definition=task_definition,
        subnet_ids=subnet_ids,
        security_group_id=security_group
    )
    
    results = orchestrator.run_parallel_tasks(
        task_ids=task_list,
        max_parallel=max_parallel,
        model=model
    )
    
    # Save results
    s3_path = orchestrator.save_results_to_s3(results, s3_bucket)
    
    # Summary
    total = len(results)
    passed = sum(1 for r in results.values() if r.get('exit_code') == 0)
    
    click.echo("\n" + "="*50)
    click.echo("RESULTS")
    click.echo("="*50)
    click.echo(f"Total: {total}")
    click.echo(f"Passed: {passed}")
    click.echo(f"Failed: {total - passed}")
    click.echo(f"Success Rate: {passed/total*100:.1f}%")
    click.echo(f"\nResults: {s3_path}")

@cli.command()
def status():
    """Check ECS cluster status and running tasks"""
    import boto3
    
    cluster_name = os.getenv('ECS_CLUSTER_NAME')
    if not cluster_name:
        click.echo("Error: ECS_CLUSTER_NAME not set")
        return
    
    ecs = boto3.client('ecs')
    
    # Get cluster info
    response = ecs.describe_clusters(clusters=[cluster_name])
    if response['clusters']:
        cluster = response['clusters'][0]
        click.echo(f"Cluster: {cluster['clusterName']}")
        click.echo(f"Status: {cluster['status']}")
        click.echo(f"Running tasks: {cluster['runningTasksCount']}")
        click.echo(f"Pending tasks: {cluster['pendingTasksCount']}")
    
    # List running tasks
    tasks = ecs.list_tasks(cluster=cluster_name, desiredStatus='RUNNING')
    if tasks['taskArns']:
        click.echo(f"\nRunning task ARNs:")
        for arn in tasks['taskArns']:
            click.echo(f"  - {arn.split('/')[-1]}")

@cli.command()
def costs():
    """Estimate costs for running tasks"""
    
    click.echo("AWS ECS Fargate Pricing (us-east-1):")
    click.echo("=====================================")
    click.echo("Per task (2 vCPU, 8GB RAM):")
    click.echo("  - vCPU: $0.04048/hour")
    click.echo("  - Memory: $0.004445/GB/hour")
    click.echo("  - Total: ~$0.076/hour per task")
    click.echo("")
    click.echo("Examples:")
    click.echo("  - 10 tasks for 30 min: ~$0.38")
    click.echo("  - 50 tasks for 30 min: ~$1.90")
    click.echo("  - 100 tasks for 1 hour: ~$7.60")
    click.echo("")
    click.echo("Note: First 750 hours/month of t2.micro equivalent is free tier eligible")

@cli.command()
@click.confirmation_option(prompt='Are you sure you want to stop all running tasks?')
def stop_all():
    """Stop all running ECS tasks"""
    import boto3
    
    cluster_name = os.getenv('ECS_CLUSTER_NAME')
    if not cluster_name:
        click.echo("Error: ECS_CLUSTER_NAME not set")
        return
    
    ecs = boto3.client('ecs')
    
    # Get all running tasks
    response = ecs.list_tasks(cluster=cluster_name, desiredStatus='RUNNING')
    
    if not response['taskArns']:
        click.echo("No running tasks found")
        return
    
    # Stop each task
    for task_arn in response['taskArns']:
        ecs.stop_task(cluster=cluster_name, task=task_arn, reason='User requested stop')
        click.echo(f"Stopped: {task_arn.split('/')[-1]}")
    
    click.echo(f"\nStopped {len(response['taskArns'])} tasks")

if __name__ == '__main__':
    cli()