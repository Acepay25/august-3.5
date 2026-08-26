import { DebateTurn } from '../../types/message';
import { sendChatRequest } from '../providers/GenericProviderService';
import { resolveMemoryConfig } from './MemoryModelService';
import { listSkills, serializeSkill, titleFromMeta, parseSkillMarkdown, SkillMeta } from './SkillMemoryService';
import { createMemoryFile, updateMemoryFile, getMemoryFiles, slugifyName } from './MemoryFilesService';

interface SkillProposal {
    action: 'create' | 'update' | 'none';
    kind?: 'avoid' | 'repeat';
    ifCondition?: string;
    thenAction?: string;
    body?: string;
    target?: string;
}

const parseProposal = (raw: string): SkillProposal | null => {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
        const p = JSON.parse(m[0]) as SkillProposal;
        if (p.action !== 'create' && p.action !== 'update' && p.action !== 'none') return null;
        return p;
    } catch {
        return null;
    }
};

/**
 * After a debate concludes, EACH debater (analysts and moderator)
 * reviews their own transcript and proposes a skill create/update. The
 * Memory Model runs the pass; creations land as CANDIDATE skills and updates
 * append a proposed-update note to the target skill — the trader confirms or
 * edits them in Settings → Skills. Best-effort: failures never surface into
 * the verdict path.
 */
export const proposeSkillsFromDebate = async (username: string, turns: DebateTurn[]): Promise<number> => {
    try {
        if (turns.length === 0) return 0;
        const config = await resolveMemoryConfig(username);
        if (!config || !config.apiKey?.trim()) return 0;
        const speakers = [...new Set(turns.map(t => t.speaker).filter(s => s && s !== 'System'))];
        let written = 0;
        for (const speaker of speakers) {
            const own = turns
                .filter(t => t.speaker === speaker)
                .map(t => t.text)
                .join('\n---\n')
                .slice(0, 3500);
            if (!own.trim()) continue;
            const existing = listSkills().map(({ file }) => file.name.replace(/\.md$/i, '')).slice(0, 40);
            const raw = await sendChatRequest(config, [
                {
                    role: 'system',
                    content: 'You are the memory librarian for a trading desk. Answer with ONE JSON object only, no prose.',
                },
                {
                    role: 'user',
                    content: [
                        `Speaker "${speaker}" just finished a trade debate. Their statements:`,
                        own,
                        '',
                        existing.length > 0 ? `Existing skills: ${existing.join(', ')}` : 'Existing skills: none',
                        '',
                        'If these statements contain a reusable procedure, propose ONE skill action.',
                        'JSON shape: {"action":"create"|"update"|"none","kind":"avoid"|"repeat","ifCondition":"trigger","thenAction":"procedure","body":"one short paragraph","target":"existing skill name (update only)"}',
                    ].join('\n'),
                },
            ]);
            const proposal = parseProposal(raw ?? '');
            if (!proposal || proposal.action === 'none') continue;
            if (proposal.action === 'create') {
                const meta: SkillMeta = {
                    status: 'candidate',
                    kind: proposal.kind === 'repeat' ? 'repeat' : 'avoid',
                    wins: 0,
                    losses: 0,
                    consecutiveLosses: 0,
                    tradeIds: [],
                    ifCondition: proposal.ifCondition,
                    thenAction: proposal.thenAction,
                    body: proposal.body || `Proposed by ${speaker} after a debate.`,
                };
                const folder = getMemoryFiles().folders.find(f => f.name === 'skills');
                if (!folder) continue;
                const slug = slugifyName(`${speaker}-${proposal.ifCondition || proposal.body || 'skill'}`.slice(0, 48));
                const taken = getMemoryFiles().files.some(f => f.folderId === folder.id && f.name === `${slug}.md`);
                if (taken) continue;
                await createMemoryFile(folder.id, `${slug}.md`, serializeSkill(meta, titleFromMeta(meta)), username);
                written += 1;
            } else if (proposal.action === 'update' && proposal.target) {
                const targetName = proposal.target.trim().toLowerCase();
                const file = getMemoryFiles().files.find(f =>
                    f.name.replace(/\.md$/i, '').toLowerCase() === targetName
                    && parseSkillMarkdown(f.content) !== null,
                );
                if (!file) continue;
                const note = `\n\n## Proposed update (${new Date().toISOString().slice(0, 10)} · ${speaker})\n${proposal.body || proposal.thenAction || ''}\n`;
                await updateMemoryFile(file.id, { content: `${file.content}${note}` }, username);
                written += 1;
            }
        }
        if (written > 0) console.log('[DebateSkills] proposals written:', written);
        return written;
    } catch (e) {
        console.warn('[DebateSkills] proposal pass failed:', e instanceof Error ? e.message : e);
        return 0;
    }
};
