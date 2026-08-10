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
    ACCURACY_MODE_PROMPT,
    PURE_AI_MODE_PROMPT,
    LENS_MODE_BASE_PROMPT,
    COMPACT_ANALYSIS_PROMPT,
    RISK_MANAGEMENT_RULES,
    TRADING_FAMILIES_PROMPT,
    STRESS_TEST_PROTOCOL,
    PROBABILITY_ESTIMATION_PROMPT,
} from './prompts/analysisPrompts';
import {
    MODERATOR_SYSTEM_PROMPT_V2,
    PURE_AI_MODERATOR_PROMPT,
    DEBATE_RESPONSE_PROMPT,
    MODERATOR_FINAL_AUTHORITY_PROTOCOL,
    MODERATOR_VERIFICATION_ENFORCEMENT_PROMPT,
    MODERATOR_CLARIFICATION_QUESTIONS_PROMPT,
    ANALYST_CLARIFICATION_RESPONSE_PROMPT,
    MODERATOR_CLARIFICATION_JUDGMENT_PROMPT,
    MODERATOR_FINAL_VERDICT_PROMPT,
    MODERATOR_FINAL_VERDICT_PROMPT_COMPACT,
} from './prompts/debatePrompts';
import { AI_PROVIDER_MEMORY_ENFORCEMENT_PROMPT } from './prompts/memoryPrompts';
import {
    ENTRY_NOT_HIT_ANALYSIS_PROMPT,
    ENTRY_NOT_HIT_ANALYSIS_QUESTIONS,
    EXTENDED_SL_ZONE_DEBATE_CONTEXT,
} from './prompts/learningPrompts';

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
        description: 'Standard-mode system prompt: the full multi-section analysis contract (structure, families, probability, trade setup) every analyst sees.',
        usage: ['Standard-mode analysis (analyzeTradingView)', 'Accuracy-mode base (combined with the accuracy protocol)'],
        fallback: MASTER_ANALYSIS_PROMPT,
    },
    {
        id: 'analysis.accuracy',
        name: 'Accuracy Protocol (11-Layer)',
        description: 'High-precision accuracy-mode header: the mandatory 11-layer pipeline and output contract.',
        usage: ['Accuracy-mode analysis system prompt'],
        fallback: ACCURACY_MODE_PROMPT,
    },
    {
        id: 'analysis.pure_ai',
        name: 'Pure AI Mode Prompt',
        description: 'Unrestricted reasoning mode: drops playbooks/families and instructs free-form analysis with a prose output contract.',
        usage: ['Pure-AI-mode analysis system prompt'],
        fallback: PURE_AI_MODE_PROMPT,
    },
    {
        id: 'analysis.lens',
        name: 'Analyst Lens Base Prompt',
        description: 'Base system prompt when specialized analyst roles (Macro / Technical / Risk) are enabled.',
        usage: ['Lens-mode analysis system prompt'],
        fallback: LENS_MODE_BASE_PROMPT,
    },
    {
        id: 'analysis.compact',
        name: 'Compact Analysis Prompt',
        description: 'Trimmed analysis contract for small-context models (low context window).',
        usage: ['Small-context-model analysis'],
        fallback: COMPACT_ANALYSIS_PROMPT,
    },
    {
        id: 'analysis.risk_rules',
        name: 'Risk Management Rules',
        description: 'Mandatory risk rules appended to every analysis mode (leverage, R:R floor, position sizing).',
        usage: ['All analysis modes', 'Moderator prompts'],
        fallback: RISK_MANAGEMENT_RULES,
    },
    {
        id: 'analysis.families',
        name: 'Market Classification Families',
        description: 'The Family A/B/C/Omega classification reference used when families are enabled.',
        usage: ['Pure-AI analysis (families toggle)', 'Moderator prompts'],
        fallback: TRADING_FAMILIES_PROMPT,
    },
    {
        id: 'analysis.memory_enforcement',
        name: 'Pattern Memory Enforcement',
        description: 'Instructs the model to treat the provided pattern memory / recent insights as the source of truth.',
        usage: ['Standard-mode analysis system prompt'],
        fallback: AI_PROVIDER_MEMORY_ENFORCEMENT_PROMPT,
    },
    {
        id: 'debate.moderator_autoplay',
        name: 'Moderator (Accuracy Autoplay)',
        description: 'The accuracy-mode moderator that simulates the full multi-round debate transcript in one response.',
        usage: ['Accuracy-mode simulated debate'],
        fallback: MODERATOR_SYSTEM_PROMPT_V2,
    },
    {
        id: 'debate.moderator_pure_ai',
        name: 'Moderator (Pure AI)',
        description: 'Pure-AI-mode moderator: free-form simulated discussion without protocol/family constraints.',
        usage: ['Pure-AI-mode simulated debate'],
        fallback: PURE_AI_MODERATOR_PROMPT,
    },
    {
        id: 'debate.rebuttal',
        name: 'Debate Rebuttal Instruction',
        description: 'Per-round instruction for each analyst\'s rebuttal in the real turn-taking debate.',
        usage: ['Real-debate rebuttal rounds'],
        fallback: DEBATE_RESPONSE_PROMPT,
    },
    {
        id: 'debate.moderator_authority',
        name: 'Moderator Final Authority',
        description: 'Ends the debate with the moderator\'s binding verdict and JSON plan contract.',
        usage: ['Simulated debates', 'Post-mortem debates'],
        fallback: MODERATOR_FINAL_AUTHORITY_PROTOCOL,
    },
    {
        id: 'debate.verification',
        name: 'Moderator Verification Enforcement',
        description: 'Forces claim verification against chart data in the two/three-way simulated debates.',
        usage: ['Two/three-way simulated debates'],
        fallback: MODERATOR_VERIFICATION_ENFORCEMENT_PROMPT,
    },
    {
        id: 'debate.probability_estimation',
        name: 'Probability Estimation Contract',
        description: 'Level-probability JSON contract for the live-debate moderator verdict.',
        usage: ['Live real-debate moderator'],
        fallback: PROBABILITY_ESTIMATION_PROMPT,
    },
    {
        id: 'debate.clarification_questions',
        name: 'Clarification Questions',
        description: 'Moderator instruction for the targeted-question round of the real debate.',
        usage: ['Real-debate clarification loop'],
        fallback: MODERATOR_CLARIFICATION_QUESTIONS_PROMPT,
    },
    {
        id: 'debate.clarification_answer',
        name: 'Clarification Answer',
        description: 'Per-analyst instruction for answering the moderator\'s clarifying questions (60-100 words).',
        usage: ['Real-debate clarification loop'],
        fallback: ANALYST_CLARIFICATION_RESPONSE_PROMPT,
    },
    {
        id: 'debate.clarification_judgment',
        name: 'Clarification Judgment',
        description: 'Internal moderator call on whether the clarification cycle resolved the concerns.',
        usage: ['Real-debate clarification loop'],
        fallback: MODERATOR_CLARIFICATION_JUDGMENT_PROMPT,
    },
    {
        id: 'debate.final_verdict',
        name: 'Final Verdict Framing',
        description: 'Final-verdict framing for the simulated debate paths.',
        usage: ['Two/three-way simulated debates'],
        fallback: MODERATOR_FINAL_VERDICT_PROMPT,
    },
    {
        id: 'debate.final_verdict_compact',
        name: 'Final Verdict Framing (Compact)',
        description: 'Shortened final-verdict framing for constrained contexts.',
        usage: ['Compact simulated debates'],
        fallback: MODERATOR_FINAL_VERDICT_PROMPT_COMPACT,
    },
    {
        id: 'debate.stress_test',
        name: 'Stress Test Protocol',
        description: 'Red-team block: forces the debate to hunt for liquidity traps and failure scenarios.',
        usage: ['Moderator prompts (all debate paths)'],
        fallback: STRESS_TEST_PROTOCOL,
    },
    {
        id: 'postmortem.entry_not_hit',
        name: 'Entry-Not-Hit Analysis (Intro)',
        description: 'Role/task/context framing for the entry-not-hit post-mortem.',
        usage: ['Entry-not-hit post-mortem'],
        fallback: ENTRY_NOT_HIT_ANALYSIS_PROMPT,
    },
    {
        id: 'postmortem.entry_not_hit_questions',
        name: 'Entry-Not-Hit Analysis (Questions)',
        description: 'The mandatory questionnaire appended after the trade context.',
        usage: ['Entry-not-hit post-mortem'],
        fallback: ENTRY_NOT_HIT_ANALYSIS_QUESTIONS,
    },
    {
        id: 'postmortem.extended_sl_zone',
        name: '150% Extended SL Zone Contract',
        description: 'The extended-SL-zone semantics injected into the post-mortem debate (shared by all generators).',
        usage: ['Post-mortem debates (two/three-way)'],
        fallback: EXTENDED_SL_ZONE_DEBATE_CONTEXT,
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
];
