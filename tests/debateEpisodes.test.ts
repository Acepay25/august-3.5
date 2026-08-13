import { describe, expect, it } from 'vitest';
import { compactDebateEpisode } from '../utils/debateEpisodes';

describe('compactDebateEpisode', () => {
    it('turns a labeled plan into a short handoff, not the raw dump', () => {
        const text = `**FINAL TRADE PLAN**
- **Direction:** Long
- **Confidence:** Medium
- **Probability:** 62%
- **Entry:** 63710
- **Stop Loss:** 64510
- **Take Profit 1:** 63210
- **Invalidation:** 15m close above sweep high

The 15m swept lows and reclaimed VWAP. I would not fade this without a 1H close.`;
        const episode = compactDebateEpisode('Macro', 1, text);
        expect(episode).toContain('(R1 episode)');
        expect(episode).toContain('Long');
        expect(episode).toContain('63710');
        expect(episode.length).toBeLessThan(text.length);
        expect(episode).not.toContain('**FINAL TRADE PLAN**');
    });

    it('keeps moderator questions readable', () => {
        const episode = compactDebateEpisode('Moderator', 4, '**Macro:** What is the 1H invalidation?\n**Risk:** Is R:R above 1.5?');
        expect(episode).toContain('Moderator');
        expect(episode).toContain('invalidation');
    });
});
