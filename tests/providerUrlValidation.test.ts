import { describe, expect, it } from 'vitest';
import { validateProviderUrl } from '../utils/providerUrlValidation';

describe('validateProviderUrl', () => {
    it('accepts HTTPS provider URLs', () => {
        expect(validateProviderUrl('https://api.example.com/v1')).toEqual({
            valid: true,
            normalizedUrl: 'https://api.example.com/v1',
        });
    });

    it.each(['http://localhost:11434/v1', 'http://127.0.0.1:8080', 'http://[::1]:8080/v1'])('accepts loopback HTTP: %s', (url) => {
        expect(validateProviderUrl(url).valid).toBe(true);
    });

    it.each([
        'http://api.example.com/v1',
        'file:///tmp/provider',
        'https://user:pass@example.com/v1',
        'https://api.example.com/v1?key=value',
        'https://api.example.com/v1#fragment',
        'http://localhost.evil.example/v1',
        'not-a-url',
    ])('rejects unsafe URL: %s', (url) => {
        expect(validateProviderUrl(url).valid).toBe(false);
    });
});
