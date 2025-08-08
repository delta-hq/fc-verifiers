'use client';

import { useState, useEffect } from 'react';

interface EC2Instance {
  instanceId: string;
  taskId: string;
  status: string;
  launchTime: string;
  instanceType: string;
  publicIp?: string;
  ec2Status: string;
  batchId: string;
  result?: any;
}

export default function EC2Monitor() {
  const [instances, setInstances] = useState<EC2Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Fetch EC2 instances
  const fetchInstances = async () => {
    try {
      const response = await fetch('/api/ec2-status');
      const data = await response.json();
      setInstances(data.instances || []);
    } catch (error) {
      console.error('Failed to fetch EC2 instances:', error);
    }
  };

  // Fetch logs for selected instance
  const fetchLogs = async (instanceId: string, taskId: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/ec2-logs?instanceId=${instanceId}&taskId=${taskId}`);
      const data = await response.json();
      setLogs(data.logs || 'No logs available yet');
    } catch (error) {
      console.error('Failed to fetch logs:', error);
      setLogs('Failed to load logs');
    }
    setLoading(false);
  };

  // Terminate an instance
  const terminateInstance = async (instanceId: string) => {
    if (!confirm(`Terminate instance ${instanceId}?`)) return;
    
    try {
      await fetch('/api/ec2-terminate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId })
      });
      await fetchInstances();
    } catch (error) {
      console.error('Failed to terminate instance:', error);
    }
  };

  // Poll for updates
  useEffect(() => {
    fetchInstances();
    const interval = setInterval(fetchInstances, 10000); // Every 10 seconds
    return () => clearInterval(interval);
  }, []);

  // Load logs when instance is selected
  useEffect(() => {
    if (selectedInstance) {
      const instance = instances.find(i => i.instanceId === selectedInstance);
      if (instance) {
        fetchLogs(instance.instanceId, instance.taskId);
      }
    }
  }, [selectedInstance, instances]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return '#f1fa8c';
      case 'completed': return '#50fa7b';
      case 'terminated': return '#8b949e';
      case 'stopping': return '#ff9800';
      case 'starting': return '#79c0ff';
      default: return '#6272a4';
    }
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* EC2 Instances List */}
      <div style={{
        flex: '0 0 300px',
        borderRight: '1px solid #30363d',
        overflowY: 'auto',
        backgroundColor: '#0d1117'
      }}>
        <div style={{
          padding: '0.5rem',
          borderBottom: '1px solid #30363d',
          color: '#79c0ff',
          fontWeight: 'bold'
        }}>
          EC2 INSTANCES ({instances.length})
        </div>
        
        {instances.map(instance => (
          <div
            key={instance.instanceId}
            onClick={() => setSelectedInstance(instance.instanceId)}
            style={{
              padding: '0.5rem',
              borderBottom: '1px solid #30363d',
              cursor: 'pointer',
              backgroundColor: selectedInstance === instance.instanceId ? '#161b22' : 'transparent',
              color: getStatusColor(instance.status)
            }}
          >
            <div style={{ fontSize: '12px' }}>
              <strong>{instance.taskId}</strong>
            </div>
            <div style={{ fontSize: '10px', color: '#8b949e' }}>
              {instance.instanceId.split('-').pop()} | {instance.ec2Status}
            </div>
            <div style={{ fontSize: '10px', color: '#8b949e' }}>
              {instance.instanceType} | {new Date(instance.launchTime).toLocaleTimeString()}
            </div>
            {instance.result && (
              <div style={{ 
                fontSize: '10px', 
                color: instance.result.success ? '#50fa7b' : '#ff5555' 
              }}>
                {instance.result.success ? '✓ PASSED' : '✗ FAILED'}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Logs Panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {selectedInstance ? (
          <>
            <div style={{
              padding: '0.5rem',
              borderBottom: '1px solid #30363d',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: '#161b22'
            }}>
              <span style={{ color: '#79c0ff' }}>
                LOGS: {instances.find(i => i.instanceId === selectedInstance)?.taskId}
              </span>
              <button
                onClick={() => {
                  const instance = instances.find(i => i.instanceId === selectedInstance);
                  if (instance) fetchLogs(instance.instanceId, instance.taskId);
                }}
                style={{
                  padding: '0.25rem 0.5rem',
                  backgroundColor: '#1f6feb',
                  color: '#ffffff',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '10px',
                  fontFamily: 'inherit'
                }}
              >
                REFRESH
              </button>
            </div>
            
            <div style={{
              flex: 1,
              padding: '1rem',
              overflowY: 'auto',
              backgroundColor: '#0d1117',
              fontFamily: 'Monaco, monospace',
              fontSize: '12px',
              lineHeight: '1.5',
              whiteSpace: 'pre-wrap',
              color: '#8b949e'
            }}>
              {loading ? 'Loading logs...' : logs}
            </div>
          </>
        ) : (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#8b949e'
          }}>
            Select an EC2 instance to view logs
          </div>
        )}
      </div>
    </div>
  );
}