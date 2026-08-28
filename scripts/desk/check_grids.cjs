/**
 * check_grids.cjs — one-shot dev validator for the pixel-art avatar grids
 * in components/desk/pixelAvatars.ts.
 *
 * Every grid in GRIDS and SPEAKING_GRIDS must be 16 columns wide and 20
 * rows tall, with only valid tokens (`[.HSMCTVEPW1234]`). A typo in any
 * row would crash the desk view at render time, so this script catches
 * the mistake before the tests do.
 *
 * Usage:  node scripts/desk/check_grids.cjs
 * Exit:   0 on success, non-zero with line numbers on failure.
 *
 * Not part of the runtime; the vitest tests in
 * tests/deskFrameAndTail.test.tsx enforce the same invariants. This
 * script is a fast smoke check when you're hand-editing a grid.
 */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'components', 'desk', 'pixelAvatars.ts'),
    'utf8',
);
const re = /[.HSMCTVEPW1234]/;
const lines = src.split('\n');
let block = null;
let failed = false;
for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const blockMatch = l.match(/^\s*(\w+):\s*\[/);
    if (blockMatch) block = blockMatch[1];
    const rowMatch = l.match(/'([^']*)'/);
    if (block && rowMatch) {
        const s = rowMatch[1];
        if (s.length !== 16) {
            console.log('LINE', i + 1, block, 'len', s.length, JSON.stringify(s));
            failed = true;
        } else {
            for (let j = 0; j < s.length; j++) {
                if (!re.test(s[j])) {
                    console.log('LINE', i + 1, block, 'col', j, 'bad char', JSON.stringify(s[j]));
                    failed = true;
                }
            }
        }
    }
    if (l.trim() === '],') block = null;
}
process.exit(failed ? 1 : 0);
