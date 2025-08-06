import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get('runId');
    const taskName = searchParams.get('task');
    
    if (!runId || !taskName) {
      return NextResponse.json({ 
        error: 'Missing runId or task parameter' 
      }, { status: 400 });
    }
    
    // Path to the run directory
    const runsPath = path.join(process.cwd(), '..', '..', 'runs');
    const runPath = path.join(runsPath, runId);
    const taskPath = path.join(runPath, taskName);
    
    // Try to find logs in various locations
    let logs = '';
    
    try {
      // Check for task-specific directories
      const taskItems = await fs.readdir(taskPath);
      const taskDir = taskItems.find(item => item.startsWith(taskName));
      
      if (taskDir) {
        const taskDirPath = path.join(taskPath, taskDir);
        
        // Check for agent log in sessions directory
        try {
          const sessionsPath = path.join(taskDirPath, 'sessions');
          const agentLogPath = path.join(sessionsPath, 'agent.log');
          const agentLogContent = await fs.readFile(agentLogPath, 'utf-8');
          if (agentLogContent.trim()) {
            logs += '=== Agent Log ===\n' + agentLogContent + '\n\n';
          }
        } catch {
          // No agent.log
        }
        
        // Check for commands.txt
        try {
          const commandsPath = path.join(taskDirPath, 'commands.txt');
          const commandsContent = await fs.readFile(commandsPath, 'utf-8');
          if (commandsContent.trim()) {
            logs += '=== Commands ===\n' + commandsContent + '\n\n';
          }
        } catch {
          // No commands.txt
        }
        
        const trialPath = taskDirPath;
        
        // Check for log files in sessions directory
        const sessionsPath = path.join(trialPath, 'sessions');
        try {
          const sessionFiles = await fs.readdir(sessionsPath);
          for (const sessionFile of sessionFiles) {
            if (sessionFile.endsWith('.log')) {
              try {
                const logPath = path.join(sessionsPath, sessionFile);
                const content = await fs.readFile(logPath, 'utf-8');
                if (content.trim()) {
                  logs += `\n=== ${sessionFile} ===\n${content}\n`;
                }
              } catch {
                // File doesn't exist or can't be read, continue
              }
            }
          }
        } catch {
          // Sessions directory doesn't exist
        }

        // Also check for commands.txt
        try {
          const commandsPath = path.join(trialPath, 'commands.txt');
          const content = await fs.readFile(commandsPath, 'utf-8');
          if (content.trim()) {
            logs += `\n=== commands.txt ===\n${content}\n`;
          }
        } catch {
          // File doesn't exist, continue
        }

        // Check panes directory for additional logs
        const panesPath = path.join(trialPath, 'panes');
        try {
          const paneFiles = await fs.readdir(panesPath);
          for (const paneFile of paneFiles) {
            if (paneFile.endsWith('.txt')) {
              try {
                const panePath = path.join(panesPath, paneFile);
                const content = await fs.readFile(panePath, 'utf-8');
                if (content.trim()) {
                  logs += `\n=== panes/${paneFile} ===\n${content}\n`;
                }
              } catch {
                // File doesn't exist or can't be read, continue
              }
            }
          }
        } catch {
          // Panes directory doesn't exist
        }
        
        // Also check for recording.json for command history
        try {
          const recordingPath = path.join(trialPath, 'recording.json');
          const recordingData = await fs.readFile(recordingPath, 'utf-8');
          const recording = JSON.parse(recordingData);
          
          logs += '\n=== Command History ===\n';
          for (const event of recording.events) {
            if (event.type === 'command') {
              logs += `$ ${event.command}\n`;
              if (event.output) {
                logs += event.output + '\n';
              }
            }
          }
        } catch {
          // No recording file
        }
        
        // Check results.json for final status
        try {
          const resultsPath = path.join(trialPath, 'results.json');
          const resultsData = await fs.readFile(resultsPath, 'utf-8');
          const results = JSON.parse(resultsData);
          
          logs += '\n=== Task Results ===\n';
          logs += `Status: ${results.passed ? 'PASSED' : 'FAILED'}\n`;
          if (results.error) {
            logs += `Error: ${results.error}\n`;
          }
          if (results.message) {
            logs += `Message: ${results.message}\n`;
          }
        } catch {
          // No results file
        }
      }
      
      // If no logs found, check if task is still running
      if (!logs.trim()) {
        logs = 'Task is queued or still initializing...';
      }
      
    } catch (error) {
      // Task directory doesn't exist yet
      logs = 'Task has not started yet or logs are not available.';
    }
    
    return NextResponse.json({ logs });
    
  } catch (error) {
    console.error('Error fetching logs:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch logs',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}