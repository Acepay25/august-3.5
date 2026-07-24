import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import dns from 'dns';
import * as process from 'process';

// Fix for a common issue with Node.js v17+ DNS resolution.
// This ensures 'localhost' resolves correctly.
dns.setDefaultResultOrder('verbatim');

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // The third parameter ('') is an empty string to load all env variables,
  // regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: './', // Crucial: relative paths for Electron
    plugins: [react(), tailwindcss()],
    // This 'define' block is the key part.
    // It takes values from the loaded environment variables
    // and makes them available globally in your browser-side code.
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.DEEPSEEK_API_KEY': JSON.stringify(env.DEEPSEEK_API_KEY),
      'process.env.ZHIPU_API_KEY': JSON.stringify(env.ZHIPU_API_KEY),
      'process.env.GROQ_API_KEY': JSON.stringify(env.GROQ_API_KEY),
      'process.env.GROQ_NEW_API_KEY': JSON.stringify(env.GROQ_NEW_API_KEY),
      'process.env.GROQ_ALT2_API_KEY': JSON.stringify(env.GROQ_ALT2_API_KEY),
      'process.env.OPENAI_API_KEY': JSON.stringify(env.OPENAI_API_KEY),
      'process.env.OPENROUTER_API_KEY': JSON.stringify(env.OPENROUTER_API_KEY),
      'process.env.GROK_API_KEY': JSON.stringify(env.GROK_API_KEY),
    },
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