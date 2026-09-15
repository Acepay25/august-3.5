import { isPrivateOrLoopbackHost } from '../shared/providerRequestPolicy.cjs';

export type ProviderUrlValidation =
    | { valid: true; normalizedUrl: string }
    | { valid: false; message: string };

// The host policy (loopback + RFC1918 + link-local HTTP exemption) lives in
// shared/providerRequestPolicy.cjs — the single source consumed by the
// renderer, the vite dev proxy, and the Electron main process alike. This
// module is the UX layer on top of it: normalization + the per-rule error
// messages the Settings forms display.

export function validateProviderUrl(value: string): ProviderUrlValidation {
    const trimmed = value.trim();
    if (!trimmed) return { valid: false, message: 'Base URL is required.' };

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return { valid: false, message: 'Enter a valid absolute provider URL.' };
    }

    const hostname = parsed.hostname.toLowerCase();
    const isLocal = isPrivateOrLoopbackHost(hostname);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocal)) {
        return { valid: false, message: 'Provider URLs must use HTTPS. HTTP is allowed only for localhost and private LAN addresses.' };
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
