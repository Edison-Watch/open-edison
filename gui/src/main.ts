import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'

// Keep a global reference of the window object
let mainWindow: BrowserWindow | null = null
let backendProcess: ChildProcess | null = null
let frontendProcess: ChildProcess | null = null
let reactProcess: ChildProcess | null = null
let isBackendRunning = false

const BACKEND_PORT = 3001
const FRONTEND_PORT = 5173

// Check if backend is already running
async function checkBackendRunning(): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${BACKEND_PORT}/health`)
    return response.ok
  } catch {
    return false
  }
}

// Start the backend server
async function startBackend(): Promise<void> {
  if (isBackendRunning) {
    console.log('Backend already running')
    return
  }

  try {
    // Check if backend is already running
    if (await checkBackendRunning()) {
      console.log('Backend server already running on port', BACKEND_PORT)
      isBackendRunning = true
      return
    }

    console.log('Starting Open Edison backend server...')
    
    // Get the project root (parent directory of gui folder)
    const projectRoot = join(__dirname, '..', '..')
    
    // Try different methods to start the backend
    const startMethods = [
      // Method 1: Try uvx open-edison (recommended for uv users)
      () => spawn('uvx', ['open-edison'], { cwd: projectRoot, stdio: 'pipe', shell: true }),
      // Method 2: Try open-edison command (if installed globally)
      () => spawn('open-edison', [], { cwd: projectRoot, stdio: 'pipe', shell: true }),
      // Method 3: Try python -m src.cli
      () => spawn('python', ['-m', 'src.cli'], { cwd: projectRoot, stdio: 'pipe', shell: true }),
      // Method 4: Try python3 -m src.cli
      () => spawn('python3', ['-m', 'src.cli'], { cwd: projectRoot, stdio: 'pipe', shell: true }),
      // Method 5: Try direct python execution
      () => spawn('python', ['main.py'], { cwd: projectRoot, stdio: 'pipe', shell: true }),
      // Method 6: Try python3 direct execution
      () => spawn('python3', ['main.py'], { cwd: projectRoot, stdio: 'pipe', shell: true })
    ]

    let methodIndex = 0
    let startupSuccessful = false

    while (methodIndex < startMethods.length && !startupSuccessful) {
      try {
        console.log(`Trying startup method ${methodIndex + 1}...`)
        backendProcess = startMethods[methodIndex]()
        
        backendProcess.stdout?.on('data', (data) => {
          console.log('Backend stdout:', data.toString())
        })

        backendProcess.stderr?.on('data', (data) => {
          console.log('Backend stderr:', data.toString())
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
        if (await checkBackendRunning()) {
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

// Start the frontend development server
async function startFrontend(): Promise<void> {
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
    const frontendProcess = spawn('npm', ['run', 'dev'], {
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
      webSecurity: false, // Allow loading local files
      allowRunningInsecureContent: true
    },
    show: false, // Don't show until ready
    title: 'Open Edison Desktop'
  })

  // Load the React desktop interface as a static file
  const isDev = process.env.NODE_ENV === 'development'
  
  // Load the React app from the built HTML file
  const indexPath = join(__dirname, 'src', 'index.html')
  console.log(`Loading React desktop interface from ${indexPath}`)
  mainWindow.loadFile(indexPath)
  
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
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Handle navigation errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Failed to load:', errorDescription, 'for URL:', validatedURL)
  })
}

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  console.log('Electron app ready, starting services...')
  
  // Start backend server
  await startBackend()
  
  // Always start frontend server (needed for proper asset loading)
  await startFrontend()
  
  // Wait for frontend to be ready
  let attempts = 0
  const maxAttempts = 30
  while (attempts < maxAttempts) {
    try {
      const response = await fetch(`http://localhost:${FRONTEND_PORT}`)
      if (response.ok) {
        console.log('Frontend server is ready')
        break
      }
    } catch {
      // Frontend not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
    attempts++
  }
  
  // Create the main window
  await createWindow()
})

// Quit when all windows are closed
app.on('window-all-closed', () => {
  // Kill backend process when app closes
  if (backendProcess) {
    console.log('Terminating backend process...')
    backendProcess.kill()
  }
  
  // Kill frontend process when app closes
  if (frontendProcess) {
    console.log('Terminating frontend process...')
    frontendProcess.kill()
  }
  
  
  // On macOS, keep the app running even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On macOS, re-create a window when the dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Handle app termination
app.on('before-quit', () => {
  if (backendProcess) {
    console.log('Terminating backend process...')
    backendProcess.kill()
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
