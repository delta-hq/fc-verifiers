import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET() {
  try {
    // Path to runs directory (adjust based on where dashboard is deployed)
    const runsPath = path.join(process.cwd(), '..', '..', 'runs');
    
    try {
      const runDirs = await fs.readdir(runsPath);
      const runs = await Promise.all(
        runDirs
          .filter(dir => dir.match(/^\d{4}-\d{2}-\d{2}__\d{2}-\d{2}-\d{2}$/))
          .sort((a, b) => b.localeCompare(a))
          .slice(0, 20) // Last 20 runs
          .map(async (runId) => {
            const runPath = path.join(runsPath, runId);
            
            // Check for results.json
            let status: 'running' | 'completed' | 'failed' = 'running';
            let accuracy: number | undefined;
            let tasks: any[] = [];
            let startTime: string | undefined;
            let endTime: string | undefined;
            let agent: string | undefined;
            let model: string | undefined;
            let concurrent: number | undefined;
            
            // Read run metadata first
            try {
              const metadataPath = path.join(runPath, 'run_metadata.json');
              const metadataData = await fs.readFile(metadataPath, 'utf-8');
              const metadata = JSON.parse(metadataData);
              
              startTime = metadata.start_time;
              endTime = metadata.end_time;
              agent = metadata.agent_name;
              model = metadata.model_name;
              concurrent = metadata.n_concurrent_trials;
            } catch {
              // No metadata file
            }
            
            try {
              const resultsPath = path.join(runPath, 'results.json');
              const resultsData = await fs.readFile(resultsPath, 'utf-8');
              const results = JSON.parse(resultsData);
              
              console.log(`[RUNS-API] Found results.json for ${runId}:`, JSON.stringify(results, null, 2));
              
              status = 'completed';
              accuracy = results.accuracy;
              
              // Get task details from results
              tasks = results.results.map((r: any) => ({
                name: r.task_id,
                status: r.is_resolved ? 'passed' : 'failed'
              }));
              
              console.log(`[RUNS-API] Parsed tasks for ${runId}:`, tasks);
            } catch (error) {
              console.log(`[RUNS-API] No results.json for ${runId}, error:`, error);
              // No results.json yet, check for tb.lock
              try {
                await fs.access(path.join(runPath, 'tb.lock'));
                status = 'running';
                
                // Get task directories
                const items = await fs.readdir(runPath);
                console.log(`[RUNS-API] ${runId} is running, found items:`, items);
                for (const item of items) {
                  if (!['run_metadata.json', 'run.log', 'tb.lock', 'results.json'].includes(item)) {
                    const taskPath = path.join(runPath, item);
                    const stat = await fs.stat(taskPath);
                    if (stat.isDirectory()) {
                      // Check task status
                      let taskStatus: 'queued' | 'running' | 'passed' | 'failed' = 'queued';
                      
                      try {
                        // Check for results in task directory
                        const taskItems = await fs.readdir(taskPath);
                        // Look for trial directories (either 'trial-' or task-specific format)
                        const trialDir = taskItems.find(i => i.startsWith('trial-') || i.includes('.1-of-1.'));
                        
                        if (trialDir) {
                          // If we have a trial directory, task is at least running
                          taskStatus = 'running';
                          
                          // Check multiple possible locations for results
                          const possibleResultsPaths = [
                            path.join(taskPath, trialDir, 'results.json'),
                            path.join(taskPath, 'results.json'),
                            path.join(runPath, 'results.json')
                          ];
                          
                          let foundResults = false;
                          for (const resultsPath of possibleResultsPaths) {
                            try {
                              const taskResults = JSON.parse(await fs.readFile(resultsPath, 'utf-8'));
                              taskStatus = taskResults.passed ? 'passed' : 'failed';
                              foundResults = true;
                              break;
                            } catch {
                              // Try next path
                            }
                          }
                          
                          // If no results found but we have agent.log, check if task completed
                          if (!foundResults) {
                            try {
                              const agentLogPath = path.join(taskPath, trialDir, 'sessions', 'agent.log');
                              const agentLog = await fs.readFile(agentLogPath, 'utf-8');
                              
                              // PRIORITY 1: Check for explicit success messages
                              if (agentLog.includes('Task Completed Successfully') || agentLog.includes('Tests Passed!')) {
                                taskStatus = 'passed';
                              }
                              // PRIORITY 2: Check for actual test results - these are definitive
                              else if (agentLog.includes('2 passed in') || agentLog.includes('PASSED ../tests/')) {
                                taskStatus = 'passed';
                              } else if (agentLog.includes('FAILED ../tests/')) {
                                taskStatus = 'failed';
                              }
                              // PRIORITY 2: Check for pytest success patterns
                              else if (agentLog.includes('passed in') && agentLog.includes('test session starts') && !agentLog.includes('FAILED')) {
                                taskStatus = 'passed';
                              }
                              // PRIORITY 3: Check for traditional PASSED/FAILED markers (but only if no test results)
                              else if (agentLog.includes('PASSED') && !agentLog.includes('FAILED') && !agentLog.includes('Task Results')) {
                                taskStatus = 'passed';
                              } 
                              // PRIORITY 4: Look for signs of successful task completion
                              else if (
                                agentLog.includes('asciinema: recording finished') &&
                                (
                                  // Server-related success indicators
                                  agentLog.includes('Server running on port') ||
                                  agentLog.includes('{"result"') ||
                                  // File creation success
                                  agentLog.includes('Hello, world!') ||
                                  // General completion indicators  
                                  agentLog.includes('Successfully') ||
                                  agentLog.includes('completed') ||
                                  // Python execution success
                                  (agentLog.includes('python3') && agentLog.includes('.py') && !agentLog.includes('error'))
                                ) &&
                                // Make sure Task Results section doesn't override actual success
                                (!agentLog.includes('Status: FAILED') || agentLog.includes('2 passed'))
                              ) {
                                taskStatus = 'passed';
                              } 
                              // PRIORITY 5: Clear failure indicators
                              else if (
                                (agentLog.includes('error:') ||
                                agentLog.includes('Error:') ||
                                agentLog.includes('Traceback') ||
                                agentLog.includes('command not found') ||
                                agentLog.includes('No such file')) &&
                                // But not if tests actually passed
                                !agentLog.includes('2 passed in')
                              ) {
                                taskStatus = 'failed';
                              } else if (agentLog.includes('asciinema: recording finished')) {
                                // Agent completed but unclear result - default to passed if no errors
                                taskStatus = 'passed';
                              } else {
                                taskStatus = 'running';
                              }
                            } catch {
                              taskStatus = 'running';
                            }
                          }
                        } else {
                          taskStatus = 'running';
                        }
                      } catch {
                        taskStatus = 'queued';
                      }
                      
                      tasks.push({ name: item, status: taskStatus });
                    }
                  }
                }
                console.log(`[RUNS-API] ${runId} found ${tasks.length} tasks:`, tasks);
              } catch {
                console.log(`[RUNS-API] ${runId} failed to access tb.lock, marking as failed`);
                status = 'failed';
              }
            }
            
            const runData = {
              id: runId,
              status,
              tasks,
              accuracy,
              timestamp: runId.replace('__', ' ').replace(/-/g, ':'),
              startTime,
              endTime,
              agent,
              model,
              concurrent,
              duration: startTime && endTime ? 
                Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000) : 
                (startTime ? Math.round((Date.now() - new Date(startTime).getTime()) / 1000) : undefined)
            };
            
            console.log(`[RUNS-API] Final run data for ${runId}:`, JSON.stringify(runData, null, 2));
            
            return runData;
          })
      );
      
      return NextResponse.json({ runs });
    } catch (error) {
      // Runs directory doesn't exist yet
      return NextResponse.json({ runs: [] });
    }
  } catch (error) {
    console.error('Error fetching runs:', error);
    return NextResponse.json({ error: 'Failed to fetch runs' }, { status: 500 });
  }
}