import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig(({ command }) => {
  const isDev = command === 'serve'
  
  if (isDev) {
    // Development server configuration for React app
    return {
      plugins: [react()],
      resolve: {
        alias: {
          '@': resolve(__dirname, 'src')
        }
      },
      server: {
        port: 5174,
        strictPort: true
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify('development')
      }
    }
  } else {
    // Build configuration for Electron
    return {
      plugins: [react()],
      resolve: {
        alias: {
          '@': resolve(__dirname, 'src')
        }
      },
      build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
          input: {
            main: resolve(__dirname, 'src/main.ts'),
            preload: resolve(__dirname, 'src/preload.ts'),
            index: resolve(__dirname, 'src/index.html')
          },
          external: ['electron', 'child_process', 'fs', 'fs/promises', 'path', 'url'],
          output: {
            format: 'cjs', // Output CommonJS for Electron
            entryFileNames: (chunkInfo) => {
              if (chunkInfo.name === 'main') return 'main.js'
              if (chunkInfo.name === 'preload') return 'preload.js'
              return 'assets/[name]-[hash].js'
            },
            // Ensure relative paths for assets
            assetFileNames: 'assets/[name]-[hash][extname]'
          }
        },
        // Ensure assets are copied and paths are relative
        assetsDir: 'assets',
        copyPublicDir: false,
        // Use relative paths for static file loading
        base: './',
        // Ensure all asset paths are relative
        publicDir: false
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
      }
    }
  }
})