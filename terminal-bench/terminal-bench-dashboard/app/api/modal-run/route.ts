import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function POST(request: Request) {
  try {
    const { agent, tasks, concurrent } = await request.json();
    
    // Create a run ID for tracking
    const runId = new Date().toISOString().replace(/T/, '__').replace(/:/g, '-').split('.')[0];
    
    // Build Modal command
    const taskList = tasks.join(',');
    const command = `modal run ${path.join(process.cwd(), '..', '..', '..', 'scripts', 'modal_terminal_bench.py')} --tasks ${taskList} --agent ${agent} --concurrent ${concurrent}`;
    
    console.log('Executing Modal command:', command);
    
    // Start the Modal run in background
    const child = exec(command, { 
      cwd: path.join(process.cwd(), '..', '..', '..'),
      env: { ...process.env }
    });
    
    let runOutput = '';
    let runError = '';
    
    child.stdout?.on('data', (data) => {
      runOutput += data;
      console.log('[MODAL] stdout:', data);
    });
    
    child.stderr?.on('data', (data) => {
      runError += data;
      console.error('[MODAL] stderr:', data);
    });
    
    child.on('error', (error) => {
      console.error('[MODAL] Exec error:', error);
      runError += error.message;
    });
    
    // Store Modal run info for tracking
    const modalRunInfo = {
      runId,
      agent,
      tasks,
      concurrent,
      status: 'running',
      platform: 'modal',
      startTime: new Date().toISOString(),
      command
    };
    
    // Save to a tracking file or database
    // For now, we'll use a simple JSON file
    const fs = require('fs').promises;
    const runsDir = path.join(process.cwd(), '..', '..', '..', 'runs', runId);
    await fs.mkdir(runsDir, { recursive: true });
    await fs.writeFile(
      path.join(runsDir, 'modal_metadata.json'),
      JSON.stringify(modalRunInfo, null, 2)
    );
    
    // Wait a bit to capture initial Modal output
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return NextResponse.json({ 
      runId,
      message: 'Modal run started successfully',
      platform: 'modal',
      command: command,
      initialOutput: runOutput || null,
      initialError: runError || null
    });
  } catch (error) {
    console.error('Error starting Modal run:', error);
    return NextResponse.json({ 
      error: 'Failed to start Modal run',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET(request: Request) {
  // Get status of Modal runs
  try {
    const fs = require('fs').promises;
    const path = require('path');
    const runsDir = path.join(process.cwd(), '..', '..', '..', 'runs');
    
    const runDirs = await fs.readdir(runsDir);
    const modalRuns = [];
    
    for (const runId of runDirs) {
      const metadataPath = path.join(runsDir, runId, 'modal_metadata.json');
      try {
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
        if (metadata.platform === 'modal') {
          modalRuns.push(metadata);
        }
      } catch (e) {
        // Not a Modal run or no metadata
      }
    }
    
    return NextResponse.json({ runs: modalRuns });
  } catch (error) {
    console.error('Error fetching Modal runs:', error);
    return NextResponse.json({ runs: [] });
  }
}