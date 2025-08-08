'use client';

import { useState, useEffect } from 'react';
import MultiSelectDropdown from './components/MultiSelectDropdown';
import { AVAILABLE_TASKS, TASK_CATEGORIES } from './constants';

interface RunStatus {
  id: string;
  status: 'running' | 'completed' | 'failed';
  tasks: {
    name: string;
    status: 'queued' | 'running' | 'passed' | 'failed';
  }[];
  accuracy?: number;
  timestamp: string;
  startTime?: string;
  endTime?: string;
  agent?: string;
  model?: string;
  concurrent?: number;
  duration?: number;
}

export default function Home() {
  const [runs, setRuns] = useState<RunStatus[]>([]);
  const [isPolling, setIsPolling] = useState(true); // Auto-refresh by default
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string>('');
  const [lastCommand, setLastCommand] = useState<string>('');
  const [startError, setStartError] = useState<string>('');
  const [killingRun, setKillingRun] = useState<string | null>(null);
  const [config, setConfig] = useState({
    agent: 'claude',
    tasks: ['hello-world', 'fibonacci-server'],
    concurrent: '1',
    platform: 'ec2' as 'local' | 'ec2', // Default to EC2
    ec2Parallel: '10',
    ec2InstanceType: 't3.micro'
  });
  const [ec2Instances, setEc2Instances] = useState<any[]>([]);
  const [ec2Batches, setEc2Batches] = useState<any[]>([]);
  const [s3Batches, setS3Batches] = useState<any[]>([]);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());
  const [runsFilter, setRunsFilter] = useState<'all' | 'local' | 'ec2'>('ec2'); // Default to EC2
  const [copyButtonText, setCopyButtonText] = useState('COPY');
  const [currentTime, setCurrentTime] = useState<string>('');
  const [selectedLogFile, setSelectedLogFile] = useState('terminal-bench.log');
  const [initialLoading, setInitialLoading] = useState(true);

  // Fetch runs status
  const fetchRuns = async () => {
    try {
      // Get local runs
      const response = await fetch('/api/runs');
      const data = await response.json();
      
      // Also get EC2 instances and merge them as runs
      try {
        const ec2Response = await fetch('/api/ec2-status');
        const ec2Data = await ec2Response.json();
        
        console.log('EC2 data:', ec2Data);
        setEc2Batches(ec2Data.batches || []);

        // Also fetch historical runs from S3
        const s3Response = await fetch('/api/s3-runs');
        const s3Data = await s3Response.json();
        console.log('S3 data:', s3Data);
        setS3Batches(s3Data.batches || []);
        
        // Convert EC2 batches to run format (for grouped display)
        const ec2Runs = (ec2Data.batches || []).map((batch: any) => ({
          id: batch.batchId,
          status: batch.runningCount > 0 ? 'running' : 
                  batch.completedCount === batch.taskCount ? 'completed' : 
                  batch.failedCount > 0 ? 'failed' : 'unknown',
          tasks: batch.instances.map((instance: any) => ({
            name: instance.taskId,
            status: instance.status === 'running' ? 'running' :
                   instance.result?.success ? 'passed' : 'failed',
            instanceId: instance.instanceId
          })),
          accuracy: batch.taskCount > 0 ? (batch.completedCount / batch.taskCount) * 100 : 0,
          timestamp: batch.launchTime,
          platform: 'ec2-batch',
          ec2Status: `${batch.runningCount}R ${batch.completedCount}C ${batch.failedCount}F`,
          instanceType: batch.instanceType,
          taskCount: batch.taskCount,
          batchId: batch.batchId
        }));
        
        // Don't add individual instances at all - they're already in the batch
        // The batch will show them when expanded
        const ec2InstanceRuns: any[] = [];
        
        // Get active EC2 batch IDs
        const activeEc2BatchIds = new Set((ec2Data.batches || []).map((b: any) => b.batchId));
        
        // Convert S3 batches to run format (only for batches NOT in EC2 - i.e., completed/historical)
        const s3Runs = (s3Data.batches || [])
          .filter((batch: any) => !activeEc2BatchIds.has(batch.batchId))
          .map((batch: any) => ({
          id: batch.batchId,
          status: 'completed', // Historical runs are completed
          tasks: batch.tasks.map((task: any) => ({
            name: task.taskId,
            status: 'completed'
          })),
          timestamp: new Date(batch.lastModified).toISOString(),
          platform: 'ec2-batch',
          taskCount: batch.taskCount,
          batchId: batch.batchId
        }));

        // Don't create individual S3 task runs - they're in the batch
        const s3TaskRuns: any[] = [];

        // Filter out modal runs and combine all runs
        const localRuns = data.runs.filter((r: any) => r.platform !== 'modal');
        // Put EC2 batches first, then S3 batches, then local runs, then expanded instances
        const allRuns = [...ec2Runs, ...s3Runs, ...localRuns, ...ec2InstanceRuns, ...s3TaskRuns];
        // Sort by timestamp/launchTime, most recent first
        allRuns.sort((a, b) => {
          // Prioritize ec2-batch and running status
          if (a.platform === 'ec2-batch' && a.status === 'running' && 
              !(b.platform === 'ec2-batch' && b.status === 'running')) return -1;
          if (b.platform === 'ec2-batch' && b.status === 'running' && 
              !(a.platform === 'ec2-batch' && a.status === 'running')) return 1;
          
          const aTime = new Date(a.timestamp || a.launchTime || 0).getTime();
          const bTime = new Date(b.timestamp || b.launchTime || 0).getTime();
          return bTime - aTime;
        });
        setRuns(allRuns);
      } catch (ec2Error) {
        // If EC2 fetch fails, just use local runs (filter out modal)
        const localRuns = data.runs.filter((r: any) => r.platform !== 'modal');
        // Sort by timestamp, most recent first
        localRuns.sort((a: any, b: any) => {
          const aTime = new Date(a.timestamp || 0).getTime();
          const bTime = new Date(b.timestamp || 0).getTime();
          return bTime - aTime;
        });
        setRuns(localRuns);
      }
    } catch (error) {
      console.error('Failed to fetch runs:', error);
    } finally {
      setInitialLoading(false);
    }
  };

  // Copy logs to clipboard
  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(logs);
      setCopyButtonText('COPIED!');
      setTimeout(() => setCopyButtonText('COPY'), 2000);
    } catch (error) {
      console.error('Failed to copy logs:', error);
      // Fallback for browsers that don't support clipboard API
      const textArea = document.createElement('textarea');
      textArea.value = logs;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopyButtonText('COPIED!');
      setTimeout(() => setCopyButtonText('COPY'), 2000);
    }
  };

  // Copy all task data including status and logs
  const copyAllTaskData = async () => {
    if (selectedRun && selectedTask && selectedRunData) {
      try {
        const taskInfo = selectedRunData.tasks.find(t => t.name === selectedTask);
        const runInfo = selectedRunData;
        
        const allData = `=== TASK SUMMARY ===\n` +
          `Task: ${selectedTask}\n` +
          `Status: ${taskInfo?.status || 'unknown'}\n` +
          `Batch: ${runInfo.id}\n` +
          `Platform: ${runInfo.platform || 'local'}\n` +
          `Agent: ${runInfo.agent || 'N/A'}\n` +
          `Model: ${runInfo.model || 'N/A'}\n` +
          `Accuracy: ${runInfo.accuracy?.toFixed(1) || 'N/A'}%\n` +
          `Timestamp: ${runInfo.timestamp || runInfo.launchTime || 'N/A'}\n` +
          `Log File: ${selectedLogFile}\n` +
          `\n=== LOGS ===\n` +
          (logs || 'No logs available') +
          `\n\n=== END ===`;
        
        await navigator.clipboard.writeText(allData);
        setCopyButtonText('ALL COPIED!');
        setTimeout(() => setCopyButtonText('COPY'), 3000);
      } catch (error) {
        console.error('Failed to copy all task data:', error);
        // Fallback
        const taskInfo = selectedRunData.tasks.find(t => t.name === selectedTask);
        const runInfo = selectedRunData;
        const allData = `Task: ${selectedTask}, Status: ${taskInfo?.status}, Batch: ${runInfo.id}\n\nLogs:\n${logs || 'No logs'}`;
        const textArea = document.createElement('textarea');
        textArea.value = allData;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopyButtonText('ALL COPIED!');
        setTimeout(() => setCopyButtonText('COPY'), 3000);
      }
    }
  };

  // Fetch task logs
  const fetchLogs = async (runId: string, taskName: string, logFile: string = selectedLogFile) => {
    console.log('fetchLogs called with:', { runId, taskName, logFile });
    try {
      // Check if this is an EC2 instance (starts with i-)
      if (runId.startsWith('i-')) {
        // First try EC2 console logs
        const response = await fetch(`/api/ec2-logs?instanceId=${runId}&taskId=${taskName}`);
        const data = await response.json();
        
        if (data.logs && data.logs !== '') {
          setLogs(data.logs);
        } else {
          // If no EC2 console logs, try S3
          const run = runs.find(r => r.id === runId);
          if (run && run.batchId) {
            const s3Response = await fetch(`/api/s3-logs?batchId=${run.batchId}&taskId=${taskName || run.tasks?.[0]?.name || 'unknown'}&logFile=${logFile}`);
            const s3Data = await s3Response.json();
            setLogs(s3Data.logs || 'No logs available yet. Instance may still be starting...');
          } else {
            setLogs('No logs available yet. Instance may still be starting...');
          }
        }
      } else if (runId.startsWith('batch-')) {
        // For batch view, check if a specific task is selected
        if (taskName && taskName !== '') {
          // Use the full batch ID (don't remove 'batch-' prefix)
          const batchId = runId;
          const url = `/api/s3-logs?batchId=${batchId}&taskId=${taskName}&logFile=${logFile}`;
          console.log('Fetching S3 logs from:', url);
          const s3Response = await fetch(url);
          const s3Data = await s3Response.json();
          console.log('S3 response:', s3Data);
          setLogs(s3Data.logs || 'No logs available for this task');
        } else {
          setLogs('Select an individual task to view logs');
        }
      } else {
        // Handle other run types - might be batch tasks
        const run = runs.find(r => r.id === runId);
        if (run && run.batchId && (run.platform === 'ec2' || run.platform === 's3-task')) {
          // This is an individual EC2 task from a batch - fetch from S3
          const taskId = run.taskId || run.tasks?.[0]?.name || taskName || 'unknown';
          const s3Response = await fetch(`/api/s3-logs?batchId=${run.batchId}&taskId=${taskId}&logFile=${logFile}`);
          const s3Data = await s3Response.json();
          setLogs(s3Data.logs || 'No logs available for this task');
        } else {
          // Fallback for other types
          const response = await fetch(`/api/logs?runId=${runId}&task=${taskName}`);
          const data = await response.json();
          setLogs(data.logs || 'No logs available');
        }
      }
    } catch (error) {
      console.error('Failed to fetch logs:', error);
      setLogs('Failed to load logs');
    }
  };

  // Check EC2 instances status
  const checkEc2Status = async () => {
    try {
      const response = await fetch('/api/ec2-status');
      const data = await response.json();
      setEc2Instances(data.instances || []);
    } catch (error) {
      console.error('Failed to check EC2 status:', error);
      setEc2Instances([]);
    }
  };

  // Fetch EC2 instance logs
  const fetchEc2Logs = async (instanceId: string, taskId: string) => {
    try {
      const response = await fetch(`/api/ec2-logs?instanceId=${instanceId}&taskId=${taskId}`);
      const data = await response.json();
      setLogs(data.logs || 'No logs available');
    } catch (error) {
      console.error('Failed to fetch EC2 logs:', error);
      setLogs('Failed to load EC2 logs');
    }
  };

  // Start a new run
  const startRun = async () => {
    setLoading(true);
    setStartError('');
    
    // Immediate UI feedback
    const tempRunId = 'pending-' + Date.now();
    const tempRun = {
      id: tempRunId,
      status: 'starting',
      tasks: config.tasks.map(t => ({ name: t, status: 'pending' })),
      agent: config.agent,
      model: config.model,
      accuracy: 0,
      timestamp: new Date().toISOString(),
      platform: config.platform === 'ec2' ? 'ec2' : 'local',
      taskCount: config.tasks.length
    };
    setRuns(prev => [tempRun, ...prev]);
    setSelectedRun(tempRunId);
    
    try {
      const endpoint = config.platform === 'ec2' ? '/api/ec2-start' : '/api/start-run';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          taskIds: config.platform === 'ec2' ? config.tasks : undefined,
          tasks: config.platform === 'ec2' ? undefined : config.tasks.join(' '),
          agentType: config.agent === 'claude' ? 'claude' : 'opencode',
          model: config.platform === 'ec2' ? 'openai/gpt-4o-mini' : undefined,
          parallel: config.platform === 'ec2' ? parseInt(config.ec2Parallel) : undefined
        })
      });
      const data = await response.json();
      
      if (data.command) {
        setLastCommand(data.command);
      }
      
      if (!response.ok) {
        setStartError(data.error || 'Failed to start run');
        // Remove temporary run on error
        setRuns(prev => prev.filter(r => r.id !== tempRunId));
      } else if (data.runId) {
        // Remove temporary run when real one arrives
        setRuns(prev => prev.filter(r => r.id !== tempRunId));
        setSelectedRun(data.runId);
        
        // Show any initial errors
        if (data.initialError) {
          setStartError(`Initial output: ${data.initialError}`);
        }
        
        // Immediately refresh and enable auto-polling when starting a job
        fetchRuns();
        setIsPolling(true); // Auto-enable polling when job starts
        setTimeout(() => fetchRuns(), 500);
        setTimeout(() => fetchRuns(), 2000);
      }
    } catch (error) {
      console.error('Failed to start run:', error);
      setStartError(error instanceof Error ? error.message : 'Failed to start run');
      // Remove temporary run on error
      setRuns(prev => prev.filter(r => r.id !== tempRunId));
    }
    setLoading(false);
  };
  
  // Kill a run
  const killRun = async (runId: string) => {
    setKillingRun(runId);
    try {
      let response;
      
      // Check if this is an EC2 instance (starts with i-)
      if (runId.startsWith('i-')) {
        // Use EC2 kill endpoint
        response = await fetch('/api/ec2-kill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instanceIds: [runId] })
        });
      } else {
        // Use local kill endpoint
        response = await fetch('/api/kill-run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId })
        });
      }
      
      const data = await response.json();
      
      if (response.ok) {
        // Refresh runs after killing
        fetchRuns();
      } else {
        console.error('Failed to kill run:', data.error);
      }
    } catch (error) {
      console.error('Failed to kill run:', error);
    }
    setKillingRun(null);
  };
  
  // Format duration
  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  // Click-based auto-refresh
  useEffect(() => {
    fetchRuns(); // Initial load
    // checkEc2Status(); // Also check EC2 status on load
  }, []);


  // Check Modal status on mount and platform change
  useEffect(() => {
    if (config.platform === 'modal') {
      checkEc2Status();
    }
  }, [config.platform]);

  // Auto-refresh only when polling is explicitly enabled
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (isPolling) {
      // Fast refresh when user enables polling
      fetchRuns(); // Immediate fetch
      interval = setInterval(() => {
        fetchRuns();
        // Also refresh logs if a run is selected
        if (selectedRun && selectedTask) {
          fetchLogs(selectedRun, selectedTask, selectedLogFile);
        }
      }, 3000);
    }
    
    return () => clearInterval(interval);
  }, [isPolling]);

  // Filter runs based on selected filter
  const filteredRuns = runs.filter(run => {
    if (runsFilter === 'all') return true;
    if (runsFilter === 'local') return !run.platform || run.platform === 'local';
    if (runsFilter === 'ec2') {
      // For EC2 filter, show all EC2 batches (both running and completed from S3)
      if (run.platform === 'ec2-batch') return true;
      return false;
    }
    return true;
  });

  const selectedRunData = runs.find(r => r.id === selectedRun);

  // Update time display to avoid hydration errors
  useEffect(() => {
    setCurrentTime(new Date().toLocaleString());
    const interval = setInterval(() => {
      setCurrentTime(new Date().toLocaleString());
    }, 60000); // Update every minute
    return () => clearInterval(interval);
  }, []);
  
  // Auto-select first filtered run and its first task
  useEffect(() => {
    if (filteredRuns.length > 0 && !selectedRun) {
      const firstRun = filteredRuns[0];
      setSelectedRun(firstRun.id);
      if (firstRun.tasks.length > 0) {
        setSelectedTask(firstRun.tasks[0].name);
      }
    }
  }, [filteredRuns, selectedRun]);

  // Load logs when task is selected
  useEffect(() => {
    if (selectedRun && selectedTask) {
      console.log('Fetching logs for:', selectedRun, selectedTask, selectedLogFile);
      fetchLogs(selectedRun, selectedTask, selectedLogFile);
    } else {
      setLogs(''); // Clear logs when nothing selected
    }
  }, [selectedRun, selectedTask, selectedLogFile]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running': return '◉ RUNNING';
      case 'starting': return '◉ STARTING';
      case 'completed': return '✓ DONE';
      case 'passed': return '✓ PASS';
      case 'failed': return '✗ FAIL';
      case 'queued': return '○ WAIT';
      default: return '○ PENDING';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return '#f1fa8c';
      case 'completed': return '#50fa7b';
      case 'passed': return '#50fa7b';
      case 'failed': return '#ff5555';
      case 'queued': return '#6272a4';
      default: return '#6272a4';
    }
  };

  return (
    <main style={{ 
      minHeight: '100vh', 
      backgroundColor: '#0d1117',
      color: '#58a6ff',
      fontFamily: 'Monaco, "Cascadia Code", "Courier New", monospace',
      fontSize: '14px',
      padding: '0'
    }}>
      {/* Tmux status bar at top */}
      <div style={{
        backgroundColor: '#161b22',
        color: '#8b949e',
        padding: '0.25rem 1rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontWeight: 'bold',
        borderBottom: '1px solid #30363d'
      }}>
        <div>[0] terminal-bench-dashboard</div>
        <div>{currentTime} | {runs.filter(r => r.status === 'running').length} running</div>
      </div>

      <div style={{ display: 'flex', height: 'calc(100vh - 60px)' }}>
        
        {/* Left pane - Configuration */}
        <div style={{ 
          flex: '0 0 400px',
          borderRight: '1px solid #30363d',
          padding: '1rem',
          overflowY: 'auto',
          backgroundColor: '#0d1117'
        }}>
          <div style={{ 
            marginBottom: '1rem',
            borderBottom: '1px solid #30363d',
            paddingBottom: '0.5rem'
          }}>
            <span style={{ color: '#79c0ff' }}>─[ NEW RUN ]─</span>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', color: '#8b949e' }}>
                Platform:
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => setConfig({...config, platform: 'local'})}
                  style={{
                    flex: 1,
                    padding: '0.25rem',
                    backgroundColor: config.platform === 'local' ? '#1f6feb' : '#161b22',
                    color: config.platform === 'local' ? '#ffffff' : '#8b949e',
                    border: '1px solid #30363d',
                    cursor: 'pointer',
                    fontFamily: 'inherit'
                  }}
                >
                  LOCAL
                </button>
                <button
                  onClick={() => setConfig({...config, platform: 'ec2'})}
                  style={{
                    flex: 1,
                    padding: '0.25rem',
                    backgroundColor: config.platform === 'ec2' ? '#1f6feb' : '#161b22',
                    color: config.platform === 'ec2' ? '#ffffff' : '#8b949e',
                    border: '1px solid #30363d',
                    cursor: 'pointer',
                    fontFamily: 'inherit'
                  }}
                >
                  AWS EC2
                </button>
              </div>
            </div>
            
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', color: '#8b949e' }}>
                Agent:
              </label>
              <select 
                style={{ 
                  width: '100%', 
                  padding: '0.25rem', 
                  backgroundColor: '#161b22',
                  color: '#c9d1d9',
                  border: '1px solid #30363d',
                  fontFamily: 'inherit'
                }}
                value={config.agent}
                onChange={(e) => setConfig({...config, agent: e.target.value})}
              >
                <option value="claude">claude</option>
                <option value="opencode">opencode</option>
              </select>
            </div>
            
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', color: '#8b949e' }}>
                Tasks: [{config.tasks.length}]
              </label>
              <MultiSelectDropdown
                options={AVAILABLE_TASKS}
                selectedValues={config.tasks}
                onChange={(tasks) => setConfig({...config, tasks})}
                placeholder="Select tasks..."
                categories={TASK_CATEGORIES}
              />
            </div>
            
            {config.platform === 'local' ? (
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', color: '#8b949e' }}>
                  Concurrent:
                </label>
                <input 
                  type="number"
                  style={{ 
                    width: '100%', 
                    padding: '0.25rem', 
                    backgroundColor: '#161b22',
                    color: '#c9d1d9',
                    border: '1px solid #30363d',
                    fontFamily: 'inherit'
                  }}
                  value={config.concurrent}
                  onChange={(e) => setConfig({...config, concurrent: e.target.value})}
                  min="1"
                  max="10"
                />
              </div>
            ) : (
              <>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.25rem', color: '#8b949e' }}>
                    Instance Type:
                  </label>
                  <select
                    style={{ 
                      width: '100%', 
                      padding: '0.25rem', 
                      backgroundColor: '#161b22',
                      color: '#c9d1d9',
                      border: '1px solid #30363d',
                      fontFamily: 'inherit'
                    }}
                    value={config.ec2InstanceType}
                    onChange={(e) => setConfig({...config, ec2InstanceType: e.target.value})}
                  >
                    <option value="t3.micro">t3.micro (cheapest)</option>
                    <option value="t3.small">t3.small</option>
                    <option value="t3.medium">t3.medium</option>
                    <option value="t3.large">t3.large</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.25rem', color: '#8b949e' }}>
                    Parallel EC2 Instances:
                  </label>
                  <input 
                    type="number"
                    style={{ 
                      width: '100%', 
                      padding: '0.25rem', 
                      backgroundColor: '#161b22',
                      color: '#c9d1d9',
                      border: '1px solid #30363d',
                      fontFamily: 'inherit'
                    }}
                    value={config.ec2Parallel}
                    onChange={(e) => setConfig({...config, ec2Parallel: e.target.value})}
                    min="1"
                    max="50"
                  />
                </div>
                {false && (
                  <div style={{
                    padding: '0.5rem',
                    border: '1px solid #f1fa8c',
                    color: '#f1fa8c',
                    fontSize: '12px',
                    backgroundColor: '#1c1f24'
                  }}>
                    ⚠️ Modal not configured. Install: pip install modal
                    <button
                      onClick={checkEc2Status}
                      style={{
                        marginLeft: '0.5rem',
                        padding: '0 0.25rem',
                        backgroundColor: '#1f6feb',
                        color: '#ffffff',
                        border: 'none',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: '10px'
                      }}
                    >
                      RECHECK
                    </button>
                  </div>
                )}
                {false && (
                  <div style={{
                    padding: '0.5rem',
                    border: '1px solid #f1fa8c',
                    color: '#f1fa8c',
                    fontSize: '12px',
                    backgroundColor: '#1c1f24'
                  }}>
                    ⚠️ Modal not authenticated. Run: modal token new
                  </div>
                )}
              </>
            )}
            
            <button
              onClick={startRun}
              disabled={loading}
              style={{
                width: '100%',
                padding: '0.5rem',
                backgroundColor: loading ? '#21262d' : '#238636',
                color: '#ffffff',
                border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                fontWeight: 'bold'
              }}
            >
              {loading ? 'STARTING...' : '[ START RUN ]'}
            </button>
            
            {startError && (
              <div style={{
                padding: '0.5rem',
                border: '1px solid #ff5555',
                color: '#ff5555',
                fontSize: '12px',
                backgroundColor: '#1c1f24'
              }}>
                ERROR: {startError}
              </div>
            )}
            
            {lastCommand && (
              <div style={{
                padding: '0.5rem',
                border: '1px solid #30363d',
                fontSize: '11px',
                wordBreak: 'break-all',
                backgroundColor: '#161b22'
              }}>
                <div style={{ color: '#79c0ff', marginBottom: '0.25rem' }}>$ COMMAND:</div>
                <span style={{ color: '#8b949e' }}>{lastCommand}</span>
              </div>
            )}
            
          </div>
        </div>

        {/* Middle pane - Runs list */}
        <div style={{ 
          flex: '0 0 400px',
          borderRight: '1px solid #30363d',
          padding: '1rem',
          overflowY: 'auto',
          backgroundColor: '#0d1117'
        }}>
          {initialLoading && (
            <div style={{ 
              color: '#58a6ff', 
              textAlign: 'center', 
              marginTop: '1rem',
              marginBottom: '1rem',
              padding: '0.5rem',
              backgroundColor: '#161b22',
              border: '1px solid #30363d',
              borderRadius: '3px'
            }}>
              <div style={{ marginBottom: '0.25rem' }}>⟳ Loading runs...</div>
              <div style={{ color: '#8b949e', fontSize: '11px' }}>Fetching from EC2 and S3</div>
            </div>
          )}
          <div style={{ 
            marginBottom: '1rem',
            borderBottom: '1px solid #30363d',
            paddingBottom: '0.5rem'
          }}>
            <div style={{ 
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.5rem'
            }}>
              <span style={{ color: '#79c0ff' }}>─[ RUNS ]─</span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                onClick={() => fetchRuns()}
                style={{
                  padding: '0 0.5rem',
                  backgroundColor: '#1f6feb',
                  color: '#ffffff',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: '12px'
                }}
              >
                REFRESH
              </button>
              <button
                onClick={() => setIsPolling(!isPolling)}
                style={{
                  padding: '0 0.5rem',
                  backgroundColor: isPolling ? '#da3633' : '#238636',
                  color: '#ffffff',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: '12px'
                }}
              >
                {isPolling ? 'STOP' : 'AUTO'}
              </button>
              {runs.filter(run => run.status === 'running').length > 0 && (
                <button
                  onClick={async () => {
                    const runningRuns = runs.filter(run => run.status === 'running');
                    for (const run of runningRuns) {
                      await killRun(run.id);
                    }
                    setTimeout(() => fetchRuns(), 2000);
                  }}
                  style={{
                    padding: '0 0.5rem',
                    backgroundColor: '#da3633',
                    color: '#ffffff',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '12px'
                  }}
                >
                  KILL ALL
                </button>
              )}
              </div>
            </div>
            
            {/* Filter buttons */}
            <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.5rem' }}>
              {['all', 'local', 'ec2'].map((filter) => (
                <button
                  key={filter}
                  onClick={() => setRunsFilter(filter as 'all' | 'local' | 'ec2')}
                  style={{
                    padding: '0.25rem 0.5rem',
                    backgroundColor: runsFilter === filter ? '#1f6feb' : '#161b22',
                    color: runsFilter === filter ? '#ffffff' : '#8b949e',
                    border: '1px solid #30363d',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '11px'
                  }}
                >
                  {filter.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          
          {filteredRuns.length === 0 ? (
            <div style={{ color: '#6e7681' }}>
              {runs.length === 0 ? 'No runs yet' : `No ${runsFilter} runs`}
            </div>
          ) : (
            filteredRuns.map(run => (
              <div key={run.id}>
                <div
                  onClick={() => {
                    if (run.platform === 'ec2-batch') {
                      // Toggle batch expansion using run.id which is unique
                      const newExpanded = new Set(expandedBatches);
                      if (newExpanded.has(run.id)) {
                        newExpanded.delete(run.id);
                      } else {
                        newExpanded.add(run.id);
                      }
                      setExpandedBatches(newExpanded);
                    } else {
                      setSelectedRun(run.id);
                      // Auto-select first task
                      if (run.tasks && run.tasks.length > 0) {
                        setSelectedTask(run.tasks[0].name);
                      } else {
                        setSelectedTask(null);
                      }
                    }
                  }}
                  style={{
                    padding: '0.5rem',
                    marginBottom: run.platform === 'ec2-batch' && expandedBatches.has(run.id) ? '0.25rem' : '0.5rem',
                    border: selectedRun === run.id ? '1px solid #58a6ff' : '1px solid #30363d',
                    backgroundColor: selectedRun === run.id ? '#161b22' : '#0d1117',
                    cursor: 'pointer'
                  }}
                >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ 
                      color: getStatusColor(run.status),
                      animation: (run.status === 'running' || run.status === 'starting') ? 'pulse 1.5s infinite' : 'none'
                    }}>
                      {getStatusIcon(run.status)}
                    </span>
                    {run.platform === 'ec2-batch' && (
                      <span style={{ color: '#8b949e', fontSize: '12px' }}>
                        {expandedBatches.has(run.id) ? '▼' : '▶'}
                      </span>
                    )}
                  </div>
                  {run.accuracy !== undefined && (
                    <span style={{ color: '#c9d1d9' }}>{run.accuracy.toFixed(0)}%</span>
                  )}
                </div>
                <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '0.25rem' }}>
                  {run.platform === 'ec2-batch' ? `Batch: ${run.taskCount} tasks` : run.id}
                </div>
                <div style={{ fontSize: '11px', color: '#6e7681', marginTop: '0.25rem' }}>
                  <span style={{ 
                    color: run.platform === 'ec2-batch' ? '#ff9800' : 
                           run.platform === 'ec2' ? '#ff9800' : 
                           run.platform === 'modal' ? '#f1fa8c' : '#8b949e',
                    fontWeight: run.platform?.includes('ec2') || run.platform === 'modal' ? 'bold' : 'normal'
                  }}>
                    [{run.platform === 'ec2-batch' ? 
                       (run.status === 'running' ? 'EC2 BATCH' : 'COMPLETED') : 
                       run.platform?.toUpperCase() || 'LOCAL'}]
                  </span>
                  {run.platform === 'ec2-batch' ? (
                    ` ${run.instanceType || 't3.micro'} | ${run.ec2Status}`
                  ) : run.platform === 'ec2' ? (
                    ` ${run.instanceType || 't3.micro'} | ${run.ec2Status}`
                  ) : (
                    ` ${run.agent}/${run.model?.split('/')[1] || ''}`
                  )}
                  {run.platform !== 'ec2-batch' && ` | ${run.tasks.length} tasks`}
                  {run.duration && ` | ${formatDuration(run.duration)}`}
                </div>
                <div style={{ fontSize: '10px', color: '#6e7681', marginTop: '0.25rem' }}>
                  {run.timestamp || run.launchTime ? 
                    new Date(run.timestamp || run.launchTime).toLocaleString() : 
                    'No timestamp'
                  }
                </div>
                
                {run.status === 'running' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (run.platform === 'ec2-batch') {
                        // Kill all instances in the batch
                        const batch = ec2Batches.find(b => b.batchId === run.batchId);
                        if (batch) {
                          batch.instances.forEach((instance: any) => {
                            if (instance.status === 'running') {
                              killRun(instance.instanceId);
                            }
                          });
                        }
                      } else {
                        killRun(run.id);
                      }
                    }}
                    disabled={killingRun === run.id}
                    style={{
                      marginTop: '0.25rem',
                      padding: '0 0.25rem',
                      backgroundColor: '#da3633',
                      color: '#ffffff',
                      border: 'none',
                      cursor: killingRun === run.id ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit',
                      fontSize: '11px'
                    }}
                  >
                    {killingRun === run.id ? 'KILLING...' : 
                     run.platform === 'ec2-batch' ? 'KILL BATCH' : 'KILL'}
                  </button>
                )}
              </div>
              {run.platform === 'ec2-batch' && expandedBatches.has(run.id) && (
                <div style={{ marginLeft: '1rem', marginTop: '0.5rem' }}>
                  {run.tasks.map((task: any, taskIdx: number) => (
                    <div
                      key={taskIdx}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRun(run.id);
                        setSelectedTask(task.name);
                      }}
                      style={{
                        padding: '0.25rem 0.5rem',
                        marginBottom: '0.25rem',
                        border: selectedRun === run.id && selectedTask === task.name ? '1px solid #58a6ff' : '1px solid #30363d',
                        backgroundColor: selectedRun === run.id && selectedTask === task.name ? '#161b22' : '#0d1117',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ color: getStatusColor(task.status), marginRight: '0.5rem' }}>
                            {getStatusIcon(task.status)}
                          </span>
                          <span style={{ color: '#c9d1d9' }}>{task.name}</span>
                        </div>
                        {task.instanceId && (
                          <span style={{ color: '#6e7681', fontSize: '10px' }}>
                            {task.instanceId}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            ))
          )}
        </div>

        {/* Right pane - Details/Logs */}
        <div style={{ 
          flex: '1',
          padding: '1rem',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#0d1117'
        }}>
          {selectedRunData ? (
            <>
              <div style={{ 
                marginBottom: '1rem',
                borderBottom: '1px solid #30363d',
                paddingBottom: '0.5rem'
              }}>
                <span style={{ color: '#79c0ff' }}>─[ RUN: {selectedRunData.id} ]─</span>
              </div>
              
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ color: '#8b949e' }}>Status: <span style={{ color: getStatusColor(selectedRunData.status) }}>{selectedRunData.status}</span></div>
                {selectedRunData.accuracy !== undefined && (
                  <div style={{ color: '#8b949e' }}>Accuracy: {(selectedRunData.accuracy * 100).toFixed(1)}%</div>
                )}
              </div>
              
              <div style={{ 
                marginBottom: '1rem',
                borderBottom: '1px solid #30363d',
                paddingBottom: '0.5rem'
              }}>
                <div style={{ color: '#79c0ff', marginBottom: '0.5rem' }}>TASKS:</div>
                {selectedRunData.tasks.map((task, idx) => (
                  <div 
                    key={idx} 
                    onClick={() => setSelectedTask(task.name)}
                    style={{ 
                      padding: '0.25rem',
                      marginBottom: '0.25rem',
                      border: selectedTask === task.name ? '1px solid #58a6ff' : '1px solid #30363d',
                      backgroundColor: selectedTask === task.name ? '#161b22' : '#0d1117',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between'
                    }}
                  >
                    <span style={{ color: '#c9d1d9' }}>{task.name}</span>
                    <span style={{ 
                      color: getStatusColor(task.status),
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem'
                    }}>
                      {(task.status === 'running' || task.status === 'pending') && (
                        <span style={{ 
                          display: 'inline-block',
                          animation: 'spin 1s linear infinite'
                        }}>◉</span>
                      )}
                      {getStatusIcon(task.status)}
                    </span>
                  </div>
                ))}
              </div>
              
              {selectedTask && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ 
                    marginBottom: '0.5rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span style={{ color: '#79c0ff' }}>─[ LOG: {selectedTask} ]─</span>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <select
                        value={selectedLogFile}
                        onChange={(e) => {
                          setSelectedLogFile(e.target.value);
                          fetchLogs(selectedRun!, selectedTask, e.target.value);
                        }}
                        style={{
                          padding: '0 0.5rem',
                          backgroundColor: '#161b22',
                          color: '#c9d1d9',
                          border: '1px solid #30363d',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontSize: '12px'
                        }}
                      >
                        <option value="terminal-bench.log">terminal-bench.log</option>
                        <option value="summary.json">summary.json</option>
                        <option value="results.json">results.json</option>
                        <option value="run.log">run.log</option>
                        <option value="run_metadata.json">run_metadata.json</option>
                        <option value="commands.txt">commands.txt (agent commands)</option>
                        <option value="sessions/agent.log">sessions/agent.log (full agent session)</option>
                        <option value="sessions/tests.log">sessions/tests.log (test execution)</option>
                      </select>
                      <button
                        onClick={() => fetchLogs(selectedRun!, selectedTask, selectedLogFile)}
                        style={{
                          padding: '0 0.5rem',
                          backgroundColor: '#1f6feb',
                          color: '#ffffff',
                          border: 'none',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontSize: '12px'
                        }}
                      >
                        REFRESH
                      </button>
                    </div>
                  </div>
                  
                  {/* Log status indicator and copy button */}
                  {logs && (
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center',
                      marginBottom: '0.5rem', 
                      fontSize: '12px' 
                    }}>
                      <div>
                        {(logs.includes('2 passed in') || logs.includes('PASSED ../tests/')) ? (
                          <span style={{ color: '#50fa7b' }}>[OK] Tests passed</span>
                        ) : logs.includes('FAILED ../tests/') ? (
                          <span style={{ color: '#ff5555' }}>[FAIL] Tests failed</span>
                        ) : logs.includes('recording finished') ? (
                          <span style={{ color: '#f1fa8c' }}>[DONE] Execution complete</span>
                        ) : (
                          <span style={{ color: '#6e7681' }}>[...] Processing</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          onClick={copyLogs}
                          style={{
                            padding: '0.25rem 0.5rem',
                            backgroundColor: copyButtonText === 'COPIED!' ? '#238636' : '#161b22',
                            color: copyButtonText === 'COPIED!' ? '#ffffff' : '#8b949e',
                            border: '1px solid #30363d',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            fontSize: '11px'
                          }}
                        >
                          {copyButtonText === 'ALL COPIED!' ? 'COPIED!' : copyButtonText}
                        </button>
                        <button
                          onClick={copyAllTaskData}
                          style={{
                            padding: '0.25rem 0.5rem',
                            backgroundColor: copyButtonText === 'ALL COPIED!' ? '#238636' : '#21262d',
                            color: copyButtonText === 'ALL COPIED!' ? '#ffffff' : '#79c0ff',
                            border: '1px solid #30363d',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            fontSize: '11px'
                          }}
                        >
                          COPY ALL
                        </button>
                      </div>
                    </div>
                  )}
                  
                  <div style={{
                    flex: 1,
                    backgroundColor: '#0d1117',
                    border: '1px solid #30363d',
                    padding: '0.5rem',
                    fontFamily: 'Monaco, monospace',
                    fontSize: '12px',
                    lineHeight: '1.4',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    color: '#c9d1d9'
                  }}>
                    {logs || 'No logs available'}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ color: '#6e7681' }}>Select a run to view details</div>
          )}
        </div>
      </div>

      {/* Tmux status bar at bottom */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#161b22',
        color: '#8b949e',
        padding: '0.25rem 1rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '12px',
        fontWeight: 'bold',
        borderTop: '1px solid #30363d'
      }}>
        <div>
          <span>[0]</span>
          <span style={{ marginLeft: '1rem' }}>0:dashboard*</span>
          <span style={{ marginLeft: '0.5rem' }}>1:config</span>
          <span style={{ marginLeft: '0.5rem' }}>2:runs</span>
          <span style={{ marginLeft: '0.5rem' }}>3:logs</span>
        </div>
        <div>
          {isPolling && <span style={{ marginRight: '1rem' }}>[AUTO-REFRESH]</span>}
          terminal-bench@localhost
        </div>
      </div>
    </main>
  );
}