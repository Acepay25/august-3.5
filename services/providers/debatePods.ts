/**
 * Lens pods (Batch 12, plan §9.1) — the structured seat tier ABOVE 5.
 *
 * A 6-10 seat flat floor breaks three engine properties designed for ≤5:
 * addressed routing degenerates (most pairs never address each other), the
 * verdict transcript cap silently truncates mid-argument, and rebuttal cost
 * scales ~linearly. The fix is NOT a bigger flat floor: 6-10 seats collapse
 * into 3 pods (macro / technical / risk), each pod runs ONE compact internal
 * round over its members' openings, and a single pod representative (highest
 * seat trust) carries the pod position + a dissent summary to the floor.
 * The floor rounds then run at effective size 3-5 exactly as today.
 *
 * Every seat still emits its own sealed CONVICTION on the final round — the
 * auction stays seat-level, not pod-level: the moderator seeing all 6-10
 * convictions is the point of the bigger roster.
 *
 * Pure helpers here (assignment, caps, pod-position prompt); the engine
 * composes them into conductRealDebate.
 */

export type PodName = 'macro' | 'technical' | 'risk';

export const POD_NAMES: PodName[] = ['macro', 'technical', 'risk'];

/** Rosters up to this size run the flat floor (today's behavior, unchanged). */
export const POD_TIER_MIN_SEATS = 6;
/** Hard ceiling the Team slots + engine agree on. */
export const MAX_ROSTER_SEATS = 10;

export interface Pod {
    name: PodName;
    /** Seat names (provider display names) in roster order. */
    seats: string[];
    /** The seat carrying the pod position to the floor. */
    representative: string;
}

/**
 * Assign seats to the three pods.
 * - `lensOf` returns the seat's lens role when lenses are ON ('macro' |
 *   'technical' | 'risk' | other role string) — roles map to their pod;
 *   non-pod roles (sentiment) round-robin into the least-populated pod.
 * - Unmarked seats (lenses OFF, or no assignment) fill round-robin in
 *   roster order, always into the least-populated pod first (ties resolve
 *   macro → technical → risk) — deterministic, no randomness.
 */
export const assignPods = (
    seatNames: string[],
    lensOf?: (name: string) => string | undefined,
): Pod[] => {
    const buckets: Record<PodName, string[]> = { macro: [], technical: [], risk: [] };
    const lensToPod = (lens: string | undefined): PodName | null =>
        lens === 'macro' || lens === 'technical' || lens === 'risk' ? lens : null;

    // Pass 1: lens-mapped seats claim their pod.
    const unassigned: string[] = [];
    for (const name of seatNames) {
        const pod = lensToPod(lensOf?.(name));
        if (pod) buckets[pod].push(name);
        else unassigned.push(name);
    }
    // Pass 2: everyone else into the least-populated pod (stable tie order).
    for (const name of unassigned) {
        const least = POD_NAMES.reduce((a, b) => (buckets[b].length < buckets[a].length ? b : a));
        buckets[least].push(name);
    }
    return POD_NAMES.map(name => ({
        name,
        seats: buckets[name],
        representative: buckets[name][0] ?? '',
    })).filter(p => p.seats.length > 0);
};

/**
 * Pick each pod's floor representative by seat-trust score (higher = more
 * trusted; unknown seats score 0 and keep roster order as the tie-break).
 * Mutates nothing — returns new pods.
 */
export const withTrustRepresentatives = (
    pods: Pod[],
    trustOf: (name: string) => number,
): Pod[] => pods.map(p => ({
    ...p,
    representative: [...p.seats].sort((a, b) => trustOf(b) - trustOf(a))[0],
}));

/**
 * Verdict-transcript budget scaling (plan §9.1): the 2400-char total cap was
 * sized for ≤5 seats; at 10 it truncates mid-argument. Per-turn cap stays
 * 100; the total grows 400 chars per seat above 5.
 */
export const scaleTranscriptCap = (base: number, seatCount: number): number =>
    base + 400 * Math.max(0, seatCount - 5);

export const verdictTranscriptCap = (seatCount: number): number =>
    scaleTranscriptCap(2400, seatCount);

/** Pod-internal round budget per seat (chars of output asked for). */
export const POD_ROUND_MAX_CHARS = 600;

/** The pod-internal round prompt: members see ONLY each other's openings. */
export const buildPodRoundPrompt = (
    pod: Pod,
    selfName: string,
    peerOpenings: { name: string; text: string }[],
): string => {
    const peers = pod.seats.filter(n => n !== selfName);
    const peerBlock = peerOpenings.length > 0
        ? peerOpenings.map(o => `**${o.name}:**\n${o.text}`).join('\n\n')
        : '(you are the only seat in this pod — state your position alone)';
    return [
        `**POD ROUND (${pod.name.toUpperCase()} pod — private, floor-invisible):** You are in the ${pod.name} pod with ${peers.length > 0 ? peers.join(', ') : 'no other seat'}.`,
        'Your pod mates\' openings are below. In ONE compact statement (max ' + POD_ROUND_MAX_CHARS + ' chars):',
        '1. State the position your pod should carry to the floor (your own stance, revised if a pod mate convinced you).',
        '2. Name any DISSENT inside the pod explicitly ("Seat X disagrees because…") — the representative must carry it honestly.',
        '3. One line: the single strongest piece of evidence behind the pod position.',
        'Do NOT address the full floor — only your pod sees this.',
        '',
        peerBlock,
    ].join('\n');
};

/**
 * The floor-facing block the representative carries: pod position + dissent
 * summary. Built from the pod round texts at floor-launch time.
 */
export const formatPodPositionBlock = (
    pod: Pod,
    podRoundTexts: Record<string, string>,
): string => {
    const own = podRoundTexts[pod.representative] || '';
    if (pod.seats.length <= 1) return '';
    const mates = pod.seats.filter(n => n !== pod.representative);
    return [
        `**YOUR POD POSITION (${pod.name.toUpperCase()} pod — you carry it to the floor):**`,
        own ? `Your pod round statement:\n${own.slice(0, POD_ROUND_MAX_CHARS)}` : '',
        mates.length > 0
            ? `Pod mates' statements:\n${mates.map(m => `- ${m}: ${(podRoundTexts[m] || '').slice(0, 240)}`).join('\n')}`
            : '',
        'Open your floor turn by stating the pod position in one line, then any dissent your pod asked you to carry.',
    ].filter(Boolean).join('\n');
};
