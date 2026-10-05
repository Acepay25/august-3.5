// TAB: Analysis — accuracy/hybrid modes, desk stillness, seat mapping and the
// advanced capture switches (SettingsMenu "TAB 2").
//
// Moved verbatim from the inline body. `deskToolsEnabled`, `idleMotionEnabled`
// and `isAdvancedOpen` are the parent's state, passed under their local names —
// they must stay in SettingsMenu so a choice survives leaving and re-entering
// the tab. The service setter `setIdleMotionEnabled` is imported here because
// only this body writes through it.
import React from 'react';
import { Activity, ChevronDown, Layers, ShieldCheck, Users, Wrench } from '../../shared/Icons';
import { ToggleSwitch } from '../../shared/ToggleSwitch';
import DeskSeatMappingEditor from '../DeskSeatMappingEditor';
import { SegmentedControl, SettingsGroup, SettingsPageHeader, SettingsRow } from './shared';
import { setIdleMotionEnabled } from '../../../services/desk/idleMotion';
import { saveHarnessSettings } from '../../../utils/harnessSettings';
import type { AccuracySubMode } from '../../../types';
import type { SettingsTabProps } from './types';

export interface GeneralTabProps extends SettingsTabProps {
    // Accuracy Mode
    isAccuracyModeEnabled: boolean;
    onToggleAccuracyMode: () => void;
    // Team (ensemble) analysis — the command palette used to carry this
    // toggle; stage 3 moved it here, beside the other analysis-mode dials.
    isEnsembleEnabled?: boolean;
    onToggleEnsemble?: () => void;
    accuracySubMode: AccuracySubMode;
    setAccuracySubMode?: (subMode: AccuracySubMode) => void;
    // Hybrid & Capturing
    isHybridIntelligenceEnabled: boolean;
    onToggleHybridIntelligence?: () => void;
    setIsHybridIntelligenceEnabled?: (enabled: boolean) => void;
    isAutoCapturing?: boolean;
    onToggleAutoCapturing?: () => void;
    isUpdateAutoCapturing?: boolean;
    onToggleUpdateAutoCapturing?: () => void;
    isEntryNotHitCapturing?: boolean;
    onToggleEntryNotHitCapturing?: () => void;
    // Parent-local state, passed down (see header comment).
    deskToolsEnabled: boolean;
    setDeskToolsEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    idleMotionEnabled: boolean;
    isAdvancedOpen: boolean;
    setIsAdvancedOpen: React.Dispatch<React.SetStateAction<boolean>>;
    // Pure AI options
    isPlaybookEnabledInPureAI?: boolean;
    setIsPlaybookEnabledInPureAI?: (enabled: boolean) => void;
    isFamiliesEnabledInPureAI?: boolean;
    setIsFamiliesEnabledInPureAI?: (enabled: boolean) => void;
    isMemoryEnabledInPureAI?: boolean;
    setIsMemoryEnabledInPureAI?: (enabled: boolean) => void;
}

const GeneralTab: React.FC<{ tab: GeneralTabProps }> = ({ tab: props }) => {
    const {
        isAccuracyModeEnabled,
        onToggleAccuracyMode,
        isEnsembleEnabled,
        onToggleEnsemble,
        accuracySubMode,
        setAccuracySubMode,
        isHybridIntelligenceEnabled,
        onToggleHybridIntelligence,
        deskToolsEnabled,
        setDeskToolsEnabled,
        idleMotionEnabled,
        isAdvancedOpen,
        setIsAdvancedOpen,
        isPlaybookEnabledInPureAI,
        setIsPlaybookEnabledInPureAI,
        isFamiliesEnabledInPureAI,
        setIsFamiliesEnabledInPureAI,
        isMemoryEnabledInPureAI,
        setIsMemoryEnabledInPureAI,
        isAutoCapturing,
        onToggleAutoCapturing,
        isUpdateAutoCapturing,
        onToggleUpdateAutoCapturing,
        isEntryNotHitCapturing,
        onToggleEntryNotHitCapturing,
    } = props;

    return (
        <div className="space-y-5 animate-fade-in">
            <SettingsPageHeader
                title="Analysis"
                description="How the harness thinks, what it is allowed to call, and how still the desk sits."
            />

            <SettingsGroup title="Analysis modes">
                {isEnsembleEnabled !== undefined && onToggleEnsemble && (
                    <SettingsRow
                        icon={<Users className="h-4 w-4" />}
                        title="Team analysis"
                        description={isEnsembleEnabled
                            ? 'On — sends run the analyst ensemble (multi-seat debate) before the verdict.'
                            : 'Off — sends are casual chat: one model, no debate, no desk tools.'}
                        control={<ToggleSwitch checked={isEnsembleEnabled} onChange={onToggleEnsemble} label="Toggle Team analysis" />}
                    />
                )}
                <SettingsRow
                    icon={<ShieldCheck className="h-4 w-4" />}
                    title="Accuracy Mode"
                    description={isAccuracyModeEnabled
                        ? (accuracySubMode === 'original'
                            ? 'On — Strict Protocol: validated multi-step analysis with consensus checks.'
                            : 'On — Pure AI: faster, unfiltered reasoning with fewer formatting checks.')
                        : 'Off — standard speed. Debate runs without the strict validation pass.'}
                    control={<ToggleSwitch checked={isAccuracyModeEnabled} onChange={onToggleAccuracyMode} label="Toggle Accuracy Mode" />}
                />
                {isAccuracyModeEnabled && setAccuracySubMode && (
                    <SettingsRow
                        icon={<Layers className="h-4 w-4" />}
                        title="Strictness"
                        description="Which protocol runs while Accuracy Mode is on."
                        control={
                            <SegmentedControl
                                ariaLabel="Accuracy protocol"
                                value={accuracySubMode}
                                onChange={id => setAccuracySubMode(id as AccuracySubMode)}
                                options={[
                                    { id: 'original', label: 'Strict', title: 'Validated multi-step analysis with consensus checks. Slower but more thorough.' },
                                    { id: 'pure_ai', label: 'Pure AI', title: 'Faster, unfiltered reasoning with fewer formatting checks.' },
                                ]}
                            />
                        }
                    />
                )}
                <SettingsRow
                    icon={<Activity className="h-4 w-4" />}
                    title="Hybrid Intelligence"
                    description="Adds real-time market data (price, RSI, MACD, EMAs) so the models reason over live context."
                    control={
                        <ToggleSwitch checked={isHybridIntelligenceEnabled} onChange={() => {
                            if (onToggleHybridIntelligence) onToggleHybridIntelligence();
                            else if (props.setIsHybridIntelligenceEnabled) props.setIsHybridIntelligenceEnabled(!isHybridIntelligenceEnabled);
                        }} label="Toggle Hybrid Intelligence" />
                    }
                />
            </SettingsGroup>

            <SettingsGroup title="Analyst desk">
                <SettingsRow
                    icon={<Wrench className="h-4 w-4" />}
                    title="Desk Tools"
                    description="Lets analysts and the moderator call live tools anytime — web search, funding/OI, order book, liquidations, BTC context, session timing."
                    control={
                        <ToggleSwitch
                            checked={deskToolsEnabled}
                            onChange={() => {
                                const next = !deskToolsEnabled;
                                setDeskToolsEnabled(next);
                                saveHarnessSettings({ deskToolsEnabled: next });
                            }}
                            label="Toggle Desk Tools"
                        />
                    }
                />
                <SettingsRow
                    icon={<Activity className="h-4 w-4" />}
                    title="Desk idle motion"
                    description="Subtle micro-motion on the pixel seats (breath, cap-tilt, eye-blink while thinking, moderator sway). Turning this off makes the desk perfectly still."
                    control={
                        <ToggleSwitch
                            checked={idleMotionEnabled}
                            onChange={() => setIdleMotionEnabled(!idleMotionEnabled)}
                            label="Toggle desk idle motion"
                        />
                    }
                />
            </SettingsGroup>

            {/* The editor brings its own heading and
                explanation — the card frames it, it
                doesn't restate it. */}
            <SettingsGroup>
                <div className="p-4">
                    <DeskSeatMappingEditor />
                </div>
            </SettingsGroup>

            {/* ADVANCED — fine-tuning; most users never touch these. */}
            <section>
                <button
                    type="button"
                    onClick={() => setIsAdvancedOpen(p => !p)}
                    aria-expanded={isAdvancedOpen}
                    className="flex w-full items-center justify-between gap-4 rounded-2xl border border-white/[0.07] bg-zinc-900/50 px-4 py-3 text-left transition-colors hover:bg-zinc-800/40"
                >
                    <span className="min-w-0">
                        <span className="block text-ui-caption font-semibold text-zinc-200">Advanced</span>
                        <span className="mt-0.5 block text-ui-dense text-zinc-500">Context injection and capture prompts — most users can leave these as-is.</span>
                    </span>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-150 ease-[var(--ease-snappy)] ${isAdvancedOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
                {isAdvancedOpen && (
                    <div className="mt-3 space-y-3 animate-fade-in">
                        {isAccuracyModeEnabled && accuracySubMode === 'pure_ai' && (setIsPlaybookEnabledInPureAI || setIsFamiliesEnabledInPureAI || setIsMemoryEnabledInPureAI) && (
                            <SettingsGroup title="Pure AI context" description="Structured context injected during Pure AI analysis. All default: off.">
                                {setIsPlaybookEnabledInPureAI && (
                                    <SettingsRow
                                        title="Strategy Playbook"
                                        description="The uploaded strategy books."
                                        control={<ToggleSwitch checked={!!isPlaybookEnabledInPureAI} onChange={() => setIsPlaybookEnabledInPureAI(!isPlaybookEnabledInPureAI)} label="Toggle Strategy Playbook in Pure AI" />}
                                    />
                                )}
                                {setIsFamiliesEnabledInPureAI && (
                                    <SettingsRow
                                        title="Pattern Families"
                                        description="Learned pattern-family classifications."
                                        control={<ToggleSwitch checked={!!isFamiliesEnabledInPureAI} onChange={() => setIsFamiliesEnabledInPureAI(!isFamiliesEnabledInPureAI)} label="Toggle Pattern Families in Pure AI" />}
                                    />
                                )}
                                {setIsMemoryEnabledInPureAI && (
                                    <SettingsRow
                                        title="Historical Memory"
                                        description="Past-trade lessons from the notebook."
                                        control={<ToggleSwitch checked={!!isMemoryEnabledInPureAI} onChange={() => setIsMemoryEnabledInPureAI(!isMemoryEnabledInPureAI)} label="Toggle Historical Memory in Pure AI" />}
                                    />
                                )}
                            </SettingsGroup>
                        )}

                        {onToggleAutoCapturing && (
                            <SettingsGroup title="Automated capture prompts" description="When to ask for trade results automatically. All default: off.">
                                <SettingsRow
                                    title="Post-trade result capture"
                                    description="Ask for the outcome after a trade settles."
                                    control={<ToggleSwitch checked={!!isAutoCapturing} onChange={onToggleAutoCapturing} label="Toggle post-trade result capture" />}
                                />
                                {onToggleUpdateAutoCapturing && (
                                    <SettingsRow
                                        title="Active trade updates"
                                        description="Ask to refresh an open position's status."
                                        control={<ToggleSwitch checked={!!isUpdateAutoCapturing} onChange={onToggleUpdateAutoCapturing} label="Toggle active trade update capture" />}
                                    />
                                )}
                                {onToggleEntryNotHitCapturing && (
                                    <SettingsRow
                                        title="Entry not hit"
                                        description="Ask what happened when price never reached the entry."
                                        control={<ToggleSwitch checked={!!isEntryNotHitCapturing} onChange={onToggleEntryNotHitCapturing} label="Toggle entry not hit capture" />}
                                    />
                                )}
                            </SettingsGroup>
                        )}
                    </div>
                )}
            </section>
        </div>
    );
};

export default GeneralTab;
