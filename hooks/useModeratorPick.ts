import { useCallback } from 'react';
import { saveLastModeratorPick } from '../services/infrastructure/moderatorPick';

export interface UseModeratorPickArgs {
    setConversationModeratorProvider: (providerId: string) => void;
    setConversationModeratorModel: (model: string) => void;
    moderatorProviderId: string;
    moderatorModel: string;
}

/** The two moderator handlers that survived useLensAndEnsembleConfig's removal.
 *  Both persist the pick so the next session and the scheduler start from it. */
export const useModeratorPick = (args: UseModeratorPickArgs) => {
    const {
        setConversationModeratorProvider, setConversationModeratorModel,
        moderatorProviderId, moderatorModel,
    } = args;

    const handleSetModeratorProvider = useCallback((providerId: string) => {
        setConversationModeratorProvider(providerId);
        saveLastModeratorPick({ providerId, model: moderatorModel || '' });
    }, [setConversationModeratorProvider, moderatorModel]);

    const handleSetModeratorModel = useCallback((model: string) => {
        setConversationModeratorModel(model);
        if (moderatorProviderId) saveLastModeratorPick({ providerId: moderatorProviderId, model });
    }, [setConversationModeratorModel, moderatorProviderId]);

    return { handleSetModeratorProvider, handleSetModeratorModel };
};
