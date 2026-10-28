/**
 * Run-contract vocabulary.
 *
 * The stage ladder a settled verdict persists on `Message.runContract` lives
 * here as TYPES only, and that is the whole module. The builder that produced a
 * LIVE ladder derived it from the append-only debate run log; the debate engine,
 * the run log and the last caller of that builder are all deleted, so nothing
 * can produce a stage list for a new run. `RunContractPanel` still renders the
 * ladder carried by rows written before that, and keeps reading its state
 * vocabulary from here.
 */

export type RunContractStageState = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface RunContractStage {
    id: string;
    label: string;
    state: RunContractStageState;
    note?: string;
}
