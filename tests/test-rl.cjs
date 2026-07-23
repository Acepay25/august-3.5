"use strict";
/**
 * standalone-test-rl.ts
 *
 * Logic verification for ReinforcementSignalService (Embedded to bypass ts-node ESM issues)
 */
Object.defineProperty(exports, "__esModule", { value: true });
// --- MOCK STORAGE ---
if (typeof localStorage === 'undefined' || localStorage === null) {
    global.localStorage = {
        _data: {},
        setItem: function (id, val) { return this._data[id] = String(val); },
        getItem: function (id) { return this._data.hasOwnProperty(id) ? this._data[id] : null; },
        removeItem: function (id) { return delete this._data[id]; },
        clear: function () { return this._data = {}; }
    };
}
// --- MOCK CONSTANTS / TYPES ---
var AIProvider;
(function (AIProvider) {
    AIProvider["GEMINI"] = "gemini";
    AIProvider["DEEPSEEK"] = "deepseek";
    AIProvider["ZHIPU"] = "zhipu";
    AIProvider["GROQ"] = "groq";
    AIProvider["GROQ_NEW"] = "groq-new";
    AIProvider["GROQ_ALT2"] = "groq-alt2";
    AIProvider["OPENROUTER"] = "openrouter";
    AIProvider["OPENAI"] = "openai";
    AIProvider["GROK"] = "grok";
})(AIProvider || (AIProvider = {}));
const PREF_KEYS = {
    RL_SIGNALS_DATA: 'rl_signals_data_test'
};
// --- MOCK PREFERENCES SERVICE ---
const getPreferenceObject = async (key) => {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : null;
};
const setPreferenceObject = async (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
};
const RL_STORAGE_KEY = 'rl_signals_data_test';
const ReinforcementSignalService = {
    calculateReward(outcome, confidence) {
        const isWin = outcome === 'WIN';
        const conf = confidence.toLowerCase();
        if (isWin) {
            if (conf === 'high')
                return 1.0;
            if (conf === 'medium')
                return 0.8;
            return 0.5;
        }
        else {
            if (conf === 'high')
                return -1.0;
            if (conf === 'medium')
                return -0.6;
            return -0.2;
        }
    },
    async recordSignal(tradeId, provider, outcome, decision) {
        try {
            const store = await getPreferenceObject(RL_STORAGE_KEY) || { signals: [], lastUpdated: '' };
            if (store.signals.some(s => s.tradeId === tradeId && s.provider === provider)) {
                return;
            }
            const reward = this.calculateReward(outcome, decision.confidence);
            const signal = {
                id: 'uuid-' + Math.random(),
                tradeId,
                provider,
                timestamp: new Date().toISOString(),
                decision,
                outcome,
                rewardScore: reward,
                metricScores: {
                    directionScore: outcome === 'WIN' ? 1 : -1,
                    confidenceScore: reward,
                    entryQuality: 0
                }
            };
            store.signals.push(signal);
            if (store.signals.length > 1000)
                store.signals = store.signals.slice(-1000);
            store.lastUpdated = new Date().toISOString();
            await setPreferenceObject(RL_STORAGE_KEY, store);
            console.log(`[ReinforcementSignal] Recorded signal for ${provider}: Reward ${reward}`);
        }
        catch (error) {
            console.error('[ReinforcementSignal] Failed to record signal', error);
        }
    },
    async getSignals(provider, limit = 20) {
        const store = await getPreferenceObject(RL_STORAGE_KEY) || { signals: [], lastUpdated: '' };
        return store.signals
            .filter(s => s.provider === provider)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, limit);
    },
    async getAverageReward(provider, window = 10) {
        const signals = await this.getSignals(provider, window);
        if (signals.length === 0)
            return 0;
        const sum = signals.reduce((acc, s) => acc + s.rewardScore, 0);
        return sum / signals.length;
    }
};
// --- TEST EXECUTION ---
async function testRLSignals() {
    console.log('🧪 Starting RL Signal Verification (Standalone Mode)...');
    const testProvider = AIProvider.GEMINI;
    localStorage.clear();
    // Test Case 1
    console.log('\n--- Test Case 1: WIN + High Confidence ---');
    await ReinforcementSignalService.recordSignal('t1', testProvider, 'WIN', { direction: 'Long', confidence: 'High', entryPrice: 0 });
    let signals = await ReinforcementSignalService.getSignals(testProvider);
    let s1 = signals.find(s => s.tradeId === 't1');
    if (s1?.rewardScore === 1.0)
        console.log('✅ REWARD CALCULATION CORRECT (1.0)');
    else
        console.error('❌ REWARD CALCULATION FAILED: ' + s1?.rewardScore);
    // Test Case 2
    console.log('\n--- Test Case 2: LOSS + High Confidence ---');
    await ReinforcementSignalService.recordSignal('t2', testProvider, 'LOSS', { direction: 'Long', confidence: 'High', entryPrice: 0 });
    signals = await ReinforcementSignalService.getSignals(testProvider);
    let s2 = signals.find(s => s.tradeId === 't2');
    if (s2?.rewardScore === -1.0)
        console.log('✅ REWARD CALCULATION CORRECT (-1.0)');
    else
        console.error('❌ REWARD CALCULATION FAILED: ' + s2?.rewardScore);
    // Test Case 3
    console.log('\n--- Test Case 3: LOSS + Low Confidence ---');
    await ReinforcementSignalService.recordSignal('t3', testProvider, 'LOSS', { direction: 'Long', confidence: 'Low', entryPrice: 0 });
    signals = await ReinforcementSignalService.getSignals(testProvider);
    let s3 = signals.find(s => s.tradeId === 't3');
    if (s3?.rewardScore === -0.2)
        console.log('✅ REWARD CALCULATION CORRECT (-0.2)');
    else
        console.error('❌ REWARD CALCULATION FAILED: ' + s3?.rewardScore);
    // Test Case 4
    console.log('\n--- Test Case 4: Average Calculation ---');
    const average = await ReinforcementSignalService.getAverageReward(testProvider);
    console.log(`Expected: ~-0.067, Actual: ${average.toFixed(3)}`);
    if (Math.abs(average - (-0.2 / 3)) < 0.001)
        console.log('✅ AVERAGE CALCULATION CORRECT');
    else
        console.error('❌ AVERAGE CALCULATION FAILED');
    console.log('\n🧪 Verification Complete.');
}
testRLSignals().catch(console.error);
