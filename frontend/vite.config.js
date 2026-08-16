import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev proxy: every /api/* request from the browser is forwarded to the
// FastAPI backend with the /api prefix stripped, e.g.
//   /api/analyze  ->  http://127.0.0.1:8000/analyze
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})