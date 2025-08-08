import { NextResponse } from 'next/server';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const s3Client = new S3Client({ region: 'us-east-1' });

export async function GET() {
  try {
    const command = new ListObjectsV2Command({
      Bucket: 'terminal-bench-results-522495932155',
      Delimiter: '/'
    });
    
    const response = await s3Client.send(command);
    const batches: any[] = [];
    
    for (const prefix of response.CommonPrefixes || []) {
      const batchId = prefix.Prefix?.replace('/', '');
      if (!batchId) continue;
      
      // List tasks in this batch
      const tasksCommand = new ListObjectsV2Command({
        Bucket: 'terminal-bench-results-522495932155',
        Prefix: batchId + '/',
        Delimiter: '/'
      });
      
      const tasksResponse = await s3Client.send(tasksCommand);
      const tasks = [];
      
      for (const taskPrefix of tasksResponse.CommonPrefixes || []) {
        const taskPath = taskPrefix.Prefix;
        if (!taskPath) continue;
        
        const taskId = taskPath.split('/')[1];
        
        // Try to get terminal-bench.log to extract real data
        try {
          const { GetObjectCommand } = await import('@aws-sdk/client-s3');
          const logCommand = new GetObjectCommand({
            Bucket: 'terminal-bench-results-522495932155',
            Key: `${taskPath.replace('/', '')}terminal-bench.log`
          });
          const logResponse = await s3Client.send(logCommand);
          const logContent = await logResponse.Body?.transformToString();
          
          // Extract accuracy from logs
          let accuracy = null;
          let status = 'unknown';
          
          if (logContent) {
            // Look for accuracy line: "| Accuracy          | 100.00% |"
            const accuracyMatch = logContent.match(/\|\s*Accuracy\s*\|\s*([\d.]+)%\s*\|/);
            if (accuracyMatch) {
              accuracy = parseFloat(accuracyMatch[1]);
            }
            
            // Check if task passed
            if (logContent.includes('✓') && accuracyMatch) {
              status = accuracy > 0 ? 'passed' : 'failed';
            } else if (logContent.includes('Results Summary:')) {
              status = 'completed';
            }
          }
          
          tasks.push({
            taskId,
            status,
            accuracy,
            lastModified: new Date()
          });
        } catch (e) {
          // Fallback to basic info
          tasks.push({
            taskId,
            status: 'unknown',
            lastModified: new Date()
          });
        }
      }
      
      if (tasks.length > 0) {
        batches.push({
          batchId,
          taskCount: tasks.length,
          tasks,
          lastModified: Math.max(...tasks.map(t => t.lastModified?.getTime() || 0))
        });
      }
    }
    
    // Sort by most recent first
    batches.sort((a, b) => b.lastModified - a.lastModified);
    
    return NextResponse.json({ batches });
    
  } catch (error) {
    console.error('Error fetching S3 runs:', error);
    return NextResponse.json({ error: 'Failed to fetch S3 runs' }, { status: 500 });
  }
}