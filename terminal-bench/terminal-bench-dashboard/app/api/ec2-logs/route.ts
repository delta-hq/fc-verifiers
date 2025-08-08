import { NextResponse } from 'next/server';
import { 
  CloudWatchLogsClient, 
  GetLogEventsCommand,
  DescribeLogStreamsCommand 
} from '@aws-sdk/client-cloudwatch-logs';
import { EC2Client, GetConsoleOutputCommand } from '@aws-sdk/client-ec2';

const logsClient = new CloudWatchLogsClient({ region: 'us-east-1' });
const ec2Client = new EC2Client({ region: 'us-east-1' });

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const instanceId = searchParams.get('instanceId');
  const taskId = searchParams.get('taskId');
  const source = searchParams.get('source') || 'console'; // 'console' or 'cloudwatch'
  
  if (!instanceId) {
    return NextResponse.json({ error: 'Instance ID required' }, { status: 400 });
  }
  
  try {
    let logs = '';
    
    if (source === 'cloudwatch') {
      // Get CloudWatch logs if using ECS
      const logGroupName = '/aws/ec2/terminal-bench';
      const logStreamPrefix = taskId || instanceId;
      
      // Find the log stream
      const streamsCommand = new DescribeLogStreamsCommand({
        logGroupName,
        logStreamNamePrefix: logStreamPrefix,
        orderBy: 'LastEventTime',
        descending: true,
        limit: 1
      });
      
      const streamsResponse = await logsClient.send(streamsCommand);
      const logStreamName = streamsResponse.logStreams?.[0]?.logStreamName;
      
      if (logStreamName) {
        // Get log events
        const eventsCommand = new GetLogEventsCommand({
          logGroupName,
          logStreamName,
          startFromHead: true,
          limit: 1000
        });
        
        const eventsResponse = await logsClient.send(eventsCommand);
        logs = eventsResponse.events?.map(e => e.message).join('\n') || '';
      }
    } else {
      // Get EC2 console output (works for regular EC2 instances)
      const command = new GetConsoleOutputCommand({ InstanceId: instanceId });
      const response = await ec2Client.send(command);
      
      if (response.Output) {
        // Decode base64 console output
        logs = Buffer.from(response.Output, 'base64').toString('utf-8');
      }
    }
    
    // Parse logs into sections like the local dashboard does
    const sections = parseLogsIntoSections(logs, taskId || 'unknown');
    
    return NextResponse.json({ 
      logs,
      sections,
      instanceId,
      taskId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error fetching EC2 logs:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch logs',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

function parseLogsIntoSections(logs: string, taskId: string) {
  const sections: any = {
    setup: '',
    agentExecution: '',
    taskResults: '',
    summary: ''
  };
  
  // Look for terminal-bench specific markers
  const lines = logs.split('\n');
  let currentSection = 'setup';
  
  for (const line of lines) {
    // Detect section changes based on content
    if (line.includes('Starting terminal-bench task:')) {
      currentSection = 'setup';
    } else if (line.includes('Running terminal-bench for')) {
      currentSection = 'agentExecution';
    } else if (line.includes('Task') && line.includes('completed')) {
      currentSection = 'taskResults';
    } else if (line.includes('Results Summary') || line.includes('Accuracy:')) {
      currentSection = 'summary';
    }
    
    // Add line to current section
    if (sections[currentSection] !== undefined) {
      sections[currentSection] += line + '\n';
    }
  }
  
  // Extract key metrics
  const accuracy = logs.match(/Accuracy:\s*([\d.]+)%/)?.[1];
  const resolved = logs.match(/Resolved Trials[:\s]+(\d+)/)?.[1];
  const unresolved = logs.match(/Unresolved Trials[:\s]+(\d+)/)?.[1];
  
  return {
    ...sections,
    metrics: {
      accuracy: accuracy ? parseFloat(accuracy) : null,
      resolved: resolved ? parseInt(resolved) : null,
      unresolved: unresolved ? parseInt(unresolved) : null,
      status: resolved && parseInt(resolved) > 0 ? 'passed' : 'failed'
    }
  };
}