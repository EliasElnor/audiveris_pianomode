# CLAUDE.md — PianoMode OCR Scanner Project

## Current State (2026-04-04)
Branch: `claude/integrate-audiveris-ocr-0XMux`

### What's Done
- Single merged `omr-engine.js` with all 6 modules (1674 lines)
- Engine uses async steps (setTimeout yields) so UI updates during processing
- Real progress bar with percentage (gold gradient, 0-100%)
- CSS, API, admin, page template all functional
- Old part files deleted
- Hero padding fixed for header clearance
- Everything pushed to remote

### File Locations
```
blocksy-child/
├── page-omr-scanner.php          ← WP template (must stay at root)
├── assets/OCR-Scan/
│   ├── omr-engine.js             ← Complete OMR engine (all 6 modules)
│   ├── omr-scanner.css           ← page styles + progress bar
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

### JS Engine Structure
```
window.PianoModeOMR = {};
PianoModeOMR.ImageProcessor  → loadImage, loadPDF, toGrayscale, otsuThreshold, binarize, cleanNoise
PianoModeOMR.StaffDetector   → detect, removeStaffLines, detectClefs
PianoModeOMR.NoteDetector    → findBlobs, filterNoteHeads, detectStems, detectFlags, detectBeams, detectRests, detectBarLines, classifyDuration, assignPitch, organizeNotes, detect
PianoModeOMR.MusicXMLWriter  → generate
PianoModeOMR.MIDIWriter      → generate, toBlob, toBlobURL
PianoModeOMR.Engine          → process(file, onProgress) → Promise (async with yields)
```

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
