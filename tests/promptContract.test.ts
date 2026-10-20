/**
 * E-11 — the prompt CONTRACT: assert what is SENT, not what is built.
 *
 * The repo has never had a test that looks at the content of a message the app
 * puts on the wire. `tests/promptsAreWired.test.ts` proves a registry id has a
 * `getPrompt()` CALL SITE — a source-shape gate. That is why four real defects
 * could sit in the tree:
 *
 *   F-01  the assembled context is built and sent nowhere;
 *   F-09  `analysis.lens` is editable in Settings and sent to nobody;
 *   F-10  the analysis prompt never reaches a trader-facing answer;
 *   E-09  the same `analysis.lens` entry, from the other side.
 *
 * The blind spot is the repo's own: "Unit tests cannot see the transcript"
 * (`AGENTS.md`). This file is that missing gate. It is deliberately a
 * CONTENT test: every assertion is about the bytes of the system message the
 * app hands the provider, never about the shape of the code that built it.
 *
 * ── How "what is sent" is captured ────────────────────────────────────────────
 *
 * The transport is where a prompt becomes bytes. `streamChatWithDeskTools`
 * is the last function before the wire, and it is where the app adds the two
 * blocks a surface does not carry itself:
 *
 *   - `withDeskToolsSystemPrompt` (`services/analysis/DeskToolsService.ts:3759`)
 *     prepends the harness contract to a system message that has none, and
 *     appends the DESK TOOLS block;
 *   - it is called from inside `streamChatWithDeskTools` (`:3804`), so a test
 *     that mocks that function would BYPASS the contract injection and assert
 *     a prompt the app never actually sends.
 *
 * So this file mocks the transport one layer lower — it captures the message
 * array the turn hands to `streamChatWithDeskTools`, and then applies the
 * REAL `withDeskToolsSystemPrompt` to it, which is the real enrichment step
 * the transport performs. A source pin asserts that the transport really does
 * call it, so this file cannot pass on a transport that stopped enriching.
 *
 * ── The four paths ────────────────────────────────────────────────────────────
 *
 *   P1 chat        `services/trade/chatSurfaceTurn.ts`      — the Chat surface
 *   P2 dock        `services/trade/tradeChatContext.ts`     — the Chart AI dock
 *   P3 automation  `services/trade/automationTurn.ts`        — a scheduled run
 *   P4 evaluation  `services/providers/GenericAnalysisService.ts`
 *                  (`analyzeTradingView` — the skill-evaluation path, called
 *                   from `services/learning/SkillEvalScheduler.ts:284`)
 *
 * ── What each path must satisfy ───────────────────────────────────────────────
 *
 *   (a) PRESENT  the harness contract EXACTLY once (the confidence ladder, the
 *                risk rules and the `HARNESS NOTE` convention are the whole
 *                reason a model obeys the app over its own priors — twice is
 *                a prompt that spends a model's attention on a second ladder,
 *                zero is a prompt that never mentions one);
 *                the DESK TOOLS block; the surface's own mandate.
 *   (b) ABSENT   the debate-era vocabulary (the engine was deleted on
 *                2026-10-18; a surface that still says "debate" or "moderator"
 *                is describing a room the trader is not in);
 *                the assembled retrieval blob (F-01's shape: the app pays for
 *                a retrieval whose bytes never reach the model).
 *   (c) TOOLS    every tool a surface NAMES must be one that surface OFFERS.
 *                A prompt that promises a tool the surface cannot call is the
 *                dead affordance moved one layer down into the prompt.
 *   (d) SKILLS   the skills index uses the recognised section vocabulary, and
 *                a skill is NAMED once — the compact index line, not a dump
 *                of its body beside it.
 *
 * ── The dock, honestly ────────────────────────────────────────────────────────
 *
 * The dock's composer (`systemPromptFor`) is a `useCallback` inside
 * `components/trade/TradeChatPanel.tsx:453`, so it cannot be called directly
 * from a unit test without mounting the whole panel. This file therefore
 * asserts the contract over the two EXPORTED blocks the panel concatenates
 * (`TRADE_CHAT_SYSTEM_PROMPT` and `buildSkillsIndexForPrompt`), and source-
 * pins the concatenation itself so the test fails if the panel stops using
 * them. The alternative — a copy of the composition in the test — is exactly
 * the kind of second implementation this repo keeps paying for.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Message } from '../types/message';
import type { ProviderConfig } from '../types/provider';
import { MessageRole } from '../types';
import {
    streamChatWithDeskTools, withDeskToolsSystemPrompt,
    CHART_ACTION_TOOL_DEFS, DESK_TOOL_DEFINITIONS,
} from '../services/analysis/DeskToolsService';
import { CHAT_SURFACE_TOOLS, chatSurfaceSystemPrompt, runChatSurfaceTurn } from '../services/trade/chatSurfaceTurn';
import { TRADE_CHAT_SYSTEM_PROMPT, buildSkillsIndexForPrompt } from '../services/trade/tradeChatContext';
import {
    AUTOMATION_TOOLS, AUTOMATION_UNATTENDED_DENY, automationSystemPrompt, runAutomationTurn,
} from '../services/trade/automationTurn';
import { listSkills } from '../services/learning/SkillMemoryService';
import { activeStrategiesBlock } from '../services/learning/strategyStore';
import { buildProfileMemoryIndex } from '../services/learning/profileMemory';
import { HARNESS_CONTRACT_PROMPT } from '../constants/prompts/harnessContract';
import { HARNESS_TURN_MARK } from '../utils/harnessMarks';

vi.mock('../services/analysis/DeskToolsService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/analysis/DeskToolsService')>();
    return { ...actual, streamChatWithDeskTools: vi.fn() };
});
vi.mock('../services/learning/SkillMemoryService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/learning/SkillMemoryService')>();
    return { ...actual, listSkills: vi.fn() };
});
vi.mock('../services/learning/strategyStore', () => ({ activeStrategiesBlock: vi.fn() }));
vi.mock('../services/learning/profileMemory', () => ({ buildProfileMemoryIndex: vi.fn() }));
// The desk-tools gate is a Settings toggle. Left to the real store the test
// would depend on whatever the last suite wrote; pinned to ON so the DESK
// TOOLS block is always in the prompt this file audits.
vi.mock('../utils/harnessSettings', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../utils/harnessSettings')>();
    return {
        ...actual,
        getHarnessSettings: vi.fn(() => ({ ...actual.getHarnessSettings(), deskToolsEnabled: true })),
    };
});

const mockStream = vi.mocked(streamChatWithDeskTools);
const mockSkills = vi.mocked(listSkills);
const mockStrategies = vi.mocked(activeStrategiesBlock);
const mockMemory = vi.mocked(buildProfileMemoryIndex);

// ── the vocabulary the contract is written in ──────────────────────────────────

const CONTRACT_MARK = 'HARNESS CONTRACT';
const DESK_TOOLS_MARK = 'DESK TOOLS';
const SKILLS_HEADING = '## Skills library — ';

const countOf = (hay: string, needle: string): number => hay.split(needle).length - 1;

/**
 * The debate-era vocabulary. The engine was deleted on 2026-10-18; a surface
 * that still names the room is describing a room the trader is not in.
 *
 * These are checked against the SURFACE'S OWN text, not against the enriched
 * prompt. Two shared blocks carry a residue of the same deletion and are not
 * the surface's to fix:
 *
 *   - the canonical harness contract still says "The moderator's last block is
 *     the labeled markdown plan only";
 *   - the shared DESK TOOLS catalogue still says a turn may open "analysis,
 *     rebuttal, clarification, or moderator verdict".
 *
 * Both are asserted PRECISELY below: the surface's own text must contain no
 * `moderator` at all, and the enriched prompt's count must equal exactly the
 * two shared blocks' contribution. That is strictly stronger than a blanket
 * ban — it fails if a surface reintroduces the word, and it fails if either
 * shared block's copy disappears.
 */
const FORBIDDEN_VOCABULARY = [
    'debate',
    'moderator',
    'analyst team',
    'different models',
    'analysts must',
    'debate mailbox',
];

/** Tools that exist only for a canvas. The Chat surface has none. */
const CHART_ONLY_TOOLS = CHART_ACTION_TOOL_DEFS
    .map(d => d.function.name)
    .filter(n => !CHAT_SURFACE_TOOLS.includes(n));

/** The core desk tools the executor knows, whatever the surface offers. */
const CORE_TOOLS = DESK_TOOL_DEFINITIONS.map(d => d.function.name);

/** The dock has a canvas and a notebook, so it may offer core + chart actions. */
const DOCK_TOOLS = Array.from(new Set<string>([...CORE_TOOLS, ...CHART_ACTION_TOOL_DEFS.map(d => d.function.name)]));

/** The desk tools the dock can offer that the Chat surface cannot. */
const NOTEBOOK_GROWTH_TOOLS = [
    'write_memory_note', 'amend_memory', 'remember', 'forget',
    'propose_skill', 'revise_skill', 'propose_strategy', 'forge_tool',
];

/** The debate's private channel. Panel-only, and never named in a mandate. */
const MAILBOX_TOOLS = ['send_message', 'read_message'];

/** Every tool name the app knows, so a prompt can be scanned for them. */
const TOOL_VOCABULARY = Array.from(new Set<string>([
    ...CORE_TOOLS,
    ...CHAT_SURFACE_TOOLS,
    ...CHART_ACTION_TOOL_DEFS.map(d => d.function.name),
    ...NOTEBOOK_GROWTH_TOOLS,
    ...MAILBOX_TOOLS,
    'get_chart_view', 'read_memory', 'scan_setups', 'web_search', 'read_tool_output',
]));

/**
 * Two tool names are also ordinary English words, so a whole-word scan cannot
 * tell "save it with remember" (the tool) from "what they have asked you to
 * remember" (prose). They are excluded from the TEXT scan and kept in the
 * allow-list checks, where the name is compared as a value and cannot collide.
 */
const AMBIGUOUS_TOOL_NAMES = ['remember', 'forget'];

/**
 * Which of the known tools a text NAMES.
 *
 * Scanned against the SURFACE'S OWN prompt, never against the enriched one:
 * the shared DESK TOOLS catalogue names every tool the executor has, and
 * reading that as the surface's vocabulary would make the check vacuous.
 */
const toolsNamedIn = (text: string): string[] =>
    TOOL_VOCABULARY
        .filter(name => !AMBIGUOUS_TOOL_NAMES.includes(name))
        .filter(name => new RegExp(`\\b${name}\\b`).test(text))
        .sort();

// ── fixtures ───────────────────────────────────────────────────────────────────

const SENTINEL = 'SENTINEL-SKILL-BODY-MUST-NOT-BE-DUMPED';

const skillRows = (n: number) => Array.from({ length: n }, (_, i) => ({
    file: { name: `skill-${i}.md`, content: '', createdAt: '' },
    meta: {
        status: 'active', kind: 'repeat',
        description: i === 0 ? SENTINEL : `rule number ${i}`,
        ifCondition: 'x', thenAction: 'y',
    },
} as never));

const provider = {
    id: 'p1', name: 'P1', selectedModel: 'gpt-4o', isEnabled: true, apiKey: 'k',
    baseUrl: 'https://example.invalid', apiFormat: 'chat_completions', models: ['gpt-4o'],
} as unknown as ProviderConfig;

/**
 * A message as it travels. `content` is the provider's own union — a string, a
 * list of parts, or nothing — so the helpers below read it through `String()`
 * rather than pretending it is always text.
 */
type WireMessage = { role: string; content: string | unknown[] | null };

/** The message array the turn handed to the transport, and the options it gave. */
const captured = (index = 0) => {
    const call = mockStream.mock.calls[index] as unknown as [
        unknown,
        WireMessage[],
        Record<string, unknown>,
    ];
    return { messages: call[1], options: call[2] };
};

/**
 * What the app actually puts on the wire: the message array the turn built,
 * with the transport's own enrichment applied — the same call
 * `streamChatWithDeskTools` makes at `DeskToolsService.ts:3804`.
 */
const asSent = (messages: WireMessage[], native = true) =>
    withDeskToolsSystemPrompt(messages as never, native);

/**
 * The system text of whatever the turn actually put on the wire.
 *
 * Typed structurally, not as `WireMessage[]`: the turn hands the transport the
 * transport's own message type, and this reads the REAL array that went out —
 * the point of the file is to measure the sent prompt, not a copy of it.
 */
const systemTextOf = (messages: ReadonlyArray<{ role: string; content: unknown }>): string => {
    const sys = messages.find(m => m.role === 'system');
    return sys ? String(sys.content ?? '') : '';
};

/**
 * How many times a shared block carries a given word, MEASURED from the real
 * transport step rather than restated: enrich a surface that has none, and a
 * surface that already carries the contract, and see what the shared blocks
 * add in each case.
 */
const sharedCount = (word: string, withContract: boolean): number => {
    const base = withContract ? HARNESS_CONTRACT_PROMPT.trim() : 'X';
    const enriched = systemTextOf(asSent([{ role: 'system', content: base }]));
    return countOf(enriched.toLowerCase(), word.toLowerCase())
        - countOf(base.toLowerCase(), word.toLowerCase());
};

/**
 * The surface's OWN text: the prompt minus the canonical contract.
 *
 * The contract is a shared block, not the surface's vocabulary, so the
 * debate-era checks are made against what the surface wrote for itself. A
 * surface that embeds the contract (the evaluation path does) is judged on
 * the rest of its prompt.
 */
const ownText = (surface: string): string =>
    surface.split(HARNESS_CONTRACT_PROMPT.trim()).join('');

/**
 * The shared assertions every path must satisfy.
 *
 * `surface` is the text the SURFACE owns; `sent` is what the app puts on the
 * wire after the transport's own enrichment.
 */
const expectContractOn = (surface: string, sent: string, label: string) => {
    // (a) the contract, exactly once
    expect(countOf(sent, CONTRACT_MARK), `${label}: the harness contract must appear exactly once`).toBe(1);
    expect(sent).toContain(HARNESS_CONTRACT_PROMPT.trim());
    // the contract's rule 5 names the mark the app stamps on its own text
    expect(sent).toContain(HARNESS_TURN_MARK);
    // (a) the desk-tools block, exactly once
    expect(countOf(sent, DESK_TOOLS_MARK), `${label}: the DESK TOOLS block must appear exactly once`).toBe(1);
    // (b) no debate-era vocabulary, except the shared blocks' own residue.
    //
    // The check is an EXACT equation, not a ban: the word may appear in the
    // wire prompt only as many times as the shared blocks carry it plus what
    // the surface itself wrote. A surface that reintroduces "moderator" adds
    // one to the left-hand side and the equation no longer balances — so the
    // residue the two shared blocks carry today cannot hide a new one.
    const mine = ownText(surface);
    for (const word of FORBIDDEN_VOCABULARY) {
        const shared = sharedCount(word, surface.includes(CONTRACT_MARK));
        expect(countOf(sent.toLowerCase(), word.toLowerCase()),
            `${label}: "${word}" is debate-era vocabulary; only the shared blocks may carry it`)
            .toBe(countOf(mine.toLowerCase(), word.toLowerCase()) + shared);
    }
    // (d) the skills index uses the recognised vocabulary
    if (mine.includes(SKILLS_HEADING)) {
        expect(mine, `${label}: the skills index heading must be the recognised one`).toMatch(/^## Skills library — \d+ skills?\./m);
    }
};

beforeEach(() => {
    mockStream.mockReset();
    mockSkills.mockReset();
    mockStrategies.mockReset();
    mockMemory.mockReset();
    mockStream.mockImplementation((async function* () { yield 'BTC is holding 111k.'; } as never));
    mockStrategies.mockReturnValue('');
    mockMemory.mockReturnValue('');
    mockSkills.mockReturnValue(skillRows(2));
});

// ═══════════════════════════════════════════════════════════════════════════════
// P1 — the Chat surface
// ═══════════════════════════════════════════════════════════════════════════════

describe('P1 · the Chat surface sends a prompt that matches its contract', () => {
    const send = async () => {
        let row: Message = { id: 'ai-1', role: MessageRole.AI, text: '', createdAt: new Date().toISOString() };
        await runChatSurfaceTurn({
            config: provider,
            history: [] as Message[],
            prompt: 'what is btc doing',
            trades: [] as never,
            signal: new AbortController().signal,
            startedAt: Date.now() - 100,
            symbol: 'BTCUSDT',
            interval: '15m',
            patch: (fn: (m: Message) => Message) => { row = fn(row); },
            paint: () => {},
        } as never);
        return captured();
    };

    it('carries the harness contract exactly once, and the desk-tools block', async () => {
        const { messages } = await send();
        const surface = systemTextOf(messages);
        const sent = systemTextOf(asSent(messages));
        expectContractOn(surface, sent, 'P1 chat');
        expect(sent).toMatch(/LOOK UP, DON'T REMEMBER/);
        expect(sent).toMatch(/NO CHART HERE/);
    });

    it('names only the tools it offers', async () => {
        const { messages } = await send();
        const surface = systemTextOf(messages);
        const named = toolsNamedIn(surface);
        for (const tool of named) {
            expect(CHAT_SURFACE_TOOLS, `P1 chat names "${tool}" but does not offer it`).toContain(tool);
        }
        // the canvas tools are the whole point of the "no chart here" clause
        for (const tool of CHART_ONLY_TOOLS) {
            expect(CHAT_SURFACE_TOOLS).not.toContain(tool);
        }
    });

    it('offers exactly its own allow-list to the transport', async () => {
        const { options } = await send();
        expect(options.allowedTools).toEqual(CHAT_SURFACE_TOOLS);
    });

    it('names a skill ONCE — the index line, not a dump of the body beside it', async () => {
        // F-01's shape: the app retrieves, and the retrieval's bytes must not
        // appear twice — once named in the index and once as a body.
        const { messages } = await send();
        const sent = systemTextOf(asSent(messages));
        expect(countOf(sent, SENTINEL), 'P1 chat: a skill must be NAMED, not dumped').toBe(1);
        expect(sent).toContain(SKILLS_HEADING);
    });

    it('carries the skills index in the recognised section vocabulary', () => {
        const { text } = chatSurfaceSystemPrompt();
        expect(text).toContain(SKILLS_HEADING);
        expect(text).toMatch(/- skill-0 \[active\] — repeat · /);
        // the surface has no chart, so the heading names what the skill must match
        expect(text).toContain('what the trader asks about');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P2 — the dock
// ═══════════════════════════════════════════════════════════════════════════════

describe('P2 · the dock sends a prompt that matches its contract', () => {
    /**
     * The dock's own composer, built from the two blocks the panel
     * concatenates. The panel's own composition is source-pinned below, so
     * this cannot drift away from what the app sends.
     */
    const dockPrompt = (): string => {
        const rows = listSkills().map(({ file, meta }) => ({
            slug: file.name.replace(/\.md$/i, ''),
            status: meta.status,
            kind: meta.kind,
            description: meta.description,
            ifCondition: meta.ifCondition,
            thenAction: meta.thenAction,
        }));
        const skillsBlock = buildSkillsIndexForPrompt(rows, 30, 'this chart');
        return `${TRADE_CHAT_SYSTEM_PROMPT}${skillsBlock ? `\n\n${skillsBlock}` : ''}`;
    };

    it('carries the harness contract exactly once, and the desk-tools block', () => {
        const surface = dockPrompt();
        const sent = systemTextOf(asSent([{ role: 'system', content: surface }]));
        expectContractOn(surface, sent, 'P2 dock');
        expect(sent).toMatch(/ALWAYS ground market claims in evidence/);
        expect(sent).toMatch(/ALWAYS consult the skills library/);
    });

    it('names only tools the dock can actually offer', () => {
        const surface = dockPrompt();
        const sent = systemTextOf(asSent([{ role: 'system', content: surface }]));
        for (const tool of toolsNamedIn(surface)) {
            expect(DOCK_TOOLS, `P2 dock names "${tool}" but has no such tool`).toContain(tool);
        }
        // the debate's private channel is panel-only and is never named
        for (const tool of MAILBOX_TOOLS) {
            expect(surface, `P2 dock names the mailbox tool "${tool}"`).not.toContain(tool);
        }
        // and the sent prompt carries no debate vocabulary at all
        expect(sent.toLowerCase()).not.toContain('debate');
    });

    it('names a skill ONCE — the index line, not a dump of the body beside it', () => {
        const sent = systemTextOf(asSent([{ role: 'system', content: dockPrompt() }]));
        expect(countOf(sent, SENTINEL), 'P2 dock: a skill must be NAMED, not dumped').toBe(1);
        expect(sent).toContain(SKILLS_HEADING);
    });

    it('the panel really does compose the prompt from these two blocks', () => {
        // The dock's composer is a `useCallback` inside the panel, so the
        // contract is asserted over the blocks it concatenates. This pin is
        // what stops that from becoming a second implementation: if the panel
        // stops using TRADE_CHAT_SYSTEM_PROMPT, the assertions above would
        // still pass while the app sent something else.
        const src = readFileSync(join(process.cwd(), 'components/trade/TradeChatPanel.tsx'), 'utf8');
        const composer = src.slice(src.indexOf('const systemPromptFor'));
        expect(composer, 'TradeChatPanel.tsx no longer has a systemPromptFor composer').not.toBe('');
        expect(composer).toContain('TRADE_CHAT_SYSTEM_PROMPT');
        expect(composer).toContain('skillsIndexForPrompt()');
        // and the transport really does enrich what the turn hands it
        const transport = readFileSync(join(process.cwd(), 'services/analysis/DeskToolsService.ts'), 'utf8');
        const entry = transport.slice(transport.indexOf('export async function* streamChatWithDeskTools'));
        expect(entry, 'streamChatWithDeskTools is gone').not.toBe('');
        expect(entry).toContain('withDeskToolsSystemPrompt(messages, nativeTools)');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P3 — the automation
// ═══════════════════════════════════════════════════════════════════════════════

describe('P3 · a scheduled run sends a prompt that matches its contract', () => {
    const send = async () => {
        await runAutomationTurn({
            config: provider,
            history: [] as Message[],
            prompt: 'sweep BTC',
            trades: [],
            username: 'tester',
            automationId: 'a1',
            signal: new AbortController().signal,
            startedAt: Date.now() - 50,
        } as never);
        return captured();
    };

    it('carries the harness contract exactly once, and the desk-tools block', async () => {
        const { messages } = await send();
        const surface = systemTextOf(messages);
        const sent = systemTextOf(asSent(messages));
        expectContractOn(surface, sent, 'P3 automation');
        expect(sent).toMatch(/A SCHEDULED RUN, NOT A CONVERSATION/);
    });

    it('offers exactly the Chat surface\'s set minus the tools that rewrite the notebook', async () => {
        const { options } = await send();
        expect(options.allowedTools).toEqual(AUTOMATION_TOOLS);
        // the deny list is a derivation, not a restatement
        expect(AUTOMATION_TOOLS).toEqual(CHAT_SURFACE_TOOLS.filter(t => !AUTOMATION_UNATTENDED_DENY.includes(t)));
        for (const denied of AUTOMATION_UNATTENDED_DENY) {
            expect(CHAT_SURFACE_TOOLS, `the denied tool "${denied}" no longer exists, so it is not denied`).toContain(denied);
            expect(AUTOMATION_TOOLS).not.toContain(denied);
        }
    });

    it('names only the tools it offers, and never a notebook-writing one', () => {
        const { text } = automationSystemPrompt();
        const surface = text;
        for (const tool of toolsNamedIn(surface)) {
            expect(AUTOMATION_TOOLS, `P3 automation names "${tool}" but does not offer it`).toContain(tool);
        }
        for (const tool of NOTEBOOK_GROWTH_TOOLS.filter(n => !AMBIGUOUS_TOOL_NAMES.includes(n))) {
            expect(surface, `P3 automation names the notebook-writing tool "${tool}"`).not.toContain(tool);
        }
    });

    it('names a skill ONCE — the index line, not a dump of the body beside it', async () => {
        const { messages } = await send();
        const sent = systemTextOf(asSent(messages));
        expect(countOf(sent, SENTINEL), 'P3 automation: a skill must be NAMED, not dumped').toBe(1);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P4 — the evaluation path
// ═══════════════════════════════════════════════════════════════════════════════

describe('P4 · the evaluation path sends a prompt that matches its contract', () => {
    it('composes the harness contract exactly once and does not double it at the transport', async () => {
        const { analyzeTradingView } = await import('../services/providers/GenericAnalysisService');
        await analyzeTradingView(provider, {
            prompt: 'evaluate this skill',
            images: [],
            imageSummaries: [],
            chatHistory: [] as Message[],
            finalTradeSummary: null,
            recentInsights: null,
            activeFrameworks: [],
            deepenAnalysis: false,
            allowedTools: ['get_price_snapshot'],
        } as never).catch(() => undefined);

        const call = mockStream.mock.calls[0] as unknown as [
            unknown, WireMessage[], Record<string, unknown>,
        ];
        expect(call, 'the evaluation path never reached the transport').toBeDefined();
        const composed = systemTextOf(call[1]);
        // it composes the contract ITSELF, so the transport must not add a second
        expect(countOf(composed, CONTRACT_MARK), 'P4 evaluation: the contract must be composed exactly once').toBe(1);
        const sent = systemTextOf(asSent(call[1]));
        expect(countOf(sent, CONTRACT_MARK), 'P4 evaluation: the transport must not add a second contract').toBe(1);
        expectContractOn(composed, sent, 'P4 evaluation');
    });

    it('keeps the retrieved context OUT of the system prompt', async () => {
        // The retrieved memory, the pattern memory and the recent insights are
        // USER-turn content: they are the trader's own records, and the model
        // must be able to tell them from the app's instructions. A retrieval
        // dumped into the system prompt is F-01's shape, one layer up.
        const { analyzeTradingView } = await import('../services/providers/GenericAnalysisService');
        await analyzeTradingView(provider, {
            prompt: 'evaluate this skill',
            images: [],
            imageSummaries: [],
            chatHistory: [] as Message[],
            finalTradeSummary: 'SYNTHESIS-TEXT-MARKER',
            recentInsights: 'INSIGHTS-TEXT-MARKER',
            activeFrameworks: [],
            deepenAnalysis: false,
        } as never).catch(() => undefined);

        const call = mockStream.mock.calls[0] as unknown as [
            unknown, WireMessage[], Record<string, unknown>,
        ];
        expect(call).toBeDefined();
        const system = systemTextOf(call[1]);
        expect(system, 'P4 evaluation: retrieved context must not ride in the system prompt').not.toContain('SYNTHESIS-TEXT-MARKER');
        expect(system).not.toContain('INSIGHTS-TEXT-MARKER');
        // …and it DID ride in the user turn, which is where it belongs
        const user = call[1].filter(m => m.role === 'user').map(m => String(m.content)).join('\n');
        expect(user).toContain('SYNTHESIS-TEXT-MARKER');
    });

    it('sends every registry prompt the path claims to send (E-09)', async () => {
        // E-09's own verification, done the way the plan asks for it: not "a
        // getPrompt() call site exists" but "the prompt REACHES a sent
        // request". `tests/promptsAreWired.test.ts` proves the former; this
        // proves the latter, for the one path a unit test can drive end to
        // end. A registry entry the trader can edit but the model never sees
        // is a control that does nothing.
        const { analyzeTradingView } = await import('../services/providers/GenericAnalysisService');
        const { PROMPT_REGISTRY } = await import('../constants/promptRegistry');

        await analyzeTradingView(provider, {
            prompt: 'evaluate this skill',
            images: [],
            imageSummaries: [],
            chatHistory: [] as Message[],
            finalTradeSummary: null,
            recentInsights: null,
            activeFrameworks: [],
            deepenAnalysis: false,
        } as never).catch(() => undefined);

        const call = mockStream.mock.calls[0] as unknown as [
            unknown, WireMessage[], Record<string, unknown>,
        ];
        expect(call).toBeDefined();
        const sent = systemTextOf(call[1]);

        // the ids the registry says reach `analyzeTradingView`
        const CLAIMED_BY_ANALYSIS = ['analysis.master', 'analysis.risk_rules', 'analysis.memory_enforcement'];
        for (const id of CLAIMED_BY_ANALYSIS) {
            const entry = PROMPT_REGISTRY.find(e => e.id === id);
            expect(entry, `the registry no longer has an entry for "${id}"`).toBeDefined();
            expect(entry!.usage.join(' '), `"${id}" no longer claims the analysis path`).toMatch(/analy/i);
            // the built-in text, or a substantial part of it, must be ON THE WIRE
            const probe = entry!.fallback.trim().slice(0, 120);
            expect(sent, `"${id}" is editable in Settings but its text never reaches a sent request`)
                .toContain(probe);
        }
    });
});
