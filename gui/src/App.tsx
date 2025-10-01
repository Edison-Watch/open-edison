import React, { useState, useEffect } from 'react';
import './theme.css'
import Overview from './Overview';
import McpImportWizard from './components/McpImportWizard';
import LogsView from './components/LogsView';
import { Home, LayoutDashboard, HelpCircle, Wand2, ScrollText } from 'lucide-react';

interface LogEntry {
  timestamp: string;
  message: string;
  type: string;
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'dashboard' | 'wizard' | 'logs'>('overview');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isWizardMode, setIsWizardMode] = useState(false);
  const [serverConfig, setServerConfig] = useState<{ host: string; port: number; api_key?: string } | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light' | 'blue'>(() => {
    let stored: 'dark' | 'light' | 'blue' | null = null
    try {
      const raw = window.localStorage?.getItem('app-theme')
      if (raw === 'dark' || raw === 'light' || raw === 'blue') stored = raw
    } catch { /* localStorage may be unavailable under restrictive CSP */ }
    if (stored) return stored
    return 'light'
  })

  const switchTab = (tab: 'overview' | 'dashboard' | 'wizard' | 'logs') => {
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

  // Apply theme to <html> attribute and persist
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { window.localStorage?.setItem('app-theme', theme) } catch { }
  }, [theme])

  // React to menu-driven theme changes from main process
  useEffect(() => {
    const apply = (payload: { mode: 'light' | 'dark' | 'blue' | 'system'; effective: 'light' | 'dark' | 'blue' }) => {
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
    <div style={{ 
      height: '100vh', 
      overflow: 'hidden', 
      display: 'flex', 
      background: 'linear-gradient(to bottom right, var(--bg-1) 0%, var(--bg-2) 50%, var(--bg-3) 100%)',
      color: 'var(--text-primary)' 
    }}>
      
      {/* Left Sidebar */}
      <div style={{
        width: '80px',
        background: 'var(--sidebar-bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: '4rem',
        paddingBottom: '1.5rem',
        borderRight: '1px solid var(--sidebar-border)'
      }}>
        {/* Navigation Icons */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', alignItems: 'center' }}>
          <button
            onClick={() => switchTab('overview')}
            style={{
              width: '48px',
              height: '48px',
              background: activeTab === 'overview' ? 'rgba(139, 92, 246, 0.15)' : 'transparent',
              border: 'none',
              borderRadius: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease',
              color: activeTab === 'overview' ? 'var(--sidebar-text-active)' : 'var(--sidebar-text)'
            }}
            onMouseEnter={(e) => {
              if (activeTab !== 'overview') {
                e.currentTarget.style.background = 'rgba(100, 116, 139, 0.1)';
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== 'overview') {
                e.currentTarget.style.background = 'transparent';
              }
            }}
            title="Overview"
          >
            <Home size={24} />
          </button>

          <button
            onClick={() => switchTab('dashboard')}
            style={{
              width: '48px',
              height: '48px',
              background: activeTab === 'dashboard' ? 'rgba(139, 92, 246, 0.15)' : 'transparent',
              border: 'none',
              borderRadius: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease',
              color: activeTab === 'dashboard' ? 'var(--sidebar-text-active)' : 'var(--sidebar-text)'
            }}
            onMouseEnter={(e) => {
              if (activeTab !== 'dashboard') {
                e.currentTarget.style.background = 'rgba(100, 116, 139, 0.1)';
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== 'dashboard') {
                e.currentTarget.style.background = 'transparent';
              }
            }}
            title="Dashboard"
          >
            <LayoutDashboard size={24} />
          </button>

          <button
            onClick={() => switchTab('wizard')}
            style={{
              width: '48px',
              height: '48px',
              background: activeTab === 'wizard' ? 'rgba(139, 92, 246, 0.15)' : 'transparent',
              border: 'none',
              borderRadius: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease',
              color: activeTab === 'wizard' ? 'var(--sidebar-text-active)' : 'var(--sidebar-text)'
            }}
            onMouseEnter={(e) => {
              if (activeTab !== 'wizard') {
                e.currentTarget.style.background = 'rgba(100, 116, 139, 0.1)';
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== 'wizard') {
                e.currentTarget.style.background = 'transparent';
              }
            }}
            title="Wizard"
          >
            <Wand2 size={24} />
          </button>
        </div>

        <button
          onClick={() => switchTab('logs')}
          style={{
            width: '48px',
            height: '48px',
            background: activeTab === 'logs' ? 'rgba(139, 92, 246, 0.15)' : 'transparent',
            border: 'none',
            borderRadius: '12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
            color: activeTab === 'logs' ? 'var(--sidebar-text-active)' : 'var(--sidebar-text)',
            marginBottom: '1rem'
          }}
          onMouseEnter={(e) => {
            if (activeTab !== 'logs') {
              e.currentTarget.style.background = 'rgba(100, 116, 139, 0.1)';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'logs') {
              e.currentTarget.style.background = 'transparent';
            }
          }}
          title="Logs"
        >
          <ScrollText size={24} />
        </button>

        {/* Help Icon at bottom */}
        <button
          onClick={() => {
            // Trigger help from Overview component
            const event = new CustomEvent('open-help-modal');
            window.dispatchEvent(event);
          }}
          style={{
            width: '48px',
            height: '48px',
            background: 'transparent',
            border: 'none',
            borderRadius: '12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
            color: 'var(--sidebar-text)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(100, 116, 139, 0.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
          title="Contact Support"
        >
          <HelpCircle size={24} />
        </button>

        {/* DevTools button for development mode */}
        {activeTab === 'dashboard' && ((window.electronAPI as any)?.guiMode === 'development') && (
          <button
            onClick={() => { try { window.electronAPI?.openDashboardDevTools?.() } catch { } }}
            style={{
              marginTop: '0.5rem',
              padding: '0.25rem 0.5rem',
              background: '#555a',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.7rem'
            }}
            title="Open Dashboard DevTools"
          >
            Dev
          </button>
        )}
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {/* Page Title - Draggable Region */}
        <div style={{
          padding: '1.25rem 2.5rem',
          background: 'var(--sidebar-bg)',
          borderBottom: '1px solid var(--sidebar-border)',
          WebkitAppRegion: 'drag',
          WebkitUserSelect: 'none',
          userSelect: 'none'
        } as React.CSSProperties}>
          <h1 style={{
            margin: 0,
            fontSize: '1.375rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            {activeTab === 'overview'
              ? 'Overview'
              : activeTab === 'dashboard'
                ? 'Dashboard'
                : activeTab === 'wizard'
                  ? 'Wizard'
                  : 'Logs'}
          </h1>
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
              <Overview logs={logs} setLogs={setLogs} />
            </div>
          )}
          {activeTab === 'dashboard' && (
            <div
              style={{ 
                position: 'absolute', 
                top: 0, 
                left: 0, 
                right: 0, 
                bottom: 0,
                width: '100%',
                height: '100%'
              }}
              ref={(_el) => {
                // Dashboard positioning is now handled by hardcoded offsets in main.ts
                // Pass dummy values since main.ts ignores them and uses SIDEBAR_WIDTH_DIP/PAGE_HEADER_HEIGHT_DIP
                try { window.electronAPI?.showDashboard?.({ x: 0, y: 0, width: 0, height: 0 }) } catch { }
              }}
            />
          )}
          {activeTab === 'wizard' && (
            <div
              style={{ 
                width: '100%', 
                height: '100%', 
                overflow: 'auto',
                padding: '2rem 2rem 2rem 2rem'
              }}
            >
              <div style={{
                maxWidth: '800px',
                width: '100%',
                textAlign: 'center',
                margin: '0 auto'
              }}>
                {/* Wizard Icon */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'center',
                  marginBottom: '1.5rem'
                }}>
                  <div style={{
                    background: 'rgba(139, 92, 246, 0.15)',
                    borderRadius: '50%',
                    padding: '1.5rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <Wand2 size={48} color="#8b5cf6" />
                  </div>
                </div>

                {/* Title */}
                <h2 style={{
                  fontSize: '1.5rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  marginBottom: '1rem'
                }}>
                  MCP Server Import Wizard
                </h2>

                {/* Description */}
                <p style={{
                  fontSize: '1rem',
                  lineHeight: '1.6',
                  color: 'var(--text-secondary)',
                  marginBottom: '1.5rem'
                }}>
                  The Wizard helps you quickly set up Open Edison by importing your existing MCP server configurations.
                </p>

                {/* Features List */}
                <div style={{
                  background: 'var(--card-bg)',
                  border: '1px solid var(--card-border)',
                  borderRadius: '12px',
                  padding: '1.5rem',
                  marginBottom: '2rem',
                  textAlign: 'left'
                }}>
                  <h3 style={{
                    fontSize: '1.125rem',
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                    marginBottom: '1.25rem',
                    textAlign: 'center'
                  }}>
                    What the Wizard Does
                  </h3>
                  
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem'
                  }}>
                    <div style={{ display: 'flex', gap: '0.875rem', alignItems: 'flex-start' }}>
                      <div style={{
                        background: 'rgba(139, 92, 246, 0.1)',
                        borderRadius: '8px',
                        padding: '0.5rem',
                        flexShrink: 0
                      }}>
                        <span style={{ fontSize: '1.25rem' }}>📥</span>
                      </div>
                      <div>
                        <h4 style={{
                          fontSize: '1rem',
                          fontWeight: '600',
                          color: 'var(--text-primary)',
                          marginBottom: '0.25rem'
                        }}>
                          Import MCP Servers
                        </h4>
                        <p style={{
                          fontSize: '0.875rem',
                          color: 'var(--text-muted)',
                          margin: 0
                        }}>
                          Automatically detect and import your MCP server configurations from <strong>VS Code</strong>, <strong>Cursor</strong>, <strong>Claude Desktop</strong>, and <strong>Claude Code</strong>.
                        </p>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.875rem', alignItems: 'flex-start' }}>
                      <div style={{
                        background: 'rgba(139, 92, 246, 0.1)',
                        borderRadius: '8px',
                        padding: '0.5rem',
                        flexShrink: 0
                      }}>
                        <span style={{ fontSize: '1.25rem' }}>🔄</span>
                      </div>
                      <div>
                        <h4 style={{
                          fontSize: '1rem',
                          fontWeight: '600',
                          color: 'var(--text-primary)',
                          marginBottom: '0.25rem'
                        }}>
                          Replace with Open Edison (Recommended)
                        </h4>
                        <p style={{
                          fontSize: '0.875rem',
                          color: 'var(--text-muted)',
                          margin: 0
                        }}>
                          After importing, you can replace your existing MCP configurations with the Open Edison MCP server. This centralizes all your tools in one place with powerful features like permissions management and logging.
                        </p>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.875rem', alignItems: 'flex-start' }}>
                      <div style={{
                        background: 'rgba(139, 92, 246, 0.1)',
                        borderRadius: '8px',
                        padding: '0.5rem',
                        flexShrink: 0
                      }}>
                        <span style={{ fontSize: '1.25rem' }}>💾</span>
                      </div>
                      <div>
                        <h4 style={{
                          fontSize: '1rem',
                          fontWeight: '600',
                          color: 'var(--text-primary)',
                          marginBottom: '0.25rem'
                        }}>
                          Safe Backups
                        </h4>
                        <p style={{
                          fontSize: '0.875rem',
                          color: 'var(--text-muted)',
                          margin: 0
                        }}>
                          Your original configurations are automatically backed up before any changes are made. You can always restore them if needed.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Run Wizard Button */}
                <button
                  onClick={async () => {
                    try {
                      if (window.electronAPI && window.electronAPI.openWizardWindow) {
                        const response = await window.electronAPI.openWizardWindow();
                        if (!response.success) {
                          console.error('Failed to open wizard:', response.error);
                        }
                      }
                    } catch (error) {
                      console.error('Error opening wizard:', error);
                    }
                  }}
                  style={{
                    background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                    color: 'white',
                    border: 'none',
                    padding: '0.875rem 2.5rem',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    fontSize: '1rem',
                    fontWeight: '600',
                    transition: 'all 0.2s ease',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.625rem',
                    boxShadow: '0 4px 16px rgba(139, 92, 246, 0.4)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 8px 24px rgba(139, 92, 246, 0.5)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 4px 16px rgba(139, 92, 246, 0.4)';
                  }}
                >
                  <Wand2 size={20} />
                  Run Wizard
                </button>

                {/* Info note */}
                <p style={{
                  fontSize: '0.8125rem',
                  color: 'var(--text-muted)',
                  marginTop: '1.25rem',
                  fontStyle: 'italic'
                }}>
                  The wizard will guide you through the import process step by step
                </p>
              </div>
            </div>
          )}
          {activeTab === 'logs' && (
            <div style={{ width: '100%', height: '100%', padding: '1.5rem 2.5rem', overflow: 'hidden' }}>
              <LogsView logs={logs} autoScrollDefault={true} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
