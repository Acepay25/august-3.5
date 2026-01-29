
import { getBayesianCalibratedConfidence, initializeCalibration, updateGranularCalibration } from './ConfidenceCalibrationService';
import { ConfidenceCalibration, TradeOutcome, GranularCalibrationEntry, AIProvider } from '../types';
import fs from 'fs';
import path from 'path';

// Mock Calibration Data
let mockCalibration: ConfidenceCalibration = initializeCalibration();

const TEST_PROVIDER = AIProvider.GEMINI;

function addTrade(confidence: 'High' | 'Medium' | 'Low', outcome: TradeOutcome) {
    const entry: GranularCalibrationEntry = {
        timestamp: new Date().toISOString(),
        confidence: confidence,
        outcome: outcome === TradeOutcome.WIN ? 'WIN' : 'LOSS',
        provider: TEST_PROVIDER,
        coin: 'BTCUSDT',
        pattern: 'TestPattern',
        timeframe: '1h',
        regime: 'trending'
    };
    mockCalibration = updateGranularCalibration(mockCalibration, entry);
}

// Train it with some data
// Scenario 1: 'High' confidence but actually fails 50% of the time (overconfident)
for (let i = 0; i < 10; i++) {
    addTrade('High', TradeOutcome.WIN);
    addTrade('High', TradeOutcome.LOSS);
}

// Scenario 2: 'Medium' confidence that wins 80% of the time (underconfident)
for (let i = 0; i < 10; i++) {
    addTrade('Medium', TradeOutcome.WIN);
    addTrade('Medium', TradeOutcome.WIN);
    addTrade('Medium', TradeOutcome.WIN);
    addTrade('Medium', TradeOutcome.WIN);
    addTrade('Medium', TradeOutcome.LOSS);
}

// Scenario 3: 'Low' confidence that loses 90% of the time (accurate/good avoidance)
for (let i = 0; i < 10; i++) {
    addTrade('Low', TradeOutcome.LOSS);
    addTrade('Low', TradeOutcome.LOSS);
    addTrade('Low', TradeOutcome.LOSS);
    addTrade('Low', TradeOutcome.LOSS);
    addTrade('Low', TradeOutcome.LOSS);
    addTrade('Low', TradeOutcome.LOSS);
    addTrade('Low', TradeOutcome.LOSS);
    addTrade('Low', TradeOutcome.LOSS);
    addTrade('Low', TradeOutcome.LOSS);
    addTrade('Low', TradeOutcome.WIN);
}

function log(message: string) {
    console.log(message);
    const logPath = path.join(process.cwd(), 'services', 'test_output.txt');
    try {
        fs.appendFileSync(logPath, message + '\n');
    } catch (e) {
        console.error('Failed to write to log file:', e);
    }
}

async function runTest() {
    const logPath = path.join(process.cwd(), 'services', 'test_output.txt');
    // Clear previous log
    if (fs.existsSync(logPath)) {
        fs.unlinkSync(logPath);
    }

    log('--- Bayesian Calibration Test ---');

    // log('\nStats (High): ' + JSON.stringify(mockCalibration.high)); // Base stats might use a different structure now
    log('Granular Provider Stats: ' + JSON.stringify(mockCalibration.granular?.byProvider?.[TEST_PROVIDER]));

    // Test 1: High Confidence Overconfidence Correction
    // Provider Win Rate (Prior) = 50% (High=50%, Medium=80%, Low=10% -> Aggregated for provider? No, byProvider tracks ALL trades for that provider)
    // Wait, byProvider aggregates ALL trades for that provider.
    // Total trades = 20 (High) + 50 (Med) + 10 (Low) = 80 trades?
    // High: 10 wins, 10 losses. (50%)
    // Medium: 40 wins, 10 losses. (80%)
    // Low: 1 win, 9 losses. (10%)
    // Total Wins = 10 + 40 + 1 = 51.
    // Total Losses = 10 + 10 + 9 = 29.
    // Total = 80.
    // Provider Prior (Win Rate) = 51/80 = 63.75%.

    log('\nTest 1: Check High Confidence Correction (History: Provider Prior ~64%)');
    const rawHighProb = 95;
    // AI says 95%. Provider average is 64%.
    // Current Confidence 'High' has no granular stat usage in strict implementation?
    // "Let's stick to the granular provider win rate (Prior) acting as a gravity well."
    // So it pulls 95% towards 64%.

    const calHigh = getBayesianCalibratedConfidence(mockCalibration, TEST_PROVIDER, 'High', rawHighProb);
    log(`Raw: ${rawHighProb}%, Calibrated: ${calHigh}%`);

    if (calHigh < rawHighProb) {
        log('✅ PASS: Confidence reduced towards prior.');
    } else {
        log('❌ FAIL: Confidence not reduced.');
    }

    // Test 2: Low Confidence Boost?
    // If Raw is 40% (Low), and Prior is 64%... it might actually boost it?
    // That's a side effect of using global prior.
    // "When this AI says 'High', how often is it actually right?" -> This should use specific confidence stats.
    // The implementation said: "Ideally we'd use P(High|Win)... but providing win rate (Prior) acting as gravity well".

    // Let's test checking if it pulls towards 64%.
    log('\nTest 2: Check Low Confidence Pull (Raw 20%, Prior ~64%)');
    const rawLowProb = 20;
    const calLow = getBayesianCalibratedConfidence(mockCalibration, TEST_PROVIDER, 'Low', rawLowProb);
    log(`Raw: ${rawLowProb}%, Calibrated: ${calLow}%`);

    if (calLow > rawLowProb) {
        log('✅ PASS: Confidence pulled towards prior (upwards).');
    } else {
        log('❌ FAIL: Confidence not pulled.');
    }

}

runTest().catch(console.error);
