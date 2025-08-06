import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function POST(request: Request) {
  try {
    const { runId } = await request.json();
    
    console.log(`[KILL-RUN] Starting kill operation for runId: ${runId}`);
    console.log(`[KILL-RUN] Timestamp: ${new Date().toISOString()}`);
    
    if (!runId) {
      console.log('[KILL-RUN] ERROR: Missing runId parameter');
      return NextResponse.json({ 
        error: 'Missing runId parameter' 
      }, { status: 400 });
    }
    
    const results: string[] = [];
    console.log('[KILL-RUN] Initialized results array');
    
    // 1. Kill Docker containers for this specific run
    console.log('[KILL-RUN] Step 1: Killing Docker containers...');
    try {
      const { stdout: containers } = await execAsync(`docker ps -q --filter "name=${runId}" 2>/dev/null || echo ""`);
      console.log(`[KILL-RUN] Found containers: ${containers.trim()}`);
      if (containers.trim()) {
        console.log(`[KILL-RUN] Killing containers: ${containers.trim().split('\n').join(', ')}`);
        await execAsync(`docker kill ${containers.trim().split('\n').join(' ')} 2>/dev/null || true`);
        results.push(`Killed Docker containers: ${containers.trim().split('\n').join(', ')}`);
        console.log('[KILL-RUN] Successfully killed Docker containers');
      } else {
        results.push('No Docker containers found for this run');
        console.log('[KILL-RUN] No Docker containers found for this run');
      }
    } catch (error) {
      const errorMsg = `Docker kill error: ${error}`;
      results.push(errorMsg);
      console.log(`[KILL-RUN] ${errorMsg}`);
    }
    
    // 2. Kill any processes running the benchmark script
    console.log('[KILL-RUN] Step 2: Killing benchmark processes...');
    try {
      await execAsync('pkill -f "run-benchmark.sh" 2>/dev/null || true');
      await execAsync('pkill -f "tb run" 2>/dev/null || true');
      results.push('Killed benchmark processes');
      console.log('[KILL-RUN] Successfully killed benchmark processes');
    } catch (error) {
      const errorMsg = `Process kill error: ${error}`;
      results.push(errorMsg);
      console.log(`[KILL-RUN] ${errorMsg}`);
    }
    
    // 3. Create a results.json file to mark as killed/failed
    console.log('[KILL-RUN] Step 3: Creating results.json file...');
    try {
      const runPath = `/Users/daljeet/Documents/fc-verifiers/runs/${runId}`;
      const resultsPath = `${runPath}/results.json`;
      
      console.log(`[KILL-RUN] Run path: ${runPath}`);
      console.log(`[KILL-RUN] Results path: ${resultsPath}`);
      
      // Create the run directory if it doesn't exist
      await execAsync(`mkdir -p "${runPath}"`);
      console.log('[KILL-RUN] Ensured run directory exists');
      
      // Check if results.json already exists
      const { stdout: existsCheck } = await execAsync(`test -f "${resultsPath}" && echo "exists" || echo "not exists"`);
      console.log(`[KILL-RUN] Results file exists check: ${existsCheck.trim()}`);
      
      if (existsCheck.trim() === "not exists") {
        // Create a basic results.json marking this run as killed
        // First, try to get task info from the API to create proper results
        let taskResults = [];
        try {
          // We could get the task list from the run metadata or infer from the runId
          // For now, create a generic failed result
          taskResults = [{
            task_id: runId.split('__')[0] || 'unknown-task', // Use date part as fallback
            passed: false,
            killed: true
          }];
        } catch {
          // Fallback to empty results
        }
        
        const killResults = {
          accuracy: 0,
          results: taskResults,
          killed: true,
          killed_at: new Date().toISOString()
        };
        
        // Use fs.writeFile instead of shell echo to avoid path issues
        const fs = require('fs/promises');
        await fs.writeFile(resultsPath, JSON.stringify(killResults, null, 2));
        results.push('Created results.json marking run as killed');
        console.log('[KILL-RUN] Successfully created results.json');
      } else {
        results.push('Results.json already exists, skipping creation');
        console.log('[KILL-RUN] Results.json already exists, skipping');
      }
    } catch (error) {
      const errorMsg = `Results file creation error: ${error}`;
      results.push(errorMsg);
      console.log(`[KILL-RUN] ${errorMsg}`);
    }
    
    // 4. Remove the lock file
    try {
      const lockPath = `/Users/daljeet/Documents/fc-verifiers/runs/${runId}/tb.lock`;
      await execAsync(`rm -f "${lockPath}"`);
      results.push('Removed lock file');
    } catch (error) {
      results.push(`Lock file removal error: ${error}`);
    }
    
    // 5. Docker cleanup
    try {
      await execAsync('docker container prune -f > /dev/null 2>&1 || true');
      await execAsync('docker network prune -f > /dev/null 2>&1 || true');
      results.push('Cleaned up Docker resources');
    } catch (error) {
      results.push(`Docker cleanup error: ${error}`);
    }
    
    console.log(`[KILL-RUN] Completed kill operation for ${runId}`);
    console.log(`[KILL-RUN] Results: ${JSON.stringify(results, null, 2)}`);
    
    return NextResponse.json({ 
      message: 'Kill operations completed',
      runId,
      results
    });
    
  } catch (error) {
    console.error('Error killing run:', error);
    return NextResponse.json({ 
      error: 'Failed to kill run',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}