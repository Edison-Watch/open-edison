import { contextBridge, ipcRenderer } from 'electron'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),
  restartBackend: () => ipcRenderer.invoke('restart-backend'),
  
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
      platform: string
      appVersion: string
    }
  }
}
