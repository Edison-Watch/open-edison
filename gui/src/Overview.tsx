import React, { useState, useEffect, useRef } from 'react';

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
  const [showStdout, setShowStdout] = useState(true);
  const [showStderr, setShowStderr] = useState(true);
  const [verboseLogs, setVerboseLogs] = useState(false);
  const [logLevel, setLogLevel] = useState('warning');
  const [showDate, setShowDate] = useState(false);
  const [showStream, setShowStream] = useState(false);
  const [showLogsSection, setShowLogsSection] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [helpMessage, setHelpMessage] = useState('');
  const [includeDebugLogs, setIncludeDebugLogs] = useState(false);
  const [showLocalInstructions, setShowLocalInstructions] = useState(false);
  const [showWebclientInstructions, setShowWebclientInstructions] = useState(false);
  const [ngrokAuthToken, setNgrokAuthToken] = useState('');
  const [ngrokDomain, setNgrokDomain] = useState('');
  const [ngrokProcess, setNgrokProcess] = useState<any>(null);
  const [ngrokRunning, setNgrokRunning] = useState(false);
  const [ngrokUrl, setNgrokUrl] = useState('');
  const [ngrokErrorMessage, setNgrokErrorMessage] = useState<string | null>(null);
  const [ngrokHealth, setNgrokHealth] = useState<'unknown' | 'online' | 'offline'>('unknown');
  const [autoScroll, setAutoScroll] = useState(true);

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

  // Wizard functions
  const openWizard = async () => {
    try {
      if (window.electronAPI && window.electronAPI.openWizardWindow) {
        const response = await window.electronAPI.openWizardWindow();
        if (response.success) {
          addLog('Wizard window opened successfully');
        } else {
          addLog(`Failed to open wizard: ${response.error || 'Unknown error'}`);
        }
      } else {
        addLog('Wizard functionality not available');
      }
    } catch (error) {
      addLog(`Error opening wizard: ${error}`);
    }
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

      // Build logs text for attachment if requested
      let logsText: string | undefined = undefined;
      if (includeDebugLogs) {
        logsText = logs.map(log => `[${log.timestamp}] (${log.type}) ${log.message}`).join('\n');
      }

      // Prefer native composition with attachment via Electron IPC
      if (window.electronAPI && window.electronAPI.composeHelpEmail) {
        const result = await window.electronAPI.composeHelpEmail(subject, emailBody, includeDebugLogs, logsText);
        if (result && result.success) {
          addLog('Help request prepared in your email client. Please review and send.');
          if (result.attachmentPath) {
            addLog(`Attached logs file: ${result.attachmentPath}`);
          }
        } else {
          // Fallback to mailto if IPC failed
          const mailtoLink = `mailto:support@edison.watch?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody)}`;
          window.open(mailtoLink, '_blank');
          addLog('Fallback: opened default email client without attachment.');
        }
      } else {
        // Fallback path if preload not available
        const mailtoLink = `mailto:support@edison.watch?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody)}`;
        window.open(mailtoLink, '_blank');
        addLog('Fallback: opened default email client without attachment.');
      }

    } catch (error) {
      addLog('Error preparing help request. Please try again.');
      console.error('Help request error:', error);
    }

    closeHelpModal();
  };

  // Ngrok process management functions
  const startNgrok = async () => {
    console.log('startNgrok called, ngrokRunning:', ngrokRunning);
    console.log('ngrokAuthToken:', ngrokAuthToken);
    console.log('window.electronAPI:', window.electronAPI);

    // Simple test to see if button click works
    console.log('Button clicked! startNgrok function called.');
    // Clear error banner on retry
    setNgrokErrorMessage(null);

    if (ngrokRunning) {
      addLog('Ngrok is already running');
      return;
    }

    if (!ngrokAuthToken.trim()) {
      addLog('Please enter your ngrok authtoken first');
      return;
    }

    try {
      addLog('Starting ngrok tunnel...');

      // Use Electron API to spawn ngrok process
      if (window.electronAPI && window.electronAPI.spawnProcess) {
        console.log('Electron API available, spawning process...');
        // Use ngrok command line options directly
        const args = ['http', '3000', '--authtoken', ngrokAuthToken];
        if (ngrokDomain) {
          args.push('--domain', ngrokDomain);
        }
        const env = { ...process.env };

        console.log('Spawning ngrok with args:', args);
        console.log('Environment:', env);

        const processId = await window.electronAPI.spawnProcess('ngrok', args, env);
        console.log('Process spawned with ID:', processId);

        setNgrokProcess(processId);
        setNgrokRunning(true);
        addLog(`Ngrok started with process ID: ${processId}`);

        // Set the ngrok URL
        if (ngrokDomain) {
          setNgrokUrl(`https://${ngrokDomain}`);
        } else {
          // For free ngrok, we'll need to parse the output to get the actual URL
          setNgrokUrl('https://your-domain.ngrok-free.app');
        }

        addLog(`Ngrok tunnel is starting...`);

        // Set a timeout to check if the process is still running after a few seconds
        setTimeout(() => {
          if (ngrokRunning && ngrokProcess === processId) {
            // If we're still in "running" state but haven't received a URL, something might be wrong
            addLog(`⏳ Ngrok is still starting... If this takes too long, check the logs for errors.`);
          }
        }, 3000);
      } else {
        console.log('Electron API not available');
        addLog('Electron API not available for process management');
      }
    } catch (error) {
      console.error('Error in startNgrok:', error);
      addLog(`Error starting ngrok: ${error}`);
      setNgrokErrorMessage(`Ngrok failed to start: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const stopNgrok = async () => {
    console.log('stopNgrok called, ngrokRunning:', ngrokRunning, 'ngrokProcess:', ngrokProcess);

    if (!ngrokRunning || !ngrokProcess) {
      addLog('Ngrok is not running');
      return;
    }

    try {
      addLog('Stopping ngrok tunnel...');

      if (window.electronAPI && window.electronAPI.terminateProcess) {
        console.log('Terminating process:', ngrokProcess);
        await window.electronAPI.terminateProcess(ngrokProcess);
        addLog('Ngrok tunnel stopped');
      } else {
        console.log('Electron API not available for termination');
        addLog('Electron API not available for process management');
      }

      setNgrokProcess(null);
      setNgrokRunning(false);
      setNgrokUrl('');
      setNgrokHealth('offline');
    } catch (error) {
      console.error('Error in stopNgrok:', error);
      addLog(`Error stopping ngrok: ${error}`);
    }
  };



  // Start server status monitoring
  useEffect(() => {
    checkServerStatus();
    const interval = setInterval(checkServerStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Check ngrok health
  const checkNgrokHealth = async () => {
    try {
      if (!ngrokUrl) {
        setNgrokHealth('offline');
        return;
      }
      // Try known endpoints in order
      const candidates = [
        `${ngrokUrl}/mcp/status`,
        `${ngrokUrl}/health`,
        `${ngrokUrl}/mcp/`
      ];
      for (const url of candidates) {
        try {
          const resp = await fetch(url, { method: 'GET', mode: 'cors' });
          if (resp.ok) {
            setNgrokHealth('online');
            return;
          }
        } catch { }
      }
      setNgrokHealth('offline');
    } catch {
      setNgrokHealth('offline');
    }
  };

  // Poll ngrok health while running
  useEffect(() => {
    if (!ngrokRunning || !ngrokUrl) {
      setNgrokHealth('offline');
      return;
    }
    checkNgrokHealth();
    const interval = setInterval(checkNgrokHealth, 5000);
    return () => clearInterval(interval);
  }, [ngrokRunning, ngrokUrl]);

  // Cleanup ngrok process on component unmount
  useEffect(() => {
    return () => {
      if (ngrokRunning && ngrokProcess) {
        stopNgrok();
      }
    };
  }, [ngrokRunning, ngrokProcess]);

  // Listen for ngrok URL updates
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onNgrokUrl) {
      window.electronAPI.onNgrokUrl((url: string) => {
        console.log('Received ngrok URL:', url);
        setNgrokUrl(url);
        addLog(`Ngrok tunnel is running at: ${url}/mcp/`);
      });
    }
  }, []);

  // Ref to the logs container for autoscroll
  const logsContainerRef = useRef<HTMLDivElement | null>(null);

  // Store the current ngrok process ID in a ref to avoid stale closures
  const ngrokProcessRef = useRef<any>(null);
  const ngrokRunningRef = useRef<boolean>(false);

  // Update refs when state changes
  useEffect(() => {
    ngrokProcessRef.current = ngrokProcess;
  }, [ngrokProcess]);

  useEffect(() => {
    ngrokRunningRef.current = ngrokRunning;
  }, [ngrokRunning]);

  // Listen for process errors - set up once on mount
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onProcessError) {
      const handleProcessError = (data: { processId: any; error: string }) => {
        console.log('Process error:', data);
        // Check if this is a ngrok process error using refs to avoid stale closures
        if (data.processId === ngrokProcessRef.current || data.error.includes('ngrok') || data.error.includes('command not found')) {
          addLog(`❌ Ngrok failed to start: ${data.error}`);
          addLog(`💡 Please install ngrok first: brew install ngrok`);
          setNgrokErrorMessage(`Ngrok failed to start: ${data.error}`);
          setNgrokProcess(null);
          setNgrokRunning(false);
          setNgrokUrl('');
        }
      };

      window.electronAPI.onProcessError(handleProcessError);

      // Cleanup listener on unmount
      return () => {
        if (window.electronAPI && window.electronAPI.removeProcessErrorListener) {
          window.electronAPI.removeProcessErrorListener();
        }
      };
    }
  }, []); // Empty dependency array - set up once

  // Listen for process exit errors - set up once on mount
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onProcessExitError) {
      const handleProcessExitError = (data: { processId: any; code: number }) => {
        console.log('Process exit error:', data);
        // Check if this is a ngrok process exit error using refs to avoid stale closures
        if (data.processId === ngrokProcessRef.current || (data.code === 127 && ngrokRunningRef.current)) {
          addLog(`❌ Ngrok process exited with error code: ${data.code}`);
          if (data.code === 127) {
            addLog(`💡 Command not found - please install ngrok: brew install ngrok`);
            setNgrokErrorMessage('Ngrok failed to run: command not found. Install it with: brew install ngrok');
          } else {
            addLog(`💡 Please check if ngrok is installed: brew install ngrok`);
            setNgrokErrorMessage(`Ngrok failed to run (exit code ${data.code}). Please check your ngrok installation.`);
          }
          setNgrokProcess(null);
          setNgrokRunning(false);
          setNgrokUrl('');
        }
      };

      window.electronAPI.onProcessExitError(handleProcessExitError);

      // Cleanup listener on unmount
      return () => {
        if (window.electronAPI && window.electronAPI.removeProcessExitErrorListener) {
          window.electronAPI.removeProcessExitErrorListener();
        }
      };
    }
  }, []); // Empty dependency array - set up once

  // Note: All logs are now captured at App level for complete debugging

  // Helper function to extract log level from message
  const getLogLevel = (message: string): string => {
    const levelMatch = message.match(/(DEBUG|INFO|WARNING|ERROR|CRITICAL)/i);
    if (levelMatch) {
      return levelMatch[1].toLowerCase();
    }
    // Default to info if no level found
    return 'info';
  };

  // Helper function to check if log level should be shown
  const shouldShowLogLevel = (message: string): boolean => {
    const messageLevel = getLogLevel(message);
    const levelHierarchy = { debug: 0, info: 1, warning: 2, error: 3, critical: 4 };
    const selectedLevel = levelHierarchy[logLevel as keyof typeof levelHierarchy] || 1;
    const messageLevelNum = levelHierarchy[messageLevel as keyof typeof levelHierarchy] || 1;
    return messageLevelNum >= selectedLevel;
  };

  // Filter and format logs based on current settings
  const filteredLogs = logs.filter(log => {
    // Show stdout and stderr logs based on checkboxes
    const streamMatch = (log.type === 'stdout' && showStdout) || (log.type === 'stderr' && showStderr);
    // Filter by log level
    const levelMatch = shouldShowLogLevel(log.message);
    return streamMatch && levelMatch;
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
      const streamType = log.type === 'stderr' ? 'Err' : 'Out';
      message = `[${streamType}] ${message}`;
    }

    return {
      timestamp: showDate ? log.timestamp : '',
      message
    };
  });

  // Auto-scroll logs to bottom when enabled
  useEffect(() => {
    if (!autoScroll) return;
    const container = logsContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [logs, logsExpanded, showLogsSection, autoScroll]);

  // Disable ngrok run when missing token or domain
  const isRunNgrokDisabled = ngrokRunning || !ngrokAuthToken.trim() || !ngrokDomain.trim();

  return (
    <div style={{ padding: '2rem', background: 'var(--panel-bg)', height: '100%', overflow: 'auto', color: 'var(--text-primary)' }}>
      {/* Server Control Section */}
      <div style={{
        background: 'var(--panel-bg)',
        borderRadius: '8px',
        padding: '2rem',
        marginBottom: '2rem',
        border: '1px solid var(--panel-border)'
      }}>
        <h2 style={{ color: 'var(--text-primary)', marginBottom: '1rem', fontSize: '1.25rem' }}>
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
          {serverMcpStatus.running && ngrokRunning && (
            <div style={{
              marginTop: '0.5rem',
              fontWeight: '400',
              color: ngrokHealth === 'online' ? '#2c3e50' : '#7f8c8d'
            }}>
              {ngrokHealth === 'online' ? '🌐 Open Edison is listening on ngrok URL' : '🌐 Checking ngrok availability...'}
              {ngrokUrl ? (
                <span> — <code style={{ background: '#f8f9fa', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>{ngrokUrl}/mcp/</code></span>
              ) : null}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button
            onClick={openWizard}
            style={{
              background: '#9b59b6',
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
              e.currentTarget.style.background = '#8e44ad';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#9b59b6';
            }}
          >
            ✨
            Run Wizard
          </button>
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

      {/* Ngrok error banner (moved near the Run ngrok button below) */}

      {/* Installation Instructions Section */}
      <div style={{
        background: 'white',
        borderRadius: '8px',
        padding: '2rem',
        marginBottom: '2rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
      }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            marginBottom: showLocalInstructions ? '1rem' : '0'
          }}
          onClick={() => setShowLocalInstructions(!showLocalInstructions)}
        >
          <h2 style={{ color: '#2c3e50', margin: 0, fontSize: '1.25rem' }}>
            📋 Using Open Edison with your local agent
          </h2>
          <span style={{ fontSize: '1.5rem', color: '#7f8c8d' }}>
            {showLocalInstructions ? '▼' : '▶'}
          </span>
        </div>

        {showLocalInstructions && (
          <div style={{ marginTop: '1rem' }}>
            <p style={{ color: '#7f8c8d', marginBottom: '1rem', lineHeight: '1.6' }}>
              To connect to Open Edison to your local agent that supports MCP, use the following configuration. The wizard can do this for you for the following tools: VSCode, Cursor, Claude Desdktop and Claude Code.
            </p>

            <div style={{
              background: '#f8f9fa',
              border: '1px solid #e9ecef',
              borderRadius: '6px',
              padding: '1rem',
              fontFamily: 'monospace',
              fontSize: '0.875rem',
              overflow: 'auto',
              whiteSpace: 'pre-wrap'
            }}>
              {`{
  "mcpServers": {
    "open-edison": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3000/mcp/", "--http-only", "--header", "Authorization: Bearer your-api-key"]
    }
  }
}`}
            </div>

            <div style={{ marginTop: '1rem', padding: '1rem', background: '#e8f4fd', borderRadius: '6px', border: '1px solid #bee5eb' }}>
              <p style={{ margin: 0, color: '#0c5460', fontSize: '0.875rem' }}>
                <strong>Note:</strong> Replace <code>your-api-key</code> with your actual API key from the configuration.
                The default key is <code>dev-api-key-change-me</code>.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Webclient Instructions Section */}
      <div style={{
        background: 'white',
        borderRadius: '8px',
        padding: '2rem',
        marginBottom: '2rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
      }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            marginBottom: showWebclientInstructions ? '1rem' : '0'
          }}
          onClick={() => setShowWebclientInstructions(!showWebclientInstructions)}
        >
          <h2 style={{ color: '#2c3e50', margin: 0, fontSize: '1.25rem' }}>
            🌐 Using Open Edison with webclients (e.g. chatgpt.com or claude.ai)
          </h2>
          <span style={{ fontSize: '1.5rem', color: '#7f8c8d' }}>
            {showWebclientInstructions ? '▼' : '▶'}
          </span>
        </div>

        {showWebclientInstructions && (
          <div style={{ marginTop: '1rem' }}>
            <p style={{ color: '#7f8c8d', marginBottom: '1.5rem', lineHeight: '1.6' }}>
              To use Open Edison with web-based AI clients like ChatGPT or Claude.ai, you'll need to set up an ngrok tunnel to expose your local Open Edison instance to the internet.
            </p>

            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ color: '#2c3e50', fontSize: '1rem', marginBottom: '1rem' }}>Step 1: Install ngrok</h3>
              <p style={{ color: '#7f8c8d', fontSize: '0.875rem', marginBottom: '1rem' }}>
                First, you need to install ngrok on your system:
              </p>
              <div style={{
                background: '#2c3e50',
                color: '#ecf0f1',
                border: '1px solid #34495e',
                borderRadius: '6px',
                padding: '1rem',
                fontFamily: 'monospace',
                fontSize: '0.875rem',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                marginBottom: '1rem'
              }}>
                {`# macOS (using Homebrew)
brew install ngrok

# Or download from https://ngrok.com/download
# Then add to your PATH`}
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ color: '#2c3e50', fontSize: '1rem', marginBottom: '1rem' }}>Step 2: Create ngrok Account</h3>
              <ol style={{ color: '#7f8c8d', fontSize: '0.875rem', marginBottom: '1rem', paddingLeft: '1.5rem' }}>
                <li style={{ marginBottom: '0.5rem' }}>Visit <a href="https://dashboard.ngrok.com" target="_blank" rel="noopener noreferrer" style={{ color: '#3498db' }}>https://dashboard.ngrok.com</a> to sign up for a free account</li>
                <li style={{ marginBottom: '0.5rem' }}>Get your authtoken from the "Your Authtoken" page</li>
                <li style={{ marginBottom: '0.5rem' }}>Create a domain name in the "Domains" page</li>
              </ol>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ color: '#2c3e50', fontSize: '1rem', marginBottom: '1rem' }}>Step 3: Configure ngrok</h3>
              <p style={{ color: '#7f8c8d', fontSize: '0.875rem', marginBottom: '1rem' }}>
                Add your ngrok credentials to the configuration:
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', color: '#2c3e50', marginBottom: '0.5rem', fontWeight: '500' }}>
                    ngrok Authtoken:
                  </label>
                  <input
                    type="text"
                    value={ngrokAuthToken}
                    onChange={(e) => setNgrokAuthToken(e.target.value)}
                    placeholder="Enter your ngrok authtoken"
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '1px solid #bdc3c7',
                      borderRadius: '6px',
                      fontSize: '0.875rem',
                      fontFamily: 'monospace'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', color: '#2c3e50', marginBottom: '0.5rem', fontWeight: '500' }}>
                    ngrok Domain:
                  </label>
                  <input
                    type="text"
                    value={ngrokDomain}
                    onChange={(e) => setNgrokDomain(e.target.value)}
                    placeholder="Enter your ngrok domain (e.g., your-domain.ngrok-free.app)"
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '1px solid #bdc3c7',
                      borderRadius: '6px',
                      fontSize: '0.875rem',
                      fontFamily: 'monospace'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={startNgrok}
                  disabled={isRunNgrokDisabled}
                  style={{
                    background: isRunNgrokDisabled ? '#95a5a6' : '#27ae60',
                    color: 'white',
                    border: 'none',
                    padding: '0.75rem 1.5rem',
                    borderRadius: '6px',
                    cursor: isRunNgrokDisabled ? 'not-allowed' : 'pointer',
                    fontSize: '0.875rem',
                    fontWeight: '500',
                    transition: 'all 0.3s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (!isRunNgrokDisabled) {
                      e.currentTarget.style.background = '#229954';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isRunNgrokDisabled) {
                      e.currentTarget.style.background = '#27ae60';
                    }
                  }}
                >
                  🚀 Run ngrok automatically
                </button>

                {/* Inline error near the Run button so it stays visible in context */}
                {ngrokErrorMessage && (
                  <div style={{
                    background: '#fdecea',
                    border: '1px solid #f5c6cb',
                    color: '#a94442',
                    borderRadius: '6px',
                    padding: '0.5rem 0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    <span style={{ fontSize: '0.85rem' }}>{ngrokErrorMessage}</span>
                    <button
                      onClick={() => setNgrokErrorMessage(null)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#a94442',
                        cursor: 'pointer',
                        fontSize: '1rem',
                        lineHeight: 1
                      }}
                      aria-label="Dismiss ngrok error"
                    >
                      ×
                    </button>
                  </div>
                )}

                {ngrokRunning && (
                  <button
                    onClick={stopNgrok}
                    style={{
                      background: '#e74c3c',
                      color: 'white',
                      border: 'none',
                      padding: '0.75rem 1.5rem',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                      fontWeight: '500',
                      transition: 'all 0.3s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#c0392b';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#e74c3c';
                    }}
                  >
                    🛑 Stop ngrok
                  </button>
                )}
              </div>

              {ngrokRunning && (
                <div style={{
                  marginTop: '1rem',
                  padding: '1rem',
                  background: '#d5f4e6',
                  borderRadius: '6px',
                  border: '1px solid #27ae60'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <span style={{ color: '#27ae60', fontWeight: '500' }}>✅ Ngrok is running</span>
                  </div>
                  {ngrokUrl && (
                    <div style={{ fontSize: '0.875rem', color: '#2c3e50' }}>
                      <strong>Tunnel URL:</strong> <code style={{ background: '#f8f9fa', padding: '0.25rem 0.5rem', borderRadius: '3px' }}>{ngrokUrl}/mcp/</code>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ color: '#2c3e50', fontSize: '1rem', marginBottom: '1rem' }}>Alternative: Manual ngrok Setup</h3>
              <p style={{ color: '#7f8c8d', fontSize: '0.875rem', marginBottom: '1rem' }}>
                If you prefer to run ngrok manually, create a <code>ngrok.yml</code> file with this configuration:
              </p>

              <div style={{
                background: '#f8f9fa',
                border: '1px solid #e9ecef',
                borderRadius: '6px',
                padding: '1rem',
                fontFamily: 'monospace',
                fontSize: '0.875rem',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                marginBottom: '1rem'
              }}>
                {`version: 3

agent:
  authtoken: ${ngrokAuthToken || 'YOUR_NGROK_AUTH_TOKEN'}

endpoints:
  - name: open-edison-mcp
    url: ${ngrokDomain || 'YOUR_NGROK_DOMAIN'}
    upstream:
      url: http://localhost:3000
      protocol: http1`}
              </div>

              <p style={{ color: '#7f8c8d', fontSize: '0.875rem', marginBottom: '1rem' }}>
                Then run this command in your terminal:
              </p>

              <div style={{
                background: '#2c3e50',
                color: '#ecf0f1',
                border: '1px solid #34495e',
                borderRadius: '6px',
                padding: '1rem',
                fontFamily: 'monospace',
                fontSize: '0.875rem',
                overflow: 'auto',
                whiteSpace: 'pre-wrap'
              }}>
                ngrok start --config=ngrok.yml open-edison-mcp
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ color: '#2c3e50', fontSize: '1rem', marginBottom: '1rem' }}>Step 4: Enable Developer Mode in ChatGPT</h3>
              <ol style={{ color: '#7f8c8d', fontSize: '0.875rem', marginBottom: '1rem', paddingLeft: '1.5rem' }}>
                <li style={{ marginBottom: '0.5rem' }}>Click on your profile icon in ChatGPT</li>
                <li style={{ marginBottom: '0.5rem' }}>Select <strong>Settings</strong></li>
                <li style={{ marginBottom: '0.5rem' }}>Go to <strong>"Connectors"</strong> in the settings menu</li>
                <li style={{ marginBottom: '0.5rem' }}>Select <strong>"Advanced Settings"</strong></li>
                <li style={{ marginBottom: '0.5rem' }}>Enable <strong>"Developer Mode (beta)"</strong></li>
              </ol>
            </div>

            <div style={{ marginTop: '1rem', padding: '1rem', background: '#e8f4fd', borderRadius: '6px', border: '1px solid #bee5eb' }}>
              <p style={{ margin: 0, color: '#0c5460', fontSize: '0.875rem' }}>
                <strong>Next:</strong> Once configured, you can add Open Edison to ChatGPT using your ngrok URL as the MCP Server URL (e.g., <code>https://your-domain.ngrok-free.app/mcp/</code>).
              </p>
            </div>
          </div>
        )}
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
                  checked={showStdout}
                  onChange={(e) => setShowStdout(e.target.checked)}
                  style={{ marginRight: '0.5rem' }}
                />
                Show stdout
              </label>
              <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.875rem', color: '#7f8c8d' }}>
                <input
                  type="checkbox"
                  checked={showStderr}
                  onChange={(e) => setShowStderr(e.target.checked)}
                  style={{ marginRight: '0.5rem' }}
                />
                Show stderr
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

              {/* Autoscroll toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.875rem', color: '#7f8c8d' }}>Autoscroll:</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.875rem', color: '#7f8c8d' }}>
                  <input
                    type="radio"
                    name="autoscroll"
                    checked={autoScroll}
                    onChange={() => setAutoScroll(true)}
                  />
                  On
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.875rem', color: '#7f8c8d' }}>
                  <input
                    type="radio"
                    name="autoscroll"
                    checked={!autoScroll}
                    onChange={() => setAutoScroll(false)}
                  />
                  Off
                </label>
              </div>
            </div>

            {/* Logs Display */}
            <div ref={logsContainerRef} style={{
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
