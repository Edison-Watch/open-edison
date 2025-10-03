import React, { useState, useEffect, useRef } from 'react';
import { Eye, EyeOff, Server, Globe, Zap, ChevronRight, Activity, Play, Square } from 'lucide-react'

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
}

const Overview: React.FC<OverviewProps> = ({ logs, setLogs }) => {
  const [serverApiStatus, setServerApiStatus] = useState<ServerStatus>({ running: false, port: 3001 });
  const [serverMcpStatus, setServerMcpStatus] = useState<ServerStatus>({ running: false, port: 3000 });
  const [isConnecting, setIsConnecting] = useState(true);
  const [backendProcessRunning, setBackendProcessRunning] = useState(false);
  
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [helpMessage, setHelpMessage] = useState('');
  const [includeDebugLogs, setIncludeDebugLogs] = useState(false);
  const [showLocalInstructions, setShowLocalInstructions] = useState(false);
  const [showWebclientInstructions, setShowWebclientInstructions] = useState(false);
  const [ngrokAuthToken, setNgrokAuthToken] = useState('');
  const [ngrokDomain, setNgrokDomain] = useState('');
  const [showNgrokAuth, setShowNgrokAuth] = useState(false);
  const [ngrokProcess, setNgrokProcess] = useState<any>(null);
  const [ngrokRunning, setNgrokRunning] = useState(false);
  const [ngrokUrl, setNgrokUrl] = useState('');
  const [ngrokErrorMessage, setNgrokErrorMessage] = useState<string | null>(null);
  const [ngrokHealth, setNgrokHealth] = useState<'unknown' | 'online' | 'offline'>('unknown');
  // Quick Add MCP Server state
  const [qaOpen, setQaOpen] = useState(false);
  const [qaName, setQaName] = useState('');
  const [qaCommand, setQaCommand] = useState('npx');
  const [qaArgsList, setQaArgsList] = useState<string[]>([]);
  const [qaEnvRows, setQaEnvRows] = useState<{ key: string; value: string }[]>([]);
  const [qaVerifying, setQaVerifying] = useState(false);
  const [qaVerified, setQaVerified] = useState<null | boolean>(null);
  const [qaError, setQaError] = useState<string | null>(null);
  const [qaRemote, setQaRemote] = useState(false);

  // Check backend process status
  const checkBackendProcessStatus = async () => {
    try {
      if (window.electronAPI && window.electronAPI.getBackendStatus) {
        const status = await window.electronAPI.getBackendStatus();
        setBackendProcessRunning(status.running);
      }
    } catch (error) {
      console.error('Error checking backend process status:', error);
    }
  };

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
        setIsConnecting(false);
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
        setIsConnecting(false);
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
        setIsConnecting(true);
        const response = await window.electronAPI.restartBackend();
        if (response) {
          setBackendProcessRunning(true);
          addLog('Server started successfully');
          // Server status will be updated by the periodic check
        } else {
          setIsConnecting(false);
          addLog('Failed to start server');
        }
      } else {
        addLog('Electron API not available');
      }
    } catch (error) {
      addLog(`Error starting server: ${error}`);
    }
  };

  const stopServer = async () => {
    try {
      if (window.electronAPI && window.electronAPI.stopBackend) {
        const stopped = await window.electronAPI.stopBackend();
        if (stopped) {
          setBackendProcessRunning(false);
          setServerMcpStatus({ running: false, port: 3000 });
          setServerApiStatus({ running: false, port: 3001 });
          setIsConnecting(false);
          addLog('Server stopped successfully');
        } else {
          addLog('Failed to stop server');
        }
      } else {
        addLog('Electron API not available');
      }
    } catch (error) {
      addLog(`Error stopping server: ${error}`);
    }
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

  // Listen for help modal events from App.tsx
  useEffect(() => {
    const handleOpenHelp = () => {
      openHelpModal();
    };
    window.addEventListener('open-help-modal', handleOpenHelp);
    return () => {
      window.removeEventListener('open-help-modal', handleOpenHelp);
    };
  }, []);

  // Wizard functions
  // Request backend to reinitialize MCP servers
  const reinitializeMcp = async () => {
    try {
      let host = 'localhost';
      let port = 3001;
      let apiKey: string | undefined = undefined;
      try {
        if (window.electronAPI.getServerConfig) {
          const cfg = await window.electronAPI.getServerConfig();
          host = cfg?.host || host;
          port = cfg?.port+1 || port;
          apiKey = cfg?.api_key;
        }
      } catch {}

      const url = `http://${host}:${port}/mcp/reinitialize`;
      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const resp = await fetch(url, { method: 'POST', headers });
      if (resp.ok) {
        addLog('MCP servers reinitialize requested successfully.');
      } else {
        addLog(`Failed to request MCP reinitialize: HTTP ${resp.status}`);
      }
    } catch (err) {
      addLog('Failed to request MCP reinitialize.');
      console.error('POST /mcp/reinitialize error:', err);
    }
  };

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

  // Reinitialize when wizard window closes
  useEffect(() => {
    try {
      if (window.electronAPI && window.electronAPI.onWizardClosed) {
        window.electronAPI.onWizardClosed(() => {
          addLog('Wizard closed. Reinitializing MCP servers...');
          if (window.electronAPI && window.electronAPI.reinitializeMcp) {
            window.electronAPI.reinitializeMcp().then((res) => {
              if (res?.ok) {
                addLog('MCP servers reinitialize requested successfully.');
              } else {
                addLog(`Failed to request MCP reinitialize: ${res?.status || res?.error || 'unknown error'}`);
              }
            }).catch((err) => {
              addLog('Failed to request MCP reinitialize.');
              console.error('reinitializeMcp IPC error:', err);
            });
          } else {
            reinitializeMcp();
          }
        });
      }
    } catch {}
  }, []);

  const canVerify = qaName.trim().length > 0 && qaArgsList.some(v => v.trim().length > 0) && !qaVerifying;

  const getArgsNormalized = (): string[] => {
    const rest = qaArgsList.map(s => s.trim()).filter(Boolean).filter(a => a !== '-y' && a !== 'mcp-remote');
    const prefix = qaRemote ? ['-y', 'mcp-remote'] : ['-y'];
    return [...prefix, ...rest];
  };
  const getNextArgExample = (): string => {
    const idx = qaArgsList.length; // next user line index (0-based)
    if (!qaRemote) {
      if (idx === 0) return '@supabase/mcp-server-supabase@latest';
      if (idx === 1) return '--project-ref=<project-ref>';
      return '';
    }
    // Remote examples
    if (idx === 0) return 'https://api.githubcopilot.com/mcp/';
    if (idx === 1) return '--header';
    if (idx === 2) {
      const prev = qaArgsList[1]?.trim();
      if (prev === '--header') return 'Authorization: Bearer ${GITHUB_TOKEN}';
      return '';
    }
    return '';
  };
  const getEnvObject = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const row of qaEnvRows) {
      if (row.key.trim()) out[row.key.trim()] = row.value;
    }
    return out;
  };
  const parseEnv = (s: string): Record<string, string> => {
    try { const j = JSON.parse(s); return (j && typeof j === 'object') ? j as Record<string, string> : {}; } catch { return {}; }
  };

  const verifyMcp = async () => {
    setQaError(null);
    setQaVerified(null);
    setQaVerifying(true);
    try {
      const args = getArgsNormalized();
      const env = getEnvObject();
      const res = await window.electronAPI.validateMcp({ name: qaName, command: qaCommand, args, env, timeout_s: 20 });
      if (res && res.ok && res.data && res.data.valid) {
        setQaVerified(true);
        addLog('✅ MCP server verification passed');
      } else {
        setQaVerified(false);
        const msg = (res && res.data && res.data.error) || res?.error || `Verification failed (status ${res?.status ?? 'n/a'})`;
        setQaError(String(msg));
        addLog(`❌ MCP server verification failed: ${msg}`);
      }
    } catch (e) {
      setQaVerified(false);
      const msg = e instanceof Error ? e.message : String(e);
      setQaError(msg);
      addLog(`❌ MCP server verification error: ${msg}`);
    } finally {
      setQaVerifying(false);
    }
  };

  const addMcp = async () => {
    try {
      const args = getArgsNormalized();
      const env = getEnvObject();
      const res = await window.electronAPI.addMcpServer({ name: qaName, command: qaCommand, args, env });
      if (res && res.ok) {
        addLog(`✅ Added MCP server '${qaName}' to configuration`);
        setQaOpen(false);
        setQaName(''); setQaCommand('npx'); setQaArgsList([]); setQaEnvRows([]); setQaVerified(null); setQaError(null);
        setQaRemote(false);
      } else {
        const msg = res?.error || 'Failed to add server';
        setQaError(msg);
        addLog(`❌ Failed to add MCP server: ${msg}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setQaError(msg);
      addLog(`❌ Failed to add MCP server: ${msg}`);
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
      emailBody += `Server Status: ${serverMcpStatus.running ? 'Online' : isConnecting ? 'Connecting' : 'Offline'}\n`;
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
    checkBackendProcessStatus();
    const interval = setInterval(() => {
      checkServerStatus();
      checkBackendProcessStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Listen and log updater events; trigger a check once on mount in packaged builds
  useEffect(() => {
    try {
      if (window.electronAPI && window.electronAPI.onUpdateStatus && window.electronAPI.onUpdateProgress) {
        window.electronAPI.onUpdateStatus((status, info) => {
          addLog(`[updates] status: ${status}${info?.version ? ` (v${info.version})` : ''}`);
        });
        window.electronAPI.onUpdateProgress((p) => {
          const pct = typeof p?.percent === 'number' ? p.percent.toFixed(1) : 'n/a';
          addLog(`[updates] download: ${pct}%`);
        });
      }
      // Kick off a check when app is packaged; harmless in dev (main will ignore)
      if (window.electronAPI && window.electronAPI.checkForUpdates) {
        window.electronAPI.checkForUpdates().catch(() => {});
      }
    } catch {}
  }, []);

  // Load persisted ngrok settings on mount
  useEffect(() => {
    const load = async () => {
      try {
        if (window.electronAPI && window.electronAPI.getNgrokSettings) {
          const settings = await window.electronAPI.getNgrokSettings();
          if (settings) {
            if (typeof settings.authToken === 'string') setNgrokAuthToken(settings.authToken);
            if (typeof settings.domain === 'string') setNgrokDomain(settings.domain);
            if (typeof settings.url === 'string') setNgrokUrl(settings.url);
          }
        }
      } catch (e) {
        console.warn('Failed to load ngrok settings:', e);
      }
    };
    load();
  }, []);

  // Persist ngrok credentials when they change
  useEffect(() => {
    const save = async () => {
      try {
        if (window.electronAPI && window.electronAPI.saveNgrokSettings) {
          await window.electronAPI.saveNgrokSettings({ authToken: ngrokAuthToken, domain: ngrokDomain });
        }
      } catch (e) {
        // Non-fatal
      }
    };
    if (ngrokAuthToken || ngrokDomain) {
      save();
    }
  }, [ngrokAuthToken, ngrokDomain]);

  // Persist discovered/selected ngrok URL
  useEffect(() => {
    const save = async () => {
      try {
        if (window.electronAPI && window.electronAPI.saveNgrokSettings) {
          await window.electronAPI.saveNgrokSettings({ url: ngrokUrl });
        }
      } catch (e) {
        // Non-fatal
      }
    };
    if (ngrokUrl) {
      save();
    }
  }, [ngrokUrl]);

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

  // Filter and format logs based on current settings
  // Disable ngrok run when missing token or domain
  const isRunNgrokDisabled = ngrokRunning || !ngrokAuthToken.trim() || !ngrokDomain.trim();

  return (
    <div style={{ padding: '2rem 2.5rem', height: '100%', overflow: 'auto', color: 'var(--text-primary)' }}>
      {/* Header Section with Server Status and Start/Stop Button */}
      <div style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: '12px',
        padding: '1.5rem',
        marginBottom: '2.5rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        {/* Server Status */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <div style={{
            background: serverMcpStatus.running
              ? 'rgba(16, 185, 129, 0.15)'
              : isConnecting
                ? 'rgba(245, 158, 11, 0.15)'
                : 'rgba(239, 68, 68, 0.15)',
            borderRadius: '10px',
            width: '48px',
            height: '48px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <Activity
              size={24}
              strokeWidth={2.25}
              color={serverMcpStatus.running
                ? 'var(--status-online)'
                : isConnecting
                  ? 'var(--status-connecting)'
                  : '#ef4444'}
            />
          </div>
          <div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '0.125rem' }}>
              Server Status
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: serverMcpStatus.running
                  ? 'var(--status-online)'
                  : isConnecting
                    ? 'var(--status-connecting)'
                    : '#ef4444'
              }} />
              <span style={{ fontWeight: '600', fontSize: '1rem' }}>
                {serverMcpStatus.running ? 'Online' : isConnecting ? 'Connecting…' : 'Offline'}
              </span>
            </div>
          </div>
        </div>

        {/* Start/Stop Server Button */}
        <button
          onClick={backendProcessRunning ? stopServer : startServer}
          style={{
            background: backendProcessRunning ? 'var(--stop-button-bg)' : 'var(--start-button-bg)',
            color: backendProcessRunning ? 'var(--stop-button-text)' : 'var(--start-button-text)',
            border: 'none',
            padding: '0.875rem 1.75rem',
            borderRadius: '10px',
            cursor: 'pointer',
            fontSize: '0.95rem',
            fontWeight: '600',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            boxShadow: backendProcessRunning ? '0 2px 8px rgba(220, 38, 38, 0.25)' : '0 2px 8px rgba(16, 185, 129, 0.3)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = backendProcessRunning ? 'var(--stop-button-hover)' : 'var(--start-button-hover)';
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = backendProcessRunning ? '0 4px 12px rgba(220, 38, 38, 0.3)' : '0 4px 12px rgba(16, 185, 129, 0.4)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = backendProcessRunning ? 'var(--stop-button-bg)' : 'var(--start-button-bg)';
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = backendProcessRunning ? '0 2px 8px rgba(220, 38, 38, 0.25)' : '0 2px 8px rgba(16, 185, 129, 0.3)';
          }}
        >
          {backendProcessRunning ? (
            <>
              <Square size={18} color='var(--stop-button-text)' fill='var(--stop-button-text)' />
              Stop Server
            </>
          ) : (
            <>
              <Play size={18} color='var(--start-button-text)' />
              Start Server
            </>
          )}
        </button>
      </div>

      {/* Main Action Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2.5rem' }}>
        {/* Local Agent Card */}
        <div
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--card-border)',
            borderRadius: '12px',
            padding: '1.5rem',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '1.25rem'
          }}
          onClick={() => setShowLocalInstructions(!showLocalInstructions)}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--card-hover-bg)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--card-bg)';
          }}
        >
          <div style={{
            background: 'rgba(100, 116, 139, 0.15)',
            borderRadius: '10px',
            padding: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <Server size={24} color="#64748b" />
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: '600', marginBottom: '0.25rem' }}>
              Using Open Edison with your local agent
            </h3>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              Connect to a locally running MCP server
            </p>
          </div>
          <ChevronRight size={20} color="var(--text-muted)" style={{ flexShrink: 0 }} />
        </div>

        {showLocalInstructions && (
          <div style={{ marginTop: '1rem' }}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: '1.6' }}>
              To connect to Open Edison to your local agent that supports MCP, use the following configuration. The wizard can do this for you for the following tools: VSCode, Cursor, Claude Desdktop and Claude Code.
            </p>

            <div style={{
              background: 'var(--code-bg)',
              border: '1px solid var(--code-border)',
              borderRadius: '6px',
              padding: '1rem',
              fontFamily: 'monospace',
              fontSize: '0.875rem',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              color: 'var(--code-text)'
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

            <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--info-bg)', borderRadius: '6px', border: '1px solid var(--info-border)' }}>
              <p style={{ margin: 0, color: 'var(--info-text)', fontSize: '0.875rem' }}>
                <strong>Note:</strong> Replace <code>your-api-key</code> with your actual API key from the configuration.
                The default key is <code>dev-api-key-change-me</code>.
              </p>
            </div>
          </div>
        )}

        {/* Webclient Card */}
        <div
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--card-border)',
            borderRadius: '12px',
            padding: '1.5rem',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '1.25rem'
          }}
          onClick={() => setShowWebclientInstructions(!showWebclientInstructions)}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--card-hover-bg)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--card-bg)';
          }}
        >
          <div style={{
            background: 'rgba(59, 130, 246, 0.15)',
            borderRadius: '10px',
            padding: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <Globe size={24} color="#3b82f6" />
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: '600', marginBottom: '0.25rem' }}>
              Using Open Edison with webclients
            </h3>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              e.g. chatgpt.com or claude.ai
            </p>
          </div>
          <ChevronRight size={20} color="var(--text-muted)" style={{ flexShrink: 0 }} />
        </div>

        {showWebclientInstructions && (
          <div style={{ marginTop: '1rem' }}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: '1.6' }}>
              To use Open Edison with web-based AI clients like ChatGPT or Claude.ai, you'll need to set up an ngrok tunnel to expose your local Open Edison instance to the internet.
            </p>

            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ color: 'var(--text-heading)', fontSize: '1rem', marginBottom: '1rem' }}>Step 1: Install ngrok</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
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
              <h3 style={{ color: 'var(--text-heading)', fontSize: '1rem', marginBottom: '1rem' }}>Step 2: Create ngrok Account</h3>
              <ol style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem', paddingLeft: '1.5rem' }}>
                <li style={{ marginBottom: '0.5rem' }}>Visit <a href="https://dashboard.ngrok.com" target="_blank" rel="noopener noreferrer" style={{ color: '#3498db' }}>https://dashboard.ngrok.com</a> to sign up for a free account</li>
                <li style={{ marginBottom: '0.5rem' }}>Get your authtoken from the "Your Authtoken" page</li>
                <li style={{ marginBottom: '0.5rem' }}>Create a domain name in the "Domains" page</li>
              </ol>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ color: 'var(--text-heading)', fontSize: '1rem', marginBottom: '1rem' }}>Step 3: Configure ngrok</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
                Add your ngrok credentials to the configuration:
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', color: 'var(--text-heading)', marginBottom: '0.5rem', fontWeight: '500' }}>
                    ngrok Authtoken:
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showNgrokAuth ? 'text' : 'password'}
                      value={ngrokAuthToken}
                      onChange={(e) => setNgrokAuthToken(e.target.value)}
                      placeholder="Enter your ngrok authtoken"
                      style={{
                        width: '100%',
                        padding: '0.75rem 2.25rem 0.75rem 0.75rem',
                        border: '1px solid var(--input-border)',
                        borderRadius: '6px',
                        fontSize: '0.875rem',
                        fontFamily: 'monospace',
                        background: 'var(--input-bg)',
                        color: 'var(--input-text)'
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNgrokAuth(!showNgrokAuth)}
                      aria-label={showNgrokAuth ? 'Hide authtoken' : 'Show authtoken'}
                      title={showNgrokAuth ? 'Hide authtoken' : 'Show authtoken'}
                      style={{
                        position: 'absolute',
                        right: '0.5rem',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-muted)',
                        padding: 0,
                        lineHeight: 1
                      }}
                    >
                      {showNgrokAuth ? <EyeOff /> : <Eye />}
                    </button>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', color: 'var(--text-heading)', marginBottom: '0.5rem', fontWeight: '500' }}>
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
                      border: '1px solid var(--input-border)',
                      borderRadius: '6px',
                      fontSize: '0.875rem',
                      fontFamily: 'monospace',
                      background: 'var(--input-bg)',
                      color: 'var(--input-text)'
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
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-heading)' }}>
                      <strong>Tunnel URL:</strong> <code style={{ background: 'var(--code-bg)', padding: '0.25rem 0.5rem', borderRadius: '3px', color: 'var(--code-text)' }}>{ngrokUrl}/mcp/</code>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ color: 'var(--text-heading)', fontSize: '1rem', marginBottom: '1rem' }}>Alternative: Manual ngrok Setup</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
                If you prefer to run ngrok manually, create a <code>ngrok.yml</code> file with this configuration:
              </p>

              <div style={{
                background: 'var(--code-bg)',
                border: '1px solid var(--code-border)',
                borderRadius: '6px',
                padding: '1rem',
                fontFamily: 'monospace',
                fontSize: '0.875rem',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                marginBottom: '1rem',
                color: 'var(--code-text)'
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

              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
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
              <h3 style={{ color: 'var(--text-heading)', fontSize: '1rem', marginBottom: '1rem' }}>Step 4: Enable Developer Mode in ChatGPT</h3>
              <ol style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem', paddingLeft: '1.5rem' }}>
                <li style={{ marginBottom: '0.5rem' }}>Click on your profile icon in ChatGPT</li>
                <li style={{ marginBottom: '0.5rem' }}>Select <strong>Settings</strong></li>
                <li style={{ marginBottom: '0.5rem' }}>Go to <strong>"Connectors"</strong> in the settings menu</li>
                <li style={{ marginBottom: '0.5rem' }}>Select <strong>"Advanced Settings"</strong></li>
                <li style={{ marginBottom: '0.5rem' }}>Enable <strong>"Developer Mode (beta)"</strong></li>
              </ol>
            </div>

            <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--info-bg)', borderRadius: '6px', border: '1px solid var(--info-border)' }}>
              <p style={{ margin: 0, color: 'var(--info-text)', fontSize: '0.875rem' }}>
                <strong>Next:</strong> Once configured, you can add Open Edison to ChatGPT using your ngrok URL as the MCP Server URL (e.g., <code>https://your-domain.ngrok-free.app/mcp/</code>).
              </p>
            </div>
          </div>
        )}

        {/* Add MCP Server Manually Card */}
        <div
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--card-border)',
            borderRadius: '12px',
            padding: '1.5rem',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '1.25rem'
          }}
          onClick={() => setQaOpen(!qaOpen)}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--card-hover-bg)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--card-bg)';
          }}
        >
          <div style={{
            background: 'rgba(234, 179, 8, 0.15)',
            borderRadius: '10px',
            padding: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <Zap size={24} color="#eab308" />
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: '600', marginBottom: '0.25rem' }}>
              Add MCP server manually
            </h3>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              Advanced configuration options
            </p>
          </div>
          <ChevronRight size={20} color="var(--text-muted)" style={{ flexShrink: 0 }} />
        </div>
        {qaOpen && (
          <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.875rem', color: 'var(--text-heading)', marginBottom: '0.5rem', fontWeight: '500' }}>
                <span>Name</span>
                <span title="Required" style={{ color: '#f1c40f' }}>*</span>
              </label>
              <input type="text" value={qaName} onChange={(e) => setQaName(e.target.value)} placeholder="" style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--input-border)', borderRadius: '6px', background: 'var(--input-bg)', color: 'var(--input-text)' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', color: 'var(--text-heading)', marginBottom: '0.5rem', fontWeight: '500' }}>Command</label>
              <input type="text" value={qaCommand} readOnly placeholder="npx" style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--input-border)', borderRadius: '6px', background: 'var(--input-disabled-bg)', color: 'var(--input-disabled-text)' }} />
            </div>

            <div style={{ gridColumn: '1 / span 2', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', color: 'var(--text-heading)' }}>Remote server</label>
              <input type="checkbox" checked={qaRemote} onChange={(e) => { setQaRemote(e.target.checked); }} />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>(Select if the MCP server starts with http/https, e.g.: "https://mcp.atlassian.com/v1/sse")</span>
            </div>

            <div style={{ gridColumn: '1 / span 2' }}>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.875rem', color: 'var(--text-heading)', marginBottom: '0.5rem', fontWeight: '500' }}>
                <span>Arguments</span>
                <span title="At least one user line required" style={{ color: '#f1c40f' }}>*</span>
              </label>
              <div style={{ background: 'var(--code-bg)', border: '1px solid var(--code-border)', borderRadius: '6px', padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                <div style={{ color: 'var(--text-secondary)' }}>[</div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--text-secondary)', paddingLeft: '1rem' }}>
                  <span>"-y",</span>
                </div>
                {qaRemote && (
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--text-secondary)', paddingLeft: '1rem' }}>
                    <span>"mcp-remote",</span>
                  </div>
                )}
                {qaArgsList.map((val, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', paddingLeft: '1rem' }}>
                    <span>"</span>
                    <input value={val} onChange={(e) => setQaArgsList(prev => prev.map((v, i) => i === idx ? e.target.value : v))} style={{ flex: 1, border: '1px solid var(--input-border)', borderRadius: '4px', padding: '0.25rem', fontFamily: 'monospace', background: 'var(--input-bg)', color: 'var(--input-text)' }} />
                    <span>",</span>
                    <button onClick={() => setQaArgsList(prev => prev.filter((_, i) => i !== idx))} title="Remove line" aria-label="Remove argument line" style={{ background: 'var(--button-bg)', border: '1px solid var(--input-border)', borderRadius: '4px', padding: '0.1rem 0.4rem', color: '#c0392b', cursor: 'pointer' }}>×</button>
                  </div>
                ))}
                <div style={{ paddingLeft: '1rem', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <button onClick={() => setQaArgsList(prev => [...prev, ''])} style={{ background: 'var(--button-bg)', border: '1px solid var(--input-border)', borderRadius: '4px', padding: '0.25rem 0.5rem', color: 'var(--text-heading)', cursor: 'pointer' }}>+ add line</button>
                  {getNextArgExample() ? (
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>e.g., {getNextArgExample()}</span>
                  ) : null}
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>]</div>
              </div>
            </div>

            <div style={{ gridColumn: '1 / span 2' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', color: 'var(--text-heading)', marginBottom: '0.5rem', fontWeight: '500' }}>Environment Variables</label>
              <div style={{ background: 'var(--code-bg)', border: '1px solid var(--code-border)', borderRadius: '6px', padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                <div style={{ color: 'var(--text-secondary)' }}>{'{'}</div>
                {qaEnvRows.map((row, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', paddingLeft: '1rem', marginBottom: '0.25rem' }}>
                    <span>"</span>
                    <input value={row.key} onChange={(e) => setQaEnvRows(prev => prev.map((r, i) => i === idx ? { ...r, key: e.target.value } : r))} placeholder="KEY" style={{ width: '180px', border: '1px solid var(--input-border)', borderRadius: '4px', padding: '0.25rem', fontFamily: 'monospace', background: 'var(--input-bg)', color: 'var(--input-text)' }} />
                    <span>": "</span>
                    <input value={row.value} onChange={(e) => setQaEnvRows(prev => prev.map((r, i) => i === idx ? { ...r, value: e.target.value } : r))} placeholder="value" style={{ flex: 1, border: '1px solid var(--input-border)', borderRadius: '4px', padding: '0.25rem', fontFamily: 'monospace', background: 'var(--input-bg)', color: 'var(--input-text)' }} />
                    <span>",</span>
                    <button onClick={() => setQaEnvRows(prev => prev.filter((_, i) => i !== idx))} title="Remove line" aria-label="Remove env line" style={{ background: 'var(--button-bg)', border: '1px solid var(--input-border)', borderRadius: '4px', padding: '0.1rem 0.4rem', color: '#c0392b', cursor: 'pointer' }}>×</button>
                  </div>
                ))}
                <div style={{ paddingLeft: '1rem', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <button onClick={() => setQaEnvRows(prev => [...prev, { key: '', value: '' }])} style={{ background: 'var(--button-bg)', border: '1px solid var(--input-border)', borderRadius: '4px', padding: '0.25rem 0.5rem', color: 'var(--text-heading)', cursor: 'pointer' }}>+ add line</button>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>e.g., SUPABASE_ACCESS_TOKEN: your-supabase-access-token</span>
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>{'}'}</div>
              </div>
            </div>

            <div style={{ gridColumn: '1 / span 2' }}>
              <div style={{ background: 'var(--code-bg)', border: '1px solid var(--code-border)', borderRadius: '6px', padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--code-text)' }}>
                {JSON.stringify({
                  name: qaName || '',
                  command: qaCommand,
                  args: getArgsNormalized(),
                  env: getEnvObject()
                }, null, 2)}
              </div>
            </div>

            {qaError && (
              <div style={{ gridColumn: '1 / span 2', background: '#fdecea', border: '1px solid #f5c6cb', color: '#a94442', borderRadius: '6px', padding: '0.5rem 0.75rem' }}>
                {qaError}
              </div>
            )}

            <div style={{ gridColumn: '1 / span 2', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', alignItems: 'center' }}>
              <button onClick={() => { setQaOpen(false); setQaName(''); setQaCommand('npx'); setQaArgsList([]); setQaEnvRows([]); setQaVerified(null); setQaError(null); setQaRemote(false); }} style={{ background: '#95a5a6', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={verifyMcp} disabled={!canVerify} style={{ background: canVerify ? '#27ae60' : '#95a5a6', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: canVerify ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {qaVerifying ? '⏳ Verifying…' : 'Verify'} {qaVerified === true ? '✅' : qaVerified === false ? '❌' : ''}
              </button>
              <button onClick={addMcp} disabled={!qaVerified} style={{ background: qaVerified ? '#2ecc71' : '#95a5a6', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: qaVerified ? 'pointer' : 'not-allowed' }}>Add to Open Edison</button>
            </div>
          </div>
        )}
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
            background: 'var(--panel-bg)',
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
                color: 'var(--text-muted)',
                padding: '0.25rem',
                borderRadius: '4px',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--card-hover-bg)';
                e.currentTarget.style.color = 'var(--text-heading)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'none';
                e.currentTarget.style.color = 'var(--text-muted)';
              }}
            >
              ×
            </button>

            <h2 style={{ color: 'var(--text-heading)', marginBottom: '1rem', fontSize: '1.5rem' }}>
              💬 Contact Support
            </h2>

            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: '1.6' }}>
              Having issues with Open Edison? Let us know what's going wrong and we'll help you out! You can also contact us on our{' '}
              <a
                href="https://discord.gg/tXjATaKgTV"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--link-color)', textDecoration: 'underline' }}
              >
                Discord channel
              </a>
              .
            </p>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontWeight: '500',
                color: 'var(--text-heading)'
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
                  border: '1px solid var(--input-border)',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  outline: 'none',
                  transition: 'border-color 0.3s ease',
                  background: 'var(--input-bg)',
                  color: 'var(--input-text)'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#3498db';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'var(--input-border)';
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
                color: 'var(--text-secondary)',
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
