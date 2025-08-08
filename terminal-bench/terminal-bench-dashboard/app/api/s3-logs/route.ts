import { NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({ region: 'us-east-1' });

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get('batchId');
  const taskId = searchParams.get('taskId');
  const logFile = searchParams.get('logFile') || 'terminal-bench.log';
  
  if (!batchId || !taskId) {
    return NextResponse.json({ error: 'Batch ID and Task ID required' }, { status: 400 });
  }
  
  try {
    // Determine S3 key based on requested log file
    let s3Key = '';
    if (logFile === 'terminal-bench.log' || logFile === 'summary.json') {
      s3Key = `${batchId}/${taskId}/${logFile}`;
    } else {
      // For run-specific logs, we need to find the run directory first
      // List objects to find the run directory
      const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      const listCommand = new ListObjectsV2Command({
        Bucket: 'terminal-bench-results-522495932155',
        Prefix: `${batchId}/${taskId}/`,
        MaxKeys: 10
      });
      const listResponse = await s3Client.send(listCommand);
      
      // Find the run directory (format: YYYY-MM-DD__HH-MM-SS)
      const runDir = listResponse.Contents?.find(item => 
        item.Key?.match(/\d{4}-\d{2}-\d{2}__\d{2}-\d{2}-\d{2}\//)
      )?.Key?.split('/')[2];
      
      if (runDir) {
        if (logFile === 'commands.txt') {
          s3Key = `${batchId}/${taskId}/${runDir}/${taskId}/${taskId}.1-of-1.${runDir}/${logFile}`;
        } else {
          s3Key = `${batchId}/${taskId}/${runDir}/${logFile}`;
        }
      } else {
        s3Key = `${batchId}/${taskId}/${logFile}`;
      }
    }
    const command = new GetObjectCommand({
      Bucket: 'terminal-bench-results-522495932155',
      Key: s3Key
    });
    
    const response = await s3Client.send(command);
    const logs = await response.Body?.transformToString() || 'No logs available';
    
    // Also try to get the summary
    let summary = null;
    try {
      const summaryCommand = new GetObjectCommand({
        Bucket: 'terminal-bench-results-522495932155',
        Key: `${batchId}/${taskId}/summary.json`
      });
      const summaryResponse = await s3Client.send(summaryCommand);
      const summaryStr = await summaryResponse.Body?.transformToString();
      if (summaryStr) {
        summary = JSON.parse(summaryStr);
      }
    } catch (e) {
      // No summary available
    }
    
    return NextResponse.json({ 
      logs,
      summary,
      batchId,
      taskId,
      logFile,
      source: 's3',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error fetching S3 logs:', error);
    
    // Return a more helpful error message
    if (error instanceof Error && error.name === 'NoSuchKey') {
      return NextResponse.json({ 
        logs: 'Logs not yet uploaded to S3. Task may still be running or upload may have failed.',
        error: 'NoSuchKey'
      });
    }
    
    return NextResponse.json({ 
      error: 'Failed to fetch logs from S3',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}