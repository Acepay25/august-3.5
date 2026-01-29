/**
 * TradeShareService - Generate shareable trade card images
 * Modern premium design inspired by ChatGPT and Gemini
 */

import { TradeAnalysis, TradeOutcome } from '../types';

export interface ShareCardOptions {
    width?: number;
    height?: number;
    showWatermark?: boolean;
    theme?: 'dark' | 'light';
}

class TradeShareServiceClass {
    private defaultOptions: ShareCardOptions = {
        width: 1080,  // HD quality
        height: 1440, // 3:4 aspect ratio
        showWatermark: true,
        theme: 'dark'
    };

    /**
     * Generate a modern, aesthetic trade card image
     */
    async generateTradeCard(
        analysis: TradeAnalysis,
        outcome?: TradeOutcome,
        options: ShareCardOptions = {},
        tradingStyle?: 'swing' | 'scalp' | 'position'
    ): Promise<Blob> {
        const opts = { ...this.defaultOptions, ...options };
        const canvas = document.createElement('canvas');
        const w = opts.width!;
        const h = opts.height!;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;

        // Scale factor for HD (base design was 480x640)
        const s = w / 480;

        // Direction colors
        const isLong = analysis.direction === 'Long';
        const isShort = analysis.direction === 'Short';
        const primaryColor = isLong ? '#10b981' : isShort ? '#f43f5e' : '#6366f1';
        const primaryDark = isLong ? '#059669' : isShort ? '#e11d48' : '#4f46e5';

        // === BACKGROUND ===
        const bgGradient = ctx.createLinearGradient(0, 0, w, h);
        bgGradient.addColorStop(0, '#0f0f0f');
        bgGradient.addColorStop(0.5, '#171717');
        bgGradient.addColorStop(1, '#0a0a0a');
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, w, h);

        // Subtle noise
        ctx.fillStyle = 'rgba(255,255,255,0.02)';
        for (let i = 0; i < 300; i++) {
            ctx.beginPath();
            ctx.arc(Math.random() * w, Math.random() * h, Math.random() * 2 * s, 0, Math.PI * 2);
            ctx.fill();
        }

        // Glow orb
        const orbGradient = ctx.createRadialGradient(w - 100 * s, 100 * s, 0, w - 100 * s, 100 * s, 250 * s);
        orbGradient.addColorStop(0, primaryColor + '40');
        orbGradient.addColorStop(0.5, primaryColor + '15');
        orbGradient.addColorStop(1, 'transparent');
        ctx.fillStyle = orbGradient;
        ctx.fillRect(0, 0, w, 350 * s);

        // === HEADER ===
        const headerY = 40 * s;

        // Direction pill
        const pillW = 100 * s, pillH = 40 * s;
        const pillGrad = ctx.createLinearGradient(32 * s, headerY, 32 * s + pillW, headerY);
        pillGrad.addColorStop(0, primaryColor);
        pillGrad.addColorStop(1, primaryDark);
        ctx.fillStyle = pillGrad;
        this.roundRect(ctx, 32 * s, headerY, pillW, pillH, 20 * s);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${18 * s}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText((analysis.direction || 'NEUTRAL').toUpperCase(), 32 * s + pillW / 2, headerY + 26 * s);
        ctx.textAlign = 'left';

        // Trading Style badge (next to direction pill)
        if (tradingStyle) {
            const styleX = 32 * s + pillW + 12 * s;
            const styleW = 80 * s;
            const styleColor = tradingStyle === 'scalp' ? '#f59e0b' : '#8b5cf6'; // Orange for scalp, purple for swing
            const styleEmoji = tradingStyle === 'scalp' ? '⚡' : '🔄';

            ctx.fillStyle = styleColor + '25';
            this.roundRect(ctx, styleX, headerY, styleW, pillH, 20 * s);
            ctx.fill();
            ctx.strokeStyle = styleColor + '60';
            ctx.lineWidth = 1 * s;
            this.roundRect(ctx, styleX, headerY, styleW, pillH, 20 * s);
            ctx.stroke();

            ctx.fillStyle = styleColor;
            ctx.font = `bold ${14 * s}px -apple-system, BlinkMacSystemFont, sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(`${styleEmoji} ${tradingStyle.toUpperCase()}`, styleX + styleW / 2, headerY + 26 * s);
            ctx.textAlign = 'left';
        }

        // Coin name
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${36 * s}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillText(analysis.coinName || 'UNKNOWN', 32 * s, headerY + 90 * s);

        // Confidence badge
        const confY = headerY + 110 * s;
        const confColor = analysis.confidence === 'High' ? '#22c55e' :
            analysis.confidence === 'Medium' ? '#eab308' :
                analysis.confidence === 'Low' ? '#f97316' : '#ef4444';
        ctx.fillStyle = confColor + '20';
        this.roundRect(ctx, 32 * s, confY, 180 * s, 32 * s, 8 * s);
        ctx.fill();
        ctx.strokeStyle = confColor + '60';
        ctx.lineWidth = 1 * s;
        this.roundRect(ctx, 32 * s, confY, 180 * s, 32 * s, 8 * s);
        ctx.stroke();

        ctx.fillStyle = confColor;
        ctx.font = `bold ${14 * s}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillText(`${analysis.confidence?.toUpperCase() || 'N/A'} CONFIDENCE • ${analysis.probability || 0}%`, 44 * s, confY + 21 * s);

        // === MAIN CARD ===
        const cardY = 200 * s;
        const cardH = 340 * s;

        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        this.roundRect(ctx, 24 * s, cardY, w - 48 * s, cardH, 24 * s);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1 * s;
        this.roundRect(ctx, 24 * s, cardY, w - 48 * s, cardH, 24 * s);
        ctx.stroke();

        const secX = 48 * s;
        let curY = cardY + 36 * s;

        // Entry section
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.arc(secX, curY + 8 * s, 6 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowColor = '#3b82f6';
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#71717a';
        ctx.font = `${12 * s}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillText('ENTRY ZONE', secX + 20 * s, curY + 4 * s);

        ctx.fillStyle = '#e4e4e7';
        ctx.font = `bold ${24 * s}px -apple-system, BlinkMacSystemFont, sans-serif`;
        const entryPrice = analysis.entryPoints?.[0]?.price || 'N/A';
        ctx.fillText(typeof entryPrice === 'string' ? entryPrice : 'N/A', secX + 20 * s, curY + 32 * s);

        // Stop Loss section
        curY += 80 * s;
        ctx.fillStyle = '#f43f5e';
        ctx.beginPath();
        ctx.arc(secX, curY + 8 * s, 6 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowColor = '#f43f5e';
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#71717a';
        ctx.font = `${12 * s}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillText('STOP LOSS', secX + 20 * s, curY + 4 * s);

        ctx.fillStyle = '#fda4af';
        ctx.font = `bold ${24 * s}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillText(analysis.stopLoss || 'N/A', secX + 20 * s, curY + 32 * s);

        // SL percentage badge
        if (analysis.stopLossPercentage) {
            const slW = ctx.measureText(analysis.stopLoss || 'N/A').width;
            ctx.fillStyle = '#f43f5e30';
            ctx.font = `bold ${16 * s}px -apple-system, BlinkMacSystemFont, sans-serif`;
            const pctW = ctx.measureText(analysis.stopLossPercentage).width + 20 * s;
            this.roundRect(ctx, secX + 20 * s + slW + 16 * s, curY + 12 * s, pctW, 28 * s, 8 * s);
            ctx.fill();
            ctx.fillStyle = '#f43f5e';
            ctx.fillText(analysis.stopLossPercentage, secX + 20 * s + slW + 26 * s, curY + 32 * s);
        }

        // Take Profit section
        curY += 80 * s;
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(secX, curY + 8 * s, 6 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowColor = '#22c55e';
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#71717a';
        ctx.font = `${12 * s}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillText('TAKE PROFIT', secX + 20 * s, curY + 4 * s);

        const tps = analysis.takeProfit || [];
        if (tps.length > 0) {
            tps.slice(0, 3).forEach((tp, i) => {
                const yOff = curY + 28 * s + (i * 34 * s);
                ctx.fillStyle = '#86efac';
                ctx.font = `bold ${20 * s}px -apple-system, BlinkMacSystemFont, sans-serif`;
                const tpText = `TP${i + 1}: ${typeof tp.price === 'string' ? tp.price : 'N/A'}`;
                ctx.fillText(tpText, secX + 20 * s, yOff);

                if (tp.percentage && typeof tp.percentage === 'string') {
                    const tpW = ctx.measureText(tpText).width;
                    ctx.fillStyle = '#22c55e30';
                    ctx.font = `bold ${14 * s}px -apple-system, BlinkMacSystemFont, sans-serif`;
                    const pctW = ctx.measureText(tp.percentage).width + 16 * s;
                    this.roundRect(ctx, secX + 20 * s + tpW + 16 * s, yOff - 16 * s, pctW, 22 * s, 6 * s);
                    ctx.fill();
                    ctx.fillStyle = '#22c55e';
                    ctx.fillText(tp.percentage, secX + 20 * s + tpW + 24 * s, yOff);
                }
            });
        } else {
            ctx.fillStyle = '#52525b';
            ctx.font = `italic ${16 * s}px -apple-system, BlinkMacSystemFont, sans-serif`;
            ctx.fillText('No targets defined', secX + 20 * s, curY + 28 * s);
        }

        // === FOOTER ===
        const botY = h - 80 * s;

        // R:R badge
        if (analysis.rrRatio) {
            const rrColor = analysis.rrRatio >= 2 ? '#22c55e' : analysis.rrRatio >= 1.2 ? '#eab308' : '#f97316';
            ctx.fillStyle = rrColor + '15';
            this.roundRect(ctx, 32 * s, botY, 80 * s, 40 * s, 12 * s);
            ctx.fill();
            ctx.strokeStyle = rrColor + '40';
            ctx.lineWidth = 1 * s;
            this.roundRect(ctx, 32 * s, botY, 80 * s, 40 * s, 12 * s);
            ctx.stroke();

            ctx.fillStyle = rrColor;
            ctx.font = `bold ${16 * s}px -apple-system, BlinkMacSystemFont, sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(`1:${analysis.rrRatio}`, 72 * s, botY + 26 * s);
            ctx.textAlign = 'left';
        }

        // Outcome badge
        if (outcome && outcome !== TradeOutcome.PENDING) {
            const oColor = outcome === TradeOutcome.WIN ? '#22c55e' : outcome === TradeOutcome.LOSS ? '#ef4444' : '#71717a';
            const oText = outcome === TradeOutcome.WIN ? '✓ WIN' : outcome === TradeOutcome.LOSS ? '✗ LOSS' : 'SKIPPED';

            ctx.fillStyle = oColor + '20';
            this.roundRect(ctx, w - 120 * s, botY, 88 * s, 40 * s, 12 * s);
            ctx.fill();
            ctx.fillStyle = oColor;
            ctx.font = `bold ${16 * s}px -apple-system, BlinkMacSystemFont, sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(oText, w - 76 * s, botY + 26 * s);
            ctx.textAlign = 'left';
        }

        // Watermark
        if (opts.showWatermark) {
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.font = `${14 * s}px -apple-system, BlinkMacSystemFont, sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('Powered by August AI', w / 2, h - 20 * s);
            ctx.textAlign = 'left';
        }

        return new Promise((resolve, reject) => {
            canvas.toBlob(
                blob => blob ? resolve(blob) : reject(new Error('Failed to create image')),
                'image/png',
                1.0
            );
        });
    }

    /**
     * Copy image to clipboard
     */
    async copyToClipboard(blob: Blob): Promise<boolean> {
        try {
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ]);
            return true;
        } catch (error) {
            console.error('[TradeShareService] Clipboard error:', error);
            return false;
        }
    }

    /**
     * Download/Save image - uses GallerySaver on Android, browser download on web
     */
    async downloadAsImage(blob: Blob, filename: string = 'trade-card.png'): Promise<boolean> {
        try {
            // Try GallerySaver plugin first (Android)
            try {
                const GallerySaver = (await import('../plugins/GallerySaver')).default;

                // Convert blob to base64
                const reader = new FileReader();
                const base64Promise = new Promise<string>((resolve, reject) => {
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
                const base64Data = await base64Promise;

                const result = await GallerySaver.saveImage({
                    base64: base64Data,
                    filename
                });

                if (result.success) {
                    console.log('[TradeShareService] Saved to gallery:', result.uri);
                    return true;
                }
            } catch (pluginError) {
                console.log('[TradeShareService] GallerySaver not available, using browser fallback:', pluginError);
            }

            // Browser fallback
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            return true;
        } catch (error) {
            console.error('[TradeShareService] Download error:', error);
            return false;
        }
    }

    /**
     * Native share - uses Web Share API with file (works on modern browsers/PWAs)
     * Returns false if file sharing not supported, caller should fallback to clipboard
     */
    async nativeShare(blob: Blob, title: string = 'Trade Analysis'): Promise<boolean> {
        try {
            // Only try Web Share API with file - no text fallback
            if (navigator.share && navigator.canShare) {
                const file = new File([blob], 'trade-card.png', { type: 'image/png' });
                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        title,
                        files: [file]
                    });
                    return true;
                }
            }

            // File sharing not supported - return false to trigger clipboard fallback
            return false;
        } catch (error) {
            if ((error as Error).name === 'AbortError') return false;
            console.error('[TradeShareService] Share error:', error);
            return false;
        }
    }

    /**
     * Check if native sharing is supported
     */
    isNativeShareSupported(): boolean {
        return !!(navigator.share && navigator.canShare);
    }

    /**
     * Helper to draw rounded rectangle
     */
    private roundRect(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        width: number,
        height: number,
        radius: number
    ): void {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }
}

// Singleton export
export const TradeShareService = new TradeShareServiceClass();
