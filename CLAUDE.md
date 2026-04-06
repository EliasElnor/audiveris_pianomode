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
