import { EnsembleAnalystProgress, EnsembleProgress, Message } from '../types';

/** Build Floor seats from a live/legacy debate when ensembleProgress is missing. */
export const debateFloorProgress = (
    message: Pick<Message, 'ensembleProgress' | 'debateTurns' | 'postMortemDebateTurns' | 'modelsUsed' | 'isDebating'>,
): EnsembleProgress | null => {
    if (message.ensembleProgress?.analysts?.length) return message.ensembleProgress;
    const turns = message.debateTurns ?? message.postMortemDebateTurns ?? [];
    const speakers = [...new Set(turns.map(t => t.speaker).filter(s => s && s !== 'Moderator'))];
    const modelEntries = Object.entries(message.modelsUsed ?? {});
    if (speakers.length === 0 && modelEntries.length === 0) return null;

    const names = speakers.length > 0 ? speakers : modelEntries.map(([, model]) => model);
    const analysts: EnsembleAnalystProgress[] = names.map((name, index) => {
        const providerId = modelEntries[index]?.[0] || name;
        const modelId = modelEntries.find(([, model]) => model === name)?.[1] || modelEntries[index]?.[1] || '';
        const speakerTurns = turns.filter(t => t.speaker === name);
        const last = speakerTurns[speakerTurns.length - 1];
        const live = Boolean(message.isDebating && last);
        return {
            key: providerId || `seat-${index}`,
            providerId,
            providerName: name,
            modelId,
            modelName: modelId,
            displayName: name,
            status: live ? 'analyzing' : last ? 'complete' : 'waiting',
            finalOutput: speakerTurns.find(t => (t.round ?? 1) === 1)?.text || last?.text,
            reasoning: last?.reasoning,
        };
    });

    const modTurns = turns.filter(t => t.speaker === 'Moderator');
    return {
        analysts,
        moderator: {
            status: message.isDebating && modTurns.length > 0 ? 'reviewing' : 'waiting',
        },
    };
};
