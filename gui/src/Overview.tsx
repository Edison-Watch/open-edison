import React, { useState, useEffect } from 'react';

interface ServerStatus {
  running: boolean;
  port: number;
}

interface LogEntry {
  timestamp: string;
  message: string;
  type: string;
}

interface OverviewProps {
  logs: LogEntry[];
  setLogs: React.Dispatch<React.SetStateAction<LogEntry[]>>;
  logsExpanded: boolean;
  setLogsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
}

const Overview: React.FC<OverviewProps> = ({ logs, setLogs, logsExpanded, setLogsExpanded }) => {
  const [serverApiStatus, setServerApiStatus] = useState<ServerStatus>({ running: false, port: 3001 });
  const [serverMcpStatus, setServerMcpStatus] = useState<ServerStatus>({ running: false, port: 3000 });
  const [showApi, setShowApi] = useState(false);
  const [showMcp, setShowMcp] = useState(true);
  const [verboseLogs, setVerboseLogs] = useState(false);
  const [logLevel, setLogLevel] = useState('info');
  const [showDate, setShowDate] = useState(false);
  const [showStream, setShowStream] = useState(false);
  const [showLogsSection, setShowLogsSection] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [helpMessage, setHelpMessage] = useState('');
  const [includeDebugLogs, setIncludeDebugLogs] = useState(false);

  // Check server status - simplified for Electron environment
  const checkServerStatus = async () => {
    try {
      console.log('🔄 Starting server status check...');
      const apiKey = 'dev-api-key-change-me';
      // Try the API server health endpoint first (port 3001)
      const apiResponse = await fetch('http://localhost:3001/health', {
        method: 'GET',
        mode: 'cors',
        headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${apiKey}` }
      });
      
      if (apiResponse.ok) {
        console.log('✅ API server is running on port 3001');
        setServerApiStatus({ running: true, port: 3001 });
      }
      
      // If API server not responding, try the MCP server (port 3000)
      const mcpResponse = await fetch('http://localhost:3001/mcp/status', {
        method: 'GET',
        mode: 'cors',
        headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${apiKey}` }
      });
      
      if (mcpResponse.ok) {
        console.log('✅ MCP server is running on port 3000');
        setServerMcpStatus({ running: true, port: 3000 });
        return;
      }
      
      console.log('❌ No servers responding');
      setServerMcpStatus({ running: false, port: 3000 });
      setServerApiStatus({ running: false, port: 3001 });
    } catch (error) {
      console.error('❌ Error checking server status:', error);
      setServerMcpStatus({ running: false, port: 3000 });
      setServerApiStatus({ running: false, port: 3001 });
    }
  };

  // Add log entry
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { timestamp, message, type: 'stderr' }]);
  };

  // Server control functions
  const startServer = async () => {
    try {
      if (window.electronAPI) {
        const response = await window.electronAPI.restartBackend();
        if (response) {
          setServerMcpStatus({ running: true, port: 3000 });
          setServerApiStatus({ running: true, port: 3001 });
          addLog('Server started successfully');
        } else {
          addLog('Failed to start server');
        }
      } else {
        addLog('Electron API not available');
      }
    } catch (error) {
      addLog(`Error starting server: ${error}`);
    }
  };

  const stopServer = () => {
    addLog('Stop server functionality not yet implemented');
  };

  const restartServer = async () => {
    await startServer();
  };

  // Help modal functions
  const openHelpModal = () => {
    setShowHelpModal(true);
  };

  const closeHelpModal = () => {
    setShowHelpModal(false);
    setHelpMessage('');
    setIncludeDebugLogs(false);
  };

  const submitHelpRequest = async () => {
    if (!helpMessage.trim()) {
      addLog('Please enter a message before submitting your help request.');
      return;
    }

    try {
      addLog('Sending help request...');
      
      // Prepare email content
      const subject = `Open Edison Help Request - ${new Date().toLocaleString()}`;
      let emailBody = `Help Request Details:\n\n`;
      emailBody += `Message: ${helpMessage}\n\n`;
      emailBody += `Timestamp: ${new Date().toISOString()}\n`;
      emailBody += `Server Status: ${serverMcpStatus.running ? 'Online' : 'Offline'}\n`;
      emailBody += `API Status: ${serverApiStatus.running ? 'Online' : 'Offline'}\n\n`;
      
      if (includeDebugLogs) {
        emailBody += `Debug Logs:\n`;
        emailBody += `================\n`;
        emailBody += logs.map(log => `[${log.timestamp}] ${log.message}`).join('\n');
        emailBody += `\n\n`;
      }
      
      // Create mailto link
      const mailtoLink = `mailto:support@edison.watch?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody)}`;
      
      // Open default email client
      window.open(mailtoLink, '_blank');
      
      addLog('Help request prepared! Your default email client should open with the message ready to send.');
      addLog('Please review and send the email to support@edison.watch');
      
    } catch (error) {
      addLog('Error preparing help request. Please try again.');
      console.error('Help request error:', error);
    }
    
    closeHelpModal();
  };



  // Start server status monitoring
  useEffect(() => {
    checkServerStatus();
    const interval = setInterval(checkServerStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Note: All logs are now captured at App level for complete debugging

  // Filter and format logs based on current settings
  const filteredLogs = logs.filter(log => {
    // Show MCP logs (stderr) by default, API logs (stdout) when showApi is checked
    return (log.type === 'stderr' && showMcp) || (log.type === 'stdout' && showApi);
  }).map(log => {
    let message = log.message;
    
    // Apply verbose logs setting
    if (verboseLogs && log.message.includes(' - ')) {
      // Keep the full message with timestamp and level info
      message = log.message;
    } else if (log.message.includes(' - ')) {
      // Extract just the message part (after the last "-")
      const lastDashIndex = log.message.lastIndexOf(' - ');
      if (lastDashIndex !== -1) {
        message = log.message.substring(lastDashIndex + 3);
      }
    }
    
    // Add stream prefix if enabled
    if (showStream) {
      const streamType = log.type === 'stderr' ? 'MCP' : 'API';
      message = `[${streamType}] ${message}`;
    }
    
    return {
      timestamp: showDate ? log.timestamp : '',
      message
    };
  });

  return (
    <div style={{ padding: '2rem', background: 'white', height: '100%', overflow: 'auto' }}>
      {/* Server Control Section */}
      <div style={{
        background: 'white',
        borderRadius: '8px',
        padding: '2rem',
        marginBottom: '2rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
      }}>
        <h2 style={{ color: '#2c3e50', marginBottom: '1rem', fontSize: '1.25rem' }}>
          Server Status
        </h2>
        
        <div style={{
          padding: '1rem',
          borderRadius: '6px',
          margin: '1rem 0',
          fontWeight: '500',
          background: serverMcpStatus.running ? '#d5f4e6' : '#fadbd8',
          color: serverMcpStatus.running ? '#27ae60' : '#e74c3c',
          border: `1px solid ${serverMcpStatus.running ? '#27ae60' : '#e74c3c'}`
        }}>
          {serverMcpStatus.running ? '✅ Server is online 🛡️' : '❌ Server is offline'}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button
            onClick={openHelpModal}
            style={{
              background: '#3498db',
              color: 'white',
              border: 'none',
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.875rem',
              transition: 'all 0.3s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#2980b9';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#3498db';
            }}
          >
            💬 Get Help
          </button>
        </div>

      </div>

      {/* Server Logs Section */}
      <div style={{
        background: 'white',
        borderRadius: '8px',
        marginBottom: '2rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        overflow: 'hidden'
      }}>
        {/* Logs Header - Always Visible */}
        <div style={{
          padding: '1.5rem 2rem',
          borderBottom: showLogsSection ? '1px solid #ecf0f1' : 'none',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          background: showLogsSection ? '#f8f9fa' : 'white',
          transition: 'all 0.3s ease'
        }}
        onClick={() => setShowLogsSection(!showLogsSection)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <h2 style={{ color: '#2c3e50', fontSize: '1.25rem', margin: 0 }}>
              Server Logs
            </h2>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.875rem',
              color: '#7f8c8d'
            }}>
              <span>{filteredLogs.length} entries</span>
              <div style={{
                transform: showLogsSection ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.3s ease',
                fontSize: '1.2rem'
              }}>
                ▼
              </div>
            </div>
          </div>
          {showLogsSection && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLogsExpanded(!logsExpanded);
              }}
              style={{
                background: logsExpanded ? '#e74c3c' : '#3498db',
                color: 'white',
                border: 'none',
                padding: '0.5rem 1rem',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.875rem',
                transition: 'all 0.3s ease'
              }}
            >
              {logsExpanded ? 'Collapse' : 'Expand'}
            </button>
          )}
        </div>

        {/* Logs Content - Collapsible */}
        <div style={{
          maxHeight: showLogsSection ? (logsExpanded ? 'calc(100vh - 200px)' : '300px') : '0px',
          overflow: 'hidden',
          transition: 'max-height 0.3s ease'
        }}>
          <div style={{ padding: '2rem' }}>
            {/* Log Filters */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '1rem', 
              marginBottom: '1rem',
              flexWrap: 'wrap'
            }}>
              <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.875rem', color: '#7f8c8d' }}>
                <input
                  type="checkbox"
                  checked={showMcp}
                  onChange={(e) => setShowMcp(e.target.checked)}
                  style={{ marginRight: '0.5rem' }}
                />
                Show MCP
              </label>
              <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.875rem', color: '#7f8c8d' }}>
                <input
                  type="checkbox"
                  checked={showApi}
                  onChange={(e) => setShowApi(e.target.checked)}
                  style={{ marginRight: '0.5rem' }}
                />
                Show API
              </label>
              <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.875rem', color: '#7f8c8d' }}>
                <input
                  type="checkbox"
                  checked={verboseLogs}
                  onChange={(e) => setVerboseLogs(e.target.checked)}
                  style={{ marginRight: '0.5rem' }}
                />
                Verbose logs
              </label>
              <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.875rem', color: '#7f8c8d' }}>
                <input
                  type="checkbox"
                  checked={showDate}
                  onChange={(e) => setShowDate(e.target.checked)}
                  style={{ marginRight: '0.5rem' }}
                />
                Show date
              </label>
              <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.875rem', color: '#7f8c8d' }}>
                <input
                  type="checkbox"
                  checked={showStream}
                  onChange={(e) => setShowStream(e.target.checked)}
                  style={{ marginRight: '0.5rem' }}
                />
                Show stream
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.875rem', color: '#7f8c8d' }}>Level:</label>
                <select
                  value={logLevel}
                  onChange={(e) => setLogLevel(e.target.value)}
                  style={{
                    padding: '0.25rem 0.5rem',
                    borderRadius: '4px',
                    border: '1px solid #bdc3c7',
                    fontSize: '0.875rem',
                    background: 'white'
                  }}
                >
                  <option value="debug">Debug</option>
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="error">Error</option>
                </select>
              </div>
            </div>

            {/* Logs Display */}
            <div style={{
              background: '#2c3e50',
              color: '#ecf0f1',
              padding: '1rem',
              borderRadius: '6px',
              fontFamily: "'Monaco', 'Menlo', monospace",
              fontSize: '0.875rem',
              maxHeight: logsExpanded ? 'calc(100vh - 300px)' : '200px',
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              transition: 'all 0.3s ease'
            }}>
              {filteredLogs.length === 0 ? 'Server logs will appear here...' : 
                filteredLogs.map((log, index) => log.timestamp ? `[${log.timestamp}] ${log.message}` : log.message).join('\n')
              }
            </div>
          </div>
        </div>
      </div>

      {/* Help Modal */}
      {showHelpModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'white',
            borderRadius: '12px',
            padding: '2rem',
            maxWidth: '500px',
            width: '90%',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)',
            position: 'relative'
          }}>
            {/* Close button */}
            <button
              onClick={closeHelpModal}
              style={{
                position: 'absolute',
                top: '1rem',
                right: '1rem',
                background: 'none',
                border: 'none',
                fontSize: '1.5rem',
                cursor: 'pointer',
                color: '#7f8c8d',
                padding: '0.25rem',
                borderRadius: '4px',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f8f9fa';
                e.currentTarget.style.color = '#2c3e50';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'none';
                e.currentTarget.style.color = '#7f8c8d';
              }}
            >
              ×
            </button>

            <h2 style={{ color: '#2c3e50', marginBottom: '1rem', fontSize: '1.5rem' }}>
              💬 Get Help
            </h2>
            
            <p style={{ color: '#7f8c8d', marginBottom: '1.5rem', lineHeight: '1.6' }}>
              Having issues with Open Edison? Let us know what's going wrong and we'll help you out!
            </p>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ 
                display: 'block', 
                marginBottom: '0.5rem', 
                fontWeight: '500', 
                color: '#2c3e50' 
              }}>
                Describe your issue:
              </label>
              <textarea
                value={helpMessage}
                onChange={(e) => setHelpMessage(e.target.value)}
                placeholder="Please describe the problem you're experiencing, what you were trying to do, and any error messages you've seen..."
                style={{
                  width: '100%',
                  minHeight: '120px',
                  padding: '0.75rem',
                  border: '1px solid #bdc3c7',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  outline: 'none',
                  transition: 'border-color 0.3s ease'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#3498db';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = '#bdc3c7';
                }}
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.5rem',
                cursor: 'pointer',
                fontSize: '0.875rem',
                color: '#2c3e50'
              }}>
                <input
                  type="checkbox"
                  checked={includeDebugLogs}
                  onChange={(e) => setIncludeDebugLogs(e.target.checked)}
                  style={{ margin: 0 }}
                />
                <span>Attach debug logs to help with troubleshooting</span>
              </label>
              <p style={{ 
                fontSize: '0.75rem', 
                color: '#7f8c8d', 
                margin: '0.25rem 0 0 1.5rem',
                lineHeight: '1.4'
              }}>
                This will include server logs and system information to help us diagnose the issue.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
              <button
                onClick={closeHelpModal}
                style={{
                  background: '#95a5a6',
                  color: 'white',
                  border: 'none',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  transition: 'all 0.3s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#7f8c8d';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#95a5a6';
                }}
              >
                Cancel
              </button>
              <button
                onClick={submitHelpRequest}
                disabled={!helpMessage.trim()}
                style={{
                  background: helpMessage.trim() ? '#27ae60' : '#bdc3c7',
                  color: 'white',
                  border: 'none',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '6px',
                  cursor: helpMessage.trim() ? 'pointer' : 'not-allowed',
                  fontSize: '0.875rem',
                  transition: 'all 0.3s ease'
                }}
                onMouseEnter={(e) => {
                  if (helpMessage.trim()) {
                    e.currentTarget.style.background = '#229954';
                  }
                }}
                onMouseLeave={(e) => {
                  if (helpMessage.trim()) {
                    e.currentTarget.style.background = '#27ae60';
                  }
                }}
              >
                Submit Help Request
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Overview;
