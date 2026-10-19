/**
 * Prompt registry — every user-editable prompt in the app.
 *
 * The Settings → Prompts tab renders this list; edits are stored by
 * PromptOverrideService and applied at call time via getPrompt(id, fallback).
 * `fallback` is the built-in default (shown in the editor and used by
 * "Reset to default"). `usage` is a human-readable list of where the prompt
 * reaches a model.
 */

import {
    MASTER_ANALYSIS_PROMPT,
    COMPACT_ANALYSIS_PROMPT,
    RISK_MANAGEMENT_RULES,
} from './prompts/analysisPrompts';
// The predicate grammar lives with its evaluator (skillPredicate's field
// whitelist), not with the prompt text, so an override can never ask for a
// clause the parser would reject. Leaf import — no cycle back here.
import { PREDICATE_GRAMMAR_HINT } from '../services/analysis/skillPredicate';
import { AI_PROVIDER_MEMORY_ENFORCEMENT_PROMPT } from './prompts/memoryPrompts';

export interface PromptRegistryEntry {
    /** Stable id — the key user overrides are stored under. */
    id: string;
    /** Display name in the Prompts tab. */
    name: string;
    /** One-line description of what this prompt does. */
    description: string;
    /** Where this prompt reaches a model (shown as chips). */
    usage: string[];
    /** The built-in default text (editor content + reset target). */
    fallback: string;
}

export const PROMPT_REGISTRY: PromptRegistryEntry[] = [
    {
        id: 'analysis.master',
        name: 'Master Analysis Prompt',
        description: 'Standard-mode system prompt: desk-trader scan (structure, liquidity, volume, session, playbooks if they fit). Prose output follows the findings — no section template.',
        usage: ['Standard-mode analysis (analyzeTradingView)'],
        fallback: MASTER_ANALYSIS_PROMPT,
    },
    {
        id: 'analysis.compact',
        name: 'Compact Analysis Prompt',
        description: 'Trimmed desk-trader brief for small-context models (low context window).',
        usage: ['Small-context-model analysis'],
        fallback: COMPACT_ANALYSIS_PROMPT,
    },
    {
        id: 'analysis.risk_rules',
        name: 'Risk Management Rules',
        description: 'Mandatory risk rules appended to every analysis mode (leverage, R:R floor, position sizing).',
        usage: ['All analysis modes'],
        fallback: RISK_MANAGEMENT_RULES,
    },
    {
        id: 'analysis.memory_enforcement',
        name: 'Pattern Memory Enforcement',
        description: 'Instructs the model to use retrieved memory only when it matches this setup — never invent citations.',
        usage: ['Standard-mode analysis system prompt'],
        fallback: AI_PROVIDER_MEMORY_ENFORCEMENT_PROMPT,
    },
    {
        id: 'strategy.summarize_pdf',
        name: 'PDF Strategy Summarizer',
        description: 'Turns uploaded PDF book text into concise, actionable trading strategies (used when summarizing an upload in Settings → Strategies).',
        usage: ['PDF upload summarization (Settings → Strategies)'],
        fallback: `You are a trading-strategy extractor. A trader uploaded part of a trading book/manual and needs ONLY the actionable strategies extracted for live use by AI trading analysts.

Extract every concrete trading strategy, rule, or setup the text describes. For each one capture:
- Name/type (e.g. "breakout retest", "engulfing continuation", "range fade")
- Entry conditions (exact price/indicator/candle conditions)
- Stop-loss placement
- Take-profit / exit rules
- Filters (what invalidates the setup, required market conditions)
- Position sizing / risk guidance if given

Rules:
- Output ONLY strategies; skip theory, anecdotes, fluff, and motivation.
- Keep each strategy under 120 words, as concise bullet-style prose.
- Preserve concrete numbers (levels, ratios, thresholds) exactly.
- If a passage has no actionable strategy, skip it.
- Format: a numbered list of "**Strategy: <name>** — <conditions>…".
- If nothing actionable exists, reply with exactly: "No actionable strategies found."`,
    },
    {
        id: 'notebook.note',
        name: 'Trader Notebook Note Writer',
        description: 'After each closed trade, decides what the Trader Notebook (Settings → Personal edge) needs: SKIP when the lesson is already covered, APPEND a new section to an existing file, or CREATE a new file/folder. The current notebook index (folders + files + excerpts) is appended by the service so the model always reads the real notebook before writing.',
        usage: ['After every logged WIN/LOSS post-mortem (AI memory writer)'],
        fallback: `You maintain the trader's notebook — markdown files the AI ensemble reads before EVERY future analysis. After each closed trade you decide whether to write, and how.

The CURRENT NOTEBOOK block below lists every folder and file with a short excerpt. READ IT FIRST — it is the only way to write smartly.

DECIDE:
- "skip" — when this trade's lesson is already fully covered by an existing file, or nothing new or valuable emerged. Writing junk hurts future analyses.
- "append" — when an existing file already covers this topic: your content becomes a NEW SECTION appended to that file (own ## heading, --- separated). Never repeat what that file already says.
- "create" — when the topic is new: a new file. A new folder ONLY when the topic family has no home (market-conditions / rules / lessons are the usual homes). trader-diary is reserved for the automatic diary — never write there.

Content rules:
- Actionable and TIMELESS: what to REPEAT or AVOID next time the same situation appears. No PnL, no dates, no trade ids.
- Written in first person ("When I…", "I will…") as the trader's own lesson.
- 10-40 lines of clean markdown per section: a short heading, 3-8 bullet points, optional "Trigger" / "Invalidates" lines.
- Precise: keep the concrete levels, indicators, regime, and patterns that actually mattered in this trade.

Output ONLY valid JSON with exactly these fields:
{
  "decision": "skip" | "append" | "create",
  "folder": "existing-or-new-kebab-folder",
  "fileName": "short-kebab-name.md",
  "content": "markdown (append: the new section with its own ## heading; create: the whole file)"
}`,
    },
    {
        id: 'notebook.chat_note',
        name: 'Trader Notebook Quick-Save (chat)',
        description: 'Runs when the user asks mid-conversation to save something to the notebook ("save this to the notebook"). The model reads the current notebook index, then decides skip / append to an existing file / create a new file or folder.',
        usage: ['Chat quick-save requests (short-circuits the analysis pipeline)'],
        fallback: `The user asked you to save something to their trader notebook — markdown files the AI ensemble reads before EVERY future analysis. Decide what the notebook needs.

The CURRENT NOTEBOOK block below lists every folder and file with a short excerpt. READ IT FIRST.

DECIDE:
- "skip" — when the request has no concrete, reusable lesson/rule/playbook, or it is already fully covered by an existing file.
- "append" — when an existing file already covers this topic: your content becomes a NEW SECTION on that file (own ## heading, --- separated). Never repeat what that file already says.
- "create" — when the topic is new: a new file. A new folder ONLY when the topic family has no home (market-conditions / rules / lessons are the usual homes). trader-diary is reserved for the automatic diary — never write there.

Content rules:
- Actionable and TIMELESS: what to REPEAT or AVOID next time the same situation appears. No PnL, no dates, no trade ids.
- Written in first person ("When I…", "I will…") as the trader's own lesson.
- 10-40 lines of clean markdown per section: a short heading, 3-8 bullet points, optional "Trigger" / "Invalidates" lines.
- If the user references the CONTEXT below (their most recent analysis), write about THAT setup.

Output ONLY valid JSON with exactly these fields:
{
  "decision": "skip" | "append" | "create",
  "folder": "existing-or-new-kebab-folder",
  "fileName": "short-kebab-name.md",
  "content": "markdown"
}`,
    },
    {
        id: 'strategy.ocr_page',
        name: 'PDF Page OCR',
        description: 'Transcribes a scanned (image-only) PDF page into text using the vision model, so scanned books can be summarized too.',
        usage: ['Scanned PDF pages (Settings → Strategies)'],
        fallback: `You are a precise OCR engine. Transcribe ALL text visible in this page image of a trading book, exactly as written — headings, body text, tables, captions, numbers, and footnotes.

Rules:
- Preserve line breaks between paragraphs.
- Do not add commentary, explanations, or markdown formatting.
- Output ONLY the transcribed text.`,
    },
    {
        // KEEP IN SYNC with SKILL_CRAFT_FALLBACK (services/learning/SkillCraftService.ts):
        // this text is only the Settings diff base, while the call-site constant
        // is what actually runs — a stale copy here makes every override diff lie.
        id: 'learning.skill_craft',
        name: 'Skill craft (IF/THEN → procedure)',
        description: 'After a post-mortem, the memory model turns the lesson into a skill: description, when, inputs, steps, pitfalls, verification, validate, return, approval.',
        usage: ['Post-mortem skill draft (inbox Approve to save)'],
        fallback: `You turn a closed-trade post-mortem into ONE reusable trading skill.

A skill is a PROCEDURE another agent will follow, not a diary sentence. It has
to carry these parts:

1. when to use it — the concrete trigger
2. when NOT to use it — the situations that LOOK like this one and are not
3. required inputs
4. the sequence of work (steps), each with the exact check or tool call
5. the pitfalls you have actually seen: "X happens -> do Y instead"
6. how to verify the procedure worked, not just that it was followed
7. how to validate the trigger still holds
8. what to return (the ticket action)
9. what requires human approval

A one-line rule is a SEED, not a finished skill. If the post-mortem only
supports "when X, avoid", still fill whenNot and pitfalls with what you
observed — an empty section is how a skill degrades back into a rule.

KIND:
- avoid — the trade lost or the lesson is "do not take this"
- repeat — the trade won and the lesson is "take this only when the IF holds"

IF/THEN must be mechanical (price, candle close, level, volume, regime). No vibes.

DESCRIPTION — the activation key. Retrieval scores this string against the
live setup to decide whether the skill loads at all, so it carries the
trigger, not praise:
"What it does in one sentence. Use this skill whenever <the concrete trigger
phrases>. Do NOT use for <one brief out-of-scope clause>."
Lead with the triggers; keep the exclusion to a single clause.

EXAMPLES — when the post-mortem contains a concrete instance, add up to two
{"input","output"} pairs: the setup as it appeared, and what this procedure
says to do. Omit "examples" when nothing concrete exists — a fabricated
example is worse than an absent one.

A skill may carry a full STRATEGY beside the rule. When the post-mortem supports a complete trade plan, state it in the
"strategy" object so the app can build a ticket from it — entry, stop, target,
sizing, and the conditions that must hold. Use plain price/level/condition
language, not numbers you invented. Omit "strategy" entirely when the lesson
is only "do not take this" — but the whenNot / pitfalls / verification sections
are still expected, because that is where the lesson actually lives.

Output ONLY JSON:
{
  "name": "short kebab-or-title (max 8 words)",
  "description": "what it does — Use this skill whenever <trigger phrases>. Do NOT use for <one clause>.",
  "kind": "avoid" | "repeat",
  "when": "trigger in one sentence",
  "whenNot": ["looks like this but is not this — why"],
  "inputs": ["coin", "direction", "timeframe or family"],
  "steps": ["step 1 with the exact check", "step 2", "step 3"],
  "pitfalls": ["observed failure -> what to do instead"],
  "verification": "how the agent confirms the procedure worked",
  "examples": [{"input": "the setup as it appeared", "output": "what this procedure says to do"}],
  "relatedSkills": ["slug of a skill this one overlaps or contradicts"],
  "validate": "how to know the IF still holds",
  "output": "what the next ticket should do",
  "approval": "when a human must confirm (size, new coin, conflicting skill)",
  "ifCondition": "IF clause without the word IF",
  "thenAction": "THEN clause without the word THEN",
  "strategy": {
    "entry": "price / zone / condition to enter",
    "invalidation": "what voids the setup",
    "stop": "protective level",
    "target": "first objective",
    "sizing": "risk budget or size rule",
    "conditions": ["must be true to trade this now"]
  },
  "predicate": ${JSON.stringify(PREDICATE_GRAMMAR_HINT)}
}`,
    },
    {
        id: 'learning.chart_scan',
        name: 'Chart-history skill scan',
        description: 'The model reads a digest of the ENTIRE candle history of a chart (regimes, swings, gaps, every setup detector with historical win-rates) and drafts 1–3 IF/THEN skills from how the chart actually moved.',
        usage: ['scan_chart_skills desk tool + "Scan → skills" in the Chart AI composer (drafts go to the Inbox for approval)'],
        fallback: `You are a trading-pattern researcher. You receive a machine-built digest of an ENTIRE chart's candle history: regime segments, swing pivots, gap classes, RSI extremes, and every strategy-book setup detector aggregated across the whole tape with first-touch win-rates (1.5×ATR target vs 1×ATR stop, 12-bar horizon). Study how THIS chart actually moves and draft reusable IF/THEN trading skills for this coin and timeframe.

Rules:
- Ground every skill in the digest's numbers. Prefer detectors with enough hits and a win rate that is clearly not a coin flip; cite the observed count and rate inside "when".
- A skill is a mechanical procedure, not a mood. "ifCondition" must state concrete checkable conditions (levels, candle anatomy, indicator state, context). "thenAction" must be an executable entry/exit or an explicit avoid, with invalidation.
- kind "repeat" = a setup the tape shows working; kind "avoid" = a trap the tape shows losing (fading a band walk, chasing a failed break, and similar).
- Name each skill specifically (coin + timeframe + pattern), never generically.
- Inventing a pattern the digest does not support is worse than drafting none. If nothing qualifies, return an empty array.
- Keep "description" as the activation key — retrieval scores it against the live setup: what the skill does, then "Use this skill whenever <the concrete trigger phrases the tape supports>. Do NOT use for <one brief exclusion>."
- The digest is built from CLOSED candles, so also author a "predicate" where the IF clause reduces to candle math: ${PREDICATE_GRAMMAR_HINT} A predicate is what lets the desk re-check the trigger in code on every later run instead of trusting a seat to read prose; omit it when the clause cannot be reduced.`,
    },
];
