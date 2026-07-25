import React from 'react';
import { SettingsIcon, PlusIcon } from './Icons';

/**
 * OnboardingCard — first-run setup guidance.
 *
 * P2-12: New users with no API keys configured previously landed on an empty
 * chat with no guidance. This card detects the no-keys state and shows a
 * guided CTA to open Settings. It dismisses itself when keys become available
 * or when the user explicitly closes it (dismissal is remembered in
 * localStorage so it doesn't nag).
 */

interface OnboardingCardProps {
    hasAnyApiKey: boolean;
    onOpenSettings: () => void;
}

const DISMISSAL_KEY = 'august_onboarding_dismissed';

export const OnboardingCard: React.FC<OnboardingCardProps> = ({ hasAnyApiKey, onOpenSettings }) => {
    const [dismissed, setDismissed] = React.useState<boolean>(() => {
        try {
            return localStorage.getItem(DISMISSAL_KEY) === 'true';
        } catch {
            return false;
        }
    });

    // Auto-dismiss once keys are configured (no localStorage write needed —
    // the card just stops rendering).
    if (hasAnyApiKey || dismissed) return null;

    const handleDismiss = () => {
        try {
            localStorage.setItem(DISMISSAL_KEY, 'true');
        } catch { /* storage may be unavailable */ }
        setDismissed(true);
    };

    return (
        <div className="mx-auto w-full max-w-2xl my-6 rounded-2xl border border-cyan-500/30 bg-cyan-500/5 p-5 sm:p-6">
            <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                    <SettingsIcon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                    <h2 className="text-base font-semibold text-zinc-100">Welcome to August 3.5</h2>
                    <p className="mt-1 text-sm text-zinc-400 leading-relaxed">
                        To start analyzing charts, add at least one AI provider API key.
                        Open <span className="font-medium text-zinc-200">Settings → AI Models</span> and paste your key (Gemini, OpenAI, DeepSeek, Groq, Zhipu, or OpenRouter).
                    </p>
                    <div className="mt-4 flex items-center gap-3">
                        <button
                            onClick={onOpenSettings}
                            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white transition-colors"
                        >
                            <SettingsIcon className="h-4 w-4" />
                            Add API Key
                        </button>
                        <button
                            onClick={handleDismiss}
                            className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-white/5 transition-colors"
                        >
                            Maybe later
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
