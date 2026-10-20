/**
 * toolKindIcons — the ONE mark for each kind of tool.
 *
 * A kind is a vocabulary (utils/toolKinds.ts), and a vocabulary with two
 * spellings is two vocabularies: the transcript's row would wear one glyph
 * and the Settings catalogue another, and the trader would be looking at two
 * different-looking kinds for the same work. So the marks live here, beside
 * the vocabulary they belong to, and every surface that draws a kind draws
 * this one.
 */
import React from 'react';
import { Cpu, FileText, NotebookPen, Palette, Search, Target, Wrench } from './Icons';
import type { ToolKind } from '../../utils/toolKinds';

export const KIND_GLYPH: Record<ToolKind, React.FC<{ className?: string }>> = {
    read: FileText,
    search: Search,
    compute: Cpu,
    draw: Palette,
    write: NotebookPen,
    present: Target,
    other: Wrench,
};
