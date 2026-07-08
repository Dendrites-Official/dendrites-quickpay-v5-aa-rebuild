import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // @walletconnect/heartbeat ships a broken package.json whose main/module
      // fields point to files that don't exist in the installed dist folder.
      // Vite 7 / Rollup 4 are strict about this, so redirect to the UMD bundle
      // that is actually present.
      '@walletconnect/heartbeat': path.resolve(
        __dirname,
        'node_modules/@walletconnect/heartbeat/dist/index.umd.js'
      ),
    },
  },
})
