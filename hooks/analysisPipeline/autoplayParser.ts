/**
 * Pipeline stage module — accuracy-mode autoplay transcript parsing.
 *
 * Extracted verbatim from useAnalysisPipeline's send path: in accuracy mode
 * the moderator autoplays the whole simulated transcript as one stream, and
 * every stream chunk is re-split into debate turns (speaker, round, text,
 * reasoning) for the messenger chat. Pure given its inputs — the caller owns
 * the stream loop, the staleness guard and the throttled UI write — so it is
 * unit-testable without mounting the hook.
 */

import { DebateTurn } from '../../types';
import { parseStructuredAutoplayTranscript } from '../../utils/debateTranscript';
import { applyReplyTo } from '../../utils/debateReplyTo';
import { splitThinkingFromOutput } from '../../utils/thinkingSplit';
import { sanitizeAIResponseLight } from '../../utils/sanitizers';

// The established model-alias roster shared by BOTH autoplay transcript
// parsers (accuracy-mode pipeline + post-mortem debate). Updated to include
// Puter model names (Claude, GPT, Grok, etc.) and OpenRouter. Participant
// names are merged in FIRST (live enabledProviders on the pipeline side,
// resultProviderNames on the post-mortem side) so a runtime-configured
// custom provider's turns are never silently dropped. Call sites that need
// aliases beyond this base pass them as `extraAliases` — the two call
// sites' rosters intentionally differ (see usePostMortem's O1/O3/O4).
const BASE_SPEAKER_ALIASES = [
    'Gemini', 'DeepSeek', 'Zhipu', 'Groq', 'Groq \\(Alt\\)', 'Groq \\(Alt 2\\)', 'OpenRouter',
    'Moderator', 'Master Strategist', 'Claude[^:]*', 'GPT[^:]*', 'Grok[^:]*', 'Mistral[^:]*',
    'Kimi[^:]*', 'Qwen[^:]*', 'LLaMA[^:]*', 'Puter[^:]*',
];

import { escapeRegExp } from '../../utils/escapeRegExp';

/**
 * The autoplay turn regex, built from the ACTUAL participating provider
 * names (escaped here) plus the established model aliases. Longest-first
 * ordering keeps multi-word names like `Groq (Alt 2)` matching before their
 * shorter prefixes. Consumed by useAnalysisPipeline (accuracy mode) AND
 * usePostMortem (post-mortem debate) — one builder, two rosters.
 */
export const buildAutoplaySpeakerRegex = (participantNames: string[], extraAliases: string[] = []): RegExp => {
    const speakerNames = [...new Set([
        ...participantNames.map(escapeRegExp),
        ...BASE_SPEAKER_ALIASES,
        ...extraAliases,
    ])].sort((a, b) => b.length - a.length);
    const speakerPattern = speakerNames.join('|');
    return new RegExp(`(?:^|\\n)\\s*(?:[*_~]*)(${speakerPattern})[^\\n]*?(?:[*_~]*)\\s*:\\s*([\\s\\S]*?)(?=(?:^|\\n)\\s*(?:[*_~]*)(${speakerPattern})[^\\n]*?(?:[*_~]*)\\s*:|$)`, 'gi');
};

// Peel thinking out of a turn BEFORE sanitizing —
// sanitizeAIResponseLight strips <think> tags but keeps
// their bodies, so the split must run first. Used by the
// accuracy-mode autoplay path (the standard path uses
// peelDebateTurn, which also merges streamed CoT).
const peelRawTurn = (raw: string): { text: string; reasoning?: string } => {
    const split = splitThinkingFromOutput('', raw);
    return {
        text: sanitizeAIResponseLight(split.output),
        reasoning: split.thinking || undefined,
    };
};

/**
 * Re-parse the accumulated autoplay stream into normalized debate turns.
 * Runs once per stream chunk against the FULL text so far — prefix-stable:
 * earlier turns never change as the stream grows. `turnRegex` comes from
 * `buildAutoplaySpeakerRegex` so live provider names match alongside the
 * model aliases.
 */
export const parseAutoplayTranscriptChunk = (fullResponseText: string, turnRegex: RegExp): DebateTurn[] => {
    const startTagRegex = /(?:<|\*\*<|`|< \*\*|_\*<)?DEBATE_START(?:>|>\*\*|`|\*\* >|>\*_)*/i;
    const endTagRegex = /(?:<|\*\*<|`|< \*\*|_\*<)?\/?(?:DEBATE_END|\/DEBATE_START)(?:>|>\*\*|`|\*\* >|>\*_)*/i;

    const startMatch = fullResponseText.match(startTagRegex);
    let debateContent = '';
    let synthesisContent = '';

    if (startMatch) {
        const startIndex = startMatch.index! + startMatch[0].length;
        const endMatch = fullResponseText.slice(startIndex).match(endTagRegex);
        if (endMatch) {
            debateContent = fullResponseText.slice(startIndex, startIndex + endMatch.index!);
            const endTagLength = endMatch[0].length;
            const contentAfterDebate = fullResponseText.slice(startIndex + endMatch.index! + endTagLength);
            const jsonStart = contentAfterDebate.match(/<JSON_PLAN>|```json/i);
            if (jsonStart) {
                synthesisContent = contentAfterDebate.substring(0, jsonStart.index).trim();
            } else {
                synthesisContent = contentAfterDebate.trim();
            }
        } else {
            debateContent = fullResponseText.slice(startIndex);
        }
    } else {
        if (/(Gemini|DeepSeek|Zhipu|Groq|Groq \(Alt\)|Moderator|Master Strategist).*:/.test(fullResponseText)) {
            const jsonStart = fullResponseText.match(/<JSON_PLAN>|```json/i);
            if (jsonStart) {
                debateContent = fullResponseText.substring(0, jsonStart.index);
            } else {
                debateContent = fullResponseText;
            }
        }
    }

    const currentTurns: DebateTurn[] = [];
    const structuredTurns = parseStructuredAutoplayTranscript(debateContent);
    const matches = structuredTurns.length > 0
        ? []
        : [...debateContent.matchAll(turnRegex)];
    // Autoplayed transcripts carry no explicit rounds —
    // derive them: each moderator turn starts a new
    // round, so the messenger chat keeps its round
    // separators and the final moderator message gets
    // the verdict treatment. Prefix-stable: earlier
    // turns never change as the stream grows.
    let autoplayRound = 0;
    const parsedTurns = structuredTurns.length > 0
        ? structuredTurns.map(turn => ({
            speaker: turn.speaker,
            round: turn.round,
            text: turn.text,
        }))
        : matches.map(m => ({
            speaker: m[1].trim(),
            round: undefined,
            text: m[2].trim(),
        }));
    for (const parsed of parsedTurns) {
        let speaker = parsed.speaker.trim();
        if (speaker === "Master Strategist") speaker = "Moderator";
        speaker = speaker.charAt(0).toUpperCase() + speaker.slice(1);
        if (parsed.round !== undefined) autoplayRound = parsed.round;
        else if (speaker === 'Moderator') autoplayRound++;
        const peeledTurn = peelRawTurn(parsed.text);
        currentTurns.push({
            speaker: speaker as DebateTurn['speaker'],
            round: autoplayRound > 0 ? autoplayRound : undefined,
            text: peeledTurn.text,
            reasoning: peeledTurn.reasoning,
        });
    }

    // The moderator's verdict prose sits right before
    // </DEBATE_END> (no "Speaker:" prefix), so the turn
    // regex can't capture it — surface it as the final
    // moderator synthesis instead of dropping it.
    if (!synthesisContent && structuredTurns.length > 0) {
        const lastTurnEnd = debateContent.toLowerCase().lastIndexOf('</turn>');
        const trailing = lastTurnEnd >= 0 ? debateContent.slice(lastTurnEnd + '</turn>'.length) : '';
        if (trailing.trim()) {
            synthesisContent = trailing.trim();
        }
    } else if (!synthesisContent && matches.length > 0) {
        const lastMatch = matches[matches.length - 1];
        const trailing = debateContent.slice((lastMatch.index ?? 0) + lastMatch[0].length);
        if (trailing.trim()) {
            synthesisContent = trailing.trim();
        }
    }

    if (synthesisContent) {
        const cleanSynthesis = synthesisContent.replace(/^(?:[*_~]*)(Moderator|Master Strategist)[^:\n]*?:\s*/i, '');
        const lastTurn = currentTurns[currentTurns.length - 1];
        if (cleanSynthesis && (!lastTurn || lastTurn.text !== cleanSynthesis)) {
            const peeledSynthesis = peelRawTurn(cleanSynthesis);
            currentTurns.push({ speaker: 'Moderator', round: autoplayRound + 1, text: peeledSynthesis.text, reasoning: peeledSynthesis.reasoning });
        }
    }

    // Coalesce per-token updates into one per frame.
    // REPLY-TO markers become `to` and leave the display text.
    return currentTurns.map(applyReplyTo);
};
