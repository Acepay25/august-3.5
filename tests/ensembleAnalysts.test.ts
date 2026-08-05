import { describe, it, expect } from 'vitest';
import type { ProviderConfig } from '../types/provider';
import { AnalystLensConfig, AnalystRole } from '../types';
import { buildEnsembleAnalysts, buildAnalystFailureReport } from '../services/ui/EnsembleAnalystService';
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
      '• Qwen · qwen-max — Received an empty response from the AI.\n' +
      '• Groq · llama-3.3 — 404 model not found',
    );
  });

  it('returns an empty string when every analyst succeeded', () => {
    expect(buildAnalystFailureReport([{ status: 'fulfilled', value: {} }], [{ name: 'A', model: 'm' }])).toBe('');
  });
});
