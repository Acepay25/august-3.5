import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import dns from 'dns';
import * as process from 'process';

function devProviderProxy() {
  return {
    name: 'dev-provider-proxy',
    configureServer(server: any) {
      server.middlewares.use('/__provider_proxy', async (req: any, res: any, next: any) => {
        if (req.method !== 'POST') return next();
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const config = request?.config || {};
          const parsed = new URL(String(config.baseUrl || '').trim());
          if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname))) {
            throw new Error('Provider URLs must use HTTPS. HTTP is allowed only for localhost.');
          }
          if (parsed.username || parsed.password || parsed.search || parsed.hash) {
            throw new Error('Provider URLs cannot include credentials, query parameters, or fragments.');
          }
          parsed.pathname = parsed.pathname.replace(/\/+$/, '');
          for (const suffix of ['/chat/completions', '/messages', '/responses']) {
            if (parsed.pathname.endsWith(suffix)) {
              parsed.pathname = parsed.pathname.slice(0, -suffix.length).replace(/\/+$/, '');
              break;
            }
          }
          const baseUrl = parsed.toString().replace(/\/$/, '');
          const apiKey = String(config.apiKey || '').trim();
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          let url = '';
          let body: Record<string, unknown>;
          if (config.apiFormat === 'chat_completions') {
            url = `${baseUrl}/chat/completions`;
            if (apiKey && apiKey !== 'not-needed') headers.Authorization = `Bearer ${apiKey}`;
            body = { model: config.selectedModel, messages: request.messages || [], max_tokens: request.maxTokens ?? 4096, temperature: request.temperature ?? 0.7 };
            if (request.jsonMode) body.response_format = { type: 'json_object' };
          } else if (config.apiFormat === 'messages') {
            url = `${baseUrl}/messages`;
            if (apiKey) headers['x-api-key'] = apiKey;
            headers['anthropic-version'] = '2023-06-01';
            const messages = request.messages || [];
            const system = messages.find((message: any) => message?.role === 'system');
            body = { model: config.selectedModel, max_tokens: request.maxTokens ?? 4096, messages: messages.filter((message: any) => message?.role !== 'system') };
            if (system) body.system = typeof system.content === 'string' ? system.content : '';
          } else if (config.apiFormat === 'responses') {
            url = `${baseUrl}/responses`;
            if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
            body = { model: config.selectedModel, input: request.messages || [], max_output_tokens: request.maxTokens ?? 4096, temperature: request.temperature ?? 0.7 };
          } else {
            throw new Error('Unknown provider API format.');
          }
          let upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
          if (!upstream.ok && request.jsonMode && (upstream.status === 400 || upstream.status === 422) && body.response_format) {
            const fallbackBody = { ...body };
            delete fallbackBody.response_format;
            upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(fallbackBody), signal: AbortSignal.timeout(120000) });
          }
          let text = await upstream.text();
          if (upstream.ok && request.jsonMode && body.response_format) {
            try {
              const parsed = JSON.parse(text);
              const message = parsed?.choices?.[0]?.message || {};
              const content = Array.isArray(message.content)
                ? message.content.filter((part: any) => typeof part?.text === 'string').map((part: any) => part.text).join('')
                : message.content;
              const reasoning = message.reasoning_content || message.reasoning;
              if (!content && !reasoning) {
                const fallbackBody = { ...body };
                delete fallbackBody.response_format;
                upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(fallbackBody), signal: AbortSignal.timeout(120000) });
                text = await upstream.text();
              }
            } catch { /* non-JSON output is handled by the client parser */ }
          }
          res.statusCode = upstream.status;
          res.setHeader('Content-Type', 'application/json');
          let reasoning = '';
          let message = '';
          try {
            const parsed = JSON.parse(text);
            reasoning = parsed.choices?.[0]?.message?.reasoning_content || parsed.choices?.[0]?.message?.reasoning || '';
            message = parsed.error?.message || parsed.error?.error?.message || parsed.message || parsed.detail || '';
          } catch { /* provider returned non-JSON content */ }
          if (!message && !upstream.ok) message = text.replace(/\s+/g, ' ').trim().slice(0, 300);
          // Successful analysis responses can be larger than 2,000 characters;
          // truncating them produces invalid JSON in the renderer. Only cap
          // failed response bodies because they are diagnostic text.
          res.end(JSON.stringify({ ok: upstream.ok, status: upstream.status, body: upstream.ok ? text : text.slice(0, 2000), reasoning, message }));
        } catch (error) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          const message = error instanceof Error ? error.message : 'Provider proxy failed.';
          res.end(JSON.stringify({ ok: false, status: 502, message: `Provider proxy could not reach the configured endpoint: ${message}` }));
        }
      });
    },
  };
}

// Fix for a common issue with Node.js v17+ DNS resolution.
// This ensures 'localhost' resolves correctly.
dns.setDefaultResultOrder('verbatim');

// https://vitejs.dev/config/
export default defineConfig(() => {
  return {
    base: './', // Crucial: relative paths for Electron
    plugins: [react(), tailwindcss(), devProviderProxy()],
    resolve: {
      alias: {
        '@': process.cwd(),
      },
    },
    server: {
      // Adding server config to ensure it runs smoothly
      host: '0.0.0.0',
      port: 3000,
      // Development assets must never be served from a stale browser cache.
      // Vite HMR remains responsible for live updates while this also makes
      // hard refreshes reliably pick up the current source.
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
    build: {
      sourcemap: false,
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
