import { AnalystRole } from './enums';

export type BotMemoryScope = 'global' | 'personal' | 'isolated';

export interface HermesBot {
    id: string;
    name: string;
    avatarUrl?: string;
    role: AnalystRole;
    providerId: string;
    model: string;
    job?: string;
    description?: string;
    systemPromptOverride?: string;
    personality?: string;
    memoryScope: BotMemoryScope;
    enabledTools: string[];
    skillFilter?: { coins?: string[]; families?: string[] };
    hidden?: boolean;
    createdAt: number;
    updatedAt: number;
}

export const BOT_TOOL_PRESETS: Record<string, string[]> = {
    macro: ['get_session_context', 'get_btc_context', 'web_search'],
    technical: ['get_price_snapshot', 'get_order_book'],
    risk: ['get_derivatives', 'get_liquidations', 'get_session_context'],
};

export const defaultToolsForRole = (role: AnalystRole): string[] => {
    if (role === AnalystRole.MACRO_VOLATILITY) return [...BOT_TOOL_PRESETS.macro];
    if (role === AnalystRole.TECHNICAL_ANALYST) return [...BOT_TOOL_PRESETS.technical];
    if (role === AnalystRole.RISK_EXECUTION) return [...BOT_TOOL_PRESETS.risk];
    return [...BOT_TOOL_PRESETS.macro];
};
