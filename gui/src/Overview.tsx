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
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showApi, setShowApi] = useState(false);
  const [showMcp, setShowMcp] = useState(true);
  const [verboseLogs, setVerboseLogs] = useState(false);
  const [logLevel, setLogLevel] = useState('info');
  const [showDate, setShowDate] = useState(false);
  const [showStream, setShowStream] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);

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

  // File handling
  const handleFileSelect = (files: FileList | null) => {
    setSelectedFiles(files);
    if (files && files.length > 0) {
      addLog(`Selected ${files.length} file(s) for import`);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    handleFileSelect(files);
  };

  const importServers = () => {
    if (!selectedFiles || selectedFiles.length === 0) {
      addLog('No files selected for import');
      return;
    }

    addLog(`Importing ${selectedFiles.length} server configuration file(s)...`);
    addLog('Import functionality not yet implemented');
  };

  // Check for Open Edison installation
  const checkOpenEdisonInstall = async () => {
    try {
      if (window.electronAPI) {
        const isInstalled = await window.electronAPI.getInstallationStatus();
        
        if (!isInstalled) {
          setShowWelcome(true);
        }
      }
    } catch (error) {
      console.error('Error checking Open Edison installation:', error);
      setShowWelcome(true);
    }
  };

  // Check Open Edison installation first, then start server monitoring
  useEffect(() => {
    const initializeApp = async () => {
      // Check installation first
      await checkOpenEdisonInstall();
      // Then start server status monitoring
      checkServerStatus();
    };
    
    initializeApp();
    const interval = setInterval(checkServerStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Listen for API logs when showApi is enabled
  useEffect(() => {
    if (showApi && window.electronAPI) {
      const handleApiLog = (log: any) => {
        if (log.type === 'stdout') {
          const timestamp = new Date().toLocaleTimeString();
          const logEntry = {
            timestamp,
            message: log.message.trim(),
            type: 'api'
          };
          setLogs(prev => [...prev, logEntry]);
        }
      };

      window.electronAPI.onBackendLog(handleApiLog);
      
      return () => {
        if (window.electronAPI) {
          window.electronAPI.removeBackendLogListener();
        }
      };
    }
  }, [showApi, setLogs]);

  // Filter and format logs based on current settings
  const filteredLogs = logs.filter(log => {
    // Show MCP logs (stderr) by default, API logs (stdout) when showApi is checked
    return (log.type === 'stderr' && showMcp) || (log.type === 'api' && showApi);
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
      {/* Welcome Modal */}
      {showWelcome && (
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
            textAlign: 'center'
          }}>
            <h2 style={{ color: '#2c3e50', marginBottom: '1rem', fontSize: '1.5rem' }}>
              Welcome to Open Edison! 🎉
            </h2>
            <p style={{ color: '#7f8c8d', marginBottom: '1.5rem', lineHeight: '1.6' }}>
              This is your first time using Open Edison! We've automatically created your application 
              support folder and initialized it with default configuration files.
            </p>
            <p style={{ color: '#7f8c8d', marginBottom: '2rem', lineHeight: '1.6' }}>
              You can now import server configuration files using the "Import Servers" section below, 
              or configure your MCP servers directly in the application support folder.
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button
                onClick={() => setShowWelcome(false)}
                style={{
                  background: '#3498db',
                  color: 'white',
                  border: 'none',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  transition: 'all 0.3s ease'
                }}
              >
                Get Started
              </button>
              <button
                onClick={() => {
                  setShowWelcome(false);
                  // Scroll to import section
                  document.getElementById('import-section')?.scrollIntoView({ behavior: 'smooth' });
                }}
                style={{
                  background: '#9b59b6',
                  color: 'white',
                  border: 'none',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  transition: 'all 0.3s ease'
                }}
              >
                Import Files
              </button>
            </div>
          </div>
        </div>
      )}
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
          {serverMcpStatus.running ? '✅ Server is online' : '❌ Server is offline'}
        </div>

      </div>

      {/* Server Logs Section */}
      <div style={{
        background: 'white',
        borderRadius: '8px',
        padding: '2rem',
        marginBottom: '2rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <h2 style={{ color: '#2c3e50', fontSize: '1.25rem', margin: 0 }}>
              Server Logs
            </h2>
            <button
              onClick={() => setLogsExpanded(!logsExpanded)}
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
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
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
        </div>
        <div style={{
          background: '#2c3e50',
          color: '#ecf0f1',
          padding: '1rem',
          borderRadius: '6px',
          fontFamily: "'Monaco', 'Menlo', monospace",
          fontSize: '0.875rem',
          maxHeight: logsExpanded ? 'calc(100vh - 200px)' : '200px',
          height: logsExpanded ? 'calc(100vh - 200px)' : 'auto',
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          transition: 'all 0.3s ease'
        }}>
          {filteredLogs.length === 0 ? 'Server logs will appear here...' : 
            filteredLogs.map((log, index) => log.timestamp ? `[${log.timestamp}] ${log.message}` : log.message).join('\n')
          }
        </div>
      </div>

      {/* Import Servers Section */}
      <div id="import-section" style={{
        background: 'white',
        borderRadius: '8px',
        padding: '2rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
      }}>
        <h2 style={{ color: '#2c3e50', marginBottom: '1rem', fontSize: '1.25rem' }}>
          Import Servers
        </h2>
        
        <div
          onClick={() => document.getElementById('file-input')?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            border: `2px dashed ${isDragOver ? '#3498db' : '#bdc3c7'}`,
            borderRadius: '8px',
            padding: '2rem',
            textAlign: 'center',
            marginTop: '1rem',
            background: isDragOver ? '#ebf3fd' : 'transparent',
            cursor: 'pointer',
            transition: 'all 0.3s ease'
          }}
        >
          <p>Click here or drag and drop server configuration files</p>
          <p style={{ color: '#7f8c8d', fontSize: '0.875rem', marginTop: '0.5rem' }}>
            Supported formats: JSON, YAML
          </p>
          <input
            type="file"
            id="file-input"
            accept=".json,.yaml,.yml"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => handleFileSelect(e.target.files)}
          />
        </div>
        
        <button
          onClick={importServers}
          style={{
            background: '#9b59b6',
            color: 'white',
            border: 'none',
            padding: '0.75rem 1.5rem',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '1rem',
            margin: '0.5rem',
            transition: 'all 0.3s ease'
          }}
        >
          Import Selected Files
        </button>
      </div>
    </div>
  );
};

export default Overview;
