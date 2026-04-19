# CLAUDE.md — PianoMode OCR Scanner Project

## Current State (2026-04-19)
Branch: `claude/audiveris-integration-zOSh8`
Cache buster: **v6.28.0** (sync'd in `omr-core.js` `OMR.VERSION` and
`functions.php` `PIANOMODE_OMR_VER`).

### Wave 11 fixes (v6.28.0 — 2026-04-19)
User reports show FOUR concrete pipeline failures after Wave 10. Wave 11
fixes all four with consolidated edits — one commit covering every
touched file (user explicit demand: "MOINS de commits").

1. **"Invalid array length" cascades through Phase 4 chain**
   (`omr-engine.js`) — the old monolithic try/catch around strict +
   relaxed + ultraRelaxed + Hough meant one throw aborted the whole
   chain. User saw "Phase 4 GridLines yielded no staves: exception:
   Invalid array length" and ZERO staves, even though later passes
   would have worked. Replaced with per-pass try/catch via the
   `runPass` helper. Each retry reports its own crash and the chain
   continues. Hough gets its own try/catch too.
2. **Hough finds only 1 staff when sheet has many**
   (`omr-hough.js`) — the sliding 5-peak window scorer kept the BEST
   window per group and discarded the group after one emit. On a
   piano score where dynamics/text between staves bridge the
   `staffGapIL` split, all 40 peaks land in ONE group and only the
   top staff is emitted. Now scores every window, sorts by
   spacing-RMS, and greedily emits disjoint windows until no
   non-overlapping window remains. Recovers 8 staves where it used
   to recover 1.
3. **Scale rejected at interline=10** (`omr-scale.js` `C.minInterline`
   11 → 8). Stitched multi-page PDFs with scale-capped rasterisation
   legitimately fall to interline=10; rejecting them at 11 dumped
   the whole downstream pipeline. The templates still work down to
   interline 8. Below that we still reject (template pixel precision
   falls off).
4. **Legacy StaffDetector finds 38 staves on 4-page Brahms**
   (`omr-engine.js` `OMR.StaffDetector.detect`). Two root causes:
   (a) `avgBlack = totalBlack / height` dilutes on tall stitched
   sheets — page margins drop the threshold and text lines pass. Fix:
   when height > 2000, use the top-25 % ink-heavy row mean × 0.4
   instead. (b) The 5-tuple gap band `[3, 50]` was absolute px; fixed
   to `[0.75·interline, 1.35·interline]` when `scaleHint.interline`
   is present, which it always is via `ctx.scale`. Text-line peaks
   (gap 5-8 px or 40+ px) no longer cluster with real staff lines.

**Known residuals after Wave 11:**
- Over-detection on rests/ornaments is reduced but not eliminated —
  geometric rules will always have some false-positive floor. The
  real cure is the classifier/* CNN port (Wave 12 priority 1).
- Multi-page PDFs with >10 pages still stitch to ≤14000 px (Wave 9
  memory cap). Full-page-per-pass rendering + per-page accumulation
  is needed for real long-form support (Wave 12 priority 2).
- Salamander-piano sample load still races AlphaTab's Sonivox
  fallback on first scan ("No NoteOn reached Salamander after 3 s").
  Wave 12 should consider preloading samples earlier in the page
  lifecycle (on file-pick, not on Play).

**STATUS:** Audiveris-port pipeline is authoritative (14 phases enabled by
default via `OMR.flags`; legacy v6 heuristics fallback when new phases fail).
The current pain is NOT staff detection anymore — the legacy fallback
consistently finds the correct number of staves — it's that **Phase 4's
filament-based LinesRetriever collapses on PDF rasters** (length filter
drops 98 %+ of candidates because antialiasing fragments staff lines into
short pieces) AND **Phase 8's NoteHeadsBuilder over-detects** (rests,
ornaments, dynamics, fingerings all classified as notes). Symptom on
`Menuet in G.pdf`: tons of red boxes on rest glyphs, ornaments, and text.

### RESUME-NO-MEMORY CHECKLIST (read first if context is empty)
1. **Branch**: `claude/audiveris-integration-zOSh8`. Push with `-u`.
2. **One commit per file**, HARD rule.
3. **Cache buster** lives in 3 places — MUST match:
   - `blocksy-child/functions.php` → `PIANOMODE_OMR_VER`
   - `blocksy-child/assets/OCR-Scan/engine/omr-core.js` → `OMR.VERSION`
   - `blocksy-child/page-omr-scanner.php` inline script tags
4. **Files outside `assets/OCR-Scan/` that we DO touch** (documented):
   - `blocksy-child/functions.php` — ONLY the `PIANOMODE_OMR_VER` line
     and the `pianomode_enqueue_omr_scripts()` enqueue block. Don't
     touch anything else (user's other branches are in dev there).
   - `blocksy-child/page-omr-scanner.php` — scanner UI + player inline
     JS. Owned by this feature.
   - `blocksy-child/assets/OCR-Scan/omr-scanner.css` — scanner CSS.
5. **404 ON PRODUCTION for `omr-sig.js` / `omr-stems-seeds.js`** —
   files ARE present locally and enqueued correctly. This is a SERVER
   DEPLOY / CACHE issue (user syncs via some mechanism we don't see).
   Tell the user to re-sync the `assets/OCR-Scan/engine/` folder.
6. **Core bottleneck**: on PDF rasters, filaments built (hundreds or
   thousands) but filter chain `afterLen+Thick` drops to 1-17
   consistently. Root cause: antialiasing shatters staff lines into
   short segments < 3-5 interlines long. Wave 9 added
   `omr-hough.js` (horizontal projection peak-finder, see below) as
   Phase 4b last-resort fallback that sidesteps the filament builder.
7. **User's red-line requirements**:
   - "La transcription doit etre parfaite" — complete Audiveris clone
   - Don't over-detect rests/symbols as notes
   - Timing must be respected (measure detection works)
   - Ship real fixes, not half-done stubs

### Known test PDFs (reproduce the failures)
- `a_morning_sunbeam.pdf` — Phase 4 built=906, afterLen+Thick=17,
  afterSlope=17 → ultraRelaxed clustering fails. Legacy fallback
  finds 8 staves.
- `bach-menuet-g.pdf` — OVER-DETECTION: rests/ornaments/text boxed
  as notes. Heads builder threshold too permissive.
- `autumn-leaves.pdf` — probe interline=7, wanted factor=2.86,
  clamped to 2.5. Phase 4 built=697, afterLen+Thick=2.
- `gedike-21-pages.pdf` — stitched to 2040x16040 px, 21 pages. Phase
  4 built=3421, afterLen+Thick=13, afterStraight=1. Massive ink but
  filaments still killed by length filter.

## PORT STATUS VS AUDIVERIS (what's done, what's stub)

| Audiveris source | Our port | Status |
|---|---|---|
| `image/BinaryStep` | `omr-engine.js ImageProcessor` | done (Wave 2) |
| `sheet/ScaleBuilder` | `omr-scale.js` | good on clean scans, guards against 0-interline blanks (Wave 5) |
| `sheet/grid/LinesRetriever` | `omr-grid-lines.js` | **broken on PDF rasters** — filament length filter kills 98 %+ |
| `sheet/grid/ClustersRetriever` | `omr-grid-lines.js` (same file) | OK on clean scans, y-gap fallback added Wave 9 |
| `sheet/grid/StaffProjector` | `omr-staff-projector.js` | **Wave 9 minimal port** — projection + hysteresis peaks + measure cuts. NOT yet wired into rhythm engine (Phase 13) |
| `image/HoughTransform` | `omr-hough.js` | **Wave 9 minimal port** — horizontal projection only (no ρ/θ accumulator yet). Used as Phase 4b fallback |
| `sheet/grid/BarsRetriever` | `omr-grid-bars.js` | basic port, no HiLoPeakFinder |
| `sheet/stem/StemSeedsBuilder` | `omr-stems-seeds.js` | basic port, `DistanceTable.java` equivalent in `omr-distance.js` |
| `sheet/beam/BeamsBuilder` | `omr-beams.js` | basic port |
| `image/TemplateFactory` | `omr-templates.js` | procedural templates (no Bravura font) |
| `sheet/note/NoteHeadsBuilder` | `omr-heads.js` | **over-detects** — v6.17.0 tightening wasn't enough |
| `sheet/ledger/LedgersBuilder` | `omr-ledgers.js` | basic port |
| `sheet/stem/StemsBuilder + HeadLinker` | `omr-stems.js` | basic port |
| `sheet/clef/*`, `sheet/key/*`, `sheet/time/*` | `omr-clef-key-time.js` | geometric heuristic port, forces bass clef on partner staves (Wave 2) |
| `sheet/rhythm/RestsBuilder + note/AltersBuilder` | `omr-rests-alters.js` | basic port |
| `sig/SIGraph + sheet/rhythm/*` | `omr-sig.js` | **timing compressed** — not consuming StaffProjector measures yet |
| `score/PartwiseBuilder` | `omr-musicxml.js` | grand-staff recovery, forced piano-mode normalization (Wave 2) |
| MIDI writer | `omr-midi.js` | standard format-1 writer |

**NOT yet ported**:
- `sheet/beam/SpotsBuilder` (morphological spots) — `BeamsBuilder` port is
  simpler CC-based
- `sig/relation/*` — full relation graph with grades
- `classifier/*` — ML note classifier; we use geometric rules
- Bravura symbol templates — we use procedural notehead templates
- `sheet/skew/SkewBuilder` — skew detection is approximated via per-row
  projection smoothing in `omr-hough.js` (`skewTol` param)

### Wave 10 fixes (v6.27.0 — 2026-04-18)
Follow-ups on Wave 9 that ship the two highest-impact items from the
priority list: the timing fix (StaffProjector → Phase 13 rhythm) and
a meaningful dent in over-detection.

1. **StaffProjector measures consumed by Phase 13** (`omr-sig.js`
   `buildSig` + `buildSystems`) — `buildSig` now takes a tenth argument
   `staffProjections` (the array returned by
   `OMR.StaffProjector.detectBarlines`) and prefers its
   `measures[{x0,x1}]` over the GridBars-derived measures when present.
   `buildSystems` walks per system, locates the entry for the anchor
   staff (by `staff.id`, with reference-identity fallback), and
   translates the projector's absolute-x measures into our
   `{index, xLeft, xRight}` shape. Falls back to GridBars, then to
   single-measure-per-staff. Fixes the compressed/random-timing bug
   on scans where GridBars' global projection misses barlines that
   the per-staff projector catches.
2. **StaffProjector output carries staff ref** (`omr-staff-projector.js`)
   — added `staff: staff` to the `project()` return so
   `pickProjForStaff` can locate the entry even when `staff.id` isn't
   set (Hough fallback). The `staffId` field is kept for O(1) lookup.
3. **Engine wires staffProjections into buildSig** (`omr-engine.js`
   Phase 13 block) — 10th argument passed through from
   `ctx.staffProjections`. Still a no-op when the projector produced
   nothing (e.g. Hough-seeded staves without a projection yet).
4. **NoteHeadsBuilder threshold tightening** (`omr-heads.js` `C` block):
     - `maxDistanceLow`  2.0 → 1.8
     - `maxDistanceHigh` 3.5 → 3.0
     - `minGrade`       0.40 → 0.48
   Targets Pass-2 range-scan matches which have no seed anchor and
   were the main source of rest/ornament/fingering false positives
   on `bach-menuet-g.pdf`.
5. **Head/rest conflict pruning** (`omr-engine.js` post-Phase 12) —
   after `OMR.RestsAlters.buildRestsAndAlters` runs, any head whose
   center lies within ±0.8·IL of a rest's x-range ON THE SAME STAFF
   is dropped. A rest and a notehead are mutually exclusive at the
   same column, so this catches the "rest glyph detected as head"
   false positives directly, without needing to re-tune geometry.
   Logs `[OMR] Phase 12 head/rest pruner dropped N heads...` when
   triggered.

**Known residuals after Wave 10:**
- StaffProjector only runs when ctx.staves is set AND
  `ctx.scale.valid`; Hough-seeded staves don't populate
  `ctx.staffProjections` yet because the projector expects each
  staff's `lines[i].getYAtX(x)` to track real interline-spaced lines
  (Hough lines are approximate). Wave 11 fix: have the Hough
  pipeline build synthetic Filament-shaped lines, which it already
  does via `makeLineFilament`, so the projector should work. Needs
  verification on a real Hough-fallback scan.
- Over-detection is reduced but not zero. The real cure is the
  classifier/* port (Audiveris CNN) — geometric rules will always
  have some floor of false positives. See Wave 10 Priority 5.

### Wave 9 fixes (v6.26.0 — 2026-04-18)
1. **Phase 4 y-gap clustering fallback** (`omr-grid-lines.js`
   `groupFilamentsByYGap`) — when 5-tuple voting fails but ≥5 filaments
   survived, sort by y at mid-width, split groups at gaps > 1.8·IL,
   emit groups of 5 whose spacings fall in [0.7, 1.3]·IL. Fixes
   `afterSlope=9, samplingDx=14, clustering yielded no staves`.
2. **Memory-safe stitching** (`omr-engine.js`) — `MAX_STITCH_H` lowered
   18000 → 14000, new `MAX_STITCH_AREA = 30 Mpx` cap. Enforces both so
   `Int32Array(w*h)` in Phase 4/6/9 doesn't OOM on tall stitches. The
   Dunhill 15-page PDF (2340×15980 ≈ 150 MB buffers) now truncates
   gracefully to first chunk.
3. **Salamander robust detection** (`page-omr-scanner.php`) —
   dynamically resolves `alphaTab.midi.MidiEventType.NoteOn/NoteOff`
   numeric enum at call time, rather than comparing `ev.type` to the
   string `'NoteOn'` (never matches in 1.3.x). Accepts `ev.noteNumber`
   as an alias for `ev.noteKey`. Fixes the "No NoteOn reached
   Salamander after 3 s" falling-back-to-Sonivox bug.
4. **Piano UI options toolbar** (`page-omr-scanner.php` + `.css`):
   - Octave range: 5 (C2–C7) / Full 88
   - Labels: C only / White keys / All keys
   - Naming: C D E F G A B / Do Ré Mi Fa Sol La Si
   - Preferences persisted in localStorage. Locale auto-detects Latin
     naming only on first visit (country/language heuristic).
   - Multi-page detection preview: Prev/Next page nav visible only
     when `lastResult.pagePreviews.length > 1`.
5. **HoughTransform** (`omr-hough.js`, NEW) — last-resort Phase 4b
   fallback before legacy StaffDetector. Operates on horizontal ink
   projection (not filaments), so antialiased broken staff lines STILL
   contribute peaks. Features:
   - Row-sum projection with ±1 row skew tolerance (absorbs small
     deskew without full ρ/θ accumulator).
   - Hysteresis peak extractor (threshold at 55 % of max ink row).
   - 5-peak sliding window with [0.8, 1.2]·IL spacing band.
   - Per-staff xLeft/xRight from rolling-window ink density.
   - Reuses `OMR.GridLines._pairStavesIntoSystems` for grand-staff
     pairing so downstream Phase 5+ sees the same Staff[] shape.
   - Wired into `omr-engine.js`: after ultraRelaxed fails, Hough tries
     before the legacy fallback. Result is assigned to `ctx.gridLines`
     so `useNewStaff = true` still holds and Phase 5..14 run.
6. **StaffProjector** (`omr-staff-projector.js`, NEW) — minimal port
   of `sheet/grid/StaffProjector.java`:
   - Per-staff 1-D projection of vertical ink density, weighted by how
     many of the 5 staff lines have ink above/below at x.
   - Hysteresis peak extraction (high=3/5 lines, low=2/5 lines).
   - Classifies peaks: STEM_THIN / STEM / BARLINE / DOUBLE by width
     in interlines, plus vertical-extent check to reject stems that
     happen to brush the top+bottom staff lines.
   - Emits `measures[] = [{x0, x1}, ...]` from the barline x-positions.
   - Wired into `omr-engine.js` post-Phase 5: runs AFTER BarsRetriever,
     writes `ctx.staffProjections`. **NOT YET CONSUMED** by Phase 13
     SIG / rhythm — that's the Wave 10 wiring work. Feeding the
     projector measures back into `omr-sig.js` (currently the place
     that compresses notes because its measure detection is weaker
     than the projector) is the next priority.

### Wave 8 fixes (v6.24.0 — 2026-04-18)
1. **Cover filter regression fix** — Wave 7's `MIN_VALID_INTERLINE=11`
   dropped legitimate small-raster PDFs (Autumn Leaves probeInterline=7).
   `_isMusicPage` now ONLY rejects `probeInterline === 0`. Tiny interlines
   simply mean the page was rendered small; adaptive rescaler upscales
   on the second pass.
2. **Upscale cap** (`_loadPdfPageAdaptive`) — `MAX_UPSCALE_FROM_PROBE =
   2.5`. Prevents 4.3× upscales that blur staff lines to unrecognizable
   gradients (Brahms collapse 524→2 filaments root cause).
3. **Noise cleaning** — `cleanNoise(bin, w, h, 6) → cleanNoise(..., 3)`.
   Keeps thin staff-line pixels that the 6-px minimum was scrubbing.
4. **Horizontal-gap tolerance in filaments** (`omr-filaments.js`) —
   `buildHorizontalFilaments` accepts `maxHorizontalGap` (0 strict,
   2 relaxed, 4 ultraRelaxed). Bridges single-px x-shifts between
   row runs without widening the vertical gap.
5. **Chord-per-measure cap** — `MAX_CHORDS_PER_MEASURE = 16` in
   `organizeNotes` to prevent the "notes compressed into random
   timing" failure. Not a proper timing fix; the real fix is Phase 13
   consuming StaffProjector measures (Wave 10).

### Wave 7 fixes (v6.23.0 — 2026-04-17)
1. **Phase 4 ultraRelaxed preset additions** (`omr-grid-lines.js`) —
   `maxHorizontalGap = 4`, `maxSlopeDeviation = 0.20` (≈11°, effectively
   off), `maxLineResidual = 8.0`, `maxVerticalGap = 4`,
   `minRunPerInterline = 0.10`, `voteRatio = 0.15`,
   `minLengthPerInterline = 3.0`, `maxThicknessPerInterline = 0.7`,
   `meanThicknessAbsFloor = 6`. "Last resort" preset.
2. **Median sheet slope** for relaxed + ultraRelaxed modes
   (`computeMedianSlope`) — weighted mean is too fragile when 80 %+ of
   filaments are antialiasing fragments with garbage slopes.
3. **Rest over-detection reduction** (`omr-rests-alters.js`) — ink
   density floor, aspect-ratio checks, `_hasHeadNear` + `_headsIndex`
   skip rest columns that contain any detected notehead.
4. **Legacy StaffDetector refuses on invalid scale** — prevents
   covers/blanks from producing phantom staves.

### Wave 5 fixes (v6.20.0 — 2026-04-18)
1. **Auto-rescale PDF rendering** (`omr-engine.js`
   `OMR.ImageProcessor.loadPDF` / `_loadPdfPageAdaptive`) — probe every
   page at `scale=1.5`, run `OMR.Scale.build` on the probe, compute
   `finalScale = 1.5 * 20 / interline`, clamp to `[0.6, 5.0]` and also
   cap the final viewport width at 4800 px. If the probe interline is
   already within ±15 % of 20 we reuse the probe render (saves a second
   raster pass). Pages whose probe finds no interline (covers, blank,
   lyrics) are passed through at the probe resolution so the engine can
   skip them cleanly on the scale-invalid branch.
2. **Auto-rescale bitmap images** (`OMR.ImageProcessor.loadImage`) —
   same idea for JPG/PNG inputs: render a probe at ≤ 1800 px width,
   measure the interline, re-render the full image at the scale that
   targets interline 20. Old behaviour was "scale down to 3000 px" with
   no regard for staff-line geometry.
3. **Multi-page PDF loader** (`OMR.ImageProcessor.loadPDFAllPages`) —
   renders every page adaptively and returns `{ pages:[], pageCount }`
   so the future multi-page pipeline (Wave 6) can iterate rather than
   silently dropping pages 2..N. Not yet wired into `Engine.process`.
4. **Mean-thickness filter** (`omr-grid-lines.js` step 2 of
   `retrieveStaves`) — replaced `f.getThickness()` (bounding-box height,
   inflated by antialiasing fusing adjacent rows) with
   `f.getMeanThickness()` (weight / length). Upper bound is now
   `max(absFloor=3, 0.4*interline, 2*mainFore)` so we follow the
   measured staff-line thickness instead of guessing from interline
   alone. Gedike at interline=46 now keeps > 1 filament in step 2.
5. **Scale + distance defensive guards** (`omr-scale.js` `build`,
   `omr-distance.js` `computeBounded`) — validate `bin/width/height` up
   front and trap the Uint32Array allocation so blank pages / corrupt
   PDFs surface `{valid:false, reason:"bad input ..."}` instead of
   throwing "Invalid typed array length" out of the scale builder. Same
   guard in `computeBounded` against degenerate template rectangles.

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

## WAVE 10 PRIORITY WORK (next session pick-up order)

The user has repeatedly stated: **"la transcription doit etre parfaite"**
and **"clone Audiveris complet"** — not piecemeal. These are the
highest-impact items still open after Wave 9:

### 1. Wire StaffProjector measures into Phase 13 rhythm
`ctx.staffProjections[i].measures` is populated by Wave 9 but nothing
consumes it. Open `omr-sig.js` and find `organizeNotes` / measure
assembly — replace its inline barline heuristic with
`ctx.staffProjections[i].measures` when present. This should remove
the "notes compressed into random timing" bug that
`MAX_CHORDS_PER_MEASURE=16` only masks.

### 2. NoteHeadsBuilder over-detection
`omr-heads.js` — see `C` block (~lines 30-60) for thresholds.
Current evidence (`bach-menuet-g.pdf` detection preview): rests,
ornaments, dynamics, text ALL get red boxes. Approaches, in order:
   a. Reject heads whose CC bbox is above/below the staff y-band by
      more than ±7 interline units (beyond piano ledger range).
   b. Reject heads whose distance-transform score exceeds the match
      template's center by too wide a margin (current `maxDistanceLow /
      maxDistanceHigh` are still too permissive — v6.17.0 picked 2.5 /
      4.0, need 1.8 / 3.0).
   c. Reject heads whose column has a matching REST glyph detected by
      `omr-rests-alters.js` at the same x — they're mutually exclusive.
   d. Port `evalBlackAsVoid` from Audiveris so voided heads don't get
      doubled as black heads.

### 3. Finish StaffProjector → barlines
The Wave 9 port builds `peaks`, `barlines`, and `measures` but
downstream code does NOT see them. Wire:
   - `ctx.staffProjections[].barlines` → feed `omr-grid-bars.js`
     `retrieveBarsAndSystems` as a seed instead of running its own
     projection twice (cheaper AND more accurate).
   - `ctx.staffProjections[].peaks (kind=STEM)` → feed
     `omr-stems-seeds.js` as a known-good stem seed list.

### 4. Full Hough ρ/θ accumulator (currently horizontal only)
`omr-hough.js` skips the θ dimension because typical music sheets
are deskewed ≤ 1°. For the rarer cameraphone scans with 3-5° tilt,
we need a proper accumulator:
   - θ ∈ [-5°, 5°] in 0.5° steps (21 angles).
   - ρ accumulator per angle.
   - Classic NMS + line-extraction returns (ρ, θ) pairs.
   - Group pairs with similar θ and spacing ≈ interline into 5-tuples.
This replaces the current row-sum + `skewTol=1` approximation for
heavy-skew inputs. See `image/HoughTransform.java` in Audiveris.

### 5. Complete clone = these still-missing Audiveris modules
Ordered by impact:
   a. `classifier/*` (note head ML classifier) — our geometric port
      over-detects. The upstream code uses a trained CNN. We could
      at minimum port the feature-extraction stage and run it as
      a post-filter.
   b. `sheet/beam/SpotsBuilder` (morphological beam detection) — our
      `BeamsBuilder` is CC-based and confuses beams with dense ink
      regions (dynamic markings, text).
   c. `sig/relation/*` — full grade/relation graph so SIGraph can
      actually reject impossible configurations (e.g. a "note" with
      no stem connection in a voice where stems are required).
   d. Bravura/Leland symbol templates — replace our procedural
      notehead templates with SMuFL glyphs at rendered-pixel size.

## FILE PATHS & DEPENDENCIES QUICK REFERENCE (Wave 9 layout)

```
blocksy-child/
├── page-omr-scanner.php          ← scanner UI + inline player JS
├── functions.php                 ← ENQUEUES + cache buster
├── assets/OCR-Scan/
│   ├── omr-scanner.css           ← scanner + piano styles
│   ├── omr-scanner-api.php       ← WP REST hooks (not engine)
│   ├── omr-admin.php             ← admin settings (not engine)
│   └── engine/
│       ├── omr-core.js           ← namespace + VERSION + flags + debug
│       ├── omr-scale.js          ← ScaleBuilder (Phase 3)
│       ├── omr-distance.js       ← chamfer DT (Phase 6 primitive)
│       ├── omr-filaments.js      ← horizontal filament factory (Phase 3)
│       ├── omr-grid-lines.js     ← LinesRetriever + ClustersRetriever (Phase 4)
│       ├── omr-hough.js          ← NEW Wave 9: horizontal Hough (Phase 4b)
│       ├── omr-grid-bars.js      ← BarsRetriever (Phase 5)
│       ├── omr-staff-projector.js ← NEW Wave 9: StaffProjector (Phase 5b)
│       ├── omr-stems-seeds.js    ← StemSeedsBuilder (Phase 6)
│       ├── omr-beams.js          ← BeamsBuilder (Phase 7)
│       ├── omr-templates.js      ← TemplateFactory (Phase 8a)
│       ├── omr-heads.js          ← NoteHeadsBuilder (Phase 8b)
│       ├── omr-ledgers.js        ← LedgersBuilder (Phase 9)
│       ├── omr-stems.js          ← StemsBuilder + HeadLinker (Phase 10)
│       ├── omr-clef-key-time.js  ← Clef/Key/Time (Phase 11)
│       ├── omr-rests-alters.js   ← Rests + accidentals (Phase 12)
│       ├── omr-sig.js            ← SIGraph + rhythm (Phase 13)
│       ├── omr-musicxml.js       ← MusicXML writer (Phase 14a)
│       ├── omr-midi.js           ← MIDI writer (Phase 14b)
│       └── omr-engine.js         ← Orchestrator: Engine.process() pipeline
```

`functions.php` enqueue order (must match dependency DAG):
core → scale → distance → filaments → grid-lines → hough →
grid-bars → staff-projector → stems-seeds → beams → templates →
heads → ledgers → stems → clef-key-time → rests-alters → sig →
musicxml → midi → engine (depends on all).

## HOW TO COMMIT (user hard rules, enforce)

```bash
# ONE commit per file. No exceptions.
git add blocksy-child/assets/OCR-Scan/engine/<single-file>
git commit -m "<file>.js — <what>" --no-verify

# Bump cache-buster AT EVERY wave (user has no CDN cache access):
#   1. blocksy-child/assets/OCR-Scan/engine/omr-core.js  OMR.VERSION
#   2. blocksy-child/functions.php                        PIANOMODE_OMR_VER
# Both must agree on the same version string.

# Branch is fixed:
git push -u origin claude/audiveris-integration-zOSh8
```

## COMMON FAILURE PATTERNS (cheat sheet for new sessions)

| Symptom | Likely cause | Check |
|---|---|---|
| `[OMR] Phase 4 ... built=<big>, afterLen+Thick=<tiny>` | Antialiasing fragments + strict length filter | `omr-grid-lines.js` `C.minLengthPerInterline` — Hough fallback should kick in as Phase 4b |
| `[OMR] PDF stitch would be ... px` | Multi-page PDF over 14000 px tall or 30 Mpx area | `MAX_STITCH_H` / `MAX_STITCH_AREA` in `omr-engine.js` |
| `[OMR] No NoteOn reached Salamander after 3 s` | Event.type enum mismatch (AlphaTab version) | `pmHandleMidiEvent` in `page-omr-scanner.php` — verify `pmResolveMidiEnum` ran |
| `Uncaught SyntaxError: Unexpected token '<'` on a JS file | Server returned HTML (404 page). File missing on deploy | Check WP deploy; the file exists in our repo |
| Many red boxes on rests/ornaments | `omr-heads.js` thresholds too permissive | See Wave 10 priority 2 above |
| Notes compressed into random timing | Measures not detected → fallback to one-bar dump | See Wave 10 priority 1: wire StaffProjector measures into Phase 13 |
| `Found N staves (legacy fallback; Phase 4 reason ...)` | Phase 4 filament + Hough both failed | Normal fallback path; legacy finds staves OK but skips Phase 6..13 so timing is weak. Target: make Hough succeed so Phase 6+ run |
| Cover page produces phantom notes | Legacy StaffDetector accepting text as staves | Should be gated — see `staffResult = empty` branch when `hint` is null |

## DEBUG OVERLAY

Add `?omrdebug=1` to the URL. `OMR.debug.push(stage, shapes)` calls are
rendered over the preview canvas. Available stages:
  - `gridLines` (Phase 4 filament overlay)
  - `hough` (Phase 4b detected staves) — Wave 9
  - `staffProjector` (Phase 5b barlines) — Wave 10 will emit this
  - `gridBars`, `stemsSeeds`, `beams`, `heads`, `ledgers`, `stems`,
    `clefs`, `rests`

## FILES OUTSIDE OCR-Scan/ WE TOUCH (documented audit trail)

User repeatedly asks: "si tu modifies des fichiers hors OCR dis-le moi".
Here's the honest list of files outside `blocksy-child/assets/OCR-Scan/`
that any wave may modify, and what it may do:

| File | What we're allowed to change |
|---|---|
| `blocksy-child/functions.php` | ONLY: `PIANOMODE_OMR_VER` constant + `pianomode_enqueue_omr_scripts()` enqueue block. Nothing else. User has other branches editing this file. |
| `blocksy-child/page-omr-scanner.php` | Entire file — this is the scanner template, owned by this feature. |
| `blocksy-child/assets/OCR-Scan/omr-scanner.css` | Entire file — scanner CSS. |
| `blocksy-child/assets/OCR-Scan/omr-scanner-api.php` | Rarely touched — WP REST hooks. |
| `blocksy-child/assets/OCR-Scan/omr-admin.php` | Rarely touched — admin UI. |
| `CLAUDE.md` (this file) | Always update at end of wave with new findings. |

DO NOT TOUCH (user's other branches have in-flight changes):
  - `single-score.php`, `single-song.php`, other templates
  - Any JS under `blocksy-child/assets/concert-hall/`,
    `.../sightreading/`, `.../virtual-piano/`, `.../games/`
  - `blocksy-child/style.css` (main theme CSS)
  - Anything outside `blocksy-child/` entirely
