/**
 * Skill deep link — the small live half of what used to be
 * `SkillCitationChips`.
 *
 * Tapping a skill anywhere (the provenance strip, a card) has to open that
 * skill's detail in the Studio. The Studio may not be mounted yet when the tap
 * lands — opening it is what mounts it — so the slug is parked here as well as
 * broadcast, and the Studio consumes it on mount.
 */

let pendingSkillOpen: string | null = null;

/** Open a skill's card. Safe to call whether or not the Studio is mounted. */
export const openSkillCard = (slug: string): void => {
    pendingSkillOpen = slug;
    window.dispatchEvent(new CustomEvent('august:open-skill', { detail: { slug } }));
};

/** Take (and clear) the slug a tap set before the Studio existed. */
export const consumePendingSkillOpen = (): string | null => {
    const v = pendingSkillOpen;
    pendingSkillOpen = null;
    return v;
};
