import { contextBridge, ipcRenderer } from 'electron'

// Expose a minimal API for the embedded dashboard to show system notifications
contextBridge.exposeInMainWorld('electronAPI', {
    showSystemNotification: (payload: {
        sessionId: string
        kind: 'tool' | 'resource' | 'prompt'
        name: string
        reason?: string
        title: string
        body: string
    }) => ipcRenderer.invoke('show-system-notification', payload),

    onNotificationActionCompleted: (callback: (data: { sessionId: string; kind: string; name: string; action: string }) => void) => {
        ipcRenderer.on('notification-action-completed', (_event, data) => callback(data))
    }
})

// Mark that we're in Electron embed mode
contextBridge.exposeInMainWorld('__ELECTRON_EMBED__', true)
