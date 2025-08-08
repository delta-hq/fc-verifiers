'use client';

import { useState } from 'react';
import EC2Monitor from './components/EC2Monitor';

export default function DashboardWithEC2() {
  const [activeTab, setActiveTab] = useState<'local' | 'ec2'>('local');

  return (
    <main style={{ 
      minHeight: '100vh', 
      backgroundColor: '#0d1117',
      color: '#58a6ff',
      fontFamily: 'Monaco, "Cascadia Code", "Courier New", monospace',
      fontSize: '14px',
      padding: '0'
    }}>
      {/* Tmux status bar with tabs */}
      <div style={{
        backgroundColor: '#161b22',
        color: '#8b949e',
        padding: '0',
        borderBottom: '1px solid #30363d'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0.25rem 1rem'
        }}>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              onClick={() => setActiveTab('local')}
              style={{
                padding: '0.25rem 0.75rem',
                backgroundColor: activeTab === 'local' ? '#1f6feb' : 'transparent',
                color: activeTab === 'local' ? '#ffffff' : '#8b949e',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: 'bold'
              }}
            >
              [0] LOCAL RUNS
            </button>
            <button
              onClick={() => setActiveTab('ec2')}
              style={{
                padding: '0.25rem 0.75rem',
                backgroundColor: activeTab === 'ec2' ? '#1f6feb' : 'transparent',
                color: activeTab === 'ec2' ? '#ffffff' : '#8b949e',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: 'bold'
              }}
            >
              [1] EC2 INSTANCES
            </button>
          </div>
          <div>{new Date().toLocaleString()}</div>
        </div>
      </div>

      <div style={{ height: 'calc(100vh - 40px)' }}>
        {activeTab === 'local' ? (
          <div style={{ padding: '1rem', color: '#8b949e' }}>
            {/* Original dashboard content would go here */}
            <p>Original terminal-bench dashboard for local runs</p>
            <p>To use: Import the existing page.tsx content here</p>
          </div>
        ) : (
          <EC2Monitor />
        )}
      </div>
    </main>
  );
}