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
    concurrent: '1'
  });

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

  // Start a new run
  const startRun = async () => {
    setLoading(true);
    setStartError('');
    try {
      const response = await fetch('/api/start-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          tasks: config.tasks.join(' ') // Convert array back to space-separated string for API
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
      case 'running': return '🔄';
      case 'completed': return '✅';
      case 'passed': return '✅';
      case 'failed': return '❌';
      case 'queued': return '⏳';
      default: return '❓';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return '#f59e0b';
      case 'completed': return '#10b981';
      case 'passed': return '#10b981';
      case 'failed': return '#ef4444';
      case 'queued': return '#6b7280';
      default: return '#6b7280';
    }
  };

  return (
    <main style={{ minHeight: '100vh', padding: '2rem', backgroundColor: '#f3f4f6' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold', marginBottom: '2rem', color: '#111827' }}>
          Terminal-Bench Dashboard
        </h1>
        
        {/* Currently Running Section */}
        {runs.filter(run => run.status === 'running').length > 0 && (
          <div style={{ 
            backgroundColor: '#fef3c7', 
            border: '2px solid #f59e0b',
            borderRadius: '0.5rem', 
            padding: '1.5rem', 
            marginBottom: '2rem',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ 
                fontSize: '1.5rem', 
                fontWeight: '700', 
                color: '#92400e',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                🔄 Currently Running ({runs.filter(run => run.status === 'running').length})
              </h2>
              <button
                onClick={async () => {
                  // Kill all running tasks
                  const runningRuns = runs.filter(run => run.status === 'running');
                  for (const run of runningRuns) {
                    await killRun(run.id);
                  }
                  // Refresh after killing all
                  setTimeout(() => fetchRuns(), 2000);
                }}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#dc2626',
                  color: 'white',
                  borderRadius: '0.375rem',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  border: 'none'
                }}
              >
                🛑 KILL ALL RUNNING ({runs.filter(run => run.status === 'running').length})
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {runs.filter(run => run.status === 'running').map(run => (
                <div key={run.id} style={{
                  backgroundColor: '#ffffff',
                  padding: '1rem',
                  borderRadius: '0.5rem',
                  border: '2px solid #f59e0b',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <div style={{ fontFamily: 'monospace', fontSize: '1rem', fontWeight: '600', color: '#111827' }}>
                      {run.id}
                    </div>
                    <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.25rem' }}>
                      🤖 {run.agent} | 🧠 {run.model?.split('/')[1]} | 📋 {run.tasks.length} tasks | ⏱️ {formatDuration(run.duration)}
                    </div>
                    {run.tasks.length > 0 && (
                      <div style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
                        <strong>Tasks:</strong> {run.tasks.map(t => `${t.name} (${t.status})`).join(', ')}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => killRun(run.id)}
                    disabled={killingRun === run.id}
                    style={{
                      padding: '0.5rem 1rem',
                      backgroundColor: killingRun === run.id ? '#9ca3af' : '#ef4444',
                      color: 'white',
                      borderRadius: '0.375rem',
                      fontSize: '0.875rem',
                      fontWeight: '600',
                      cursor: killingRun === run.id ? 'not-allowed' : 'pointer',
                      border: 'none'
                    }}
                  >
                    {killingRun === run.id ? 'Killing...' : '🛑 KILL'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '2rem' }}>
          
          {/* Configuration Panel */}
          <div style={{ backgroundColor: 'white', borderRadius: '0.5rem', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1rem', color: '#111827' }}>
              Start New Run
            </h2>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '1rem', fontWeight: '500', marginBottom: '0.5rem', color: '#374151' }}>
                  Agent
                </label>
                <select 
                  style={{ 
                    width: '100%', 
                    padding: '0.5rem', 
                    border: '1px solid #d1d5db', 
                    borderRadius: '0.375rem',
                    fontSize: '1rem',
                    color: '#111827'
                  }}
                  value={config.agent}
                  onChange={(e) => setConfig({...config, agent: e.target.value})}
                >
                  <option value="claude">Claude</option>
                  <option value="opencode">OpenCode</option>
                </select>
              </div>
              
              <div>
                <label style={{ display: 'block', fontSize: '1rem', fontWeight: '500', marginBottom: '0.5rem', color: '#374151' }}>
                  Tasks
                </label>
                <MultiSelectDropdown
                  options={AVAILABLE_TASKS}
                  selectedValues={config.tasks}
                  onChange={(tasks) => setConfig({...config, tasks})}
                  placeholder="Select tasks to run..."
                  categories={TASK_CATEGORIES}
                />
                <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.25rem' }}>
                  Selected: {config.tasks.length} task{config.tasks.length !== 1 ? 's' : ''}
                </p>
              </div>
              
              <div>
                <label style={{ display: 'block', fontSize: '1rem', fontWeight: '500', marginBottom: '0.5rem', color: '#374151' }}>
                  Concurrent
                </label>
                <input 
                  type="number"
                  style={{ 
                    width: '100%', 
                    padding: '0.5rem', 
                    border: '1px solid #d1d5db', 
                    borderRadius: '0.375rem',
                    fontSize: '1rem',
                    color: '#111827'
                  }}
                  value={config.concurrent}
                  onChange={(e) => setConfig({...config, concurrent: e.target.value})}
                  min="1"
                  max="10"
                />
              </div>
              
              <button
                onClick={startRun}
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  backgroundColor: loading ? '#9ca3af' : '#3b82f6',
                  color: 'white',
                  borderRadius: '0.375rem',
                  fontSize: '1rem',
                  fontWeight: '500',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  border: 'none'
                }}
              >
                {loading ? 'Starting...' : 'Start Run'}
              </button>
              
              <button
                onClick={() => {
                  setConfig({
                    agent: 'claude',
                    tasks: ['sqlite-with-gcov', 'fibonacci-server', 'build-tcc-qemu', 'password-recovery', 'crack-7z-hash'],
                    concurrent: '4'
                  });
                }}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  backgroundColor: '#f3f4f6',
                  color: '#374151',
                  borderRadius: '0.375rem',
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  border: '1px solid #e5e7eb'
                }}
              >
                Load 5 Test Tasks
              </button>
              
              {/* Show error if any */}
              {startError && (
                <div style={{
                  padding: '1rem',
                  backgroundColor: '#fee2e2',
                  borderRadius: '0.375rem',
                  border: '1px solid #ef4444',
                  color: '#991b1b',
                  fontSize: '0.875rem'
                }}>
                  <strong>Error:</strong> {startError}
                </div>
              )}
              
              {/* Show last command */}
              {lastCommand && (
                <div style={{
                  padding: '1rem',
                  backgroundColor: '#f3f4f6',
                  borderRadius: '0.375rem',
                  border: '1px solid #d1d5db',
                  fontSize: '0.75rem',
                  fontFamily: 'monospace',
                  wordBreak: 'break-all'
                }}>
                  <strong>Command:</strong><br />
                  {lastCommand}
                </div>
              )}
            </div>
          </div>
          
          {/* Runs List */}
          <div style={{ backgroundColor: 'white', borderRadius: '0.5rem', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: '600', color: '#111827' }}>
                Recent Runs
              </h2>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button
                    onClick={() => fetchRuns()}
                    style={{
                      padding: '0.5rem 1rem',
                      backgroundColor: '#3b82f6',
                      color: 'white',
                      borderRadius: '0.375rem',
                      fontSize: '0.875rem',
                      cursor: 'pointer',
                      border: 'none'
                    }}
                  >
                    🔄 Refresh Now
                  </button>
                  <button
                    onClick={() => setIsPolling(!isPolling)}
                    style={{
                      padding: '0.25rem 0.5rem',
                      backgroundColor: isPolling ? '#ef4444' : '#10b981',
                      color: 'white',
                      borderRadius: '0.25rem',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      border: 'none'
                    }}
                  >
                    {isPolling ? '⏸️ Stop Auto-Refresh' : '▶️ Start Auto-Refresh'}
                  </button>
                </div>
              </div>
            </div>
            
            <div className="runs-list" style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {runs.length === 0 ? (
                <p style={{ color: '#6b7280', fontSize: '1rem' }}>No runs yet</p>
              ) : (
                runs.map(run => (
                  <div
                    key={run.id}
                    onClick={() => {
                      setSelectedRun(run.id);
                      setSelectedTask(null);
                    }}
                    style={{
                      padding: '1rem',
                      marginBottom: '0.5rem',
                      borderRadius: '0.375rem',
                      cursor: 'pointer',
                      backgroundColor: selectedRun === run.id ? '#dbeafe' : '#f9fafb',
                      border: selectedRun === run.id ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                      transition: 'all 0.2s'
                    }}
                  >
                    <div style={{ fontFamily: 'monospace', fontSize: '0.875rem', color: '#111827' }}>
                      {run.id}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                      <span style={{ 
                        fontSize: '1rem', 
                        fontWeight: '600',
                        color: getStatusColor(run.status),
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                      }}>
                        {getStatusIcon(run.status)} {run.status}
                      </span>
                      {run.accuracy !== undefined && (
                        <span style={{ fontSize: '1rem', fontWeight: '600', color: '#111827' }}>
                          {(run.accuracy * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
                    
                    {/* Additional run details */}
                    <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#6b7280' }}>
                      <div>🤖 {run.agent || 'Unknown'} | 🧠 {run.model?.split('/')[1] || 'Unknown'}</div>
                      <div>📋 {run.tasks.length} tasks | ⚡ {run.concurrent || 1} concurrent</div>
                      {run.duration !== undefined && (
                        <div>⏱️ {formatDuration(run.duration)}</div>
                      )}
                      {run.startTime && (
                        <div>🚀 {new Date(run.startTime).toLocaleTimeString()}</div>
                      )}
                    </div>
                    
                    {/* Kill button for running tasks */}
                    {run.status === 'running' && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            killRun(run.id);
                          }}
                          disabled={killingRun === run.id}
                          style={{
                            padding: '0.25rem 0.5rem',
                            backgroundColor: killingRun === run.id ? '#9ca3af' : '#ef4444',
                            color: 'white',
                            borderRadius: '0.25rem',
                            fontSize: '0.75rem',
                            cursor: killingRun === run.id ? 'not-allowed' : 'pointer',
                            border: 'none'
                          }}
                        >
                          {killingRun === run.id ? 'Killing...' : '🛑 Kill Run'}
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
          
          {/* Run Details */}
          <div style={{ backgroundColor: 'white', borderRadius: '0.5rem', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1rem', color: '#111827' }}>
              Run Details
            </h2>
            
            {selectedRunData ? (
              <div>
                <div style={{ marginBottom: '1rem' }}>
                  <p style={{ fontSize: '1rem', color: '#374151' }}>
                    <strong>ID:</strong> {selectedRunData.id}
                  </p>
                  <p style={{ fontSize: '1rem', color: '#374151' }}>
                    <strong>Status:</strong> <span style={{ color: getStatusColor(selectedRunData.status) }}>
                      {getStatusIcon(selectedRunData.status)} {selectedRunData.status}
                    </span>
                  </p>
                  {selectedRunData.accuracy !== undefined && (
                    <p style={{ fontSize: '1rem', color: '#374151' }}>
                      <strong>Accuracy:</strong> {(selectedRunData.accuracy * 100).toFixed(1)}%
                    </p>
                  )}
                </div>
                
                <h3 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '0.5rem', color: '#111827' }}>
                  Tasks (click to view logs)
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {selectedRunData.tasks.map((task, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => setSelectedTask(task.name)}
                      style={{ 
                        padding: '0.75rem',
                        backgroundColor: selectedTask === task.name ? '#dbeafe' : '#f9fafb',
                        borderRadius: '0.375rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        cursor: 'pointer',
                        border: `2px solid ${selectedTask === task.name ? '#3b82f6' : getStatusColor(task.status)}`,
                        transition: 'all 0.2s'
                      }}
                    >
                      <span style={{ fontSize: '1rem', color: '#111827' }}>{task.name}</span>
                      <span style={{ 
                        fontSize: '1rem',
                        fontWeight: '600',
                        color: getStatusColor(task.status),
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                      }}>
                        {getStatusIcon(task.status)} {task.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p style={{ color: '#6b7280', fontSize: '1rem' }}>Select a run to view details</p>
            )}
          </div>
          
          {/* Enhanced Log Viewer */}
          {selectedTask && (
            <div style={{ 
              backgroundColor: 'white', 
              borderRadius: '0.5rem', 
              padding: '1.5rem', 
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              gridColumn: 'span 3'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: '600', color: '#111827' }}>
                  🔍 Agent Execution: {selectedTask}
                </h3>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => fetchLogs(selectedRun!, selectedTask)}
                    style={{
                      padding: '0.25rem 0.5rem',
                      backgroundColor: '#3b82f6',
                      color: 'white',
                      borderRadius: '0.25rem',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      border: 'none'
                    }}
                  >
                    🔄 Refresh
                  </button>
                </div>
              </div>
              
              {/* Success/Failure Indicator */}
              <div style={{ marginBottom: '1rem' }}>
                {(logs.includes('2 passed in') || logs.includes('PASSED ../tests/')) ? (
                  <div style={{ 
                    padding: '0.75rem', 
                    backgroundColor: '#dcfce7', 
                    borderLeft: '4px solid #22c55e',
                    borderRadius: '0.375rem' 
                  }}>
                    <span style={{ fontSize: '1rem', fontWeight: '600', color: '#15803d' }}>
                      ✅ Task Completed Successfully - Tests Passed!
                    </span>
                  </div>
                ) : logs.includes('FAILED ../tests/') ? (
                  <div style={{ 
                    padding: '0.75rem', 
                    backgroundColor: '#fee2e2', 
                    borderLeft: '4px solid #ef4444',
                    borderRadius: '0.375rem' 
                  }}>
                    <span style={{ fontSize: '1rem', fontWeight: '600', color: '#dc2626' }}>
                      ❌ Task Failed - Tests Failed
                    </span>
                  </div>
                ) : (logs.includes('passed in') && logs.includes('test session starts') && !logs.includes('FAILED')) ? (
                  <div style={{ 
                    padding: '0.75rem', 
                    backgroundColor: '#dcfce7', 
                    borderLeft: '4px solid #22c55e',
                    borderRadius: '0.375rem' 
                  }}>
                    <span style={{ fontSize: '1rem', fontWeight: '600', color: '#15803d' }}>
                      ✅ Task Completed Successfully - Tests Passed!
                    </span>
                  </div>
                ) : (logs.includes('PASSED') && !logs.includes('FAILED') && !logs.includes('Task Results')) ? (
                  <div style={{ 
                    padding: '0.75rem', 
                    backgroundColor: '#dcfce7', 
                    borderLeft: '4px solid #22c55e',
                    borderRadius: '0.375rem' 
                  }}>
                    <span style={{ fontSize: '1rem', fontWeight: '600', color: '#15803d' }}>
                      ✅ Task Completed Successfully - Tests Passed!
                    </span>
                  </div>
                ) : (
                  // Smart success detection
                  logs.includes('recording finished') && (
                    logs.includes('Server running on port') ||
                    logs.includes('{"result"') ||
                    logs.includes('Hello, world!') ||
                    logs.includes('Successfully') ||
                    (logs.includes('python3') && logs.includes('.py') && !logs.includes('error'))
                  ) ? (
                    <div style={{ 
                      padding: '0.75rem', 
                      backgroundColor: '#dcfce7', 
                      borderLeft: '4px solid #22c55e',
                      borderRadius: '0.375rem' 
                    }}>
                      <span style={{ fontSize: '1rem', fontWeight: '600', color: '#15803d' }}>
                        ✅ Task Completed Successfully - Agent Achieved Goal!
                      </span>
                      <div style={{ fontSize: '0.875rem', color: '#16a34a', marginTop: '0.25rem' }}>
                        {logs.includes('Server running on port') && '🌐 Server successfully started and responding'}
                        {logs.includes('{"result"') && '🔢 API returning correct JSON responses'}
                        {logs.includes('Hello, world!') && '📝 File successfully created with expected content'}
                      </div>
                    </div>
                  ) : logs.includes('recording finished') ? (
                    <div style={{ 
                      padding: '0.75rem', 
                      backgroundColor: '#dbeafe', 
                      borderLeft: '4px solid #3b82f6',
                      borderRadius: '0.375rem' 
                    }}>
                      <span style={{ fontSize: '1rem', fontWeight: '600', color: '#1d4ed8' }}>
                        🔄 Task Completed - Agent finished execution
                      </span>
                    </div>
                  ) : (
                    <div style={{ 
                      padding: '0.75rem', 
                      backgroundColor: '#fef3c7', 
                      borderLeft: '4px solid #f59e0b',
                      borderRadius: '0.375rem' 
                    }}>
                      <span style={{ fontSize: '1rem', fontWeight: '600', color: '#d97706' }}>
                        ⏳ Task in Progress or Loading...
                      </span>
                    </div>
                  )
                )}
              </div>
              
              {/* Agent Execution Analysis - Parse Each Section */}
              {logs && (
                <div style={{ marginBottom: '1.5rem' }}>
                  {/* Parse and Display Each Section */}
                  {['agent.log', 'tests.log', 'commands.txt', 'panes/post-agent.txt', 'panes/post-test.txt'].map(sectionName => {
                    const sectionPattern = new RegExp(`=== ${sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ===([\\s\\S]*?)(?===|$)`);
                    const match = logs.match(sectionPattern);
                    const sectionContent = match ? match[1].trim() : '';
                    
                    if (!sectionContent) return null;
                    
                    // Determine what this section shows
                    const isTest = sectionName.includes('test');
                    const isCommand = sectionName.includes('command');
                    const isAgent = sectionName.includes('agent');
                    const isPostTest = sectionName.includes('post-test');
                    
                    // Check for success indicators in this section
                    const hasSuccess = sectionContent.includes('2 passed in') ||
                                     sectionContent.includes('PASSED ../tests/') ||
                                     (sectionContent.includes('passed in') && sectionContent.includes('test session starts')) ||
                                     sectionContent.includes('Hello, world!') ||
                                     sectionContent.includes('{"result"') ||
                                     sectionContent.includes('Server running') ||
                                     (sectionContent.includes('PASSED') && !sectionContent.includes('Task Results'));
                    
                    const hasFail = sectionContent.includes('FAILED ../tests/') || 
                                  (sectionContent.includes('error:') && !sectionContent.includes('2 passed in')) ||
                                  (sectionContent.includes('Error:') && !sectionContent.includes('2 passed in')) ||
                                  (sectionContent.includes('Status: FAILED') && !sectionContent.includes('2 passed in'));
                    
                    const statusColor = hasSuccess && !hasFail ? '#22c55e' : 
                                      hasFail ? '#ef4444' : '#6b7280';
                    const bgColor = hasSuccess && !hasFail ? '#f0fdf4' : 
                                   hasFail ? '#fef2f2' : '#f9fafb';
                    
                    return (
                      <div key={sectionName} style={{ 
                        backgroundColor: bgColor,
                        border: `2px solid ${statusColor}`,
                        borderRadius: '0.5rem', 
                        padding: '1rem', 
                        marginBottom: '1rem' 
                      }}>
                        <h4 style={{ 
                          fontSize: '1.1rem', 
                          fontWeight: '700', 
                          color: statusColor,
                          marginBottom: '0.75rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem'
                        }}>
                          {isTest && '🧪'}
                          {isCommand && '⚡'}
                          {isAgent && '🤖'}
                          {isPostTest && '📊'}
                          {!isTest && !isCommand && !isAgent && !isPostTest && '📄'}
                          <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {sectionName.replace('panes/', '').replace('.txt', '').replace('.log', '')}
                          </span>
                          {hasSuccess && !hasFail && <span style={{ fontSize: '1.2rem' }}>✅</span>}
                          {hasFail && <span style={{ fontSize: '1.2rem' }}>❌</span>}
                        </h4>
                        
                        {/* Key highlights from this section */}
                        <div style={{ marginBottom: '0.75rem' }}>
                          {/* Success indicators */}
                          {sectionContent.includes('2 passed') && (
                            <div style={{ padding: '0.5rem', backgroundColor: '#dcfce7', borderRadius: '0.25rem', marginBottom: '0.5rem' }}>
                              <strong style={{ color: '#15803d' }}>🎉 2 TESTS PASSED - PERFECT SUCCESS!</strong>
                            </div>
                          )}
                          {sectionContent.includes('Hello, world!') && (
                            <div style={{ padding: '0.5rem', backgroundColor: '#dbeafe', borderRadius: '0.25rem', marginBottom: '0.5rem' }}>
                              <strong>📄 File Created:</strong> <code>hello.txt</code> with "Hello, world!" content
                            </div>
                          )}
                          {sectionContent.includes('{"result": 55}') && (
                            <div style={{ padding: '0.5rem', backgroundColor: '#dbeafe', borderRadius: '0.25rem', marginBottom: '0.5rem' }}>
                              <strong>🔢 API Response:</strong> <code>{`{"result": 55}`}</code> - Fibonacci calculation works!
                            </div>
                          )}
                          {sectionContent.includes('Server running') && (
                            <div style={{ padding: '0.5rem', backgroundColor: '#dbeafe', borderRadius: '0.25rem', marginBottom: '0.5rem' }}>
                              <strong>🌐 Server:</strong> HTTP server successfully started and running
                            </div>
                          )}
                          
                          {/* Problem indicators - what went wrong */}
                          {sectionContent.includes('@ openai/gpt-4o-mini') && sectionContent.includes('opencode run') && !sectionContent.includes('Write') && (
                            <div style={{ padding: '0.75rem', backgroundColor: '#fef2f2', borderRadius: '0.25rem', marginBottom: '0.5rem', border: '2px solid #ef4444' }}>
                              <strong style={{ color: '#dc2626' }}>❌ AGENT GOT STUCK</strong>
                              <div style={{ fontSize: '0.875rem', marginTop: '0.25rem', color: '#7f1d1d' }}>
                                OpenCode started but never executed the command. Agent froze at the prompt.
                              </div>
                            </div>
                          )}
                          
                          {sectionContent.includes('INSTALL_SUCCESS') && !sectionContent.includes('Write') && (
                            <div style={{ padding: '0.5rem', backgroundColor: '#fef3c7', borderRadius: '0.25rem', marginBottom: '0.5rem' }}>
                              <strong style={{ color: '#92400e' }}>⚠️ SETUP OK BUT NO ACTION</strong>
                              <div style={{ fontSize: '0.75rem', color: '#78350f' }}>Agent installed OpenCode but didn't complete the task</div>
                            </div>
                          )}
                          
                          {/* Show what the agent was supposed to do */}
                          {sectionContent.includes('Create a file called hello.txt') && (
                            <div style={{ padding: '0.5rem', backgroundColor: '#f0f9ff', borderRadius: '0.25rem', marginBottom: '0.5rem' }}>
                              <strong style={{ color: '#1e40af' }}>🎯 TASK:</strong> Create hello.txt with "Hello, world!" content
                            </div>
                          )}
                        </div>
                        
                        {/* Collapsible full content */}
                        <details>
                          <summary style={{ 
                            cursor: 'pointer', 
                            padding: '0.5rem',
                            backgroundColor: 'rgba(0,0,0,0.05)',
                            borderRadius: '0.25rem',
                            fontSize: '0.9rem',
                            fontWeight: '600'
                          }}>
                            📋 View Full {sectionName} Content
                          </summary>
                          <div style={{
                            backgroundColor: '#1a1a1a',
                            color: '#e5e5e5',
                            padding: '1rem',
                            borderRadius: '0.375rem',
                            fontFamily: 'Monaco, "Cascadia Code", monospace',
                            fontSize: '0.85rem',
                            lineHeight: '1.5',
                            maxHeight: '400px',
                            overflowY: 'auto',
                            whiteSpace: 'pre-wrap',
                            marginTop: '0.5rem'
                          }}>
                            {sectionContent}
                          </div>
                        </details>
                      </div>
                    );
                  }).filter(Boolean)}

                  {/* Agent Terminal - Now Secondary */}
                  <details style={{ marginTop: '1rem' }}>
                    <summary style={{ 
                      cursor: 'pointer', 
                      fontSize: '1rem', 
                      fontWeight: '600', 
                      color: '#4b5563',
                      padding: '0.75rem',
                      backgroundColor: '#f3f4f6',
                      borderRadius: '0.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      border: '1px solid #d1d5db'
                    }}>
                      🎬 Terminal Recording
                      <div style={{ 
                        fontSize: '0.75rem', 
                        color: '#6b7280',
                        marginLeft: 'auto'
                      }}>
                        Watch the agent work (like a screen recording)
                      </div>
                    </summary>
                    <div style={{
                      backgroundColor: '#0f172a',
                      color: '#e2e8f0',
                      padding: '1.25rem',
                      borderRadius: '0.5rem',
                      fontFamily: 'Monaco, "Cascadia Code", "Roboto Mono", monospace',
                      fontSize: '0.85rem',
                      lineHeight: '1.6',
                      maxHeight: '500px',
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      marginTop: '0.5rem'
                    }}>
                      {logs.split('=== Agent Log ===')[1]?.split('===')[0]?.trim() || 'No agent log available'}
                    </div>
                  </details>
                </div>
              )}
              
              {/* Full Logs (Collapsible) */}
              <details style={{ marginTop: '1rem' }}>
                <summary style={{ 
                  cursor: 'pointer', 
                  fontSize: '1rem', 
                  fontWeight: '600', 
                  color: '#4b5563',
                  padding: '0.75rem',
                  backgroundColor: '#f3f4f6',
                  borderRadius: '0.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  border: '1px solid #d1d5db'
                }}>
                  📋 Structured Logs 
                  <div style={{ 
                    fontSize: '0.75rem', 
                    color: '#6b7280',
                    marginLeft: 'auto'
                  }}>
                    Browse by section: agent, tests, commands, files
                  </div>
                </summary>
                
                {/* Individual Log Sections - Much cleaner! */}
                <div style={{ marginTop: '0.75rem' }}>
                  {/* Parse and Display Each Section Individually - Dynamic based on what's actually in the logs */}
                  {(() => {
                    if (!logs) return null;
                    
                    // Find all sections in the logs - be more precise to avoid Python __name__ confusion
                    const sectionMatches = logs.match(/^=== ([^=\n]+) ===$/gm) || [];
                    const sections = sectionMatches.map(match => match.replace(/^=== | ===$/g, ''));
                    
                    // Map section names to UI info - handle actual API section names
                    const getSectionInfo = (name: string) => {
                      // Agent logs (multiple formats)
                      if (name.includes('Agent Log') || name.includes('agent.log')) return { icon: '🤖', title: 'Agent Actions', desc: 'What the agent did' };
                      // Test results
                      if (name.includes('tests.log') || name.includes('Test')) return { icon: '🧪', title: 'Test Results', desc: 'Did it work?' };
                      // Commands (multiple formats)
                      if (name.includes('Commands') || name.includes('commands.txt') || name.includes('Command History')) return { icon: '⚡', title: 'Commands', desc: 'What was run' };
                      // File changes
                      if (name.includes('post-agent') || name.includes('Files')) return { icon: '📁', title: 'Files Created', desc: 'What changed' };
                      // Final state
                      if (name.includes('post-test') || name.includes('Task Results')) return { icon: '📊', title: 'Final State', desc: 'End result' };
                      // Default
                      return { icon: '📄', title: name, desc: '' };
                    };
                    
                    return sections.map(sectionName => {
                      const { icon, title, desc } = getSectionInfo(sectionName);
                      const escapedName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                      const sectionPattern = new RegExp(`=== ${escapedName} ===\\n([\\s\\S]*?)(?=\\n=== [^=\\n]+ ===|$)`);
                      const match = logs.match(sectionPattern);
                      const sectionContent = match ? match[1].trim() : '';
                      
                      // Debug logging for commands.txt
                      if (sectionName.includes('commands.txt') && typeof window !== 'undefined') {
                        console.log('Commands section debug:', {
                          sectionName,
                          escapedName,
                          regexPattern: sectionPattern.toString(),
                          matchFound: !!match,
                          contentLength: sectionContent.length,
                          contentPreview: sectionContent.slice(0, 200) + '...',
                          fullLogsLength: logs?.length || 0
                        });
                      }
                      
                      if (!sectionContent) return null;
                      
                      return (
                      <details key={sectionName} style={{ marginBottom: '0.5rem' }}>
                        <summary style={{ 
                          cursor: 'pointer', 
                          fontSize: '0.875rem', 
                          fontWeight: '500', 
                          color: '#4b5563',
                          padding: '0.5rem 0.75rem',
                          backgroundColor: sectionContent.includes('passed') || sectionContent.includes('✅') ? '#f0f9ff' : '#f9fafb',
                          borderRadius: '0.375rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          border: '1px solid #e5e7eb'
                        }}>
                          {icon} <strong>{title}</strong>
                          <span style={{ fontSize: '0.75rem', color: '#6b7280', marginLeft: '0.5rem' }}>
                            {desc}
                          </span>
                          {(sectionContent.includes('passed') || sectionContent.includes('✅')) && <span style={{ marginLeft: 'auto' }}>✅</span>}
                          {(sectionContent.includes('failed') || sectionContent.includes('❌')) && <span style={{ marginLeft: 'auto' }}>❌</span>}
                        </summary>
                        <div style={{
                          backgroundColor: '#1f2937',
                          color: '#f3f4f6',
                          padding: '1rem',
                          borderRadius: '0.375rem',
                          fontFamily: 'monospace',
                          fontSize: '0.8rem',
                          maxHeight: '400px',
                          overflowY: 'auto',
                          whiteSpace: 'pre-wrap',
                          marginTop: '0.25rem'
                        }}>
                          {sectionContent || `No ${sectionName} data available`}
                        </div>
                      </details>
                      );
                    });
                  })()}
                </div>
              </details>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}