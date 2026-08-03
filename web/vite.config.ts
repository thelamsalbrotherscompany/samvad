import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // In dev, run the signalling worker with `bun --cwd worker dev` (wrangler, port
    // 8787). The app connects to a same-origin `/ws`, proxied here to the worker, so
    // the client uses one relative URL in dev and prod alike.
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      // ICE server list (STUN, plus TURN when the worker has credentials).
      '/ice': { target: 'http://localhost:8787' },
    },
  },
})
