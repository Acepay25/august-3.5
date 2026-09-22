/**
 * mock-provider — a local OpenAI-compatible chat-completions endpoint for
 * driving the real UI in a browser.
 *
 * WHY: the app configures providers in-app and refuses to send anything until a
 * provider is "ready", so every browser-level check of the chat surface, the
 * verdict panels, the streaming rows and the run audit was previously
 * impossible without spending real API calls against a real account. This
 * answers in milliseconds and costs nothing, which is what makes an end-to-end
 * UI test repeatable.
 *
 * Loopback plain-HTTP is explicitly allowed by
 * `shared/providerRequestPolicy.cjs` (the rule exists for Ollama and friends),
 * so this reads to the app as an ordinary local model server.
 *
 *   node scripts/mock-provider.cjs            # port 8787
 *   node scripts/mock-provider.cjs 8899       # another port
 *
 * Provider config to add in Settings → Providers:
 *   name mock · apiFormat chat_completions · baseUrl http://127.0.0.1:8787/v1
 *   apiKey mock-key · model mock-mini
 */

const http = require('http');

const PORT = Number(process.argv[2] || 8787);
const MODEL = 'mock-mini';

const cors = (res, req) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    // Echo the requested headers rather than a fixed list: the app sends
    // Authorization for chat_completions and x-api-key for messages format,
    // and a preflight that doesn't name the one actually sent fails the real
    // request with a bare "Connection error".
    res.setHeader('Access-Control-Allow-Headers',
        req.headers['access-control-request-headers'] || 'content-type, authorization, x-api-key');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    // Chrome's Private Network Access: a page on 127.0.0.1:4183 asking a
    // different port on 127.0.0.1 is a public→private request, and the preflight
    // is only satisfied by this header. Invisible under `npm run dev`, where the
    // vite proxy keeps every provider call same-origin.
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Vary', 'Origin, Access-Control-Request-Headers');
};

/** A reply that quotes the last user turn, so a browser check can tell WHICH
 *  message rendered where. */
const replyTo = (body) => {
    const msgs = Array.isArray(body && body.messages) ? body.messages : [];
    const lastUser = [...msgs].reverse().find(m => m && m.role === 'user');
    const raw = typeof lastUser?.content === 'string'
        ? lastUser.content
        : Array.isArray(lastUser?.content)
            ? (lastUser.content.find(p => p?.type === 'text')?.text ?? '')
            : '';
    const quoted = String(raw).replace(/\s+/g, ' ').trim().slice(0, 160);
    return `MOCK REPLY for "${quoted}" — the desk is up, the feed is live, and this answer came from the local mock.`;
};

const stream = (res, text) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
    });
    // Chunk it: a single giant delta would never exercise the streaming rows.
    const words = text.split(' ');
    let i = 0;
    const tick = () => {
        if (res.writableEnded) return;
        if (i >= words.length) {
            res.write('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n');
            res.write('data: [DONE]\n\n');
            res.end();
            return;
        }
        const piece = words.slice(i, i + 4).join(' ');
        i += 4;
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `${piece} ` } }] })}\n\n`);
        setTimeout(tick, 12);
    };
    tick();
};

const server = http.createServer((req, res) => {
    cors(res, req);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.url.endsWith('/models') && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: MODEL, object: 'model' }] }));
        return;
    }

    if (!req.url.includes('/chat/completions')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `mock-provider: no route ${req.url}` } }));
        return;
    }

    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
        let body = {};
        try { body = JSON.parse(raw || '{}'); } catch { /* keep the default */ }
        const text = replyTo(body);
        if (body.stream) { stream(res, text); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            model: MODEL,
            choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 40, completion_tokens: 40, total_tokens: 80 },
        }));
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[mock-provider] http://127.0.0.1:${PORT}/v1  (model ${MODEL})`);
});
