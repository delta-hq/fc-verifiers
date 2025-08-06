import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function POST(request: Request) {
  try {
    const { agent, tasks, concurrent } = await request.json();
    
    // Path to run-benchmark.sh script
    const scriptPath = path.join(process.cwd(), '..', '..', 'run-benchmark.sh');
    
    // Build command
    const taskList = tasks.split(' ').map((t: string) => `--task-id ${t}`).join(' ');
    const command = `cd ${path.join(process.cwd(), '..', '..')} && ./terminal-bench/run-benchmark.sh --agent ${agent} --concurrent ${concurrent} --tasks ${tasks}`;
    
    console.log('Executing command:', command);
    
    // Create a run ID immediately
    const runId = new Date().toISOString().replace(/T/, '__').replace(/:/g, '-').split('.')[0];
    
    // Start the run and capture output
    let runOutput = '';
    let runError = '';
    
    const child = exec(command, { 
      cwd: path.join(process.cwd(), '..', '..'),
      env: { ...process.env }
    });
    
    child.stdout?.on('data', (data) => {
      runOutput += data;
      console.log('stdout:', data);
    });
    
    child.stderr?.on('data', (data) => {
      runError += data;
      console.error('stderr:', data);
    });
    
    child.on('error', (error) => {
      console.error('Exec error:', error);
      runError += error.message;
    });
    
    // Wait a bit to capture initial output
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return NextResponse.json({ 
      runId,
      message: 'Run started successfully',
      command: command,
      initialOutput: runOutput || null,
      initialError: runError || null
    });
  } catch (error) {
    console.error('Error starting run:', error);
    return NextResponse.json({ 
      error: 'Failed to start run' 
    }, { status: 500 });
  }
}