# CLAUDE.md — PianoMode OCR Scanner Project

## Current State (2026-04-03)
Branch: `claude/integrate-audiveris-ocr-0XMux`

### What's Done
- 3 JS engine files exist in `blocksy-child/assets/OCR-Scan/` (part1, part2, part3)
- CSS, API, admin, page template all exist
- Everything pushed to remote

### CRITICAL TODO (in order)
1. **MERGE JS**: Combine omr-engine-part1/2/3.js → single `omr-engine.js` (bug: parts load out of order causing `Cannot read properties of undefined (reading 'detect')`)
2. **DELETE old part files** after merge
3. **FIX hero CSS**: Add `padding-top: 120px` to `.pm-omr-hero` (header covers title)
4. **UPDATE template**: `page-omr-scanner.php` lines 282-284 → load single `omr-engine.js` instead of 3 parts
5. **UPDATE functions.php**: line ~355 area, paths reference OCR-Scan folder

### File Locations
```
blocksy-child/
├── page-omr-scanner.php          ← WP template (must stay at root)
├── assets/OCR-Scan/
│   ├── omr-engine-part1.js       ← TO DELETE after merge
│   ├── omr-engine-part2.js       ← TO DELETE after merge  
│   ├── omr-engine-part3.js       ← TO DELETE after merge
│   ├── omr-engine.js             ← TO CREATE (merged)
│   ├── omr-scanner.css           ← page styles
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

### JS Engine Structure (for merged file)
```
window.PianoModeOMR = {};
PianoModeOMR.ImageProcessor  → loadImage, loadPDF, toGrayscale, otsuThreshold, binarize, cleanNoise
PianoModeOMR.StaffDetector   → detect, removeStaffLines, detectClefs
PianoModeOMR.NoteDetector    → findBlobs, filterNoteHeads, detectStems, detectFlags, detectBeams, detectRests, detectBarLines, classifyDuration, assignPitch, organizeNotes, detect
PianoModeOMR.MusicXMLWriter  → generate
PianoModeOMR.MIDIWriter      → generate, toBlob, toBlobURL
PianoModeOMR.Engine          → process(file, onProgress) → Promise
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
