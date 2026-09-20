/**
 * JobQueueService — a settled job stays on the snapshot.
 *
 * The queue pops a job the moment it finishes, so before this the Jobs drawer
 * could only ever show work still in flight: the completed/failed rows it
 * styles for were unreachable, and "Queued / recent" was half a lie.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/infrastructure/dbService', () => ({
    getUserProfile: vi.fn(async () => ({ tradeLog: [] })),
}));
vi.mock('../services/learning/severityInsights', () => ({
    extractAndRecordSeverityInsights: vi.fn(() => []),
    extractAndRecordProviderInsights: vi.fn(() => []),
}));

import { jobQueue, JobType } from '../services/infrastructure/JobQueueService';

const settle = async (id: string): Promise<string> => {
    for (let i = 0; i < 200; i += 1) {
        const job = jobQueue.getJobs().find(j => j.id === id);
        if (job && (job.status === 'completed' || job.status === 'failed')) return job.status;
        await new Promise(r => setTimeout(r, 20));
    }
    throw new Error(`job ${id} never settled`);
};

describe('JobQueueService', () => {
    it('keeps a finished job on the snapshot while the live queue empties', async () => {
        jobQueue.addJob(JobType.EXTRACT_INSIGHTS, {});
        const id = jobQueue.getJobs()[0]?.id;
        expect(id).toBeTruthy();
        expect(await settle(id)).toBe('completed');
        expect(jobQueue.getQueueLength()).toBe(0);
        expect(jobQueue.getJobs().map(j => j.id)).toContain(id);
    });

    it('lists finished work newest first', async () => {
        jobQueue.addJob(JobType.EXTRACT_INSIGHTS, {});
        const first = jobQueue.getJobs()[0].id;
        jobQueue.addJob(JobType.EXTRACT_INSIGHTS, {});
        const second = jobQueue.getJobs().find(j => j.id !== first)!.id;
        expect(await settle(first)).toBe('completed');
        expect(await settle(second)).toBe('completed');
        expect(jobQueue.getJobs()[0].id).toBe(second);
    });
});
