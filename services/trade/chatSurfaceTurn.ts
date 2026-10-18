/**
 * chatSurfaceTurn — ONE Chat-surface turn against the desk-tool transport.
 *
 * The Chat surface answered with `streamQuickResponse`: one request, no tools.
 * So a question about the current price was answered out of the model's
 * training data while the Chart AI dock, asked the same question, looked it up.
 * Stage 20's premise is that a seat finds things out by CALLING, so both homes
 * now run the same executor (`services/trade/toolTurn`). What differs is the
 * ROW: the dock writes a `chatStore` `LiveEntry`, the Chat surface writes a
 * canonical `Message` — the record the rail, the Journal and the learning loop
 * read. The sink below is that difference and nothing else.
 *
 * Tools are the canvas-free half of the dock's set: market lookups, indicator
 * studies, the journal, past sessions, the notebook, skills, search, the
 * screener. The eight `CHART_ACTION_TOOL_DEFS` (draw / draw_detected /
 * mark_trade_levels / clear_chart_drawings / present_trade / watch_price /
 * wake_me / cancel_watch) are NOT offered here, and that is not a shortcut:
 * `streamChatWithDeskTools` puts those definitions in front of a seat only when
 * the caller passes `executePanelTool`, and this surface has no canvas, no live
 * mark and no level-watch to arm. Offering a tool the executor cannot honour is
 * the dead-affordance bug moved one layer down into the prompt.
 *
 * BOTS ARE NOT HERE. A bot-bound thread in this surface keeps
 * `streamQuickResponse` (stage 20 owner ruling): the roster answers with its
 * persona and its own memory, and `useBotMailbox` / `botRoutine` / `groupRounds`
 * are deliberately not moved onto the tool turn.
 */

import type { LoggedTrade } from '../../types';
import type { Message } from '../../types/message';
import type { ProviderConfig } from '../../types/provider';
import type { ChatMessage } from '../providers/GenericProviderService';
import { MessageRole } from '../../types';
import { CASUAL_CHAT_SYSTEM_PROMPT } from '../../constants/prompts/chatPrompts';
import { TASK_BUDGETS } from '../providers/taskBudgets';
import { resolveComposerEffort, type ReasoningEffort } from '../providers/reasoningControls';
import { runToolTurn, type ToolTurnEvents, type ToolTurnOutcome, type ToolTurnRequest } from './toolTurn';
import { userContentWithImage } from './chatTurnRunner';
import { saveToolPayload } from './toolPayloadStore';
import { appendToolActions } from '../../utils/toolActions';

/** The desk tools a Chat-surface seat may call. Everything here answers from
 *  the exchange, the journal, the notebook or the web — none of it needs the
 *  chart the trader is looking at, which is exactly what this surface lacks.
 *  Also enforced at execution (`executeDeskTool`'s allow-list), so a
 *  text-protocol seat that invents a `draw_on_chart` tag is refused, not
 *  silently answered by something that has no canvas to draw on. */
export const CHAT_SURFACE_TOOLS = [
    // Market tape — the reason this surface needed a tool turn at all.
    'get_price_snapshot', 'get_order_book', 'get_derivatives',
    'get_liquidations', 'get_session_context', 'get_market_packet', 'get_all_timeframes',
    'get_btc_context', 'get_indicators', 'project_future_price',
    // The trader's own history, as rows and as past sessions.
    'get_trade_log', 'recall', 'get_setup_history_stats', 'recall_chat',
    // Market-wide discovery and simulation.
    'web_search', 'scan_setups', 'run_screener', 'run_monte_carlo',
    // The seat edits its own memory, skills and tools from here — the same
    // growth set the dock has, since neither half of it needs a canvas.
    'write_memory_note', 'get_notebook_map', 'propose_skill', 'revise_skill', 'propose_strategy',
    'amend_memory', 'forge_tool',
    'remember', 'read_memory', 'forget',
    // Anything that can be clipped must be able to be re-read.
    'read_tool_output',
];

/** The speaker key for this surface's live tool feed — `chatRowFrom` flattens
 *  `liveToolEvents` for the Chat row and `liveEntryFromMessage` does the same
 *  for the dock's projection of this row, so one key serves both homes. */
const DESK_SPEAKER = 'desk';

/** Rolling cap on the live tool feed, matching the ensemble feed's window so a
 *  long tool round does not turn a bubble into a log. */
const MAX_LIVE_TOOL_LINES = 8;

/**
 * The prompt for a Chat-surface turn, built the way `streamQuickResponse`
 * built it — system, then history, then the live line — with one deliberate
 * difference: the screenshot attached to THIS line goes on the wire as a real
 * image part (a text-only seat is told it is there instead of answering blind).
 * History rows still travel as text; the dock re-sends its last ten, this
 * surface passes its whole conversation, and bolting images onto that would be
 * a cost decision rather than a correctness one.
 *
 * The trailing-prompt guard is load-bearing: the pipeline appends the trader's
 * own row to `messages` BEFORE the run, so `history` already ends with it.
 * Pushing it again would send the question twice.
 */
export const chatSurfaceTurnMessages = (
    history: readonly Message[],
    prompt: string,
    image: string | undefined,
    selectedModel: string,
    systemPrompt?: string,
): ChatMessage[] => {
    const messages: ChatMessage[] = (history || []).map(m => ({
        role: m.role === MessageRole.AI ? 'assistant' : m.role === MessageRole.SYSTEM ? 'system' : 'user',
        content: m.text,
    }));
    messages.unshift({ role: 'system', content: systemPrompt || CASUAL_CHAT_SYSTEM_PROMPT });
    if (messages[messages.length - 1]?.content !== prompt) {
        messages.push({
            role: 'user',
            content: userContentWithImage(prompt, image ? { kind: 'image', payload: image } : undefined, selectedModel),
        });
    }
    return messages;
};

export interface ChatSurfaceTurnRequest {
    config: ProviderConfig;
    history: readonly Message[];
    prompt: string;
    /** A chart screenshot attached to THIS line, as a dataURL. */
    image?: string;
    /** A bot persona overrides the casual prompt — bots stay chat-only, so
     *  this is for the surfaces that route here with their own mandate. */
    systemPrompt?: string;
    /** The composer's dial, forwarded exactly as `streamQuickResponse`
     *  forwarded it: unset means the task default, not a new tier. */
    effort?: ReasoningEffort;
    symbol?: string | null;
    interval?: string;
    trades: LoggedTrade[];
    signal: AbortSignal;
    /** When the bubble was painted — every settle path reports from here. */
    startedAt: number;
    /** Patch THIS row. The caller binds the conversation and the message id, so
     *  a run that outlives the surface it started in still writes its own row. */
    patch: (fn: (m: Message) => Message) => void;
    /** Live paint, RAF-coalesced by the caller: absolute text + reasoning so
     *  far. Writing `thoughtProcesses` here too would fight the throttled
     *  casual updater that already owns that field. */
    paint: (text: string, thinking: string) => void;
}

/** Run the turn. Transport errors propagate to the caller's catch: only it
 *  knows whether a failed turn is a toast, a row note, or both. */
export const runChatSurfaceTurn = async (req: ChatSurfaceTurnRequest): Promise<ToolTurnOutcome> => {
    let reasoning = '';
    let visible = '';
    const events: ToolTurnEvents = {
        setText: text => { visible = text; req.paint(text, reasoning); },
        addReasoning: chunk => { reasoning += chunk; req.paint(visible, reasoning); },
        // Append order, oldest first — the same order the dock's `tools` array
        // uses, because `liveEntryFromMessage` feeds these lines into it and
        // one renderer (ChatWorkTimeline) reads both homes.
        addToolLine: line => req.patch(m => {
            const feed = m.liveToolEvents?.[DESK_SPEAKER] ?? '';
            const lines = feed ? `${feed}\n${line}`.split('\n') : [line];
            return {
                ...m,
                liveToolEvents: { ...m.liveToolEvents, [DESK_SPEAKER]: lines.slice(-MAX_LIVE_TOOL_LINES).join('\n') },
            };
        }),
        attachPayload: payload => {
            try {
                saveToolPayload(payload);
            } catch {
                // A payload write must never take down the transcript write it
                // is riding inside — the line already landed above.
            }
        },
        // Side-effects (skill drafts, memory notes, forged tools) append through
        // the ONE ledger helper so this writer caps and copies exactly like the
        // pipeline's own; the row then shows them as status rows in both homes.
        addAction: action => req.patch(m => appendToolActions([m], m.id, [{ ...action, speaker: action.speaker || DESK_SPEAKER }])[0]),
    };

    const transport: ToolTurnRequest['transport'] = {
        defaultSymbol: req.symbol ?? null,
        allowedTools: CHAT_SURFACE_TOOLS,
        maxTokens: TASK_BUDGETS.chat,
        temperature: 0.4,
        reasoningEffort: resolveComposerEffort(req.effort),
        chartInterval: req.interval,
        trades: req.trades,
    };

    return runToolTurn({
        config: req.config,
        messages: chatSurfaceTurnMessages(req.history, req.prompt, req.image, req.config.selectedModel, req.systemPrompt),
        signal: req.signal,
        startedAt: req.startedAt,
        effort: resolveComposerEffort(req.effort),
        transport,
        events,
    });
};
