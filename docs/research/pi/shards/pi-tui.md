# pi :: pi-tui

**Repo:** `pi` (`C:/Users/rober/AppData/Local/Temp/harness-research/pi`), package `@earendil-works/pi-tui` v1.4.0
**Files in shard:** 125 — **read: 119, skipped: 6** (all six are binary native prebuilds; their magic bytes and sizes were confirmed on disk)
**Size:** 1676 KB

**What this shard covers.** `packages/tui` is the reference harness's *own* terminal-UI framework — not an agent, not a trading surface. It is a component tree (`Component` → `Container`/`Box`/`Text`/`Markdown`/`Editor`/`Input`/`SelectList`/`SettingsList`/`ScrollView`/`Image`), two interchangeable renderers (`TuiMainScreen` into the terminal's scrollback, `TuiAltScreen` into the alternate buffer with application-owned scrolling), a keyboard-decoding layer (`keys.ts` + `keybindings.ts`), ANSI/width/grapheme utilities (`utils.ts`, `colors.ts`, `oklab.ts`), a LaTeX→Unicode renderer, Kitty/iTerm2 inline-image protocols, and a small vendored native layer (clipboard + modifier keys) written without Node headers.

**Why it matters for August Trading.** Most of the *surface* (ANSI cells, Kitty images, LaTeX in a terminal) does not transfer. The *architecture* transfers almost wholesale: an explicit component→renderer boundary with a cursor marker the renderer resolves, a mouse-result protocol that returns a decision object instead of a boolean, a named-action keybinding registry with conflict detection, clone-on-push undo with an explicit "undo unit" policy, abortable+debounced autocomplete, a content-change-keyed search index, a bounded streaming writer, an allocation-churn benchmark, and a crash dump that names the measurement that went wrong.

---

## 1. File-by-file

### Tier 1 — load-bearing source (full entry)

#### `src/tui.ts` — the component/renderer contract (1543 lines)
- **Purpose:** Defines `Component`, `Container`, `Focusable`, `OverlayHandle`/`OverlayOptions`, the `TUI` interface, and `TuiBase` — the shared half of both renderers. Also owns the **fake-cursor protocol** and **overlay compositing**.
- **Key abstractions:** `Component` (`render(width) => string[]`, `invalidate()`, optional `handleInput`/`handleMouse`); `Focusable` (`focused`); `TuiMouseEvent`/`TuiMouseEventResult`; `TuiMouseDispatchTarget`/`TuiMouseDispatchResult`; `OverlayHandle` (`hide`, `focus`, `unfocus`, `isFocused`, `setHidden`).
- **Data flow:** input bytes → `StdinBuffer` → `matchesKey` against the `KeybindingsManager` → the focused component's `handleInput` → `requestRender()` → the renderer calls `component.render(width)` per node → lines are composited → written.
- **Non-obvious design decisions:**
  - **The cursor is a marker, not a glyph.** `renderFakeCursor()` wraps the drawn cursor in zero-width APC markers (`FAKE_CURSOR_START`/`END`); the renderer resolves them into `\x1b[7m … \x1b[27m`, or omits them when `showHardwareCursor` is on. `CURSOR_MARKER` is a separate zero-width APC the renderer uses to place the real hardware cursor for IME.
  - **`TuiMouseEventResult` is a decision object, not a boolean** (`tui.ts:46`): `handled` (stop propagation), `capture` (route subsequent drag/release to me), `focus` (take keyboard focus), `render` (explicitly request or suppress a repaint). **Defaults differ per event type**: move and release default to *not* rendering; press, click, drag and wheel default to rendering.
  - **A delegating container keeps keyboard focus** (`dispatchMouseEvent`, `tui.ts:81`): when a container forwards a mouse event to a child, `focusTarget` is the *container*, not the child — "focusing the child directly would leave focus on a detached component once the host removes it, e.g. a closed settings submenu."
  - `compositeTuiLine` composites an overlay into a base line by **visible column**, not by string index — it slices the base into "before"/"after" segments around the overlay range and splices the overlay between them.
  - `queryTerminalColors` (OSC 10/11/4) resolves on the DA1 sentinel or a timeout, and **`onLateReply` keeps collecting** replies after the timeout so a slow link still gets its colours.
- **Edge cases & failure handling:** `TuiBase` exposes `captureRenderState()`/`restoreRenderState()` so a renderer can be swapped without a visible flash.
- **Surprising:** `tui.ts` exports `Marked`/`Token`/`Tokens` re-exports through `index.ts` — the markdown *parser* is deliberately public.

#### `src/tui-alt-screen.ts` — the fullscreen renderer (1797 lines)
- **Purpose:** Renders into the alternate buffer with application-owned scrolling, mouse selection, OSC-8 link activation, Kitty image placement, and in-transcript search.
- **Key abstractions:** `TuiAltScreen extends TuiBase`; `SelectionPoint`/`SelectionRange`/`SelectionGranularity` ("character" | "word" | "line"); `ClickTarget` (double/triple-click detection); `CachedKittyImage`; `SgrMouseEvent`.
- **Data flow:** `setLayoutRoot(root)` → `renderLayoutFrame()` → `LayoutFrame.lines` → per-row diff against `previousScreen` → a buffer of cursor moves + `CSI 2026` synchronized-output begin/end → one `terminal.write()`.
- **Non-obvious design decisions:**
  - **Mouse tracking is "button-motion", not "all-motion"** under tmux/Zellij/GNU Screen — a deliberate reduction in event volume (`tui-alt-screen.ts:68`).
  - **Wheel events that no component handles scroll the transcript** instead of being delivered raw to the focused overlay; an overlay that wants the wheel must implement `handleMouse` (a 1.2.0 fix).
  - **Double-click word selection keeps paths and kebab-case tokens whole** via `TERMINAL_WORD_SELECTION_JOINERS = new Set(["/", "-"])` — because regular mode delegates double-click to the terminal, fullscreen has to imitate it.
  - `PAGE_SCROLL_OVERLAP = 4` — a page scroll keeps 4 rows of overlap so the reader keeps context.
  - **Kitty offscreen images are cached under three separate quotas** (`MAX_CACHED_OFFSCREEN_KITTY_IMAGES = 16`, `…TRANSMISSION_BYTES = 32 MiB`, `…DECODED_BYTES = 64 MiB`), evicted least-recently-visible.
  - `isFollowingOutput` / `followSuppressedAtEnd`: scrolling up while new output arrives suppresses the auto-follow, but `scrollToEnd` re-enables it.
- **Edge cases & failure handling:** a Kitty image whose first row is above the viewport is **cropped** (`cropKittyImageLine`) rather than dropped; images that leave the viewport have their placements deleted before the screen is cleared.
- **Surprising:** `AltScreenFlashContainer` renders transient messages in reverse video with `timer.unref()` so a pending flash never keeps the process alive.

#### `src/tui-main-screen.ts` — the scrollback renderer (656 lines)
- **Purpose:** Renders into the terminal's main buffer so output stays in the scrollback.
- **Key abstractions:** `BoundedTerminalWriter`; `TuiMainScreenRenderState`; `KittyImageHeader` parsing.
- **Data flow:** render → overlay composite → cursor extraction → **line resets** → compare against `previousLines` → either a full redraw or a differential repaint from `firstChanged` to `lastChanged`.
- **Non-obvious design decisions:**
  - **`BoundedTerminalWriter` streams output in 1 MiB chunks** so a full render never builds one string larger than V8's limit; it splits at chunk boundaries **preserving surrogate pairs** so each write stays valid UTF-16.
  - **Termux is special-cased on height change** (`isTermuxSession()`): a height change normally forces a full redraw, but on Termux the software keyboard toggling would replay the entire history on every toggle — so the redraw is skipped.
  - **A width overflow is a hard error with a crash file.** The renderer writes `pi-tui-crash.log` containing the terminal width, the offending line's visible width, and *every* rendered line with its width, then throws an error that names the log path and tells the author to use `visibleWidth()`/`truncateToWidth()`.
  - Kitty image blocks are **expanded** in the changed range (`expandChangedRangeForKittyImages`) so an image and its reserved blank rows are never half-redrawn; a Kitty pre-clear that would scroll the viewport forces a full redraw instead.
  - `cursorRow` (end of content) and `hardwareCursorRow` (the real cursor) are tracked **separately** — one is for viewport arithmetic, the other for movement.
- **Edge cases & failure handling:** `setClearOnShrink()` decides whether shrinking content forces a full redraw; overlays suppress it (they need the padding).
- **Surprising:** `restoreRenderState` deliberately **blanks image lines** (`isImageLine(line) ? "" : line`) so a restored state never resurrects a stale Kitty placement.

#### `src/editor.ts` — the multi-line editor (2473 lines)
- **Purpose:** The prompt editor: multi-line editing, word wrap, autocomplete, paste handling, history, undo, kill ring.
- **Key abstractions:** `Editor extends Component, Focusable, EditorComponent`; `TextChunk`/`LayoutLine`; `segmentWithMarkers()`; `wordWrapLine()`.
- **Data flow:** raw input → keybinding match → mutate `state.lines`/`cursorLine`/`cursorCol` → `layoutText(contentWidth)` produces visual lines with a cursor position → `render(width)` paints them.
- **Non-obvious design decisions:**
  - **Paste markers are atomic graphemes.** A large paste becomes `[paste #1 +50 lines]`; `segmentWithMarkers` merges the whole marker into ONE segment so cursor movement, deletion and word-wrap treat it as a unit. `getExpandedText()` expands the registry only when the text leaves the editor.
  - **The paste registry is renumbered in ascending id order** when the markers appear out of order in the text, and undo restores the registry, not just the string.
  - **Undo units are explicit**: consecutive word characters coalesce; whitespace is its own unit; **cursor movement starts a new unit**; a no-op delete pushes no snapshot.
  - **`wordWrapLine` re-checks overflow after backtracking** to a wrap opportunity, and "splits an oversized atomic segment across multiple chunks" — a paste marker wider than the terminal does not corrupt the layout.
  - **Sticky column**: moving up/down through shorter lines preserves the *target* column; every horizontal action resets it.
  - `Ctrl+]` jump mode awaits the next keypress and moves to the first occurrence — with a case-sensitive toggle.
- **Edge cases & failure handling:** `getLines()` returns a **defensive copy**; `getExpandedText()` falls back to `getText()` for a custom editor that does not implement it (whose failure mode is a corrupted prompt).
- **Surprising:** the "backslash+Enter" workaround — a standalone trailing backslash before Enter is converted to a newline — is a separate, tested feature.

#### `src/markdown.ts` — the markdown renderer (1047 lines)
- **Purpose:** Renders markdown to terminal lines with theming, tables, lists, blockquotes, code blocks and inline LaTeX.
- **Key abstractions:** `Markdown extends Component`; `MarkdownTheme` (a record of style functions); `StrictStrikethroughTokenizer extends Tokenizer`; `LatexToken`; `TABLE_DELIMITER_ROW_REGEX`.
- **Data flow:** source → `marked` lexer (with a CJK-friendly extension and a strict `~~` tokenizer) → token tree → per-token rendering into `string[]`, with `wrapTextWithAnsi` for wrapping and `visibleWidth` for measurement.
- **Non-obvious design decisions:**
  - **The transform is cached by (source, availableWidth)** — `MarkdownOptions.transform` is invoked once per distinct width; `setText` and `invalidate` control the cache.
  - **An unclosed `$$` must not swallow a GFM table.** The block-math token explicitly refuses to span a table, and the streaming "pending math" fallback refuses to treat a following table as pending math (fix #11159, v1.4.0).
  - **Table columns are solved by a three-stage width allocator**: natural widths → min-word widths (the longest unbroken token, capped at 30) → proportional growth/shrink with a rounding-leftover loop. If the table cannot fit at all it **falls back to raw markdown**.
  - `preserveOrderedListMarkers` and `preserveSourceEscapes` are options — the default normalises `1. 1. 1.` to `1. 2. 3.` and unescapes punctuation.
  - **LaTeX detection is deliberately conservative**: `$…$` is refused when the content ends with whitespace, is followed by a digit, is an all-caps identifier, or contains a backtick — so currency (`$5`), shell variables (`$PATH`) and code spans are not maths.
- **Edge cases & failure handling:** an incomplete math delimiter renders as *pending* raw text until it closes (so a streaming answer is not corrupted mid-token).
- **Surprising:** `markdown.ts` imports `marked-cjk-friendly` — a fork of `marked` — because upstream's emphasis rules break next to CJK punctuation.

#### `src/utils.ts` — width, ANSI and wrapping (1402 lines)
- **Purpose:** Every measurement and every ANSI operation in the package: `visibleWidth`, `truncateToWidth`, `sliceByColumn`, `wrapTextWithAnsi`, `stripTerminalSequences`, `getOsc8LinkAtColumn`, `normalizeTerminalOutput`.
- **Key abstractions:** `AnsiCodeTracker` (a stateful SGR/hyperlink tracker); `graphemeWidth`; `asciiVisibleWidth` (the fast path); `ansiCodeLength`/`extractAnsiCode`; `ActiveHyperlink`.
- **Data flow:** a styled string → `ansiCodeLength` walks it → visible text is segmented with `Intl.Segmenter` → each grapheme is measured by `graphemeWidth` → the width is summed.
- **Non-obvious design decisions:**
  - **A three-tier width fast path**: (1) printable-ASCII-with-ANSI → `asciiVisibleWidth` with no allocation; (2) an LRU-ish `widthCache` of 512 non-ASCII strings; (3) full grapheme segmentation.
  - **`graphemeWidth` is a corrected `string-width`**: emoji are detected with a cheap `couldBeEmoji` pre-filter before the expensive `\p{RGI_Emoji}` test; **regional indicators are forced to width 2** even when isolated, because terminals render a partial flag as full-width and differential rendering would drift.
  - **Thai/Lao `AM` vowels are decomposed** in `normalizeTerminalOutput` (`ำ` → `ํา`) — same cell width, no stale-cell artefact — and **tabs are expanded to 3 spaces only outside control sequences**.
  - **Line breaks close underline specifically, not everything** (`getLineEndReset()`): a full `\x1b[0m` would kill the background colour of the padding.
  - **OSC 8 hyperlinks keep their original terminator** (BEL vs ST) across wrapping, because some terminals only make BEL-terminated links clickable (OAuth login URLs use BEL).
  - **`flattenLines(lines)`** — `Number(line)` reads the string whole, which makes V8 flatten a rope-built string in place so a cached line stops retaining several times its own size. A one-line memory optimisation with the reasoning in a comment.
  - `truncateToWidth` keeps a **contiguous prefix**: once a wide grapheme does not fit, it does not skip it and resume later.
- **Edge cases & failure handling:** an unterminated escape sequence is treated as zero-width control characters; malformed ANSI prefixes do not hang the truncator.
- **Surprising:** `visibleWidth` counts a tab as **three** columns — a package-wide convention that has to agree with the layout code or the terminal's own tab stops will wrap differently.

#### `src/keys.ts` — keyboard decoding (1455 lines)
- **Purpose:** Decode a raw terminal byte sequence into a typed `KeyId` (`ctrl+shift+p`, `alt+enter`, `super+k`, …) across four protocols.
- **Key abstractions:** `KeyId` (a recursive template-literal type over `Letter|Digit|SymbolKey|SpecialKey` × `ctrl|shift|alt|super`); `Key` (a typed helper object); `ParsedKittySequence`; `MODIFIERS` bitmask; `LEGACY_SEQUENCE_KEY_IDS`.
- **Data flow:** raw bytes → `parseKittySequence` (CSI-u) → `parseModifyOtherKeysSequence` (xterm) → legacy table → `formatParsedKey` → a `KeyId` string.
- **Non-obvious design decisions:**
  - **Four protocols coexist**: Kitty CSI-u, xterm `modifyOtherKeys`, legacy VT sequences, and the kitty-compat mode. Every match is tried in order and the Kitty protocol's presence changes the meaning of ambiguous sequences (`\x1b\r` and `\n` are *shift+enter* under Kitty, *alt+enter* otherwise).
  - **The base-layout fallback is restricted on purpose** (`keys.ts:701`): the base-layout key is only consulted when the codepoint is *not* a Latin letter, digit or known symbol — otherwise Dvorak/Colemak/xremap would make `Ctrl+K` falsely match `Ctrl+V`.
  - **A logical symbol match** consumes an implicit Shift: Kitty reports `+` as Shift plus the physical `=`, and a binding naming `+` must still match.
  - **Raw `0x08` is ambiguous** — Ctrl+Backspace on Windows Terminal, plain Backspace elsewhere — and is resolved by `isWindowsTerminalSession()` (which is false over SSH).
  - `decodeKittyPrintable` **rejects unsupported modifier bits** so a Super-modified terminal event never inserts a stray character.
- **Edge cases & failure handling:** `parseKeyId` rejects a duplicated modifier and a key containing `+` (except the literal `+`).
- **Surprising:** `parseKey` is mode-aware *globally* — the module keeps a module-level `_kittyProtocolActive` flag, so the same bytes parse differently depending on a terminal negotiation that happened at startup.

#### `src/autocomplete.ts` — slash commands, `@` files, paths (858 lines)
- **Purpose:** The editor's completion engine.
- **Key abstractions:** `AutocompleteProvider` (interface: `getSuggestions(lines, cursorLine, cursorCol, {signal, force})`, `applyCompletion(...)`, optional `shouldTriggerFileCompletion`, optional `triggerCharacters`); `CombinedAutocompleteProvider`; `SlashCommand` (with an optional **async** `getArgumentCompletions`); `AutocompleteItem`; `AutocompleteSuggestions`.
- **Data flow:** text before the cursor → three-way dispatch: `@` prefix → fuzzy `fd` search; `/` at line start → slash commands (then `/cmd <arg>` → the command's own argument completer); otherwise a path-looking prefix → a local `readdirSync` listing.
- **Non-obvious design decisions:**
  - **Two file backends**: `readdirSync` for exact prefix completion (cheap) and an external `fd` child process for fuzzy `@` search (fast, respects `.gitignore`).
  - **Every `fd` query segment is regex-escaped** and joined with a `[\\/]` alternation, so `[` or `(` in a query cannot break the pattern (fixed in v1.4.0).
  - **Slash-command filtering runs twice**: first against the *bare* name (stripping the `skill:` prefix), then a second pass adds only the commands that matched on the *full* prefixed name. Without it, `/skill` showed nothing.
  - `PATH_WRAPPERS` strips a leading `(`, `[`, `{`, `<` or backtick from a token **unless the token also contains the matching closer** — `(~/Dev<Tab>` works, `app/[slug]/pa` is not mangled.
  - **The `fd` child is SIGKILLed on abort**, and results are discarded if the signal fired before the result arrives.
  - `scoreEntry` is a hand-rolled 100/80/50/30 ladder, with directories +10, then ties broken by depth, then path length.
- **Edge cases & failure handling:** every filesystem call is wrapped and returns `[]`; a `fd` non-zero exit or empty stdout yields `[]`; broken symlinks are treated as files.
- **Surprising:** `applyCompletion` has **four near-identical branches** (slash command / `@` attachment / command argument / plain path) that each re-implement "insert the value and fix the cursor for a trailing quote" — copy-paste waiting to drift.

#### `src/alt-screen-search.ts` — in-transcript search (327 lines)
- **Purpose:** Incremental search over the rendered transcript, with a cached corpus and a self-drawing search panel.
- **Key abstractions:** `AltScreenSearchIndex`; `SearchCorpus` + `SearchSourceSpan`; `AltScreenSearchMatch`/`AltScreenSearchSegment`; `AltScreenSearchComponent`.
- **Data flow:** rendered lines → `stripTerminalSequences` → a flattened plain-text corpus plus a span table mapping text offsets back to (row, startCol, endCol) → an escaped regex `matchAll` → matches converted back into per-row column segments.
- **Non-obvious design decisions:**
  - **An ASCII fast path**: a line matching `/^[\x20-\x7e]*$/` is indexed as whole space-delimited runs with `linearColumns: true`, avoiding per-cell grapheme segmentation and per-cell allocations. Non-ASCII lines fall back to `Intl.Segmenter` with `linearColumns: false` (a grapheme's width ≠ its length).
  - **The corpus inserts one space between spans**, so a match can never span a line boundary — the separator guarantees each match lives inside one contiguous run.
  - **The index caches on content, not on render**: the source is compared element-wise, and matches are recomputed only when the *normalised query* changed. `search()` returns `{matches, changed}` so the caller knows whether to repaint.
  - **The panel shows the real keybinding labels** (`getKeybindings().getKeys("tui.altScreen.searchPrevious")[0]`), degrading to bare arrows when the terminal is too narrow and to `"Unbound"` when a key has no binding. On macOS `alt` is relabelled `Option`.
  - `setHoveredNavigationDirection` returns `true` only on a **change**, so the caller knows whether a repaint is needed.
- **Edge cases & failure handling:** `safeWidth === 1` returns a degenerate 3-row box (`┌ │ └`) rather than throwing; the query is regex-escaped so a user typing `(` cannot break the matcher.
- **Surprising:** the panel propagates focus to its inner `Input` (`set focused(value) { …; this.input.focused = value; }`) — without that, the IME candidate window opens in the wrong place.

#### `src/terminal.ts` — the process-terminal adapter (630 lines)
- **Purpose:** `ProcessTerminal implements Terminal` — raw mode, bracketed paste, Kitty keyboard-protocol negotiation, `modifyOtherKeys` fallback, OSC 7501 program status, OSC 9;4 progress, resize handling.
- **Key abstractions:** `Terminal` (the interface every renderer talks to); `KeyboardProtocolNegotiationSequence`; `resolveEscapeTimeoutMs`.
- **Data flow:** stdin → `StdinBuffer` → per-sequence `data` events → negotiation detection → `forwardInputSequence` → the TUI's input handler.
- **Non-obvious design decisions:**
  - **The negotiation is sentinel-driven, not timeout-driven**: pi writes the Kitty query **and** a DA1 device-attributes query. A terminal that does not know Kitty replies with DA1, which *is* the "no Kitty" signal — so the fallback engages immediately with no startup timeout. The same DA sentinel is reused for the OSC 7501 query.
  - **`resolveEscapeTimeoutMs`**: 10 ms normally, **100 ms over SSH** (legacy Alt+key is ESC + a byte, and the byte may arrive late), overridable with `PI_TUI_ESC_TIMEOUT`. Invalid values are ignored, not clamped to zero.
  - **`drainInput()`** disables the Kitty protocol *first*, then waits for stdin to go idle, so a late key-**release** event cannot leak into the parent shell over a slow SSH link.
  - **`restoreOnExit(before, after)`** writes the mode resets with `fs.writeSync(process.stdout.fd, …)` — `process.stdout.write` is asynchronous on some platforms and would not flush during `process.exit`.
  - `process.stdin.pause()` on `stop()` prevents a buffered Ctrl+D from being re-read after raw mode is off (a race that closed the parent shell over SSH).
- **Edge cases & failure handling:** `refreshTerminalDimensions()` sends SIGWINCH to itself and **swallows EACCES** — restricted seccomp/LSM environments forbid it and the refresh is simply skipped.
- **Surprising:** on Windows, `enableWindowsVTInput()` (a native addon) turns on `ENABLE_VIRTUAL_TERMINAL_INPUT`, because libuv's `ReadConsoleInputW` otherwise discards modifier state and Shift+Tab arrives as a plain tab.

#### `src/terminal-image.ts` — capability detection and inline images (769 lines)
- **Purpose:** Detect what the terminal can do, and encode/decode Kitty and iTerm2 images.
- **Key abstractions:** `TerminalCapabilities {images, trueColor, hyperlinks}`; `ImageProtocol`; `ImageDimensions`; `ImageRenderOptions`; `getCapabilities`/`setCapabilities`/`setCapabilityOverrides`/`resetCapabilitiesCache`.
- **Data flow:** environment variables (+ a live `tmux` probe) → `detectCapabilities` → cached capabilities → `encodeKitty`/`encodeITerm2` → a `string[]` of terminal lines, one of which carries the image sequence.
- **Non-obvious design decisions:**
  - **The tmux hyperlink probe is real**: `execSync("tmux display-message -p '#{client_termfeatures}'", {timeout: 250})` and the OSC-8 hyperlinks are emitted only if `client_termfeatures` lists `hyperlinks`.
  - **Image protocols are disabled under tmux** (they are unreliable) while truecolor is kept.
  - **The capability cache is overridable programmatically and exported publicly** — `setCapabilityOverrides` exists so downstream packages and tests can drive every rendering path without a real terminal.
  - `isImageLine` uses **`includes`, not `startsWith`** — the old `startsWith` version returned `false` for a line with text before the image, so the renderer ran a width check on a 300 KB base64 line and crashed with "Rendered line exceeds terminal width (304401 > 115)". There is a dedicated regression test for it.
  - `imageFallback` shortens `$HOME/...` to `~/...` and, when hyperlinks are available, wraps the path in a `file://` OSC-8 link so the full path stays openable.
- **Edge cases & failure handling:** every terminal is probed by name and env (`TERM_PROGRAM`, `TERM`, `COLORTERM`, `KITTY_WINDOW_ID`, `ITERM_SESSION_ID`, `WT_SESSION`, `WARP_*`, …), with an explicit allow-list of known-good combinations.
- **Surprising:** Rex supports OSC-8 and *partially* the Kitty graphics protocol (no Unicode placeholders) — enough for pi, and the comment says so.

#### `src/keybindings.ts` — the named-action registry (320 lines)
- **Purpose:** Every action in the package has a **name** (`tui.editor.deleteWordBackward`), a default key list, a description, and a user override.
- **Key abstractions:** `Keybindings` (an interface of `true` values — the action vocabulary, augmentable by declaration merging); `KeybindingDefinition {defaultKeys, description}`; `KeybindingsManager`; `KeybindingConflict`.
- **Data flow:** `TUI_KEYBINDINGS` (defaults) + a user config → `KeybindingsManager.rebuild()` → `keysById` map → `kb.matches(data, "tui.editor.undo")`.
- **Non-obvious design decisions:**
  - **Rebinding an action never evicts another action's default.** `keybindings.test.ts` pins that rebinding `tui.input.submit` does not remove `tui.select.confirm`'s `enter`, and rebinding `tui.select.up` does not remove `tui.editor.cursorUp`'s `up`. The *specific* action at the call site wins.
  - **Conflicts are reported, not resolved**: `getConflicts()` lists a key claimed by two *user* bindings. Defaults that share a key are not conflicts.
  - The action vocabulary is an `interface` of `true` values so a downstream package can **augment it by declaration merging**.
  - Some actions ship **unbound by default** (`tui.altScreen.halfPageUp`, `lineUp`, `lineDown`, `tui.editor.historyPrevious`) — added later and left opt-in.
- **Edge cases & failure handling:** `normalizeKeys` de-duplicates; a user binding to an unknown action id is ignored.
- **Surprising:** `getKeybindings()` lazily constructs a global `KeybindingsManager(TUI_KEYBINDINGS)` on first use — there is no explicit initialisation step.

#### `src/layout.ts` + `src/layout-node.ts` + `src/components/stack.ts` — the layout engine (449 + 34 + 154 lines)
- **Purpose:** A flexbox-like layout for the alternate screen: vertical/horizontal stacks with `basis`/`grow`/`shrink`/`minSize`/`maxSize`, and scroll views.
- **Key abstractions:** `LayoutBox` (rect + clip + children + layer); `LayoutFrame`; `ScrollbarGeometry`; `LAYOUT_NODE` (a `Symbol.for("@earendil-works/pi-tui/layout-node")` **method** a component implements to declare its layout role); `StackLayoutEntry`; `allocateStackSizes`.
- **Data flow:** `renderLayoutFrame(root, width, height, requestRender)` → `layoutComponent` builds a `LayoutBox` tree → `paintBox` paints the lines into a `string[]` → the frame carries the painted lines and the primary scroll view.
- **Non-obvious design decisions:**
  - **A component opts into layout by implementing `[LAYOUT_NODE]()`** — a *method*, so the declaration is discovered by feature detection (`getLayoutNode`), not by `instanceof`.
  - **`allocateStackSizes` distributes growth and shrink by weight**, and shrink is weighted by `shrink × current size` — a shrinking entry gives up proportionally more of what it has.
  - **`renderCached` caches by (component, width)** for the whole frame — the same component at the same width renders once.
  - **The paint fast path**: a full-width box painting onto an untouched row uses the source line reference directly instead of recompositing it through ANSI/grapheme segmentation every frame. This is the "9-18× less per-frame allocation churn" win from v0.84.2.
  - `getLayoutBoxesAt` returns the visual hit path **sorted by layer, then depth** — so an overlay is hit before the content under it.
  - `getScrollbarGeometry` computes a **proportional** thumb: `round(trackHeight² / contentHeight)`, with a 2-row minimum.
- **Edge cases & failure handling:** a `ScrollView` with a billion lines paints only the clipped rows (there is a test with `lineCount = 1_000_000_000`).
- **Surprising:** `replaceScrollbarCell` deliberately preserves **only the underlying background** beneath the scrollbar glyph, dropping the cell's foreground — a subtle fix for a scrollbar that inherited a border colour.

#### `src/components/scroll-view.ts` — the scroll model (224 lines)
- **Purpose:** One scrollable region with follow-end, overscroll chaining, and an auto-hiding scrollbar.
- **Key abstractions:** `ScrollViewOptions {axis, follow, primary, overscroll, scrollbar, scrollbarTrackStyle, scrollbarThumbStyle, scrollbarHideDelayMs}`; `ScrollViewScrollToOptions {disableFollow}`.
- **Data flow:** the layout engine calls `updateLayout(contentHeight, viewportHeight, requestRender)`; the renderer calls `scrollBy`/`scrollTo`/`scrollToEnd`; the component repaints.
- **Non-obvious design decisions:**
  - **`follow: "end"` with a `followSuppressedAtEnd` flag**: scrolling up while output is arriving suppresses the auto-follow, and `scrollTo({disableFollow: true})` can pin the bottom *without* re-enabling it.
  - **`scrollBy` returns the UNUSED delta** — that is what lets a wheel event chain to an outer scroll view (`overscroll: "chain"`).
  - The auto scrollbar shows on **activity** and hides after `scrollbarHideDelayMs`; the timer is `unref()`ed.
  - `addChild`/`removeChild`/`clear` **throw** — a ScrollView has exactly one child.
  - `getContentWidth` reserves one column when the scrollbar is `"always"`, so the content is never one column wider than the viewport.
- **Edge cases & failure handling:** `scrollTo` clamps to `[0, contentHeight - viewportHeight]` and is a no-op when nothing changes.

#### `src/components/input.ts` — the single-line input (501 lines)
- **Purpose:** One-line text entry with horizontal scrolling, a kill ring, undo, and a fake cursor.
- **Key abstractions:** `Input implements Component, Focusable`; `InputOptions {prompt, placeholder, placeholderStyle}`; `InputState {value, cursor}` (the undo snapshot).
- **Data flow:** input → keybinding match → mutate `value`/`cursor` → `render(width)` computes the visible window, slices it by column and paints the fake cursor.
- **Non-obvious design decisions:**
  - **Horizontal scrolling keeps the cursor in the middle**: the window starts at `cursor - halfWidth` unless the cursor is near either end.
  - **Paste is cleaned, not honoured**: newlines and carriage returns are stripped and tabs become four spaces, because a single-line input cannot hold them.
  - **Undo coalescing**: consecutive word characters are one unit; whitespace is its own unit; cursor movement starts a new unit.
  - The kill ring accumulates: backward deletions **prepend**, forward deletions **append**, and a non-delete action breaks the accumulation.
- **Edge cases & failure handling:** the kitty CSI-u printable is decoded **before** the control-character check (a CSI-u sequence contains ESC, which would otherwise be rejected).
- **Surprising:** `handleMouse` positions the cursor by *grapheme width* and returns `{handled: true, focus: true}` — a click focuses the input as a side effect.

#### `src/components/select-list.ts` + `src/components/settings-list.ts` (273 + 328 lines)
- **Purpose:** A keyboard-and-mouse picker and a settings surface with inline search and submenus.
- **Key abstractions:** `SelectItem`/`SelectListTheme`/`SelectListLayoutOptions`; `SettingItem` (with `values` to cycle or `submenu` to open) / `SettingsListTheme`.
- **Data flow:** items → optional filter (`fuzzyFilter`) → a centred visible window → themed rows.
- **Non-obvious design decisions:**
  - **Hover never changes the selection** — the visible window is *centred* on the selection, so moving the mouse would make the list jump. The mouse handler only reacts to `press` and `click`.
  - **A click is `press` then `click`**: the press records the index and the click activates it, so a drag that leaves the row does not select it.
  - The **primary column width is clamped** to `[minPrimaryColumnWidth, maxPrimaryColumnWidth]`, and `truncatePrimary` is overridable so a caller can ellipsise differently while keeping the description column aligned.
  - `SettingsList` **delegates all input to an open submenu** and remembers `navigateAfterClose` so a submenu can hand focus to another row when it closes.
  - **Space is a change shortcut only before a search query exists** — once the user has typed, Space is part of the query.
- **Edge cases & failure handling:** `SettingsList` renders its submenu *instead of* the list, so a submenu cannot be half-drawn.

#### `src/colors.ts` + `src/oklab.ts` (367 + 233 lines)
- **Purpose:** A small perceptual colour system: indexed / RGB / OKLCH / OKHSL colours, gamut mapping, mixing, and ANSI emission.
- **Key abstractions:** `Color` (a discriminated union of three kinds); `TextStyle`/`TextAttributes`; `OklchChannels`/`OkhslChannels`; `ColorMixSpace`.
- **Data flow:** a string (`#abc`, `oklch(62% 0.1 200)`, `okhsl(29.23 100% 56.8%)`) or a number → `parseColor` → a `Color` → `colorToRgb` → an ANSI sequence in `truecolor` or `256color` mode.
- **Non-obvious design decisions:**
  - **Every colour can be converted to sRGB, so colour maths never fails** — the `Color` union has no "unrepresentable" case.
  - **Gamut mapping keeps the hue fixed and reduces only the chroma**, by 20 bisection steps, falling back to the achromatic colour (which is always in gamut).
  - **Mixing in OKLCH takes the shorter hue arc** (`hueDelta = ((second - first + 540) % 360) - 180`) and takes the hue from the *chromatic* side when one colour is grey.
  - `styleTextWithAnsi` **closes the sequences in reverse order of opening** and uses *specific* resets (`\x1b[39m`, `\x1b[49m`, `\x1b[22m`) rather than a blanket `\x1b[0m`.
  - `oklab.ts` is a **port of Björn Ottosson's reference implementation** with the MIT licence and attribution in the header.
- **Edge cases & failure handling:** `requireFinite` throws on NaN/Infinity; `indexedColor` rejects a non-integer or an out-of-range index.
- **Surprising:** the 256-colour fallback picks the **grey ramp over the colour cube** when the colour's spread is < 10 and the grey is perceptually closer — a small correctness detail most implementations skip.

#### `src/terminal-colors.ts`, `src/program-status.ts`, `src/wheel-scroll.ts`, `src/word-navigation.ts`, `src/kill-ring.ts`, `src/undo-stack.ts`, `src/stdin-buffer.ts` (91 + 79 + 82 + 117 + 40 + 28 + 480 lines)
- **`program-status.ts`** — the **OSC 7501 program status protocol**: `state ∈ {idle, working, blocked, done, error, clear}`, an optional `app` name (matched against `[A-Za-z0-9_.+-]{1,32}`), a `kind ∈ {permission, question, auth}` only when blocked, and a message that is control-character-stripped, UTF-8-truncated to 2048 bytes and **base64-encoded** (terminals discard a report containing control characters).
- **`wheel-scroll.ts`** — `WheelScrollAccelerator` scales wheel lines by **event velocity** (notches 100 ms apart → 1 line, 50 ms → 2, 20 ms → up to 6), carries the fractional part between events, does not accelerate a burst (< 5 ms apart = one physical notch), resets on a direction change or a > 200 ms pause, and **detects that macOS terminals already accelerate the wheel** (so the accelerator is disabled there and over SSH).
- **`word-navigation.ts`** — `findWordBackward`/`findWordForward` are **pure functions** over `Intl.Segmenter` word boundaries that still respect **ASCII punctuation boundaries** (a dotted path is one word) and accept an `isAtomicSegment` predicate (the paste marker).
- **`kill-ring.ts`** — an Emacs-style ring with `push(text, {prepend, accumulate})`, `peek`, and `rotate` (yank-pop).
- **`undo-stack.ts`** — a generic `UndoStack<S>` with **clone-on-push** (`structuredClone`) and no re-clone on pop.
- **`stdin-buffer.ts`** — the input framer: it accumulates partial escape sequences and emits only complete ones, with a **50 ms sequence timeout** and a separate **10 ms lone-ESC timeout**. The critical rule is `TERMINAL_REPLY_HEADER_PATTERN`: a recognised reply header (OSC 10/11/4, OSC 7501, DCS XTVersion, APC Kitty graphics) establishes a delimited string that is **never flushed as input** — otherwise an OSC's BEL terminator becomes Ctrl+G and opens the external editor. A CAN/SUB cancels the reply without swallowing the next keystroke, and a new escape sequence aborts an unterminated reply.
- **`terminal-colors.ts`** — parses OSC 10/11/4 replies in `#rrggbb`, `#rrrrggggbbbb` and `rgb:r/g/b` forms, plus the OSC 997 dark/light colour-scheme report.

### Tier 2 — the rest of the source (one line each)

| File | What it decides |
| --- | --- |
| `src/index.ts` | The package's public surface — one barrel re-exporting every public name, including `marked`'s `Token`/`Tokens` (the parser is public) and the test-only `setCapabilityOverrides`. |
| `src/editor-component.ts` | The interface a custom editor must satisfy: `getText`/`setText`/`handleInput` required; `onSubmit`/`onChange` required *in practice* but optional in the type; `addToHistory`, `insertTextAtCursor`, `getExpandedText`, `setAutocompleteProvider`, `borderColor`, `setPaddingX`, `setAutocompleteMaxVisible` optional **methods** (feature-detected with `?.`). |
| `src/components/box.ts` | A padded container with a background function. Caches by (width, child lines, a background *sample* string) — the background is probed by applying it to `"test"`, so a background function that closes over mutable state still invalidates. |
| `src/components/text.ts` | Multi-line text with word wrap and padding; caches by (text, width); tabs become three spaces; padding shrinks when the width cannot fit it. |
| `src/components/truncated-text.ts` | A single-line, width-exact status line. |
| `src/components/stack.ts` / `v-stack.ts` / `h-stack.ts` | The flexbox stack: `basis`/`grow`/`shrink`/`minSize`/`maxSize`/`visible` per entry, a `gap`, and `align` (stretch/start/center/end). `HStack` composites siblings column-by-column with `compositeTuiLine`. |
| `src/components/loader.ts` | The spinner: a subclass of `Text` that repaints itself on an interval, with a configurable frame list and interval, and `frames: []` to hide the indicator. |
| `src/components/cancellable-loader.ts` | A loader that owns an `AbortController` and aborts on Escape — the async-work cancel pattern. |
| `src/components/image.ts` | The `Image` component: encodes base64 to Kitty/iTerm2, allocates an image id, converts non-PNG to PNG for Kitty via a **pluggable transcoder** (cached, LRU of 32), and falls back to a text placeholder. |
| `src/components/mouse-region.ts` | Adds mouse handling to an existing component without changing its rendering. |
| `src/components/spacer.ts` | N blank lines. |
| `src/components/alt-screen-flash.ts` | Transient reverse-video messages composited by the alternate-screen renderer; each has a `unref()`ed timer. |
| `src/latex.ts` (1506 lines) | A LaTeX→Unicode renderer: a symbol table, a hand-written parser, and a **layout engine** that renders fractions, scripts, operators and matrices into terminal cells using private-use markers (`U+F0000`) as layout placeholders. Returns `undefined` on unsupported or malformed input rather than emitting garbage. |

### Tier 2 — native layer (one line each)

| File | What it decides |
| --- | --- |
| `native/napi.h` | A hand-written N-API shim: the ~25 N-API functions the addon needs are declared by hand and resolved at runtime with `dlsym(RTLD_DEFAULT, …)` (or `GetProcAddress` on Windows) — **no Node headers and no link-time dependency on a runtime**, so the same binary works under Node and Bun. |
| `native/clipboard.h` | The shared clipboard job/format machine: `CLIPBOARD_TEXT/IMAGE/WRITE/FILES` operations, `UNAVAILABLE/EMPTY/UTF8/LATIN1/UTF16/BUFFER/PATHS` formats, an `napi_async_work` with a deferred promise, and a `clipboard_execute` hook each platform implements. The worker thread **must not call N-API**; the completion callback does. |
| `native/darwin/src/darwin-platform.m` | AppKit: modifier state via `CGEventSourceFlagsState`, pasteboard text/image/file-URL reads, and pasteboard text writes. |
| `native/linux/src/linux-platform-x11.c` | libxcb: a 1×1 helper window, `CLIPBOARD`/`PI_CLIPBOARD`/`TARGETS`/`INCR` atoms, a **shared 2-second deadline** across discovery, replies and incremental chunks, and strict `INCR` metadata validation (`format` ∈ {8,16,32}, type and item count must agree) so a malformed transfer cannot allocate unbounded memory. |
| `native/linux/src/clipboard-worker.h` | The private-thread executor: **one** reader at a time, a 3-second bounded wait that occupies libuv, `CLOCK_MONOTONIC` condition variables, and — critically — a late result whose caller has timed out is **freed, not delivered**. |
| `native/win32/src/win32-platform.c` | Win32: `ENABLE_VIRTUAL_TERMINAL_INPUT`, modifier state via `GetAsyncKeyState`, clipboard text/image reads, and a pasteboard **owner window** created and destroyed on the worker thread (a real owner is required for a text write, including under Node without a console). |
| `native/darwin/build.sh`, `native/linux/build.sh`, `native/win32/build.mjs` | Three build systems for the same three-line contract: Apple clang + `xcrun` SDK; `cc` with `-nostdlib -Wl,--unresolved-symbols=ignore-all -Wl,-z,nodelete`; and an MSVC/MinGW chooser that probes `vswhere` and falls back. |
| `native/*/README.md` | How to build and test each platform's addon, and the opt-in flags for the destructive tests (`PI_TEST_NATIVE_CLIPBOARD=1` **replaces the system clipboard**). |

### Tier 2 — tests (one line each)

| File | What it pins |
| --- | --- |
| `test/editor.test.ts` (157 KB) | The editor's whole contract: prompt history (cycling, the draft restored, the 100-entry cap, duplicate rules), a backslash+Enter workaround, CSI-u handling, Unicode editing, grapheme-aware wrapping, the kill ring, undo, autocomplete, `Ctrl+]` jump, the sticky column, and the paste-marker atomicity rules. |
| `test/markdown.test.ts` (66 KB) | Lists (nesting, wrapping, task markers, `preserveOrderedListMarkers`), tables (column widths, link-style leakage, narrow widths), LaTeX (delimiters, currency/`$VAR`/code spans, disabled mode), the unclosed-`$$`-before-a-table regression, backslash escapes, pre-styled "thinking" text, blockquote styling, and OSC-8 links. |
| `test/tui-alt-screen.test.ts` (76 KB) | The fullscreen renderer: viewport + manual scroll, the jump-to-end indicator, wheel routing, the scrollbar, transcript search (index reuse, column mapping, the panel, the shortcut), OSC 133 prompt jumps, Kitty image placement/cropping/eviction, mouse selection (double/triple click, drag, copy), and overlay focus. |
| `test/autocomplete.test.ts` | Path-prefix extraction, `fd` fuzzy search (regex metacharacters, CJK, quotes, symlinks, `.git` exclusion, scoped directories) and dot-slash completion. |
| `test/keys.test.ts` | Every key protocol: Kitty CSI-u with alternate keys, `modifyOtherKeys`, legacy sequences, `decodeKittyPrintable`, and `parseKey`. |
| `test/overlay-non-capturing.test.ts` | The overlay focus model in detail: `focus()`/`unfocus()`/`preFocus` ancestry, focus stealing, no-op guards, and cycle prevention. |
| `test/terminal-image.test.ts` | `isImageLine` detection, `detectCapabilities` for ~20 terminals and multiplexers, Kitty/iTerm2 encoding, cell sizing, cropping, the transcoder cache, and `hyperlink`. |
| `test/tui-render.test.ts` | The render scheduling: input preempts a throttled frame, the bounded writer splits a 2.4 MB render without changing the bytes, the crash dump names the log path, Kitty image cleanup ordering, resize handling, content shrinking, and the fake cursor. |
| `test/layout.test.ts` | The layout engine: deterministic grow allocation, shrink to minimum, nested minimum sizes, invisible entries, a billion-line scroll view, Kitty cropping, horizontal composition, the scrollbar geometry (proportional thumb, the reserved column) and follow-end. |
| `test/stdin-buffer.test.ts` | The input framer: partial sequences, the timeout rules, terminal-reply strings (kept intact at every split, a cancelled reply, a new escape aborting an unterminated one), Kitty events, the WezTerm `ESC ESC CSI` regression, mouse events and bracketed paste. |
| `test/input.test.ts`, `test/editor-history-keybindings.test.ts` | The single-line input's kill ring, undo units and rendering; and that history navigation works **without first moving the cursor** when rebound to Ctrl+P/Ctrl+N. |
| `test/terminal.test.ts` | The Kitty negotiation (query-before-fallback, split responses, DA forwarding), the OSC 7501 program-status protocol, the escape timeout (SSH vs local vs `PI_TUI_ESC_TIMEOUT`), Shift+Enter normalisation and the progress sequence. |
| `test/terminal-colors.test.ts` | The OSC 10/11/4 query: one write for all colours, delayed Ghostty fragments that must not be typed, resolution on DA1, and late replies after the timeout. |
| `test/overlay-options.test.ts` | Overlay geometry: width overflow, `widthPercent` + `minWidth`, anchors, margins, offsets, `rowPercent`/`colPercent`, `maxHeight`, stacking and hiding order, and that hiding after `stop()` leaves the cursor visible. |
| `test/latex.test.ts` | ~120 real expressions (a Jacobian-conjecture session, a satellite-power session) rendered to exact Unicode, plus matrices, stacked operator limits, display fractions and the "returns `undefined` on malformed input" contract. |
| `test/fuzzy.test.ts` | The scoring ladder: consecutive beats scattered, word boundary beats mid-word, the exact-match bonus, the swapped alpha-numeric fallback and the slash-separated multi-token query. |
| `test/keybindings.test.ts` | The named-action registry: the default key lists, the unbound-by-default actions, and that **rebinding never evicts another action's default** while a genuine user conflict is still reported. |
| `test/select-list.test.ts`, `test/settings-list.test.ts` | Column alignment under truncation, the min/max primary column width, an overridable truncation; and that Space is a change shortcut only before a search query exists. |
| `test/colors.test.ts` | Hex/OKLCH/OKHSL parsing, the gamut-mapping limits, the OKHSL round-trip and the reverse-order closing of ANSI sequences. |
| `test/native-clipboard-linux.test.ts` | The X11 clipboard against a real `Xvfb` + `xclip`: INCR metadata validation, Latin-1 vs UTF-8, a stalled connection that must not block JS, a 4 MiB transfer, and a transfer failure that must be an **exception**, not "unavailable". |
| `test/native-platform.test.ts` | The Linux ARM64 prebuild is 64 KB-page aligned; the Windows clipboard write (opt-in, destructive); the helper is the clipboard API; and Linux loads X11 lazily and rechecks `DISPLAY`. |
| `test/exit-restore.test.ts` + `test/fixtures/exit-without-stop.ts` | A process that exits **without `stop()`** must still restore the mouse, focus, Kitty, bracketed paste and alternate-screen modes — and must not restore twice after a normal stop. |
| `test/bug-regression-isimageline-startswith-bug.test.ts` | The `isImageLine` `startsWith` → `includes` fix, with the old buggy implementation reproduced in the test. |
| `test/regression-*.test.ts` (4 files) | Four named regressions: the overlay CJK boundary, the regional-indicator width (a partial flag must be width 2 or the differential render drifts), `SIGWINCH` self-kill returning EACCES, and the `sliceByColumn` ANSI order. |
| `test/wrap-ansi.test.ts`, `test/visible-width.test.ts`, `test/truncate-to-width.test.ts`, `test/truncated-text.test.ts` | The wrapping/measurement contract: underline closed but background preserved, the OSC-8 hyperlink re-opened per line with the original terminator, CJK breaks, tabs as three columns, and truncation that keeps a contiguous prefix. |
| `test/mouse-components.test.ts` | Click-to-position, press-then-click activation, hover never selects, a delegating overlay keeping focus, and a drag over the editor selecting text instead of moving the cursor. |
| `test/native-module-path.test.ts` | The native helper is found in the installed package when the app is bundled elsewhere, and the standalone-binary fallbacks still work. |
| `test/program-status.test.ts` | The OSC 7501 encoding: the base64 message, the omitted `kind` outside `blocked`, the stripped control characters and the UTF-8-boundary truncation. |
| `test/tab-width.test.ts` | A tab inside a control sequence stays byte-identical; a tab-containing overlay stays on one physical row. |
| `test/alt-screen-large-transcript-bench.ts` | A 2,500-component transcript benchmark measuring ms/frame for steady, scroll, streaming and resize. |
| `test/render-churn-bench.ts` | An allocation-churn benchmark using `node:inspector` — MiB/frame and written bytes/frame, not just time. |
| `test/chat-simple.ts`, `test/image-test.ts`, `test/key-tester.ts`, `test/viewport-overwrite-repro.ts` | Interactive/manual harnesses: a chat demo, an image viewer, a key-code logger (hex/chars/repr) and a viewport-overwrite reproducer. |
| `test/test-themes.ts` | The shared chalk-based themes for the tests. |
| `test/virtual-terminal.ts` | The xterm.js-backed `Terminal` used by every test: `sendInput`, `resize`, `getViewport`, `getScrollBuffer`, `waitForRender`. |
| `test/fixtures/clipboard-reader.cjs`, `clipboard-worker-test.c/.cjs`, `clipboard-x11-test.c` | Test fixtures: a clipboard reader that asserts the JS event loop stayed responsive and left no child process; a worker fixture that blocks the reader; and an X11 owner that can serve a direct string, an INCR transfer, an invalid terminator, or stall. |

### Tier 2 — docs (one line each)

| File | What it decides |
| --- | --- |
| `packages/tui/README.md` | The public API and its key bindings, and the `PI_TUI_WRITE_LOG` debug flag. |
| `packages/tui/CHANGELOG.md` | 100+ releases of terminal-compatibility fixes. The recurring themes: Kitty keyboard protocol, `modifyOtherKeys` fallback, OSC-8 hyperlinks, differential-render width drift (CJK, regional indicators, tabs), overlay focus, and LaTeX parsing. |
| `packages/tui/package.json` | v1.4.0, ESM, Node ≥ 22.19, three runtime deps (`get-east-asian-width`, `marked`, `marked-cjk-friendly`), one dev dep (`@xterm/headless`) — the whole package has **three** dependencies. |
| `packages/tui/tsconfig.build.json` | `outDir: ./dist`, `rootDir: ./src`. |

### Tier 3 — skipped (binary)

The six `native/*/prebuilds/**/*.node` files are compiled native addons (Mach-O arm64/x86_64, ELF x64/arm64, PE x64/arm64; 8.7 KB–67 KB). Their magic bytes and sizes were confirmed on disk; their C sources were read in full instead.

---

## 2. Ideas worth stealing

1. **A mouse handler returns a *decision object*, not a boolean** — `{handled, capture, focus, render}` with per-event-type defaults (move/release do not repaint; press/click/drag/wheel do). August's chart, transcript and Settings surfaces all take pointer input; this protocol makes "who owns this gesture" explicit and testable.
2. **A delegating container keeps keyboard focus when it forwards a click to a child** — focusing the child leaves focus on a component that is about to be unmounted. August has exactly this shape (`DetailModal`, the Settings submenu, the agents desk pane).
3. **Component → renderer boundary with a cursor *marker*.** The component emits `renderFakeCursor()` / `CURSOR_MARKER`; the renderer decides whether that becomes reverse video, a real hardware cursor, or nothing. August's chat composer could do the same instead of hard-coding a caret.
4. **Named-action keybinding registry with conflict *reporting* and no default eviction.** Every action has a name, a default key list and a description; rebinding one action never silently removes another's default; two user bindings on the same key are reported at startup, not at runtime.
5. **Undo with an explicit "unit" policy** (clone-on-push snapshots; consecutive word characters coalesce; whitespace is its own unit; cursor movement starts a new unit; a no-op delete pushes nothing). August's trade-plan editor and journal entries would benefit from "undo my multi-step edit as one action".
6. **A paste marker is an atomic token.** A large paste becomes one `[paste #1 +50 lines]` unit in the buffer; the segmenter treats it as a single grapheme; the registry is renumbered in ascending id order; undo restores the registry; the text is expanded only on submit. This is the pattern for pasting OHLC JSON or a CSV into the August plan editor.
7. **A cached search index keyed on *content*, not on render.** Compare the line array element-wise; rebuild the corpus only when it changed; re-run the regex only when the normalised query changed; return `{matches, changed}` so the caller knows whether to repaint.
8. **A bounded streaming writer** — 1 MiB chunks, split at surrogate-pair boundaries, so one render never builds a string bigger than the engine's limit. The same discipline applies to August's notebook export/backup.
9. **A crash dump that names the measurement that failed.** When a rendered line exceeds the terminal width, write the width, the offending line's width and every rendered line to a file, then throw an error that points at it. August's `render-probe` could adopt the same shape.
10. **Capability detection with a programmatic override, exported publicly.** `getCapabilities` / `setCapabilityOverrides` / `resetCapabilitiesCache` let tests drive every path without the real environment; the tmux probe is a live, timed query rather than a guess.
11. **A program-status vocabulary with one source** — `idle | working | blocked | done | error | clear`, where `blocked` carries a `kind` (`permission | question | auth`). August has exactly these states (working, waiting for the trader to approve a plan, finished, failed) and currently expresses them in several places.
12. **Abortable, debounced, re-querying autocomplete.** An `AbortSignal` per request, the previous request aborted, the child process killed on abort, results discarded if the signal fired, and a re-query when the cursor moves back into the token.
13. **The "device replies are never keystrokes" rule.** A recognised terminal-reply header establishes a delimited string that is never flushed as input; CAN/SUB cancels it without swallowing the next keystroke. August's Electron IPC and any stdout scraping need the same discipline.
14. **A 50 ms sequence timeout and a separate 10 ms lone-ESC timeout**, with the ESC timeout raised over SSH — a transport-aware timing constant rather than one magic number.
15. **Allocation-churn benchmarks, not just fps.** `node:inspector` measures MiB/frame and written bytes/frame for a static scene and a typing scene. That metric is what surfaced the "9-18× less per-frame allocation churn" win.
16. **`flattenLines()` — read a rope-built string once to make V8 flatten it**, so a cached line stops retaining several times its own size.
17. **Close only what needs closing.** Line breaks end with `\x1b[24m` (underline) rather than `\x1b[0m`, so the background colour of the padding survives. Style state is tracked in one place (`AnsiCodeTracker`).
18. **Fix the renderer's quirk in the output, not in the data** — `normalizeTerminalOutput` decomposes a Thai/Lao vowel that some terminals mis-render, keeping the logical content untouched. August's sanitiser/`normalizeTerminalOutput` analogue.
19. **Bound image memory by three separate quotas** (item count, transmitted bytes, decoded bytes) rather than one.
20. **A layout that is opt-in by method, not by type** — a component declares its layout role by implementing a symbol-keyed method, so the engine feature-detects instead of `instanceof`-ing.

---

## 3. Trading-specific findings

1. **The paste-marker-as-atomic-token pattern is the single most transferable idea here.** August's trade-plan editor and journal entry take pasted JSON, CSV or a price table. pi's rule — keep the compact marker in the buffer, expand it only on submit, treat the marker as one grapheme for cursor/deletion/wrap, renumber the registry in ascending order, and restore the registry on undo — is directly reusable.
2. **`fuzzy.ts`'s scoring ladder is a ready-made ticker/ranking function.** Consecutive −5×run, word-boundary −10, gap +2, position +0.1×index, exact −100, plus the "digits/letters swap" fallback — `codex52` matches `gpt-5.2-codex` — is precisely the "user types the ticker in the wrong order" case (e.g. `nvda` ↔ `nvda.us`, `btc` ↔ `btcusdt`). The multi-token rule (split on whitespace **and** `/`, all tokens must match) suits `openai-codex/gpt-5.5`.
3. **A slash command's *arguments* own their own completer, and it may be async and may return `null`.** That is the right shape for a symbol/field-level completion in August's chat surface (`/plan EURUSD 1.10` → the argument completer suggests the pair).
4. **The LaTeX renderer is a "structured answer → cells" pipeline worth imitating for risk output.** `renderLatex` parses to a small AST, lays it out into cells with private-use markers as placeholders, and **returns `undefined` on malformed input rather than emitting garbage**. August's metric tables (R:R, size, stop distance) should be produced by a deterministic renderer that refuses to guess, not by string interpolation.
5. **The transcript is a *scroll region*, not a page.** `ScrollView` with `follow: "end"`, a `followSuppressedAtEnd` flag, an overscroll **chain** that returns the *unused* delta, and a proportional scrollbar are the mechanics of an August chat transcript that keeps up with a streaming analysis without yanking the reader.
6. **Program status maps onto a trading session exactly.** `working` during an analysis, `blocked` + `kind=permission` while a trade plan awaits approval, `done` after settlement, `error` on a provider failure, `clear` on stop — one vocabulary the terminal title, the OS taskbar, the notification centre and the in-app status line can all read from.

---

## 4. Non-obvious decisions and gotchas

- **Lower score = better match** in `fuzzy.ts` — inverted from the usual convention, and consistent throughout.
- **`visibleWidth` counts a tab as three columns**, package-wide. The layout code, the width cache and the renderer must all agree or the terminal's own tab stops will wrap differently.
- **Regional indicators are forced to width 2** even when isolated, because terminals render a partial flag as full-width; getting this wrong makes the differential render drift.
- **An overlay's `nonCapturing` flag changes focus, not rendering**; `focus()`/`unfocus()` are explicit and `preFocus` is remembered so closing restores the previous focus — and a cyclic `preFocus` ancestry must not hang.
- **The Kitty protocol's presence changes the meaning of the same bytes.** `\x1b\r` and `\n` are *shift+enter* under Kitty and *alt+enter* without it. Any keybinding system that ignores the negotiated mode is wrong half the time.
- **The base-layout fallback in `keys.ts` is restricted on purpose**: consulting it for Latin letters would make Dvorak/Colemak/xremap remap `Ctrl+K` onto `Ctrl+V`.
- **`isImageLine` must use `includes`, not `startsWith`** — the old version let a 300 KB base64 line pass the width check and crash the renderer.
- **The Kitty pre-clear must not scroll the viewport**; if it would, the renderer falls back to a full redraw.
- **In the X11 clipboard, a late result whose caller already timed out is freed, not delivered** — and the INCR metadata is validated *before* any bytes are accumulated.
- **A Windows clipboard text write needs a real owner window**, created and destroyed on the worker thread.
- **The native addon resolves N-API at runtime with `dlsym`**, so one binary works under Node and Bun with no Node headers and no link-time runtime dependency.
- **`Markdown` caches its transform by (source, availableWidth)** — a width change invalidates it, and `setText`/`invalidate` are the only ways to force a re-render.
- **The LaTeX parser refuses `$…$` when the content is all-caps, ends with a space, is followed by a digit, or contains a backtick** — so currency, shell variables and code spans are never mistaken for maths.
- **`Terminal` implementations must provide `setProgramStatus`** (a no-op is allowed) — it was made a required method in v1.1.0.
- **A `process.exit` handler restores the terminal modes synchronously** with `fs.writeSync`, because `process.stdout.write` may not flush during exit.

---

## 5. Weak spots in the reference

1. **`applyCompletion` in `autocomplete.ts` duplicates the same "insert the value and fix the cursor for a trailing quote" logic four times** across the slash-command / `@` / command-argument / plain-path branches — a bug magnet, and the reason the four branches can drift.
2. **`autocomplete.ts` mixes four concerns in one 858-line class** (slash commands, `@` fuzzy search, path completion, argument completion) and carries its **own** 100/80/50/30 scoring ladder alongside `fuzzy.ts`'s — two inconsistent fuzzy scorers in one package.
3. **`utils.ts` (1402 lines) is a monolith**: width measurement, wrapping, ANSI parsing, OSC-8 hyperlink tracking, slicing and truncation all live together, and `AnsiCodeTracker` is a second, independent model of the terminal's SGR state.
4. **`markdown.ts`'s table layout is a hand-rolled three-stage column solver** (natural → min-word-proportional → growth with a rounding-leftover loop) for a cosmetic feature; a simpler "one column per cell" rule would be far cheaper.
5. **`latex.ts` is 1506 lines** — a symbol table plus a hand-written LaTeX parser and layout engine — for a feature most sessions never trigger. Very high maintenance, very low payoff.
6. **`keys.ts` (1455 lines) is combinatorial**: every new terminal or protocol variant adds branches to a `switch` rather than a data-driven table, and the same "shifted symbol" logic is duplicated between the Kitty and `modifyOtherKeys` paths.
7. **The native clipboard is written three times in three languages with three build systems**, and the C code hand-rolls an N-API shim with `dlsym` lookups instead of using `node-api-headers` — a maintenance cost paid three times.
8. **`tui-alt-screen.ts` (1797 lines) is one class carrying** overlay focus, mouse selection, image placement, search, scrolling and the jump-to-end indicator — it is the file most likely to grow a new bug.
9. **Global mutable module state**: `keys.ts` keeps `_kittyProtocolActive` and `_lastEventType` as module globals, and `keybindings.ts` a global `KeybindingsManager` — which is why `setKeybindings()` exists and why tests must restore it in `afterEach`.
10. **The benchmark harnesses print to stdout rather than asserting.** `alt-screen-large-transcript-bench.ts` and `render-churn-bench.ts` measure and report, but a regression in frame time is invisible to CI.

---

## 6. Notes for August Trading (findings only — nothing was changed)

- No defects were found in August Trading from this shard (the shard is reference code only); nothing in `C:\Dev\august-3.5` was modified except this report and the status ledger.
- The most relevant overlap is `utils/harnessMarks.ts` / `utils/runStatus.ts` (August's "one marker vocabulary" and "one status colour per state") against pi's `utils/harnessMarks.ts` equivalent `program-status.ts` (one program-status vocabulary with a `blocked` + `kind` case). August's `runStatus.ts` is the same shape and could be extended with pi's `blocked/permission/question/auth` distinction.
- August's `render-probe` gate is the counterpart of pi's crash-dump contract; pi's version additionally records *every* rendered line with its measured width, which would make a failing August probe report equally actionable.
- August's `utils/toolKinds.ts` "one vocabulary" discipline is matched here by pi's `keybindings.ts` named-action registry — a model for making August's keyboard shortcuts rebindable and conflict-checked.
