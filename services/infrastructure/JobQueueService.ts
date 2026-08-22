
/**
 * JobQueueService
 * 
 * Manages background processing of heavy learning tasks to prevent UI blocking.
 * Uses a FIFO queue to process tasks sequentially.
 */

import { LoggedTrade } from '../../types';
import { getUserProfile } from './dbService';
import {
    extractInsightsFromPostMortem,
    extractAndRecordSeverityInsights,
    extractAndRecordProviderInsights
} from '../learning/InsightExtractionService';
export enum JobType {
    EXTRACT_INSIGHTS = 'EXTRACT_INSIGHTS',
    /** Retired (ROUND-25b): IF/THEN lessons live in skills. Kept as a string
     *  for queued-job backward compatibility; no handler runs it. */
    EXTRACT_RULES = 'EXTRACT_RULES'
}

export interface JobResult {
    success: boolean;
    data?: any;
    error?: any;
}

export interface Job {
    id: string;
    type: JobType;
    payload: any;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    result?: JobResult;
    retries: number;
}

class JobQueueService {
    private queue: Job[] = [];
    private isProcessing = false;
    private listeners: ((job: Job) => void)[] = [];

    /**
     * Add a new job to the queue
     */
    addJob(type: JobType, payload: any) {
        const job: Job = {
            id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type,
            payload,
            status: 'pending',
            retries: 0
        };

        this.queue.push(job);
        console.log(`[JobQueue] Added job ${job.id} (${type})`);

        // Trigger processing if idle
        if (!this.isProcessing) {
            this.processQueue();
        }
    }

    /**
     * Subscribe to job completion events (useful for UI updates)
     */
    onJobComplete(callback: (job: Job) => void) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    /**
     * Get current queue length
     */
    getQueueLength(): number {
        return this.queue.length;
    }

    /**
     * Process the queue
     */
    private async processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;

        this.isProcessing = true;

        try {
            while (this.queue.length > 0) {
                const job = this.queue[0]; // Peek
                job.status = 'processing';
                console.log(`[JobQueue] Processing job ${job.id}...`);

                try {
                    const resultData = await this.executeJob(job);
                    job.status = 'completed';
                    job.result = { success: true, data: resultData };
                    console.log(`[JobQueue] Job ${job.id} completed successfully.`);

                } catch (e) {
                    console.error(`[JobQueue] Job ${job.id} failed:`, e);
                    job.status = 'failed';
                    job.result = { success: false, error: e };
                }

                // Notify listeners (success or failure)
                this.notifyListeners(job);

                // Remove from queue
                this.queue.shift();

                // Small delay to yield to main thread if needed
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Execute a single job logic
     */
    private async executeJob(job: Job): Promise<any> {
        switch (job.type) {
            case JobType.EXTRACT_INSIGHTS:
                return await this.handleExtractInsights(job.payload);


            default:
                throw new Error(`Unknown job type: ${job.type}`);
        }
    }

    /**
     * Handler: Extract Insights from Post-Mortem
     */
    private async handleExtractInsights(trade: LoggedTrade) {
        if (!trade.postMortem) return [];

        // R-severity signals first: a deep loss always generates a severity
        // insight — both the single-trade deep-loss signal (-1.5R or worse)
        // and the cumulative setup-bleed signal (cluster sumLossR <= -3R
        // across 2+ R-bearing losses) — independent of whether the post-mortem
        // text contains the right keywords. The text-based extractor runs
        // alongside; they're complementary, not redundant. Both writes are
        // idempotent (severity ids are derived from trade/setup).
        try {
            const username = typeof localStorage !== 'undefined'
                ? (localStorage.getItem('last_active_user') || 'default')
                : 'default';
            const profile = await getUserProfile(username);
            const tradeLog = profile?.tradeLog ?? [];
            const severityInsights = extractAndRecordSeverityInsights(trade, tradeLog);
            for (const si of severityInsights) {
                console.log(`[JobQueue] Recorded severity insight (${si.kind}, ${si.pnlR}R) for ${si.tradeId}`);
            }
        } catch (e) {
            // Severity recording must never kill the rest of the job.
            console.warn('[JobQueue] Severity insight extraction failed:', e);
        }

        // Provider attribution: per-provider post-mortem reports (captured at
        // generation time in usePostMortem) → attributed insights so the
        // Knowledge Base can track which AI produced which lesson. Idempotent
        // (derived ids) — re-running the job updates in place.
        try {
            const attributed = extractAndRecordProviderInsights(trade);
            if (attributed.length > 0) {
                console.log(`[JobQueue] Recorded ${attributed.length} provider-attributed insights`);
            }
        } catch (e) {
            // Attribution must never kill the rest of the job.
            console.warn('[JobQueue] Provider insight attribution failed:', e);
        }

        // Run extraction (CPU intensive part)
        const insights = extractInsightsFromPostMortem(trade.postMortem, trade);

        if (insights.length > 0) {
            console.log(`[JobQueue] Extracted ${insights.length} insights.`);
        }

        return insights;
    }

    /**
     * Handler: Extract Rules from Post-Mortem
     */
    
    private notifyListeners(job: Job) {
        this.listeners.forEach(l => l(job));
    }
}

// Export singleton
export const jobQueue = new JobQueueService();
