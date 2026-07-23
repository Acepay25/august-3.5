/**
 * fix-imports.js — Updates all relative import paths after file reorganization.
 * Run: node scripts/fix-imports.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Build mapping: old path (relative to root, no ext) -> new path
const moves = {};

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
    moves['services/' + f] = 'services/' + folder + '/' + f;
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
    moves['components/' + f] = 'components/' + folder + '/' + f;
  }
}

// Find all ts/tsx files
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
  const fileRelDir = path.relative(ROOT, fileDir).split(path.sep).join('/');
  let modified = false;

  // Match import/from with relative paths
  const importRegex = /(from\s+['"])(\.\.?\/[^'"]+)(['"])/g;

  content = content.replace(importRegex, (match, prefix, importPath, suffix) => {
    // Resolve the imported path relative to the file's directory (relative to root)
    const resolvedNorm = path.normalize(path.join(fileRelDir, importPath)).split(path.sep).join('/');

    // Check against each moved file
    for (const [oldPath, newPath] of Object.entries(moves)) {
      // Match exact or with extension
      if (resolvedNorm === oldPath || resolvedNorm.startsWith(oldPath + '/')) {
        // Compute new relative path from the file's directory to the new location
        let newRelPath = path.relative(fileDir, path.join(ROOT, newPath)).split(path.sep).join('/');
        if (!newRelPath.startsWith('.')) newRelPath = './' + newRelPath;

        // If the original import had a sub-path beyond the module (e.g., accuracy/geminiAccuracyService)
        const oldParts = oldPath.split('/');
        const resolvedParts = resolvedNorm.split('/');
        if (resolvedParts.length > oldParts.length) {
          const subPath = resolvedParts.slice(oldParts.length).join('/');
          newRelPath = newRelPath + '/' + subPath;
        }

        modified = true;
        totalUpdates++;
        return prefix + newRelPath + suffix;
      }
    }
    return match;
  });

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    filesModified++;
  }
}

console.log(`Updated ${totalUpdates} import paths in ${filesModified} files (scanned ${files.length} files)`);
