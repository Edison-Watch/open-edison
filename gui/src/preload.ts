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
  onWizardClosed: (callback: () => void) => {
    ipcRenderer.on('wizard-closed', () => callback())
  },
  reinitializeMcp: () => ipcRenderer.invoke('reinitialize-mcp'),

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

  // Ngrok settings persistence
  getNgrokSettings: () => ipcRenderer.invoke('get-ngrok-settings'),
  saveNgrokSettings: (settings: { authToken?: string; domain?: string; url?: string }) =>
    ipcRenderer.invoke('save-ngrok-settings', settings),

  // Process management methods
  spawnProcess: (command: string, args: string[], env: any) => ipcRenderer.invoke('spawn-process', command, args, env),
  terminateProcess: (processId: any) => ipcRenderer.invoke('terminate-process', processId),
  composeHelpEmail: (subject: string, body: string, attachLogs?: boolean, logsText?: string) =>
    ipcRenderer.invoke('compose-help-email', { subject, body, attachLogs, logsText }),

  // Ngrok URL listener
  onNgrokUrl: (callback: (url: string) => void) => {
    ipcRenderer.on('ngrok-url', (event, url) => callback(url))
  },

  // Process error listeners
  onProcessError: (callback: (data: { processId: any; error: string }) => void) => {
    ipcRenderer.on('process-error', (event, data) => callback(data))
  },

  onProcessExitError: (callback: (data: { processId: any; code: number }) => void) => {
    ipcRenderer.on('process-exit-error', (event, data) => callback(data))
  },

  // Remove process error listeners
  removeProcessErrorListener: () => {
    ipcRenderer.removeAllListeners('process-error')
  },

  removeProcessExitErrorListener: () => {
    ipcRenderer.removeAllListeners('process-exit-error')
  },

  // Platform info
  platform: process.platform,

  // App info
  appVersion: process.env.npm_package_version || '1.0.0'
  ,
  // Removed guiMode exposure; devtools now accessible via menu/shortcut
  // Dashboard View controls
  showDashboard: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke('dashboard-create-or-show', bounds),
  setDashboardBounds: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke('dashboard-set-bounds', bounds),
  hideDashboard: () => ipcRenderer.invoke('dashboard-hide'),
  refreshDashboard: () => ipcRenderer.invoke('dashboard-refresh'),
  openDashboardDevTools: () => ipcRenderer.invoke('dashboard-open-devtools')
  ,
  // Theme events
  onThemeChanged: (callback: (payload: { mode: 'light' | 'dark' | 'system'; effective: 'light' | 'dark' }) => void) => {
    ipcRenderer.on('theme-changed', (_event, payload) => callback(payload))
  },
  getTheme: () => ipcRenderer.invoke('theme-get')
  ,
  // Updates
  checkForUpdates: () => ipcRenderer.invoke('updates-check'),
  installUpdates: () => ipcRenderer.invoke('updates-install'),
  onUpdateStatus: (callback: (status: string, info?: any) => void) => {
    ipcRenderer.on('update-status', (_e, status, info) => callback(status, info))
  },
  onUpdateProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on('update-progress', (_e, progress) => callback(progress))
  }
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
      onWizardClosed: (callback: () => void) => void
      reinitializeMcp: () => Promise<{ ok: boolean; status?: number; error?: string }>
      spawnProcess: (command: string, args: string[], env: any) => Promise<any>
      terminateProcess: (processId: any) => Promise<void>
      composeHelpEmail: (subject: string, body: string, attachLogs?: boolean, logsText?: string) => Promise<{ success: boolean; attachmentPath?: string; error?: string }>
      onNgrokUrl: (callback: (url: string) => void) => void
      getNgrokSettings: () => Promise<{ authToken: string; domain: string; url: string }>
      saveNgrokSettings: (settings: { authToken?: string; domain?: string; url?: string }) => Promise<{ success: boolean; error?: string }>
      onProcessError: (callback: (data: { processId: any; error: string }) => void) => void
      onProcessExitError: (callback: (data: { processId: any; code: number }) => void) => void
      removeProcessErrorListener: () => void
      removeProcessExitErrorListener: () => void
      platform: string
      appVersion: string

      showDashboard: (bounds: { x: number; y: number; width: number; height: number }) => Promise<{ success: boolean; error?: string }>
      setDashboardBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<{ success: boolean }>
      hideDashboard: () => Promise<{ success: boolean }>
      refreshDashboard: () => Promise<{ success: boolean; error?: string }>
      openDashboardDevTools: () => Promise<{ success: boolean; error?: string }>
      onThemeChanged: (callback: (payload: { mode: 'light' | 'dark' | 'system'; effective: 'light' | 'dark' }) => void) => void
      getTheme: () => Promise<{ mode: 'light' | 'dark' | 'system'; effective: 'light' | 'dark' }>
      checkForUpdates: () => Promise<{ ok: boolean; result?: any; error?: string }>
      installUpdates: () => Promise<{ ok: boolean; error?: string }>
      onUpdateStatus: (callback: (status: string, info?: any) => void) => void
      onUpdateProgress: (callback: (progress: any) => void) => void
    }
  }
}
