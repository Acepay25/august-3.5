import { describe, it, expect, beforeEach } from 'vitest';
import { debateFloorProgress } from '../utils/debateFloor';
import { loadThinkingLeakBin, noteThinkingLeak, stillLooksLikeLeakedThinking } from '../utils/thinkingLeakBin';
import { splitThinkingFromOutput } from '../utils/thinkingSplit';

describe('debateFloorProgress', () => {
    it('prefers existing ensembleProgress', () => {
        const progress = debateFloorProgress({
            ensembleProgress: {
                analysts: [{
                    key: 'a1',
                    providerId: 'p',
                    providerName: 'P',
                    modelId: 'm',
                    modelName: 'm',
                    displayName: 'Macro',
                    status: 'complete',
                }],
                moderator: { status: 'waiting' },
            },
        });
        expect(progress?.analysts[0].displayName).toBe('Macro');
    });

    it('builds seats from debate speakers when progress is missing', () => {
        const progress = debateFloorProgress({
            isDebating: true,
            debateTurns: [
                { speaker: 'Analyst A', text: 'Fade the wick.', round: 1 },
                { speaker: 'Moderator', text: 'Size?', round: 2 },
            ],
        });
        expect(progress?.analysts).toHaveLength(1);
        expect(progress?.analysts[0].displayName).toBe('Analyst A');
        expect(progress?.moderator.status).toBe('reviewing');
    });
});

describe('thinking leak bin', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('records leftover think tags after a split miss', () => {
        expect(stillLooksLikeLeakedThinking('<think>still here')).toBe(true);
        noteThinkingLeak('<think>still here in the visible answer after peel');
        expect(loadThinkingLeakBin()[0].snippet).toContain('still here');
    });

    it('notes a leak when the splitter cannot hide remaining think tags', () => {
        const split = splitThinkingFromOutput('', 'Normal answer with no tags.');
        expect(split.output).toBe('Normal answer with no tags.');
        expect(loadThinkingLeakBin()).toHaveLength(0);
    });
});
