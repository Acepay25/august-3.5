// Analysis pipeline progress types - Task UI step tracking

export type AnalysisStepStatus = 'pending' | 'running' | 'complete' | 'error';

export interface AnalysisSubStep {
  label: string;
  detail?: string;
  filename?: string;  // Rendered via TaskItemFile (basename only)
}

export interface AnalysisStep {
  id: string;
  title: string;
  status: AnalysisStepStatus;
  subSteps?: AnalysisSubStep[];
  startTime?: number;
  endTime?: number;
}
