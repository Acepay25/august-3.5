/**
 * A goal is a durable work ENVIRONMENT, not a chat title and not a skill.
 *
 * It carries the objective, the next step, the inputs and outputs it is
 * allowed to use, the triggers that resurface it, and a policy that can only
 * NARROW the seat's tools. It lives as JSON in the existing notebook
 * (goals/<slug>.json), so backup/export, the one-store rule and the human
 * editor already apply. The agent edits it mid-task; every edit is versioned
 * with the previous snapshot in `history`, which is the undo rail.
 */

import { z } from 'zod';

export const GOAL_STATUSES = ['active', 'paused', 'done'] as const;
export const GOAL_REF_KINDS = ['notebook', 'skill', 'strategy', 'memory', 'watch', 'symbol', 'bot', 'url'] as const;
export const GOAL_TRIGGER_KINDS = ['message', 'price', 'session'] as const;

export const GoalStatusSchema = z.enum(GOAL_STATUSES);

export const GoalRefSchema = z.object({
    kind: z.enum(GOAL_REF_KINDS),
    ref: z.string().trim().min(1).max(200),
    note: z.string().trim().max(200).optional(),
});

export const GoalTriggerSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('message'),
        /** Lowercased phrases; a turn whose text contains one surfaces this goal. */
        match: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
    }),
    z.object({
        kind: z.literal('price'),
        /** An existing watch_price/wake_me watch id; the goal rides its signal. */
        watchId: z.string().trim().min(1).max(80),
    }),
    z.object({
        kind: z.literal('session'),
        when: z.literal('start'),
    }),
]);

export const GoalPolicySchema = z.object({
    /** A goal may only NARROW the seat's own allow-list. An empty/absent list
     *  means "the seat's tools unchanged"; it never means "all tools". */
    allowedTools: z.array(z.string().trim().min(1).max(80)).max(60).optional(),
});

/** The previous snapshot kept on every edit. No nested history, so a goal file
 *  cannot grow by recursion. */
export const GoalSnapshotSchema = z.object({
    schemaVersion: z.number().int().default(1),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/),
    title: z.string().trim().min(1).max(120),
    status: GoalStatusSchema.default('active'),
    focused: z.boolean().default(false),
    objective: z.string().trim().min(1).max(2_000),
    next: z.string().trim().max(500).optional(),
    inputs: z.array(GoalRefSchema).max(20).default([]),
    outputs: z.array(GoalRefSchema).max(20).default([]),
    triggers: z.array(GoalTriggerSchema).max(10).default([]),
    policy: GoalPolicySchema.default({}),
    botId: z.string().trim().max(80).optional(),
    strategy: z.string().trim().max(80).optional(),
    source: z.enum(['human', 'model']).default('model'),
    version: z.number().int().min(1).default(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
});

export const GoalHistoryEntrySchema = z.object({
    at: z.string().min(1),
    by: z.enum(['model', 'human', 'system']),
    summary: z.string().trim().min(1).max(300),
    version: z.number().int().min(1),
    previous: GoalSnapshotSchema,
});

export const GoalSchema = GoalSnapshotSchema.extend({
    history: z.array(GoalHistoryEntrySchema).max(20).default([]),
});

export type GoalStatus = z.infer<typeof GoalStatusSchema>;
export type GoalRef = z.infer<typeof GoalRefSchema>;
export type GoalTrigger = z.infer<typeof GoalTriggerSchema>;
export type GoalPolicy = z.infer<typeof GoalPolicySchema>;
export type GoalSnapshot = z.infer<typeof GoalSnapshotSchema>;
export type GoalHistoryEntry = z.infer<typeof GoalHistoryEntrySchema>;
export type Goal = z.infer<typeof GoalSchema>;

/** What the model may create. Slug is derived when omitted. */
export const GoalCreateSchema = z.object({
    title: z.string().trim().min(1).max(120),
    objective: z.string().trim().min(1).max(2_000),
    status: GoalStatusSchema.default('active'),
    next: z.string().trim().max(500).optional(),
    inputs: z.array(GoalRefSchema).max(20).default([]),
    outputs: z.array(GoalRefSchema).max(20).default([]),
    triggers: z.array(GoalTriggerSchema).max(10).default([]),
    policy: GoalPolicySchema.default({}),
    botId: z.string().trim().max(80).optional(),
    strategy: z.string().trim().max(80).optional(),
    focused: z.boolean().default(false),
});

/** A patch never contains `history`, `version`, timestamps or `source`; those
 *  are the store's, not the caller's. */
export const GoalPatchSchema = GoalCreateSchema.partial().omit({ focused: true }).extend({
    focused: z.boolean().optional(),
});

export type GoalCreate = z.infer<typeof GoalCreateSchema>;
export type GoalPatch = z.infer<typeof GoalPatchSchema>;
