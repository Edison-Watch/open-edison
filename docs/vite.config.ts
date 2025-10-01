import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, '.'),
        },
    },
    assetsInclude: ['**/*.md', '**/*.mdx'],
    server: {
        port: 3001,
        open: true,
        fs: {
            // Allow serving files from the docs directory
            allow: ['.']
        }
    }
})
