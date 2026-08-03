export type ProviderUrlValidation =
    | { valid: true; normalizedUrl: string }
    | { valid: false; message: string };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function validateProviderUrl(value: string): ProviderUrlValidation {
    const trimmed = value.trim();
    if (!trimmed) return { valid: false, message: 'Base URL is required.' };

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return { valid: false, message: 'Enter a valid absolute provider URL.' };
    }

    const isLocal = LOCAL_HOSTS.has(parsed.hostname.toLowerCase());
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocal)) {
        return { valid: false, message: 'Provider URLs must use HTTPS. HTTP is allowed only for localhost.' };
    }
    if (parsed.username || parsed.password) {
        return { valid: false, message: 'Provider URLs cannot include embedded credentials.' };
    }
    if (parsed.search) {
        return { valid: false, message: 'Provider URLs cannot include query parameters.' };
    }
    if (parsed.hash) {
        return { valid: false, message: 'Provider URLs cannot include fragments.' };
    }

    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return { valid: true, normalizedUrl: parsed.toString().replace(/\/$/, '') };
}

export function assertValidProviderUrl(value: string): string {
    const result = validateProviderUrl(value);
    if (!result.valid) throw new Error(result.message);
    return result.normalizedUrl;
}
