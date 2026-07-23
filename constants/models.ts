
import { AIProvider } from '../types';
import {
   DUAL_SCENARIO_JSON_SCHEMA,
   MASTER_TRADE_PLAN_JSON_SCHEMA,
   PURE_AI_TRADE_PLAN_JSON_SCHEMA,
   GATE_SCAN_JSON_SCHEMA
} from './schemas';

interface AIModel {
   id: string;
   name: string;
   provider: AIProvider;
}

export const ALL_SUPPORTED_MODELS: AIModel[] = [
   { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview', provider: AIProvider.GEMINI },
   { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', provider: AIProvider.GEMINI },
   { id: 'gemini-3-flash', name: 'Gemini 3 Flash', provider: AIProvider.GEMINI },
   { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: AIProvider.GEMINI },
   { id: 'gemini-2.0-pro', name: 'Gemini 2.0 Pro', provider: AIProvider.GEMINI },
   { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: AIProvider.GEMINI },
   { id: 'gemini-2.0-flash-lite-preview-02-05', name: 'Gemini 2.0 Flash Lite', provider: AIProvider.GEMINI },
   { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: AIProvider.GEMINI },
   { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', provider: AIProvider.GEMINI },
   { id: 'gemini-flash-latest', name: 'Gemini Flash Latest', provider: AIProvider.GEMINI },
   { id: 'gemini-flash-lite-latest', name: 'Gemini Flash Lite', provider: AIProvider.GEMINI },
   { id: 'gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image', provider: AIProvider.GEMINI },
   // DeepSeek Models
   { id: 'deepseek-chat', name: 'DeepSeek Chat (V3.2)', provider: AIProvider.DEEPSEEK },
   { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner (Thinking)', provider: AIProvider.DEEPSEEK },
   // Zhipu Models (GLM)
   { id: 'glm-4.6v-flash', name: 'GLM-4.6V-Flash (Vision/Free)', provider: AIProvider.ZHIPU },
   { id: 'glm-4.5-flash', name: 'GLM-4.5-Flash (Optimized)', provider: AIProvider.ZHIPU },
   { id: 'glm-4.6', name: 'GLM-4.6', provider: AIProvider.ZHIPU },
   { id: 'glm-4.5', name: 'GLM-4.5', provider: AIProvider.ZHIPU },
   { id: 'glm-4-32b-0414-128k', name: 'GLM-4-32B-0414-128K', provider: AIProvider.ZHIPU },
   { id: 'glm-4.5v', name: 'GLM-4.5V (Vision)', provider: AIProvider.ZHIPU },
   // Groq Models
   { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B', provider: AIProvider.GROQ },
   { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick 17B', provider: AIProvider.GROQ },
   { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', provider: AIProvider.GROQ },
   { id: 'allam-2-7b', name: 'Allam-2 7B', provider: AIProvider.GROQ },
   { id: 'groq/compound', name: 'Groq Compound', provider: AIProvider.GROQ },
   { id: 'groq/compound-mini', name: 'Groq Compound Mini', provider: AIProvider.GROQ },
   { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: AIProvider.GROQ },
   { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', provider: AIProvider.GROQ },
   { id: 'openai/gpt-oss-safeguard-20b', name: 'GPT-OSS Safeguard 20B', provider: AIProvider.GROQ },
   { id: 'qwen/qwen3-32b', name: 'Qwen3 32B', provider: AIProvider.GROQ },
   { id: 'moonshotai/kimi-k2-instruct', name: 'Kimi K2 Instruct', provider: AIProvider.GROQ },
   { id: 'moonshotai/kimi-k2-instruct-0905', name: 'Kimi K2 Instruct 0905', provider: AIProvider.GROQ },
   // Groq (Alt) Models - Duplicate of Groq
   { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B (Alt)', provider: AIProvider.GROQ_NEW },
   { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick 17B (Alt)', provider: AIProvider.GROQ_NEW },
   { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Alt)', provider: AIProvider.GROQ_NEW },
   { id: 'allam-2-7b', name: 'Allam-2 7B (Alt)', provider: AIProvider.GROQ_NEW },
   { id: 'groq/compound', name: 'Groq Compound (Alt)', provider: AIProvider.GROQ_NEW },
   { id: 'groq/compound-mini', name: 'Groq Compound Mini (Alt)', provider: AIProvider.GROQ_NEW },
   { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B (Alt)', provider: AIProvider.GROQ_NEW },
   { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B (Alt)', provider: AIProvider.GROQ_NEW },
   { id: 'openai/gpt-oss-safeguard-20b', name: 'GPT-OSS Safeguard 20B (Alt)', provider: AIProvider.GROQ_NEW },
   { id: 'qwen/qwen3-32b', name: 'Qwen3 32B (Alt)', provider: AIProvider.GROQ_NEW },
   { id: 'moonshotai/kimi-k2-instruct', name: 'Kimi K2 Instruct (Alt)', provider: AIProvider.GROQ_NEW },
   { id: 'moonshotai/kimi-k2-instruct-0905', name: 'Kimi K2 Instruct 0905 (Alt)', provider: AIProvider.GROQ_NEW },
   // Groq (Alt 2) Models - Third Groq API key
   { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B (Alt 2)', provider: AIProvider.GROQ_ALT2 },
   { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick 17B (Alt 2)', provider: AIProvider.GROQ_ALT2 },
   { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Alt 2)', provider: AIProvider.GROQ_ALT2 },
   { id: 'allam-2-7b', name: 'Allam-2 7B (Alt 2)', provider: AIProvider.GROQ_ALT2 },
   { id: 'groq/compound', name: 'Groq Compound (Alt 2)', provider: AIProvider.GROQ_ALT2 },
   { id: 'groq/compound-mini', name: 'Groq Compound Mini (Alt 2)', provider: AIProvider.GROQ_ALT2 },
   { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B (Alt 2)', provider: AIProvider.GROQ_ALT2 },
   { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B (Alt 2)', provider: AIProvider.GROQ_ALT2 },
   { id: 'openai/gpt-oss-safeguard-20b', name: 'GPT-OSS Safeguard 20B (Alt 2)', provider: AIProvider.GROQ_ALT2 },
   { id: 'qwen/qwen3-32b', name: 'Qwen3 32B (Alt 2)', provider: AIProvider.GROQ_ALT2 },
   { id: 'moonshotai/kimi-k2-instruct', name: 'Kimi K2 Instruct (Alt 2)', provider: AIProvider.GROQ_ALT2 },
   { id: 'moonshotai/kimi-k2-instruct-0905', name: 'Kimi K2 Instruct 0905 (Alt 2)', provider: AIProvider.GROQ_ALT2 },

   // OpenRouter Models (Free)
   { id: 'allenai/olmo-3-32b-think:free', name: 'OLMo 3 32B Think (Free)', provider: AIProvider.OPENROUTER },
   { id: 'arcee-ai/trinity-mini:free', name: 'Arcee Trinity Mini (Free)', provider: AIProvider.OPENROUTER },
   { id: 'openai/gpt-oss-120b:free', name: 'GPT-OSS 120B (Free)', provider: AIProvider.OPENROUTER },
   { id: 'openai/gpt-oss-20b:free', name: 'GPT-OSS 20B (Free)', provider: AIProvider.OPENROUTER },
   { id: 'z-ai/glm-4.5-air:free', name: 'GLM 4.5 Air (Free)', provider: AIProvider.OPENROUTER },
   { id: 'qwen/qwen3-coder:free', name: 'Qwen3 Coder (Free)', provider: AIProvider.OPENROUTER },
   { id: 'moonshotai/kimi-k2:free', name: 'Kimi K2 (Free)', provider: AIProvider.OPENROUTER },
   { id: 'tngtech/deepseek-r1t2-chimera:free', name: 'DeepSeek R1T2 Chimera (Free)', provider: AIProvider.OPENROUTER },
   { id: 'qwen/qwen3-235b-a22b:free', name: 'Qwen3 235B A22B (Free)', provider: AIProvider.OPENROUTER },
   { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash Exp (Free)', provider: AIProvider.OPENROUTER },
   { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B Instruct (Free)', provider: AIProvider.OPENROUTER },
   { id: 'nousresearch/hermes-3-llama-3.1-405b:free', name: 'Hermes 3 Llama 405B (Free)', provider: AIProvider.OPENROUTER },
   { id: 'mistralai/mistral-7b-instruct:free', name: 'Mistral 7B Instruct (Free)', provider: AIProvider.OPENROUTER },
   { id: 'tngtech/deepseek-r1t-chimera:free', name: 'DeepSeek R1T Chimera (Free)', provider: AIProvider.OPENROUTER },
   { id: 'alibaba/tongyi-deepresearch-30b-a3b:free', name: 'Tongyi DeepResearch 30B (Free)', provider: AIProvider.OPENROUTER },
   { id: 'meituan/longcat-flash-chat:free', name: 'Longcat Flash Chat (Free)', provider: AIProvider.OPENROUTER },

   // OpenAI Models (Native API)
   { id: 'gpt-5-nano', name: 'GPT-5 Nano', provider: AIProvider.OPENAI },
   { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', provider: AIProvider.OPENAI },

   // Grok Models (xAI Native API)
   { id: 'grok-3', name: 'Grok 3', provider: AIProvider.GROK },
   { id: 'grok-3-mini', name: 'Grok 3 Mini', provider: AIProvider.GROK },
   { id: 'grok-3-fast', name: 'Grok 3 Fast', provider: AIProvider.GROK },
   { id: 'grok-4-1-fast-reasoning', name: 'Grok 4.1 Fast Reasoning', provider: AIProvider.GROK },
   { id: 'grok-4-1-fast-non-reasoning', name: 'Grok 4.1 Fast Non-Reasoning', provider: AIProvider.GROK },

];

export const GEMINI_MODELS = ALL_SUPPORTED_MODELS.filter(m => m.provider === AIProvider.GEMINI);
export const DEEPSEEK_MODELS = ALL_SUPPORTED_MODELS.filter(m => m.provider === AIProvider.DEEPSEEK);
export const ZHIPU_MODELS = ALL_SUPPORTED_MODELS.filter(m => m.provider === AIProvider.ZHIPU);
export const GROQ_MODELS = ALL_SUPPORTED_MODELS.filter(m => m.provider === AIProvider.GROQ);
export const GROQ_NEW_MODELS = ALL_SUPPORTED_MODELS.filter(m => m.provider === AIProvider.GROQ_NEW);
export const GROQ_ALT2_MODELS = ALL_SUPPORTED_MODELS.filter(m => m.provider === AIProvider.GROQ_ALT2);
export const OPENROUTER_MODELS = ALL_SUPPORTED_MODELS.filter(m => m.provider === AIProvider.OPENROUTER);
export const OPENAI_MODELS = ALL_SUPPORTED_MODELS.filter(m => m.provider === AIProvider.OPENAI);
export const GROK_MODELS = ALL_SUPPORTED_MODELS.filter(m => m.provider === AIProvider.GROK);

export const OCR_MODELS = [
   // Gemini Vision Models
   { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview', provider: AIProvider.GEMINI },
   { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', provider: AIProvider.GEMINI },
   { id: 'gemini-3-flash', name: 'Gemini 3 Flash', provider: AIProvider.GEMINI },
   { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: AIProvider.GEMINI },
   { id: 'gemini-2.0-pro', name: 'Gemini 2.0 Pro', provider: AIProvider.GEMINI },
   { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: AIProvider.GEMINI },
   { id: 'gemini-2.0-flash-lite-preview-02-05', name: 'Gemini 2.0 Flash Lite', provider: AIProvider.GEMINI },
   { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash Exp', provider: AIProvider.GEMINI },
   { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: AIProvider.GEMINI },
   { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', provider: AIProvider.GEMINI },
   { id: 'gemini-flash-latest', name: 'Gemini Flash Latest', provider: AIProvider.GEMINI },
   { id: 'gemini-flash-lite-latest', name: 'Gemini Flash Lite', provider: AIProvider.GEMINI },
   { id: 'gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image', provider: AIProvider.GEMINI },
   // Zhipu Vision Models
   { id: 'glm-4.6v-flash', name: 'GLM-4.6V-Flash (Vision/Free)', provider: AIProvider.ZHIPU },
   { id: 'glm-4.5v', name: 'GLM-4.5V (Vision)', provider: AIProvider.ZHIPU },
   // Groq Vision Models (Llama 4)
   { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B (Vision)', provider: AIProvider.GROQ },
   { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick 17B (Vision)', provider: AIProvider.GROQ },
];

export const modelIdToName: Record<string, string> = ALL_SUPPORTED_MODELS.reduce((acc, model) => {
   // First-wins: avoid duplicate model IDs across Groq variants overwriting the primary name
   if (!acc[model.id]) {
      acc[model.id] = model.name;
   }
   return acc;
}, {} as Record<string, string>);

export const ocrModelIdToName: Record<string, string> = OCR_MODELS.reduce((acc, model) => {
   acc[model.id] = model.name;
   return acc;
}, {} as Record<string, string>);

// --- ACCURACY MODE DEFAULT MODELS (Not Locked) ---
export const ACCURACY_MODE_DEFAULTS = {
   GEMINI: 'gemini-2.5-flash',
   DEEPSEEK: 'deepseek-reasoner',
   GROQ: 'moonshotai/kimi-k2-instruct',
   ZHIPU: 'glm-4.5-flash',
   MODERATOR_PROVIDER: AIProvider.GROQ,
   MODERATOR_MODEL: 'moonshotai/kimi-k2-instruct-0905',
   VISION: 'gemini-2.5-flash',
   SUMMARIZATION: 'openai/gpt-oss-120b'
};

export const DEFAULT_FRAMEWORKS = [
   'Gap Trading',
   'Momentum Trading',
   'Reversal Trading',
   'Range Trading',
   'Positional Trading',
   'Mean Reversion Trading',
];

export const FAMILY_UI_DATA = [
   {
      id: 'family-a',
      name: 'Family A',
      tag: 'Reversal Trap',
      color: 'red',
      nickname: 'Exhaustion / Failure Family',
      personality: 'Market is losing strength, likely to reverse, or produce sudden trap moves.',
      features: [
         'RSI overstretched then collapsing',
         'MACD momentum sharply fading',
         'EMA stack flattening',
         'Big wick rejection candles',
         'Volume spike followed by immediate retrace',
         'Liquidity grab before reversal'
      ],
      tendency: 'Low win rate for continuation setups. Higher probability of reversal or SL hunt.',
      examples: 'Fake breakout, SFP, V-Top'
   },
   {
      id: 'family-b',
      name: 'Family B',
      tag: 'Trend Shift',
      color: 'emerald',
      nickname: 'Directional Flip Family',
      personality: 'Market is preparing to flip bias from uptrend to downtrend or vice versa.',
      features: [
         'RSI crossing 50 decisively',
         'MACD cross + multi-bar confirmation',
         'EMA 13/20/50 flipping alignment',
         'SAR flip with follow-through',
         'Break of structure (BOS) + retest'
      ],
      tendency: 'Strong moves, but must confirm structure shift. Win rate improves with high-volume confirmation.',
      examples: 'Trend reversal, early cycle start'
   },
   {
      id: 'family-c',
      name: 'Family C',
      tag: 'Continuation',
      color: 'blue',
      nickname: 'Omega Continuation Family',
      personality: 'Market already trending and simply continuing the move. This is the family where you get your highest probability trades.',
      features: [
         'Strong EMA alignment (5 > 13 > 20 > 50 for uptrend)',
         'RSI between 55–70 (healthy)',
         'MACD green histogram rising',
         'Compression breakout → retest → follow-through',
         'Micro pullbacks respecting EMAs'
      ],
      tendency: 'Highest win rate (~86%). Source of most profitable trades.',
      examples: 'ETH Long #2, LINK Long, GRASS Long'
   },
   {
      id: 'family-omega',
      name: 'Family Omega',
      tag: 'High-Vol Expansion',
      color: 'purple',
      nickname: 'Momentum Burst Family',
      personality: 'Trend becomes extremely strong and accelerates violently.',
      features: [
         'RSI 65–88 (no reversal signs)',
         'MACD vertical expansion',
         'EMAs extremely spread out',
         'Parabolic SAR with wide gaps',
         'Volume continuously rising',
         'Each pullback is shallow and bought aggressively'
      ],
      tendency: 'Very high continuation probability. Requires wider SL. Failures lead to violent reversals.',
      examples: 'ETH extreme volatility runs, BTC post-crash retest'
   }
];

/**
 * Human-readable labels for each role (used in UI and debate transcript)
 */
export const ENSEMBLE_ROLE_LABELS: Record<string, string> = {
   technical_structure: '📊 Technical Structure',
   market_context: '🌐 Market Context',
   risk_management: '⚠️ Risk Management'
};

/**
 * Maps roles to specific rules that should be injected.
 * Only role-relevant rules are injected to avoid information overload.
 */
export const ROLE_RULE_INJECTION: Record<string, string[]> = {
   technical_structure: [],
   market_context: ['REGIME_TRADING_RULES', 'STRESS_TEST_PROTOCOL', 'DEVILS_ADVOCATE_PROMPT'],
   risk_management: ['RISK_MANAGEMENT_RULES', 'STRESS_TEST_PROTOCOL', 'DEVILS_ADVOCATE_PROMPT']
};
