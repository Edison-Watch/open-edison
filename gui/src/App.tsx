import React, { useState, useEffect } from 'react';
import './theme.css'
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
  const [serverConfig, setServerConfig] = useState<{ host: string; port: number; api_key?: string } | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    let stored: 'dark' | 'light' | null = null
    try {
      const raw = window.localStorage?.getItem('app-theme')
      if (raw === 'dark' || raw === 'light') stored = raw
    } catch { /* localStorage may be unavailable under restrictive CSP */ }
    if (stored) return stored
    return 'light'
  })

  const switchTab = (tab: 'overview' | 'dashboard') => {
    setActiveTab(tab);
  };

  // Listen for switch-to-dashboard messages from main process (from notification clicks)
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onSwitchToDashboard(() => {
        setActiveTab('dashboard');
      });
    }
  }, []);

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

  // Apply theme to <html> attribute and persist
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { window.localStorage?.setItem('app-theme', theme) } catch { }
  }, [theme])

  // React to menu-driven theme changes from main process
  useEffect(() => {
    const apply = (payload: { mode: 'light' | 'dark' | 'system'; effective: 'light' | 'dark' }) => {
      setTheme(payload.effective)
    }
    try { window.electronAPI?.onThemeChanged?.(apply) } catch { }
    // Query current theme on mount
    try { window.electronAPI?.getTheme?.().then(t => setTheme(t.effective)) } catch { }
  }, [])

  // Fetch server configuration
  useEffect(() => {
    const fetchServerConfig = async () => {
      if (window.electronAPI && window.electronAPI.getServerConfig) {
        try {
          const config = await window.electronAPI.getServerConfig();
          setServerConfig(config);
        } catch (error) {
          console.error('Failed to fetch server config:', error);
          // Fallback to default values
          setServerConfig({ host: 'localhost', port: 3001 });
        }
      }
    };

    fetchServerConfig();
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
    <div style={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--text-primary)' }}>

      {/* Tabs */}
      <div style={{ display: 'flex', background: 'var(--tab-bg)', borderBottom: '1px solid var(--tab-border)' }}>
        <button
          onClick={() => switchTab('overview')}
          style={{
            flex: 1,
            padding: '0.5rem',
            background: activeTab === 'overview' ? 'var(--tab-active)' : 'var(--tab-bg)',
            color: activeTab === 'overview' ? 'var(--tab-active-text)' : 'var(--tab-inactive-text)',
            border: 'none',
            cursor: 'pointer',
            fontSize: '1rem',
            transition: 'all 0.3s ease',
            borderBottom: activeTab === 'overview' ? '3px solid var(--accent)' : '3px solid transparent'
          }}
        >
          Overview
        </button>
        <button
          onClick={() => switchTab('dashboard')}
          style={{
            flex: 1,
            padding: '0.5rem',
            background: activeTab === 'dashboard' ? 'var(--tab-active)' : 'var(--tab-bg)',
            color: activeTab === 'dashboard' ? 'var(--tab-active-text)' : 'var(--tab-inactive-text)',
            border: 'none',
            cursor: 'pointer',
            fontSize: '1rem',
            transition: 'all 0.3s ease',
            borderBottom: activeTab === 'dashboard' ? '3px solid var(--accent)' : '3px solid transparent'
          }}
        >
          Dashboard
        </button>
        {/* Theme toggle moved to menu */}
        {activeTab === 'dashboard' && ((window.electronAPI as any)?.guiMode === 'development') && (
          <button
            onClick={() => { try { window.electronAPI?.openDashboardDevTools?.() } catch { } }}
            style={{
              marginLeft: 'auto',
              padding: '0.5rem 0.75rem',
              background: '#555a',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.875rem'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#666' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#555a' }}
            title="Open Dashboard DevTools"
          >
            DevTools
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {activeTab === 'overview' && (
          <div
            style={{ width: '100%', height: '100%' }}
            ref={(_el) => {
              try { window.electronAPI?.hideDashboard?.() } catch { }
            }}
          >
            <Overview logs={logs} setLogs={setLogs} logsExpanded={logsExpanded} setLogsExpanded={setLogsExpanded} />
          </div>
        )}
        {activeTab === 'dashboard' && (
          <div
            style={{ position: 'absolute', inset: 0, top: 0, left: 0, right: 0, bottom: 0 }}
            ref={(el) => {
              if (!el) return
              const rect = el.getBoundingClientRect()
              // Position the dashboard view to match the container below the tabs
              window.electronAPI?.showDashboard?.({
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              })
              // Push current theme to the dashboard content as well
              try {
                const effective = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
                window.electronAPI?.setDashboardBounds?.({ x: rect.left, y: rect.top, width: rect.width, height: rect.height })
                // Also update theme in dashboard
                setTimeout(() => {
                  window.electronAPI?.openDashboardDevTools // noop to satisfy type checker access
                }, 0)
              } catch { }
            }}
          />
        )}
      </div>
    </div>
  );
};

export default App;
