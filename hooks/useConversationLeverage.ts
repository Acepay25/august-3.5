import { useCallback, ChangeEvent } from 'react';
import { Conversation, Message, TradeAnalysis } from '../types';
import { recalculateAnalysisMetrics } from '../utils/analysisUtils';

interface UseConversationLeverageArgs {
    leverageInput: string;
    setLeverageInput: (value: string) => void;
    updateActiveConversation: (updater: (conv: Conversation) => Conversation) => void;
}

const applyLeverage = (messages: Message[], val: number): Message[] =>
    messages.map(m => m.analysis
        ? { ...m, analysis: recalculateAnalysisMetrics(m.analysis as TradeAnalysis, val) }
        : m);

/** Session Nx: clamp, persist on the conversation, rewrite ticket percentages.
 *  The dropdown-close callback is gone — the leverage
 *  control lives in the Team menu now and owns its own dismissal. */
export function useConversationLeverage({
    leverageInput,
    setLeverageInput,
    updateActiveConversation,
}: UseConversationLeverageArgs): {
    handleLeverageChange: (e: ChangeEvent<HTMLInputElement>) => void;
    handleLeverageBlur: () => void;
    handlePresetLeverage: (val: number) => void;
} {
    const commit = useCallback((raw: number) => {
        let val = raw;
        if (isNaN(val) || val < 1) val = 1;
        if (val > 125) val = 125;
        setLeverageInput(String(val));
        updateActiveConversation(c => ({
            ...c,
            leverage: val,
            messages: applyLeverage(c.messages, val),
        }));
        return val;
    }, [setLeverageInput, updateActiveConversation]);

    const handleLeverageChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        setLeverageInput(e.target.value);
    }, [setLeverageInput]);

    const handleLeverageBlur = useCallback(() => {
        commit(parseInt(leverageInput, 10));
    }, [commit, leverageInput]);

    const handlePresetLeverage = useCallback((val: number) => {
        commit(val);
    }, [commit]);

    return { handleLeverageChange, handleLeverageBlur, handlePresetLeverage };
}
