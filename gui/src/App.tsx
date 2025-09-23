import React, { useState } from 'react';
import Overview from './Overview';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'dashboard'>('overview');

  const switchTab = (tab: 'overview' | 'dashboard') => {
    setActiveTab(tab);
  };

  return (
    <div style={{ height: '100vh', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        background: '#2c3e50',
        color: 'white',
        padding: '1rem',
        textAlign: 'center',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: '600' }}>Open Edison Desktop</h1>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', background: '#34495e', borderBottom: '1px solid #2c3e50' }}>
        <button
          onClick={() => switchTab('overview')}
          style={{
            flex: 1,
            padding: '1rem',
            background: activeTab === 'overview' ? '#2c3e50' : '#34495e',
            color: activeTab === 'overview' ? 'white' : '#bdc3c7',
            border: 'none',
            cursor: 'pointer',
            fontSize: '1rem',
            transition: 'all 0.3s ease',
            borderBottom: activeTab === 'overview' ? '3px solid #3498db' : '3px solid transparent'
          }}
        >
          Overview
        </button>
        <button
          onClick={() => switchTab('dashboard')}
          style={{
            flex: 1,
            padding: '1rem',
            background: activeTab === 'dashboard' ? '#2c3e50' : '#34495e',
            color: activeTab === 'dashboard' ? 'white' : '#bdc3c7',
            border: 'none',
            cursor: 'pointer',
            fontSize: '1rem',
            transition: 'all 0.3s ease',
            borderBottom: activeTab === 'dashboard' ? '3px solid #3498db' : '3px solid transparent'
          }}
        >
          Dashboard
        </button>
      </div>

      {/* Content */}
      <div style={{ height: 'calc(100vh - 120px)', overflow: 'hidden' }}>
        {activeTab === 'overview' && <Overview />}
        {activeTab === 'dashboard' && (
          <iframe
            src="http://localhost:5173"
            style={{ width: '100%', height: '100%', border: 'none' }}
            title="Open Edison Dashboard"
          />
        )}
      </div>
    </div>
  );
};

export default App;
