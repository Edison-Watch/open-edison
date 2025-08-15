import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = resolve(__dirname, '..')
import react from '@vitejs/plugin-react'

const localSavePlugin = () => ({
    name: 'local-save-json',
    configureServer(server: any) {
        server.middlewares.use('/__save_json__', async (req: any, res: any, next: any) => {
            if (req.method !== 'POST') return next()
            try {
                let body = ''
                await new Promise<void>((resolve) => {
                    req.on('data', (chunk: any) => { body += chunk })
                    req.on('end', () => resolve())
                })
                const data = JSON.parse(body || '{}') as { path?: string; name?: string; content?: string }
                // Accept either { path, content } or { name, content }
                let targetPath: string | null = null
                if (data.path && typeof data.path === 'string') {
                    targetPath = data.path
                } else if (data.name && typeof data.name === 'string') {
                    // Restrict to known config filenames
                    const allowed = new Set(['config.json', 'tool_permissions.json', 'resource_permissions.json', 'prompt_permissions.json'])
                    if (!allowed.has(data.name)) {
                        res.statusCode = 400
                        res.end('Invalid filename')
                        return
                    }
                    targetPath = path.join(projectRoot, data.name)
                }
                if (!targetPath) {
                    res.statusCode = 400
                    res.end('Invalid path or name')
                    return
                }
                const normalized = path.resolve(projectRoot, path.relative(projectRoot, targetPath))
                if (!normalized.startsWith(projectRoot)) {
                    res.statusCode = 400
                    res.end('Path outside project root')
                    return
                }
                await fs.writeFile(normalized, data.content ?? '', 'utf8')
                res.statusCode = 200
                res.setHeader('content-type', 'application/json')
                res.end(JSON.stringify({ ok: true }))
            } catch (e: any) {
                res.statusCode = 500
                res.end(`Save failed: ${e?.message || 'unknown error'}`)
            }
        })
    }
})

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react(), localSavePlugin()],
    define: {
        __PROJECT_ROOT__: JSON.stringify(projectRoot),
    },
    server: {
        port: 5173,
        strictPort: true,
        fs: {
            // Allow reading files from the monorepo root so we can fetch the live SQLite db via @fs
            allow: [projectRoot],
        },
        // Local save endpoint is provided by localSavePlugin
        // No proxy needed; we read the SQLite db directly using sql.js
    },
})


