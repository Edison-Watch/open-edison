import React, { useState, useEffect } from 'react';
import wizardApiService from '../services/wizardApi';
import ClientLogo from './ClientLogo';

interface ServerConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  roots?: string[];
  client?: string; // Track which client this server came from
  includeInSave?: boolean; // Whether this server should be included when saving
  potential_duplicate?: boolean;
  duplicate_reason?: string | null;
}

interface ImportResponse {
  success: boolean;
  servers: ServerConfig[];
  errors: string[];
  message: string;
}

interface ClientDetectionResponse {
  success: boolean;
  clients: string[];
  message: string;
}

interface McpImportWizardProps {
  onClose: () => void;
  onImportComplete: (servers: ServerConfig[]) => void;
}

const McpImportWizard: React.FC<McpImportWizardProps> = ({ onClose, onImportComplete }) => {
  const [step, setStep] = useState(0);
  const [visitedSteps, setVisitedSteps] = useState<Set<number>>(new Set([0]));
  const [availableClients, setAvailableClients] = useState<string[]>([]);
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [importedServers, setImportedServers] = useState<ServerConfig[]>([]);
  const [selectedServers, setSelectedServers] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [skipOAuth, setSkipOAuth] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [autoImport, setAutoImport] = useState<boolean | null>(null);
  const [wizardReady, setWizardReady] = useState(false);
  const [checkingWizard, setCheckingWizard] = useState(true);
  // New state for export/replace step
  const [replaceClients, setReplaceClients] = useState<string[]>([]);
  const [replaceResults, setReplaceResults] = useState<any>(null);
  const [backupInfo, setBackupInfo] = useState<any>(null);
  const [showReplacePreview, setShowReplacePreview] = useState(false);

  // Verification state
  const [verificationResults, setVerificationResults] = useState<Record<string, 'pending' | 'success' | 'failed' | 'timeout'>>({});
  const [verificationTimeout, setVerificationTimeout] = useState<number | null>(30);  // Default 30 seconds

  const getServerKey = (server: ServerConfig) => `${server.client ?? 'unknown'}::${server.name}`;

  const getServersToSave = () =>
    getSelectedServerDetails().filter(server => server.includeInSave !== false);

  const getSelectedServerDetails = () => {
    const serverMap = new Map(importedServers.map(server => [getServerKey(server), server]));
    return Array.from(selectedServers)
      .map(key => serverMap.get(key))
      .filter((server): server is ServerConfig => Boolean(server));
  };

  const getVerificationTargets = () =>
    importedServers.filter(server => selectedServers.has(getServerKey(server)));

  // Step 1: Detect available clients
  useEffect(() => {
    if (step === 1) {
      detectClients();
    }
  }, [step]);

  // On mount: poll the Setup Wizard API /health until ready
  useEffect(() => {
    let isCancelled = false;
    const check = async () => {
      try {
        const res = await wizardApiService.healthCheck();
        if (!isCancelled && res && res.status === 'healthy') {
          setWizardReady(true);
          setCheckingWizard(false);
          return;
        }
      } catch {
        // keep checking
      }
      if (!isCancelled) {
        setWizardReady(false);
        setCheckingWizard(true);
      }
    };
    // immediate check, then poll
    check();
    const id = setInterval(check, 1000);
    return () => {
      isCancelled = true;
      clearInterval(id);
    };
  }, []);

  // Step 6: Load backup info for replace step
  useEffect(() => {
    if (step === 6) {
      loadBackupInfo();
    }
  }, [step]);

  const detectClients = async () => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const data = await wizardApiService.detectClients();

      if (data.success) {
        setAvailableClients(data.clients.sort());
        if (data.clients.length === 0) {
          setError('No MCP clients detected. Currently only Cursor, VSCode, Claude Code, or Claude Desktop are supported.');
          setSuccessMessage(null);
        }
      } else {
        setError(data.message);
        setSuccessMessage(null);
      }
    } catch (err) {
      setError('Failed to connect to Setup Wizard API server. Please ensure it is running.');
      setSuccessMessage(null);
    } finally {
      setLoading(false);
    }
  };

  const handleClientToggle = (client: string) => {
    setSelectedClients(prev =>
      prev.includes(client)
        ? prev.filter(c => c !== client)
        : [...prev, client]
    );
  };

  const isSameServer = (a: ServerConfig, b: ServerConfig) => {
    const clientA = a.client || 'unknown';
    const clientB = b.client || 'unknown';
    return clientA === clientB && a.name === b.name;
  };

  const handleServerToggle = (server: ServerConfig) => {
    setSelectedServers(prev => {
      const next = new Set(prev);
      const key = getServerKey(server);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleServerInclusion = (server: ServerConfig, include: boolean) => {
    setImportedServers(prev => prev.map(existing => {
      if (isSameServer(existing, server)) {
        return {
          ...existing,
          includeInSave: include
        };
      }
      return existing;
    }));
  };

  const goToStep = (targetStep: number) => {
    if (targetStep >= 0 && targetStep <= 5) {
      setStep(targetStep);
      setVisitedSteps(prev => new Set([...prev, targetStep]));
      setError(null);
      setSuccessMessage(null);
    }
  };

  const getPreviousVisitedStep = () => {
    const previousSteps = Array.from(visitedSteps).filter(s => s < step);
    return previousSteps.length > 0 ? Math.max(...previousSteps) : 0;
  };

  const getNextVisitedStep = () => {
    const nextSteps = Array.from(visitedSteps).filter(s => s > step);
    return nextSteps.length > 0 ? Math.min(...nextSteps) : Infinity;
  };

  const goToPreviousStep = () => {
    const previousStep = getPreviousVisitedStep();
    if (previousStep > 0) {
      goToStep(previousStep);
    }
  };

  const goToNextStep = () => {
    const nextStep = getNextVisitedStep();
    if (nextStep !== Infinity) {
      goToStep(nextStep);
    }
  };

  const proceedToImport = () => {
    if (selectedClients.length === 0) {
      setError('Please select at least one client to import from.');
      setSuccessMessage(null);
      return;
    }
    setVisitedSteps(prev => new Set([...prev, 2]));
    setStep(2);
    importServers();
  };

  const importServers = async () => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const data = await wizardApiService.importServers({
        clients: selectedClients,
        dry_run: dryRun,
        skip_oauth: skipOAuth,
      });

      if (data.success) {
        const newServers = data.servers.map(server => ({
          ...server,
          includeInSave: true
        }));

        setImportedServers(prev => {
          const existingByKey = new Map(prev.map(server => [getServerKey(server), server]));
          newServers.forEach(server => existingByKey.set(getServerKey(server), server));
          return Array.from(existingByKey.values());
        });

        setSelectedServers(prev => {
          const next = new Set(prev);
          newServers.forEach(server => next.add(getServerKey(server)));
          return next;
        });

        if (newServers.length === 0) {
          setError('No servers were imported from the selected clients.');
          setSuccessMessage(null);
        } else {
          setStep(3);
        }
      } else {
        setError(data.errors.length > 0 ? data.errors.join('; ') : data.message);
        setSuccessMessage(null);
      }
    } catch (err) {
      setError(`Failed to import servers. ${err instanceof Error ? err.message : 'Please try again.'}`);
      setSuccessMessage(null);
    } finally {
      setLoading(false);
    }
  };

  const proceedToVerification = () => {
    if (selectedServers.size === 0) {
      setError('Please select at least one server to import.');
      setSuccessMessage(null);
      return;
    }
    setStep(4);
    verifyServers();
  };

  const verifyServers = async () => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    // Initialize all servers as pending
    const initialResults: Record<string, 'pending' | 'success' | 'failed'> = {};
    getSelectedServerDetails().forEach(server => {
      const key = getServerKey(server);
      initialResults[key] = 'pending';
    });
    setVerificationResults(initialResults);

    try {
      const data = await wizardApiService.verifyServers({
        servers: getVerificationTargets(),
        timeout_seconds: verificationTimeout,
      });

      // Debug: Log the API response
      console.log('Verification API response:', data);
      console.log('data.success:', data.success);
      console.log('data.results:', data.results);
      console.log('data.message:', data.message);

      // Always update results based on individual server results, regardless of overall success
      const updatedResults: Record<string, 'pending' | 'success' | 'failed' | 'timeout'> = {};
      const updatedServers = importedServers.map(server => {
        const key = getServerKey(server);
        if (!selectedServers.has(key)) {
          return server;
        }

        const clientKey = `${server.client ?? 'unknown'}:${server.name}`;
        const serverResult = clientKey in data.results ? data.results[clientKey] : data.results[server.name];
        console.log(`Server ${server.name} result:`, serverResult, typeof serverResult);
        
        // Map string status to our state
        let status: 'success' | 'failed' | 'timeout' = 'failed';
        if (serverResult === 'success') {
          status = 'success';
        } else if (serverResult === 'timeout') {
          status = 'timeout';
        } else {
          status = 'failed';
        }
        
        updatedResults[key] = status;
        return {
          ...server,
          includeInSave: server.includeInSave ?? (status === 'success')
        };
      });

      setImportedServers(updatedServers);

      console.log('Final updatedResults:', updatedResults);
      setVerificationResults(updatedResults);

      // Check if any servers succeeded
      const successCount = Object.values(updatedResults).filter(status => status === 'success').length;
      const failureCount = Object.values(updatedResults).filter(status => status === 'failed').length;
      const timeoutCount = Object.values(updatedResults).filter(status => status === 'timeout').length;

      // Always show verification completed message
      const messageParts = [`${successCount} succeeded`];
      if (failureCount > 0) messageParts.push(`${failureCount} failed`);
      if (timeoutCount > 0) messageParts.push(`${timeoutCount} timed out`);
      setSuccessMessage(`Verification completed: ${messageParts.join(', ')}`);

      // Don't auto-advance - let user review and manually choose which servers to include
      setError(null);
    } catch (err) {
      // Mark all as failed on exception
      const failedResults: Record<string, 'pending' | 'success' | 'failed' | 'timeout'> = {};
      const updatedServers = importedServers.map(server => {
        const key = getServerKey(server);
        if (!selectedServers.has(key)) {
          return server;
        }

        failedResults[key] = 'failed';
        return {
          ...server,
          includeInSave: false
        };
      });
      setVerificationResults(failedResults);
      setImportedServers(updatedServers);
      setError('Failed to verify servers. Please check your connection.');
      setSuccessMessage(null);
    } finally {
      setLoading(false);
    }
  };

  const showPreviewData = () => {
    // Generate preview data from selected servers without API call
    const serversToSave = getServersToSave();

    if (serversToSave.length === 0) {
      setError('Select at least one server to include before viewing changes.');
      setSuccessMessage(null);
      return;
    }

    const previewData = {
      config: {
        server: {
          host: "localhost",
          port: 3000
        },
        mcp_servers: serversToSave.reduce((acc, server) => {
          acc[server.name] = {
            command: server.command,
            args: server.args,
            env: server.env,
            enabled: server.enabled,
            ...(server.roots && { roots: server.roots })
          };
          return acc;
        }, {} as Record<string, any>),
        logging: {
          level: "INFO"
        }
      }
    };

    setPreviewData(previewData);
    setShowPreview(true);
  };

  const saveConfiguration = async () => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    const serversToSave = getServersToSave();

    if (serversToSave.length === 0) {
      setLoading(false);
      setError('Select at least one verified server to save.');
      setSuccessMessage(null);
      return;
    }

    try {
      if (dryRun) {
        // In dry run mode, skip the actual save and just show success
        onImportComplete(serversToSave);
        onClose();
      } else {
      const data = await wizardApiService.saveServers({
        servers: serversToSave,
        dry_run: dryRun,
      });

        if (data.success) {
          // Move to replace step instead of completing
          setStep(6);
        } else {
          setError(data.message);
          setSuccessMessage(null);
        }
      }
    } catch (err) {
      setError('Failed to save configuration. Please try again.');
      setSuccessMessage(null);
    } finally {
      setLoading(false);
    }
  };

  const loadBackupInfo = async () => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const data = await wizardApiService.getBackupInfo();

      if (data.success) {
        setBackupInfo(data.backups);
        // Initialize replace clients with the clients that were originally selected for import
        setReplaceClients(selectedClients);
      } else {
        setError(data.message);
        setSuccessMessage(null);
      }
    } catch (err) {
      setError('Failed to load backup information. Please try again.');
      setSuccessMessage(null);
    } finally {
      setLoading(false);
    }
  };

  const handleReplaceClientToggle = (client: string) => {
    setReplaceClients(prev =>
      prev.includes(client)
        ? prev.filter(c => c !== client)
        : [...prev, client]
    );
  };

  const replaceMcpServers = async () => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      // Get list of server names that should be replaced (only those with includeInSave: true)
      // Servers with includeInSave: false will be retained in the target configuration
      const serversToReplace = getServersToSave();
      const selectedServerNames = serversToReplace
        .map(server => server.name)
        .filter((name): name is string => name !== undefined);

      const response = await wizardApiService.replaceMcpServers({
        clients: replaceClients,
        url: 'http://localhost:3000/mcp/',
        api_key: 'dev-api-key-change-me',
        server_name: 'open-edison',
        dry_run: dryRun,
        force: false,
        create_if_missing: true,
        selected_servers: selectedServerNames
      });

      if (response.success) {
        setReplaceResults(response.results);
        setError(null);
        if (dryRun) {
          setSuccessMessage('Dry run completed successfully. No changes were made.');
        } else {
          setSuccessMessage('MCP servers replaced successfully! Your original configurations have been backed up.');
        }
      } else {
        setError(response.message);
        setSuccessMessage(null);
      }
    } catch (err) {
      setError('Failed to replace MCP servers. Please try again.');
      setSuccessMessage(null);
    } finally {
      setLoading(false);
    }
  };

  const restoreMcpServers = async () => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await wizardApiService.restoreClients({
        clients: replaceClients,
        server_name: 'open-edison',
        dry_run: dryRun
      });

      if (response.success) {
        setError(null);
        if (dryRun) {
          setSuccessMessage('Dry run completed successfully. No changes were made.');
        } else {
          setSuccessMessage('MCP servers restored successfully!');
        }
      } else {
        setError(response.message);
        setSuccessMessage(null);
      }
    } catch (err) {
      setError('Failed to restore MCP servers. Please try again.');
      setSuccessMessage(null);
    } finally {
      setLoading(false);
    }
  };

  const handleWelcomeChoice = (choice: boolean) => {
    setAutoImport(choice);
    if (choice) {
      if (!wizardReady) {
        return;
      }
      // User wants to auto-import, proceed to step 1
      setVisitedSteps(prev => new Set([...prev, 1]));
      setStep(1);
      setError(null);
      setSuccessMessage(null);
      detectClients();
    } else {
      // User doesn't want to import, complete the wizard to start main application
      if (window.electronAPI && window.electronAPI.wizardCompleted) {
        window.electronAPI.wizardCompleted();
      }
      onClose();
    }
  };

  const renderWelcomeScreen = () => (
    <div style={{ textAlign: 'center' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ color: '#2c3e50', marginBottom: '1rem', fontSize: '1.5rem' }}>
          Welcome to Open Edison! 🎉
        </h2>
        <p style={{ color: '#7f8c8d', fontSize: '1.1rem', lineHeight: '1.6', marginBottom: '1.5rem' }}>
          We've detected that this is the first time you're running our tool.
          We'd like to help you set it up quickly and easily.
        </p>
        <p style={{ color: '#2c3e50', fontSize: '1rem', lineHeight: '1.5', marginBottom: '2rem' }}>
          Would you like to automatically import your MCP servers from other tools like Cursor, VSCode, Claude Desktop, or Claude Code?
        </p>
      </div>

      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={() => handleWelcomeChoice(true)}
          disabled={!wizardReady || checkingWizard}
          style={{
            background: '#27ae60',
            color: 'white',
            border: 'none',
            padding: '1rem 2rem',
            borderRadius: '8px',
            cursor: (!wizardReady || checkingWizard) ? 'not-allowed' : 'pointer',
            opacity: (!wizardReady || checkingWizard) ? 0.6 : 1,
            fontSize: '1rem',
            fontWeight: 'bold',
            minWidth: '200px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}
        >
          {checkingWizard && (
            <span style={{
              display: 'inline-block',
              width: '16px',
              height: '16px',
              border: '2px solid rgba(255,255,255,0.7)',
              borderTop: '2px solid transparent',
              borderRadius: '50%',
              marginRight: '8px',
              verticalAlign: 'middle',
              animation: 'spin 1s linear infinite'
            }} />
          )}
          {checkingWizard ? 'Starting…' : 'Yes, Import My Servers'}
        </button>
        <button
          onClick={() => handleWelcomeChoice(false)}
          style={{
            background: '#95a5a6',
            color: 'white',
            border: 'none',
            padding: '1rem 2rem',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '1rem',
            fontWeight: 'bold',
            minWidth: '200px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}
        >
          No, Skip for Now
        </button>
      </div>

      <p style={{
        color: '#7f8c8d',
        fontSize: '0.875rem',
        marginTop: '1.5rem',
        fontStyle: 'italic'
      }}>
        You can always import servers later from the settings menu.
      </p>
      {!wizardReady && (
        <p style={{ color: '#7f8c8d', fontSize: '0.9rem', marginTop: '0.5rem' }}>
          Preparing Setup Wizard API…
        </p>
      )}
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );

  const renderStep1 = () => (
    <div>
      <h3 style={{ marginBottom: '1rem', color: '#2c3e50' }}>Step 1: Detect MCP Clients</h3>
      {loading ? (
        <p>Detecting available MCP clients...</p>
      ) : (
        <div>
          {availableClients.length > 0 ? (
            <div>
              <p style={{ marginBottom: '1rem', color: '#7f8c8d' }}>
                Found {availableClients.length} MCP client(s). Select which ones to import from:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {availableClients.map(client => (
                  <label key={client} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={selectedClients.includes(client)}
                      onChange={() => handleClientToggle(client)}
                    />
                    <ClientLogo name={client} size={18} />
                    <span style={{ textTransform: 'capitalize' }}>{client}</span>
                  </label>
                ))}
              </div>
              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={dryRun}
                    onChange={(e) => setDryRun(e.target.checked)}
                  />
                  <span>Dry run (preview only)</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={skipOAuth}
                    onChange={(e) => setSkipOAuth(e.target.checked)}
                  />
                  <span>Skip OAuth (may exclude some servers)</span>
                </label>
              </div>
              <button
                onClick={proceedToImport}
                disabled={selectedClients.length === 0}
                style={{
                  background: '#3498db',
                  color: 'white',
                  border: 'none',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '6px',
                  cursor: selectedClients.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: selectedClients.length === 0 ? 0.5 : 1,
                  marginTop: '1rem'
                }}
              >
                Import from Selected Clients
              </button>
            </div>
          ) : (
            <p>No MCP clients detected. Please install and configure Cursor, VSCode, Claude Code, or Claude Desktop.</p>
          )}
        </div>
      )}
    </div>
  );

  const renderStep2 = () => (
    <div>
      <h3 style={{ marginBottom: '1rem', color: '#2c3e50' }}>Step 2: Importing Servers</h3>
      {loading ? (
        <p>Importing MCP servers from selected clients...</p>
      ) : (
        <div>
          {error ? (
            <div>
              <p style={{ color: '#e74c3c', marginBottom: '1rem' }}>{error}</p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  onClick={importServers}
                  style={{
                    background: '#e67e22',
                    color: 'white',
                    border: 'none',
                    padding: '0.75rem 1.5rem',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                >
                  Retry Import
                </button>
                <button
                  onClick={() => setStep(1)}
                  style={{
                    background: '#95a5a6',
                    color: 'white',
                    border: 'none',
                    padding: '0.75rem 1.5rem',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                >
                  Back to Client Selection
                </button>
              </div>
            </div>
          ) : importedServers.length === 0 ? (
            <div>
              <p>No servers were imported from the selected clients.</p>
              <button
                onClick={() => setStep(1)}
                style={{
                  background: '#3498db',
                  color: 'white',
                  border: 'none',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  marginTop: '1rem'
                }}
              >
                Choose Different Clients
              </button>
            </div>
          ) : (
            <div>
              <p>Import completed! Found {importedServers.length} server(s).</p>
              <button
                onClick={() => setStep(3)}
                style={{
                  background: '#3498db',
                  color: 'white',
                  border: 'none',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  marginTop: '1rem'
                }}
              >
                Continue to Server Selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderStep3 = () => {
    // Group servers by client
    const renderClientSection = (client: string) => {
      const clientServers = importedServers.filter(server => server.client === client);

      // If no servers found for this client, show a message
      if (clientServers.length === 0) {
        return (
          <div key={client} style={{ marginBottom: '1rem' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem',
              backgroundColor: '#ecf0f1',
              border: '1px solid #bdc3c7',
              borderRadius: '6px',
              fontWeight: 'bold',
              color: '#2c3e50'
            }}>
              <span style={{ textTransform: 'capitalize' }}>{client}</span>
              <span style={{ fontSize: '0.875rem', color: '#7f8c8d', marginLeft: 'auto' }}>
                No servers found
              </span>
            </div>
          </div>
        );
      }
      const isExpanded = true; // Always expanded for now

      return (
        <div key={client} style={{ marginBottom: '1rem' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.75rem',
            backgroundColor: '#ecf0f1',
            border: '1px solid #bdc3c7',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 'bold',
            color: '#2c3e50'
          }}>
            <span style={{ fontSize: '1.2rem' }}>{isExpanded ? '▼' : '▶'}</span>
            <span style={{ textTransform: 'capitalize' }}>{client}</span>
            <span style={{ fontSize: '0.875rem', color: '#7f8c8d', marginLeft: 'auto' }}>
              {clientServers.length} server{clientServers.length !== 1 ? 's' : ''}
            </span>
          </div>

          {isExpanded && (
            <div
              style={{
                marginTop: '0.5rem',
                paddingLeft: '1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem'
              }}
            >
              {clientServers.map(server => {
                const serverKey = getServerKey(server);
                const isSelected = selectedServers.has(serverKey);
                const isDuplicate = server.potential_duplicate === true;
                return (
                  <label
                    key={serverKey}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.5rem',
                      border: '1px solid #bdc3c7',
                      borderRadius: '4px',
                      backgroundColor: isDuplicate ? '#fff6d1' : isSelected ? '#e8f4fc' : 'transparent',
                      boxShadow: isSelected ? 'inset 0 0 0 1px #3498db' : 'none'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleServerToggle(server)}
                      style={{ cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 'bold', color: '#2c3e50' }}>{server.name}</div>
                      <div style={{ fontSize: '0.875rem', color: '#7f8c8d' }}>
                        {server.command} {server.args.join(' ')}
                      </div>
                      {server.roots && server.roots.length > 0 && (
                        <div style={{ fontSize: '0.75rem', color: '#95a5a6' }}>
                          Roots: {server.roots.join(', ')}
                        </div>
                      )}
                      {isDuplicate && (
                        <div style={{ fontSize: '0.75rem', color: '#f39c12', marginTop: '0.25rem' }}>
                          Possible duplicate{server.duplicate_reason ? `: ${server.duplicate_reason}` : ''}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      );
    };

    return (
      <div>
        <h3 style={{ marginBottom: '1rem', color: '#2c3e50' }}>Step 3: Select Servers</h3>
        <p style={{ marginBottom: '1rem', color: '#7f8c8d' }}>
          Select which servers to import to Open Edison:
        </p>
        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
          {selectedClients.map(client => renderClientSection(client))}
        </div>
        <div style={{ marginTop: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <label htmlFor="verification-timeout" style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#2c3e50', whiteSpace: 'nowrap' }}>
            Timeout:
          </label>
          <select
            id="verification-timeout"
            value={verificationTimeout === null ? 'none' : verificationTimeout}
            onChange={(e) => {
              const value = e.target.value;
              setVerificationTimeout(value === 'none' ? null : parseInt(value, 10));
            }}
            style={{
              padding: '0.4rem 0.6rem',
              borderRadius: '4px',
              border: '1px solid #bdc3c7',
              backgroundColor: 'white',
              cursor: 'pointer',
              fontSize: '0.875rem',
              minWidth: '130px'
            }}
          >
            <option value="none">No timeout</option>
            <option value="5">5 seconds</option>
            <option value="10">10 seconds</option>
            <option value="30">30 seconds</option>
            <option value="60">60 seconds</option>
          </select>
          <span style={{ fontSize: '0.75rem', color: '#7f8c8d', fontStyle: 'italic' }}>
            Servers can be imported even if they fail or timeout.
          </span>
        </div>
        <button
          onClick={proceedToVerification}
          disabled={selectedServers.size === 0}
          style={{
            background: '#3498db',
            color: 'white',
            border: 'none',
            padding: '0.75rem 1.5rem',
            borderRadius: '6px',
            cursor: selectedServers.size === 0 ? 'not-allowed' : 'pointer',
            opacity: selectedServers.size === 0 ? 0.5 : 1,
            marginTop: '1rem'
          }}
        >
          Verify Selected Servers ({selectedServers.size})
        </button>
      </div>
    );
  };

  const renderStep4 = () => {
    const getStatusColor = (status: 'pending' | 'success' | 'failed' | 'timeout') => {
      switch (status) {
        case 'pending':
          return '#f39c12'; // Orange
        case 'success':
          return '#27ae60'; // Green
        case 'failed':
          return '#e74c3c'; // Red
        case 'timeout':
          return '#e67e22'; // Dark orange
        default:
          return '#7f8c8d'; // Gray
      }
    };

    const getStatusText = (status: 'pending' | 'success' | 'failed' | 'timeout') => {
      switch (status) {
        case 'pending':
          return 'In progress';
        case 'success':
          return 'Success';
        case 'failed':
          return 'Failed';
        case 'timeout':
          return 'Timeout';
        default:
          return 'Unknown';
      }
    };

    return (
      <div>
        <h3 style={{ marginBottom: '1rem', color: '#2c3e50' }}>Step 4: Verifying Servers</h3>
        {loading ? (
          <div>
            <p style={{ marginBottom: '1rem', color: '#7f8c8d' }}>Verifying server configurations...</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {getSelectedServerDetails().map(server => {
                const key = getServerKey(server);
                const status = verificationResults[key] || 'pending';
                const client = server.client || 'Unknown';
                const isDuplicate = server.potential_duplicate === true;
                return (
                  <div key={key} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.75rem',
                    border: '1px solid #bdc3c7',
                    borderRadius: '4px',
                    backgroundColor: isDuplicate ? '#fff6d1' : '#f8f9fa'
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 'bold', color: '#2c3e50' }}>
                        {client}: {server.name}
                      </div>
                      <div style={{
                        fontSize: '0.875rem',
                        color: getStatusColor(status),
                        fontWeight: 'bold'
                      }}>
                        Status: {getStatusText(status)}
                      </div>
                      {isDuplicate && (
                        <div style={{ fontSize: '0.75rem', color: '#f39c12', marginTop: '0.25rem' }}>
                          Possible duplicate{server.duplicate_reason ? `: ${server.duplicate_reason}` : ''}
                        </div>
                      )}
                    </div>
                    {status === 'pending' && (
                      <div style={{
                        width: '20px',
                        height: '20px',
                        border: '2px solid #f39c12',
                        borderTop: '2px solid transparent',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite'
                      }} />
                    )}
                    {status === 'success' && (
                      <div style={{ color: '#27ae60', fontSize: '1.2rem' }}>✓</div>
                    )}
                    {status === 'failed' && (
                      <div style={{ color: '#e74c3c', fontSize: '1.2rem' }}>✗</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div>
            <p style={{ marginBottom: '1rem', color: '#7f8c8d' }}>Server verification completed!</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
              {getSelectedServerDetails().map(server => {
                const key = getServerKey(server);
                const status = verificationResults[key] || 'failed';
                const client = server.client || 'Unknown';
                const isDuplicate = server.potential_duplicate === true;
                return (
                  <div key={key} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.75rem',
                    border: '1px solid #bdc3c7',
                    borderRadius: '4px',
                    backgroundColor: isDuplicate ? '#fff6d1' : (status === 'success' ? '#d5f4e6' : '#fadbd8')
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 'bold', color: '#2c3e50' }}>
                        Tool: {client} | Server: {server.name}
                      </div>
                      <div style={{
                        fontSize: '0.875rem',
                        color: getStatusColor(status),
                        fontWeight: 'bold'
                      }}>
                        Status: {getStatusText(status)}
                      </div>
                      {status === 'failed' && (
                        <div style={{
                          fontSize: '0.75rem',
                          color: '#7f8c8d',
                          marginTop: '0.25rem'
                        }}>
                          Command: {server.command} {server.args.join(' ')}
                        </div>
                      )}
                      {isDuplicate && (
                        <div style={{
                          fontSize: '0.75rem',
                          color: '#b9770e',
                          marginTop: '0.25rem'
                        }}>
                          Possible duplicate{server.duplicate_reason ? `: ${server.duplicate_reason}` : ''}
                        </div>
                      )}
                    </div>
                    <div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: status === 'success' ? '#27ae60' : '#e74c3c' }}>
                        <input
                          type="checkbox"
                          checked={server.includeInSave !== false}
                          onChange={(e) => toggleServerInclusion(server, e.target.checked)}
                        />
                        <span>{status === 'success' ? 'Include in save' : 'Include failed server'}</span>
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => setStep(5)}
              style={{
                background: '#3498db',
                color: 'white',
                border: 'none',
                padding: '0.75rem 1.5rem',
                borderRadius: '6px',
                cursor: 'pointer',
                marginTop: '1rem'
              }}
            >
              Continue to Save Configuration
            </button>
          </div>
        )}
        <style>
          {`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}
        </style>
      </div>
    );
  };

  const renderStep5 = () => (
    <div>
      <h3 style={{ marginBottom: '1rem', color: '#2c3e50' }}>Step 5: Save Configuration</h3>
      <p style={{ marginBottom: '1rem', color: '#7f8c8d' }}>
        Ready to save {getServersToSave().length} server(s) to your Open Edison configuration.
      </p>
      {dryRun && (
        <div style={{
          background: '#fff3cd',
          border: '1px solid #ffeaa7',
          borderRadius: '4px',
          padding: '0.75rem',
          marginBottom: '1rem',
          color: '#856404'
        }}>
          <strong>Dry Run Mode:</strong> No changes will be saved to your configuration.
        </div>
      )}

      {/* Preview Section */}
      {showPreview && previewData && (
        <div style={{
          marginBottom: '1rem',
          border: '1px solid #bdc3c7',
          borderRadius: '8px',
          overflow: 'hidden'
        }}>
          <div style={{
            background: '#f8f9fa',
            padding: '1rem',
            borderBottom: '1px solid #bdc3c7',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <h4 style={{ margin: 0, color: '#2c3e50' }}>Configuration Preview</h4>
            <button
              onClick={() => setShowPreview(false)}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '1.5rem',
                cursor: 'pointer',
                color: '#7f8c8d'
              }}
            >
              ×
            </button>
          </div>

          {/* Preview Content */}
          <div style={{
            padding: '1rem',
            maxHeight: '400px',
            overflowY: 'auto',
            background: '#f8f9fa'
          }}>
            <pre style={{
              margin: 0,
              fontSize: '0.875rem',
              lineHeight: '1.4',
              color: '#2c3e50',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}>
              {(() => {
                if (!previewData) return 'No preview data available';
                return JSON.stringify(previewData.config, null, 2);
              })()}
            </pre>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem' }}>
        <button
          onClick={showPreviewData}
          disabled={getServersToSave().length === 0}
          style={{
            background: '#3498db',
            color: 'white',
            border: 'none',
            padding: '0.75rem 1.5rem',
            borderRadius: '6px',
            cursor: getServersToSave().length === 0 ? 'not-allowed' : 'pointer',
            opacity: getServersToSave().length === 0 ? 0.5 : 1
          }}
        >
          View Changes
        </button>
        <button
          onClick={saveConfiguration}
          disabled={loading || getServersToSave().length === 0}
          style={{
            background: '#27ae60',
            color: 'white',
            border: 'none',
            padding: '0.75rem 1.5rem',
            borderRadius: '6px',
            cursor: (loading || getServersToSave().length === 0) ? 'not-allowed' : 'pointer',
            opacity: (loading || getServersToSave().length === 0) ? 0.5 : 1
          }}
        >
          {loading ? 'Saving...' : 'Save Configuration'}
        </button>
        <button
          onClick={() => setStep(3)}
          style={{
            background: '#95a5a6',
            color: 'white',
            border: 'none',
            padding: '0.75rem 1.5rem',
            borderRadius: '6px',
            cursor: 'pointer'
          }}
        >
          Back to Selection
        </button>
      </div>
    </div>
  );

  const renderStep6 = () => (
    <div>
      <h3 style={{ marginBottom: '1rem', color: '#2c3e50' }}>Step 6: Replace MCP Servers</h3>
      <p style={{ marginBottom: '1rem', color: '#7f8c8d' }}>
        Replace your existing MCP server configurations with Open Edison. Your original configurations will be backed up automatically.
      </p>
      <p style={{ marginBottom: '1rem', color: '#7f8c8d', fontSize: '0.875rem' }}>
        <strong>Note:</strong> Only the clients you originally selected for import are shown below.
      </p>

      {dryRun && (
        <div style={{
          background: '#fff3cd',
          border: '1px solid #ffeaa7',
          borderRadius: '4px',
          padding: '0.75rem',
          marginBottom: '1rem',
          color: '#856404'
        }}>
          <strong>Dry Run Mode:</strong> No changes will be made to your MCP configurations.
        </div>
      )}

      {loading ? (
        <p>Loading backup information...</p>
      ) : (
        <div>
          <p style={{ marginBottom: '1rem', color: '#7f8c8d' }}>
            Select which MCP clients to replace with Open Edison:
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
            {selectedClients.map(client => (
              <label key={client} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', border: '1px solid #bdc3c7', borderRadius: '4px' }}>
                <input
                  type="checkbox"
                  checked={replaceClients.includes(client)}
                  onChange={() => handleReplaceClientToggle(client)}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 'bold', textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <ClientLogo name={client} size={18} />
                    {client}
                  </div>
                  {backupInfo && backupInfo[client] && (
                    <div style={{ fontSize: '0.875rem', color: '#7f8c8d' }}>
                      {backupInfo[client].has_backup ? (
                        <span style={{ color: '#27ae60' }}>✓ Has backup available</span>
                      ) : (
                        <span style={{ color: '#e74c3c' }}>⚠ No existing backup</span>
                      )}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>

          {replaceResults && (
            <div style={{
              marginBottom: '1rem',
              border: '1px solid #bdc3c7',
              borderRadius: '8px',
              overflow: 'hidden'
            }}>
              <div style={{
                background: '#f8f9fa',
                padding: '1rem',
                borderBottom: '1px solid #bdc3c7',
                fontWeight: 'bold'
              }}>
                Replace Results
              </div>
              <div style={{ padding: '1rem' }}>
                {Object.entries(replaceResults).map(([client, result]: [string, any]) => (
                  <div key={client} style={{ marginBottom: '0.5rem', padding: '0.5rem', background: '#f8f9fa', borderRadius: '4px' }}>
                    <div style={{ fontWeight: 'bold', textTransform: 'capitalize' }}>{client}</div>
                    <div style={{ fontSize: '0.875rem', color: result.success ? '#27ae60' : '#e74c3c' }}>
                      {result.success ? '✓ Successfully replaced' : '✗ Failed to replace'}
                    </div>
                    {result.backup_path && (
                      <div style={{ fontSize: '0.75rem', color: '#7f8c8d' }}>
                        Backup: {result.backup_path}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <button
              onClick={replaceMcpServers}
              disabled={loading || replaceClients.length === 0}
              style={{
                background: '#e74c3c',
                color: 'white',
                border: 'none',
                padding: '0.75rem 1.5rem',
                borderRadius: '6px',
                cursor: (loading || replaceClients.length === 0) ? 'not-allowed' : 'pointer',
                opacity: (loading || replaceClients.length === 0) ? 0.5 : 1
              }}
            >
              {loading ? 'Replacing...' : `Replace MCP Servers (${replaceClients.length})`}
            </button>

            <button
              onClick={restoreMcpServers}
              disabled={loading || replaceClients.length === 0}
              style={{
                background: '#3498db',
                color: 'white',
                border: 'none',
                padding: '0.75rem 1.5rem',
                borderRadius: '6px',
                cursor: (loading || replaceClients.length === 0) ? 'not-allowed' : 'pointer',
                opacity: (loading || replaceClients.length === 0) ? 0.5 : 1
              }}
            >
              {loading ? 'Restoring...' : `Restore Original Configs (${replaceClients.length})`}
            </button>

            <button
              onClick={() => {
                const serversToSave = getServersToSave();
                onImportComplete(serversToSave);
                onClose();
              }}
              style={{
                background: '#27ae60',
                color: 'white',
                border: 'none',
                padding: '0.75rem 1.5rem',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              Complete Setup
            </button>

            <button
              onClick={() => setStep(5)}
              style={{
                background: '#95a5a6',
                color: 'white',
                border: 'none',
                padding: '0.75rem 1.5rem',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              Back to Save
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
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
        maxWidth: '600px',
        width: '90%',
        maxHeight: '80vh',
        overflowY: 'auto',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)',
        position: 'relative'
      }}>
        {/* Close button */}
        <button
          onClick={onClose}
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
            borderRadius: '4px'
          }}
        >
          ×
        </button>

        {/* Progress indicator */}
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ color: '#2c3e50', marginBottom: '0.5rem' }}>MCP Import Wizard</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            {/* Previous arrow */}
            <button
              onClick={goToPreviousStep}
              disabled={getPreviousVisitedStep() <= 0}
              style={{
                background: getPreviousVisitedStep() <= 0 ? '#bdc3c7' : '#3498db',
                color: 'white',
                border: 'none',
                borderRadius: '50%',
                width: '30px',
                height: '30px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: getPreviousVisitedStep() <= 0 ? 'not-allowed' : 'pointer',
                fontSize: '1rem',
                fontWeight: 'bold'
              }}
            >
              ‹
            </button>

            {/* Step circles */}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {[0, 1, 2, 3, 4, 5, 6].map(stepNum => (
                <button
                  key={stepNum}
                  onClick={() => visitedSteps.has(stepNum) ? goToStep(stepNum) : undefined}
                  disabled={!visitedSteps.has(stepNum)}
                  style={{
                    width: '30px',
                    height: '30px',
                    borderRadius: '50%',
                    background: stepNum <= step ? '#3498db' : '#bdc3c7',
                    color: 'white',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.875rem',
                    fontWeight: 'bold',
                    cursor: visitedSteps.has(stepNum) ? 'pointer' : 'not-allowed',
                    opacity: visitedSteps.has(stepNum) ? 1 : 0.5
                  }}
                >
                  {stepNum === 0 ? 'W' : stepNum}
                </button>
              ))}
            </div>

            {/* Next arrow */}
            <button
              onClick={goToNextStep}
              disabled={getNextVisitedStep() === Infinity}
              style={{
                background: getNextVisitedStep() === Infinity ? '#bdc3c7' : '#3498db',
                color: 'white',
                border: 'none',
                borderRadius: '50%',
                width: '30px',
                height: '30px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: getNextVisitedStep() === Infinity ? 'not-allowed' : 'pointer',
                fontSize: '1rem',
                fontWeight: 'bold'
              }}
            >
              ›
            </button>
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div style={{
            background: '#fadbd8',
            border: '1px solid #e74c3c',
            borderRadius: '4px',
            padding: '0.75rem',
            marginBottom: '1rem',
            color: '#c0392b'
          }}>
            {error}
          </div>
        )}

        {/* Success message display */}
        {successMessage && (
          <div style={{
            background: '#d5f4e6',
            border: '1px solid #27ae60',
            borderRadius: '4px',
            padding: '0.75rem',
            marginBottom: '1rem',
            color: '#27ae60'
          }}>
            {successMessage}
          </div>
        )}

        {/* Step content */}
        {step === 0 && renderWelcomeScreen()}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
        {step === 5 && renderStep5()}
        {step === 6 && renderStep6()}
      </div>
    </div>
  );
};

export default McpImportWizard;
