import { describe, it, expect, vi, beforeEach } from 'vitest';

// Reasoning-control plane (Batch 1 P1): route translation, effort maps,
// fail-closed doctrine, and the P7 pin consult.

import {
    EFFORT_BY_TASK,
    effortForTask,
    detectWireCapabilities,
    buildReasoningPatch,
    applyReasoningToChatParams,
    registerWireRoutePins,
    ReasoningEffort,
} from '../services/providers/reasoningControls';
import type { ProviderConfig } from '../types/provider';

const makeConfig = (overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({
    id: 'prov-x',
    name: 'Provider X',
    apiKey: 'k',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat_completions',
    isEnabled: true,
    isBuiltIn: false,
    models: ['m'],
    selectedModel: 'm',
    ...overrides,
});

describe('EFFORT_BY_TASK schedule (P2)', () => {
    it('maps each debate task to its tier', () => {
        expect(EFFORT_BY_TASK.analysis).toBe('high');
        expect(EFFORT_BY_TASK.rebuttal).toBe('high');
        expect(EFFORT_BY_TASK.moderatorVerdict).toBe('max');
        expect(EFFORT_BY_TASK.clarification).toBe('low');
        expect(EFFORT_BY_TASK.chat).toBe('low');
        expect(EFFORT_BY_TASK.postMortem).toBe('medium');
        expect(EFFORT_BY_TASK.ocr).toBe('low');
    });

    it('passes unknown tasks through as auto (no knob)', () => {
        expect(effortForTask('unknown-task')).toBe('auto');
        expect(effortForTask(undefined)).toBe('auto');
        expect(effortForTask('analysis')).toBe('high');
    });
});

describe('detectWireCapabilities (capability classes, not provider identity)', () => {
    it('flags the xAI effort route from host or model evidence', () => {
        const caps = detectWireCapabilities(makeConfig({ baseUrl: 'https://api.x.ai/v1' }));
        expect(caps.xaiEffort).toBe(true);
    });

    it('excludes grok-*-fast models from the xAI effort route (fail closed)', () => {
        const caps = detectWireCapabilities(makeConfig({
            baseUrl: 'https://api.x.ai/v1',
            selectedModel: 'grok-4-fast',
        }));
        expect(caps.xaiEffort).toBe(false);
    });

    it('flags GLM thinking from z-ai host or glm model evidence', () => {
        expect(detectWireCapabilities(makeConfig({ baseUrl: 'https://api.z-ai.com/v1' })).glmThinking).toBe(true);
        expect(detectWireCapabilities(makeConfig({ selectedModel: 'glm-4.6' })).glmThinking).toBe(true);
    });

    it('flags DeepSeek thinking', () => {
        expect(detectWireCapabilities(makeConfig({ selectedModel: 'deepseek-chat' })).deepseekThinking).toBe(true);
    });

    it('flags anthropic thinking only for the messages wire format', () => {
        expect(detectWireCapabilities(makeConfig({ apiFormat: 'messages' })).anthropicThinking).toBe(true);
        expect(detectWireCapabilities(makeConfig({ apiFormat: 'chat_completions' })).anthropicThinking).toBe(false);
    });

    it('flags responses effort only for the responses wire format', () => {
        expect(detectWireCapabilities(makeConfig({ apiFormat: 'responses' })).responsesEffort).toBe(true);
    });

    it('an unverified chat_completions shape gets NO capability (fail closed)', () => {
        const caps = detectWireCapabilities(makeConfig({ baseUrl: 'https://api.example.com/v1', selectedModel: 'm' }));
        expect(caps.xaiEffort).toBe(false);
        expect(caps.glmThinking).toBe(false);
        expect(caps.deepseekThinking).toBe(false);
        expect(caps.anthropicThinking).toBe(false);
        expect(caps.responsesEffort).toBe(false);
    });
});

describe('buildReasoningPatch translation', () => {
    it('xAI: high → reasoning_effort=high; max → xhigh', () => {
        const cfg = makeConfig({ baseUrl: 'https://api.x.ai/v1' });
        expect(buildReasoningPatch(cfg, 'high').patch).toEqual({ reasoning_effort: 'high' });
        expect(buildReasoningPatch(cfg, 'max').patch).toEqual({ reasoning_effort: 'xhigh' });
    });

    it('xAI: effort=auto sends no knob', () => {
        const result = buildReasoningPatch(makeConfig({ baseUrl: 'https://api.x.ai/v1' }), 'auto');
        expect(result.patch).toEqual({});
        expect(result.audit.applied).toBe(false);
    });

    it('GLM: high enables thinking with thinking_effort; low DISABLES thinking', () => {
        const cfg = makeConfig({ baseUrl: 'https://api.z-ai.com/v1' });
        expect(buildReasoningPatch(cfg, 'high').patch).toEqual({ thinking: { type: 'enabled' }, thinking_effort: 'high' });
        expect(buildReasoningPatch(cfg, 'low').patch).toEqual({ thinking: { type: 'disabled' } });
    });

    it('GLM: max is a literal effort value (docs are not a typo)', () => {
        const result = buildReasoningPatch(makeConfig({ selectedModel: 'glm-4.6' }), 'max');
        expect(result.patch).toEqual({ thinking: { type: 'enabled' }, thinking_effort: 'max' });
    });

    it('DeepSeek: max clamps to high on the 3-level scale', () => {
        const result = buildReasoningPatch(makeConfig({ selectedModel: 'deepseek-reasoner' }), 'max');
        expect(result.patch).toEqual({ thinking: { type: 'enabled' }, reasoning_effort: 'high' });
    });

    it('responses: max clamps to high', () => {
        const result = buildReasoningPatch(makeConfig({ apiFormat: 'responses' }), 'max');
        expect(result.patch).toEqual({ reasoning: { effort: 'high' } });
    });

    it('anthropic messages: no body patch (shim owns budget_tokens) but audit reports intent', () => {
        const result = buildReasoningPatch(makeConfig({ apiFormat: 'messages' }), 'max');
        expect(result.patch).toEqual({});
        expect(result.audit.route).toBe('anthropic-thinking');
        expect(result.audit.reason).toContain('shim-owned');
    });

    it('unverified shape: empty patch + fail-closed audit reason', () => {
        const result = buildReasoningPatch(makeConfig(), 'high');
        expect(result.patch).toEqual({});
        expect(result.audit.route).toBe('none');
        expect(result.audit.reason).toContain('fail closed');
    });

    it('every patch carries an audit entry (P5 labels all calls)', () => {
        for (const effort of ['low', 'medium', 'high', 'max', 'auto'] as ReasoningEffort[]) {
            const result = buildReasoningPatch(makeConfig({ selectedModel: 'glm-4.6' }), effort);
            expect(result.audit.effort).toBe(effort);
            expect(typeof result.audit.reason).toBe('string');
        }
    });
});

describe('applyReasoningToChatParams', () => {
    it('merges the patch into params and fires the audit sink', () => {
        const onWireAudit = vi.fn();
        const params: Record<string, unknown> = { temperature: 0.4 };
        const audit = applyReasoningToChatParams(
            makeConfig({ baseUrl: 'https://api.x.ai/v1' }),
            params,
            { reasoningEffort: 'high', onWireAudit },
        );
        expect(params).toEqual({ temperature: 0.4, reasoning_effort: 'high' });
        expect(audit.applied).toBe(true);
        expect(onWireAudit).toHaveBeenCalledWith(audit);
    });

    it('effort omitted → auto → no param mutation', () => {
        const params: Record<string, unknown> = { temperature: 0.4 };
        applyReasoningToChatParams(makeConfig({ baseUrl: 'https://api.x.ai/v1' }), params, {});
        expect(params).toEqual({ temperature: 0.4 });
    });
});

describe('P7 wire-route pins (harness lessons override detection)', () => {
    beforeEach(() => {
        // Reset to no-op between tests.
        registerWireRoutePins(() => false);
    });

    it('a pinned route fails closed even when detection claims the shape', () => {
        const cfg = makeConfig({ id: 'pinned-prov', baseUrl: 'https://api.x.ai/v1' });
        expect(buildReasoningPatch(cfg, 'high').patch).toEqual({ reasoning_effort: 'high' });
        registerWireRoutePins((route, providerId) => route === 'xai-effort' && providerId === 'pinned-prov');
        const result = buildReasoningPatch(cfg, 'high');
        expect(result.patch).toEqual({});
        expect(result.audit.route).toBe('none');
        expect(result.audit.reason).toContain('pinned off');
    });

    it('a pin on one provider does not bench another provider of the same class', () => {
        registerWireRoutePins((route, providerId) => route === 'xai-effort' && providerId === 'someone-else');
        const result = buildReasoningPatch(makeConfig({ baseUrl: 'https://api.x.ai/v1' }), 'high');
        expect(result.patch).toEqual({ reasoning_effort: 'high' });
    });
});
