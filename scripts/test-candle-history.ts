
import { fetchHybridData, HybridTimeframe } from '../services/analysis/HybridIntelligenceService';

const TIMEFRAMES: HybridTimeframe[] = ['15m', '1h', '4h', '1d'];

async function testCandleHistory() {
    console.log('Testing Candle History Analysis...');

    // We expect this to pull real data from Binance via MarketDataService
    const data = await fetchHybridData('BTCUSDT');

    // Assertions
    const ch = data.candleHistory;

    // 1. All timeframes should have data
    for (const tf of TIMEFRAMES) {
        if (ch[tf].sequence.length > 0) console.log(`✅ ${tf} has candles`);
        else console.error(`❌ ${tf} missing candles`);
    }

    // 2. Counts should sum to sequence length
    for (const tf of TIMEFRAMES) {
        const total = ch[tf].bullishCount + ch[tf].bearishCount;
        if (total === ch[tf].sequence.length) {
            console.log(`✅ ${tf}: Count matches sequence length (${total})`);
        } else {
            console.error(`❌ ${tf}: Count mismatch ${total} vs ${ch[tf].sequence.length}`);
        }
    }

    // 3. Sequence should only contain valid emojis
    for (const tf of TIMEFRAMES) {
        const validEmojis = ch[tf].sequence.every((e: string) => e === '🟢' || e === '🔴');
        if (validEmojis) {
            console.log(`✅ ${tf}: Emojis valid`);
        } else {
            console.error(`❌ ${tf}: Invalid emojis in sequence`);
        }
    }

    // 4. Different timeframes should have DIFFERENT sequences
    if (JSON.stringify(ch['15m'].sequence) !== JSON.stringify(ch['4h'].sequence)) {
        console.log('✅ 15m vs 4h sequences differ (correct)');
    } else {
        console.warn('⚠️ 15m and 4h sequences identical (unlikely but possible if market very uniform)');
    }

    console.log('\n--- SAMPLE OUTPUT ---');
    console.log('15m:', ch['15m'].sequence.join(''), ch['15m'].summary);
    console.log('1h:', ch['1h'].sequence.join(''), ch['1h'].summary);
    console.log('4h:', ch['4h'].sequence.join(''), ch['4h'].summary);
    console.log('1d:', ch['1d'].sequence.join(''), ch['1d'].summary);

    console.log('\n✅ Test Complete');
}

testCandleHistory().catch(console.error);
