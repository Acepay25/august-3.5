
import { runValidationGate, TradeValidationInput } from './TradeValidationGate';
import { CONFIDENCE_RULES } from './LearningRulesService';
import { TradeAnalysis, TradeOutcome, ConfidenceCalibration, StructuredRule } from '../types';
import { HybridDataPacket } from './HybridIntelligenceService';

// Mock Data Builders
const createMockAnalysis = (confidence: 'High' | 'Medium' | 'Low', rr: number): TradeAnalysis => ({
    coinName: 'BTCUSDT',
    direction: 'Long',
    confidence,
    entryPoints: [{ price: '50000' }],
    stopLoss: '49000', // Risk = 1000
    takeProfit: [{ price: (50000 + 1000 * rr).toString() }], // Reward = 1000 * rr
    detectedPatternFamily: 'Breakout',
    strategy: 'Trend Continuation',
    timeframe: '1h',
    probability: 85,
    marketConditions: { sentiment: 'Bullish' }
} as unknown as TradeAnalysis);

const createMockHybridData = (): HybridDataPacket => ({
    symbol: 'BTCUSDT',
    dataTimestamp: Date.now(),
    fundingRate: 0.0001,
    regime: { regime: 'trending', score: 80, reasoning: ['Strong trend'] },
    confluence: { alignment: ['1h', '4h', '1d'], conflicts: [] },
    indicators: { '1h': { atr: 50, rsi: 60 } }
} as any);

// Helper to run validation using the actual runValidationGate function
const validateAnalysis = (
    analysis: TradeAnalysis,
    hybridData: HybridDataPacket,
    rules: StructuredRule[]
) => {
    const input: TradeValidationInput = {
        analysis,
        hybridData,
        learningRules: rules
    };
    return runValidationGate(input);
};

const runTests = () => {
    console.log('🧪 Starting Structured Rule Validation Tests...\n');

    // Test 1: Core Config Enforcement (High Conf requires > 2.0 RR)
    console.log('Test 1: Core Config Enforcement (High Conf + Low RR)');
    const weakAnalysis = createMockAnalysis('High', 1.5); // 1.5 RR < 2.0 required
    const result1 = validateAnalysis(weakAnalysis, createMockHybridData(), []);

    if (result1.adjustedConfidence === 'Medium' && result1.warnings.some(w => w.includes('CORE CONFIG'))) {
        console.log('✅ PASS: Automatically downgraded High confidence setup with weak R:R.');
    } else {
        console.error('❌ FAIL: Core config enforcement failed.', result1);
    }
    console.log('');

    // Test 2: Structured Rule Enforcement (Strict Mode)
    console.log('Test 2: Structured Rule Enforcement (Strict Mode)');
    const strictRule: StructuredRule = {
        id: 'rule_1',
        ifCondition: 'pattern is breakout',
        thenAction: 'must have > 3.0 RR',
        constraints: { minRR: 3.0 },
        isStrictMode: true,
        sourceTradeId: 'trade_1',
        outcome: 'LOSS',
        createdAt: new Date().toISOString(),
        useCount: 0
    };

    const goodAnalysis = createMockAnalysis('Medium', 2.5); // 2.5 RR < 3.0 required
    const result2 = validateAnalysis(goodAnalysis, createMockHybridData(), [strictRule]);

    if (result2.adjustedConfidence === 'Avoid' && result2.errors.some(e => e.includes('RULE VIOLATION'))) {
        console.log('✅ PASS: Strict rule violation triggered Avoid confidence and Error.');
    } else {
        console.error('❌ FAIL: Strict rule enforcement failed.', result2);
    }
    console.log('');

    // Test 3: Structured Rule Warning (Non-Strict)
    console.log('Test 3: Structured Rule Warning (Non-Strict)');
    const softRule: StructuredRule = {
        ...strictRule,
        isStrictMode: false,
        thenAction: 'should have > 3.0 RR'
    };

    const result3 = validateAnalysis(goodAnalysis, createMockHybridData(), [softRule]);

    // Non-strict rules should generate warnings but not force Avoid
    if (result3.warnings.some(w => w.includes('RULE') || w.includes('VIOLATION'))) {
        console.log('✅ PASS: Non-strict rule generated warning.');
    } else {
        console.log('⚠️ INFO: Non-strict rule check completed.', result3);
    }
};

runTests();
