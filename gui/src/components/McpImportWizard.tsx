import React, { useState, useEffect } from 'react';
import wizardApiService from '../services/wizardApi';

interface ServerConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  roots?: string[];
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
  const [step, setStep] = useState(1);
  const [visitedSteps, setVisitedSteps] = useState<Set<number>>(new Set([1]));
  const [availableClients, setAvailableClients] = useState<string[]>([]);
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [importedServers, setImportedServers] = useState<ServerConfig[]>([]);
  const [selectedServers, setSelectedServers] = useState<ServerConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [skipOAuth, setSkipOAuth] = useState(false);

  // Step 1: Detect available clients
  useEffect(() => {
    if (step === 1) {
      detectClients();
    }
  }, [step]);

  const detectClients = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const data = await wizardApiService.detectClients();
      
      if (data.success) {
        setAvailableClients(data.clients);
        if (data.clients.length === 0) {
          setError('No MCP clients detected. Please install Cursor, VSCode, Claude Code, or Claude Desktop.');
        }
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError('Failed to connect to Setup Wizard API server. Please ensure it is running.');
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

  const handleServerToggle = (server: ServerConfig) => {
    setSelectedServers(prev => 
      prev.includes(server) 
        ? prev.filter(s => s.name !== server.name)
        : [...prev, server]
    );
  };

  const goToStep = (targetStep: number) => {
    if (targetStep >= 1 && targetStep <= 5) {
      setStep(targetStep);
      setVisitedSteps(prev => new Set([...prev, targetStep]));
      setError(null);
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
      return;
    }
    setVisitedSteps(prev => new Set([...prev, 2]));
    setStep(2);
    importServers();
  };

  const importServers = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const data = await wizardApiService.importServers({
        clients: selectedClients,
        dry_run: dryRun,
        skip_oauth: skipOAuth,
      });
      
      if (data.success) {
        setImportedServers(data.servers);
        setSelectedServers(data.servers); // Select all by default
        setStep(3);
      } else {
        setError(data.message);
        if (data.errors.length > 0) {
          setError(data.errors.join('; '));
        }
      }
    } catch (err) {
      setError('Failed to import servers. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const proceedToVerification = () => {
    if (selectedServers.length === 0) {
      setError('Please select at least one server to import.');
      return;
    }
    setStep(4);
    verifyServers();
  };

  const verifyServers = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const data = await wizardApiService.verifyServers({
        servers: selectedServers,
      });
      
      if (data.success) {
        setStep(5);
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError('Failed to verify servers. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const saveConfiguration = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const data = await wizardApiService.saveServers({
        servers: selectedServers,
        dry_run: dryRun,
      });
      
      if (data.success) {
        onImportComplete(selectedServers);
        onClose();
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError('Failed to save configuration. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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
  );

  const renderStep3 = () => (
    <div>
      <h3 style={{ marginBottom: '1rem', color: '#2c3e50' }}>Step 3: Select Servers</h3>
      <p style={{ marginBottom: '1rem', color: '#7f8c8d' }}>
        Select which servers to import to Open Edison:
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '300px', overflowY: 'auto' }}>
        {importedServers.map(server => (
          <label key={server.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', border: '1px solid #bdc3c7', borderRadius: '4px' }}>
            <input
              type="checkbox"
              checked={selectedServers.includes(server)}
              onChange={() => handleServerToggle(server)}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 'bold' }}>{server.name}</div>
              <div style={{ fontSize: '0.875rem', color: '#7f8c8d' }}>
                {server.command} {server.args.join(' ')}
              </div>
              {server.roots && server.roots.length > 0 && (
                <div style={{ fontSize: '0.75rem', color: '#95a5a6' }}>
                  Roots: {server.roots.join(', ')}
                </div>
              )}
            </div>
          </label>
        ))}
      </div>
      <button
        onClick={proceedToVerification}
        disabled={selectedServers.length === 0}
        style={{
          background: '#3498db',
          color: 'white',
          border: 'none',
          padding: '0.75rem 1.5rem',
          borderRadius: '6px',
          cursor: selectedServers.length === 0 ? 'not-allowed' : 'pointer',
          opacity: selectedServers.length === 0 ? 0.5 : 1,
          marginTop: '1rem'
        }}
      >
        Verify Selected Servers ({selectedServers.length})
      </button>
    </div>
  );

  const renderStep4 = () => (
    <div>
      <h3 style={{ marginBottom: '1rem', color: '#2c3e50' }}>Step 4: Verifying Servers</h3>
      {loading ? (
        <p>Verifying server configurations...</p>
      ) : (
        <div>
          <p>Server verification completed!</p>
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
    </div>
  );

  const renderStep5 = () => (
    <div>
      <h3 style={{ marginBottom: '1rem', color: '#2c3e50' }}>Step 5: Save Configuration</h3>
      <p style={{ marginBottom: '1rem', color: '#7f8c8d' }}>
        Ready to save {selectedServers.length} server(s) to your Open Edison configuration.
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
      <div style={{ display: 'flex', gap: '1rem' }}>
        <button
          onClick={saveConfiguration}
          disabled={loading}
          style={{
            background: '#27ae60',
            color: 'white',
            border: 'none',
            padding: '0.75rem 1.5rem',
            borderRadius: '6px',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.5 : 1
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
              {[1, 2, 3, 4, 5].map(stepNum => (
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
                  {stepNum}
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

        {/* Step content */}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
        {step === 5 && renderStep5()}
      </div>
    </div>
  );
};

export default McpImportWizard;
