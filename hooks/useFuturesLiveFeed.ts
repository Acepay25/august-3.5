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
            let ws: WebSocket;

            const scheduleRetry = (): void => {
                if (closed) return;
                if (isCombined) setStatus('polling');
                gotMessage = false;
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
                        // Liveness rides the COMBINED feed (mark/depth/ticker)
                        // — the kline nudge is advisory, so its dropout must
                        // not read as "live" nor flip the surface to polling.
                        if (isCombined) setStatus('live');
                        onData(payload);
                    }
                };
                ws.onclose = () => { window.clearTimeout(connectTimer); sockets.delete(ws); scheduleRetry(); };
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
