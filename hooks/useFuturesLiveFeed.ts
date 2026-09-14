/**
 * useFuturesLiveFeed — one websocket subscription bundle per symbol for the
 * trade surface: markPrice@1s + depth20@100ms + 24h ticker on a combined
 * socket, and kline_<interval> on its own. While `status === 'live'` the
 * consumers skip their polling entirely; the moment the socket drops the
 * status flips to 'polling' and the existing REST loops take over — so the
 * surface is push-first, never push-only.
 *
 * Reconnects with capped backoff; Binance closes idle/failing sockets
 * silently, so a stale connection is treated as closed.
 */

import { useEffect, useState } from 'react';
import {
    parseMarkPrice, parseTicker, parseDepth, parseKline, unwrapCombined,
    type LiveMarkIndex, type LiveTicker, type LiveDepth, type LiveKline,
} from '../services/trade/futuresStreams';

export type FeedStatus = 'connecting' | 'live' | 'polling';

const FUTURE_WS = 'wss://fstream.binance.com';
const CONNECT_TIMEOUT_MS = 5000;
const MAX_BACKOFF_MS = 10000;

/** The combined feed streams markPrice@1s, so a healthy socket is never
 *  silent for long. If it goes quiet for STALL_MS while still OPEN, it is
 *  half-dead (phantom-live) — force-close so scheduleRetry flips us to
 *  'polling' and REST resumes. STALL_CHECK_MS is how often we test for it. */
const STALL_MS = 8000;
const STALL_CHECK_MS = 5000;

/** kline stream interval names (lowercase Binance form). The multi-day
 *  suffixes must NOT be lowercased — '1M'.toLowerCase() is '1m', which would
 *  silently subscribe the monthly chart to the 1-minute stream. */
const WS_KLINE: Record<string, string> = { '1D': '1d', '3D': '3d', '1W': '1w', '1M': '1M' };
export const klineInterval = (appInterval: string): string =>
    WS_KLINE[appInterval] ?? appInterval.toLowerCase();

export interface FuturesLiveFeed {
    markIndex: LiveMarkIndex | null;
    ticker: LiveTicker | null;
    depth: LiveDepth | null;
    kline: LiveKline | null;
    status: FeedStatus;
}

export const useFuturesLiveFeed = (symbol: string, interval: string): FuturesLiveFeed => {
    const [markIndex, setMarkIndex] = useState<LiveMarkIndex | null>(null);
    const [ticker, setTicker] = useState<LiveTicker | null>(null);
    const [depth, setDepth] = useState<LiveDepth | null>(null);
    const [kline, setKline] = useState<LiveKline | null>(null);
    const [status, setStatus] = useState<FeedStatus>('connecting');

    useEffect(() => {
        const s = symbol.toLowerCase();
        setMarkIndex(null); setTicker(null); setDepth(null); setKline(null);
        setStatus('connecting');

        let closed = false;
        const sockets = new Set<WebSocket>();
        const combinedUrl = `${FUTURE_WS}/stream?streams=${s}@markPrice@1s/${s}@depth20@100ms/${s}@ticker`;
        const klineUrl = `${FUTURE_WS}/ws/${s}@kline_${klineInterval(interval)}`;

        // Each socket owns its OWN reconnect + stall watchdog. Previously a
        // single shared `gotMessageRef` meant the busy combined feed kept
        // flipping status 'live' while the kline socket was actually dead
        // (and one socket's `onclose` called a `start()` that re-opened BOTH,
        // accumulating duplicate depth feeds on every flap).
        const open = (url: string, isCombined: boolean, onData: (payload: unknown) => void): void => {
            let attempt = 0;
            let retryTimer = 0;
            let gotMessage = false;
            let lastMessageAt = 0;
            let stallTimer = 0;
            let ws: WebSocket;

            const scheduleRetry = (): void => {
                if (closed) return;
                if (isCombined) setStatus('polling');
                gotMessage = false;
                window.clearInterval(stallTimer);
                const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
                attempt += 1;
                window.clearTimeout(retryTimer);
                retryTimer = window.setTimeout(() => { if (!closed) connect(); }, backoff);
            };

            const connect = (): void => {
                if (closed) return;
                try { ws = new WebSocket(url); } catch { scheduleRetry(); return; }
                sockets.add(ws);
                const connectTimer = window.setTimeout(() => {
                    // This socket opened but stayed silent (or never opened):
                    // treat it as dead so it reconnects and REST takes over.
                    if (ws.readyState !== WebSocket.OPEN || !gotMessage) { try { ws.close(); } catch { /* already gone */ } }
                }, CONNECT_TIMEOUT_MS);
                ws.onopen = () => { attempt = 0; };
                ws.onmessage = ev => {
                    const payload = url.includes('/stream?') ? unwrapCombined(String(ev.data)) : safeParse(String(ev.data));
                    if (payload) {
                        gotMessage = true;
                        lastMessageAt = Date.now();
                        // Once the first frame lands, the connectTimer's job is
                        // done — hand liveness to the rolling stall watchdog.
                        window.clearTimeout(connectTimer);
                        if (isCombined && stallTimer === 0) {
                            // Phantom-live guard: a half-open TCP (laptop sleep,
                            // Wi-Fi roam, NAT timeout) never fires onclose, so
                            // 'live' would stick and EVERY REST fallback stays
                            // gated off — the strip freezes on the last frame
                            // forever. If the 1s markPrice stream goes quiet
                            // for STALL_MS, force-close: onclose → scheduleRetry
                            // flips status to 'polling' and REST resumes.
                            stallTimer = window.setInterval(() => {
                                if (closed) { window.clearInterval(stallTimer); stallTimer = 0; return; }
                                if (gotMessage && Date.now() - lastMessageAt > STALL_MS
                                    && ws.readyState === WebSocket.OPEN) {
                                    try { ws.close(); } catch { /* onclose drives the retry */ }
                                }
                            }, STALL_CHECK_MS);
                        }
                        // Liveness rides the COMBINED feed (mark/depth/ticker)
                        // — the kline nudge is advisory, so its dropout must
                        // not read as "live" nor flip the surface to polling.
                        if (isCombined) setStatus('live');
                        onData(payload);
                    }
                };
                ws.onclose = () => { window.clearTimeout(connectTimer); window.clearInterval(stallTimer); stallTimer = 0; sockets.delete(ws); scheduleRetry(); };
                ws.onerror = () => { try { ws.close(); } catch { /* close fires onerror too */ } };
            };
            connect();
        };

        open(combinedUrl, true, msg => {
            const mi = parseMarkPrice(msg); if (mi) { setMarkIndex(mi); return; }
            const tk = parseTicker(msg); if (tk) { setTicker(tk); return; }
            const dp = parseDepth(msg); if (dp) { setDepth(dp); return; }
        });
        open(klineUrl, false, msg => {
            const kl = parseKline(msg); if (kl) setKline(kl);
        });

        return () => {
            closed = true;
            sockets.forEach(ws => { try { ws.close(); } catch { /* already closed */ } });
            sockets.clear();
        };
    }, [symbol, interval]);

    return { markIndex, ticker, depth, kline, status };
};

const safeParse = (raw: string): unknown => {
    try { return JSON.parse(raw); } catch { return null; }
};
