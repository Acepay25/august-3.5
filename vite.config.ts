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
          const hostname = parsed.hostname.toLowerCase();
          const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1' || hostname === '0.0.0.0' ||
            /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
            /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
            /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
            /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
            /^169\.254\.\d{1,3}\.\d{1,3}$/.test(hostname);
          if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocal)) {
            throw new Error('Provider URLs must use HTTPS. HTTP is allowed only for localhost and private LAN addresses.');
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
          const messages = request.messages || [];
          if (config.apiFormat === 'chat_completions') {
            url = `${baseUrl}/chat/completions`;
            if (apiKey && apiKey !== 'not-needed') headers.Authorization = `Bearer ${apiKey}`;
            body = { model: config.selectedModel, messages: request.messages || [], max_tokens: request.maxTokens ?? 4096, temperature: request.temperature ?? 0.7 };
            if (request.jsonMode) body.response_format = { type: 'json_object' };
          } else if (config.apiFormat === 'messages') {
            url = `${baseUrl}/messages`;
            if (apiKey) headers['x-api-key'] = apiKey;
            headers['anthropic-version'] = '2023-06-01';
            const system = messages.find((message: any) => message?.role === 'system');
            body = { model: config.selectedModel, max_tokens: request.maxTokens ?? 4096, messages: messages.filter((message: any) => message?.role !== 'system').map((message: any) => ({ role: message.role, content: toAnthropicContent(message.content) })) };
            if (system) body.system = contentToText(system.content);
            // Extended thinking for thinking-capable Claude models (mirrors
            // GenericProviderService.messagesCall) — request a CoT budget so
            // `thinking` blocks come back; older models 400 on the block, so
            // gate by model id and skip tiny calls / JSON mode.
            if (!request.jsonMode && /claude-(?:3-7|sonnet-4|opus-4|haiku-4-5)/i.test(config.selectedModel) && (request.maxTokens ?? 4096) >= 4096) {
              body.thinking = { type: 'enabled', budget_tokens: Math.max(1024, Math.floor((request.maxTokens ?? 4096) * 0.35)) };
            }
          } else if (config.apiFormat === 'responses') {
            url = `${baseUrl}/responses`;
            if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
            const responsesMessages = messages.filter((message: any) => message?.role !== 'system');
            const responsesSystem = messages.find((message: any) => message?.role === 'system');
            body = {
              model: config.selectedModel,
              input: responsesMessages.map((message: any) => ({
                role: message.role,
                content: typeof message.content === 'string'
                  ? message.content
                  : (message.content || []).map((part: any) => part?.type === 'text'
                    ? { type: 'input_text', text: part.text }
                    : { type: 'input_image', image_url: part?.image_url?.url || '' })
              })),
              ...(responsesSystem ? { instructions: contentToText(responsesSystem.content) } : {}),
              max_output_tokens: request.maxTokens ?? 4096,
              temperature: request.temperature ?? 0.7
            };
          } else {
            throw new Error('Unknown provider API format.');
          }
          // Streaming (SSE) passthrough — used by streamChatRequest on localhost
          // so the renderer receives per-chunk deltas without CORS failures
          // (direct browser SDK calls are blocked by providers without CORS
          // headers, e.g. opencode). The renderer parses the SSE events.
          if (request.stream) {
            const streamBody: Record<string, unknown> = { ...body, stream: true };
            let sse = await fetch(url, { method: 'POST', headers, body: JSON.stringify(streamBody), signal: AbortSignal.timeout(300000) });
            if (!sse.ok && request.jsonMode && (sse.status === 400 || sse.status === 422) && streamBody.response_format) {
              const fallbackBody = { ...streamBody };
              delete fallbackBody.response_format;
              sse = await fetch(url, { method: 'POST', headers, body: JSON.stringify(fallbackBody), signal: AbortSignal.timeout(300000) });
            }
            if (!sse.ok || !sse.body) {
              const text = await sse.text();
              res.statusCode = sse.status;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, status: sse.status, body: text.slice(0, 2000), message: '', reasoning: '' }));
              return;
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            const reader = sse.body.getReader();
            const decoder = new TextDecoder();
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(decoder.decode(value, { stream: true }));
              }
            } catch (streamError) {
              // Mid-stream upstream failure: headers are already committed as
              // text/event-stream with a 200 status, so a JSON error body
              // would corrupt the stream and be silently dropped by the
              // renderer's SSE parser — the failure would look like a clean
              // completion. Emit an SSE error event instead; streamViaProxy
              // treats a chunk.error as a real failure and surfaces it.
              const message = streamError instanceof Error ? streamError.message : 'Provider stream interrupted.';
              res.write(`data: ${JSON.stringify({ error: { message, code: 'stream_interrupted' } })}\n\n`);
            } finally {
              reader.releaseLock();
            }
            res.end();
            return;
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
            message = parsed.error?.message || parsed.error?.error?.message || parsed.message || parsed.detail || '';
            // Per-format chain-of-thought extraction (mirrors the renderer's
            // GenericProviderService helpers so the proxy's `reasoning` field
            // covers all three formats, not just chat_completions).
            if (config.apiFormat === 'messages') {
              reasoning = extractMessagesThinking(parsed.content);
            } else if (config.apiFormat === 'responses') {
              reasoning = extractResponsesReasoning(parsed.output);
            } else {
              const msgReasoning = parsed.choices?.[0]?.message?.reasoning_content ?? parsed.choices?.[0]?.message?.reasoning;
              reasoning = Array.isArray(msgReasoning)
                ? msgReasoning.filter((part: any) => typeof part === 'string').join('\n')
                : (msgReasoning || '');
            }
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

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((part: any) => part?.type === 'text').map((part: any) => part.text).join('');
}

function toAnthropicContent(content: unknown): any[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  return content.map((part: any) => {
    if (part?.type === 'text') return { type: 'text', text: part.text };
    const url = part?.image_url?.url || '';
    const commaIndex = url.indexOf(',');
    if (url.startsWith('data:') && commaIndex !== -1) {
      const header = url.slice(5, commaIndex);
      const mimeMatch = header.match(/^image\/(png|jpeg|webp|gif)\b/i);
      const mediaType = mimeMatch ? `image/${mimeMatch[1].toLowerCase()}` : 'image/png';
      return { type: 'image', source: { type: 'base64', media_type: mediaType, data: url.slice(commaIndex + 1) } };
    }
    return { type: 'image', source: { type: 'url', url } };
  });
}

function extractMessagesThinking(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (block?.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
      parts.push(block.thinking.trim());
    } else if (block?.type === 'redacted_thinking') {
      parts.push('[Thinking redacted by provider]');
    }
  }
  return parts.join('\n');
}

function extractResponsesReasoning(output: unknown): string {
  if (!Array.isArray(output)) return '';
  const parts: string[] = [];
  for (const item of output) {
    if (item?.type !== 'reasoning') continue;
    if (Array.isArray(item.content)) {
      for (const block of item.content) {
        if (block?.type === 'output_text' && typeof block.text === 'string') parts.push(block.text);
      }
    }
    if (Array.isArray(item.summary)) {
      for (const block of item.summary) {
        if (block?.type === 'summary_text' && typeof block.text === 'string') parts.push(block.text);
      }
    }
  }
  return parts.join('\n');
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
      // Keep the unauthenticated development proxy local to this machine.
      host: '127.0.0.1',
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
            'vendor-ai': ['openai'],
            // NOTE: recharts + lightweight-charts intentionally have NO manual
            // chunk. A fixed 'vendor-charts' entry made rollup link the charts
            // chunk into vendor-react (shared-module hoisting), which put a
            // 363KB static import into the startup module graph and preloaded
            // it on every launch even though charts are only reachable through
            // lazy components (Journal, LiveMarket, VersionHistoryDashboard).
            // Without the entry they stay in their lazy consumer chunks.
            'vendor-crypto': ['technicalindicators'],
            'vendor-react': ['react', 'react-dom', 'react-virtuoso'],
          },
        },
      },
    },
  };
});
