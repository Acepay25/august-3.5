import { describe, it, expect } from 'vitest';
import { MessageRole } from '../types';
import {
  createNewConversation,
  findReusableEmptyConversation,
  isEmptyConversation,
} from '../utils/conversationUtils';

describe('conversationUtils', () => {
  describe('createNewConversation', () => {
    it('creates a conversation with a unique id', () => {
      const a = createNewConversation();
      const b = createNewConversation();
      expect(a.id).toBeTruthy();
      expect(a.id).toMatch(/^conv-/);
      expect(a.id).not.toEqual(b.id);
    });

    it('starts with an empty message list (no welcome bubble)', () => {
      // Fresh sessions start empty — the chat shows a centered input and
      // fills as messages are sent (welcome bubble removed in f849353).
      const conv = createNewConversation();
      expect(Array.isArray(conv.messages)).toBe(true);
      expect(conv.messages).toHaveLength(0);
    });

    it('has a default leverage of 100 (app-wide default)', () => {
      const conv = createNewConversation();
      expect(conv.leverage).toBe(100);
    });

    it('has a createdAt-style timestamp set to now', () => {
      const before = Date.now();
      const conv = createNewConversation();
      const after = Date.now();
      expect(typeof conv.timestamp).toBe('number');
      expect(conv.timestamp).toBeGreaterThanOrEqual(before);
      expect(conv.timestamp).toBeLessThanOrEqual(after);
    });

    it('leaves OCR/moderator provider fields unset initially', () => {
      const conv = createNewConversation();
      expect(conv.ocrModel).toBe('');
      expect(conv.moderatorProviderId).toBe('');
      expect(conv.moderatorModel).toBe('');
    });
  });

  describe('findReusableEmptyConversation', () => {
    const withMessages = (id: string): ReturnType<typeof createNewConversation> => {
      const conv = createNewConversation();
      conv.id = id;
      conv.messages = [{
        id: `msg-${id}`,
        role: MessageRole.USER,
        text: 'hello',
        createdAt: new Date().toISOString(),
      }];
      return conv;
    };

    it('returns the active session when it is already blank', () => {
      const blank = createNewConversation();
      const filled = withMessages('filled');
      expect(isEmptyConversation(blank)).toBe(true);
      expect(findReusableEmptyConversation([blank, filled], blank.id)?.id).toBe(blank.id);
    });

    it('switches back to an existing blank session after leaving it', () => {
      const blank = createNewConversation();
      const filled = withMessages('filled');
      // User left the fresh session for one that already has messages.
      expect(findReusableEmptyConversation([filled, blank], filled.id)?.id).toBe(blank.id);
    });

    it('returns null when every session already has messages', () => {
      const a = withMessages('a');
      const b = withMessages('b');
      expect(findReusableEmptyConversation([a, b], a.id)).toBeNull();
    });

    it('reuses the most recent blank session when several exist', () => {
      const older = createNewConversation();
      older.id = 'older-blank';
      const newer = createNewConversation();
      newer.id = 'newer-blank';
      const filled = withMessages('filled');
      expect(findReusableEmptyConversation([newer, filled, older], filled.id)?.id).toBe('newer-blank');
    });
  });
});
