# CLAUDE.md — PianoMode OCR Scanner Project

## Current State (2026-04-06)
Branch: `claude/integrate-audiveris-ocr-0XMux`

### What's Done
- OMR Engine v6.0 with critical accuracy fixes
- FIXED: Distance transform was inverted (broke all template matching)
- FIXED: Position-based scanning replaces sliding window (Audiveris NoteHeadsBuilder)
- FIXED: Pitch assignment offset corrected (+6 instead of +2, 21-entry arrays)
- NEW: Separate filled + void templates with weighted scoring (fore=4, back=1, hole=0.5)
- Projection-based barline detection with adaptive thresholds
- Measure-based note organization using detected barlines
- Chamfer distance transform + template matching for noteheads
- Proper grand staff handling with voice assignment
- MusicXML with divisions=16, backup/forward, voice separation
- MIDI with timeline-based delta calculation
- Premium sightreading-quality piano keyboard (88 keys)
- Piano + preview canvas highlighting during AlphaTab playback
- Real progress bar with percentage (gold gradient)
- CSS, API, admin, page template all functional
- Cache buster: `ver=6.0.0`

### File Locations
```
blocksy-child/
├── page-omr-scanner.php          ← WP template (must stay at root)
├── assets/OCR-Scan/
│   ├── omr-engine.js             ← Complete OMR engine v5.0 (all 6 modules)
│   ├── omr-scanner.css           ← page styles + premium piano CSS
│   ├── omr-scanner-api.php       ← REST API (save/history/delete)
│   └── omr-admin.php             ← WP admin dashboard
├── functions.php                  ← loads API + admin + enqueues CSS
```

### Architecture
- 100% client-side OMR (NO server deps, NO Audiveris, NO Java)
- PDF.js loaded from CDN for PDF support
- AlphaTab loaded from CDN for playback
- Exports: MusicXML + MIDI
- Admin panel under WP menu "OCR Scanner"
- Async processing with UI yields between steps

### JS Engine Structure (v5.0)
```
window.PianoModeOMR = {};
PianoModeOMR.ImageProcessor  → loadImage, loadPDF, toGrayscale, otsuThreshold, binarize, cleanNoise
PianoModeOMR.StaffDetector   → detect, groupIntoSystems, removeStaffLines, detectClefs
PianoModeOMR.NoteDetector    → computeDistanceTransform, scanForNoteheads, detectStems, detectFlags,
                                detectBeams, detectBarLines (projection-based), detectRests,
                                classifyDuration, assignPitch, organizeNotes (measure-based), detect
PianoModeOMR.MusicXMLWriter  → generate (with voice separation, backup/forward)
PianoModeOMR.MIDIWriter      → generate (timeline-based), toBlob, toBlobURL
PianoModeOMR.Engine          → process(file, onProgress) → Promise (async with yields)
```

### v5.0 Key Algorithms (from Audiveris analysis)
- **Barline detection**: Vertical projection per staff → derivative threshold (top 5 avg × 0.3) → peak detection → validation (narrow + spans 65%+ of staff)
- **Notehead detection**: Chamfer distance transform → synthetic elliptical templates → position-based scanning (pos -6 to +14) → score threshold 0.35
- **Stem detection**: Multi-side search with gap-stopping, min length 1.8× spacing
- **Beam detection**: Horizontal ink band detection between stem endpoints, group tracking
- **Measure organization**: Events assigned to measures by x-position between barline positions
- **Grand staff**: 2 staves per system → treble=voice1/staff1, bass=voice2/staff2 → MusicXML backup

### Theme Conventions
- CSS vars: `--pm-gold: #D7BF81`, `--pm-black: #1a1a1a`, `--pm-font: 'Montserrat'`
- Dark theme, gold accents
- Inline JS in templates (pattern from single-score.php)
- `wp_enqueue_scripts` priority 25+ for page-specific CSS
- Responsive: 1024px / 768px / 480px breakpoints

### Git Rules
- Branch: `claude/integrate-audiveris-ocr-0XMux`
- Push: `git push -u origin claude/integrate-audiveris-ocr-0XMux`
- Small commits, one file/concern at a time
- Run git commands from `/home/user/audiveris_pianomode` (repo root)

- # CLAUDE.md — PianoMode OCR Scanner Project

## Current State (2026-04-10)
Branch: `claude/audiveris-ocr-integration-vO3oz`

**STATUS: Massive rewrite in progress — porting Audiveris Java algorithms into
JavaScript, class by class. The previous v6.0 engine produced very inaccurate
results and the AlphaTab player never loaded past "0%". A 14-phase plan is
being executed (see `/root/.claude/plans/majestic-stargazing-narwhal.md`).**

### Why a rewrite
- v6.0 used heuristics inspired by Audiveris instead of faithfully porting the
  algorithms. Results: notes mostly wrong, durations wrong, grand staff broken.
- The player stayed stuck at "0% — loading player..." because of a progress
  callback signature mismatch between the engine (`report(percent, msg)`) and
  the page template callback (`(step, msg, percent)`).
- User has **NO CDN cache access** → cache buster MUST be bumped on every
  deploy (`?ver=X.Y.Z` in page-omr-scanner.php and functions.php).

### 14-Phase Plan (Audiveris → JavaScript port)
| Phase | Scope | Ports from Audiveris |
|-------|-------|----------------------|
| 0 | Debloquer le player + logging | fix `report()` signature, pin AlphaTab, timeouts |
| 1 | Split engine in multi-file modules | — |
| 2 | ImageProcessor v2 (binarization, skew) | `BinaryStep`, `skew/SkewBuilder` |
| 3 | ScaleBuilder (interline, line thickness, beam) | `sheet/ScaleBuilder.java` |
| 4 | LinesRetriever + ClustersRetriever | `sheet/grid/LinesRetriever.java`, `ClustersRetriever.java` |
| 5 | BarsRetriever (barlines + systems) | `sheet/grid/BarsRetriever.java`, `HiLoPeakFinder.java` |
| 6 | StemSeedsBuilder + chamfer distance transform | `sheet/stem/StemSeedsBuilder.java`, `image/DistanceTable.java` |
| 7 | BeamsBuilder (morphological spots) | `sheet/beam/BeamsBuilder.java` |
| 8 | Template factory + NoteHeadsBuilder two-pass | `image/TemplateFactory.java`, `sheet/note/NoteHeadsBuilder.java` |
| 9 | LedgersBuilder | `sheet/ledger/LedgersBuilder.java` |
| 10 | StemsBuilder + HeadLinker | `sheet/stem/StemsBuilder.java`, `HeadLinker.java` |
| 11 | ClefBuilder + KeyBuilder + TimeBuilder | `sheet/clef/ClefBuilder.java`, `sheet/key/*`, `sheet/time/*` |
| 12 | RestsBuilder + AltersBuilder (accidentals) | `sheet/rhythm/RestsBuilder.java`, `sheet/note/AltersBuilder.java` |
| 13 | SIGraph + Rhythm + voice assignment | `sig/SIGraph.java`, `sheet/rhythm/*` |
| 14 | MusicXML + MIDI emit + player integration | `score/PartwiseBuilder.java` |

### Target File Layout (Phase 1+)
```
blocksy-child/
├── page-omr-scanner.php              ← WP template (inline JS player init)
├── assets/OCR-Scan/
│   ├── omr-scanner.css
│   ├── omr-scanner-api.php
│   ├── omr-admin.php
│   └── engine/
│       ├── omr-core.js               ← namespace, constants, utils, report()
│       ├── omr-image.js              ← ImageProcessor: load, binarize, skew, runs
│       ├── omr-scale.js              ← ScaleBuilder (Phase 3)
│       ├── omr-grid-lines.js         ← LinesRetriever + ClustersRetriever (Phase 4)
│       ├── omr-grid-bars.js          ← BarsRetriever (Phase 5)
│       ├── omr-distance.js           ← Chamfer distance transform (Phase 6)
│       ├── omr-stems-seeds.js        ← StemSeedsBuilder (Phase 6)
│       ├── omr-beams.js              ← BeamsBuilder (Phase 7)
│       ├── omr-templates.js          ← TemplateFactory (Phase 8)
│       ├── omr-heads.js              ← NoteHeadsBuilder two-pass (Phase 8)
│       ├── omr-ledgers.js            ← LedgersBuilder (Phase 9)
│       ├── omr-stems.js              ← StemsBuilder + HeadLinker (Phase 10)
│       ├── omr-clef-key-time.js      ← Clef/Key/Time builders (Phase 11)
│       ├── omr-rests-alters.js       ← Rests + accidentals (Phase 12)
│       ├── omr-sig.js                ← SIGraph + rhythm + voices (Phase 13)
│       ├── omr-musicxml.js           ← MusicXML writer (Phase 14)
│       ├── omr-midi.js               ← MIDI writer (Phase 14)
│       └── omr-engine.js             ← Orchestrator: Engine.process() pipeline
├── functions.php                      ← enqueues ALL engine JS + cache buster
```

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
- Branch: `claude/audiveris-ocr-integration-vO3oz`
- Push: `git push -u origin claude/audiveris-ocr-integration-vO3oz`
- **ONE COMMIT PER FILE** (user explicit demand)
- Do NOT create a pull request unless the user explicitly asks
- Run git commands from `/home/user/audiveris_pianomode` (repo root)

### Cache-Buster Rule (CRITICAL)
- User has NO CDN cache access → **every** JS/CSS change MUST bump the version
- Version constant lives in `functions.php` (`PIANOMODE_OMR_VER`)
- `page-omr-scanner.php` inline `<script src=...?ver=X.Y.Z>` must match

### Test Material
- User uploaded a "morning sunbeam" PDF in main repo (not yet located during port)
- Fallback test PDFs available in `app/src/test/resources/` and `data/examples/`
