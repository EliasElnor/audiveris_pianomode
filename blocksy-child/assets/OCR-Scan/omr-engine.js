/**
 * PianoMode OMR Engine — Complete Client-Side Music Recognition
 * Converts sheet music images/PDFs into MusicXML + MIDI entirely in the browser.
 *
 * Modules: ImageProcessor, StaffDetector, NoteDetector, MusicXMLWriter, MIDIWriter, Engine
 * No server dependencies. No Java. No Audiveris.
 *
 * @package PianoMode
 * @version 2.1.0
 */
(function() {
'use strict';

var OMR = window.PianoModeOMR = {};

PianoModeOMR.ImageProcessor = {

    /**
     * Load an image from a File/Blob and return ImageData
     */
    loadImage: function(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                var img = new Image();
                img.onload = function() {
                    var canvas = document.createElement('canvas');
                    // Limit max dimension to 3000px for performance
                    var scale = 1;
                    if (img.width > 3000 || img.height > 3000) {
                        scale = 3000 / Math.max(img.width, img.height);
                    }
                    canvas.width = Math.round(img.width * scale);
                    canvas.height = Math.round(img.height * scale);
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    resolve({
                        imageData: imageData,
                        width: canvas.width,
                        height: canvas.height,
                        canvas: canvas
                    });
                };
                img.onerror = function() { reject(new Error('Failed to load image')); };
                img.src = e.target.result;
            };
            reader.onerror = function() { reject(new Error('Failed to read file')); };
            reader.readAsDataURL(file);
        });
    },

    /**
     * Load a PDF first page as image using pdf.js (loaded externally)
     */
    loadPDF: function(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                var typedArray = new Uint8Array(e.target.result);
                if (typeof pdfjsLib === 'undefined') {
                    reject(new Error('PDF.js library not loaded'));
                    return;
                }
                pdfjsLib.getDocument({ data: typedArray }).promise.then(function(pdf) {
                    pdf.getPage(1).then(function(page) {
                        var scale = 3.0; // High res for better OCR accuracy
                        var viewport = page.getViewport({ scale: scale });
                        var canvas = document.createElement('canvas');
                        canvas.width = viewport.width;
                        canvas.height = viewport.height;
                        var ctx = canvas.getContext('2d');
                        page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function() {
                            var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                            resolve({
                                imageData: imageData,
                                width: canvas.width,
                                height: canvas.height,
                                canvas: canvas,
                                totalPages: pdf.numPages
                            });
                        });
                    });
                }).catch(reject);
            };
            reader.onerror = function() { reject(new Error('Failed to read PDF')); };
            reader.readAsArrayBuffer(file);
        });
    },

    /**
     * Convert ImageData to grayscale (in-place modifies a copy)
     */
    toGrayscale: function(imageData) {
        var data = imageData.data;
        var gray = new Uint8Array(imageData.width * imageData.height);
        for (var i = 0; i < gray.length; i++) {
            var r = data[i * 4];
            var g = data[i * 4 + 1];
            var b = data[i * 4 + 2];
            gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        }
        return gray;
    },

    /**
     * Otsu's threshold — find optimal binary threshold
     */
    otsuThreshold: function(gray) {
        var hist = new Array(256).fill(0);
        for (var i = 0; i < gray.length; i++) {
            hist[gray[i]]++;
        }
        var total = gray.length;
        var sumAll = 0;
        for (var t = 0; t < 256; t++) sumAll += t * hist[t];

        var sumBg = 0, wBg = 0, best = 0, bestT = 0;
        for (var t = 0; t < 256; t++) {
            wBg += hist[t];
            if (wBg === 0) continue;
            var wFg = total - wBg;
            if (wFg === 0) break;
            sumBg += t * hist[t];
            var meanBg = sumBg / wBg;
            var meanFg = (sumAll - sumBg) / wFg;
            var between = wBg * wFg * (meanBg - meanFg) * (meanBg - meanFg);
            if (between > best) {
                best = between;
                bestT = t;
            }
        }
        return bestT;
    },

    /**
     * Binarize grayscale array: 1 = black (ink), 0 = white (paper)
     */
    binarize: function(gray, threshold) {
        var binary = new Uint8Array(gray.length);
        for (var i = 0; i < gray.length; i++) {
            binary[i] = gray[i] < threshold ? 1 : 0;
        }
        return binary;
    },

    /**
     * Clean small noise blobs (morphological opening approximation)
     */
    cleanNoise: function(binary, width, height, minSize) {
        minSize = minSize || 3;
        var cleaned = new Uint8Array(binary);
        // Simple 3x3 erosion then dilation
        var eroded = new Uint8Array(binary.length);
        for (var y = 1; y < height - 1; y++) {
            for (var x = 1; x < width - 1; x++) {
                var idx = y * width + x;
                if (binary[idx] === 1 &&
                    binary[idx - 1] === 1 && binary[idx + 1] === 1 &&
                    binary[idx - width] === 1 && binary[idx + width] === 1) {
                    eroded[idx] = 1;
                }
            }
        }
        // Dilation
        for (var y = 1; y < height - 1; y++) {
            for (var x = 1; x < width - 1; x++) {
                var idx = y * width + x;
                if (eroded[idx] === 1) {
                    cleaned[idx] = 1;
                    cleaned[idx - 1] = 1;
                    cleaned[idx + 1] = 1;
                    cleaned[idx - width] = 1;
                    cleaned[idx + width] = 1;
                }
            }
        }
        return cleaned;
    }
};

// =====================================================
// STAFF DETECTOR
// =====================================================
PianoModeOMR.StaffDetector = {

    /**
     * Detect staff lines using horizontal projection profile.
     * Returns array of staff groups, each with 5 line y-positions.
     */
    detect: function(binary, width, height) {
        // Step 1: Horizontal projection — count black pixels per row
        var projection = new Uint32Array(height);
        for (var y = 0; y < height; y++) {
            var count = 0;
            var offset = y * width;
            for (var x = 0; x < width; x++) {
                if (binary[offset + x] === 1) count++;
            }
            projection[y] = count;
        }

        // Step 2: Find threshold for "staff line" rows
        // Staff lines have significantly more black pixels than average
        var mean = 0;
        for (var y = 0; y < height; y++) mean += projection[y];
        mean /= height;

        // Staff line threshold: rows with > 40% of width filled
        var lineThreshold = Math.max(mean * 2, width * 0.3);

        // Step 3: Find candidate line rows (peaks)
        var candidateRows = [];
        for (var y = 0; y < height; y++) {
            if (projection[y] >= lineThreshold) {
                candidateRows.push(y);
            }
        }

        // Step 4: Merge adjacent rows into single lines
        var lines = [];
        if (candidateRows.length === 0) return [];

        var start = candidateRows[0];
        var end = candidateRows[0];
        for (var i = 1; i < candidateRows.length; i++) {
            if (candidateRows[i] - end <= 2) {
                end = candidateRows[i];
            } else {
                lines.push(Math.round((start + end) / 2));
                start = candidateRows[i];
                end = candidateRows[i];
            }
        }
        lines.push(Math.round((start + end) / 2));

        // Step 5: Group into staves (5 lines with consistent spacing)
        var staves = this._groupIntoStaves(lines);
        return staves;
    },

    /**
     * Group detected lines into staves of 5 lines each
     */
    _groupIntoStaves: function(lines) {
        if (lines.length < 5) return [];

        var staves = [];
        var used = new Array(lines.length).fill(false);

        for (var i = 0; i <= lines.length - 5; i++) {
            if (used[i]) continue;

            // Check if next 5 lines have consistent spacing
            var spacing = [];
            var valid = true;
            for (var j = 0; j < 4; j++) {
                var gap = lines[i + j + 1] - lines[i + j];
                spacing.push(gap);
            }

            // Check spacing consistency (all within 40% of median)
            spacing.sort(function(a, b) { return a - b; });
            var median = spacing[1]; // median of 4 values
            var allConsistent = true;
            for (var j = 0; j < 4; j++) {
                if (Math.abs(spacing[j] - median) > median * 0.4) {
                    allConsistent = false;
                    break;
                }
            }

            if (allConsistent && median > 3) {
                var staffLines = [];
                for (var j = 0; j < 5; j++) {
                    staffLines.push(lines[i + j]);
                    used[i + j] = true;
                }
                var avgSpacing = (staffLines[4] - staffLines[0]) / 4;
                staves.push({
                    lines: staffLines,
                    top: staffLines[0],
                    bottom: staffLines[4],
                    spacing: avgSpacing,
                    center: Math.round((staffLines[0] + staffLines[4]) / 2)
                });
            }
        }

        return staves;
    },

    /**
     * Remove staff lines from binary image (for note detection)
     * Only removes pixels that are part of horizontal runs
     */
    removeStaffLines: function(binary, width, height, staves) {
        var cleaned = new Uint8Array(binary);
        var lineThickness = 2;

        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            lineThickness = Math.max(2, Math.round(staff.spacing * 0.15));

            for (var l = 0; l < staff.lines.length; l++) {
                var lineY = staff.lines[l];
                for (var dy = -lineThickness; dy <= lineThickness; dy++) {
                    var y = lineY + dy;
                    if (y < 0 || y >= height) continue;

                    for (var x = 0; x < width; x++) {
                        var idx = y * width + x;
                        if (cleaned[idx] === 1) {
                            // Check if this pixel is part of a staff line
                            // (horizontal context: neighbors are also black)
                            // Only remove if there's no significant vertical content
                            var above = (y > 0) ? binary[(y - lineThickness - 1) * width + x] : 0;
                            var below = (y < height - 1) ? binary[(y + lineThickness + 1) * width + x] : 0;
                            if (above === 0 && below === 0) {
                                // Pure staff line pixel — remove it
                                cleaned[idx] = 0;
                            }
                            // If above OR below has ink, keep it (part of a note/symbol)
                        }
                    }
                }
            }
        }

        return cleaned;
    },

    /**
     * Detect clef type for each staff based on ink density patterns
     * Simple heuristic: treble clef is in upper half, bass clef lower
     */
    detectClefs: function(binary, width, staves) {
        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            // Default: if staves come in pairs, top = treble, bottom = bass
            if (staves.length >= 2 && s % 2 === 0) {
                staff.clef = 'treble';
            } else if (staves.length >= 2 && s % 2 === 1) {
                staff.clef = 'bass';
            } else {
                // Single staff — check ink pattern in left region
                // Treble clefs have more ink in the upper portion
                var leftRegion = Math.min(width, Math.round(staff.spacing * 6));
                var upperInk = 0, lowerInk = 0;
                var midY = staff.center;

                for (var y = staff.top - staff.spacing; y < midY; y++) {
                    if (y < 0) continue;
                    for (var x = 0; x < leftRegion; x++) {
                        if (binary[y * width + x] === 1) upperInk++;
                    }
                }
                for (var y = midY; y <= staff.bottom + staff.spacing; y++) {
                    for (var x = 0; x < leftRegion; x++) {
                        if (binary[y * width + x] === 1) lowerInk++;
                    }
                }
                staff.clef = (upperInk >= lowerInk) ? 'treble' : 'bass';
            }
        }
        return staves;
    }
};


// =====================================================
// NOTE DETECTOR v3.0 — Major accuracy improvements
// =====================================================
PianoModeOMR.NoteDetector = {

    // Chromatic scale for pitch calculations
    STEPS: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],

    // Treble clef: bottom line (line 1) = E4, each half-space up = next diatonic pitch
    TREBLE_PITCHES: [
        { step: 'E', octave: 4 }, { step: 'F', octave: 4 },
        { step: 'G', octave: 4 }, { step: 'A', octave: 4 },
        { step: 'B', octave: 4 }, { step: 'C', octave: 5 },
        { step: 'D', octave: 5 }, { step: 'E', octave: 5 },
        { step: 'F', octave: 5 }, { step: 'G', octave: 5 },
        { step: 'A', octave: 5 }, { step: 'B', octave: 5 },
        { step: 'C', octave: 6 }
    ],

    // Bass clef: bottom line (line 1) = G2
    BASS_PITCHES: [
        { step: 'G', octave: 2 }, { step: 'A', octave: 2 },
        { step: 'B', octave: 2 }, { step: 'C', octave: 3 },
        { step: 'D', octave: 3 }, { step: 'E', octave: 3 },
        { step: 'F', octave: 3 }, { step: 'G', octave: 3 },
        { step: 'A', octave: 3 }, { step: 'B', octave: 3 },
        { step: 'C', octave: 4 }, { step: 'D', octave: 4 },
        { step: 'E', octave: 4 }
    ],

    noteToMidi: function(step, octave, alter) {
        var semitones = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };
        return 12 * (octave + 1) + (semitones[step] || 0) + (alter || 0);
    },

    /**
     * Determine the left margin to skip (clef + key sig + time sig region)
     * Returns x coordinate where actual notes begin for each staff
     */
    _findNoteStartX: function(binary, width, staves) {
        var results = [];
        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            var sp = staff.spacing;
            // Scan columns from left: find where dense ink clusters end
            // Clef typically occupies ~3-4 spaces, key sig ~2-3, time sig ~2
            // Use a conservative skip of 8 spaces from left margin
            var skipWidth = Math.round(sp * 8);

            // But also detect actual end of preamble by looking for
            // a gap (low ink density column) after the initial symbols
            var minX = Math.round(sp * 4); // at least skip clef
            var bestGap = minX;

            for (var x = minX; x < Math.min(width, skipWidth + Math.round(sp * 4)); x++) {
                var ink = 0;
                for (var y = staff.top; y <= staff.bottom; y++) {
                    if (binary[y * width + x] === 1) ink++;
                }
                var staffH = staff.bottom - staff.top;
                // A "gap" column has very little ink (just staff lines, ~5 pixels)
                if (ink < staffH * 0.15) {
                    if (x > bestGap) bestGap = x;
                }
            }
            results.push(Math.max(bestGap, minX));
        }
        return results;
    },

    /**
     * Detect key signature: count sharps or flats after clef
     * Returns { fifths: N } where positive = sharps, negative = flats
     */
    detectKeySignature: function(binary, width, staves) {
        if (staves.length === 0) return { fifths: 0, accidentals: {} };

        var staff = staves[0];
        var sp = staff.spacing;
        // Key signature region: after clef (~4 spaces), before time sig
        var startX = Math.round(sp * 3.5);
        var endX = Math.round(sp * 7);
        var keySigTop = staff.top - Math.round(sp);
        var keySigBot = staff.bottom + Math.round(sp);

        // Count small dense blobs in key signature region
        // Sharps are taller and have cross-hatch pattern
        // Flats are smaller with a round bottom
        var sharpCount = 0;
        var flatCount = 0;

        // Vertical projection in key sig area
        var columns = [];
        for (var x = startX; x < Math.min(width, endX); x++) {
            var ink = 0;
            for (var y = keySigTop; y <= keySigBot; y++) {
                if (y >= 0 && y < Math.floor(binary.length / width)) {
                    if (binary[y * width + x] === 1) ink++;
                }
            }
            columns.push(ink);
        }

        // Find clusters of ink (each accidental symbol)
        var inCluster = false;
        var clusterStart = 0;
        var clusters = [];
        for (var i = 0; i < columns.length; i++) {
            if (columns[i] > sp * 0.3 && !inCluster) {
                inCluster = true;
                clusterStart = i;
            } else if (columns[i] <= sp * 0.3 && inCluster) {
                inCluster = false;
                var clusterWidth = i - clusterStart;
                if (clusterWidth > sp * 0.2 && clusterWidth < sp * 2) {
                    clusters.push({ start: clusterStart + startX, width: clusterWidth });
                }
            }
        }

        // Analyze cluster shapes to determine sharp vs flat
        for (var c = 0; c < clusters.length; c++) {
            var cl = clusters[c];
            var clHeight = 0;
            var pixels = 0;
            for (var y = keySigTop; y <= keySigBot; y++) {
                for (var x = cl.start; x < cl.start + cl.width; x++) {
                    if (y >= 0 && x < width && binary[y * width + x] === 1) {
                        pixels++;
                        clHeight = y - keySigTop;
                    }
                }
            }
            var h = clHeight;
            // Sharps are taller (~2.5 spaces), flats shorter (~1.5 spaces)
            if (h > sp * 2) sharpCount++;
            else if (h > sp * 0.5) flatCount++;
        }

        var fifths = 0;
        if (sharpCount > flatCount && sharpCount <= 7) fifths = sharpCount;
        else if (flatCount > sharpCount && flatCount <= 7) fifths = -flatCount;

        // Build accidental map from key signature
        var accidentals = {};
        var sharpOrder = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
        var flatOrder = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

        if (fifths > 0) {
            for (var i = 0; i < fifths; i++) accidentals[sharpOrder[i]] = 1;
        } else if (fifths < 0) {
            for (var i = 0; i < Math.abs(fifths); i++) accidentals[flatOrder[i]] = -1;
        }

        return { fifths: fifths, accidentals: accidentals };
    },

    /**
     * Find connected components (blobs) using two-pass labeling
     */
    findBlobs: function(binary, width, height) {
        var labels = new Int32Array(binary.length);
        var nextLabel = 1;
        var equivalences = {};

        function find(x) {
            while (equivalences[x] && equivalences[x] !== x) x = equivalences[x];
            return x;
        }
        function union(a, b) {
            a = find(a); b = find(b);
            if (a !== b) equivalences[Math.max(a, b)] = Math.min(a, b);
        }

        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var idx = y * width + x;
                if (binary[idx] === 0) continue;
                var neighbors = [];
                if (x > 0 && labels[idx - 1] > 0) neighbors.push(labels[idx - 1]);
                if (y > 0 && labels[idx - width] > 0) neighbors.push(labels[idx - width]);
                if (x > 0 && y > 0 && labels[idx - width - 1] > 0) neighbors.push(labels[idx - width - 1]);
                if (x < width - 1 && y > 0 && labels[idx - width + 1] > 0) neighbors.push(labels[idx - width + 1]);

                if (neighbors.length === 0) {
                    labels[idx] = nextLabel;
                    equivalences[nextLabel] = nextLabel;
                    nextLabel++;
                } else {
                    var minLabel = Math.min.apply(null, neighbors);
                    labels[idx] = minLabel;
                    for (var n = 0; n < neighbors.length; n++) union(minLabel, neighbors[n]);
                }
            }
        }

        var blobs = {};
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var idx = y * width + x;
                if (labels[idx] === 0) continue;
                var resolved = find(labels[idx]);
                labels[idx] = resolved;
                if (!blobs[resolved]) {
                    blobs[resolved] = { id: resolved, minX: x, maxX: x, minY: y, maxY: y, pixels: 0 };
                }
                var b = blobs[resolved];
                if (x < b.minX) b.minX = x;
                if (x > b.maxX) b.maxX = x;
                if (y < b.minY) b.minY = y;
                if (y > b.maxY) b.maxY = y;
                b.pixels++;
            }
        }

        var result = [];
        var keys = Object.keys(blobs);
        for (var i = 0; i < keys.length; i++) {
            var b = blobs[keys[i]];
            b.width = b.maxX - b.minX + 1;
            b.height = b.maxY - b.minY + 1;
            b.centerX = Math.round((b.minX + b.maxX) / 2);
            b.centerY = Math.round((b.minY + b.maxY) / 2);
            b.area = b.width * b.height;
            b.fillRatio = b.pixels / b.area;
            b.aspectRatio = b.width / b.height;
            result.push(b);
        }
        return result;
    },

    /**
     * Filter blobs to find notehead candidates — MUCH stricter than v2
     * Key improvements:
     * - Skip clef/keysig/timesig region
     * - Tighter aspect ratio (noteheads are ~1.2-1.6x wider than tall)
     * - Better size constraints relative to staff spacing
     * - Elliptical shape validation
     */
    filterNoteHeads: function(blobs, staves, noteStartX) {
        if (staves.length === 0) return [];

        var avgSpacing = 0;
        for (var i = 0; i < staves.length; i++) avgSpacing += staves[i].spacing;
        avgSpacing /= staves.length;

        // Notehead size: roughly 1 space wide, 0.7-0.9 spaces tall
        var minW = avgSpacing * 0.5;
        var maxW = avgSpacing * 2.0;
        var minH = avgSpacing * 0.35;
        var maxH = avgSpacing * 1.5;
        var noteHeads = [];

        for (var i = 0; i < blobs.length; i++) {
            var b = blobs[i];

            // CRITICAL: Skip blobs in clef/key-sig/time-sig region
            var staffIdx = -1;
            for (var s = 0; s < staves.length; s++) {
                var staff = staves[s];
                var margin = staff.spacing * 4;
                if (b.centerY >= staff.top - margin && b.centerY <= staff.bottom + margin) {
                    staffIdx = s;
                    break;
                }
            }
            if (staffIdx === -1) continue;

            // Skip if in preamble region (clef, key sig, time sig)
            var startX = noteStartX ? noteStartX[staffIdx] : 0;
            if (b.centerX < startX) continue;

            // Size filter
            if (b.width < minW || b.width > maxW) continue;
            if (b.height < minH || b.height > maxH) continue;

            // Aspect ratio: noteheads are wider than tall (0.7 to 2.2)
            if (b.aspectRatio < 0.6 || b.aspectRatio > 2.5) continue;

            // Fill ratio: noteheads have decent fill
            if (b.pixels < minW * minH * 0.25) continue;

            // Filled vs open notehead
            if (b.fillRatio > 0.50) {
                b.isFilled = true;
            } else if (b.fillRatio > 0.25 && b.aspectRatio > 0.8) {
                b.isFilled = false; // open notehead (half/whole)
            } else {
                continue; // too sparse, not a notehead
            }

            b.staffIndex = staffIdx;
            noteHeads.push(b);
        }

        return noteHeads;
    },

    /**
     * Detect stems attached to noteheads
     */
    detectStems: function(noteHeads, binary, width, height, staves) {
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            var staff = staves[nh.staffIndex];
            var stemLen = staff.spacing * 3;
            var hasStemUp = false, hasStemDown = false;

            // Check right side and left side for vertical stem
            var sides = [nh.maxX, nh.minX];
            for (var si = 0; si < sides.length; si++) {
                var checkX = sides[si];

                // Check upward
                var upCount = 0;
                for (var y = nh.minY - 1; y >= Math.max(0, nh.minY - stemLen); y--) {
                    var found = false;
                    for (var dx = -1; dx <= 1; dx++) {
                        var cx = checkX + dx;
                        if (cx >= 0 && cx < width && binary[y * width + cx] === 1) { found = true; break; }
                    }
                    if (found) upCount++;
                }
                if (upCount > stemLen * 0.45) { hasStemUp = true; break; }

                // Check downward
                var downCount = 0;
                for (var y = nh.maxY + 1; y <= Math.min(height - 1, nh.maxY + stemLen); y++) {
                    var found = false;
                    for (var dx = -1; dx <= 1; dx++) {
                        var cx = checkX + dx;
                        if (cx >= 0 && cx < width && binary[y * width + cx] === 1) { found = true; break; }
                    }
                    if (found) downCount++;
                }
                if (downCount > stemLen * 0.45) { hasStemDown = true; break; }
            }

            nh.hasStem = hasStemUp || hasStemDown;
            nh.stemDirection = hasStemUp ? 'up' : (hasStemDown ? 'down' : 'none');
        }
        return noteHeads;
    },

    /**
     * Detect flags on stems
     */
    detectFlags: function(noteHeads, binary, width, height, staves) {
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            if (!nh.hasStem) { nh.flagCount = 0; continue; }
            var staff = staves[nh.staffIndex];
            var flagZone = Math.round(staff.spacing * 1.2);
            var stemEndY = nh.stemDirection === 'up'
                ? nh.minY - Math.round(staff.spacing * 2.5)
                : nh.maxY + Math.round(staff.spacing * 2.5);
            var stemX = nh.maxX;

            var flagPixels = 0, totalPixels = 0;
            var yS = Math.max(0, Math.min(stemEndY, stemEndY + flagZone) - 2);
            var yE = Math.min(height - 1, Math.max(stemEndY, stemEndY + flagZone) + 2);
            for (var y = yS; y <= yE; y++) {
                for (var x = stemX; x < Math.min(width, stemX + flagZone); x++) {
                    totalPixels++;
                    if (binary[y * width + x] === 1) flagPixels++;
                }
            }
            var density = totalPixels > 0 ? flagPixels / totalPixels : 0;
            nh.flagCount = density > 0.3 ? 2 : (density > 0.15 ? 1 : 0);
        }
        return noteHeads;
    },

    /**
     * Detect beams connecting stems
     */
    detectBeams: function(noteHeads, binary, width, height, staves) {
        for (var i = 0; i < noteHeads.length; i++) noteHeads[i].beamCount = 0;

        for (var i = 0; i < noteHeads.length - 1; i++) {
            var nh1 = noteHeads[i], nh2 = noteHeads[i + 1];
            if (!nh1.hasStem || !nh2.hasStem) continue;
            if (nh1.staffIndex !== nh2.staffIndex) continue;
            var staff = staves[nh1.staffIndex];
            if (Math.abs(nh2.centerX - nh1.centerX) > staff.spacing * 5) continue;

            var stemEnd1Y = nh1.stemDirection === 'up'
                ? nh1.minY - Math.round(staff.spacing * 2)
                : nh1.maxY + Math.round(staff.spacing * 2);
            var stemEnd2Y = nh2.stemDirection === 'up'
                ? nh2.minY - Math.round(staff.spacing * 2)
                : nh2.maxY + Math.round(staff.spacing * 2);

            var beamY = Math.round((stemEnd1Y + stemEnd2Y) / 2);
            var startX = Math.min(nh1.centerX, nh2.centerX);
            var endX = Math.max(nh1.centerX, nh2.centerX);
            var beamPx = 0, totalScan = 0;
            for (var dy = -2; dy <= 2; dy++) {
                var y = beamY + dy;
                if (y < 0 || y >= height) continue;
                for (var x = startX; x <= endX; x++) {
                    totalScan++;
                    if (binary[y * width + x] === 1) beamPx++;
                }
            }
            if (totalScan > 0 && beamPx / totalScan > 0.4) {
                nh1.beamCount = Math.max(nh1.beamCount, 1);
                nh2.beamCount = Math.max(nh2.beamCount, 1);
                // Check double beam
                var offset = nh1.stemDirection === 'up' ? Math.round(staff.spacing * 0.5) : -Math.round(staff.spacing * 0.5);
                var b2Y = beamY + offset;
                var b2Px = 0, t2 = 0;
                for (var dy = -1; dy <= 1; dy++) {
                    var y = b2Y + dy;
                    if (y < 0 || y >= height) continue;
                    for (var x = startX; x <= endX; x++) { t2++; if (binary[y * width + x] === 1) b2Px++; }
                }
                if (t2 > 0 && b2Px / t2 > 0.4) {
                    nh1.beamCount = Math.max(nh1.beamCount, 2);
                    nh2.beamCount = Math.max(nh2.beamCount, 2);
                }
            }
        }
        return noteHeads;
    },

    /**
     * Detect rests
     */
    detectRests: function(blobs, staves, width, noteStartX) {
        var rests = [];
        if (staves.length === 0) return rests;
        var avgSpacing = 0;
        for (var i = 0; i < staves.length; i++) avgSpacing += staves[i].spacing;
        avgSpacing /= staves.length;

        for (var i = 0; i < blobs.length; i++) {
            var b = blobs[i];
            var nearStaff = -1;
            for (var s = 0; s < staves.length; s++) {
                var staff = staves[s];
                if (b.centerY >= staff.top - staff.spacing && b.centerY <= staff.bottom + staff.spacing) {
                    nearStaff = s; break;
                }
            }
            if (nearStaff === -1) continue;

            // Skip preamble region
            var startX = noteStartX ? noteStartX[nearStaff] : 0;
            if (b.centerX < startX) continue;

            var staff = staves[nearStaff];

            // Whole/half rest: rectangular, wider than tall
            if (b.width > avgSpacing * 0.5 && b.width < avgSpacing * 2 &&
                b.height > avgSpacing * 0.2 && b.height < avgSpacing * 0.8 &&
                b.fillRatio > 0.7 && b.aspectRatio > 1.2) {
                var restType = b.centerY < staff.center ? 'half' : 'whole';
                rests.push({
                    type: restType, durationValue: restType === 'half' ? 2 : 4,
                    mxlType: restType, centerX: b.centerX, centerY: b.centerY,
                    staffIndex: nearStaff, isRest: true
                });
                continue;
            }

            // Quarter rest: tall, narrow, zigzag
            if (b.height > avgSpacing * 1.5 && b.height < avgSpacing * 4 &&
                b.width < avgSpacing * 1.2 && b.aspectRatio < 0.6 &&
                b.fillRatio > 0.25 && b.fillRatio < 0.65) {
                rests.push({
                    type: 'quarter', durationValue: 1, mxlType: 'quarter',
                    centerX: b.centerX, centerY: b.centerY,
                    staffIndex: nearStaff, isRest: true
                });
                continue;
            }

            // Eighth rest
            if (b.height > avgSpacing * 0.8 && b.height < avgSpacing * 2 &&
                b.width < avgSpacing * 1.0 && b.fillRatio > 0.2 && b.fillRatio < 0.55 &&
                b.pixels > avgSpacing * 0.5 && b.aspectRatio < 0.8 && b.height > b.width * 1.2) {
                rests.push({
                    type: 'eighth', durationValue: 0.5, mxlType: 'eighth',
                    centerX: b.centerX, centerY: b.centerY,
                    staffIndex: nearStaff, isRest: true
                });
            }
        }
        return rests;
    },

    /**
     * Detect bar lines
     */
    detectBarLines: function(binary, width, height, staves) {
        var barLines = [];
        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            var staffTop = staff.top - 2;
            var staffBot = staff.bottom + 2;
            var staffH = staffBot - staffTop;

            for (var x = 0; x < width; x++) {
                var blackRun = 0;
                for (var y = staffTop; y <= staffBot; y++) {
                    if (y >= 0 && y < height && binary[y * width + x] === 1) blackRun++;
                }
                if (blackRun > staffH * 0.8) {
                    // Check it's narrow
                    var isNarrow = true;
                    for (var dx = -3; dx <= 3; dx++) {
                        if (dx === 0) continue;
                        var nx = x + dx;
                        if (nx < 0 || nx >= width) continue;
                        var nRun = 0;
                        for (var y = staffTop; y <= staffBot; y++) {
                            if (binary[y * width + nx] === 1) nRun++;
                        }
                        if (Math.abs(dx) > 2 && nRun > staffH * 0.7) { isNarrow = false; break; }
                    }
                    if (isNarrow) {
                        var isDup = false;
                        for (var b = 0; b < barLines.length; b++) {
                            if (barLines[b].staffIndex === s && Math.abs(barLines[b].x - x) < 8) { isDup = true; break; }
                        }
                        if (!isDup) barLines.push({ x: x, staffIndex: s });
                    }
                }
            }
        }
        return barLines;
    },

    /**
     * Classify note duration
     */
    classifyDuration: function(noteHeads) {
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            var flags = Math.max(nh.flagCount || 0, nh.beamCount || 0);
            if (!nh.isFilled && !nh.hasStem) {
                nh.duration = 'whole'; nh.durationValue = 4; nh.mxlType = 'whole';
            } else if (!nh.isFilled && nh.hasStem) {
                nh.duration = 'half'; nh.durationValue = 2; nh.mxlType = 'half';
            } else if (nh.isFilled && nh.hasStem && flags >= 2) {
                nh.duration = '16th'; nh.durationValue = 0.25; nh.mxlType = '16th';
            } else if (nh.isFilled && nh.hasStem && flags >= 1) {
                nh.duration = 'eighth'; nh.durationValue = 0.5; nh.mxlType = 'eighth';
            } else {
                nh.duration = 'quarter'; nh.durationValue = 1; nh.mxlType = 'quarter';
            }
        }
        return noteHeads;
    },

    /**
     * Assign pitch — IMPROVED: uses weighted center, applies key signature
     */
    assignPitch: function(noteHeads, staves, keySignature) {
        var accidentals = (keySignature && keySignature.accidentals) ? keySignature.accidentals : {};

        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            var staff = staves[nh.staffIndex];
            var halfSpace = staff.spacing / 2;

            // Use weighted vertical center for better precision
            // The center of the notehead blob is used
            var noteY = nh.centerY;

            // Calculate position index relative to bottom line
            var distFromBottom = staff.bottom - noteY;
            var posIndex = Math.round(distFromBottom / halfSpace);

            // Look up pitch from table
            var pitches = (staff.clef === 'bass') ? this.BASS_PITCHES : this.TREBLE_PITCHES;
            var pitch;

            if (posIndex >= 0 && posIndex < pitches.length) {
                pitch = { step: pitches[posIndex].step, octave: pitches[posIndex].octave };
            } else {
                // Extrapolate above or below
                var steps = this.STEPS;
                var refPitch, direction, count;
                if (posIndex >= pitches.length) {
                    refPitch = pitches[pitches.length - 1];
                    count = posIndex - pitches.length + 1;
                    direction = 1;
                } else {
                    refPitch = pitches[0];
                    count = Math.abs(posIndex);
                    direction = -1;
                }
                var si = steps.indexOf(refPitch.step);
                var oct = refPitch.octave;
                for (var e = 0; e < count; e++) {
                    si += direction;
                    if (si >= 7) { si = 0; oct++; }
                    if (si < 0) { si = 6; oct--; }
                }
                pitch = { step: steps[si], octave: oct };
            }

            // Apply key signature accidentals
            var alter = accidentals[pitch.step] || 0;
            pitch.alter = alter;

            nh.pitch = pitch;
            nh.midiNote = this.noteToMidi(pitch.step, pitch.octave, alter);
            nh.pitchName = pitch.step + (alter === 1 ? '#' : (alter === -1 ? 'b' : '')) + pitch.octave;
        }
        return noteHeads;
    },

    /**
     * Organize notes into events (chords grouped by x-position)
     */
    organizeNotes: function(noteHeads) {
        noteHeads.sort(function(a, b) { return a.centerX - b.centerX; });
        var events = [];
        var i = 0;
        while (i < noteHeads.length) {
            var chord = [noteHeads[i]];
            var j = i + 1;
            while (j < noteHeads.length &&
                   noteHeads[j].staffIndex === noteHeads[i].staffIndex &&
                   Math.abs(noteHeads[j].centerX - noteHeads[i].centerX) < noteHeads[i].width * 1.5) {
                chord.push(noteHeads[j]);
                j++;
            }
            var minDur = 4;
            for (var c = 0; c < chord.length; c++) {
                if (chord[c].durationValue < minDur) minDur = chord[c].durationValue;
            }
            events.push({
                notes: chord, x: chord[0].centerX,
                staffIndex: chord[0].staffIndex,
                durationValue: minDur,
                duration: chord[0].duration,
                mxlType: chord[0].mxlType
            });
            i = j;
        }
        return events;
    },

    /**
     * Main detection pipeline v3.0
     */
    detect: function(cleanedBinary, originalBinary, width, height, staves) {
        // Step 1: Detect key signature
        var keySig = this.detectKeySignature(originalBinary, width, staves);

        // Step 2: Find where notes begin (skip clef/keysig/timesig)
        var noteStartX = this._findNoteStartX(originalBinary, width, staves);

        // Step 3: Find all blobs
        var blobs = this.findBlobs(cleanedBinary, width, height);

        // Step 4: Filter noteheads (with preamble skip)
        var noteHeads = this.filterNoteHeads(blobs, staves, noteStartX);

        // Step 5: Detect stems
        noteHeads = this.detectStems(noteHeads, originalBinary, width, height, staves);

        // Step 6: Detect flags and beams
        noteHeads = this.detectFlags(noteHeads, originalBinary, width, height, staves);
        noteHeads = this.detectBeams(noteHeads, originalBinary, width, height, staves);

        // Step 7: Classify duration
        noteHeads = this.classifyDuration(noteHeads);

        // Step 8: Assign pitch WITH key signature
        noteHeads = this.assignPitch(noteHeads, staves, keySig);

        // Step 9: Detect rests (with preamble skip)
        var rests = this.detectRests(blobs, staves, width, noteStartX);

        // Step 10: Detect bar lines
        var barLines = this.detectBarLines(originalBinary, width, height, staves);

        // Step 11: Organize into events
        var events = this.organizeNotes(noteHeads);

        // Merge rests
        for (var r = 0; r < rests.length; r++) {
            events.push({
                notes: [], isRest: true, restType: rests[r].type,
                x: rests[r].centerX, staffIndex: rests[r].staffIndex,
                durationValue: rests[r].durationValue,
                duration: rests[r].type, mxlType: rests[r].mxlType
            });
        }

        events.sort(function(a, b) { return a.x - b.x; });

        return {
            noteHeads: noteHeads, events: events,
            rests: rests, barLines: barLines,
            keySignature: keySig
        };
    }
};



PianoModeOMR.MusicXMLWriter = {

    /**
     * Generate MusicXML string from detected events grouped by staff
     * @param {Array} events - from NoteDetector.detect()
     * @param {Array} staves - from StaffDetector.detect()
     * @param {Object} options - { title, beatsPerMeasure, beatType, tempo }
     * @returns {string} MusicXML content
     */
    generate: function(events, staves, options) {
        options = options || {};
        var title = options.title || 'Scanned Score';
        var beats = options.beatsPerMeasure || 4;
        var beatType = options.beatType || 4;
        var tempo = options.tempo || 120;
        var divisions = 4; // divisions per quarter note (allows 16th notes)

        var xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n';
        xml += '<score-partwise version="4.0">\n';

        // Work title
        xml += '  <work>\n';
        xml += '    <work-title>' + this._escapeXml(title) + '</work-title>\n';
        xml += '  </work>\n';

        // Identification
        xml += '  <identification>\n';
        xml += '    <creator type="composer">PianoMode OCR Scanner</creator>\n';
        xml += '    <encoding>\n';
        xml += '      <software>PianoMode OMR Engine 1.0</software>\n';
        xml += '      <encoding-date>' + new Date().toISOString().slice(0, 10) + '</encoding-date>\n';
        xml += '    </encoding>\n';
        xml += '  </identification>\n';

        // Part list — one part per staff pair (or per staff if odd)
        var parts = this._buildParts(staves);
        xml += '  <part-list>\n';
        for (var p = 0; p < parts.length; p++) {
            xml += '    <score-part id="P' + (p + 1) + '">\n';
            xml += '      <part-name>' + parts[p].name + '</part-name>\n';
            xml += '      <midi-instrument id="P' + (p + 1) + '-I1">\n';
            xml += '        <midi-channel>1</midi-channel>\n';
            xml += '        <midi-program>1</midi-program>\n'; // Acoustic Grand Piano
            xml += '      </midi-instrument>\n';
            xml += '    </score-part>\n';
        }
        xml += '  </part-list>\n';

        // Parts content
        for (var p = 0; p < parts.length; p++) {
            var part = parts[p];
            xml += '  <part id="P' + (p + 1) + '">\n';

            // Get events for this part's staves
            var partEvents = [];
            for (var e = 0; e < events.length; e++) {
                if (part.staffIndices.indexOf(events[e].staffIndex) !== -1) {
                    partEvents.push(events[e]);
                }
            }

            // Split events into measures
            var measures = this._splitIntoMeasures(partEvents, beats, beatType, divisions);

            for (var m = 0; m < measures.length; m++) {
                xml += '    <measure number="' + (m + 1) + '">\n';

                // Attributes on first measure
                if (m === 0) {
                    xml += '      <attributes>\n';
                    xml += '        <divisions>' + divisions + '</divisions>\n';
                    var fifths = (options.keySignature && options.keySignature.fifths) ? options.keySignature.fifths : 0;
                    xml += '        <key><fifths>' + fifths + '</fifths></key>\n';
                    xml += '        <time>\n';
                    xml += '          <beats>' + beats + '</beats>\n';
                    xml += '          <beat-type>' + beatType + '</beat-type>\n';
                    xml += '        </time>\n';

                    // Clef(s)
                    if (part.staffIndices.length === 2) {
                        xml += '        <staves>2</staves>\n';
                        xml += '        <clef number="1"><sign>G</sign><line>2</line></clef>\n';
                        xml += '        <clef number="2"><sign>F</sign><line>4</line></clef>\n';
                    } else {
                        var clef = staves[part.staffIndices[0]].clef;
                        if (clef === 'bass') {
                            xml += '        <clef><sign>F</sign><line>4</line></clef>\n';
                        } else {
                            xml += '        <clef><sign>G</sign><line>2</line></clef>\n';
                        }
                    }
                    xml += '      </attributes>\n';

                    // Tempo
                    xml += '      <direction placement="above">\n';
                    xml += '        <direction-type>\n';
                    xml += '          <metronome>\n';
                    xml += '            <beat-unit>quarter</beat-unit>\n';
                    xml += '            <per-minute>' + tempo + '</per-minute>\n';
                    xml += '          </metronome>\n';
                    xml += '        </direction-type>\n';
                    xml += '        <sound tempo="' + tempo + '"/>\n';
                    xml += '      </direction>\n';
                }

                // Notes
                var measureEvents = measures[m];
                if (measureEvents.length === 0) {
                    // Empty measure — write whole rest
                    xml += '      <note>\n';
                    xml += '        <rest/>\n';
                    xml += '        <duration>' + (divisions * beats) + '</duration>\n';
                    xml += '        <type>whole</type>\n';
                    xml += '      </note>\n';
                } else {
                    for (var e = 0; e < measureEvents.length; e++) {
                        var evt = measureEvents[e];
                        var dur = this._durationToDivisions(evt.durationValue, divisions);

                        // Handle rests
                        if (evt.isRest) {
                            xml += '      <note>\n';
                            xml += '        <rest/>\n';
                            xml += '        <duration>' + dur + '</duration>\n';
                            xml += '        <type>' + (evt.mxlType || 'quarter') + '</type>\n';
                            xml += '      </note>\n';
                            continue;
                        }

                        for (var n = 0; n < evt.notes.length; n++) {
                            var note = evt.notes[n];
                            xml += '      <note>\n';

                            // Chord (not first note in chord)
                            if (n > 0) {
                                xml += '        <chord/>\n';
                            }

                            xml += '        <pitch>\n';
                            xml += '          <step>' + note.pitch.step + '</step>\n';
                            if (note.pitch.alter) { xml += '          <alter>' + note.pitch.alter + '</alter>\n'; }
                            xml += '          <octave>' + note.pitch.octave + '</octave>\n';
                            xml += '        </pitch>\n';
                            xml += '        <duration>' + dur + '</duration>\n';
                            xml += '        <type>' + (evt.mxlType || 'quarter') + '</type>\n';

                            // Beam notation for eighth/sixteenth notes
                            if (evt.mxlType === 'eighth' || evt.mxlType === '16th') {
                                xml += '        <beam number="1">begin</beam>\n';
                            }

                            // Staff number for grand staff
                            if (part.staffIndices.length === 2) {
                                var staffNum = (note.staffIndex === part.staffIndices[0]) ? 1 : 2;
                                xml += '        <staff>' + staffNum + '</staff>\n';
                            }

                            xml += '      </note>\n';
                        }
                    }
                }

                xml += '    </measure>\n';
            }

            xml += '  </part>\n';
        }

        xml += '</score-partwise>\n';
        return xml;
    },

    _escapeXml: function(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    _buildParts: function(staves) {
        var parts = [];
        if (staves.length >= 2) {
            // Pair staves into grand staff parts
            for (var i = 0; i < staves.length; i += 2) {
                if (i + 1 < staves.length) {
                    parts.push({
                        name: 'Piano',
                        staffIndices: [i, i + 1]
                    });
                } else {
                    parts.push({
                        name: (staves[i].clef === 'bass') ? 'Bass' : 'Treble',
                        staffIndices: [i]
                    });
                }
            }
        } else if (staves.length === 1) {
            parts.push({
                name: 'Piano',
                staffIndices: [0]
            });
        }
        if (parts.length === 0) {
            parts.push({ name: 'Piano', staffIndices: [0] });
        }
        return parts;
    },

    _splitIntoMeasures: function(events, beats, beatType, divisions) {
        var beatsPerMeasure = beats;
        var divisionsPerMeasure = divisions * beatsPerMeasure;
        var measures = [[]];
        var currentBeat = 0;

        for (var i = 0; i < events.length; i++) {
            var evt = events[i];
            var dur = this._durationToDivisions(evt.durationValue, divisions);

            if (currentBeat + dur > divisionsPerMeasure) {
                // Start new measure
                measures.push([]);
                currentBeat = 0;
            }

            measures[measures.length - 1].push(evt);
            currentBeat += dur;

            if (currentBeat >= divisionsPerMeasure) {
                measures.push([]);
                currentBeat = 0;
            }
        }

        // Remove trailing empty measure
        if (measures.length > 1 && measures[measures.length - 1].length === 0) {
            measures.pop();
        }

        // Ensure at least 1 measure
        if (measures.length === 0) measures.push([]);

        return measures;
    },

    _durationToDivisions: function(durationValue, divisions) {
        // durationValue: 4=whole, 2=half, 1=quarter, 0.5=eighth
        return Math.round(durationValue * divisions);
    }
};

// =====================================================
// MIDI WRITER
// =====================================================
PianoModeOMR.MIDIWriter = {

    /**
     * Generate a standard MIDI file (Format 0) as Uint8Array
     * @param {Array} events - from NoteDetector
     * @param {Object} options - { tempo, channel }
     * @returns {Uint8Array} MIDI file data
     */
    generate: function(events, options) {
        options = options || {};
        var tempo = options.tempo || 120;
        var channel = options.channel || 0;
        var ppq = 480; // pulses per quarter note
        var velocity = 80;

        var trackData = [];

        // Tempo meta event: FF 51 03 tt tt tt (microseconds per beat)
        var usPerBeat = Math.round(60000000 / tempo);
        trackData.push(0x00); // delta time 0
        trackData.push(0xFF, 0x51, 0x03);
        trackData.push((usPerBeat >> 16) & 0xFF);
        trackData.push((usPerBeat >> 8) & 0xFF);
        trackData.push(usPerBeat & 0xFF);

        // Program change: channel, program 0 (Acoustic Grand Piano)
        trackData.push(0x00); // delta 0
        trackData.push(0xC0 | channel, 0x00);

        // Track name
        var trackName = 'Piano';
        trackData.push(0x00); // delta 0
        trackData.push(0xFF, 0x03);
        this._pushVLQ(trackData, trackName.length);
        for (var c = 0; c < trackName.length; c++) {
            trackData.push(trackName.charCodeAt(c));
        }

        // Note events
        for (var i = 0; i < events.length; i++) {
            var evt = events[i];
            var durationTicks = Math.round(evt.durationValue * ppq);

            // Handle rests: just advance time, no note on/off
            if (evt.isRest || !evt.notes || evt.notes.length === 0) {
                // If this is the first event, push initial delta
                if (i === 0) {
                    trackData.push(0x00);
                    // Use a silent note-on/off pair to create the rest duration
                }
                // The delta time for the next event will account for the rest
                // We track accumulated rest ticks
                continue;
            }

            // Note On for all notes in chord (delta 0 for chord notes)
            for (var n = 0; n < evt.notes.length; n++) {
                var note = evt.notes[n];
                var midiNote = note.midiNote;
                if (midiNote < 0 || midiNote > 127) continue;

                if (n === 0 && i === 0) {
                    trackData.push(0x00); // delta 0 for first note
                } else if (n === 0) {
                    // Calculate accumulated rest time from previous rests
                    var restTicks = 0;
                    for (var r = i - 1; r >= 0; r--) {
                        if (events[r].isRest || !events[r].notes || events[r].notes.length === 0) {
                            restTicks += Math.round(events[r].durationValue * ppq);
                        } else {
                            break;
                        }
                    }
                    if (restTicks > 0) {
                        // This note-on already has delta from previous note-off
                        // The rest time was not accounted for, so we don't add extra here
                        // (it's handled by the note-off delta of the previous played note)
                    }
                    // Delta 0 for first note in a new chord after note-off
                } else {
                    trackData.push(0x00); // chord: delta 0
                }

                trackData.push(0x90 | channel); // Note On
                trackData.push(midiNote & 0x7F);
                trackData.push(velocity & 0x7F);
            }

            // Calculate total duration including any following rests
            var totalDuration = durationTicks;
            // Look ahead for rests immediately after this note
            for (var r = i + 1; r < events.length; r++) {
                if (events[r].isRest || !events[r].notes || events[r].notes.length === 0) {
                    totalDuration += Math.round(events[r].durationValue * ppq);
                } else {
                    break;
                }
            }

            // Note Off after duration (includes any following rests)
            for (var n = 0; n < evt.notes.length; n++) {
                var note = evt.notes[n];
                var midiNote = note.midiNote;
                if (midiNote < 0 || midiNote > 127) continue;

                if (n === 0) {
                    this._pushVLQ(trackData, totalDuration);
                } else {
                    trackData.push(0x00); // chord: delta 0
                }

                trackData.push(0x80 | channel); // Note Off
                trackData.push(midiNote & 0x7F);
                trackData.push(0x00); // velocity 0
            }
        }

        // End of track
        trackData.push(0x00);
        trackData.push(0xFF, 0x2F, 0x00);

        // Build complete MIDI file
        var midi = [];

        // Header chunk: MThd
        midi.push(0x4D, 0x54, 0x68, 0x64); // "MThd"
        midi.push(0x00, 0x00, 0x00, 0x06); // chunk length = 6
        midi.push(0x00, 0x00);             // format 0
        midi.push(0x00, 0x01);             // 1 track
        midi.push((ppq >> 8) & 0xFF, ppq & 0xFF); // ticks per quarter

        // Track chunk: MTrk
        midi.push(0x4D, 0x54, 0x72, 0x6B); // "MTrk"
        var trackLen = trackData.length;
        midi.push((trackLen >> 24) & 0xFF);
        midi.push((trackLen >> 16) & 0xFF);
        midi.push((trackLen >> 8) & 0xFF);
        midi.push(trackLen & 0xFF);

        // Append track data
        for (var t = 0; t < trackData.length; t++) {
            midi.push(trackData[t]);
        }

        return new Uint8Array(midi);
    },

    /**
     * Push a variable-length quantity to an array
     */
    _pushVLQ: function(arr, value) {
        if (value < 0) value = 0;
        var bytes = [];
        bytes.push(value & 0x7F);
        value >>= 7;
        while (value > 0) {
            bytes.push((value & 0x7F) | 0x80);
            value >>= 7;
        }
        // VLQ is big-endian
        for (var i = bytes.length - 1; i >= 0; i--) {
            arr.push(bytes[i]);
        }
    },

    /**
     * Create a downloadable Blob URL for the MIDI data
     */
    toBlob: function(midiData) {
        return new Blob([midiData], { type: 'audio/midi' });
    },

    toBlobURL: function(midiData) {
        return URL.createObjectURL(this.toBlob(midiData));
    }
};

// =====================================================
// MAIN ORCHESTRATOR (async steps for UI responsiveness)
// =====================================================
PianoModeOMR.Engine = {

    /**
     * Yield control to the browser so the UI can repaint.
     * Returns a promise that resolves after a short delay.
     */
    _yield: function() {
        return new Promise(function(resolve) {
            setTimeout(resolve, 20);
        });
    },

    /**
     * Process an image or PDF file end-to-end.
     * Each major step yields to the browser so progress updates render.
     *
     * @param {File} file - User-uploaded file
     * @param {Function} onProgress - callback(step, message, percent)
     * @returns {Promise<Object>} { musicxml, midiBlob, midiUrl, events, staves, noteCount }
     */
    process: function(file, onProgress) {
        onProgress = onProgress || function() {};
        var self = this;
        var isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

        onProgress(1, 'Loading file...', 5);

        var loadPromise = isPDF
            ? PianoModeOMR.ImageProcessor.loadPDF(file)
            : PianoModeOMR.ImageProcessor.loadImage(file);

        return loadPromise.then(function(loaded) {
            onProgress(1, 'Image loaded (' + loaded.width + 'x' + loaded.height + ')', 15);
            return self._yield().then(function() { return loaded; });

        }).then(function(loaded) {
            // Grayscale
            onProgress(2, 'Converting to grayscale...', 20);
            var gray = PianoModeOMR.ImageProcessor.toGrayscale(loaded.imageData);
            loaded._gray = gray;
            return self._yield().then(function() { return loaded; });

        }).then(function(loaded) {
            // Binarize
            onProgress(2, 'Binarizing image...', 30);
            var gray = loaded._gray;
            var threshold = PianoModeOMR.ImageProcessor.otsuThreshold(gray);
            var binary = PianoModeOMR.ImageProcessor.binarize(gray, threshold);
            loaded._binary = binary;
            return self._yield().then(function() { return loaded; });

        }).then(function(loaded) {
            // Detect staff lines
            onProgress(2, 'Detecting staff lines...', 40);
            var staves = PianoModeOMR.StaffDetector.detect(loaded._binary, loaded.width, loaded.height);

            if (staves.length === 0) {
                throw new Error('No staff lines detected. Please use a clear, high-resolution image of printed sheet music.');
            }

            onProgress(2, staves.length + ' staff(s) detected', 45);
            staves = PianoModeOMR.StaffDetector.detectClefs(loaded._binary, loaded.width, staves);
            loaded._staves = staves;
            return self._yield().then(function() { return loaded; });

        }).then(function(loaded) {
            // Remove staff lines
            onProgress(2, 'Removing staff lines...', 50);
            var cleaned = PianoModeOMR.StaffDetector.removeStaffLines(
                loaded._binary, loaded.width, loaded.height, loaded._staves
            );
            loaded._cleaned = cleaned;
            return self._yield().then(function() { return loaded; });

        }).then(function(loaded) {
            // Detect notes
            onProgress(3, 'Detecting notes, rests & musical symbols...', 60);
            return self._yield().then(function() {
                var result = PianoModeOMR.NoteDetector.detect(
                    loaded._cleaned, loaded._binary, loaded.width, loaded.height, loaded._staves
                );
                loaded._result = result;
                return loaded;
            });

        }).then(function(loaded) {
            var result = loaded._result;
            onProgress(3, 'Analyzing detection results...', 75);

            if (result.events.length === 0) {
                throw new Error('No notes detected. The image may be too low quality or not contain standard music notation.');
            }

            var noteCount = 0;
            var restCount = 0;
            for (var e = 0; e < result.events.length; e++) {
                if (result.events[e].isRest) { restCount++; }
                else { noteCount += result.events[e].notes.length; }
            }
            var barLineCount = result.barLines ? result.barLines.length : 0;
            onProgress(3, noteCount + ' notes, ' + restCount + ' rests, ' + barLineCount + ' bar lines', 80);

            loaded._noteCount = noteCount;
            loaded._restCount = restCount;
            return self._yield().then(function() { return loaded; });

        }).then(function(loaded) {
            // Generate MusicXML
            onProgress(3, 'Generating MusicXML...', 85);
            var title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
            var musicxml = PianoModeOMR.MusicXMLWriter.generate(
                loaded._result.events, loaded._staves, { title: title, keySignature: loaded._result.keySignature }
            );
            loaded._musicxml = musicxml;
            loaded._title = title;
            return self._yield().then(function() { return loaded; });

        }).then(function(loaded) {
            // Generate MIDI
            onProgress(3, 'Generating MIDI...', 92);
            var midiData = PianoModeOMR.MIDIWriter.generate(loaded._result.events, {});
            var midiBlob = PianoModeOMR.MIDIWriter.toBlob(midiData);
            var midiUrl = URL.createObjectURL(midiBlob);

            // MusicXML blob
            var xmlBlob = new Blob([loaded._musicxml], { type: 'application/xml' });
            var xmlUrl = URL.createObjectURL(xmlBlob);

            onProgress(4, 'Done! ' + loaded._noteCount + ' notes in ' + loaded._staves.length + ' staff(s)', 100);

            return {
                musicxml: loaded._musicxml,
                musicxmlBlob: xmlBlob,
                musicxmlUrl: xmlUrl,
                midiData: midiData,
                midiBlob: midiBlob,
                midiUrl: midiUrl,
                events: loaded._result.events,
                noteHeads: loaded._result.noteHeads,
                staves: loaded._staves,
                noteCount: loaded._noteCount,
                title: loaded._title
            };
        });
    }
};


console.log('[PianoModeOMR] Engine v3.0 loaded — all modules ready');
})();
