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

    it('initializes messages with a single AI welcome message', () => {
      // Note: the factory seeds one assistant welcome message rather than
      // starting with an empty array.
      const conv = createNewConversation();
      expect(Array.isArray(conv.messages)).toBe(true);
      expect(conv.messages).toHaveLength(1);
      expect(conv.messages[0].role).toBe('ai');
      expect(conv.messages[0].text.length).toBeGreaterThan(0);
    });

    it('has a default leverage of 10', () => {
      const conv = createNewConversation();
      expect(conv.leverage).toBe(10);
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
