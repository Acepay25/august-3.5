/**
 * Accuracy Ensemble Service
 * 
 * Re-exports debate functions from the main ensembleService.
 * This eliminates code duplication while maintaining the same API for accuracy mode consumers.
 */

// Re-export all debate functions from the main ensemble service
export {
    conductDebate,
    conductTwoWayDebate,
    conductThreeWayDebate,
    conductTwoWayPostMortemDebate,
    conductThreeWayPostMortemDebate,
} from '../ensembleService';

// Note: The main ensembleService now includes:
// - Timeframe Confluence Scoring
// - Invalidation Rule Checking
// - Pattern Memory Synthesis
// - Enhanced Debate Context
// All of these features are now available in accuracy mode debates.
