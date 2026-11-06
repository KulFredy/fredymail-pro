import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const api = 'http://127.0.0.1:4747';

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  build: { outDir: path.resolve(__dirname, 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: {
    port: 5173,
    proxy: { '/api': api, '/files': api, '/luts': api, '/m': api },
  },
});
