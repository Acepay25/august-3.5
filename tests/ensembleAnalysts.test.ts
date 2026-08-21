import { describe, it, expect } from 'vitest';
import type { ProviderConfig } from '../types/provider';
import { AnalystLensConfig, AnalystRole } from '../types';
import { buildEnsembleAnalysts, buildAnalystFailureReport, findDuplicateAnalystOutputs } from '../services/ui/EnsembleAnalystService';
import type { EnsembleModelSelection } from '../services/ui/AnalystLensService';

const makeProvider = (id: string, models: string[], selectedModel: string, overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id,
  name: id,
  apiKey: 'key',
  baseUrl: 'https://api.example.com/v1',
  apiFormat: 'chat_completions',
  isEnabled: true,
  isBuiltIn: true,
  models,
  selectedModel,
  ...overrides,
});

const lens = (assignments: AnalystLensConfig['assignments'], enabled = true): AnalystLensConfig => ({
  enabled,
  assignments,
  tradingStyle: 'swing',
});

const assign = (role: AnalystRole, assignedProvider: string | null, assignedModel?: string) => ({
  role,
  assignedProvider,
  assignedModel,
});

describe('buildEnsembleAnalysts', () => {
  it('builds exactly three analysts from complete, valid lens assignments', () => {
    const providers = [makeProvider('prov-a', ['m1', 'm2'], 'm1'), makeProvider('prov-b', ['n1'], 'n1')];
    const plan = buildEnsembleAnalysts(
      providers,
      lens([
        assign(AnalystRole.MACRO_VOLATILITY, 'prov-a', 'm1'),
        assign(AnalystRole.TECHNICAL_ANALYST, 'prov-a', 'm2'),
        assign(AnalystRole.RISK_EXECUTION, 'prov-b', 'n1'),
      ]),
      undefined,
      true,
    );
    expect(plan.hasCompleteAnalystAssignments).toBe(true);
    expect(plan.missingAnalystRoles).toEqual([]);
    expect(plan.analysts).toHaveLength(3);
    expect(plan.analysts.map(a => a.model)).toEqual(['m1', 'm2', 'n1']);
    expect(plan.analysts.map(a => a.thoughtsKey)).toEqual(['prov-a:m1', 'prov-a:m2', 'prov-b:n1']);
    // Role names surface instead of raw provider names.
    expect(plan.analysts[0].name).toBe('Macro & Volatility Analyst');
  });

  it('salvages a stale assigned model by falling back to the provider selected model', () => {
    // 'mX' was removed from prov-a's model list after the assignment was saved.
    const providers = [makeProvider('prov-a', ['m1', 'm2', 'm3'], 'm3')];
    const plan = buildEnsembleAnalysts(
      providers,
      lens([
        assign(AnalystRole.MACRO_VOLATILITY, 'prov-a', 'm1'),
        assign(AnalystRole.TECHNICAL_ANALYST, 'prov-a', 'm2'),
        assign(AnalystRole.RISK_EXECUTION, 'prov-a', 'mX'),
      ]),
      undefined,
      true,
    );
    expect(plan.hasCompleteAnalystAssignments).toBe(true);
    expect(plan.analysts.map(a => a.model)).toEqual(['m1', 'm2', 'm3']);
  });

  it('marks a role missing when its assigned provider no longer exists', () => {
    const providers = [makeProvider('prov-a', ['m1'], 'm1')];
    const plan = buildEnsembleAnalysts(
      providers,
      lens([
        assign(AnalystRole.MACRO_VOLATILITY, 'prov-a', 'm1'),
        assign(AnalystRole.TECHNICAL_ANALYST, 'ghost-provider', 'x'), // provider deleted
        assign(AnalystRole.RISK_EXECUTION, 'prov-a', 'm1'),           // duplicate identity
      ]),
      undefined,
      true,
    );
    expect(plan.missingAnalystRoles).toEqual([AnalystRole.TECHNICAL_ANALYST]);
    expect(plan.hasCompleteAnalystAssignments).toBe(false);
  });

  it('prefers the Debate Models picker when lenses are off', () => {
    const providers = [makeProvider('prov-a', ['m1', 'm2', 'm3'], 'm1', { ensembleModels: ['m1', 'm2'] })];
    const selection: EnsembleModelSelection = [{ providerId: 'prov-a', model: 'm3' }, { providerId: 'prov-a', model: 'm2' }];
    const plan = buildEnsembleAnalysts(providers, lens([], false), selection, true);
    expect(plan.analysts.map(a => a.model)).toEqual(['m3', 'm2']);
    expect(plan.analysts.map(a => a.name)).toEqual(['prov-a · M3', 'prov-a · M2']);
  });

  it('uses Normal dropdown slots in order instead of the first provider ensembleModels', () => {
    const providers = [
      makeProvider('prov-a', ['old1', 'old2', 'old3'], 'old1', { ensembleModels: ['old1', 'old2', 'old3'] }),
      makeProvider('prov-b', ['new1', 'new2'], 'new1'),
    ];
    const selection: EnsembleModelSelection = [
      { providerId: 'prov-b', model: 'new1' },
      { providerId: 'prov-b', model: 'new2' },
      { providerId: 'prov-a', model: 'old2' },
    ];
    const plan = buildEnsembleAnalysts(providers, lens([], false), selection, true);
    expect(plan.analysts.map(a => `${a.config.id}:${a.model}`)).toEqual([
      'prov-b:new1',
      'prov-b:new2',
      'prov-a:old2',
    ]);
  });

  it('keeps a Normal dropdown model even if it is not in the cached catalog yet', () => {
    const providers = [makeProvider('prov-a', ['m1'], 'm1', { ensembleModels: ['m1'] })];
    const plan = buildEnsembleAnalysts(
      providers,
      lens([], false),
      [{ providerId: 'prov-a', model: 'fresh-from-dropdown' }],
      true,
    );
    expect(plan.analysts.map(a => a.model)).toEqual(['fresh-from-dropdown']);
  });

  it('caps the analyst list at three entries', () => {
    const providers = [makeProvider('prov-a', ['m1', 'm2', 'm3', 'm4'], 'm1', { ensembleModels: ['m1', 'm2', 'm3', 'm4'] })];
    const plan = buildEnsembleAnalysts(providers, lens([], false), undefined, true);
    expect(plan.analysts).toHaveLength(3);
  });

  it('builds one analyst per provider when ensemble mode is off', () => {
    const providers = [makeProvider('prov-a', ['m1'], 'm1'), makeProvider('prov-b', ['n1'], 'n1')];
    const plan = buildEnsembleAnalysts(providers, lens([], false), undefined, false);
    expect(plan.analysts.map(a => a.model)).toEqual(['m1', 'n1']);
  });

  it('skips providers that are disabled or keyless', () => {
    const providers = [
      makeProvider('prov-a', ['m1'], 'm1'),
      makeProvider('prov-b', ['n1'], 'n1', { isEnabled: false }),
      makeProvider('prov-c', ['p1'], 'p1', { apiKey: '' }),
    ];
    const plan = buildEnsembleAnalysts(providers, lens([], false), undefined, false);
    expect(plan.analysts.map(a => a.config.id)).toEqual(['prov-a']);
  });
});

describe('buildAnalystFailureReport', () => {
  const settled = (): PromiseSettledResult<unknown>[] => [
    { status: 'fulfilled', value: {} },
    { status: 'rejected', reason: new Error('Received an empty response from the AI.') },
    { status: 'rejected', reason: '404 model not found' },
  ];

  it('names each failed analyst with its exact reason, aligned by original index', () => {
    const report = buildAnalystFailureReport(settled(), [
      { name: 'DeepSeek', model: 'deepseek-chat' },
      { name: 'Qwen', model: 'qwen-max' },
      { name: 'Groq', model: 'llama-3.3' },
    ]);
    expect(report).toBe(
      '• Qwen · Qwen Max — Received an empty response from the AI.\n' +
      '• Groq · Llama 3.3 — 404 model not found',
    );
  });

  it('returns an empty string when every analyst succeeded', () => {
    expect(buildAnalystFailureReport([{ status: 'fulfilled', value: {} }], [{ name: 'A', model: 'm' }])).toBe('');
  });

  it('gives duplicate provider:model Team slots unique lanes and names', () => {
    const providers = [makeProvider('prov-a', ['m1'], 'm1')];
    const selection: EnsembleModelSelection = [
      { providerId: 'prov-a', model: 'm1' },
      { providerId: 'prov-a', model: 'm1' },
      { providerId: 'prov-a', model: 'm1' },
    ];
    const plan = buildEnsembleAnalysts(providers, lens([], false), selection, true);
    expect(plan.analysts).toHaveLength(3);
    // Each seat gets its own reasoning lane — without the suffix the three
    // seats would share one merged chain-of-thought bucket and every bubble
    // would show the same thinking.
    expect(plan.analysts.map(a => a.thoughtsKey)).toEqual(['prov-a:m1', 'prov-a:m1#1', 'prov-a:m1#2']);
    // Distinct names so the transcript turns never collapse into one seat.
    expect(plan.analysts.map(a => a.name)).toEqual(['prov-a · M1', 'prov-a · M1 #2', 'prov-a · M1 #3']);
  });
});

describe('findDuplicateAnalystOutputs', () => {
  const longText = (seed: string): string =>
    `${seed} `.repeat(60).trim(); // ~300 chars, above the 200-char judging floor

  it('flags byte-identical outputs across different models as duplicates', () => {
    const echo = longText('The user wants me to analyze BTCUSDT as an independent analyst seat three.');
    const pairs = findDuplicateAnalystOutputs([
      { name: 'Kilocode', model: 'step-3.7-flash:free', thoughtProcess: echo },
      { name: 'Kilocode', model: 'hy3:free', thoughtProcess: echo },
      { name: 'Kilocode', model: 'nemotron:free', thoughtProcess: longText('A completely different read: price is ranging below value, sellers hold 73k.') },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toContain('Step 3.7 Flash Free');
    expect(pairs[0]).toContain('Hy3 Free');
    expect(pairs[0]).toContain('identical');
  });

  it('falls back to the chain-of-thought when a seat only returned a scratchpad', () => {
    const cot = longText('Stress-testing the trade: invalidation sits above the recent high.');
    const pairs = findDuplicateAnalystOutputs([
      { name: 'A', model: 'model-a', finalOutput: '', thoughtProcess: cot },
      { name: 'B', model: 'model-b', finalOutput: '', thoughtProcess: `  ${cot.toUpperCase()}  ` },
    ]);
    expect(pairs).toHaveLength(1);
  });

  it('ignores short outputs that legitimately match (e.g. both seats say Avoid)', () => {
    const pairs = findDuplicateAnalystOutputs([
      { name: 'A', model: 'model-a', finalOutput: 'Avoid.' },
      { name: 'B', model: 'model-b', finalOutput: 'Avoid.' },
    ]);
    expect(pairs).toEqual([]);
  });

  it('passes genuinely independent analyses through clean', () => {
    const pairs = findDuplicateAnalystOutputs([
      { name: 'A', model: 'model-a', finalOutput: longText('Long bias: reclaim of the daily pivot opens 74k into Friday.') },
      { name: 'B', model: 'model-b', finalOutput: longText('Short bias into resistance: funding skews long, 72.9 rejects.') },
    ]);
    expect(pairs).toEqual([]);
  });
});
