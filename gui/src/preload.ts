import { contextBridge, ipcRenderer } from 'electron'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),
  restartBackend: () => ipcRenderer.invoke('restart-backend'),
  
  // Backend log listener
  onBackendLog: (callback: (log: { type: string; message: string }) => void) => {
    ipcRenderer.on('backend-log', (event, log) => callback(log))
  },
  
  // Remove backend log listener
  removeBackendLogListener: () => {
    ipcRenderer.removeAllListeners('backend-log')
  },
  
  // Setup Wizard API methods
  getSetupWizardApiStatus: () => ipcRenderer.invoke('get-setup-wizard-api-status'),
  restartSetupWizardApi: () => ipcRenderer.invoke('restart-setup-wizard-api'),
  
  // Wizard window methods
  openWizardWindow: () => ipcRenderer.invoke('open-wizard-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  wizardCompleted: () => ipcRenderer.invoke('wizard-completed'),
  
  // Setup Wizard API log listener
  onSetupWizardApiLog: (callback: (log: { type: string; message: string }) => void) => {
    ipcRenderer.on('setup-wizard-api-log', (event, log) => callback(log))
  },
  
  // Remove Setup Wizard API log listener
  removeSetupWizardApiLogListener: () => {
    ipcRenderer.removeAllListeners('setup-wizard-api-log')
  },
  
  // Application support folder methods
  getApplicationSupportPath: () => ipcRenderer.invoke('get-application-support-path'),
  checkPathExists: (path: string) => ipcRenderer.invoke('check-path-exists', path),
  getInstallationStatus: () => ipcRenderer.invoke('get-installation-status'),
  
  // Server configuration methods
  getServerConfig: () => ipcRenderer.invoke('get-server-config'),
  
  // Platform info
  platform: process.platform,
  
  // App info
  appVersion: process.env.npm_package_version || '1.0.0'
})

// Type definitions for the exposed API
declare global {
  interface Window {
    electronAPI: {
      getBackendStatus: () => Promise<{ running: boolean; port: number }>
      restartBackend: () => Promise<boolean>
      onBackendLog: (callback: (log: { type: string; message: string }) => void) => void
      removeBackendLogListener: () => void
      getApplicationSupportPath: () => Promise<string>
      checkPathExists: (path: string) => Promise<boolean>
      getInstallationStatus: () => Promise<boolean>
      getServerConfig: () => Promise<{ host: string; port: number; api_key?: string }>
      getSetupWizardApiStatus: () => Promise<{ running: boolean; port: number }>
      restartSetupWizardApi: () => Promise<boolean>
      onSetupWizardApiLog: (callback: (log: { type: string; message: string }) => void) => void
      removeSetupWizardApiLogListener: () => void
      openWizardWindow: () => Promise<{ success: boolean; error?: string }>
      closeWindow: () => Promise<{ success: boolean }>
      wizardCompleted: () => Promise<{ success: boolean }>
      platform: string
      appVersion: string
    }
  }
}
