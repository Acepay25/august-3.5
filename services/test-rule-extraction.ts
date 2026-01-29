/**
 * test-rule-extraction.ts
 * 
 * Verification script for Item 1.2: LLM-Powered Rule Extraction
 */

import { addRulesFromPostMortem, loadInvalidationRules } from './InvalidationRuleService';
import { LoggedTrade, TradeOutcome, AIProvider } from '../types';

// Mock LocalStorage
if (typeof localStorage === 'undefined' || localStorage === null) {
    (global as any).localStorage = {
        _data: {},
        setItem: function (id: string, val: string) { return this._data[id] = String(val); },
        getItem: function (id: string) { return this._data.hasOwnProperty(id) ? this._data[id] : null; },
        removeItem: function (id: string) { return delete this._data[id]; },
        clear: function () { return this._data = {}; }
    };
}

// Mock Trade Data
const mockTrade: LoggedTrade = {
    id: 'test-trade-' + Date.now(),
    timestamp: new Date().toISOString(),
    outcome: TradeOutcome.LOSS,
    analysis: {
        coinName: 'BTCUSDT',
        direction: 'Long',
        confidence: 'High',
        entryPoints: [{ price: '50000', description: 'Entry' }],
        stopLoss: '49000',
        takeProfit: [{ price: '52000', percentage: '4%' }],
        historicalCorrelation: '',
        marketConditions: {
            pattern: 'Bull Flag', prices: { '5m': '50000', '15m': '50000', '1h': '50000', '4h': '50000' },
            candleBehavior: '', timeframeAlignment: '', rsi: '', macd: '', sentiment: ''
        },
        detectedPatternFamily: 'Family A',
        activeStrategies: [],
        probability: 0,
        strategy: '',
        detectedPatterns: [],
        keyLevels: { support: [], resistance: [] }
    }
};

const postMortemText = `
The trade failed because I entered too early. 
IF Price is below the 200 EMA on the 15m chart, THEN wait for a confirmed breakout before going long.
Also, I should have noticed the declining volume.
IF volume is declining on the breakout candle, THEN invalid the setup and avoid entry.
`;

async function testExtraction() {
    console.log('🧪 Starting Rule Extraction Verification...');

    // 1. Clear Rules
    localStorage.clear();

    console.log('\n--- Running Extraction (Regex + LLM) ---');
    console.log('Post-Mortem:', postMortemText.trim());

    try {
        // This will call the real LLM service (Gemini default in tests)
        // Ensure API key is present in env if running purely locally, 
        // but since we are running via npx ts-node in a configured env, it might work.
        // If not, we might need to mock the LLM part or rely on the Mock Service if we wanted to test logic only.
        // For this "Integration" test, we want to try the real thing if possible, but fallback to just checking regex if LLM fails.

        const newRules = await addRulesFromPostMortem(postMortemText, mockTrade, AIProvider.GEMINI);

        console.log(`\n✅ Extracted ${newRules.length} rules.`);
        newRules.forEach((r, i) => {
            console.log(`Rule ${i + 1}: IF ${r.condition} THEN ${r.action} [Category: ${r.category}, Score: ${r.effectiveness}]`);
        });

        // Verification Checks
        const hasRegexRule = newRules.some(r => r.condition.includes('Price is below the 200 EMA'));
        const hasLLMRule = newRules.some(r => r.condition.toLowerCase().includes('volume') || r.action.toLowerCase().includes('invalid'));

        if (hasRegexRule) console.log('✅ Regex Logic: PASS');
        else console.error('❌ Regex Logic: FAIL (Expected 200 EMA rule)');

        if (hasLLMRule) console.log('✅ LLM Logic: PASS (or Regex caught it too)');
        else console.warn('⚠️ LLM Logic: MAYBE FAIL (Volume rule not found, check LLM response)');

    } catch (e) {
        console.error('❌ Test Failed:', e);
    }
}

testExtraction();
