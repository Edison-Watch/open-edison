import React, { useState, useEffect } from 'react';
import Overview from './Overview';
import McpImportWizard from './components/McpImportWizard';

interface LogEntry {
  timestamp: string;
  message: string;
  type: string;
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'dashboard'>('overview');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [isWizardMode, setIsWizardMode] = useState(false);

  const switchTab = (tab: 'overview' | 'dashboard') => {
    setActiveTab(tab);
  };

  // Check if we're in wizard mode based on URL query parameter
  useEffect(() => {
    const checkWizardMode = () => {
      const urlParams = new URLSearchParams(window.location.search);
      setIsWizardMode(urlParams.get('wizard') === 'true');
    };

    checkWizardMode();
    window.addEventListener('popstate', checkWizardMode);
    
    return () => {
      window.removeEventListener('popstate', checkWizardMode);
    };
  }, []);

  // Listen for backend logs at App level to persist across tab switches
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onBackendLog((log) => {
        // Capture ALL logs (both stderr and stdout) for complete debugging
        const timestamp = new Date().toLocaleTimeString();
        let message = log.message.trim();
        
        // Extract just the message part (after the last "-") for stderr
        if (log.type === 'stderr' && message.includes(' - ')) {
          const lastDashIndex = message.lastIndexOf(' - ');
          if (lastDashIndex !== -1) {
            message = message.substring(lastDashIndex + 3);
          }
        }
        
        const logEntry = {
          timestamp,
          message,
          type: log.type
        };
        setLogs(prev => [...prev, logEntry]);
      });
    }

    return () => {
      if (window.electronAPI) {
        window.electronAPI.removeBackendLogListener();
      }
    };
  }, []);

  // If in wizard mode, show only the wizard
  if (isWizardMode) {
    return (
      <McpImportWizard
        onClose={() => {
          // When wizard is closed (X button), always trigger main application startup
          if (window.electronAPI && window.electronAPI.wizardCompleted) {
            window.electronAPI.wizardCompleted();
          }
          if (window.electronAPI && window.electronAPI.closeWindow) {
            window.electronAPI.closeWindow();
          }
        }}
        onImportComplete={(servers) => {
          console.log('Import completed:', servers);
          if (window.electronAPI && window.electronAPI.wizardCompleted) {
            window.electronAPI.wizardCompleted();
          }
        }}
      />
    );
  }

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
        {activeTab === 'overview' && <Overview logs={logs} setLogs={setLogs} logsExpanded={logsExpanded} setLogsExpanded={setLogsExpanded} />}
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
