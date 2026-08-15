export const parseKeptAnalyst = (text: string): string | null => {
    const match = text.match(/^\s*KEPT:\s*(.+)$/im);
    if (!match) return null;
    const name = match[1].replace(/[.\s]+$/, '').trim();
    if (!name || /^none$/i.test(name)) return null;
    return name;
};
