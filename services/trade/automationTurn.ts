/**
 * automationTurn — ONE scheduled run against the desk-tool transport.
 *
 * Automations were the last caller that REQUIRED the ensemble: the pipeline
 * forced `runEnsembleEnabled = isAutomationRun || isEnsembleEnabled`, so a
 * schedule got a debate even with the toggle off. Stage 19 deletes that engine,
 * and a schedule cannot simply lose its route — `tests/automationRouteCharacterization.test.tsx`
 * (stage 20t) named the four properties it must keep: a private thread, its own
 * continuity, its own model pick, and a verdict a human can act on. This is the
 * route that replaces the debate: the same `runToolTurn` both chat homes use,
 * with a THIRD sink.
 *
 * Why a third sink and not a reuse of one of the other two: a scheduled run has
 * no bubble to paint and no live row to patch. Its row is written ONCE, at the
 * end, into the run's stored `userMessage`/`message` pair. So the events below
 * accumulate into locals and the caller decides what the stored row says —
 * including the part nobody asked for in real time: which tools FAILED.
 *
 * Two rules here are the point of the stage, not incidental:
 *  - a plan is RATIONED (`MAX_PLANS_PER_RUN`, plus `MAX_PLANS_PER_DAY` through
 *    the automation ledger), because a schedule that fires every 15 minutes
 *    would otherwise present ~96 plans a day with nobody watching;
 *  - a failure is VISIBLE. A run whose tools all blinked must not settle as a
 *    clean answer — the trader reads a toast and a card, not a stream.
 */

import type { LoggedTrade } from '../../types';
import type { Message, ToolAction } from '../../types/message';
import type { ProviderConfig } from '../../types/provider';
import type { DeskToolCall, DeskToolResult } from '../analysis/DeskToolsService';
import { AUTOMATION_SYSTEM_PROMPT } from '../../constants/prompts/chatPrompts';
import { TASK_BUDGETS } from '../providers/taskBudgets';
import { resolveComposerEffort } from '../providers/reasoningControls';
import { runToolTurn, type ToolTurnEvents, type ToolTurnOutcome, type ToolTurnRequest } from './toolTurn';
import { runPresentTrade } from './presentTradeTool';
import { CHAT_SURFACE_TOOLS, MAX_LIVE_TOOL_LINES, chatSurfaceTurnMessages, surfacePromptWith, type ChatSurfacePrompt } from './chatSurfaceTurn';
import type { TradeProposal } from './proposedTrade';
import { isProviderReady } from '../../utils/providerUtils';
import { loadAutomationPlanCount, recordAutomationPlan, MAX_PLANS_PER_DAY } from '../automation/AutomationService';
import { recordToolTurnUsage } from '../../utils/sessionUsage';

/** The desk tools a SCHEDULED run may call: the Chat surface's set minus the
 *  half of it that edits the trader's notebook. `write_memory_note`, `remember`,
 *  `forget`, `amend_memory`, `propose_skill`, `revise_skill`, `propose_strategy`
 *  and `forge_tool` all rewrite what every FUTURE turn will see — fine when a
 *  human is in the loop pressing send, not fine from a cron that fires while
 *  nobody is looking. Reads (`recall`, `get_notebook_map`, `read_memory`) stay
 *  offered: a schedule should follow the trader's rules.
 *
 * Derived from `CHAT_SURFACE_TOOLS` rather than restated, so a lookup added
 * there reaches schedules automatically and a growth tool cannot be re-added
 * there without also appearing here. The deny list is pinned by
 * `tests/automationToolTurn.test.ts`, including that every denied name still
 * exists — a rename would otherwise silently un-deny it. */
export const AUTOMATION_UNATTENDED_DENY = [
    'write_memory_note', 'amend_memory', 'remember', 'forget',
    'propose_skill', 'revise_skill', 'propose_strategy', 'forge_tool',
];

/** The offered set — computed once, at module load. */
export const AUTOMATION_TOOLS: string[] = CHAT_SURFACE_TOOLS.filter(
    tool => !AUTOMATION_UNATTENDED_DENY.includes(tool),
);

/** A plan is rationed per run and per day. `1` per run is not stinginess: one
 *  scheduled analysis should produce one plan, and a model that presents twice
 *  in a turn has changed its mind, not found a second trade — the refused
 *  receipt tells it to put that in prose instead. */
export const MAX_PLANS_PER_RUN = 1;

/** The mandate a scheduled run carries, with the trader's notebook under it —
 *  skills and active plans ARE injected (a schedule should follow the rules the
 *  trader approved), they simply may not be edited from here. */
export const automationSystemPrompt = (): ChatSurfacePrompt =>
    surfacePromptWith(AUTOMATION_SYSTEM_PROMPT, 'what this schedule is looking at');

export interface AutomationSeat {
    config: ProviderConfig;
    model: string;
}

/**
 * Which model answers a scheduled run.
 *
 * `decider` is the config's own pick — the pair it used to chair the debate, and
 * now simply THE model the run uses. `picks` are its analyst/lens selections,
 * which is where a schedule falls back when that provider was deleted, its key
 * removed or its model renamed. Resolution stops at the first READY pair and
 * never reaches the trader's global team: a schedule that silently inherited
 * whatever model the desktop happens to be showing would be a different
 * automation each time it fired. `null` is the caller's visible error, not a
 * silent no-show.
 */
export const automationSeatFor = (
    decider: ProviderConfig | undefined,
    deciderModel: string | undefined,
    picks: readonly { providerId: string | null | undefined; model?: string | null }[],
    providerConfigs: readonly ProviderConfig[],
): AutomationSeat | null => {
    if (decider && isProviderReady(decider)) {
        const model = deciderModel && decider.models.includes(deciderModel)
            ? deciderModel
            : (decider.selectedModel || decider.models[0]);
        if (model) return { config: { ...decider, selectedModel: model }, model };
    }
    for (const pick of picks) {
        const config = providerConfigs.find(c => c.id === pick.providerId);
        if (!config || !isProviderReady(config)) continue;
        const model = pick.model && config.models.includes(pick.model)
            ? pick.model
            : (config.selectedModel || config.models[0]);
        if (model) return { config: { ...config, selectedModel: model }, model };
    }
    return null;
};

export interface AutomationTurnRequest {
    config: ProviderConfig;
    /** The run's PRIVATE history — this automation's previous runs, never the
     *  open conversation. */
    history: readonly Message[];
    prompt: string;
    /** A replayed chart screenshot from the last manual analysis, as a dataURL. */
    image?: string;
    symbol?: string | null;
    interval?: string;
    trades: LoggedTrade[];
    /** Whose quota this is, and which schedule is spending it. */
    username: string;
    automationId: string;
    signal: AbortSignal;
    startedAt: number;
}

export interface AutomationTurnResult extends ToolTurnOutcome {
    /** The plan the run presented, if any — capped by the gate at log time
     *  exactly as a chat-presented one is. */
    proposal?: TradeProposal;
    /** The live feed written onto the run's row, capped at the same 8 lines the
     *  other two homes cap at — one renderer (`ChatWorkTimeline`) reads all
     *  three, so a longer feed here would be a longer bubble there. */
    toolLines: string[];
    /** Tools that came back `ok: false` — refusals, `DATA_UNAVAILABLE`, timeouts. */
    failedTools: string[];
    /** Plans this turn wanted to present and the cap refused. */
    refusedPlans: number;
    /** Plans the cap ALLOWED — the row's `proposal` is the last of these. */
    plansPresented: number;
    /** Side-effect rows the turn recorded (proposal/custom tools), for the card. */
    actions: ToolAction[];
    /** Which skills rode the system prompt, recorded on the row like a chat turn. */
    skills: string[];
    /** Every honest caveat, in reading order: no-lookup, tool failures, cap
     *  refusals. The caller writes them into the stored text. */
    notices: string[];
}

/** One scheduled run: stream a tool-driven answer, ration the plans, keep the
 *  failures. Transport errors propagate — the caller settles the run as an
 *  error row, which is the visible outcome a schedule needs. */
export const runAutomationTurn = async (req: AutomationTurnRequest): Promise<AutomationTurnResult> => {
    const toolLines: string[] = [];
    const failedTools: string[] = [];
    const actions: ToolAction[] = [];
    const effort = resolveComposerEffort(undefined);
    let proposal: TradeProposal | undefined;
    let sawTool = false;
    let plansPresented = 0;
    let refusedPlans = 0;

    const events: ToolTurnEvents = {
        // Nothing is painting this turn, so the display channels are no-ops —
        // the settled row is built from the outcome, once. `runToolTurn` keeps
        // its own reasoning accumulator, which is what the caller stores.
        setText: () => { },
        addReasoning: () => { },
        addToolLine: line => {
            sawTool = true;
            toolLines.push(line);
            if (toolLines.length > MAX_LIVE_TOOL_LINES) toolLines.shift();
        },
        attachPayload: payload => {
            // The failure signal, from a callback the transport ALREADY has:
            // `onToolPayload` carries `ok` per call, so a failed lookup is
            // auditable without inventing a fifth event or a second classifier.
            // Payload BYTES are deliberately not stored — a run card has no
            // tool-peek to page them into, and `read_tool_output` reads the
            // executor's own artifact store, not the UI's payload store.
            if (!payload.ok) failedTools.push(payload.name);
        },
        addAction: action => { actions.push({ ...action, speaker: action.speaker || 'schedule' }); },
    };

    const transport: ToolTurnRequest['transport'] = {
        defaultSymbol: req.symbol ?? null,
        allowedTools: AUTOMATION_TOOLS,
        maxTokens: TASK_BUDGETS.analysis,
        temperature: 0.3,
        reasoningEffort: effort,
        chartInterval: req.interval,
        trades: req.trades,
        executePanelTool: async (call: DeskToolCall) => {
            if (call.name !== 'present_trade') return null;
            const plansToday = await loadAutomationPlanCount(req.username, req.automationId);
            if (plansPresented + refusedPlans >= MAX_PLANS_PER_RUN || plansToday >= MAX_PLANS_PER_DAY) {
                refusedPlans += 1;
                const why = plansPresented + refusedPlans >= MAX_PLANS_PER_RUN && plansToday < MAX_PLANS_PER_DAY
                    ? `one plan per run, and this run has used it`
                    : `${MAX_PLANS_PER_DAY} plans per day for this schedule (today: ${plansToday})`;
                const refused: DeskToolResult = {
                    toolCallId: call.id,
                    name: call.name,
                    ok: false,
                    content: `present_trade refused: a scheduled run may present ${why}. `
                        + 'Do not retry this call. Describe the plan in your reply instead — the trader reads the card.',
                };
                return refused;
            }
            plansPresented += 1;
            void recordAutomationPlan(req.username, req.automationId);
            return runPresentTrade(
                {
                    call,
                    symbol: req.symbol || call.arguments?.symbol?.toString() || 'BTCUSDT',
                    trades: req.trades,
                    drawnPrice: null,
                    crossCanvas: false,
                    canvasNote: '',
                    // No chart to arm a watch against, and no human watching the
                    // levels either. Stated as an explicit flag, never inferred
                    // from a missing callback.
                    watchable: false,
                },
                {
                    setProposal: p => { proposal = p; },
                    setGate: gate => { if (proposal) proposal = { ...proposal, gate }; },
                    onAbort: fn => req.signal.addEventListener('abort', fn, { once: true }),
                },
            );
        },
    };

    const prompt = automationSystemPrompt();
    // A schedule is not a conversation: the seat must look the tape up. The Chat
    // surface says this only when the trader pressed FULL ANALYSIS (20f); here it
    // is always true, because a reading nobody asked for still has to be one.
    const systemText = `${prompt.text}\n\nLOOK IT UP: this run has no human to check your numbers. `
        + 'Call the market tools before you state a price, a level or a probability, and say which calls failed.';
    const out = await runToolTurn({
        config: req.config,
        messages: chatSurfaceTurnMessages(req.history, req.prompt, req.image, req.config.selectedModel, systemText),
        signal: req.signal,
        startedAt: req.startedAt,
        effort,
        transport,
        events,
    });
    recordToolTurnUsage({
        startedAt: req.startedAt,
        workedMs: out.workedMs,
        modelId: req.config.selectedModel,
        usage: out.usage,
        usageCalls: out.usageCalls,
        answer: out.text,
        coin: proposal?.symbol ?? undefined,
    });

    const notices: string[] = [];
    if (out.notice) notices.push(out.notice);
    if (!sawTool && !out.interrupted) {
        notices.push('NOTHING WAS LOOKED UP: this scheduled run called no tool, so every number in it is the model’s own memory. '
            + 'The desk tools were offered — check the model or the harness setting if this keeps happening.');
    }
    if (failedTools.length > 0) {
        notices.push(`TOOL FAILURE(S): ${failedTools.join(', ')} came back with no data or a rejection. `
            + 'Any part of this reading that depends on them is UNCHECKED, not confirmed.');
    }
    if (refusedPlans > 0) {
        notices.push(`PLAN CAP REACHED: ${refusedPlans} extra plan(s) refused by this schedule `
            + `(limit ${MAX_PLANS_PER_RUN} per run, ${MAX_PLANS_PER_DAY} per day). `
            + 'The idea is in the reply; it was never presented.');
    }

    return {
        ...out,
        toolLines,
        failedTools,
        refusedPlans,
        plansPresented,
        actions,
        skills: prompt.skills,
        notices,
        ...(proposal ? { proposal } : {}),
    };
};
