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

import { useEffect, useRef, useState } from 'react';
import {
    parseMarkPrice, parseTicker, parseDepth, parseKline, unwrapCombined,
    type LiveMarkIndex, type LiveTicker, type LiveDepth, type LiveKline,
} from '../services/trade/futuresStreams';

export type FeedStatus = 'connecting' | 'live' | 'polling';

const FUTURE_WS = 'wss://fstream.binance.com';
const CONNECT_TIMEOUT_MS = 5000;
const MAX_BACKOFF_MS = 10000;

/** kline stream interval names (lowercase Binance form). */
export const klineInterval = (appInterval: string): string =>
    appInterval === '1D' ? '1d' : appInterval.toLowerCase();

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
    // Any message on the combined socket flips us live; the ref avoids
    // re-render churn on every 100ms depth push.
    const gotMessageRef = useRef(false);

    useEffect(() => {
        const s = symbol.toLowerCase();
        setMarkIndex(null); setTicker(null); setDepth(null); setKline(null);
        setStatus('connecting');
        gotMessageRef.current = false;

        let closed = false;
        let attempt = 0;
        let retryTimer = 0;
        const sockets: WebSocket[] = [];
        const combinedUrl = `${FUTURE_WS}/stream?streams=${s}@markPrice@1s/${s}@depth20@100ms/${s}@ticker`;
        const klineUrl = `${FUTURE_WS}/ws/${s}@kline_${klineInterval(interval)}`;

        const markLive = (): void => {
            if (!gotMessageRef.current) { gotMessageRef.current = true; setStatus('live'); }
        };

        const open = (url: string, onData: (payload: unknown) => void): void => {
            let ws: WebSocket;
            try { ws = new WebSocket(url); } catch { scheduleRetry(); return; }
            sockets.push(ws);
            const connectTimer = window.setTimeout(() => {
                // Opened but silent (or never opened): treat as dead so the
                // REST polling fallback takes over promptly.
                if (ws.readyState !== WebSocket.OPEN || !gotMessageRef.current) { try { ws.close(); } catch { /* already gone */ } }
            }, CONNECT_TIMEOUT_MS);
            ws.onopen = () => { attempt = 0; };
            ws.onmessage = ev => {
                const payload = url.includes('/stream?') ? unwrapCombined(String(ev.data)) : safeParse(String(ev.data));
                if (payload) { markLive(); onData(payload); }
            };
            ws.onclose = () => { window.clearTimeout(connectTimer); if (!closed) scheduleRetry(); };
            ws.onerror = () => { try { ws.close(); } catch { /* close fires onerror too */ } };
        };

        const scheduleRetry = (): void => {
            if (closed) return;
            setStatus('polling');
            gotMessageRef.current = false;
            const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
            attempt += 1;
            window.clearTimeout(retryTimer);
            retryTimer = window.setTimeout(() => { if (!closed) start(); }, backoff);
        };

        const start = (): void => {
            open(combinedUrl, msg => {
                const mi = parseMarkPrice(msg); if (mi) { setMarkIndex(mi); return; }
                const tk = parseTicker(msg); if (tk) { setTicker(tk); return; }
                const dp = parseDepth(msg); if (dp) { setDepth(dp); return; }
            });
            open(klineUrl, msg => {
                const kl = parseKline(msg); if (kl) setKline(kl);
            });
        };
        start();

        return () => {
            closed = true;
            window.clearTimeout(retryTimer);
            sockets.forEach(ws => { try { ws.close(); } catch { /* already closed */ } });
        };
    }, [symbol, interval]);

    return { markIndex, ticker, depth, kline, status };
};

const safeParse = (raw: string): unknown => {
    try { return JSON.parse(raw); } catch { return null; }
};
