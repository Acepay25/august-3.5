/**
 * DeepSeek-style pre-step waterfall: admit, rewrite, or skip remaining
 * worker rounds before the next model call.
 */

export interface DebatePreStepInput {
    gateResult?: 'PASS' | 'WARNING' | 'HALT' | 'REDUCE_SIZE' | string;
    reason?: string;
    skillVeto?: string;
}

export interface DebatePreStepDecision {
    action: 'continue' | 'skip_to_verdict';
    inject: string;
}

export const debatePreStep = (gate?: DebatePreStepInput | null): DebatePreStepDecision => {
    if (gate?.skillVeto) {
        return {
            action: 'skip_to_verdict',
            inject: `**PRE-STEP SKILL VETO:** ${gate.skillVeto} Skip remaining rebuttals. Verdict must stay Avoid/Neutral unless the skill is retired.`,
        };
    }
    const result = gate?.gateResult;
    if (result === 'HALT') {
        return {
            action: 'skip_to_verdict',
            inject: `**PRE-STEP HALT:** ${gate?.reason || 'Pattern memory halted new risk.'} Skip remaining rebuttals. Verdict must stay Avoid/Neutral unless fresh evidence overturns the gate.`,
        };
    }
    if (result === 'REDUCE_SIZE') {
        return {
            action: 'continue',
            inject: `**PRE-STEP REDUCE_SIZE:** ${gate?.reason || 'Historical losses on this setup.'} Cap conviction at Low / half size.`,
        };
    }
    if (result === 'WARNING') {
        return {
            action: 'continue',
            inject: `**PRE-STEP WARNING:** ${gate?.reason || 'Matching historical failures.'} Address the gate questions before adding size.`,
        };
    }
    return { action: 'continue', inject: '' };
};
