# CLAUDE.md — PianoMode OCR Scanner Project

## Current State (2026-04-17)
Branch: `claude/audiveris-integration-zOSh8`
Cache buster: **v6.19.0** (sync'd in `omr-core.js` `OMR.VERSION` and
`functions.php` `PIANOMODE_OMR_VER`).

**STATUS:** Audiveris-port pipeline is authoritative (all 14 phases enabled by
default via `OMR.flags`, legacy v6 heuristics only run as fallback). Wave 4
(v6.19.0) attacks the real root cause of "Found 0 staves" on PDFs that Wave 3's
diagnostics exposed: the Audiveris-default slope / straightness / vertical-gap
budgets in `omr-grid-lines.js` are authored for 300-DPI scans. PDFs rasterized
via PDF.js at scale 3.0 produce 1-px antialiased staff lines whose rows get
split by single-pixel breaks — the strict defaults throw the lines away. The
"fewer than 5 filaments after slope filter" message on Chopin's Valse
(interline=15, mainFore=1) is the smoking gun.

### Wave 4 fixes (v6.19.0 — 2026-04-17)
1. **Relaxed Phase 4 preset** (`omr-grid-lines.js`) — exposed a
   `makeConstants(opts)` helper that clones the module-level `C` and,
   when `opts.relaxed`, doubles `maxSlopeDeviation` (0.025 → 0.05 rad),
   grows `maxLineResidual` (1.25 → 2.0 px), bumps `maxVerticalGap`
   (1 → 2) so the filament factory bridges single-row breaks in
   antialiased lines, drops `minRunPerInterline` (0.25 → 0.20) and
   `voteRatio` (0.40 → 0.30), and eases `minLengthPerInterline`
   (5.0 → 4.0). Strict preset is untouched for high-quality scans.
2. **retrieveStaves accepts opts** — threaded `cc` (constants copy)
   through `clusterFilamentsIntoStavesWith` so the relaxed preset also
   affects the clustering vote. Kept the old
   `_clusterFilamentsIntoStaves` export for external callers.
3. **Filament-pipeline diagnostics** — the `reason` field now reports
   per-stage counts (built, after length+thickness, after straightness,
   after slope) plus the computed sheetSlope and the preset tag. No more
   guessing which filter killed the filaments.
4. **Engine retry on Phase 4 failure** (`omr-engine.js`) — if the strict
   pass returns zero staves, the engine automatically retries
   `retrieveStaves(..., {relaxed: true})` before falling back to the
   legacy detector. When the relaxed pass recovers staves the normal
   Phase 4 path continues into Phase 5+ (bars, seeds, beams, heads,
   ledgers, stems) — unlike the legacy fallback which skips those.

### Wave 3 fixes (v6.18.0 — 2026-04-17)
1. **Surface Phase 4 failure reason** (`omr-engine.js` pipeline) — log the
   `ctx.scale.reason` when scale is invalid and the `ctx.gridLines.reason`
   when LinesRetriever bails. Both paths now `console.warn` the cause so
   "Found 0 staves" stops being a silent failure. Also appends the reason
   to the on-screen progress message when the legacy fallback kicks in.
2. **Strengthen legacy StaffDetector on PDFs** (`omr-engine.js`
   `OMR.StaffDetector.detect`) — width-floor for the ink row threshold
   drops from 15 % → 6 % of the image width (PDFs rendered at scale 3.0
   are very wide and staff lines rarely cover 15 % of that, once margins
   are clipped). Added a `relaxed` retry pass that drops to 3 % with
   `1.3·avgBlack` multiplier so we still emit staves when the first pass
   misses.
3. **AlphaTab midiEventsPlayedFilter** (`page-omr-scanner.php`) — 1.3.x
   only emits MIDI events to listeners whose types are in this filter;
   the default is empty so `pmHandleMidiEvent` never fired. Now
   whitelists `NoteOn` / `NoteOff` explicitly (using
   `alphaTab.midi.MidiEventType` when available, falling back to raw
   `0x90` / `0x80`).
4. **Safer Salamander mute sequence** (`page-omr-scanner.php`) — keep
   AlphaTab's Sonivox synth AUDIBLE until the 29 Salamander mp3 samples
   finish loading (onload callback). This closes the silent window
   between `playerReady` and the sampler actually being ready. The
   volume slider keeps AlphaTab `masterVolume` in sync during loading so
   the slider always controls something audible.

### Wave 2 fixes (v6.17.0 — 2026-04-17)
User report after v6.16.1: AlphaTab still showed a single treble clef on the
second system, dozens of spurious 32nd-note clusters appeared where rests /
dynamics / fingerings belonged in the source, reading order was wrong, and the
playback sound was "pas un vrai grand piano". Fixes, one commit per file:
1. **Force bass clef on paired lower staff** (`omr-clef-key-time.js`
   `scanClef()`) — when `staff.partner` + `staff.staffIndex` are set,
   return TREBLE/BASS from the grand-staff convention directly. Geometric
   scoring is no longer consulted for paired piano staves because the +4
   hint was losing to treble-leaning geometric cues on low-res scans.
2. **Piano-mode normalization across all systems** (`omr-musicxml.js`
   `collectParts()` / `normalizeGrandStaffIndices()`) — any sheet that
   triggers piano mode (any system with ≥2 staves, or an even total across
   single-staff systems, or multiple single-staff systems in a row) now
   stamps every staff with a `staffIndex` (0 upper / 1 lower) so
   `staffIndexInPart`'s fallback routes voices to the right staff even when
   the voice's staff object isn't in the template `staffMap`. Single-staff
   systems default their lone staff to treble so the bass side auto-emits
   a measure-rest.
3. **Restore strict head thresholds** (`omr-heads.js` `C` block) — revert
   the v6.15.0 relaxation (minGrade 0.25, maxDistanceLow 2.5, maxDistanceHigh
   4.0, maxYOffsetRatio 0.25) back to Audiveris defaults with a small
   tightening (minGrade 0.40, maxYOffsetRatio 0.18). The relaxation had
   been catching rest glyphs, dynamic markings and fingerings as heads.
4. **Tone.js + Salamander Grand Piano** (`functions.php` +
   `page-omr-scanner.php`) — enqueue Tone.js on the scanner page, build a
   `Tone.Sampler` with the 29 Salamander mp3 samples used elsewhere on the
   site (concert-hall, sightreading, virtual-piano, games), mute AlphaTab's
   Sonivox synth on `playerReady`, and drive attack/release from
   `midiEventsPlayed`. The volume slider now controls a `Tone.Volume` node
   with a cube-root taper. Graceful fallback to AlphaTab's own synth if
   Tone.js is blocked.
5. **AlphaTab autosize warning** (`page-omr-scanner.php`) — defer
   `initAlphaTab` via `requestAnimationFrame` until `atMain.offsetWidth > 0`
   so the flex layout inside `.pm-omr-alphatab-wrap` is resolved before
   AlphaTab mounts. Kills the "container was invisible while autosizing"
   warning that fired on first scan.

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
- **Phase 4 bass-staff recall** — user's Wave 2 screenshot still shows one
  system as grand staff + one system as lone treble, because Phase 4
  `pairStavesIntoSystems` missed the bass staff on the second system. Need
  to enforce "consistent staff count" across systems in a piece (if any
  system has 2 staves, every system should find 2) by searching harder for
  the missing partner filament below/above the detected staff. Possibly
  port `ClustersRetriever.matchSystems` logic from Audiveris.
- **Note classification precision** — even after the Wave 2 threshold
  tightening, some non-heads are still promoted. Future tightening should
  happen through Audiveris's built-in mechanisms (`evalBlackAsVoid`, ledger
  pitches ±6/±7, seed-conflict resolution) rather than by moving the grade
  bar again. Phase 12 accidentals and Phase 13 voice assignment also need
  review — the current voice IDs (1,2 treble / 5,6 bass) are right but the
  event ordering within a voice may still be off (user reports "lecture ne
  se fait pas dans l'ordre d'apparition des notes").
- **Cross-staff beaming + brace** — Wave 1/2 ensure both clefs render, but
  the brace/bracket glyph and cross-staff beaming still need verification
  against real piano scores. AlphaTab's rendering is what we see, and it
  appears to be drawing the brace correctly when `<staves>2</staves>` is
  emitted, so this is likely a content issue (voice/staff assignment) rather
  than a rendering issue.
- **Test material** — user's "Bright Eyes" (Florence B. Price) PDF is the
  current reference ground truth. The MIDI version of the same piece lives
  at `data/examples/price-florence-bright-eyes.midi` and is referenced from
  concert-hall.js SONG_LIBRARY_FALLBACK. Compare scanner output against
  that MIDI to catch ordering / rhythm / pitch regressions.
