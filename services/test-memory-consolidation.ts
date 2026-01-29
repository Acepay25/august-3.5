
import { consolidateMemory } from './MemoryConsolidationService';
import { InsightKnowledgeBase, TradeInsight } from '../types';
import fs from 'fs';
import path from 'path';

const logPath = path.join(process.cwd(), 'services', 'test_mem_output.txt');

function log(message: string) {
    console.log(message);
    try {
        fs.appendFileSync(logPath, message + '\n');
    } catch (e) {
        console.error('Failed to write to log file:', e);
    }
}

// Helper to create insight
const createInsight = (id: string, text: string, daysOld: number, useCount: number): TradeInsight => {
    const date = new Date();
    date.setDate(date.getDate() - daysOld);

    return {
        id,
        category: 'general',
        insight: text,
        sourceTradeId: 'trade_' + id,
        createdAt: date.toISOString(),
        useCount
    };
};

async function runTest() {
    // Clear log
    if (fs.existsSync(logPath)) fs.unlinkSync(logPath);

    log('--- Memory Consolidation Test ---');

    // 1. Setup Data
    const insights: TradeInsight[] = [
        // PRUNING CANDIDATES
        createInsight('1', 'Ancient useless insight', 100, 1), // >90 days, <3 uses -> DELETE
        createInsight('2', 'Ancient popular insight', 100, 50), // >90 days, >3 uses -> KEEP
        createInsight('3', 'New useless insight', 10, 1), // <90 days -> KEEP

        // AGGREGATION CANDIDATES
        createInsight('4', 'The trend was missed due to hesitation', 5, 10), // Master
        createInsight('5', 'Trend was missed due to hesitation', 5, 2), // Similar -> MERGE into 4
        createInsight('6', 'Completely different insight', 5, 5) // Different -> KEEP
    ];

    const kb: InsightKnowledgeBase = {
        insights,
        lastUpdated: new Date().toISOString()
    };

    log(`Initial Count: ${kb.insights.length}`);
    log('Running consolidation...');

    const result = await consolidateMemory(kb);

    log(`Final Count: ${result.insights.length}`);

    // VERIFICATION

    // Check Pruning
    const hasId1 = result.insights.find(i => i.id === '1');
    const hasId2 = result.insights.find(i => i.id === '2');
    const hasId3 = result.insights.find(i => i.id === '3');

    if (!hasId1) log('✅ PASS: Pruned ancient unused insight (ID 1)');
    else log('❌ FAIL: ID 1 should be pruned');

    if (hasId2) log('✅ PASS: Kept ancient popular insight (ID 2)');
    else log('❌ FAIL: ID 2 should be kept');

    if (hasId3) log('✅ PASS: Kept new unused insight (ID 3)');
    else log('❌ FAIL: ID 3 should be kept');

    // Check Aggregation
    const master = result.insights.find(i => i.id === '4');
    const duplicate = result.insights.find(i => i.id === '5');

    if (master && !duplicate) {
        log('✅ PASS: Aggregated duplicate (ID 5) into valid master (ID 4)');
        if (master.useCount === 12) {
            log('✅ PASS: Usage count aggregated correctly (10 + 2 = 12)');
        } else {
            log(`❌ FAIL: Usage count mismatch. Expected 12, got ${master.useCount}`);
        }
    } else {
        log('❌ FAIL: Aggregation logic failed');
        if (duplicate) log('   -> Duplicate ID 5 still exists');
        if (!master) log('   -> Master ID 4 is missing');
    }
}

runTest().catch(e => log(`FATAL ERROR: ${e}`));
