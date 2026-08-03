import { describe, it, expect } from 'vitest';
import { createNewConversation } from '../utils/conversationUtils';

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
});
