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

/**
 * OPT-IN tool-call scenario. `MOCK_TOOL_CALL=1` (or --tool-call) enables it.
 *
 * WHY: the desk tools are only reachable through a model turn, so the parts of
 * the proposal flow that live ABOVE the inbox — `propose_skill`'s own argument
 * parsing, the zod clause bar, `deterministicDraftGate`, and a queue write that
 * fails — could not be driven in a browser at all. Seeding a draft skips every
 * one of them.
 *
 * With the flag OFF nothing below runs: `toolScenario()` returns null on the
 * first line and the response is built by the same code as before. That is the
 * contract, because this file is a shared CI fixture used by boot-probe,
 * render-probe and the approval probe unchanged.
 */
const TOOL_SCENARIO = process.env.MOCK_TOOL_CALL === '1' || process.argv.includes('--tool-call');
const TOOL_NAME = process.env.MOCK_TOOL_NAME || 'propose_skill';

const DEFAULT_SKILL_ARGS = {
    name: 'Session-open fade short',
    kind: 'avoid',
    coin: 'ETH',
    when: 'price rallies into the first fifteen minutes of the US session and stalls at the open high',
    steps: JSON.stringify([
        'Mark the US session-open high on 15m',
        'Refuse longs under it until a close takes it out',
        'Short a reclaim failure with the stop above that high',
    ]),
    validate: 'Confirm the open high held twice on closing prices',
    output: 'A short with a defined stop above the session-open high',
    approval: 'A human approves this draft in the Coach inbox before it is applied',
    if_condition: 'us session open high held twice on closing prices',
    then_action: 'short a reclaim failure with the stop above that high',
    reason: 'the last three ETH longs taken at the open all stopped out',
};

/** The scripted call, or null when this request must get a plain reply.
 *  `MOCK_SKILL_ARGS` overrides the payload as a JSON object, which is how a
 *  caller tests the rejection paths (e.g. a 6-character if_condition). */
function toolScenario(body) {
    if (!TOOL_SCENARIO) return null;
    if (!Array.isArray(body.tools) || body.tools.length === 0) return null;
    const msgs = Array.isArray(body.messages) ? body.messages : [];
    // One shot only. After the app runs the tool it calls back with the result,
    // and re-emitting the same call would loop the turn forever.
    if (msgs.some(m => m && m.role === 'tool')) return null;
    let args = DEFAULT_SKILL_ARGS;
    if (process.env.MOCK_SKILL_ARGS) {
        try { args = JSON.parse(process.env.MOCK_SKILL_ARGS); } catch { /* keep the default */ }
    }
    return {
        model: MODEL,
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content: null,
                tool_calls: [{
                    id: `call_${Date.now().toString(36)}`,
                    type: 'function',
                    function: { name: TOOL_NAME, arguments: JSON.stringify(args) },
                }],
            },
            finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 40, completion_tokens: 40, total_tokens: 80 },
    };
}

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
        // Opt-in scenario. Returns null unless MOCK_TOOL_CALL is on AND this
        // request carries tools AND no tool result is in the history yet, so a
        // flag-off run never reaches past the first statement.
        const scripted = toolScenario(body);
        if (scripted) {
            console.log(`[mock-provider] scripted ${scripted.choices[0].message.tool_calls[0].function.name} call`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(scripted));
            return;
        }
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
    console.log(`[mock-provider] http://127.0.0.1:${PORT}/v1  (model ${MODEL})${TOOL_SCENARIO ? '  TOOL-CALL SCENARIO ON' : ''}`);
});
