# CLAUDE.md — PianoMode OCR Scanner Project

## Current State (2026-04-17)
Branch: `claude/audiveris-integration-zOSh8`
Cache buster: **v6.16.1** (sync'd in `omr-core.js` `OMR.VERSION` and
`functions.php` `PIANOMODE_OMR_VER`).

**STATUS:** Audiveris-port pipeline is authoritative (all 14 phases enabled by
default via `OMR.flags`, legacy v6 heuristics only run as fallback). Wave 1
grand-staff plumbing landed in v6.16.0, followed by UI-stability fixes in
v6.16.1. Next focus is note-detection accuracy and grand-staff fidelity in the
rendered AlphaTab score.

### Wave 1 fixes (v6.16.0 — 2026-04-17)
User report: AlphaTab only showed the treble clef, detection was "EXTRÊMEMENT
IMPRECISE", and the result panel visibly shifted in height after a scan. Fixes
applied, one commit per file:
1. **Path correction** — `functions.php` expected `/assets/OCR-Scan/` but files
   lived at `/OCR-Scan/`. All 21 assets relocated via `git mv` so enqueues and
   `require_once` resolve correctly (previously failing silently → engine never
   loaded).
2. **MusicXML grand-staff recovery** (`omr-musicxml.js` `collectParts()`) —
   scan ALL systems for the max staff count. If any system has ≥2 staves, emit
   a single piano part with `<staves>2</staves>` using that system as the
   staffMap template. Fallback: if every system is single-staff but the total
   is even, pair consecutive staves into one piano part. Catches Phase 4
   pairing failures so grand staff still round-trips.
3. **AlphaTab track selection** (`page-omr-scanner.php`) — replace the
   "pick one piano track" heuristic with `atApi.renderTracks(score.tracks)` so
   both clefs render whether the engine emits 1 grand-staff part or 2
   single-staff parts.
4. **Phase 11 orphan-staves pairing** (`omr-clef-key-time.js`
   `detectHeaders()`) — before scanning clefs, if `staves.length` is even and
   none has `partner` set, top-to-bottom pair them so the authoritative `+4`
   bass-clef hint in `scanClef()` fires on the lower staff.
5. **Phase 4 deterministic pairing** (`omr-grid-lines.js`
   `pairStavesIntoSystems()`) — piano-friendly branches: 2 staves → always
   grand staff; 4+ even → split at the N-largest gaps (N = pairs − 1); odd/1–3
   → bimodal threshold. Wires `partner`, `staffIndex`, `systemIdx` via
   centralised `pushGrandStaff` / `pushSingleStaff` helpers.

### UI stability fixes (v6.16.1 — 2026-04-17)
User report: "le jeu se décalait en hauteur". Root cause: `buildPiano()` let
the browser paint the piano at the CSS default (140px) before two
`setTimeout(adjustPianoSize, 50/300)` calls resized it to the computed
dimensions, causing a visible jump. Fixes:
1. **`page-omr-scanner.php`** — hide the piano (`visibility:hidden`) until
   sized, try sizing synchronously, fall back to up to two
   `requestAnimationFrame` ticks if the container has zero width
   (display:none → block transition). Replace the setTimeout pair with a
   single `ResizeObserver` on `.pm-omr-piano-wrap`. `adjustPianoSize()` now
   returns a boolean and re-shows the piano on success.
2. **`omr-scanner.css`** — reserve `.pm-omr-piano-wrap { height: 152px }` so
   the wrap doesn't jump between `min-height: 120px` and the JS-computed
   whiteKeyHeight (clamped [100, 160]px).

### Current file layout (v6.16.1)
```
blocksy-child/
├── page-omr-scanner.php                ← WP template (inline JS player init)
├── functions.php                        ← enqueues all engine JS + cache buster
├── assets/OCR-Scan/
│   ├── omr-scanner.css
│   ├── omr-scanner-api.php
│   ├── omr-admin.php
│   └── engine/
│       ├── omr-core.js                 ← namespace, OMR.VERSION, flags, debug bus
│       ├── omr-image.js                ← ImageProcessor v2 (Phase 2)
│       ├── omr-scale.js                ← ScaleBuilder (Phase 3)
│       ├── omr-grid-lines.js           ← LinesRetriever + pairStavesIntoSystems (Phase 4)
│       ├── omr-grid-bars.js            ← BarsRetriever (Phase 5)
│       ├── omr-distance.js             ← Chamfer distance transform (Phase 6)
│       ├── omr-stems-seeds.js          ← StemSeedsBuilder (Phase 6)
│       ├── omr-beams.js                ← BeamsBuilder (Phase 7)
│       ├── omr-templates.js            ← TemplateFactory (Phase 8)
│       ├── omr-heads.js                ← NoteHeadsBuilder two-pass (Phase 8)
│       ├── omr-ledgers.js              ← LedgersBuilder (Phase 9)
│       ├── omr-stems.js                ← StemsBuilder + HeadLinker (Phase 10)
│       ├── omr-clef-key-time.js        ← Clef/Key/Time builders (Phase 11)
│       ├── omr-rests-alters.js         ← Rests + accidentals (Phase 12)
│       ├── omr-sig.js                  ← SIGraph + rhythm + voices (Phase 13)
│       ├── omr-musicxml.js             ← MusicXML writer (Phase 14)
│       ├── omr-midi.js                 ← MIDI writer (Phase 14)
│       └── omr-engine.js               ← Orchestrator: Engine.process() pipeline
```

### 14-Phase Plan (Audiveris → JavaScript port)
| Phase | Scope | Ports from Audiveris | Flag |
|-------|-------|----------------------|------|
| 0 | Debloquer le player + logging | fix `report()` signature, pin AlphaTab | — |
| 1 | Split engine in multi-file modules | — | — |
| 2 | ImageProcessor v2 (binarization, skew) | `BinaryStep`, `skew/SkewBuilder` | — |
| 3 | ScaleBuilder (interline, line thickness, beam) | `sheet/ScaleBuilder.java` | `useNewScale` |
| 4 | LinesRetriever + ClustersRetriever | `sheet/grid/LinesRetriever.java`, `ClustersRetriever.java` | `useNewStaff` |
| 5 | BarsRetriever (barlines + systems) | `sheet/grid/BarsRetriever.java`, `HiLoPeakFinder.java` | `useNewBars` |
| 6 | StemSeedsBuilder + chamfer distance transform | `sheet/stem/StemSeedsBuilder.java`, `image/DistanceTable.java` | `useNewSeeds` |
| 7 | BeamsBuilder (morphological spots) | `sheet/beam/BeamsBuilder.java` | `useNewBeams` |
| 8 | Template factory + NoteHeadsBuilder two-pass | `image/TemplateFactory.java`, `sheet/note/NoteHeadsBuilder.java` | `useNewHeads` |
| 9 | LedgersBuilder | `sheet/ledger/LedgersBuilder.java` | `useNewLedgers` |
| 10 | StemsBuilder + HeadLinker | `sheet/stem/StemsBuilder.java`, `HeadLinker.java` | `useNewStems` |
| 11 | ClefBuilder + KeyBuilder + TimeBuilder | `sheet/clef/ClefBuilder.java`, `sheet/key/*`, `sheet/time/*` | `useNewHeader` |
| 12 | RestsBuilder + AltersBuilder (accidentals) | `sheet/rhythm/RestsBuilder.java`, `sheet/note/AltersBuilder.java` | `useNewRests` |
| 13 | SIGraph + Rhythm + voice assignment | `sig/SIGraph.java`, `sheet/rhythm/*` | `useNewSig` |
| 14 | MusicXML + MIDI emit + player integration | `score/PartwiseBuilder.java` | `useNewEmit` |

All flags default to `true` in `omr-core.js`. Legacy v6 code paths only run as
fallback when a new module fails to produce output.

### Architecture Rules
- 100% client-side OMR (NO Java, NO server deps beyond WP REST)
- PDF.js from CDN (pinned version)
- AlphaTab from CDN (pinned version, not `@latest`)
- WebWorker fallback allowed if main-thread perf is too slow (Phases 4/7/8)
- Each module attaches to `window.PianoModeOMR.<ModuleName>`
- All modules share the same cache-buster version

### Progress Reporting Contract (Phase 0 fix)
```js
// Engine calls: report(step, message, percent)
//   step 1 = Loading       (  0% → 10%)
//   step 2 = Image proc    ( 10% → 40%)
//   step 3 = Note detect   ( 40% → 80%)
//   step 4 = Encoding      ( 80% → 100%)
// Template updateProgress(step, message, percent) matches 1-to-1.
```

### Theme Conventions
- CSS vars: `--pm-gold: #D7BF81`, `--pm-black: #1a1a1a`, `--pm-font: 'Montserrat'`
- Dark theme, gold accents
- Responsive: 1024px / 768px / 480px breakpoints

### Git Rules (CRITICAL — user requirement)
- Branch: `claude/audiveris-integration-zOSh8`
- Push: `git push -u origin claude/audiveris-integration-zOSh8`
- **ONE COMMIT PER FILE** (user explicit demand)
- Do NOT create a pull request unless the user explicitly asks
- Run git commands from `/home/user/audiveris_pianomode` (repo root)

### Cache-Buster Rule (CRITICAL)
- User has NO CDN cache access → **every** JS/CSS change MUST bump the version
- Version constant lives in `functions.php` (`PIANOMODE_OMR_VER`)
- `omr-core.js` `OMR.VERSION` MUST match
- `page-omr-scanner.php` inline `<script src=...?ver=X.Y.Z>` must match

### Known Remaining Work
- **Detection accuracy** — user still reports imprecise results. Phase 8 head
  filters were relaxed in v6.15.0 (minGrade 0.25, maxDistanceLow 2.5,
  maxDistanceHigh 4.0, maxYOffsetRatio 0.25); may need re-tightening plus
  stronger Phase 12 accidentals and Phase 13 voice assignment.
- **Grand-staff fidelity in AlphaTab** — Wave 1 ensures both clefs render, but
  the brace/bracket and cross-staff beaming visual correctness still needs
  verification against real piano scores.
- **Test material** — user's "morning sunbeam" PDF not yet located. Fallback
  test PDFs in `app/src/test/resources/` and `data/examples/`.
