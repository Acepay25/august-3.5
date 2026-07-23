/**
 * test-rl.ts
 * 
 * Verification script for Item 1.1: Reinforcement Learning Feedback Loop
 */

// 1. Mock localStorage for Node environment
if (typeof localStorage === 'undefined' || localStorage === null) {
    (global as any).localStorage = {
        _data: {},
        setItem: function (id: string, val: string) { return this._data[id] = String(val); },
        getItem: function (id: string) { return this._data.hasOwnProperty(id) ? this._data[id] : null; },
        removeItem: function (id: string) { return delete this._data[id]; },
        clear: function () { return this._data = {}; }
    };
}

// 2. Mock Capacitor
// We need to mock the module itself or the import will fail before code runs
// However, since we can't easilymock require calls in TS without jest, 
// we rely on the fact that PreferencesService checks Capacitor.isNativePlatform()
// We must ensure Capacitor.isNativePlatform() returns false or doesn't crash.
// But the imports happens at top level. 
// If @capacitor/core isn't installed in node_modules, it will crash.
// Let's assume it is installed (since the project builds).

import { ReinforcementSignalService } from '../services/learning/ReinforcementSignalService';
import { AIProvider } from '../types';

async function testRLSignals() {
    console.log('🧪 Starting RL Signal Verification...');

    const testProvider = AIProvider.GEMINI;

    // Clear storage first
    localStorage.clear();

    // Test Case 1: Perfect Win (High Confidence)
    console.log('\n--- Test Case 1: WIN + High Confidence ---');
    await ReinforcementSignalService.recordSignal(
        'test-trade-1',
        testProvider,
        'WIN',
        {
            direction: 'Long',
            confidence: 'High',
            entryPrice: 50000
        }
    );

    let signals = await ReinforcementSignalService.getSignals(testProvider);
    let s1 = signals.find(s => s.tradeId === 'test-trade-1');
    console.log(`Signal Recorded: ${s1 ? '✅' : '❌'}`);
    console.log(`Expected Reward: 1.0, Actual: ${s1?.rewardScore}`);

    if (s1?.rewardScore === 1.0) console.log('✅ REWARD CALCULATION CORRECT');
    else console.error('❌ REWARD CALCULATION FAILED: ' + s1?.rewardScore);

    // Test Case 2: Bad Loss (High Confidence)
    console.log('\n--- Test Case 2: LOSS + High Confidence ---');
    await ReinforcementSignalService.recordSignal(
        'test-trade-2',
        testProvider,
        'LOSS',
        {
            direction: 'Long',
            confidence: 'High',
            entryPrice: 50000
        }
    );

    signals = await ReinforcementSignalService.getSignals(testProvider);
    let s2 = signals.find(s => s.tradeId === 'test-trade-2');
    console.log(`Expected Reward: -1.0, Actual: ${s2?.rewardScore}`);

    if (s2?.rewardScore === -1.0) console.log('✅ REWARD CALCULATION CORRECT');
    else console.error('❌ REWARD CALCULATION FAILED: ' + s2?.rewardScore);

    // Test Case 3: Forgivable Loss (Low Confidence)
    console.log('\n--- Test Case 3: LOSS + Low Confidence ---');
    await ReinforcementSignalService.recordSignal(
        'test-trade-3',
        testProvider,
        'LOSS',
        {
            direction: 'Long',
            confidence: 'Low',
            entryPrice: 50000
        }
    );

    signals = await ReinforcementSignalService.getSignals(testProvider);
    let s3 = signals.find(s => s.tradeId === 'test-trade-3');
    console.log(`Expected Reward: -0.2, Actual: ${s3?.rewardScore}`);

    if (s3?.rewardScore === -0.2) console.log('✅ REWARD CALCULATION CORRECT');
    else console.error('❌ REWARD CALCULATION FAILED: ' + s3?.rewardScore);

    // Test Case 4: Average Calculation
    console.log('\n--- Test Case 4: Average Calculation ---');
    const average = await ReinforcementSignalService.getAverageReward(testProvider);
    // (1.0 - 1.0 - 0.2) / 3 = -0.2 / 3 = -0.0666...
    console.log(`Expected Average: ~-0.067, Actual: ${average.toFixed(3)}`);

    if (Math.abs(average - (-0.2 / 3)) < 0.001) console.log('✅ AVERAGE CALCULATION CORRECT');
    else console.error('❌ AVERAGE CALCULATION FAILED');

    console.log('\n🧪 Verification Complete.');
}

// Execute
testRLSignals().catch(console.error);
