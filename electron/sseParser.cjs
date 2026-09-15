/**
 * sseParser — pure incremental SSE delta parser for the desktop provider
 * bridge (electron/main.cjs). Lives here, not in main.cjs, because main.cjs
 * boots the whole app and cannot be imported by vitest — this file can.
 *
 * Feed it decoded response text as it arrives (`push`), and it emits
 * `{ type: 'text' | 'reasoning', delta }` events for the renderer's live
 * paint. `finish()` returns the accumulated native tool calls and usage.
 *
 * Supported wire formats (mirrors GenericProviderService's three):
 *   · chat_completions — `data:` JSON with choices[].delta.content /
 *     .reasoning_content, .tool_calls[] fragments (index-keyed), usage on the
 *     final include_usage chunk, `data: [DONE]` terminator.
 *   · messages (Anthropic) — content_block_delta text_delta / thinking_delta;
 *     tool_use blocks accumulate input_json_delta between
 *     content_block_start and content_block_stop.
 *   · responses (OpenAI) — response.output_text.delta /
 *     response.reasoning_summary_text.delta; function_call items accumulate
 *     response.function_call_arguments.delta; usage on response.completed.
 *
 * Deliberately forgiving: unknown event types, malformed JSON lines and
 * non-SSE bodies are skipped, never thrown — a provider that ignores
 * `stream: true` and answers with one JSON body simply produces no deltas,
 * and main.cjs falls back to its buffered extraction.
 */

/**
 * @param {string} apiFormat 'chat_completions' | 'messages' | 'responses'
 */
function createSseParser(apiFormat) {
    let lineBuf = '';
    // Accumulated native tool calls, keyed by wire index/slot.
    const toolSlots = new Map();
    let usage = null;
    let sawData = false;

    const slotFor = (key, init) => {
        let slot = toolSlots.get(key);
        if (!slot) { slot = init; toolSlots.set(key, slot); }
        return slot;
    };

    const handleChatCompletions = (data) => {
        const events = [];
        if (data === '[DONE]') return { events, done: true };
        let json; try { json = JSON.parse(data); } catch { return { events, done: false }; }
        if (json.usage) usage = json.usage;
        const choice = Array.isArray(json.choices) ? json.choices[0] : null;
        if (!choice) return { events, done: false };
        const delta = choice.delta || {};
        if (typeof delta.content === 'string' && delta.content.length > 0) {
            events.push({ type: 'text', delta: delta.content });
        }
        // Reasoning tokens ride several field spellings across OpenAI-compatible
        // servers (B.AI/vLLM/DeepSeek); take whichever carries them.
        const reasoning = delta.reasoning_content ?? delta.reasoning ?? delta.reasoning_text;
        if (typeof reasoning === 'string' && reasoning.length > 0) {
            events.push({ type: 'reasoning', delta: reasoning });
        }
        if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
                const key = tc.index ?? 0;
                const slot = slotFor(key, { id: '', name: '', args: '' });
                if (tc.id) slot.id = tc.id;
                if (tc.function?.name) slot.name += tc.function.name;
                if (typeof tc.function?.arguments === 'string') slot.args += tc.function.arguments;
            }
        }
        return { events, done: false };
    };

    const handleMessages = (data) => {
        const events = [];
        let json; try { json = JSON.parse(data); } catch { return { events, done: false }; }
        if (json.type === 'content_block_start' && json.content_block?.type === 'tool_use') {
            slotFor(json.index ?? 0, { id: json.content_block.id || '', name: json.content_block.name || '', args: '' });
        } else if (json.type === 'content_block_delta') {
            const d = json.delta || {};
            if (d.type === 'text_delta' && typeof d.text === 'string' && d.text.length > 0) {
                events.push({ type: 'text', delta: d.text });
            } else if ((d.type === 'thinking_delta' || d.type === 'reasoning_delta') && typeof (d.thinking ?? d.text) === 'string') {
                const chunk = d.thinking ?? d.text;
                if (chunk.length > 0) events.push({ type: 'reasoning', delta: chunk });
            } else if (d.type === 'input_json_delta' && typeof d.partial_json === 'string') {
                const slot = slotFor(json.index ?? 0, { id: '', name: '', args: '' });
                slot.args += d.partial_json;
            }
        } else if (json.type === 'message_delta' && json.usage) {
            usage = { ...(usage || {}), output_tokens: json.usage.output_tokens };
        }
        return { events, done: false };
    };

    const handleResponses = (data) => {
        const events = [];
        let json; try { json = JSON.parse(data); } catch { return { events, done: false }; }
        switch (json.type) {
            case 'response.output_text.delta':
                if (typeof json.delta === 'string' && json.delta.length > 0) events.push({ type: 'text', delta: json.delta });
                break;
            case 'response.reasoning_summary_text.delta':
            case 'response.output_reasoning.text.delta':
                if (typeof json.delta === 'string' && json.delta.length > 0) events.push({ type: 'reasoning', delta: json.delta });
                break;
            case 'response.output_item.added': {
                const item = json.item || {};
                if (item.type === 'function_call') {
                    slotFor(json.output_index ?? 0, { id: item.call_id || item.id || '', name: item.name || '', args: '' });
                }
                break;
            }
            case 'response.function_call_arguments.delta': {
                const slot = slotFor(json.output_index ?? 0, { id: '', name: '', args: '' });
                if (typeof json.delta === 'string') slot.args += json.delta;
                break;
            }
            case 'response.completed':
                if (json.response?.usage) usage = json.response.usage;
                return { events, done: true };
            default:
                break;
        }
        return { events, done: false };
    };

    const handleData = (data) => {
        if (apiFormat === 'messages') return handleMessages(data);
        if (apiFormat === 'responses') return handleResponses(data);
        return handleChatCompletions(data);
    };

    /**
     * Data lines of the CURRENT event, buffered until its terminating blank
     * line. Multi-line `data:` payloads are legal SSE (some gateways split
     * large JSON frames across several lines); the old line-at-a-time parse
     * fed each fragment to JSON.parse separately, silently dropping every
     * multi-line event — tool-call and usage chunks included. This mirrors
     * the renderer's streamViaProxy fix exactly: join with '\n', then parse.
     * @type {string[]}
     */
    let dataLines = [];

    /** Dispatch the buffered event (if it carried any data lines). */
    const dispatch = (out) => {
        if (dataLines.length === 0) return;
        const data = dataLines.join('\n').trim();
        dataLines = [];
        if (!data) return;
        sawData = true;
        const res = handleData(data);
        out.events.push(...res.events);
        if (res.done) out.done = true;
    };

    /**
     * Feed decoded text as it lands. Returns the delta events parsed so far
     * and whether the stream signalled completion.
     * @param {string} chunkText
     */
    const push = (chunkText) => {
        const out = { events: [], done: false };
        lineBuf += chunkText;
        let nl;
        while ((nl = lineBuf.indexOf('\n')) !== -1) {
            const line = lineBuf.slice(0, nl).replace(/\r$/, '');
            lineBuf = lineBuf.slice(nl + 1);
            if (line === '') { dispatch(out); continue; } // blank line ⇒ event boundary
            if (!line.startsWith('data:')) continue; // event:/id:/retry:/comments
            // Per spec only ONE leading space is stripped from the value.
            dataLines.push(line.slice(5).replace(/^ /, ''));
        }
        return out;
    };

    /** Flush any unterminated trailing line and pending event, then report
     *  the accumulated tool calls (arguments JSON parsed best-effort) and
     *  usage. */
    const finish = () => {
        if (lineBuf.length > 0) {
            const line = lineBuf.replace(/\r$/, '');
            lineBuf = '';
            if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
        }
        const pending = { events: [], done: false };
        dispatch(pending); // providers may omit the final blank line
        const events = pending.events;
        const done = pending.done;
        const toolCalls = [...toolSlots.entries()]
            .sort((a, b) => (a[0] - b[0]))
            .map(([, s], i) => {
                let args;
                try {
                    args = s.args ? JSON.parse(s.args) : {};
                } catch {
                    args = {};
                }
                return {
                    id: s.id || `call_${Date.now()}_${i}`,
                    name: s.name,
                    arguments: args,
                };
            })
            .filter(c => c.name);
        return { events, done, toolCalls, usage, sawData };
    };

    return { push, finish };
}

module.exports = { createSseParser };
