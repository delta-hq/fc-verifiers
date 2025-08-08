#!/usr/bin/env python3
"""
Test EC2 runner - starts with just 1 task to verify it works
"""

import boto3
import sys

def check_aws_setup():
    """Check if AWS is configured"""
    try:
        sts = boto3.client('sts')
        identity = sts.get_caller_identity()
        print(f"✓ AWS configured: {identity['Account']}")
        return True
    except Exception as e:
        print(f"✗ AWS not configured: {e}")
        print("\nRun: aws configure")
        return False

def check_ami_availability():
    """Check if the AMI is available in the current region"""
    try:
        ec2 = boto3.client('ec2')
        # Amazon Linux 2 AMI - this ID is region-specific
        # For us-east-1: ami-0c02fb55731490381
        # For us-west-2: ami-0352d5a37fb4f603f
        
        region = boto3.session.Session().region_name
        print(f"Current region: {region}")
        
        # Try to find Amazon Linux 2 AMI
        response = ec2.describe_images(
            Owners=['amazon'],
            Filters=[
                {'Name': 'name', 'Values': ['amzn2-ami-hvm-*-x86_64-gp2']},
                {'Name': 'state', 'Values': ['available']}
            ]
        )
        
        if response['Images']:
            latest_ami = sorted(response['Images'], 
                              key=lambda x: x['CreationDate'], 
                              reverse=True)[0]
            print(f"✓ Found Amazon Linux 2 AMI: {latest_ami['ImageId']}")
            return latest_ami['ImageId']
        else:
            print("✗ No Amazon Linux 2 AMI found")
            return None
            
    except Exception as e:
        print(f"✗ Error checking AMI: {e}")
        return None

def test_simple_launch():
    """Test launching a single EC2 instance"""
    
    if not check_aws_setup():
        return False
    
    ami_id = check_ami_availability()
    if not ami_id:
        return False
    
    print("\n" + "="*50)
    print("TEST: Launch 1 EC2 instance for hello-world task")
    print("="*50)
    
    ec2 = boto3.client('ec2')
    
    # Simple user data that just prints and terminates
    user_data = '''#!/bin/bash
echo "Test instance started successfully"
echo "Would run: tb run --task-id hello-world"

# Install and test
yum update -y
yum install -y python3-pip
pip3 install terminal-bench
tb --version

# Self-terminate after 2 minutes (for testing)
shutdown -h +2
'''
    
    try:
        print("Launching test instance...")
        response = ec2.run_instances(
            ImageId=ami_id,
            InstanceType='t3.micro',  # Free tier eligible
            MaxCount=1,
            MinCount=1,
            UserData=user_data,
            TagSpecifications=[{
                'ResourceType': 'instance',
                'Tags': [
                    {'Key': 'Name', 'Value': 'terminal-bench-test'},
                    {'Key': 'Purpose', 'Value': 'Testing'},
                    {'Key': 'AutoTerminate', 'Value': 'true'}
                ]
            }]
        )
        
        instance_id = response['Instances'][0]['InstanceId']
        print(f"✓ Instance launched: {instance_id}")
        print(f"  Type: t3.micro (free tier)")
        print(f"  Will auto-terminate in 2 minutes")
        
        print("\nTo check status:")
        print(f"  aws ec2 describe-instances --instance-ids {instance_id}")
        
        print("\nTo view console output (after ~1 minute):")
        print(f"  aws ec2 get-console-output --instance-id {instance_id}")
        
        print("\nTo manually terminate:")
        print(f"  aws ec2 terminate-instances --instance-ids {instance_id}")
        
        return True
        
    except Exception as e:
        print(f"✗ Failed to launch instance: {e}")
        
        if "RequestLimitExceeded" in str(e):
            print("  You've hit AWS rate limits. Wait a few minutes.")
        elif "Unsupported" in str(e):
            print("  This instance type might not be available in your region.")
        elif "UnauthorizedOperation" in str(e):
            print("  Your AWS account doesn't have EC2 permissions.")
            
        return False

if __name__ == "__main__":
    print("Terminal-bench EC2 Test")
    print("========================\n")
    
    if test_simple_launch():
        print("\n✓ Test successful! Ready to run the full parallel script.")
    else:
        print("\n✗ Test failed. Fix issues above before running the full script.")
        sys.exit(1)