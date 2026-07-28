import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import dns from 'dns';
import * as process from 'process';

// Fix for a common issue with Node.js v17+ DNS resolution.
// This ensures 'localhost' resolves correctly.
dns.setDefaultResultOrder('verbatim');

// https://vitejs.dev/config/
export default defineConfig(() => {
  return {
    base: './', // Crucial: relative paths for Electron
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': process.cwd(),
      },
    },
    server: {
      // Adding server config to ensure it runs smoothly
      host: '0.0.0.0',
      port: 3000,
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        external: ['protobufjs/minimal.js'],
        output: {
          manualChunks: {
            'vendor-ai': ['@google/genai', 'openai'],
            'vendor-charts': ['lightweight-charts', 'recharts'],
            'vendor-crypto': ['ccxt', 'technicalindicators'],
            'vendor-react': ['react', 'react-dom', 'react-virtuoso'],
          },
        },
      },
    },
  };
});