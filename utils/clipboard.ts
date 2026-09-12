/**
 * clipboard — one place to copy text to the clipboard, tolerant of the
 * environments this app runs in: async navigator.clipboard (secure contexts),
 * a hidden-textarea execCommand fallback (file:// / http:// Electron dev and
 * older webviews), and a silent no-op when both are unavailable. Resolves
 * true only when the write actually happened so callers can show "Copied".
 */

export const copyText = async (text: string): Promise<boolean> => {
    if (!text) return false;
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch { /* fall through to the legacy path */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
};
