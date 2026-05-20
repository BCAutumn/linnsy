import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const requestedPort = Number.parseInt(process.env.LINNSY_FRONTEND_PORT ?? '5173', 10);
const frontendPort = Number.isFinite(requestedPort) ? requestedPort : 5173;

export default defineConfig({
  plugins: [react()],
  root: new URL('.', import.meta.url).pathname,
  clearScreen: false,
  resolve: {
    alias: {
      '@renderer/contracts': new URL('./src/contracts/shared.ts', import.meta.url).pathname
    }
  },
  server: {
    host: '127.0.0.1',
    port: frontendPort,
    strictPort: true
  },
  build: {
    outDir: '../../dist/frontend',
    emptyOutDir: true
  }
});
