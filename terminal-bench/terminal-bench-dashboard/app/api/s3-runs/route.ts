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
        
        // Try to get summary.json to check status
        try {
          const summaryCommand = new ListObjectsV2Command({
            Bucket: 'terminal-bench-results-522495932155',
            Prefix: `${taskPath}summary.json`
          });
          const summaryResponse = await s3Client.send(summaryCommand);
          
          if (summaryResponse.Contents && summaryResponse.Contents.length > 0) {
            tasks.push({
              taskId,
              status: 'completed', // We'll get actual status from summary if needed
              lastModified: summaryResponse.Contents[0].LastModified
            });
          }
        } catch (e) {
          // Task might still be running or failed
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