# Debate Audit TODO

## Part A: Read all debate-related files
- [ ] services/ui/EnhancedDebateService.ts
- [ ] services/ui/EnsembleAnalystService.ts
- [ ] services/providers/ensembleService.ts
- [ ] services/providers/GenericProviderService.ts
- [ ] services/providers/GenericAnalysisService.ts
- [ ] components/analysis/DebateChat.tsx
- [ ] components/analysis/DebateSummary.tsx
- [ ] components/analysis/EnsembleProgressChat.tsx
- [ ] components/analysis/AnalysisProgress.tsx
- [ ] components/analysis/AnalysisResult.tsx
- [ ] components/analysis/ThinkingModal.tsx
- [ ] hooks/useAnalysisPipeline.ts
- [ ] tests/debateFlow.test.ts
- [ ] constants/prompts.ts + constants/prompts/debatePrompts.ts
- [ ] constants/prompts/analysisPrompts.ts
- [ ] schemas/tradeAnalysis.ts
- [ ] types/analysis.ts + types/message.ts + types/progress.ts
- [ ] services/ui/AnalystLensService.ts
- [ ] components/settings/AnalystLensSettings.tsx
- [ ] services/validation/ConfidenceCalibrationService.ts
- [ ] services/learning/* (PatternMemory, RuleEngine) for debate feedback loop

## Part A: Analyze
- [ ] Stages
- [ ] Speaker ordering & mid-debate intervention
- [ ] Consensus computation
- [ ] Partial failure handling
- [ ] Streaming vs batch
- [ ] Final summary schema binding
- [ ] Replay/branch/redo
- [ ] Calibration
- [ ] Learning loop integration
- [ ] Feel/transcript/chat/panel/flow

## Part B: 5-10 feature proposals
- Across categories

## Output
- Part A bullets with severity + fix
- Part B features with touch points + risk
- Top-3 if I had 1 month
