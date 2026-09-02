/**
 * Bot attention classes (plan botmode-scan G3) — Hermes's
 * BOT_ATTENTION_HINTS pattern: when a bot cannot do its job, the roster
 * row says WHY with a one-line fix hint, instead of the user discovering
 * it through a silent failure. Pure classification over data the app
 * already keeps (ProviderConfig + ProviderHealthService telemetry).
 */

import type { AgentBot } from './agentRoster';
import type { ProviderConfig } from '../../types/provider';
import { getProviderHealth, isProviderOnCooldown } from '../infrastructure/ProviderHealthService';

export type AttentionClass = 'no_provider' | 'model_missing' | 'no_key' | 'disabled' | 'auth' | 'quota' | 'benched';

export interface BotAttention {
    cls: AttentionClass;
    /** One-line fix hint (tooltip). */
    hint: string;
}

const lastErrorText = (providerId: string): string =>
    getProviderHealth(providerId)?.lastError?.toLowerCase() ?? '';

/**
 * Classify what a bot needs attention for, or null when it is ready.
 * Order matters: config problems (fixable now) outrank transient ones
 * (auth/quota/bench), which are inferred from the health telemetry.
 */
export const classifyBotAttention = (
    bot: AgentBot,
    configs: ProviderConfig[],
): BotAttention | null => {
    const provider = configs.find(c => c.id === bot.providerId);
    if (!provider) {
        return { cls: 'no_provider', hint: `${bot.name} points at provider "${bot.providerId}" which no longer exists — edit the bot.` };
    }
    if (!provider.models.includes(bot.modelId)) {
        return { cls: 'model_missing', hint: `${bot.name}: ${provider.name} no longer lists ${bot.modelId} — pick another model for ${bot.name}.` };
    }
    if (!provider.apiKey.trim()) {
        return { cls: 'no_key', hint: `${bot.name}: ${provider.name} has no API key — add one in Settings → Providers.` };
    }
    if (!provider.isEnabled) {
        return { cls: 'disabled', hint: `${bot.name}: ${provider.name} is disabled — enable it in Settings → Providers.` };
    }
    // Transient, from telemetry: the last persisted error's shape.
    const err = lastErrorText(provider.id);
    if (err.includes('401') || err.includes('403') || err.includes('invalid api key') || err.includes('unauthorized')) {
        return { cls: 'auth', hint: `${bot.name}: ${provider.name} rejected the key (auth) — check/rotate it in Settings → Providers.` };
    }
    if (err.includes('429') || err.includes('quota') || err.includes('rate limit')) {
        return { cls: 'quota', hint: `${bot.name}: ${provider.name} is rate-limited or out of quota — wait or raise the limit.` };
    }
    if (isProviderOnCooldown(provider.id)) {
        return { cls: 'benched', hint: `${bot.name}: ${provider.name} is benched after repeated errors — it recovers automatically in a few minutes.` };
    }
    return null;
};
