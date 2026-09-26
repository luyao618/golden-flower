import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), {
    name: 'isolated-rebuild-html',
    transformIndexHtml(html) {
      if (loadEnv(mode, process.cwd(), 'VITE_').VITE_WEB_GAME_REBUILD !== '1') return html
      // The legacy HTML (including its font behavior) stays byte-for-byte intact.
      // Rebuild scenarios need only same-origin static assets, never remote fonts.
      return html.replace('<html lang="en">', '<html lang="zh-CN">')
        .replace(/^\s*<link\b[^>]*href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>\s*$/gm, '')
    },
  }],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
}))
