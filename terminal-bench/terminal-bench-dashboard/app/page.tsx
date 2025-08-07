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
  const [isPolling, setIsPolling] = useState(false);
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
    platform: 'local' as 'local' | 'modal',
    modalParallel: '10',
    modalModel: 'gpt-4o-mini'
  });
  const [modalStatus, setModalStatus] = useState<{
    available: boolean;
    authenticated: boolean;
    version?: string;
  }>({ available: false, authenticated: false });

  // Fetch runs status
  const fetchRuns = async () => {
    try {
      const response = await fetch('/api/runs');
      const data = await response.json();
      setRuns(data.runs);
    } catch (error) {
      console.error('Failed to fetch runs:', error);
    }
  };

  // Fetch task logs
  const fetchLogs = async (runId: string, taskName: string) => {
    try {
      const response = await fetch(`/api/logs?runId=${runId}&task=${taskName}`);
      const data = await response.json();
      setLogs(data.logs || 'No logs available');
    } catch (error) {
      console.error('Failed to fetch logs:', error);
      setLogs('Failed to load logs');
    }
  };

  // Check Modal availability
  const checkModalStatus = async () => {
    try {
      const response = await fetch('/api/modal');
      const data = await response.json();
      setModalStatus({
        available: data.status === 'available',
        authenticated: data.authenticated || false,
        version: data.version
      });
    } catch (error) {
      console.error('Failed to check Modal status:', error);
      setModalStatus({ available: false, authenticated: false });
    }
  };

  // Start a new run
  const startRun = async () => {
    setLoading(true);
    setStartError('');
    try {
      const endpoint = config.platform === 'modal' ? '/api/modal' : '/api/start-run';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          taskIds: config.platform === 'modal' ? config.tasks : undefined,
          tasks: config.platform === 'modal' ? undefined : config.tasks.join(' '),
          agentType: config.agent === 'claude' ? 'claude' : 'opencode',
          model: config.platform === 'modal' ? config.modalModel : undefined,
          parallel: config.platform === 'modal' ? parseInt(config.modalParallel) : undefined
        })
      });
      const data = await response.json();
      
      if (data.command) {
        setLastCommand(data.command);
      }
      
      if (!response.ok) {
        setStartError(data.error || 'Failed to start run');
      } else if (data.runId) {
        setSelectedRun(data.runId);
        
        // Show any initial errors
        if (data.initialError) {
          setStartError(`Initial output: ${data.initialError}`);
        }
        
        // Immediately refresh and enable auto-polling when starting a job
        fetchRuns();
        setIsPolling(true); // Auto-enable polling when job starts
        setTimeout(() => fetchRuns(), 2000);
        setTimeout(() => fetchRuns(), 5000);
      }
    } catch (error) {
      console.error('Failed to start run:', error);
      setStartError(error instanceof Error ? error.message : 'Failed to start run');
    }
    setLoading(false);
  };
  
  // Kill a run
  const killRun = async (runId: string) => {
    setKillingRun(runId);
    try {
      const response = await fetch('/api/kill-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId })
      });
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
  }, []);

  // Check Modal status on mount and platform change
  useEffect(() => {
    if (config.platform === 'modal') {
      checkModalStatus();
    }
  }, [config.platform]);

  // Auto-refresh only when polling is explicitly enabled
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (isPolling) {
      // Fast refresh when user enables polling
      interval = setInterval(fetchRuns, 3000);
    }
    
    return () => clearInterval(interval);
  }, [isPolling]);

  // Load logs when task is selected
  useEffect(() => {
    if (selectedRun && selectedTask) {
      fetchLogs(selectedRun, selectedTask);
    }
  }, [selectedRun, selectedTask]);

  const selectedRunData = runs.find(r => r.id === selectedRun);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running': return '[RUN]';
      case 'completed': return '[OK]';
      case 'passed': return '[OK]';
      case 'failed': return '[FAIL]';
      case 'queued': return '[WAIT]';
      default: return '[?]';
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
        <div>{new Date().toLocaleString()} | {runs.filter(r => r.status === 'running').length} running</div>
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
                  onClick={() => setConfig({...config, platform: 'modal'})}
                  style={{
                    flex: 1,
                    padding: '0.25rem',
                    backgroundColor: config.platform === 'modal' ? '#1f6feb' : '#161b22',
                    color: config.platform === 'modal' ? '#ffffff' : '#8b949e',
                    border: '1px solid #30363d',
                    cursor: 'pointer',
                    fontFamily: 'inherit'
                  }}
                >
                  MODAL
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
                    Model:
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
                    value={config.modalModel}
                    onChange={(e) => setConfig({...config, modalModel: e.target.value})}
                  >
                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="claude-3-sonnet">Claude 3 Sonnet</option>
                    <option value="claude-3-opus">Claude 3 Opus</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.25rem', color: '#8b949e' }}>
                    Parallel Tasks:
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
                    value={config.modalParallel}
                    onChange={(e) => setConfig({...config, modalParallel: e.target.value})}
                    min="1"
                    max="50"
                  />
                </div>
                {!modalStatus.available && (
                  <div style={{
                    padding: '0.5rem',
                    border: '1px solid #f1fa8c',
                    color: '#f1fa8c',
                    fontSize: '12px',
                    backgroundColor: '#1c1f24'
                  }}>
                    ⚠️ Modal not configured. Install: pip install modal
                  </div>
                )}
                {modalStatus.available && !modalStatus.authenticated && (
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
            
            {/* Running tasks */}
            {runs.filter(run => run.status === 'running').length > 0 && (
              <div style={{ 
                border: '1px solid #f1fa8c',
                padding: '0.5rem',
                marginTop: '1rem',
                backgroundColor: '#1c1f24'
              }}>
                <div style={{ 
                  color: '#f1fa8c',
                  marginBottom: '0.5rem',
                  display: 'flex',
                  justifyContent: 'space-between'
                }}>
                  <span>[RUNNING: {runs.filter(run => run.status === 'running').length}]</span>
                  <button
                    onClick={async () => {
                      const runningRuns = runs.filter(run => run.status === 'running');
                      for (const run of runningRuns) {
                        await killRun(run.id);
                      }
                      setTimeout(() => fetchRuns(), 2000);
                    }}
                    style={{
                      backgroundColor: '#da3633',
                      color: '#ffffff',
                      border: 'none',
                      padding: '0 0.5rem',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: '12px'
                    }}
                  >
                    KILL ALL
                  </button>
                </div>
                {runs.filter(run => run.status === 'running').map(run => (
                  <div key={run.id} style={{
                    borderTop: '1px solid #30363d',
                    paddingTop: '0.25rem',
                    marginTop: '0.25rem',
                    fontSize: '12px'
                  }}>
                    <div style={{ color: '#c9d1d9' }}>{run.id}</div>
                    <div style={{ color: '#6e7681' }}>
                      {run.tasks.map(t => t.name).join(', ')}
                    </div>
                  </div>
                ))}
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
          <div style={{ 
            marginBottom: '1rem',
            borderBottom: '1px solid #30363d',
            paddingBottom: '0.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
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
            </div>
          </div>
          
          {runs.length === 0 ? (
            <div style={{ color: '#6e7681' }}>No runs yet</div>
          ) : (
            runs.map(run => (
              <div
                key={run.id}
                onClick={() => {
                  setSelectedRun(run.id);
                  setSelectedTask(null);
                }}
                style={{
                  padding: '0.5rem',
                  marginBottom: '0.5rem',
                  border: selectedRun === run.id ? '1px solid #58a6ff' : '1px solid #30363d',
                  backgroundColor: selectedRun === run.id ? '#161b22' : '#0d1117',
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: getStatusColor(run.status) }}>
                    {getStatusIcon(run.status)}
                  </span>
                  {run.accuracy !== undefined && (
                    <span style={{ color: '#c9d1d9' }}>{(run.accuracy * 100).toFixed(0)}%</span>
                  )}
                </div>
                <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '0.25rem' }}>
                  {run.id}
                </div>
                <div style={{ fontSize: '11px', color: '#6e7681', marginTop: '0.25rem' }}>
                  {run.agent}/{run.model?.split('/')[1]} | {run.tasks.length} tasks
                  {run.duration && ` | ${formatDuration(run.duration)}`}
                </div>
                
                {run.status === 'running' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      killRun(run.id);
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
                    {killingRun === run.id ? 'KILLING...' : 'KILL'}
                  </button>
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
                    <span style={{ color: getStatusColor(task.status) }}>
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
                    <button
                      onClick={() => fetchLogs(selectedRun!, selectedTask)}
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
                  
                  {/* Log status indicator */}
                  {logs && (
                    <div style={{ marginBottom: '0.5rem', fontSize: '12px' }}>
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