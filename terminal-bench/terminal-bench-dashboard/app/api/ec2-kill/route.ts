import { NextResponse } from 'next/server';
import { EC2Client, TerminateInstancesCommand } from '@aws-sdk/client-ec2';

const ec2Client = new EC2Client({ region: 'us-east-1' });

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { instanceIds } = body;
    
    if (!instanceIds || instanceIds.length === 0) {
      return NextResponse.json({ error: 'No instance IDs provided' }, { status: 400 });
    }
    
    const command = new TerminateInstancesCommand({
      InstanceIds: Array.isArray(instanceIds) ? instanceIds : [instanceIds]
    });
    
    const response = await ec2Client.send(command);
    
    return NextResponse.json({
      message: `Terminated ${response.TerminatingInstances?.length || 0} instances`,
      instances: response.TerminatingInstances
    });
    
  } catch (error) {
    console.error('Error terminating EC2 instances:', error);
    return NextResponse.json({
      error: 'Failed to terminate instances',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}