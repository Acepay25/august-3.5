/**
 * Unified Streaming Types
 *
 * Defines a common streaming contract for both analyst thought streams
 * and moderator debate streams. Replaces the current split where:
 * - Analysts use non-streaming calls (return complete results)
 * - Moderator uses async generator streaming
 *
 * This enables progressive rendering for all providers.
 */

// =============================================================================
// STREAM EVENT TYPES
// =============================================================================

/** A single chunk of streamed text from an AI provider */
export interface StreamChunk {
  type: 'text';
  content: string;
  provider: string;
}

/** A structured analysis result emitted when JSON parsing succeeds */
export interface StreamAnalysis {
  type: 'analysis';
  provider: string;
  analysis: unknown; // TradeAnalysis — using unknown to avoid circular dep
  thoughtProcess: string;
}

/** An error event from a provider */
export interface StreamError {
  type: 'error';
  provider: string;
  error: string;
  isRetryable: boolean;
}

/** Stream completed successfully */
export interface StreamComplete {
  type: 'complete';
  provider: string;
  totalTokens?: number;
}

/** Union of all stream events */
export type StreamEvent = StreamChunk | StreamAnalysis | StreamError | StreamComplete;

// =============================================================================
// STREAM GENERATOR TYPE
// =============================================================================

/**
 * A unified stream generator that yields StreamEvents.
 * Both analysts and the moderator can use this interface.
 *
 * Usage:
 *   const stream = provider.analyzeTradingViewStream(params);
 *   for await (const event of stream) {
 *     switch (event.type) {
 *       case 'text': updateThoughtUI(event.content); break;
 *       case 'analysis': handleResult(event.analysis); break;
 *       case 'error': handleError(event.error); break;
 *       case 'complete': finalize(); break;
 *     }
 *   }
 */
export type AIStream = AsyncGenerator<StreamEvent, void, unknown>;

// =============================================================================
// HELPERS
// =============================================================================

/** Create a text chunk event */
export const textChunk = (provider: string, content: string): StreamChunk => ({
  type: 'text',
  content,
  provider,
});

/** Create an analysis result event */
export const analysisResult = (provider: string, analysis: unknown, thoughtProcess: string): StreamAnalysis => ({
  type: 'analysis',
  provider,
  analysis,
  thoughtProcess,
});

/** Create an error event */
export const streamError = (provider: string, error: string, isRetryable = false): StreamError => ({
  type: 'error',
  provider,
  error,
  isRetryable,
});

/** Create a completion event */
export const streamComplete = (provider: string, totalTokens?: number): StreamComplete => ({
  type: 'complete',
  provider,
  totalTokens,
});

/**
 * Wrap a non-streaming async call into a single-event stream.
 * Useful for migrating existing providers incrementally.
 */
export async function* wrapAsStream<T>(
  provider: string,
  promise: Promise<{ analysis: T; thoughtProcess: string }>
): AIStream {
  try {
    const result = await promise;
    yield analysisResult(provider, result.analysis, result.thoughtProcess);
    yield streamComplete(provider);
  } catch (error) {
    yield streamError(
      provider,
      error instanceof Error ? error.message : 'Unknown error',
      true
    );
  }
}
