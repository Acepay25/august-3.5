/**
 * SkillImportService — import skill files the user brings from outside
 * (a .md export from another august profile, a shared file, etc.) into
 * the harness's skills folder so the models can USE them in debates.
 *
 * Validation is strict but honest: a file must parse as a skill
 * (serializeSkill frontmatter shape — kind, status, ifCondition/… via
 * parseSkillMarkdown). Files that fail validation are reported, never
 * silently dropped. Names never overwrite: a colliding slug gets -2, -3…
 */

import { parseSkillMarkdown } from './SkillMemoryService';
import { skillFaceIssues, skillBodyCaps, hasUseWhenTrigger, scanSkillText, declaredCompatibility, inertDeclaredKeys, skillSupportRefs, resolveSiblingUrl, stampImportedSource, SKILL_SUPPORT_REF_MAX } from '../../utils/skillFrontmatter';
import { createMemoryFile, getMemoryFiles } from './MemoryFilesService';
import { getActiveUsername } from '../../utils/activeUser';
import { slugifyName } from './MemoryFilesService';

export interface SkillImportResult {
    imported: string[];
    skipped: string[];
    failed: Array<{ name: string; reason: string }>;
}

/** Find the skills folder id (creating the harness folders if needed). */
const skillsFolderId = async (username: string): Promise<string | null> => {
    const ensure = await import('./MemoryFilesService').then(m => m.ensureHarnessFolders(username));
    void ensure;
    return getMemoryFiles().folders.find(f => f.name === 'skills')?.id ?? null;
};

/** Unique file name in the skills folder: `slug.md`, `slug-2.md`, … */
const uniqueName = (base: string): string => {
    const existing = new Set(getMemoryFiles().files.map(f => f.name.toLowerCase()));
    const clean = `${slugifyName(base.replace(/\.md$/i, '')) || 'skill'}.md`;
    if (!existing.has(clean.toLowerCase())) return clean;
    for (let i = 2; i < 100; i += 1) {
        const candidate = `${clean.replace(/\.md$/, '')}-${i}.md`;
        if (!existing.has(candidate.toLowerCase())) return candidate;
    }
    return `${Date.now()}.md`;
};
/** A collision suffix that does NOT rewrite the name. `uniqueName` slugifies,
 *  which is right for a title a human typed and wrong for a BUNDLED file,
 *  whose name is an address: `scripts/helper.py` is the string the skill's own
 *  body tells a model to open, and `helperpy.md` makes a fetched file
 *  unreachable by the path that named it. */
const uniqueStoredName = (base: string): string => {
    const existing = new Set(getMemoryFiles().files.map(f => f.name.toLowerCase()));
    if (!existing.has(base.toLowerCase())) return base;
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    for (let i = 2; i < 100; i += 1) {
        const candidate = `${stem}-${i}${ext}`;
        if (!existing.has(candidate.toLowerCase())) return candidate;
    }
    return `${Date.now()}${ext}`;
};
/**
 * Import raw skill markdown strings (one per file). Returns a per-file
 * outcome so the UI can show exactly what happened.
 */
export const importSkillFiles = async (files: Array<SkillFileRead & { content: string }>): Promise<SkillImportResult> => {
    const username = getActiveUsername();
    const result: SkillImportResult = { imported: [], skipped: [], failed: [] };
    if (files.length === 0) return result;
    const folderId = await skillsFolderId(username);
    if (!folderId) {
        return { imported: [], skipped: [], failed: files.map(f => ({ name: f.name, reason: 'Skills folder unavailable' })) };
    }
    // ── FOLDER SHAPE (item 2): a picked folder whose files carry relPaths
    // imports as the SKILL.md format ships them — one skill plus its bundled
    // references/templates/scripts. A `SKILL.md` (basename) claims every
    // sibling file under the same top folder as a BUNDLED file, name-spaced
    // `<slug>__<path with / → __>` — exactly the layout the skill_view L2
    // reader addresses. Files without a relPath keep the single-file path
    // below, unchanged.
    const bundledGroups = new Map<string, { parent: string; files: Array<{ file: SkillFileRead & { content: string }; relSegments: string[] }> }>();
    const roots: Array<{ path: string[]; entry: { file: SkillFileRead & { content: string }; relSegments: string[] } }> = [];
    const support: Array<{ file: SkillFileRead & { content: string }; segs: string[] }> = [];
    const singles: typeof files = [];
    for (const file of files) {
        const rel = file.relPath;
        const segs = rel ? rel.split(/[/\\]/).filter(Boolean) : [];
        if (segs.length >= 2 && segs[segs.length - 1].toLowerCase() === 'skill.md') {
            roots.push({ path: segs.slice(0, -1), entry: { file, relSegments: segs } });
        } else if (segs.length >= 2) {
            support.push({ file, segs });
        } else {
            singles.push(file);
        }
    }
    for (const root of roots) {
        const key = root.path.join('/').toLowerCase();
        if (!bundledGroups.has(key)) bundledGroups.set(key, { parent: root.path[root.path.length - 1], files: [] });
        bundledGroups.get(key)!.files.push(root.entry);
    }
    for (const item of support) {
        // Attach a support file to the LONGEST skill root that is an ancestor
        // of its path. The prior test required "SKILL.md" to appear in the
        // SUPPORT file's own path, which never happens for references/ or
        // scripts/ — so every bundled file fell through as a failed single.
        const match = roots
            .filter(root => root.path.length < item.segs.length
                && root.path.every((seg, i) => item.segs[i].toLowerCase() === seg.toLowerCase()))
            .sort((a, b) => b.path.length - a.path.length)[0];
        if (!match) {
            singles.push(item.file);
            continue;
        }
        const key = match.path.join('/').toLowerCase();
        // Keep only the path BELOW the skill root: the bundled namespace is
        // `<slug>__<role>__<name>`, and the root segment is the slug itself.
        bundledGroups.get(key)!.files.push({ file: item.file, relSegments: item.segs.slice(match.path.length) });
    }

    /** Bundled-file name: `<slug>__<segments joined __>` — the flat,
     *  traversal-proof namespace L2 reads. The DIRECTORY segments are
     *  slugified; the LEAF keeps the name the author gave it, because that
     *  name is an address, not a title: a skill body that says
     *  `scripts/helper.py` is telling a model what to open, and the notebook
     *  must be able to resolve it. Only the `.md` the notebook wants is added
     *  when the file's own extension does not already end in one. */
    const bundledName = (slug: string, segs: string[]): string => {
        const tail = segs.slice(0, -1).map(x => slugifyName(x)).filter(Boolean);
        const raw = (segs[segs.length - 1] ?? '').replace(/[\\/:*?"<>|]/g, '').toLowerCase();
        const base = !raw || raw === '.' || raw === '..' ? 'file.md'
            : raw.endsWith('.md') || raw.endsWith('.json') ? raw : `${raw}.md`;
        return [slug, ...tail, base].join('__');
    };

    for (const { parent, files: group } of bundledGroups.values()) {
        const skillEntry = group.find(g => g.file.name.toLowerCase() === 'skill.md');
        if (!skillEntry) {
            for (const g of group) singles.push(g.file);
            continue;
        }
        const meta = parseSkillMarkdown(skillEntry.file.content);
        if (!meta || !meta.body.trim()) {
            result.failed.push({ name: skillEntry.file.name, reason: meta ? 'empty body' : 'Not a skill file — missing or invalid skill frontmatter' });
            for (const g of group) if (g !== skillEntry) singles.push(g.file);
            continue;
        }
        const groupFindings = group.flatMap(g => scanSkillText(g.file.content).map(f => `${g.file.relPath ?? g.file.name}: ${f.what}`));
        if (groupFindings.length > 0) {
            result.failed.push({ name: skillEntry.file.name, reason: `refused by the import scan: ${groupFindings.join('; ')}` });
            continue;
        }
        // The skill's slug: the spec-shaped frontmatter name when valid, else
        // the folder it arrived in — the folder is what the author called it.
        const slug = meta.name && /^[a-z0-9][a-z0-9-]*$/.test(meta.name) && meta.name.length <= 64
            ? meta.name
            : (slugifyName(parent) || uniqueName(parent).replace(/\.md$/, ''));
        const skillStored = uniqueName(`${slug}.md`);
        // The support files must follow the name the skill ACTUALLY took: when
        // uniqueName renamed a colliding skill to `<slug>-2.md`, its bundle kept
        // `<slug>__…` and could never be found from the renamed skill
        // (the 2026-10-27 audit S-5).
        const storedSlug = skillStored.replace(/\.md$/i, '');
        try {
            await createMemoryFile(folderId, skillStored, stampImportedSource(skillEntry.file.content), username, false);
            result.imported.push(skillEntry.file.relPath ?? skillEntry.file.name);
        } catch (err) {
            result.failed.push({ name: skillEntry.file.name, reason: err instanceof Error ? err.message : String(err) });
            continue;
        }
        for (const g of group) {
            if (g === skillEntry) continue;
            const name = bundledName(storedSlug, g.relSegments);
            try {
                await createMemoryFile(folderId, uniqueStoredName(name), g.file.content, username, false);
                result.imported.push(g.file.relPath ?? g.file.name);
            } catch (err) {
                result.failed.push({ name: g.file.relPath ?? g.file.name, reason: err instanceof Error ? err.message : String(err) });
            }
        }
    }

    for (const file of singles) {
        const meta = parseSkillMarkdown(file.content);
        if (!meta || !meta.body.trim()) {
            result.failed.push({ name: file.name, reason: meta ? 'empty body' : 'Not a skill file — missing or invalid skill frontmatter' });
            continue;
        }
        // The import scan (item 6): destructive or exfiltrating text REFUSES
        // the file with the finding named — a procedure that phones home or
        // wipes a disk is not a procedure this app stores, whatever the
        // frontmatter says. Nothing auto-runs either way; the scan is what
        // keeps the text from ever sitting in the library as a loaded recipe.
        const findings = scanSkillText(file.content);
        if (findings.length > 0) {
            result.failed.push({ name: file.name, reason: `refused by the import scan: ${findings.map(f => f.what).join('; ')}` });
            continue;
        }
        const caps = skillBodyCaps(meta.body);
        if (caps.overHard) {
            result.failed.push({ name: file.name, reason: `body is ${caps.chars.toLocaleString()} chars — over the 100k hard cap; move material into references/` });
            continue;
        }
        if (caps.overSoft) console.warn(`[Skills] import "${file.name}": ${caps.lines} lines is over the ~200-line soft cap — long material belongs in a bundled references/ file`);
        if (!hasUseWhenTrigger(meta.description ?? '')) console.warn(`[Skills] import "${file.name}": the description has no "Use when" trigger — it is the activation key, and a vague one rarely activates`);
        // The SKILL.md name/description contract is WARNED on, not enforced:
        // August's own exports carry prose titles in `name:`, and the contract
        // governs third-party files, not this profile's own round-trips. An
        // over-long description is truncated by the next rewrite, so it is
        // said out loud here instead of silently shrinking later.
        const issues = skillFaceIssues({
            name: meta.name ?? file.name.replace(/\.md$/i, ''),
            description: meta.description ?? '',
            body: meta.body,
        });
        if (issues.length > 0) console.warn(`[Skills] import "${file.name}": ${issues.join('; ')} (imported anyway — August's own exports use prose names)`);
        // A key this app cannot honour is SAID, not quietly ignored. The author
        // who wrote `requires_toolsets` believes it gates something; August
        // names no toolsets, so it says so and moves on. The line itself still
        // round-trips untouched — reading a declaration is not owning it.
        const inert = inertDeclaredKeys(declaredCompatibility((meta.unknownFrontmatter || []).join('\n')));
        if (inert.length > 0) {
            console.warn(`[Skills] import "${file.name}": ${inert.join(', ')} ${inert.length === 1 ? 'is' : 'are'} kept and honoured by nothing — August names no toolsets to resolve them against`);
        }
        // Same trigger already learned → skip as duplicate (honest, not
        // silent). Skills WITHOUT a trigger condition dedupe on the
        // normalized title (the first `# heading`), so frontmatter-less
        // bodies can't be imported repeatedly under shuffled names.
        const triggerKey = (meta.ifCondition ?? `#title:${(meta.body.match(/^#\s+(.+)$/m)?.[1] ?? file.name).trim().toLowerCase()}`).toLowerCase();
        const dup = getMemoryFiles().files.filter(f => f.name.toLowerCase().endsWith('.md'))
            .some(f => {
                const other = parseSkillMarkdown(f.content);
                if (!other) return false;
                const otherKey = (other.ifCondition ?? `#title:${(other.body.match(/^#\s+(.+)$/m)?.[1] ?? f.name).trim().toLowerCase()}`).toLowerCase();
                return otherKey === triggerKey;
            });
        if (dup) {
            result.skipped.push(file.name);
            continue;
        }
        try {
            await createMemoryFile(folderId, uniqueName(file.name), stampImportedSource(file.content), username, false);
            result.imported.push(file.name);
        } catch (err) {
            result.failed.push({ name: file.name, reason: err instanceof Error ? err.message : String(err) });
        }
    }
    return result;
};

/** A URL import is the folder import with a web server in place of the picked
 *  folder (item 6): the SKILL.md, plus the references/, templates/, scripts/
 *  and assets/ siblings its body names, handed to importSkillFiles with the
 *  same relPaths a folder pick would have produced. That is deliberate — ONE
 *  bundling path, ONE import scan, ONE confirmation, not a URL-shaped second
 *  one a reviewer would have to audit twice.
 *
 *  Every rule ends in a refusal that reaches the receipt, never a silent drop:
 *    https only, for the head and for every sibling;
 *    a sibling must resolve on the head's own host and stay under the head's
 *    own folder (resolveSiblingUrl decides that before a request leaves);
 *    ≤12 siblings, ≤200kB each and ≤600kB for the batch — the batch total is
 *    applied in body order after the fetches settle, so two concurrent
 *    siblings cannot both spend the same bytes;
 *    one 20s deadline shared by the concurrent sibling fetches, so the import
 *    cannot outlast the user's patience;
 *    a body that is not text — a NUL byte or an undecodable one — is refused
 *    on its content, never on its extension.
 *  A script is fetched AS TEXT and nothing ever runs it; it still rides the
 *  scanSkillText the folder import already applies to every file in a group,
 *  which is what keeps a `scripts/payload.sh` out of the library rather than
 *  executing it. */
const HEAD_TIMEOUT_MS = 15_000;
const HEAD_MAX_CHARS = 400_000;
const SIBLING_TIMEOUT_MS = 20_000;
const SIBLING_MAX_CHARS = 200_000;
const BATCH_MAX_CHARS = 600_000;

export interface UrlSkillFetch {
    /** Every file this fetch produced, head first, each carrying the relPath
     *  that makes importSkillFiles bundle the siblings under the skill's slug.
     *  Absent only when the head itself could not be fetched. */
    files?: Array<SkillFileRead & { content: string }>;
    /** A sibling the body named that did NOT arrive, with the reason. */
    refused?: Array<{ path: string; reason: string }>;
    error?: string;
}

/** What a timed-out fetch looks like, told from any other throw. */
const fetchFailure = (err: unknown, timeoutNote: string): string => {
    if (err instanceof Error) {
        return err.name === 'TimeoutError' || err.name === 'AbortError' ? timeoutNote : err.message;
    }
    return String(err);
};

/** The notebook stores text and the L2 reader hands it to a model, so a
 *  binary body is refused on its CONTENT, not on its extension: a NUL byte or
 *  a UTF-8 replacement character means the bytes were never text, whatever
 *  they were named. */
const looksBinary = (text: string): boolean => text.includes('\u0000') || text.includes('\uFFFD');

/** The folder name the fetched files claim to have arrived in. A spec-shaped
 *  `…/my-skill/SKILL.md` keeps its own folder; a bare `…/my-skill.md` gets a
 *  folder named after the file, so its siblings still group under one root. */
const folderOf = (head: URL): string => {
    const segs = head.pathname.split('/').filter(Boolean);
    const file = decodeURIComponent(segs.pop() ?? '');
    const parent = segs.length ? decodeURIComponent(segs[segs.length - 1]) : '';
    const stem = file.replace(/\.md$/i, '');
    const candidate = parent || (stem && stem.toLowerCase() !== 'skill' ? stem : '');
    return slugifyName(candidate) || 'imported-skill';
};

export const fetchSkillFromUrl = async (rawUrl: string): Promise<UrlSkillFetch> => {
    const raw = rawUrl.trim();
    if (!/^https:\/\//i.test(raw)) return { error: 'only https:// URLs are fetched' };
    let head: URL;
    try { head = new URL(raw) } catch { return { error: 'that is not a URL' } }
    const folder = folderOf(head);

    let headText: string;
    try {
        const res = await fetch(head.toString(), { signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
        if (!res.ok) return { error: `the URL answered ${res.status}` };
        const text = await res.text();
        if (text.length > HEAD_MAX_CHARS) return { error: `the URL returned ${(text.length / 1000).toFixed(0)}kB of text — over the 400kB fetch cap` };
        if (looksBinary(text)) return { error: 'the URL is not text — a skill import stores markdown, and a binary body is never read' };
        headText = text;
    } catch (err) {
        return { error: fetchFailure(err, `the fetch timed out after ${HEAD_TIMEOUT_MS / 1000}s`) };
    }

    // The head is always named SKILL.md with a two-segment relPath, whatever
    // the URL's last segment was spelled: that pair is how importSkillFiles
    // recognises a folder root and starts bundling.
    const files: Array<SkillFileRead & { content: string }> = [
        { name: 'SKILL.md', content: headText, relPath: `${folder}/SKILL.md` },
    ];
    const refused: Array<{ path: string; reason: string }> = [];

    const found = skillSupportRefs(headText);
    if (found.length === 0) return { files, refused };
    const candidates = found.slice(0, SKILL_SUPPORT_REF_MAX);
    if (found.length > SKILL_SUPPORT_REF_MAX) {
        refused.push({ path: '(the rest)', reason: `the body names more than ${SKILL_SUPPORT_REF_MAX} support files and only the first ${SKILL_SUPPORT_REF_MAX} are fetched` });
    }

    // One deadline for the whole concurrent sibling fetch — AbortSignal is
    // shareable, and a per-file timer would let 12 slow files run 12×20s.
    const deadline = AbortSignal.timeout(SIBLING_TIMEOUT_MS);
    type Sibling = { path: string; text?: string; reason?: string };
    const settled = await Promise.all(candidates.map(async (ref): Promise<Sibling> => {
        const target = resolveSiblingUrl(head, ref);
        if (!target.ok) return { path: ref, reason: target.reason };
        try {
            const res = await fetch(target.url, { signal: deadline });
            if (!res.ok) return { path: ref, reason: `the URL answered ${res.status}` };
            const text = await res.text();
            if (looksBinary(text)) return { path: ref, reason: 'the file is not text — only text is storable in the notebook' };
            if (text.length > SIBLING_MAX_CHARS) return { path: ref, reason: `${(text.length / 1000).toFixed(0)}kB — over the ${SIBLING_MAX_CHARS / 1000}kB per-file cap` };
            return { path: ref, text };
        } catch (err) {
            return { path: ref, reason: fetchFailure(err, `the fetch did not finish inside the ${SIBLING_TIMEOUT_MS / 1000}s batch window`) };
        }
    }));

    // Batch budget, applied in body order so the receipt is reproducible: the
    // files a skill names first are the ones it most likely needs.
    let room = BATCH_MAX_CHARS - headText.length;
    for (const s of settled) {
        if (s.reason) { refused.push({ path: s.path, reason: s.reason }); continue; }
        const text = s.text ?? '';
        if (text.length > room) {
            refused.push({ path: s.path, reason: `the batch was already at its ${(BATCH_MAX_CHARS / 1000).toFixed(0)}kB cap` });
            continue;
        }
        room -= text.length;
        files.push({ name: s.path.split('/').pop() ?? `${folder}.md`, content: text, relPath: `${folder}/${s.path}` });
    }
    return { files, refused };
};

/** Read a FileList of .md files into per-file outcomes. One unreadable
 *  file must NOT sink the batch (matches the service's "report, never
 *  silently drop" contract): successes carry content, failures carry a
 *  reason and surface as normal import failures in the UI. */
export interface SkillFileRead {
    name: string;
    content?: string;
    error?: string;
    /** The path inside the picked folder, when the picker supplied one
     *  (webkitRelativePath). This is what lets a FOLDER import keep its
     *  shape: `my-skill/references/checklist.md` knows it belongs to the
     *  skill whose SKILL.md sits in `my-skill/`. */
    relPath?: string;
}

export const readSkillFiles = async (fileList: FileList | File[]): Promise<SkillFileRead[]> => {
    const results = await Promise.allSettled(
        Array.from(fileList).map(file => new Promise<{ name: string; content: string; relPath?: string }>((resolve, reject) => {
            const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
            const reader = new FileReader();
            reader.onload = () => {
                if (typeof reader.result === 'string') {
                    resolve({ name: file.name, content: reader.result, ...(rel ? { relPath: rel } : {}) });
                } else reject(new Error('File is not readable as text'));
            };
            reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
            reader.readAsText(file);
        })),
    );
    return results.map((r, i) =>
        r.status === 'fulfilled'
            ? { name: r.value.name, content: r.value.content, ...(r.value.relPath ? { relPath: r.value.relPath } : {}) }
            : { name: (Array.from(fileList)[i] as File).name, error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
    );
};
