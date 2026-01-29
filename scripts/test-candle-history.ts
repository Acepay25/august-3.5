
import { fetchHybridData } from '../services/HybridIntelligenceService';

async function testCandleHistory() {
    console.log('Testing Candle History Analysis...');

    // We expect this to pull real data from Binance via MarketDataService
    const data = await fetchHybridData('BTCUSDT');

    // Assertions
    const ch = data.candleHistory;

    // 1. All timeframes should have data
    if (ch['5m'].sequence.length > 0) console.log('✅ 5m has candles'); else console.error('❌ 5m missing candles');
    if (ch['15m'].sequence.length > 0) console.log('✅ 15m has candles'); else console.error('❌ 15m missing candles');
    if (ch['1h'].sequence.length > 0) console.log('✅ 1h has candles'); else console.error('❌ 1h missing candles');
    if (ch['4h'].sequence.length > 0) console.log('✅ 4h has candles'); else console.error('❌ 4h missing candles');

    // 2. Counts should sum to sequence length
    for (const tf of ['5m', '15m', '1h', '4h'] as const) {
        const total = ch[tf].bullishCount + ch[tf].bearishCount;
        if (total === ch[tf].sequence.length) {
            console.log(`✅ ${tf}: Count matches sequence length (${total})`);
        } else {
            console.error(`❌ ${tf}: Count mismatch ${total} vs ${ch[tf].sequence.length}`);
        }
    }

    // 3. Sequence should only contain valid emojis
    for (const tf of ['5m', '15m', '1h', '4h'] as const) {
        const validEmojis = ch[tf].sequence.every(e => e === '🟢' || e === '🔴');
        if (validEmojis) {
            console.log(`✅ ${tf}: Emojis valid`);
        } else {
            console.error(`❌ ${tf}: Invalid emojis in sequence`);
        }
    }

    // 4. Different timeframes should have DIFFERENT sequences
    if (JSON.stringify(ch['5m'].sequence) !== JSON.stringify(ch['4h'].sequence)) {
        console.log('✅ 5m vs 4h sequences differ (correct)');
    } else {
        console.warn('⚠️ 5m and 4h sequences identical (unlikely but possible if market very uniform)');
    }

    console.log('\n--- SAMPLE OUTPUT ---');
    console.log('5m:', ch['5m'].sequence.join(''), ch['5m'].summary);
    console.log('1h:', ch['1h'].sequence.join(''), ch['1h'].summary);
    console.log('4h:', ch['4h'].sequence.join(''), ch['4h'].summary);

    console.log('\n✅ Test Complete');
}

testCandleHistory().catch(console.error);
