export type ProviderUrlValidation =
    | { valid: true; normalizedUrl: string }
    | { valid: false; message: string };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

// Local model servers (Ollama, LM Studio, llama.cpp…) are commonly served
// over plain HTTP on the loopback OR another machine on the LAN — blocking
// RFC1918/private ranges meant those setups were rejected outright.
const isLoopbackIp = (hostname: string): boolean => /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
const isPrivateIp = (hostname: string): boolean =>
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname);
const isLinkLocalIp = (hostname: string): boolean => /^169\.254\.\d{1,3}\.\d{1,3}$/.test(hostname);

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
    const isLocal = LOCAL_HOSTS.has(hostname) || isLoopbackIp(hostname) || isPrivateIp(hostname) || isLinkLocalIp(hostname);
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
