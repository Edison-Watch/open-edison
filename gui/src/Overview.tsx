import React, { useState, useEffect } from 'react';

interface ServerStatus {
  running: boolean;
  port: number;
}

interface LogEntry {
  timestamp: string;
  message: string;
}

const Overview: React.FC = () => {
  const [serverApiStatus, setServerApiStatus] = useState<ServerStatus>({ running: false, port: 3001 });
  const [serverMcpStatus, setServerMcpStatus] = useState<ServerStatus>({ running: false, port: 3000 });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

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
    setLogs(prev => [...prev, { timestamp, message }]);
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

  // Initialize and periodic status check
  useEffect(() => {
    checkServerStatus();
    const interval = setInterval(checkServerStatus, 5000);
    return () => clearInterval(interval);
  }, []);

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
          Server Control
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
          {serverMcpStatus.running ? '✅ Server is running on port 3001' : '❌ Server is not running'}
        </div>

        <div style={{ marginTop: '1rem' }}>
          <button
            onClick={startServer}
            disabled={serverMcpStatus.running}
            style={{
              background: serverMcpStatus.running ? '#bdc3c7' : '#3498db',
              color: 'white',
              border: 'none',
              padding: '0.75rem 1.5rem',
              borderRadius: '6px',
              cursor: serverMcpStatus.running ? 'not-allowed' : 'pointer',
              fontSize: '1rem',
              margin: '0.5rem 0.5rem 0.5rem 0',
              minWidth: '120px',
              transition: 'all 0.3s ease'
            }}
          >
            Start Server
          </button>
          
          <button
            onClick={stopServer}
            disabled={!serverMcpStatus.running}
            style={{
              background: !serverMcpStatus.running ? '#bdc3c7' : '#e74c3c',
              color: 'white',
              border: 'none',
              padding: '0.75rem 1.5rem',
              borderRadius: '6px',
              cursor: !serverMcpStatus.running ? 'not-allowed' : 'pointer',
              fontSize: '1rem',
              margin: '0.5rem 0.5rem 0.5rem 0',
              minWidth: '120px',
              transition: 'all 0.3s ease'
            }}
          >
            Stop Server
          </button>
          
          <button
            onClick={restartServer}
            style={{
              background: '#9b59b6',
              color: 'white',
              border: 'none',
              padding: '0.75rem 1.5rem',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '1rem',
              margin: '0.5rem 0.5rem 0.5rem 0',
              minWidth: '120px',
              transition: 'all 0.3s ease'
            }}
          >
            Restart Server
          </button>
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
        <h2 style={{ color: '#2c3e50', marginBottom: '1rem', fontSize: '1.25rem' }}>
          Server Logs
        </h2>
        <div style={{
          background: '#2c3e50',
          color: '#ecf0f1',
          padding: '1rem',
          borderRadius: '6px',
          fontFamily: "'Monaco', 'Menlo', monospace",
          fontSize: '0.875rem',
          maxHeight: '200px',
          overflowY: 'auto',
          whiteSpace: 'pre-wrap'
        }}>
          {logs.length === 0 ? 'Server logs will appear here...' : 
            logs.map((log, index) => `[${log.timestamp}] ${log.message}`).join('\n')
          }
        </div>
      </div>

      {/* Import Servers Section */}
      <div style={{
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
