/**
 * Deep Research — the multi-stage research pipeline (Minara port, option 2).
 *
 * Decompose the question into ≤6 subtasks, ground each one with a real desk
 * tool fetch BEFORE asking the model (the anti-fabrication design: the
 * investigator receives evidence, it is not allowed to "search" with its
 * imagination), cross-validate the findings against each other, then
 * synthesize a cited markdown report. Every stage degrades honestly: a dead
 * search surfaces as DATA_UNAVAILABLE in the evidence, an unparsable finding
 * is dropped (never invented), and a failed validator contributes nothing
 * rather than noise. The zod boundary is schemas/research.ts.
 */

import { ProviderConfig } from '../../types/provider';
import { sendChatRequest } from '../providers/GenericProviderService';
import { TASK_BUDGETS } from '../providers/taskBudgets';
import { effortForTask } from '../providers/reasoningControls';
import { executeDeskTool, isDataUnavailable } from '../analysis/DeskToolsService';
import { extractAndParseJson } from '../../utils/jsonUtils';
import {
    parseResearchSubtasks,
    parseResearchFinding,
    parseResearchContradictions,
    type ResearchFinding,
} from '../../schemas/research';

export interface ResearchReport {
    question: string;
    subtasks: string[];
    findings: ResearchFinding[];
    contradictions: string[];
    /** The final cited markdown report (exec summary + findings + caveats). */
    report: string;
    /** True when every investigation stage returned DATA_UNAVAILABLE — the
     *  report exists but rests on model reasoning, and says so. */
    degraded: boolean;
}

export type ResearchStage = 'plan' | 'investigate' | 'validate' | 'report';

export interface ResearchProgress {
    stage: ResearchStage;
    detail: string;
}

const PLANNER_PROMPT = (question: string): string => `You are a research planner. Decompose this question into at most 6 concrete sub-questions that, answered one by one with web-searchable evidence, answer it fully:

"${question}"

Rules: each sub-question must be independently researchable in one web search; no sub-question may assume an answer to another; keep tickers, dates and units explicit. Reply ONLY with JSON: {"subtasks": ["...", "..."]}`;

const INVESTIGATOR_PROMPT = (question: string, subtask: string, evidence: string): string => `Question under research: "${question}"

YOUR assigned sub-task: "${subtask}"

EVIDENCE fetched live by the system (search may have failed — a DATA_UNAVAILABLE line means the SOURCE is down, NOT that nothing exists):
${evidence}

Answer ONLY your sub-task from this evidence, in 1-3 sentences. Quote numbers exactly as they appear. If the evidence cannot answer it, say so plainly. Reply ONLY with JSON:
{"answer": "...", "sources": ["source titles or urls used"], "confidence": "low|medium|high"}`;

const VALIDATOR_PROMPT = (question: string, findings: ResearchFinding[]): string => `Research question: "${question}"

Findings from independent sub-task investigators:
${findings.map((f, i) => `${i + 1}. [${f.confidence}] ${f.subtask}\n   ${f.answer}`).join('\n')}

List ONLY concrete contradictions or gaps BETWEEN these findings (things a reader must not silently believe). No summary, no restating agreements. Reply ONLY with JSON: {"contradictions": ["...", "..."]} (empty array if none).`;

const REPORTER_PROMPT = (question: string, findings: ResearchFinding[], contradictions: string[]): string => `Write the final research report answering: "${question}"

EVIDENCE FINDINGS (numbered; cite them inline as [1], [2], … — never invent beyond them):
${findings.map((f, i) => `${i + 1}. ${f.subtask} — ${f.answer} (confidence: ${f.confidence}; sources: ${f.sources.join(', ') || 'none'})}`).join('\n')}

${contradictions.length ? `UNRESOLVED CONTRADICTIONS/GAPS (must appear in a "Caveats" section):\n${contradictions.map(c => `- ${c}`).join('\n')}` : ''}

Format: markdown. Start with a 2-3 sentence executive summary, then one section per theme, then "Caveats" and "Sources" (deduped). Prose, not JSON.`;

const searchEvidence = async (query: string, signal?: AbortSignal): Promise<string> => {
    const result = await executeDeskTool(
        { id: `research-search-${Date.now()}`, name: 'web_search', arguments: { query } },
        { signal },
    );
    return result.content || `DATA_UNAVAILABLE: web_search — empty result`;
};

/**
 * Run the full pipeline. Pure-callback architecture (onProgress) so the
 * caller owns rendering; abortable; never throws — failures degrade the
 * report rather than losing it.
 */
export const runDeepResearch = async (params: {
    config: ProviderConfig;
    question: string;
    signal?: AbortSignal;
    onProgress?: (p: ResearchProgress) => void;
}): Promise<ResearchReport> => {
    const { config, question, signal, onProgress } = params;
    const ask = async (prompt: string, budget: number, jsonMode: boolean): Promise<string> => {
        try {
            return await sendChatRequest(
                config,
                [{ role: 'user', content: prompt }],
                {
                    maxTokens: budget,
                    temperature: 0.25,
                    signal,
                    jsonMode,
                    reasoningEffort: effortForTask('analysis'),
                },
            );
        } catch (e) {
            console.warn('[Research] stage call failed:', e instanceof Error ? e.message : e);
            return '';
        }
    };

    // ── Stage 1: plan ────────────────────────────────────────────────────────
    onProgress?.({ stage: 'plan', detail: 'Decomposing the question…' });
    let subtasks: string[] = [];
    try {
        const planned = await ask(PLANNER_PROMPT(question), TASK_BUDGETS.researchPlan, true);
        subtasks = parseResearchSubtasks(extractAndParseJson(planned));
    } catch { /* fall through to single-task */ }
    if (subtasks.length === 0) subtasks = [question];

    // ── Stage 2: investigate (serial — prevents search fan-out bursts) ──────
    const findings: ResearchFinding[] = [];
    for (let i = 0; i < subtasks.length; i++) {
        if (signal?.aborted) break;
        const subtask = subtasks[i];
        onProgress?.({ stage: 'investigate', detail: `(${i + 1}/${subtasks.length}) ${subtask}` });
        const evidence = await searchEvidence(`${question} ${subtask}`.trim(), signal);
        const raw = await ask(INVESTIGATOR_PROMPT(question, subtask, evidence), TASK_BUDGETS.researchFinding, true);
        let parsed: unknown = raw;
        try { parsed = extractAndParseJson(raw); } catch { /* bare-string salvage */ }
        const finding = parseResearchFinding(parsed);
        if (finding) findings.push({ subtask, evidence: isDataUnavailable(evidence) ? undefined : evidence.slice(0, 1500), ...finding });
    }
    const degraded = findings.length === 0
        || findings.every(f => !f.sources.length && /cannot|unavailable|no evidence|insufficient|does not|do not/i.test(f.answer));

    // ── Stage 3: cross-validate ──────────────────────────────────────────────
    let contradictions: string[] = [];
    if (findings.length >= 2) {
        onProgress?.({ stage: 'validate', detail: 'Cross-checking findings…' });
        try {
            const raw = await ask(VALIDATOR_PROMPT(question, findings), TASK_BUDGETS.researchValidate, true);
            contradictions = parseResearchContradictions(extractAndParseJson(raw));
        } catch { /* a validator that can't speak contributes nothing */ }
    }

    // ── Stage 4: synthesize the cited report ─────────────────────────────────
    onProgress?.({ stage: 'report', detail: 'Writing the report…' });
    let report = '';
    if (findings.length > 0) {
        report = await ask(REPORTER_PROMPT(question, findings, contradictions), TASK_BUDGETS.researchReport, false);
    }
    if (!report) {
        // Honest fallback: the findings themselves, verbatim, with their
        // confidence — a report assembled from data beats a blank message.
        report = [
            `# Research report: ${question}`,
            findings.length
                ? findings.map((f, i) => `## ${i + 1}. ${f.subtask}\n\n${f.answer} _(confidence: ${f.confidence}; sources: ${f.sources.join(', ') || 'none'})_`).join('\n\n')
                : '_All investigation stages came back without usable evidence — the searches failed or the sources could not answer. No conclusion is offered, because none was earned._',
            contradictions.length ? `\n## Caveats\n${contradictions.map(c => `- ${c}`).join('\n')}` : '',
        ].filter(Boolean).join('\n');
    }

    return { question, subtasks, findings, contradictions, report, degraded };
};
