/**
 * AnalysisProgress — Composable wrapper panel for the analysis pipeline.
 * Renders each pipeline step as a collapsible Task block during execution,
 * then collapses into a summary bar on completion.
 *
 * Hosts Task blocks today; designed to compose additional block types
 * (e.g., search results) alongside them in the future.
 */

import React, { useMemo } from 'react';
import { AnalysisStep, AnalysisStepStatus } from '../../types';
import { runStatusPresentation, stepErrorLabel } from '../../utils/runStatus';
import { Task, TaskTrigger, TaskContent, TaskItem, TaskItemFile } from '../ui/task';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible';
import {
  ChevronDownIcon,
  LoadingIcon,
  CheckIcon,
  CloseIcon,
  CircleIcon,
  EyeIcon,
  SkipIcon,
} from '../shared/Icons';

// ─── Status Icon ────────────────────────────────────────────────────────────
// Colour comes from the ONE status vocabulary in utils/runStatus, and the word
// is always available alongside it: a step is never identified by hue alone,
// and a user-initiated Stop is not drawn in failure colours.

const StepStatusIcon: React.FC<{ status: AnalysisStepStatus; isPostMortem?: boolean }> = ({
  status,
  isPostMortem,
}) => {
  const { text } = runStatusPresentation(status);
  // A post-mortem row is not the run itself, so its spinner keeps neutral
  // chrome rather than the run's accent colour.
  const running = isPostMortem ? 'text-zinc-300' : text;

  switch (status) {
    case 'running':
      return <LoadingIcon className={`size-4 ${running}`} />;
    case 'complete':
      return <CheckIcon className={`size-4 ${text}`} />;
    case 'error':
      return <CloseIcon className={`size-4 ${text}`} />;
    case 'stopped':
      return <SkipIcon className={`size-4 ${text}`} />;
    default:
      return <CircleIcon className={`size-3 ${text}`} />;
  }
};

// ─── Single Task Block ──────────────────────────────────────────────────────

const StepTaskBlock: React.FC<{ step: AnalysisStep; isPostMortem?: boolean }> = ({
  step,
  isPostMortem,
}) => {
  const isRunning = step.status === 'running';
  const hasSubSteps = step.subSteps && step.subSteps.length > 0;
  const failed = step.status === 'error' || step.status === 'stopped';
  const presentation = runStatusPresentation(step.status);
  // A failed step must open on its own even with no sub-steps — the reason is
  // the only content it has and the one thing the user needs. `failed`, not
  // `status === 'error'`: a stopped step carries an errorText too
  // (`useAnalysisPipeline.ts:594`) and the user who pressed Stop is exactly the
  // person who wants to know what it had already got.
  const showContent = hasSubSteps || (failed && Boolean(step.errorText));

  return (
    <Task defaultOpen={isRunning || showContent}>
      <TaskTrigger title="">
        <div className="flex items-center gap-2 cursor-pointer group/trigger py-1">
          <StepStatusIcon status={step.status} isPostMortem={isPostMortem} />
          <span className={`text-sm transition-colors ${presentation.text}`}>
            {step.title}
          </span>
          {failed && (
            // Word beside the colour, never colour alone. A Stop is labelled by
            // its STATUS; only an error consults errorKind — otherwise a
            // cancelled step would inherit the 'unknown' → 'Failed' fallback.
            <span className={`text-ui-xs uppercase tracking-wide ${presentation.text}`}>
              {step.status === 'stopped' ? presentation.label : stepErrorLabel(step.errorKind)}
            </span>
          )}
          {step.endTime && step.startTime && (
            <span className="text-ui-xs font-mono text-zinc-600 ml-auto mr-1">
              {((step.endTime - step.startTime) / 1000).toFixed(1)}s
            </span>
          )}
          {hasSubSteps && (
            <ChevronDownIcon className="size-3.5 text-zinc-600 transition-transform duration-[150ms] ease-[var(--ease-snappy)] group-data-[state=open]/trigger:rotate-180" />
          )}
        </div>
      </TaskTrigger>

      {showContent && (
        <TaskContent>
          {step.errorText && (
            <TaskItem className="flex items-start gap-2 text-ui-sm">
              {/* Coloured by the status, not hardcoded rose: a Stop is not a
                  loss, and `runStatus` owns that distinction. */}
              <span className={presentation.text} role="status">
                {step.errorText}
              </span>
            </TaskItem>
          )}
          {step.subSteps?.map((sub, idx) => (
            <TaskItem key={idx} className="flex items-center gap-2 text-xs">
              <span className="text-zinc-500">{sub.label}</span>
              {sub.detail && <span className="text-zinc-600 truncate">{sub.detail}</span>}
              {sub.filename && (
                <TaskItemFile className="ml-auto flex-shrink-0">
                  {sub.filename.split(/[/\\]/).pop()}
                </TaskItemFile>
              )}
            </TaskItem>
          ))}
        </TaskContent>
      )}
    </Task>
  );
};

// ─── Completion Summary Bar (Section 9) ─────────────────────────────────────

const CompletionSummaryBar: React.FC<{
  steps: AnalysisStep[];
  totalElapsed: number;
  isPostMortem?: boolean;
  children: React.ReactNode;
}> = ({ steps, totalElapsed, isPostMortem, children }) => {
  const summary = useMemo(() => {
    const parts: string[] = [];
    const analysisStep = steps.find((s) => s.id === 'analysis');
    if (analysisStep?.subSteps) {
      const count = analysisStep.subSteps.length;
      parts.push(`${count} provider${count !== 1 ? 's' : ''}`);
    }
    if (steps.some((s) => s.id === 'gate-scan' && s.status === 'complete')) {
      parts.push('1 gate scan');
    }
    if (steps.some((s) => s.id === 'market-data' && s.status === 'complete')) {
      parts.push('1 market fetch');
    }
    if (steps.some((s) => s.id === 'debate' && s.status === 'complete')) {
      parts.push('1 debate');
    }
    if (steps.some((s) => s.id === 'validation' && s.status === 'complete')) {
      parts.push('1 validation');
    }
    return parts.length > 0 ? parts.join(', ') : 'analysis complete';
  }, [steps]);

  // The header used to read "Task completed" unconditionally and stay
  // collapsed — so a run that failed halfway told the user it had succeeded
  // and hid the reason behind a chevron. Outcome and open-ness now follow the
  // steps, and a failure opens itself.
  const outcome = useMemo(() => {
    const errored = steps.filter(s => s.status === 'error').length;
    const stopped = steps.filter(s => s.status === 'stopped').length;
    if (errored > 0) {
      const firstFailed = steps.find(s => s.status === 'error');
      return {
        title: isPostMortem ? 'Post-Mortem failed' : 'Task failed',
        detail: `${firstFailed?.title ?? 'A step'}: ${stepErrorLabel(firstFailed?.errorKind).toLowerCase()}`,
        open: true,
        text: 'text-rose-300' as const,
      };
    }
    if (stopped > 0) {
      const firstStopped = steps.find(s => s.status === 'stopped');
      return {
        title: isPostMortem ? 'Post-Mortem stopped' : 'Task stopped',
        // For a stop the whole ladder stays collapsed, so this line is the only
        // thing a user reads without reaching for a chevron — and "what had it
        // already got" is exactly the question pressing Stop raises.
        detail: firstStopped?.errorText || 'You ended this run',
        open: false,
        text: 'text-zinc-300' as const,
      };
    }
    return {
      title: isPostMortem ? 'Post-Mortem completed' : 'Task completed',
      detail: summary,
      open: false,
      text: 'text-zinc-200' as const,
    };
  }, [steps, summary, isPostMortem]);

  const accent = 'border-white/10';

  return (
    <Collapsible defaultOpen={outcome.open}>
      <CollapsibleTrigger asChild>
        <button className="group w-full flex items-center gap-2 py-2 px-1 cursor-pointer rounded-lg hover:bg-zinc-800 transition-colors">
          <ChevronDownIcon className="size-4 text-zinc-500 transition-transform duration-[150ms] ease-[var(--ease-snappy)] group-data-[state=open]:rotate-180" />
          <span className={`text-sm font-bold ${outcome.text}`}>
            {outcome.title}
          </span>
          <span className="text-xs text-zinc-500">{outcome.detail}</span>
          <span className="ml-auto text-xs font-mono text-zinc-600">
            {(totalElapsed / 1000).toFixed(0)}s
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className={`mt-2 border-t ${accent} pt-2`}>{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
};

// ─── Main Component ─────────────────────────────────────────────────────────

interface AnalysisProgressProps {
  steps: AnalysisStep[];
  isActive: boolean;
  onCancel: () => void;
  /** Render inside a parent surface, such as the desktop activity rail. */
  embedded?: boolean;
  isPostMortem?: boolean;
  isPostMortemInProgress?: boolean;
  onOpenPostMortem?: () => void;
}

const AnalysisProgress: React.FC<AnalysisProgressProps> = ({
  steps,
  isActive,
  onCancel,
  embedded = false,
  isPostMortem,
  isPostMortemInProgress,
  onOpenPostMortem,
}) => {
  const totalElapsed = useMemo(() => {
    const starts = steps.map((s) => s.startTime).filter(Boolean) as number[];
    const ends = steps.map((s) => s.endTime).filter(Boolean) as number[];
    if (starts.length === 0) return 0;
    const earliest = Math.min(...starts);
    const latest = ends.length > 0 ? Math.max(...ends) : Date.now();
    return latest - earliest;
  }, [steps]);

  const visibleSteps = steps.filter((s) => s.status !== 'pending');
  const surfaceClass = embedded
    ? 'animate-fade-in'
    : 'ui-panel p-4 animate-fade-in';

  const taskBlocks = (
    <div className="space-y-1">
      {visibleSteps.map((step) => (
        <StepTaskBlock key={step.id} step={step} isPostMortem={isPostMortem} />
      ))}
    </div>
  );

  return (
    <div className={surfaceClass}>
      {isActive ? (
        <>
          {/* Active: show Task blocks + action buttons */}
          {taskBlocks}

          {/* Action buttons row */}
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-zinc-800">
            {isPostMortemInProgress && onOpenPostMortem && (
              <button
                onClick={onOpenPostMortem}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-white/10 transition-colors"
              >
                <EyeIcon className="size-3.5" />
                View Post-Mortem
              </button>
            )}
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-colors ml-auto"
            >
              <SkipIcon className="size-3.5" />
              Stop generating
            </button>
          </div>
        </>
      ) : (
        /* Completed: collapsed summary bar */
        <CompletionSummaryBar
          steps={steps}
          totalElapsed={totalElapsed}
          isPostMortem={isPostMortem}
        >
          {taskBlocks}
        </CompletionSummaryBar>
      )}
    </div>
  );
};

export default React.memo(AnalysisProgress);
