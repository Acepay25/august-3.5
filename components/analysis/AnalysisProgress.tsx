/**
 * AnalysisProgress — Composable wrapper panel for the analysis pipeline.
 * Renders each pipeline step as a collapsible Task block during execution,
 * then collapses into a summary bar on completion.
 *
 * Hosts Task blocks today; designed to compose additional block types
 * (e.g., search results) alongside them in the future.
 */

import React, { useMemo } from 'react';
import { AnalysisStep } from '../../../types';
import { Task, TaskTrigger, TaskContent, TaskItem, TaskItemFile } from '../../ui/task';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../../ui/collapsible';
import {
  ChevronDownIcon,
  LoaderIcon,
  CheckIcon,
  XIcon,
  CircleIcon,
  EyeIcon,
  BanIcon,
} from 'lucide-react';

// ─── Status Icon ────────────────────────────────────────────────────────────

const StepStatusIcon: React.FC<{ status: AnalysisStep['status']; isPostMortem?: boolean }> = ({
  status,
  isPostMortem,
}) => {
  const accent = isPostMortem ? 'text-purple-400' : 'text-cyan-400';

  switch (status) {
    case 'running':
      return <LoaderIcon className={`size-4 ${accent} animate-spin`} />;
    case 'complete':
      return <CheckIcon className={`size-4 ${isPostMortem ? 'text-purple-400' : 'text-emerald-400'}`} />;
    case 'error':
      return <XIcon className="size-4 text-rose-400" />;
    default:
      return <CircleIcon className="size-3 text-zinc-600" />;
  }
};

// ─── Single Task Block ──────────────────────────────────────────────────────

const StepTaskBlock: React.FC<{ step: AnalysisStep; isPostMortem?: boolean }> = ({
  step,
  isPostMortem,
}) => {
  const isRunning = step.status === 'running';
  const hasSubSteps = step.subSteps && step.subSteps.length > 0;

  return (
    <Task defaultOpen={isRunning || step.status === 'error'}>
      <TaskTrigger title="">
        <div className="flex items-center gap-2 cursor-pointer group/trigger py-1">
          <StepStatusIcon status={step.status} isPostMortem={isPostMortem} />
          <span
            className={`text-sm transition-colors ${
              step.status === 'running'
                ? isPostMortem
                  ? 'text-purple-300'
                  : 'text-cyan-300'
                : step.status === 'complete'
                  ? 'text-zinc-300'
                  : step.status === 'error'
                    ? 'text-rose-300'
                    : 'text-zinc-500'
            }`}
          >
            {step.title}
          </span>
          {step.endTime && step.startTime && (
            <span className="text-[10px] font-mono text-zinc-600 ml-auto mr-1">
              {((step.endTime - step.startTime) / 1000).toFixed(1)}s
            </span>
          )}
          {hasSubSteps && (
            <ChevronDownIcon className="size-3.5 text-zinc-600 transition-transform duration-200 group-data-[state=open]/trigger:rotate-180" />
          )}
        </div>
      </TaskTrigger>

      {hasSubSteps && (
        <TaskContent>
          {step.subSteps!.map((sub, idx) => (
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

  const accent = isPostMortem ? 'border-purple-500/20' : 'border-cyan-500/20';

  return (
    <Collapsible defaultOpen={false}>
      <CollapsibleTrigger asChild>
        <button className="group w-full flex items-center gap-2 py-2 px-1 cursor-pointer rounded-lg hover:bg-zinc-800/50 transition-colors">
          <ChevronDownIcon className="size-4 text-zinc-500 transition-transform duration-200 group-data-[state=open]:rotate-180" />
          <span className="text-sm font-bold text-zinc-200">
            {isPostMortem ? 'Post-Mortem completed' : 'Task completed'}
          </span>
          <span className="text-xs text-zinc-500">{summary}</span>
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
  isPostMortem?: boolean;
  isAnalysisInProgress?: boolean;
  isPostMortemInProgress?: boolean;
  onOpenLiveView?: () => void;
  onOpenPostMortem?: () => void;
}

const AnalysisProgress: React.FC<AnalysisProgressProps> = ({
  steps,
  isActive,
  onCancel,
  isPostMortem,
  isAnalysisInProgress,
  isPostMortemInProgress,
  onOpenLiveView,
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
  const accentBorder = isPostMortem ? 'border-purple-500/20' : 'border-cyan-500/20';
  const glowColor = isPostMortem
    ? 'shadow-[0_0_50px_-12px_rgba(168,85,247,0.2)]'
    : 'shadow-[0_0_50px_-12px_rgba(34,211,238,0.2)]';

  const taskBlocks = (
    <div className="space-y-1">
      {visibleSteps.map((step) => (
        <StepTaskBlock key={step.id} step={step} isPostMortem={isPostMortem} />
      ))}
    </div>
  );

  return (
    <div
      className={`glass rounded-2xl ${glowColor} border-t ${accentBorder} p-4 animate-fade-in`}
    >
      {isActive ? (
        <>
          {/* Active: show Task blocks + action buttons */}
          {taskBlocks}

          {/* Action buttons row */}
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-zinc-800">
            {isAnalysisInProgress && onOpenLiveView && (
              <button
                onClick={onOpenLiveView}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 transition-colors"
              >
                <EyeIcon className="size-3.5" />
                Live View
              </button>
            )}
            {isPostMortemInProgress && onOpenPostMortem && (
              <button
                onClick={onOpenPostMortem}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 transition-colors"
              >
                <EyeIcon className="size-3.5" />
                View Post-Mortem
              </button>
            )}
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-colors ml-auto"
            >
              <BanIcon className="size-3.5" />
              Cancel
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
