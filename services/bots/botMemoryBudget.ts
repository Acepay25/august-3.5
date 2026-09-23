/**
 * botMemoryBudget — the two numbers that decide how many characters an agent's
 * own notes may occupy in one prompt.
 *
 * A leaf on purpose. These live apart from `BotMemoryService` because that
 * module is `vi.mock`-ed with a PARTIAL factory by five suites (the automations,
 * the mailbox, the craft leg, the worth gate, the chart dock); importing a
 * constant from it makes every one of those mocks throw at import — a missing
 * named export is an error, not `undefined`. A module with two numbers and no
 * imports cannot be mocked wrong.
 */

/** What ONE agent gets when the caller has not said how many are sharing the
 *  allowance — the conservative default. */
export const BOT_MEMORY_PER_AGENT_CHAR_BUDGET = 900;

/** The whole allowance bot memory may take in one prompt. A surface merging a
 *  roster divides this between its agents; a surface answering as one agent
 *  gives it the lot (see `SINGLE_AGENT_MEMORY_BUDGET`).
 *
 *  Kept near the notebook's own opening budget on purpose: bot memory must not
 *  dwarf it. */
export const BOT_MEMORY_TOTAL_CHAR_BUDGET = 1800;
