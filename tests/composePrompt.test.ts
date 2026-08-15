import { describe, it, expect } from 'vitest';
import { HARNESS_CONTRACT_PROMPT } from '../constants/prompts/harnessContract';
import { ANALYST_PERSONA_PROMPT, MASTER_ANALYSIS_PROMPT } from '../constants/prompts/analysisPrompts';
import { composePrompt, stripHarnessContract } from '../utils/composePrompt';

describe('composePrompt', () => {
  it('places the canonical harness contract first and only once', () => {
    const nested = `${HARNESS_CONTRACT_PROMPT}\n\n**JOB:** Do the work.`;
    const out = composePrompt([
      { id: 'contract', text: HARNESS_CONTRACT_PROMPT },
      { id: 'job', text: nested },
      { id: 'contract', text: HARNESS_CONTRACT_PROMPT },
    ]);
    expect(out.startsWith('**HARNESS CONTRACT')).toBe(true);
    expect(out.split('**HARNESS CONTRACT').length - 1).toBe(1);
    expect(out).toContain('**JOB:** Do the work.');
  });

  it('strips a nested contract out of persona/master templates', () => {
    expect(stripHarnessContract(ANALYST_PERSONA_PROMPT)).not.toContain('HARNESS CONTRACT');
    const composed = composePrompt([
      { id: 'contract', text: HARNESS_CONTRACT_PROMPT },
      { id: 'job', text: MASTER_ANALYSIS_PROMPT },
    ]);
    expect(composed.split('**HARNESS CONTRACT').length - 1).toBe(1);
    expect(composed).toContain('ANALYST PERSONA');
    expect(composed).toContain('HOW A PRO READS THIS CHART');
    expect(composed).not.toContain('**SECTION 1');
    expect(composed).not.toContain('TRADE PLAN BLOCK (MANDATORY');
  });

  it('skips empty layers and duplicate ids', () => {
    const out = composePrompt([
      { id: 'a', text: 'Alpha' },
      { id: 'a', text: 'Alpha again' },
      { id: 'b', text: '   ' },
      { id: 'c', text: 'Charlie' },
    ]);
    expect(out).toBe('Alpha\n\nCharlie');
  });
});
