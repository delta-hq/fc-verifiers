import { NextResponse } from 'next/server';
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// Initialize AWS clients with SSO profile
const ec2Client = new EC2Client({ 
  region: 'us-east-1'
  // Will use AWS_PROFILE environment variable or default credentials
});

const s3Client = new S3Client({ 
  region: 'us-east-1'
});

export async function GET() {
  try {
    // Get all running terminal-bench EC2 instances
    const command = new DescribeInstancesCommand({
      Filters: [
        { Name: 'tag:Name', Values: ['terminal-bench-*'] },
        { Name: 'instance-state-name', Values: ['running', 'pending', 'stopping', 'stopped', 'terminated'] }
      ]
    });
    
    const response = await ec2Client.send(command);
    const instances = [];
    const batches: Record<string, any> = {};
    
    for (const reservation of response.Reservations || []) {
      for (const instance of reservation.Instances || []) {
        const taskId = instance.Tags?.find(tag => tag.Key === 'Task')?.Value || 'unknown';
        const batchId = instance.Tags?.find(tag => tag.Key === 'Batch')?.Value || '';
        
        // Try to get results from S3 if instance is stopped
        let result = null;
        if (instance.State?.Name === 'stopped' || instance.State?.Name === 'terminated') {
          try {
            const s3Key = `${batchId}/${taskId}/summary.json`;
            const s3Command = new GetObjectCommand({
              Bucket: 'terminal-bench-results-522495932155',
              Key: s3Key
            });
            const s3Response = await s3Client.send(s3Command);
            const resultStr = await s3Response.Body?.transformToString();
            if (resultStr) {
              result = JSON.parse(resultStr);
            }
          } catch (e) {
            // No results yet
          }
        }
        
        const instanceData = {
          instanceId: instance.InstanceId,
          taskId,
          status: mapEc2StatusToTaskStatus(instance.State?.Name),
          launchTime: instance.LaunchTime,
          instanceType: instance.InstanceType,
          publicIp: instance.PublicIpAddress,
          result,
          ec2Status: instance.State?.Name,
          batchId
        };

        instances.push(instanceData);

        // Group by batch
        if (batchId) {
          if (!batches[batchId]) {
            batches[batchId] = {
              batchId,
              instances: [],
              taskCount: 0,
              runningCount: 0,
              completedCount: 0,
              failedCount: 0,
              launchTime: instance.LaunchTime,
              instanceType: instance.InstanceType
            };
          }
          
          batches[batchId].instances.push(instanceData);
          batches[batchId].taskCount++;
          
          // Count status types
          if (instanceData.status === 'running' || instanceData.status === 'starting') {
            batches[batchId].runningCount++;
          } else if (instanceData.status === 'completed') {
            batches[batchId].completedCount++;
          } else if (instanceData.status === 'failed') {
            batches[batchId].failedCount++;
          }
          
          // Use earliest launch time for the batch
          if (instance.LaunchTime && (!batches[batchId].launchTime || instance.LaunchTime < batches[batchId].launchTime)) {
            batches[batchId].launchTime = instance.LaunchTime;
          }
        }
      }
    }
    
    return NextResponse.json({ 
      instances,
      batches: Object.values(batches)
    });
  } catch (error) {
    console.error('Error fetching EC2 status:', error);
    return NextResponse.json({ error: 'Failed to fetch EC2 status' }, { status: 500 });
  }
}

function mapEc2StatusToTaskStatus(ec2Status: string | undefined): string {
  switch (ec2Status) {
    case 'pending':
      return 'starting';
    case 'running':
      return 'running';
    case 'stopping':
      return 'completing';
    case 'stopped':
    case 'terminated':
      return 'completed';
    default:
      return 'unknown';
  }
}