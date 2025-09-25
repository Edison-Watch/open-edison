import { app, BrowserWindow, shell, ipcMain, protocol } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { readFile } from 'fs/promises'

// Keep a global reference of the window object
let mainWindow: BrowserWindow | null = null
let wizardWindow: BrowserWindow | null = null
let backendProcess: ChildProcess | null = null
let frontendProcess: ChildProcess | null = null
let reactProcess: ChildProcess | null = null
let setupWizardApiProcess: ChildProcess | null = null
let isBackendRunning = false
let isSetupWizardApiRunning = false

let BACKEND_PORT = 3001
const FRONTEND_PORT = 3001
const SETUP_WIZARD_API_PORT = 3002

// Force first install mode (for testing/development)
const FORCE_FIRST_INSTALL = process.env.FORCE_FIRST_INSTALL === 'true' || process.argv.includes('--force-first-install')

// Read host and port from config.json
async function readServerConfig(): Promise<{ host: string; port: number }> {
  const configPath = join(app.getPath('userData'), 'config.json')
  try {
    const configData = await readFile(configPath, 'utf8')
    const config = JSON.parse(configData)
    return {
      host: config.server?.host || 'localhost',
      port: config.server?.port || 3000
    }
  } catch (error) {
    console.error('Failed to read config.json:', error)
    return {
      host: 'localhost',
      port: 3000
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
    
    // Try different methods to start the backend
    const startMethods = [
      () => spawn('uv', ['run', 'python', '-m', 'src.gui'], { cwd: projectRoot, stdio: 'pipe', shell: true }),
      // // Method 0: Try uv open-edison (recommended for uv users)
      // () => spawn('uv', ['run', 'open-edison'], { cwd: projectRoot, stdio: 'pipe', shell: true }),
      // // Method 1: Try uvx open-edison (recommended for uv users)
      // () => spawn('uvx', ['open-edison'], { cwd: projectRoot, stdio: 'pipe', shell: true }),
      // // Method 1: Try uvx open-edison (recommended for uv users)
      // () => spawn('uvx', ['open-edison'], { cwd: projectRoot, stdio: 'pipe', shell: true }),
      // // Method 2: Try open-edison command (if installed globally)
      // () => spawn('open-edison', [], { cwd: projectRoot, stdio: 'pipe', shell: true }),
      // // Method 3: Try python -m src.cli
      // () => spawn('python', ['-m', 'src.cli'], { cwd: projectRoot, stdio: 'pipe', shell: true }),
      // // Method 4: Try python3 -m src.cli
      // () => spawn('python3', ['-m', 'src.cli'], { cwd: projectRoot, stdio: 'pipe', shell: true }),
      // // Method 5: Try direct python execution
      // () => spawn('python', ['main.py'], { cwd: projectRoot, stdio: 'pipe', shell: true }),
      // // Method 6: Try python3 direct execution
      // () => spawn('python3', ['main.py'], { cwd: projectRoot, stdio: 'pipe', shell: true })
    ]

    let methodIndex = 0
    let startupSuccessful = false

    while (methodIndex < startMethods.length && !startupSuccessful) {
      try {
        console.log(`Trying startup method ${methodIndex + 1}...`)
        backendProcess = startMethods[methodIndex]()
        
        backendProcess.stdout?.on('data', (data) => {
          const message = data.toString()
          console.log('Api-OpenEdison:', message)
          // Send log to renderer process
          if (mainWindow) {
            mainWindow.webContents.send('backend-log', { type: 'stdout', message })
          }
        })

        backendProcess.stderr?.on('data', (data) => {
          const message = data.toString()
          console.log('Mcp-OpenEdison:', message)
          // Send log to renderer process
          if (mainWindow) {
            mainWindow.webContents.send('backend-log', { type: 'stderr', message })
          }
        })

        backendProcess.on('error', (error) => {
          console.log(`Method ${methodIndex + 1} failed:`, error.message)
          methodIndex++
        })

        backendProcess.on('exit', (code) => {
          console.log('Backend process exited with code:', code)
          isBackendRunning = false
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
    
    // Start the Setup Wizard API server
    setupWizardApiProcess = spawn('uv', ['run', 'python', '-m', 'src.mcp_importer.wizard_server', '--host', host, '--port', port.toString()], {
      cwd: projectRoot,
      stdio: 'pipe',
      shell: true
    })
    
    setupWizardApiProcess.stdout?.on('data', (data) => {
      const message = data.toString()
      console.log('Setup-Wizard-API-1:', message)
      // Send log to renderer process
      if (mainWindow) {
        mainWindow.webContents.send('setup-wizard-api-log', { type: 'stdout', message })
      }
    })

    setupWizardApiProcess.stderr?.on('data', (data) => {
      const message = data.toString()
      console.log('Setup-Wizard-API-2:', message)
      // Send log to renderer process
      if (mainWindow) {
        mainWindow.webContents.send('setup-wizard-api-log', { type: 'stderr', message })
      }
    })

    setupWizardApiProcess.on('error', (error) => {
      console.log('Setup Wizard API startup failed:', error.message)
    })

    setupWizardApiProcess.on('exit', (code) => {
      console.log('Setup Wizard API process exited with code:', code)
      isSetupWizardApiRunning = false
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

    frontendProcess.stdout?.on('data', (data) => {
      console.log('Frontend stdout:', data.toString())
    })

    frontendProcess.stderr?.on('data', (data) => {
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

    reactProcess.stdout?.on('data', (data) => {
      console.log('React stdout:', data.toString())
    })

    reactProcess.stderr?.on('data', (data) => {
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
      webSecurity: true, // Keep web security enabled
      allowRunningInsecureContent: false
    },
    show: false, // Don't show until ready
    title: 'Open Edison Desktop'
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
    // Open DevTools in development
    mainWindow.webContents.openDevTools()
  }

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
  })

  // Handle navigation errors
  wizardWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription: string, validatedURL: string) => {
    console.error('Wizard failed to load:', errorDescription, 'for URL:', validatedURL)
  })
}

// Register custom protocol for serving local files
app.whenReady().then(() => {
  protocol.registerFileProtocol('app', (request, callback) => {
    const url = request.url.substr(6) // Remove 'app://' prefix
    // Remove query parameters from the URL before creating file path
    const cleanUrl = url.split('?')[0]
    const filePath = join(__dirname, cleanUrl)
    console.log(`Protocol request: ${request.url} -> ${filePath}`)
    callback({ path: filePath })
  })
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
  
  // Start Setup Wizard API server
  // await startSetupWizardApi(host, SETUP_WIZARD_API_PORT)
  
  // Always start frontend server (needed for proper asset loading)
  // await startFrontend(host, port+1)
  
  // Create the main window
  await createWindow()
}

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  console.log('Electron app ready, checking installation...')

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

// Check Open Edison installation and initialize if needed
const installOpenEdison = async (): Promise<boolean> => {
  try {
    const appSupportPath = app.getPath('userData')
    console.log('App support path:', appSupportPath)
    const fs = require('fs')
    const path = require('path')
    
    const folderExists = fs.existsSync(appSupportPath)

    // Assert that the application support directory exists
    if (!folderExists) {
      throw new Error(`Application directory ${appSupportPath} does not exist`)
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
          "port": 3000
        },
        "mcp_servers": {},
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
