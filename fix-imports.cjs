/**
 * fix-imports.js
 * 
 * Rewrites relative import paths after files were moved into subdirectories.
 * 
 * Strategy:
 * 1. Build a mapping of OLD path -> NEW path for all moved files
 * 2. For each file, determine its OLD directory (where it was before the move)
 * 3. For each relative import, resolve it against the OLD directory to find the target's OLD path
 * 4. Look up the target's NEW path and compute the correct relative path from the file's CURRENT location
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

// ============================================================================
// STEP 1: Define the move mapping (OLD relative path -> NEW relative path)
// All paths are relative to project root, without file extension
// ============================================================================

const moveMap = {};

// --- Services moved to services/providers/ ---
const providerServices = [
  'geminiService', 'deepseekService', 'openaiService', 'groqService',
  'groqNewService', 'groqAlt2Service', 'openrouterService', 'grokNativeService',
  'zhipuService', 'ensembleService'
];
for (const s of providerServices) {
  moveMap[`services/${s}`] = `services/providers/${s}`;
}

// --- Services moved to services/providers/accuracy/ ---
const accuracyServices = [
  'deepseekAccuracyService', 'ensembleAccuracyService', 'geminiAccuracyService',
  'grokNativeAccuracyService', 'groqAccuracyService', 'groqAlt2AccuracyService',
  'groqNewAccuracyService', 'openaiAccuracyService', 'openrouterAccuracyService',
  'zhipuAccuracyService'
];
for (const s of accuracyServices) {
  moveMap[`services/accuracy/${s}`] = `services/providers/accuracy/${s}`;
}

// --- Services moved to services/analysis/ ---
const analysisServices = [
  'TechnicalAnalysisService', 'MarketDataService', 'HybridIntelligenceService',
  'NumericChartService', 'AITrendlineService', 'TimeframeConfluenceService',
  'ScalpDetectionService', 'EntryTimingService', 'PatternClassificationService',
  'ProbabilityEngineService', 'MonteCarloService', 'CorrelationRiskService'
];
for (const s of analysisServices) {
  moveMap[`services/${s}`] = `services/analysis/${s}`;
}

// --- Services moved to services/learning/ ---
const learningServices = [
  'SelfLearningService', 'AdaptiveLearningService', 'GlobalLearningService',
  'MemoryService', 'MemoryConsolidationService', 'AlgorithmicMemoryService',
  'PatternMemorySynthesisService', 'MistakePatternService', 'InsightExtractionService',
  'ReinforcementSignalService', 'LLMRuleExtractionService', 'RuleEngineService',
  'LearningRulesService', 'LearningPromptService', 'UnifiedLearningBuilder',
  'UnderperformerFeedbackService'
];
for (const s of learningServices) {
  moveMap[`services/${s}`] = `services/learning/${s}`;
}

// --- Services moved to services/validation/ ---
const validationServices = [
  'TradeValidationGate', 'GateKeeperService', 'AccuracyValidationService',
  'ConfidenceCalibrationService', 'InvalidationRuleService', 'DataIntegrityService',
  'ValidationConstants'
];
for (const s of validationServices) {
  moveMap[`services/${s}`] = `services/validation/${s}`;
}

// --- Services moved to services/backtesting/ ---
const backtestingServices = [
  'BacktestingService', 'LiveBacktestService', 'ModelPerformanceService',
  'ScenarioSimulatorService', 'StopLossOptimizerService'
];
for (const s of backtestingServices) {
  moveMap[`services/${s}`] = `services/backtesting/${s}`;
}

// --- Services moved to services/infrastructure/ ---
const infraServices = [
  'SqliteService', 'dbService', 'StorageService', 'SessionService',
  'PreferencesService', 'BackupService', 'ExportService', 'JobQueueService',
  'OfflineQueueService', 'SchemaGenerator'
];
for (const s of infraServices) {
  moveMap[`services/${s}`] = `services/infrastructure/${s}`;
}

// --- Services moved to services/ui/ ---
const uiServices = [
  'AutoCaptureService', 'PriceAlertService', 'TradeShareService',
  'EnhancedDebateService', 'AnalystLensService', 'AlgorithmicChatService',
  'AlgorithmicSummaryService', 'PersonalizedPromptService', 'TradingStyleDetector'
];
for (const s of uiServices) {
  moveMap[`services/${s}`] = `services/ui/${s}`;
}

// --- Components moved to components/chat/ ---
const chatComponents = ['ChatArea', 'ChatInput', 'MessageItem', 'QuickActionChips', 'ConversationHistory'];
for (const c of chatComponents) {
  moveMap[`components/${c}`] = `components/chat/${c}`;
}

// --- Components moved to components/analysis/ ---
const analysisComponents = [
  'AnalysisResult', 'AnalysisProgress', 'DebateView', 'LiveAnalysisView',
  'LivePostMortemView', 'ConfluenceScoreIndicator', 'HybridDataPanel', 'VisionDataViewer'
];
for (const c of analysisComponents) {
  moveMap[`components/${c}`] = `components/analysis/${c}`;
}

// --- Components moved to components/market/ ---
const marketComponents = ['LiveMarket', 'LiveMarketDataView', 'OKXChart', 'ProbabilityWidget'];
for (const c of marketComponents) {
  moveMap[`components/${c}`] = `components/market/${c}`;
}

// --- Components moved to components/journal/ ---
const journalComponents = ['Journal', 'TradeLog', 'LogTradeModal', 'UpdateTradeModal', 'SavedAnalyses', 'PerformanceReview'];
for (const c of journalComponents) {
  moveMap[`components/${c}`] = `components/journal/${c}`;
}

// --- Components moved to components/dashboards/ ---
const dashboardComponents = [
  'WinRateDashboard', 'ModelPerformanceDashboard', 'VersionHistoryDashboard',
  'LearningDashboard', 'AdvancedAnalyticsSidePanel'
];
for (const c of dashboardComponents) {
  moveMap[`components/${c}`] = `components/dashboards/${c}`;
}

// --- Components moved to components/modals/ ---
const modalComponents = [
  'AccuracyModeModal', 'DataCaptureModal', 'EntryNotHitCaptureModal',
  'OutcomeMismatchModal', 'PostTradeUploadModal', 'SkipTradeModal',
  'ImageViewerModal', 'ScenarioSimulator'
];
for (const c of modalComponents) {
  moveMap[`components/${c}`] = `components/modals/${c}`;
}

// --- Components moved to components/settings/ ---
const settingsComponents = ['Settings', 'SettingsMenu', 'AnalystLensSettings', 'UserProfileManager'];
for (const c of settingsComponents) {
  moveMap[`components/${c}`] = `components/settings/${c}`;
}

// --- Components moved to components/shared/ ---
const sharedComponents = [
  'Header', 'Icons', 'Toast', 'ErrorBoundary', 'ImagePreview',
  'UpdateNotification', 'MistakeWarningBanner', 'StrategySearch', 'TypingRenderer'
];
for (const c of sharedComponents) {
  moveMap[`components/${c}`] = `components/shared/${c}`;
}

// ============================================================================
// STEP 2: For each CURRENT file path, determine its OLD directory
// ============================================================================

// Reverse mapping: NEW path -> OLD path (for determining where a file used to be)
const reverseMoveMap = {};
for (const [oldPath, newPath] of Object.entries(moveMap)) {
  reverseMoveMap[newPath] = oldPath;
}

/**
 * Given a file's current path (relative to root, with extension),
 * return the directory it used to be in (relative to root).
 */
function getOldDir(currentRelPath) {
  const withoutExt = currentRelPath.replace(/\.(tsx?|ts)$/, '');
  const dir = path.posix.dirname(withoutExt);
  const base = path.posix.basename(withoutExt);
  
  // Check if this file was moved (look up in reverse map)
  const oldFullPath = reverseMoveMap[withoutExt];
  if (oldFullPath) {
    return path.posix.dirname(oldFullPath);
  }
  
  // File wasn't moved - its old dir is the same as current dir
  return dir;
}

/**
 * Given a file's current path (relative to root, with extension),
 * return its current directory (relative to root).
 */
function getCurrentDir(currentRelPath) {
  return path.posix.dirname(currentRelPath);
}

// ============================================================================
// STEP 3: Resolve an import path to a normalized root-relative path (no ext)
// ============================================================================

/**
 * Resolve a relative import path against a base directory.
 * Returns normalized path relative to root (no extension).
 */
function resolveImportPath(importPath, baseDir) {
  // Normalize: resolve . and ..
  const resolved = path.posix.normalize(path.posix.join(baseDir, importPath));
  return resolved;
}

/**
 * Compute relative path from one directory to a target path (both root-relative, no ext).
 * Ensures the result starts with ./ or ../
 */
function computeRelativePath(fromDir, targetPath) {
  let rel = path.posix.relative(fromDir, targetPath);
  // Ensure it starts with ./ or ../
  if (!rel.startsWith('.')) {
    rel = './' + rel;
  }
  return rel;
}

// ============================================================================
// STEP 4: Scan all .ts/.tsx files and rewrite imports
// ============================================================================

function getAllTsFiles(dir, baseDir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules, .git, etc.
      if (['node_modules', '.git', 'android', 'electron', 'native_backup', 'plugins', 'tests', 'scripts'].includes(entry.name)) {
        continue;
      }
      results = results.concat(getAllTsFiles(fullPath, baseDir));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      // Get path relative to project root
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      results.push(relPath);
    }
  }
  return results;
}

// Regex to match import/require statements with relative paths
// Matches: import ... from '...', import ... from "...", require('...'), require("...")
// Also matches: export ... from '...'
const IMPORT_REGEX = /((?:import|export)\s+(?:[\s\S]*?)\s+from\s+['"])(\.[^'"]+)(['"])/g;
const REQUIRE_REGEX = /(require\s*\(\s*['"])(\.[^'"]+)(['"])/g;
const DYNAMIC_IMPORT_REGEX = /(import\s*\(\s*['"])(\.[^'"]+)(['"])/g;

let totalChanges = 0;
let filesModified = 0;

const allFiles = getAllTsFiles(ROOT, ROOT);
console.log(`Found ${allFiles.length} TypeScript files to scan.\n`);

for (const relFile of allFiles) {
  const absFile = path.join(ROOT, relFile);
  let content = fs.readFileSync(absFile, 'utf-8');
  let modified = false;
  let fileChanges = 0;
  
  const oldDir = getOldDir(relFile);
  const currentDir = getCurrentDir(relFile);
  
  // Process all import patterns
  const processMatch = (match, prefix, importPath, suffix) => {
    // Skip @/ alias imports (they don't start with .)
    // The regex already only matches paths starting with .
    
    // Resolve the import path against the OLD directory to find what it originally pointed to
    const oldTargetPath = resolveImportPath(importPath, oldDir);
    
    // Look up where that target is NOW
    let newTargetPath = oldTargetPath; // default: target didn't move
    if (moveMap[oldTargetPath]) {
      newTargetPath = moveMap[oldTargetPath];
    }
    
    // Compute the new relative path from the file's CURRENT directory to the target's NEW location
    const newImportPath = computeRelativePath(currentDir, newTargetPath);
    
    if (newImportPath !== importPath) {
      modified = true;
      fileChanges++;
      console.log(`  ${relFile}: '${importPath}' -> '${newImportPath}'`);
    }
    
    return prefix + newImportPath + suffix;
  };
  
  content = content.replace(IMPORT_REGEX, processMatch);
  content = content.replace(REQUIRE_REGEX, processMatch);
  content = content.replace(DYNAMIC_IMPORT_REGEX, processMatch);
  
  if (modified) {
    fs.writeFileSync(absFile, content, 'utf-8');
    filesModified++;
    totalChanges += fileChanges;
    console.log(`  [${fileChanges} changes in ${relFile}]\n`);
  }
}

console.log(`\n=== DONE ===`);
console.log(`Files modified: ${filesModified}`);
console.log(`Total import paths rewritten: ${totalChanges}`);
