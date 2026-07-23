/**
 * fix-imports-v2.cjs — Fixes remaining broken imports after file reorganization.
 * Handles cross-subdirectory imports by matching module basenames.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Map: module basename -> new path relative to root (no extension)
const moduleLocations = {};

const serviceMap = {
  providers: ['geminiService','deepseekService','openaiService','groqService','groqNewService','groqAlt2Service','openrouterService','grokNativeService','zhipuService','ensembleService'],
  analysis: ['TechnicalAnalysisService','MarketDataService','HybridIntelligenceService','NumericChartService','AITrendlineService','TimeframeConfluenceService','ScalpDetectionService','EntryTimingService','PatternClassificationService','ProbabilityEngineService','MonteCarloService','CorrelationRiskService'],
  learning: ['SelfLearningService','AdaptiveLearningService','GlobalLearningService','MemoryService','MemoryConsolidationService','AlgorithmicMemoryService','PatternMemorySynthesisService','MistakePatternService','InsightExtractionService','ReinforcementSignalService','LLMRuleExtractionService','RuleEngineService','LearningRulesService','LearningPromptService','UnifiedLearningBuilder','UnderperformerFeedbackService'],
  validation: ['TradeValidationGate','GateKeeperService','AccuracyValidationService','ConfidenceCalibrationService','InvalidationRuleService','DataIntegrityService','ValidationConstants'],
  backtesting: ['BacktestingService','LiveBacktestService','ModelPerformanceService','ScenarioSimulatorService','StopLossOptimizerService'],
  infrastructure: ['SqliteService','dbService','StorageService','SessionService','PreferencesService','BackupService','ExportService','JobQueueService','OfflineQueueService','SchemaGenerator'],
  ui: ['AutoCaptureService','PriceAlertService','TradeShareService','EnhancedDebateService','AnalystLensService','AlgorithmicChatService','AlgorithmicSummaryService','PersonalizedPromptService','TradingStyleDetector']
};

for (const [folder, files] of Object.entries(serviceMap)) {
  for (const f of files) {
    moduleLocations[f] = 'services/' + folder + '/' + f;
  }
}

const compMap = {
  chat: ['ChatArea','ChatInput','MessageItem','QuickActionChips','ConversationHistory'],
  analysis: ['AnalysisResult','AnalysisProgress','DebateView','LiveAnalysisView','LivePostMortemView','ConfluenceScoreIndicator','HybridDataPanel','VisionDataViewer'],
  market: ['LiveMarket','LiveMarketDataView','OKXChart','ProbabilityWidget'],
  journal: ['Journal','TradeLog','LogTradeModal','UpdateTradeModal','SavedAnalyses','PerformanceReview'],
  dashboards: ['WinRateDashboard','ModelPerformanceDashboard','VersionHistoryDashboard','LearningDashboard','AdvancedAnalyticsSidePanel'],
  modals: ['AccuracyModeModal','DataCaptureModal','EntryNotHitCaptureModal','OutcomeMismatchModal','PostTradeUploadModal','SkipTradeModal','ImageViewerModal','ScenarioSimulator'],
  settings: ['Settings','SettingsMenu','AnalystLensSettings','UserProfileManager'],
  shared: ['Header','Icons','Toast','ErrorBoundary','ImagePreview','UpdateNotification','MistakeWarningBanner','StrategySearch','TypingRenderer']
};

for (const [folder, files] of Object.entries(compMap)) {
  for (const f of files) {
    moduleLocations[f] = 'components/' + folder + '/' + f;
  }
}

// Also handle accuracy sub-services
const accuracyFiles = ['geminiAccuracyService','deepseekAccuracyService','openaiAccuracyService','groqAccuracyService','groqNewAccuracyService','groqAlt2AccuracyService','openrouterAccuracyService','zhipuAccuracyService','grokNativeAccuracyService','ensembleAccuracyService'];
for (const f of accuracyFiles) {
  moduleLocations[f] = 'services/providers/accuracy/' + f;
}

function findFiles(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (['node_modules', '.git', 'android', 'dist', 'native_backup', 'dist_electron'].includes(entry.name)) continue;
    if (entry.isDirectory()) results.push(...findFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) results.push(full);
  }
  return results;
}

const files = findFiles(ROOT);
let totalUpdates = 0;
let filesModified = 0;

for (const filePath of files) {
  let content = fs.readFileSync(filePath, 'utf8');
  const fileDir = path.dirname(filePath);
  let modified = false;

  const importRegex = /(from\s+['"])(\.\.?\/[^'"]+)(['"])/g;

  content = content.replace(importRegex, (match, prefix, importPath, suffix) => {
    // Get the basename of the imported module (last path segment, no extension)
    const segments = importPath.split('/');
    const basename = segments[segments.length - 1].replace(/\.(ts|tsx)$/, '');

    // Check if this basename is a moved module
    const newRootPath = moduleLocations[basename];
    if (!newRootPath) return match;

    // Check if the import already points to the correct location
    const resolvedFromRoot = path.normalize(path.join(path.relative(ROOT, fileDir), importPath)).split(path.sep).join('/');
    if (resolvedFromRoot === newRootPath || resolvedFromRoot.startsWith(newRootPath + '/')) {
      return match; // Already correct
    }

    // Handle sub-paths (e.g., ../accuracy/geminiAccuracyService -> basename is geminiAccuracyService)
    // The new path already includes the full location
    let newRelPath = path.relative(fileDir, path.join(ROOT, newRootPath)).split(path.sep).join('/');
    if (!newRelPath.startsWith('.')) newRelPath = './' + newRelPath;

    modified = true;
    totalUpdates++;
    return prefix + newRelPath + suffix;
  });

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    filesModified++;
  }
}

console.log(`Updated ${totalUpdates} import paths in ${filesModified} files (scanned ${files.length} files)`);
