import { app, BrowserWindow, shell, ipcMain, protocol, session, Menu, dialog, Tray, nativeImage } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'

// Keep a global reference of the window object
let mainWindow: BrowserWindow | null = null
let wizardWindow: BrowserWindow | null = null
let backendProcess: ChildProcess | null = null
let frontendProcess: ChildProcess | null = null
let reactProcess: ChildProcess | null = null
let setupWizardApiProcess: ChildProcess | null = null
let isBackendRunning = false
let isSetupWizardApiRunning = false
let dashboardView: any = null
const SIDEBAR_WIDTH_DIP = 80
const PAGE_HEADER_HEIGHT_DIP = 66
let tray: Tray | null = null
let ngrokProcessCount = 0
let isNgrokRunning = false

// Removed GUI mode injection; DevTools are accessible via menu/shortcut

let BACKEND_PORT = 3001
const FRONTEND_PORT = 3001
const SETUP_WIZARD_API_PORT = 3002

// Force first install mode (for testing/development)
const FORCE_FIRST_INSTALL = process.env.FORCE_FIRST_INSTALL === 'true' || process.argv.includes('--force-first-install')

// Disable Electron security warnings (dev tool)
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

// Read host and port from config.json
async function readServerConfig(): Promise<{ host: string; port: number; api_key?: string }> {
  const configPath = join(app.getPath('userData'), 'config.json')
  try {
    const configData = await readFile(configPath, 'utf8')
    const config = JSON.parse(configData)

    // Normalize structure if needed
    let dirty = false
    if (!config.server || typeof config.server !== 'object') {
      config.server = { host: 'localhost', port: 3000 }
      dirty = true
    }
    if (typeof config.server.port !== 'number') {
      config.server.port = 3000
      dirty = true
    }
    if (!config.server.api_key || typeof config.server.api_key !== 'string') {
      config.server.api_key = 'dev-api-key-change-me'
      dirty = true
    }
    if (!Array.isArray(config.mcp_servers)) {
      config.mcp_servers = []
      dirty = true
    }
    if (dirty) {
      try {
        await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')
      } catch (e) {
        console.warn('Failed to normalize config.json:', e)
      }
    }
    return {
      host: config.server?.host || 'localhost',
      port: config.server?.port+1 || 3001,
      api_key: config.server?.api_key
    }
  } catch (error) {
    console.error('Failed to read config.json:', error)
    return {
      host: 'localhost',
      port: 3000,
      api_key: 'dev-api-key-change-me'
    }
  }
}

// Check if frontend server is ready
async function checkFrontendReady(maxAttempts: number = 30, host: string = 'localhost', port: number = 3001): Promise<boolean> {
  let attempts = 0
  while (attempts < maxAttempts) {
    try {
      const response = await fetch(`http://${host}:${port}`)
      if (response.ok) {
        console.log('Frontend server is ready')
        return true
      }
    } catch {
      // Frontend not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
    attempts++
  }
  return false
}

// Check if backend is already running
async function checkBackendRunning(host: string = 'localhost', port: number = 3001): Promise<boolean> {
  try {
    const response = await fetch(`http://${host}:${port}/health`)
    return response.ok
  } catch {
    return false
  }
}

// Check if Setup Wizard API server is already running
async function checkSetupWizardApiRunning(host: string = 'localhost', port: number = 3002): Promise<boolean> {
  try {
    const response = await fetch(`http://${host}:${port}/health`)
    return response.ok
  } catch {
    return false
  }
}

// Start the backend server
async function startBackend(host: string = 'localhost', port: number = 3001): Promise<void> {
  if (isBackendRunning) {
    console.log('Backend already running')
    return
  }

  try {
    // Check if backend is already running
    if (await checkBackendRunning(host, port)) {
      console.log('Backend server already running on port', port)
      isBackendRunning = true
      return
    }

    console.log('Starting Open Edison backend server...')

    // Get the project root (parent directory of gui folder)
    const projectRoot = join(__dirname, '..', '..')

    // Prepare logging to file in production
    const fs = require('fs') as typeof import('fs')
    const isPackaged = app.isPackaged === true
    const logDir = app.getPath('userData')
    try {
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true })
      }
    } catch { }
    const logFilePath = join(logDir, 'backend.log')
    const logStream = fs.createWriteStream(logFilePath, { flags: 'a' })

    // Decide how to start backend based on environment
    const startMethods = (() => {
      if (isPackaged) {
        // Production: spawn bundled PyInstaller binary from Resources
        const backendExecutable = process.platform === 'win32' ? 'open-edison-backend.exe' : 'open-edison-backend'
        const resourcesPath = process.resourcesPath
        const bundledPath = join(resourcesPath, 'backend', backendExecutable)
        return [
          () => spawn(bundledPath, [], { cwd: resourcesPath, stdio: 'pipe', shell: false })
        ]
      }
      // Development: fall back to uv/python
      return [
        () => spawn('uv', ['run', 'python', '-m', 'src.gui'], { cwd: projectRoot, stdio: 'pipe', shell: true })
      ]
    })()

    let methodIndex = 0
    let startupSuccessful = false

    while (methodIndex < startMethods.length && !startupSuccessful) {
      try {
        console.log(`Trying startup method ${methodIndex + 1}...`)
        backendProcess = startMethods[methodIndex]()
        backendProcess.stdout?.on('data', (data: Buffer) => {
          const message = data.toString()
          console.log('OpenEdison:', message)
          try { logStream.write(message) } catch { }
          // Send log to renderer process
          if (mainWindow) {
            mainWindow.webContents.send('backend-log', { type: 'stdout', message })
          }
        })

        backendProcess.stderr?.on('data', (data: Buffer) => {
          const message = data.toString()
          console.log('OpenEdison:', message)
          try { logStream.write(message) } catch { }
          // Send log to renderer process
          if (mainWindow) {
            mainWindow.webContents.send('backend-log', { type: 'stderr', message })
          }
        })

        backendProcess.on('error', (error: Error) => {
          console.log(`Method ${methodIndex + 1} failed:`, error.message)
          try { logStream.write(`[spawn-error] ${error.message}\n`) } catch { }
          methodIndex++
        })

        backendProcess.on('exit', (code: number) => {
          console.log('Backend process exited with code:', code)
          isBackendRunning = false
          try { logStream.end(`\n[exit ${code}]\n`) } catch { }
        })

        // Wait a moment for the server to start
        await new Promise(resolve => setTimeout(resolve, 3000))

        // Check if backend is now running
        if (await checkBackendRunning(host, port)) {
          console.log('Backend server started successfully')
          isBackendRunning = true
          startupSuccessful = true
        } else {
          console.log(`Method ${methodIndex + 1} did not start the server properly`)
          methodIndex++
        }

      } catch (error) {
        console.log(`Method ${methodIndex + 1} failed with error:`, error)
        methodIndex++
      }
    }

    if (!startupSuccessful) {
      console.warn('⚠️  Could not start Open Edison backend server')
      console.warn('   Please ensure Open Edison is installed: pip install open-edison')
      console.warn('   Or run the backend manually before starting the desktop app')
    }

  } catch (error) {
    console.error('Error starting backend:', error)
    try {
      const fs = require('fs') as typeof import('fs')
      const logDir = app.getPath('userData')
      const logFilePath = join(logDir, 'backend.log')
      fs.appendFileSync(logFilePath, `[fatal] ${String(error)}\n`)
    } catch { }
  }
}

// Start the Setup Wizard API server
async function startSetupWizardApi(host: string = 'localhost', port: number = 3002): Promise<void> {
  if (isSetupWizardApiRunning) {
    console.log('Setup Wizard API already running')
    return
  }

  try {
    // Check if Setup Wizard API is already running
    if (await checkSetupWizardApiRunning(host, port)) {
      console.log('Setup Wizard API server already running on port', port)
      isSetupWizardApiRunning = true
      return
    }

    console.log('Starting Setup Wizard API server...')

    // Get the project root (parent directory of gui folder)
    const projectRoot = join(__dirname, '..', '..')

    const fs = require('fs') as typeof import('fs')
    const resourcesPath = process.resourcesPath
    const isPackaged = app.isPackaged === true
    // Prepare logging
    const logDir = app.getPath('userData')
    try { if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true }) } catch { }
    const logFilePath = join(logDir, 'wizard-api.log')
    const logStream = fs.createWriteStream(logFilePath, { flags: 'a' })

    if (isPackaged) {
      // Spawn bundled wizard binary
      const wizardExecutable = process.platform === 'win32' ? 'open-edison-wizard.exe' : 'open-edison-wizard'
      const bundledPath = join(resourcesPath, 'backend', wizardExecutable)
      setupWizardApiProcess = spawn(bundledPath, ['--host', host, '--port', port.toString()], {
        cwd: resourcesPath,
        stdio: 'pipe',
        shell: false
      })
    } else {
      // Dev: uv run python -m src.mcp_importer.wizard_server
      setupWizardApiProcess = spawn('uv', ['run', 'python', '-m', 'src.mcp_importer.wizard_server', '--host', host, '--port', port.toString()], {
        cwd: projectRoot,
        stdio: 'pipe',
        shell: true
      })
    }

    setupWizardApiProcess.stdout?.on('data', (data: Buffer) => {
      const message = data.toString()
      console.log('Setup-Wizard-API:', message)
      try { logStream.write(message) } catch { }
      // Send log to renderer process
      if (mainWindow) {
        mainWindow.webContents.send('setup-wizard-api-log', { type: 'stdout', message })
      }
    })

    setupWizardApiProcess.stderr?.on('data', (data: Buffer) => {
      const message = data.toString()
      console.log('Setup-Wizard-API:', message)
      try { logStream.write(message) } catch { }
      // Send log to renderer process
      if (mainWindow) {
        mainWindow.webContents.send('setup-wizard-api-log', { type: 'stderr', message })
      }
    })

    setupWizardApiProcess.on('error', (error: Error) => {
      console.log('Setup Wizard API startup failed:', error.message)
      try { logStream.write(`[spawn-error] ${error.message}\n`) } catch { }
    })

    setupWizardApiProcess.on('exit', (code: number) => {
      console.log('Setup Wizard API process exited with code:', code)
      isSetupWizardApiRunning = false
      try { logStream.end(`\n[exit ${code}]\n`) } catch { }
    })

    // Wait a moment for the server to start
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Check if Setup Wizard API is now running
    if (await checkSetupWizardApiRunning(host, port)) {
      console.log('Setup Wizard API server started successfully')
      isSetupWizardApiRunning = true
    } else {
      console.warn('⚠️  Could not start Setup Wizard API server')
    }

  } catch (error) {
    console.error('Error starting Setup Wizard API:', error)
  }
}

// Start the frontend development server
async function startFrontend(host: string = 'localhost', port: number = 3001): Promise<void> {
  try {
    console.log('Starting frontend development server...')

    const projectRoot = join(__dirname, '..', '..')
    const frontendDir = join(projectRoot, 'frontend')

    // Check if frontend directory exists
    const fs = await import('fs')
    if (!fs.existsSync(frontendDir)) {
      console.error('Frontend directory not found:', frontendDir)
      return
    }

    // Start the frontend dev server
    frontendProcess = spawn('npm', ['run', 'dev'], {
      cwd: frontendDir,
      stdio: 'pipe',
      shell: true
    })

    frontendProcess.stdout?.on('data', (data: Buffer) => {
      console.log('Frontend stdout:', data.toString())
    })

    frontendProcess.stderr?.on('data', (data: Buffer) => {
      console.log('Frontend stderr:', data.toString())
    })

    frontendProcess.on('error', (error) => {
      console.error('Failed to start frontend:', error)
    })

    // Store reference to frontend process for cleanup
    process.on('exit', () => {
      if (frontendProcess) {
        frontendProcess.kill()
      }
    })

    // Wait for frontend to be ready
    await checkFrontendReady(30, host, port)

  } catch (error) {
    console.error('Error starting frontend:', error)
  }
}

// Start the React development server
async function startReactDevServer(): Promise<void> {
  try {
    console.log('Starting React development server...')

    // Start the Vite dev server directly on port 5174
    // Use the parent directory where the source files and vite.config.ts are located
    const guiDir = join(__dirname, '..')
    reactProcess = spawn('npx', ['vite', '--port', '5174'], {
      cwd: guiDir,
      stdio: 'pipe',
      shell: true
    })

    reactProcess.stdout?.on('data', (data: Buffer) => {
      console.log('React stdout:', data.toString())
    })

    reactProcess.stderr?.on('data', (data: Buffer) => {
      console.log('React stderr:', data.toString())
    })

    reactProcess.on('error', (error) => {
      console.error('Failed to start React dev server:', error)
    })

    // Store reference to React process for cleanup
    process.on('exit', () => {
      if (reactProcess) {
        reactProcess.kill()
      }
    })

  } catch (error) {
    console.error('Error starting React dev server:', error)
  }
}

async function createWindow(): Promise<void> {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.js'),
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Enable <webview> tag for embedded dashboard (uses isolated guest webContents)
      webviewTag: true
    },
    show: false, // Don't show until ready
    title: 'Open Edison Desktop',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 15 }
  })

  // Load the React desktop interface
  const isDev = process.env.NODE_ENV === 'development'

  if (isDev) {
    // In development, load from the dev server
    const devUrl = `http://localhost:${FRONTEND_PORT}`
    console.log(`Loading React desktop interface from dev server: ${devUrl}`)
    mainWindow.loadURL(devUrl)
  } else {
    // In production, load the built static files using custom protocol
    const indexPath = 'app://src/index.html'
    console.log(`Loading React desktop interface from built files: ${indexPath}`)
    mainWindow.loadURL(indexPath)
  }

  if (isDev) {
    // Open DevTools in a separate window so embedded views don't overlap
    try { mainWindow.webContents.openDevTools({ mode: 'detach' }) } catch { mainWindow.webContents.openDevTools() }
    // If DevTools somehow opens docked, force re-open as detached and temporarily hide dashboard view
    mainWindow.webContents.on('devtools-opened', () => {
      try {
        const hasDetached = !!mainWindow?.webContents.devToolsWebContents
        if (!hasDetached) {
          try { dashboardView?.setVisible(false) } catch { }
          mainWindow?.webContents.closeDevTools()
          mainWindow?.webContents.openDevTools({ mode: 'detach' })
          try { dashboardView?.setVisible(true) } catch { }
        }
        // Also open DevTools for the embedded dashboard view when main DevTools opens
        try { dashboardView?.webContents?.openDevTools({ mode: 'detach' }) } catch { }
      } catch { }
    })
    mainWindow.webContents.on('devtools-closed', () => {
      try { dashboardView?.setVisible(true) } catch { }
    })
  }

  // Secure and configure any <webview> attachments
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    try {
      // Enforce trusted origins only (localhost dashboard)
      const src: string = String((params as any)?.src || '')
      const allowed = /^http:\/\/localhost:\d+\/(?:dashboard|index\.html)/.test(src)
      if (!allowed) {
        console.warn('Blocking webview with untrusted src:', src)
        event.preventDefault()
        return
      }

      // Force a persistent partition for stable localStorage/sessionStorage
      ; (params as any).partition = 'persist:dashboard'

      // Harden guest: no Node, isolate context, strip preload unless explicitly set by us
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      if (webPreferences.preload) {
        delete (webPreferences as any).preload
      }
      // Optional: allow popups for OAuth flows; can also be handled via setWindowOpenHandler
      webPreferences.javascript = true
    } catch (e) {
      console.warn('will-attach-webview handler error:', e)
    }
  })

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show()
      console.log('Open Edison Desktop is ready!')
    }
  })

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Handle navigation errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription: string, validatedURL: string) => {
    console.error('Failed to load:', errorDescription, 'for URL:', validatedURL)
  })

  // Application menu with a Dashboard DevTools item and Check for Updates
  try {
    const isMac = process.platform === 'darwin'
      const checkForUpdatesItem: Electron.MenuItemConstructorOptions = {
      label: 'Check for Updates…',
      click: async () => {
        try { mainWindow?.webContents.send('update-status', 'checking') } catch {}
        try {
          if (app.isPackaged) {
            const updaterMod = require('electron-updater') as typeof import('electron-updater')
            const autoUpdater = updaterMod.autoUpdater
            const res = await autoUpdater.checkForUpdatesAndNotify()
            // If updater reports null (no update) without firing update-not-available, show dialog
            if (!res) {
              const win = BrowserWindow.getFocusedWindow() || mainWindow
              if (win) dialog.showMessageBox(win, { type: 'info', message: 'You’re up to date', detail: `${app.getName()} ${app.getVersion()} is the latest version.`, buttons: ['OK'] })
            }
            } else {
              setTimeout(() => { try { mainWindow?.webContents.send('update-status', 'none') } catch {} }, 250)
              const win = BrowserWindow.getFocusedWindow() || mainWindow
              if (win) dialog.showMessageBox(win, { type: 'info', message: 'You’re up to date (dev)', detail: `${app.getName()} dev run`, buttons: ['OK'] })
          }
        } catch (err) {
          console.warn('Manual update check failed:', err)
        }
      }
    }

    const appMenu: Electron.MenuItemConstructorOptions | undefined = isMac ? {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        checkForUpdatesItem,
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    } : undefined

    const helpMenu: Electron.MenuItemConstructorOptions = {
      role: 'help',
      submenu: [
        ...(!isMac ? [checkForUpdatesItem] : [])
      ]
    }

    const template: Electron.MenuItemConstructorOptions[] = [
      ...(appMenu ? [appMenu] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'togglefullscreen' },
          { type: 'separator' },
          {
            label: 'Theme',
            submenu: [
              { label: 'Light', type: 'radio', checked: false, click: () => setThemeMode('light') },
              { label: 'Dark', type: 'radio', checked: false, click: () => setThemeMode('dark') },
              { label: 'Blue', type: 'radio', checked: true, click: () => setThemeMode('blue') },
              { label: 'System', type: 'radio', checked: false, click: () => setThemeMode('system') }
            ]
          },
          {
            label: 'Open Dashboard DevTools',
            accelerator: isMac ? 'Cmd+Alt+D' : 'Ctrl+Shift+D',
            click: () => { try { dashboardView?.webContents?.openDevTools({ mode: 'detach' }) } catch { } }
          },
          { type: 'separator' },
          { role: 'toggleDevTools' }
        ]
      },
      { role: 'windowMenu' },
      helpMenu
    ]
    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
  } catch (e) {
    console.warn('Failed to set application menu:', e)
  }

  // Create macOS menu bar (tray) icon
  try {
    if (process.platform === 'darwin' && !tray) {
      const fs = require('fs') as typeof import('fs')
      const path = require('path') as typeof import('path')
      const base = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), '..')
      const icon = path.join(base, 'media', 'Edison.iconset', 'icon_16x16.png')
      let img = null as ReturnType<typeof nativeImage.createFromPath> | null
      if (fs.existsSync(icon)) {
        img = nativeImage.createFromPath(icon)
      }
      if (!img) {
        img = nativeImage.createEmpty()
      }
      tray = new Tray(img)
      tray.setToolTip('Open Edison')
      }

      const isMac = process.platform === 'darwin'
      const checkForUpdatesItem: Electron.MenuItemConstructorOptions = {
        label: 'Check for Updates…',
        click: async () => {
          try { mainWindow?.webContents.send('update-status', 'checking') } catch {}
          try {
            if (app.isPackaged) {
              const updaterMod = require('electron-updater') as typeof import('electron-updater')
              const autoUpdater = updaterMod.autoUpdater
              const res = await autoUpdater.checkForUpdatesAndNotify()
              if (!res) {
                const win = BrowserWindow.getFocusedWindow() || mainWindow
                if (win) dialog.showMessageBox(win, { type: 'info', message: 'You’re up to date', detail: `${app.getName()} ${app.getVersion()} is the latest version.`, buttons: ['OK'] })
              }
            } else {
              setTimeout(() => { try { mainWindow?.webContents.send('update-status', 'none') } catch {} }, 250)
              const win = BrowserWindow.getFocusedWindow() || mainWindow
              if (win) dialog.showMessageBox(win, { type: 'info', message: 'You’re up to date (dev)', detail: `${app.getName()} dev run`, buttons: ['OK'] })
            }
          } catch (err) {
            console.warn('Tray manual update check failed:', err)
          }
        }
      }

      const statusLabel = () => {
        if (isBackendRunning && isNgrokRunning) return 'Running with global access'
        if (isBackendRunning) return 'Running with local access'
        return 'Not Running'
      }

      const buildContextMenu = () => Menu.buildFromTemplate([
        { label: statusLabel(), enabled: false },
        { type: 'separator' },
        {
          label: 'Show Open Edison',
          click: () => {
            try {
              if (mainWindow) {
                if (!mainWindow.isVisible()) mainWindow.show()
                mainWindow.focus()
              }
            } catch { }
          }
        },
        { type: 'separator' },
        checkForUpdatesItem,
        { type: 'separator' },
        { role: 'quit', label: isMac ? 'Quit Open Edison' : 'Quit' }
      ])
      tray?.setContextMenu(buildContextMenu())
      const refreshTrayMenu = () => { try { tray?.setContextMenu(buildContextMenu()) } catch { } }
      // Periodically refresh to reflect backend/ngrok state
      setInterval(refreshTrayMenu, 2000)
      tray?.on('click', () => {
        try {
          if (!mainWindow) return
          if (mainWindow.isVisible()) {
            mainWindow.hide()
          } else {
            mainWindow.show()
            mainWindow.focus()
          }
        } catch { }
      })
    }
  catch (e) {
    console.warn('Failed to create tray:', e)
  }
}

// Theme management
type ThemeMode = 'light' | 'dark' | 'blue' | 'system'
let themeMode: ThemeMode = 'blue'

function getEffectiveTheme(mode: ThemeMode): 'light' | 'dark' | 'blue' {
  if (mode === 'system') {
    try {
      const { nativeTheme } = require('electron') as typeof import('electron')
      return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    } catch { return 'light' }
  }
  return mode
}

function setThemeMode(mode: ThemeMode) {
  themeMode = mode
  const effective = getEffectiveTheme(mode)
  try { mainWindow?.webContents.send('theme-changed', { mode, effective }) } catch { }
  try { applyThemeToDashboard(effective, mode) } catch { }
}

ipcMain.handle('theme-get', async () => {
  return { mode: themeMode, effective: getEffectiveTheme(themeMode) }
})

function applyThemeToDashboard(effective: 'light' | 'dark' | 'blue', mode: ThemeMode) {
  if (!dashboardView) return
  const script = `
    try {
      localStorage.setItem('app-theme', '${effective}');
      document.documentElement.setAttribute('data-theme', '${effective}');
      if (window.__setTheme) { window.__setTheme('${effective}') }
      try { window.dispatchEvent(new CustomEvent('theme-changed', { detail: { effective: '${effective}', mode: '${mode}' } })) } catch {}
    } catch {}
  `
  try { dashboardView.webContents.executeJavaScript(script).catch(() => { }) } catch { }
}

function setApiKeyForDashboard(apiKey: string) {
  if (!dashboardView) return
  try {
    const safe = JSON.stringify(apiKey)
    const script = `
      try {
        localStorage.setItem('api_key', ${safe});
        if (window.__setApiKey) { window.__setApiKey(${safe}) }
        try { window.dispatchEvent(new CustomEvent('api-key-changed', { detail: { apiKey: ${safe} } })) } catch {}
      } catch {}
    `
    dashboardView.webContents.executeJavaScript(script).catch(() => { })
  } catch { }
}

// Create the wizard window
async function createWizardWindow(isFirstInstall: boolean = false): Promise<void> {
  // Don't create if already exists
  if (wizardWindow) {
    wizardWindow.focus()
    return
  }

  // Create the wizard window
  wizardWindow = new BrowserWindow({
    width: 800,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.js'),
      webSecurity: true,
      allowRunningInsecureContent: false
    },
    show: false,
    title: isFirstInstall ? 'Open Edison Setup Wizard' : 'MCP Import Wizard',
    parent: isFirstInstall ? undefined : mainWindow || undefined,
    modal: !isFirstInstall,
    resizable: true,
    minimizable: false,
    maximizable: false
  })

  // Load the wizard interface
  const isDev = process.env.NODE_ENV === 'development'

  if (isDev) {
    // In development, load from the dev server with wizard query parameter
    const devUrl = `http://localhost:${FRONTEND_PORT}?wizard=true`
    console.log(`Loading wizard from dev server: ${devUrl}`)
    wizardWindow.loadURL(devUrl)
  } else {
    // In production, use the same approach as main window but with a query parameter
    const indexPath = 'app://src/index.html?wizard=true'
    console.log(`Loading wizard from built files: ${indexPath}`)
    console.log(`__dirname: ${__dirname}`)
    wizardWindow.loadURL(indexPath)
  }

  if (isDev) {
    // Open DevTools in development
    wizardWindow.webContents.openDevTools()
  }

  // Show window when ready
  wizardWindow.once('ready-to-show', () => {
    if (wizardWindow) {
      wizardWindow.show()
      console.log('MCP Import Wizard is ready!')
    }
  })

  // Handle window closed
  wizardWindow.on('closed', () => {
    wizardWindow = null
    try { mainWindow?.webContents.send('wizard-closed') } catch {}
  })

  // Handle navigation errors
  wizardWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription: string, validatedURL: string) => {
    console.error('Wizard failed to load:', errorDescription, 'for URL:', validatedURL)
  })
}

// Register custom protocol for serving local files
app.whenReady().then(() => {
  protocol.registerFileProtocol('app', (request, callback) => {
    const url = request.url.substr(6)
    const cleanUrl = url.split('?')[0]
    const filePath = join(__dirname, cleanUrl)
    console.log(`Protocol request: ${request.url} -> ${filePath}`)
    callback({ path: filePath })
  })

  // Apply permissive CSP via response headers (now that app is ready)
  const applyPermissiveCsp = (ses: Electron.Session) => {
    ses.webRequest.onHeadersReceived((details, callback) => {
      const headers = details.responseHeaders || {}
      const cspValue =
        "default-src * 'self' 'unsafe-inline' 'unsafe-eval' data: blob: filesystem: app: http: https: ws: wss:; " +
        "script-src * 'self' 'unsafe-inline' 'unsafe-eval' data: blob: app: http: https:; " +
        "style-src * 'self' 'unsafe-inline' data: blob: app: http: https:; " +
        "img-src * data: blob: app: http: https:; " +
        "font-src * data: blob: app: http: https:; " +
        "connect-src * data: blob: app: http: https: ws: wss:; " +
        "media-src * data: blob: app: http: https:; " +
        "frame-src * app: http: https:; " +
        "frame-ancestors *; child-src * data: blob: app: http: https:; worker-src * data: blob: app: http: https:;"
      headers['Content-Security-Policy'] = cspValue
      callback({ responseHeaders: headers })
    })
  }
  try {
    applyPermissiveCsp(session.defaultSession)
    applyPermissiveCsp(session.fromPartition('persist:dashboard'))
  } catch (e) {
    console.warn('CSP header injection failed:', e)
  }
})

// Function to start the main application (backend, frontend, main window)
async function startMainApplication() {
  console.log('Starting main application...')
  console.log('isInFirstInstallMode:', isInFirstInstallMode)

  // Read host and port from config.json
  const { host, port } = await readServerConfig()

  // Set the global BACKEND_PORT to the port from config
  BACKEND_PORT = port

  // Start backend server
  await startBackend(host, port)

  // Create the main window
  await createWindow()
}

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  console.log('Electron app ready, checking installation...')

  // Set dock icon in development (non-DMG run)
  try {
    if (process.platform === 'darwin' && !app.isPackaged) {
      const { nativeImage } = require('electron') as typeof import('electron')
      const fs = require('fs') as typeof import('fs')
      const icon = join(app.getAppPath(), '..', 'media', 'Edison.iconset','icon_256x256.png')
      const exists = fs.existsSync(icon)
      let set = false

      if (exists) {
        const img = nativeImage.createFromPath(icon)
        if (!img.isEmpty()) {
          try { app.dock.setIcon(img) } catch { }
          console.log('Set macOS dock icon for development run:', icon)
          set = true
        }
      }
      if (!set) {
        console.warn('Dock icon not found or could not be loaded. Tried:', icon)
      }
    }
  } catch { }
  

  // Check if Open Edison is installed
  isFirstInstall = await installOpenEdison()
  console.log('Installation check result - isFirstInstall:', isFirstInstall)

  if (isFirstInstall) {
    console.log('First install detected, starting setup wizard...')
    isInFirstInstallMode = true
    console.log('isInFirstInstallMode set to:', isInFirstInstallMode)

    // Start only the Setup Wizard API server for the wizard
    const { host, port } = await readServerConfig()
    await startSetupWizardApi(host, SETUP_WIZARD_API_PORT)

    // Create only the wizard window
    await createWizardWindow(true)
    console.log('Wizard window created, main application should NOT start yet')
  } else {
    console.log('Open Edison already installed, starting main application...')
    await startMainApplication()
  }

  // Auto-update setup (packaged only)
  try {
    if (app.isPackaged) {
      // Load updater at runtime so it's not bundled
      const updaterMod = require('electron-updater') as typeof import('electron-updater')
      const autoUpdater = updaterMod.autoUpdater
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true

      autoUpdater.on('checking-for-update', () => { try { mainWindow?.webContents.send('update-status', 'checking') } catch {} })
      autoUpdater.on('update-available', (info) => { try { mainWindow?.webContents.send('update-status', 'available', info) } catch {} })
      autoUpdater.on('update-not-available', () => {
        try { mainWindow?.webContents.send('update-status', 'none') } catch {}
        // If user triggered manual check (menu item), show dialog. We infer manual checks by recent 'checking' send.
        try {
          const win = BrowserWindow.getFocusedWindow() || mainWindow
          if (win) dialog.showMessageBox(win, { type: 'info', message: 'You’re up to date', detail: `${app.getName()} ${app.getVersion()} is the latest version.`, buttons: ['OK'] })
        } catch {}
      })
      autoUpdater.on('download-progress', (p) => { try { mainWindow?.webContents.send('update-progress', p) } catch {} })
      autoUpdater.on('update-downloaded', () => { try { mainWindow?.webContents.send('update-status', 'ready') } catch {} })
      // To debug update errors... 
      // autoUpdater.on('error', (e) => {
      //   try { mainWindow?.webContents.send('update-status', 'error', { message: e?.message || String(e) }) } catch {}
      //   try {
      //     const win = BrowserWindow.getFocusedWindow() || mainWindow
      //     if (win) dialog.showMessageBox(win, { type: 'error', message: 'Update check failed', detail: (e?.message || String(e)), buttons: ['OK'] })
      //   } catch {}
      // })

      ipcMain.handle('updates-check', async () => {
        try {
          const result = await autoUpdater.checkForUpdates()
          return { ok: true, result }
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) }
        }
      })

      ipcMain.handle('updates-install', async () => {
        try {
          setImmediate(() => autoUpdater.quitAndInstall())
          return { ok: true }
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) }
        }
      })

      setTimeout(() => { try { autoUpdater.checkForUpdatesAndNotify() } catch {} }, 2000)
    } else {
      // Dev: provide IPC stubs so manual check logs appear
      ipcMain.handle('updates-check', async () => {
        try { mainWindow?.webContents.send('update-status', 'checking') } catch {}
        setTimeout(() => { try { mainWindow?.webContents.send('update-status', 'none') } catch {} }, 250)
        return { ok: true, result: null }
      })
      ipcMain.handle('updates-install', async () => ({ ok: false, error: 'Not available in development' }))
    }
  } catch (e) {
    console.warn('Auto-update init failed:', e)
  }
})

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform != 'darwin') {
    // Kill backend process when app closes
    if (backendProcess) {
      console.log('Terminating backend process...')
      backendProcess.kill()
    }

    // Kill Setup Wizard API process when app closes
    if (setupWizardApiProcess) {
      console.log('Terminating Setup Wizard API process...')
      setupWizardApiProcess.kill()
    }

    // Kill frontend process when app closes
    if (frontendProcess) {
      console.log('Terminating frontend process...')
      frontendProcess.kill()
    }
  }
})

app.on('activate', () => {
  // On macOS, re-create a window when the dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0 && !isInFirstInstallMode) {
    createWindow()
  }
})

// Handle app termination
app.on('before-quit', () => {
  if (backendProcess) {
    console.log('Terminating backend process...')
    backendProcess.kill()
  }
  if (setupWizardApiProcess) {
    console.log('Terminating Setup Wizard API process...')
    setupWizardApiProcess.kill()
  }
  try { tray?.destroy(); tray = null } catch { }
})

// IPC handlers for communication with renderer process
ipcMain.handle('get-backend-status', async () => {
  return {
    running: isBackendRunning,
    port: BACKEND_PORT
  }
})

ipcMain.handle('restart-backend', async () => {
  if (backendProcess) {
    backendProcess.kill()
    isBackendRunning = false
  }
  await startBackend()
  return isBackendRunning
})

ipcMain.handle('stop-backend', async () => {
  if (backendProcess) {
    backendProcess.kill()
    isBackendRunning = false
    backendProcess = null
    return true
  }
  return false
})

// Get application support path
ipcMain.handle('get-application-support-path', async () => {
  const appSupportPath = app.getPath('userData')
  return appSupportPath
})

// Check if path exists
ipcMain.handle('check-path-exists', async (event, path: string) => {
  try {
    const fs = require('fs')
    return fs.existsSync(path)
  } catch (error) {
    console.error('Error checking path existence:', error)
    return false
  }
})

// Get Open Edison config directory
const getConfigDir = async (): Promise<string> => {
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const { spawn } = require('child_process') as typeof import('child_process')
  const projectRoot = path.join(__dirname, '..', '..')

  // In production, prefer Electron's userData directory
  if (app.isPackaged) {
    const configDir = app.getPath('userData')
    try {
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true })
        console.log(`Created application directory: ${configDir}`)
      }
    } catch { }
    console.log('Using Open Edison config directory (packaged):', configDir)
    return configDir
  }

  console.log('Getting Open Edison config directory from the backend (dev)...')

  const configDirProcess = spawn('uv', ['run', 'python', '-m', 'src.gui', '--get-config-dir'], {
    cwd: projectRoot,
    stdio: 'pipe',
    shell: true
  })

  const configDir: string = await new Promise<string>((resolve, reject) => {
    let output = ''
    configDirProcess.stdout?.on('data', (data: Buffer) => {
      output += data.toString()
    })
    configDirProcess.on('close', (code: number) => {
      if (code === 0) {
        resolve(output.trim())
      } else {
        reject(new Error(`Process exited with code ${code}`))
      }
    })
    configDirProcess.on('error', (err: Error) => reject(err))
  })

  console.log('Using Open Edison config directory:', configDir)
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
    console.log(`Created application directory: ${configDir}`)
  }
  return configDir
}

// Check Open Edison installation and initialize if needed
const installOpenEdison = async (): Promise<boolean> => {
  try {
    let appSupportPath = app.getPath('userData')
    let newAppSupportPath = appSupportPath
    console.log('App support path:', appSupportPath)
    const fs = require('fs')
    const path = require('path')

    const folderExists = fs.existsSync(appSupportPath)

    // Assert that the application support directory exists
    if (!folderExists) {
      throw new Error(`Application directory ${appSupportPath} does not exist`)
    }

    try {
      newAppSupportPath = await getConfigDir()
      appSupportPath = newAppSupportPath
      app.setPath('userData', appSupportPath)
      console.log('Set app support path to:', appSupportPath)
    } catch (error) {
      console.error('Error getting Open Edison config directory, will use default:', error)
    }

    // Check for required configuration files
    const configFiles = [
      'config.json',
      'tool_permissions.json',
      'resource_permissions.json',
      'prompt_permissions.json'
    ]

    const configFilesExist = configFiles.every(file => {
      const filePath = path.join(appSupportPath, file)
      const exists = fs.existsSync(filePath)
      if (!exists) {
        console.log(`Missing configuration file: ${file}`)
      }
      return exists
    })

    if (!configFilesExist || FORCE_FIRST_INSTALL) {
      console.log('Open Edison installation not found, initializing...')

      // // Create the application support directory
      // Note: since the appname matches open edison, the folder exists with electron data
      // fs.mkdirSync(appSupportPath, { recursive: true })
      // console.log(`Created application support directory: ${appSupportPath}`)

      // Copy initial JSON files from the app bundle
      await copyInitialConfigFiles(appSupportPath)

      console.log('Open Edison installation initialized with default configuration')
      return true // First install detected
    }

    console.log('Open Edison installation found')
    return false // Not a first install
  } catch (error) {
    console.error('Error checking Open Edison installation:', error)
    return false
  }
}

// Copy initial configuration files to the installation directory
const copyInitialConfigFiles = async (targetDir: string) => {
  try {
    const fs = require('fs')
    const path = require('path')

    // List of initial configuration files to copy
    const configFiles = [
      'config.json',
      'tool_permissions.json',
      'resource_permissions.json',
      'prompt_permissions.json'
    ]

    // Get the app's resource path (where the bundled files are)
    const appPath = process.resourcesPath || __dirname
    const sourceDir = path.join(appPath, '..', '..') // Go up to the app bundle root

    for (const fileName of configFiles) {
      const sourcePath = path.join(sourceDir, fileName)
      const targetPath = path.join(targetDir, fileName)

      try {
        // Check if source file exists
        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, targetPath)
          console.log(`Copied ${fileName} to ${targetPath}`)
        } else {
          // If file doesn't exist in bundle, create a default one
          await createDefaultConfigFile(fileName, targetPath)
        }
      } catch (copyError) {
        console.warn(`Failed to copy ${fileName}: ${copyError}`)
        // Create default file as fallback
        await createDefaultConfigFile(fileName, targetPath)
      }
    }
  } catch (error) {
    console.error('Error copying initial configuration files:', error)
  }
}

// Create default configuration files
const createDefaultConfigFile = async (fileName: string, targetPath: string) => {
  const fs = require('fs')

  let defaultContent = '{}'

  // Set default content based on file type
  switch (fileName) {
    case 'config.json':
      defaultContent = JSON.stringify({
        "server": {
          "host": "localhost",
          "port": 3000,
          "api_key": "dev-api-key-change-me"
        },
        "mcp_servers": [],
        "logging": {
          "level": "INFO"
        }
      }, null, 2)
      break
    case 'tool_permissions.json':
    case 'resource_permissions.json':
    case 'prompt_permissions.json':
      defaultContent = JSON.stringify({}, null, 2)
      break
  }

  try {
    fs.writeFileSync(targetPath, defaultContent)
    console.log(`Created default ${fileName} at ${targetPath}`)
  } catch (error) {
    console.error(`Failed to create default ${fileName}: ${error}`)
  }
}

// Store installation status globally
let isFirstInstall = false
let isInFirstInstallMode = false


// IPC handler to get installation status
ipcMain.handle('get-installation-status', async () => {
  return isFirstInstall
})

// IPC handlers for Setup Wizard API
ipcMain.handle('get-setup-wizard-api-status', async () => {
  return {
    running: isSetupWizardApiRunning,
    port: SETUP_WIZARD_API_PORT
  }
})

ipcMain.handle('restart-setup-wizard-api', async () => {
  if (setupWizardApiProcess) {
    setupWizardApiProcess.kill()
    isSetupWizardApiRunning = false
  }
  await startSetupWizardApi()
  return isSetupWizardApiRunning
})

// IPC handler to open wizard window
ipcMain.handle('open-wizard-window', async () => {
  try {
    // Ensure Setup Wizard API server is running
    const { host, port } = await readServerConfig()
    await startSetupWizardApi(host, SETUP_WIZARD_API_PORT)

    await createWizardWindow()
    return { success: true }
  } catch (error) {
    console.error('Failed to open wizard window:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

// IPC handler to close current window
ipcMain.handle('close-window', async () => {
  const focusedWindow = BrowserWindow.getFocusedWindow()
  if (focusedWindow) {
    focusedWindow.close()
  }
  return { success: true }
})

// IPC handler for wizard completion
ipcMain.handle('wizard-completed', async () => {
  if (isInFirstInstallMode) {
    console.log('Wizard completed successfully, starting main application...')
    isInFirstInstallMode = false
    await startMainApplication()
    return { success: true }
  } else {
    console.log('Wizard completed but not in first install mode, ignoring...')
    return { success: false, error: 'Not in first install mode' }
  }
})

// IPC handler to get server configuration
ipcMain.handle('get-server-config', async () => {
  return await readServerConfig()
})

// IPC: Reinitialize MCP servers via backend HTTP (avoids renderer CORS)
ipcMain.handle('reinitialize-mcp', async () => {
  try {
    const { host, port, api_key } = await readServerConfig()
    const url = `http://${host || 'localhost'}:${port+1 || 3001}/mcp/reinitialize`
    const headers: Record<string, string> = { 'Accept': 'application/json' }
    if (api_key) headers['Authorization'] = `Bearer ${api_key}`
    const res = await fetch(url, { method: 'POST', headers })
    return { ok: res.ok, status: res.status }
  } catch (e) {
    console.warn('reinitialize-mcp IPC failed:', e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

// IPC: Validate an MCP server definition via backend HTTP (avoids CORS)
ipcMain.handle('validate-mcp', async (_event, payload: { name?: string; command: string; args?: string[]; env?: Record<string, string>; timeout_s?: number }) => {
  try {
    // Ensure the Wizard API is running (it serves /verify)
    const { host } = await readServerConfig()
    await startSetupWizardApi(host, SETUP_WIZARD_API_PORT)
    const url = `http://${host || 'localhost'}:${SETUP_WIZARD_API_PORT}/verify`
    const headers: Record<string, string> = { 'Accept': 'application/json', 'Content-Type': 'application/json' }
    const body = JSON.stringify({
      servers: [
        {
          name: payload.name || 'validation',
          command: payload.command,
          args: payload.args || [],
          env: payload.env || {},
          enabled: true
        }
      ]
    })
    const res = await fetch(url, { method: 'POST', headers, body })
    const data = await res.json().catch(() => ({}))
    // Map Wizard response to validate shape { data.valid, data.error }
    const firstName = payload.name || 'validation'
    const valid = Boolean(data && data.results && data.results[firstName])
    return { ok: res.ok, status: res.status, data: { valid, raw: data } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

// IPC: Add MCP server to config.json and request reinitialize
ipcMain.handle('add-mcp-server', async (_event, payload: { name: string; command: string; args?: string[]; env?: Record<string, string> }) => {
  try {
    const configPath = join(app.getPath('userData'), 'config.json')
    let raw = '{}'
    try { raw = await readFile(configPath, 'utf8') } catch {}
    let config: any
    try { config = JSON.parse(raw || '{}') } catch { config = {} }
    if (!config || typeof config !== 'object') config = {}
    if (!Array.isArray(config.mcp_servers)) config.mcp_servers = []

    const existingIdx = config.mcp_servers.findIndex((s: any) => s && s.name === payload.name)
    const entry = {
      name: payload.name,
      command: payload.command,
      args: Array.isArray(payload.args) ? payload.args : [],
      env: payload.env || {},
      enabled: true
    }
    if (existingIdx >= 0) config.mcp_servers[existingIdx] = entry
    else config.mcp_servers.push(entry)

    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')

    // trigger reinitialize
    try {
      const { host, port, api_key } = await readServerConfig()
      const apiPort = (typeof port === 'number' ? port + 1 : 3001)
      const url = `http://${host || 'localhost'}:${apiPort}/mcp/reinitialize`
      const headers: Record<string, string> = { 'Accept': 'application/json' }
      if (api_key) headers['Authorization'] = `Bearer ${api_key}`
      await fetch(url, { method: 'POST', headers }).catch(() => {})
    } catch {}

    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

// IPC handlers for persisting ngrok settings
ipcMain.handle('get-ngrok-settings', async () => {
  try {
    const configPath = join(app.getPath('userData'), 'config.json')
    let raw = '{}'
    try {
      raw = await readFile(configPath, 'utf8')
    } catch { }
    let config: any
    try {
      config = JSON.parse(raw || '{}')
    } catch {
      config = {}
    }
    const ngrok = (config && typeof config === 'object' && config.ngrok) || {}
    return {
      authToken: typeof ngrok.auth_token === 'string' ? ngrok.auth_token : '',
      domain: typeof ngrok.domain === 'string' ? ngrok.domain : '',
      url: typeof ngrok.url === 'string' ? ngrok.url : ''
    }
  } catch (e) {
    console.warn('get-ngrok-settings failed:', e)
    return { authToken: '', domain: '', url: '' }
  }
})

ipcMain.handle('save-ngrok-settings', async (_event, payload: { authToken?: string; domain?: string; url?: string }) => {
  try {
    const configPath = join(app.getPath('userData'), 'config.json')
    let raw = '{}'
    try {
      raw = await readFile(configPath, 'utf8')
    } catch { }
    let config: any
    try {
      config = JSON.parse(raw || '{}')
    } catch {
      config = {}
    }

    if (!config || typeof config !== 'object') config = {}
    if (!config.ngrok || typeof config.ngrok !== 'object') config.ngrok = {}

    if (Object.prototype.hasOwnProperty.call(payload, 'authToken')) {
      config.ngrok.auth_token = payload.authToken || ''
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'domain')) {
      config.ngrok.domain = payload.domain || ''
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'url')) {
      config.ngrok.url = payload.url || ''
    }

    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')
    return { success: true }
  } catch (e) {
    console.error('save-ngrok-settings failed:', e)
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
})

// Store processes for management
const processes = new Map<any, ChildProcess>()
const processCommands = new Map<any, string>()

// Process management handlers
ipcMain.handle('spawn-process', async (event, command: string, args: string[], env: any) => {
  try {
    console.log(`Spawning process: ${command} ${args.join(' ')}`)
    const { spawn } = require('child_process')
    const fs = require('fs')

    // Ensure PATH includes common Homebrew locations (macOS GUI apps often have a minimal PATH)
    const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
    const mergedPath = `${extraPaths.join(':')}:${process.env.PATH || ''}`

    // Try to resolve absolute command path for ngrok specifically
    let resolvedCommand = command
    if (command === 'ngrok') {
      const candidates = [
        process.env.NGROK_PATH,
        '/opt/homebrew/bin/ngrok',
        '/usr/local/bin/ngrok',
        '/usr/bin/ngrok'
      ].filter(Boolean)
      for (const candidate of candidates) {
        try {
          if (candidate && fs.existsSync(candidate)) {
            resolvedCommand = candidate
            break
          }
        } catch { }
      }
    }

    console.log(`Using command: ${resolvedCommand} (PATH=${mergedPath})`)

    const childProcess = spawn(resolvedCommand, args, {
      env: { ...process.env, PATH: mergedPath, ...env },
      stdio: 'pipe',
      shell: true
    })

    // Store process reference for cleanup
    const processId = Date.now() // Simple ID for tracking
    processes.set(processId, childProcess)
    processCommands.set(processId, command)
    if (command === 'ngrok') { isNgrokRunning = true; ngrokProcessCount++ }

    console.log(`Process spawned with ID: ${processId}`)

    // Handle process output
    childProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString()
      console.log(`${command} stdout:`, output)

      // For ngrok, try to extract the tunnel URL
      if (command === 'ngrok') {
        const urlMatch = output.match(/https:\/\/[a-zA-Z0-9-]+\.ngrok-free\.app/)
        if (urlMatch) {
          console.log('Found ngrok URL:', urlMatch[0])
          // Send the URL to the renderer process
          if (mainWindow) {
            mainWindow.webContents.send('ngrok-url', urlMatch[0])
          }
        }
      }
    })
    childProcess.stderr?.on('data', (data: Buffer) => {
      console.log(`${command} stderr:`, data.toString())
    })

    childProcess.on('error', (error: Error) => {
      console.error(`Process ${command} error:`, error)
      // Send error to renderer process
      if (mainWindow) {
        mainWindow.webContents.send('process-error', { processId, error: error.message })
      }
    })
    childProcess.on('exit', (code: number) => {
      console.log(`Process ${command} exited with code:`, code)
      processes.delete(processId)
      processCommands.delete(processId)
      if (command === 'ngrok') { ngrokProcessCount = Math.max(0, ngrokProcessCount - 1); isNgrokRunning = ngrokProcessCount > 0 }

      // If process exited with error code, notify renderer
      if (code !== 0 && mainWindow) {
        console.log(`Sending process exit error for ${command} with code ${code}`)
        mainWindow.webContents.send('process-exit-error', { processId, code })
      }
    })

    return processId
  } catch (error) {
    console.error('Error spawning process:', error)
    throw error
  }
})

ipcMain.handle('terminate-process', async (event, processId: any) => {
  try {
    console.log(`Terminating process ${processId}`)
    const childProcess = processes.get(processId)

    if (childProcess) {
      console.log('Found process, terminating...')
      childProcess.kill()
      processes.delete(processId)
      const cmd = processCommands.get(processId)
      processCommands.delete(processId)
      if (cmd === 'ngrok') { ngrokProcessCount = Math.max(0, ngrokProcessCount - 1); isNgrokRunning = ngrokProcessCount > 0 }
      console.log('Process terminated successfully')
    } else {
      console.log('Process not found in registry')
    }
  } catch (error) {
    console.error('Error terminating process:', error)
    throw error
  }
})

// Compose help email with optional logs attachment
ipcMain.handle('compose-help-email', async (event, payload: { subject: string; body: string; attachLogs?: boolean; logsText?: string }) => {
  try {
    const toAddress = 'support@edison.watch'

    if (process.platform === 'darwin') {
      // On macOS, use AppleScript to compose an email with optional attachment in Mail.app
      let attachmentPath: string | null = null
      if (payload.attachLogs && payload.logsText) {
        const fs = require('fs')
        const path = require('path')
        const dir = app.getPath('userData')
        const filenameSafeTime = new Date().toISOString().replace(/[:.]/g, '-')
        const filename = `open-edison-debug-logs-${filenameSafeTime}.txt`
        attachmentPath = path.join(dir, filename)
        try {
          fs.writeFileSync(attachmentPath, payload.logsText, 'utf8')
        } catch (writeErr) {
          console.warn('Failed to write logs file for attachment:', writeErr)
          attachmentPath = null
        }
      }

      const escapeForAppleScript = (s: string) => (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const subject = escapeForAppleScript(payload.subject)
      const body = escapeForAppleScript(payload.body + (payload.attachLogs ? '\n\n(Logs file attached.)' : ''))

      const lines: string[] = []
      lines.push('tell application "Mail"')
      lines.push(`set newMessage to make new outgoing message with properties {subject:"${subject}", content:"${body}"}`)
      lines.push('tell newMessage')
      lines.push(`make new to recipient at end of to recipients with properties {address:"${toAddress}"}`)
      if (attachmentPath) {
        lines.push('tell content')
        lines.push(`make new attachment with properties {file name:POSIX file "${attachmentPath}"} at after last paragraph`)
        lines.push('end tell')
      }
      lines.push('activate')
      lines.push('end tell')
      lines.push('open newMessage')
      lines.push('activate')
      lines.push('end tell')

      const script = lines.join('\n')
      const child = spawn('osascript', ['-e', script], { stdio: 'pipe', shell: true })
      return new Promise((resolve) => {
        child.on('exit', (code) => {
          resolve({ success: code === 0, attachmentPath })
        })
        child.on('error', (err) => {
          console.error('osascript error:', err)
          resolve({ success: false, attachmentPath, error: err instanceof Error ? err.message : String(err) })
        })
      })
    }

    // Fallback for non-macOS: open a mailto link without attachment
    const mailto = `mailto:${toAddress}?subject=${encodeURIComponent(payload.subject)}&body=${encodeURIComponent(payload.body)}`
    shell.openExternal(mailto)
    return { success: true }
  } catch (error) {
    console.error('Error composing help email:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

// Dashboard view management using WebContentsView
ipcMain.handle('dashboard-create-or-show', async (event, bounds: { x: number; y: number; width: number; height: number }) => {
  try {
    if (!mainWindow) return { success: false, error: 'No main window' }
    const { WebContentsView } = require('electron')
    const urlInfo = await readServerConfig()
    const host = urlInfo.host || 'localhost'
    const apiKey = urlInfo.api_key || 'dev-api-key-change-me'
    // Force dashboard to backend HTTP port 3001 regardless of config and pass api_key in URL so it is available immediately on first load
    const dashUrl = `http://${host}:3001/dashboard/?embed=electron&api_key=${encodeURIComponent(apiKey)}`

    if (!dashboardView) {
      dashboardView = new WebContentsView({
        webPreferences: {
          partition: 'persist:dashboard',
          nodeIntegration: false,
          contextIsolation: true,
          javascript: true,
        }
      })
      dashboardView.webContents.loadURL(dashUrl)
      // Mark environment so dashboard can hide its own theme switch
      try { dashboardView.webContents.executeJavaScript("window.__ELECTRON_EMBED__ = true").catch(() => { }) } catch { }
      // Store api_key in localStorage for dashboard
      try { setApiKeyForDashboard(apiKey) } catch { }
      // When the dashboard finishes loading, apply the current theme
      try {
        dashboardView.webContents.on('did-finish-load', () => {
          try { setApiKeyForDashboard(apiKey) } catch { }
          try { applyThemeToDashboard(getEffectiveTheme(themeMode), themeMode) } catch { }
        })
      } catch { }
    }

    // Attach if not already attached
    const cv = (mainWindow as any).contentView
    try { cv.addChildView(dashboardView) } catch { }
    // Compute bounds below the header and to the right of sidebar in DIP
    const updateBounds = () => {
      try {
        const winBounds = mainWindow!.getContentBounds()
        const x = SIDEBAR_WIDTH_DIP
        const y = PAGE_HEADER_HEIGHT_DIP
        const width = Math.max(0, winBounds.width - SIDEBAR_WIDTH_DIP)
        const height = Math.max(0, winBounds.height - PAGE_HEADER_HEIGHT_DIP)
        dashboardView.setBounds({ x, y, width, height })
        dashboardView.setVisible(true)
      } catch { }
    }
    updateBounds()
    // Keep in sync on window resize
    const resizeHandler = () => updateBounds()
    try { mainWindow.on('resize', resizeHandler) } catch { }
    // Ensure theme is applied even if already loaded
    try { setApiKeyForDashboard(apiKey) } catch { }
    try { applyThemeToDashboard(getEffectiveTheme(themeMode), themeMode) } catch { }
    return { success: true }
  } catch (e) {
    console.error('dashboard-create-or-show error:', e)
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('dashboard-set-bounds', async (event, bounds: { x: number; y: number; width: number; height: number }) => {
  try {
    if (!mainWindow || !dashboardView) return { success: false }
    try {
      const winBounds = mainWindow.getContentBounds()
      const x = SIDEBAR_WIDTH_DIP
      const y = PAGE_HEADER_HEIGHT_DIP
      const width = Math.max(0, winBounds.width - SIDEBAR_WIDTH_DIP)
      const height = Math.max(0, winBounds.height - PAGE_HEADER_HEIGHT_DIP)
      dashboardView.setBounds({ x, y, width, height })
      dashboardView.setVisible(true)
    } catch { }
    return { success: true }
  } catch {
    return { success: false }
  }
})

ipcMain.handle('dashboard-hide', async () => {
  try {
    if (!mainWindow || !dashboardView) return { success: true }
    const cv = (mainWindow as any).contentView
    try { cv.removeChildView(dashboardView) } catch { }
    try { dashboardView.setVisible(false) } catch { }
    return { success: true }
  } catch {
    return { success: false }
  }
})

// Open DevTools for the dashboard view specifically (detached)
ipcMain.handle('dashboard-open-devtools', async () => {
  try {
    if (!dashboardView) return { success: false, error: 'No dashboard view' }
    try { dashboardView.webContents.openDevTools({ mode: 'detach' }) } catch {
      dashboardView.webContents.openDevTools()
    }
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
})

// Refresh dashboard with current API key
ipcMain.handle('dashboard-refresh', async () => {
  try {
    if (!dashboardView) return { success: false, error: 'No dashboard view' }
    const urlInfo = await readServerConfig()
    const host = urlInfo.host || 'localhost'
    const apiKey = urlInfo.api_key || 'dev-api-key-change-me'
    const dashUrl = `http://${host}:3001/dashboard/?api_key=${encodeURIComponent(apiKey)}`
    dashboardView.webContents.loadURL(dashUrl)
    return { success: true }
  } catch (e) {
    console.error('dashboard-refresh error:', e)
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
})
