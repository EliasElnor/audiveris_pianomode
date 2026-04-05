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
     * Group staves into systems (a system = one line of music across the page).
     * Staves within a system are close vertically; systems are separated by larger gaps.
     * Also assigns systemIndex and staffInSystem (0=treble, 1=bass, etc.)
     */
    groupIntoSystems: function(staves) {
        if (staves.length === 0) return staves;

        var systems = [[0]]; // first staff is in system 0
        for (var i = 1; i < staves.length; i++) {
            var gap = staves[i].top - staves[i - 1].bottom;
            var avgSpacing = staves[i].spacing;
            // If gap > 3x staff spacing, it's a new system
            if (gap > avgSpacing * 3) {
                systems.push([i]);
            } else {
                systems[systems.length - 1].push(i);
            }
        }

        // Assign system info to each staff
        for (var sys = 0; sys < systems.length; sys++) {
            for (var j = 0; j < systems[sys].length; j++) {
                var si = systems[sys][j];
                staves[si].systemIndex = sys;
                staves[si].staffInSystem = j; // 0=top staff, 1=bottom staff
                staves[si].systemStaffCount = systems[sys].length;
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
// NOTE DETECTOR v3.1 — Fixed multi-system + better detection
// =====================================================
PianoModeOMR.NoteDetector = {

    STEPS: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],

    TREBLE_PITCHES: [
        { step: 'E', octave: 4 }, { step: 'F', octave: 4 },
        { step: 'G', octave: 4 }, { step: 'A', octave: 4 },
        { step: 'B', octave: 4 }, { step: 'C', octave: 5 },
        { step: 'D', octave: 5 }, { step: 'E', octave: 5 },
        { step: 'F', octave: 5 }, { step: 'G', octave: 5 },
        { step: 'A', octave: 5 }, { step: 'B', octave: 5 },
        { step: 'C', octave: 6 }
    ],

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
     * Find where notes start on each staff (skip clef/keysig/timesig).
     * LESS aggressive than v3 — uses sp*4 minimum instead of sp*8.
     */
    _findNoteStartX: function(binary, width, staves) {
        var results = [];
        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            var sp = staff.spacing;
            // Minimum skip: clef region only (~3 spaces)
            var minSkip = Math.round(sp * 3);
            // Scan for a gap column after the preamble symbols
            var bestGap = minSkip;
            var maxScan = Math.round(sp * 7); // don't scan too far

            for (var x = minSkip; x < Math.min(width, maxScan); x++) {
                var ink = 0;
                for (var y = staff.top; y <= staff.bottom; y++) {
                    if (binary[y * width + x] === 1) ink++;
                }
                if (ink < (staff.bottom - staff.top) * 0.12) {
                    bestGap = x;
                }
            }
            results.push(bestGap);
        }
        return results;
    },

    /**
     * Detect key signature
     */
    detectKeySignature: function(binary, width, staves) {
        if (staves.length === 0) return { fifths: 0, accidentals: {} };
        var staff = staves[0];
        var sp = staff.spacing;
        var startX = Math.round(sp * 3);
        var endX = Math.round(sp * 6.5);
        var top = staff.top - Math.round(sp);
        var bot = staff.bottom + Math.round(sp);

        var columns = [];
        for (var x = startX; x < Math.min(width, endX); x++) {
            var ink = 0;
            for (var y = Math.max(0, top); y <= Math.min(bot, Math.floor(binary.length / width) - 1); y++) {
                if (binary[y * width + x] === 1) ink++;
            }
            columns.push(ink);
        }

        // Find ink clusters
        var inCluster = false, clStart = 0, clusters = [];
        for (var i = 0; i < columns.length; i++) {
            if (columns[i] > sp * 0.3 && !inCluster) { inCluster = true; clStart = i; }
            else if (columns[i] <= sp * 0.3 && inCluster) {
                inCluster = false;
                var w = i - clStart;
                if (w > sp * 0.2 && w < sp * 1.8) clusters.push({ start: clStart + startX, width: w });
            }
        }

        // Count accidentals based on cluster height
        var sharpCount = 0, flatCount = 0;
        for (var c = 0; c < clusters.length; c++) {
            var cl = clusters[c];
            var maxH = 0;
            for (var y = Math.max(0, top); y <= bot; y++) {
                for (var x = cl.start; x < cl.start + cl.width; x++) {
                    if (x < width && binary[y * width + x] === 1) { var h = y - top; if (h > maxH) maxH = h; }
                }
            }
            if (maxH > sp * 2) sharpCount++; else if (maxH > sp * 0.5) flatCount++;
        }

        var fifths = 0;
        if (sharpCount > flatCount && sharpCount <= 7) fifths = sharpCount;
        else if (flatCount > sharpCount && flatCount <= 7) fifths = -flatCount;

        var accidentals = {};
        var sharpOrder = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
        var flatOrder = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
        if (fifths > 0) { for (var i = 0; i < fifths; i++) accidentals[sharpOrder[i]] = 1; }
        else if (fifths < 0) { for (var i = 0; i < -fifths; i++) accidentals[flatOrder[i]] = -1; }

        return { fifths: fifths, accidentals: accidentals };
    },

    /**
     * Detect time signature by analyzing ink patterns after key signature
     */
    detectTimeSignature: function(binary, width, staves) {
        if (staves.length === 0) return { beats: 4, beatType: 4 };
        var staff = staves[0];
        var sp = staff.spacing;
        // Time sig is typically between x=5*sp and x=7*sp
        var startX = Math.round(sp * 5);
        var endX = Math.round(sp * 7.5);
        var midY = staff.center;

        // Look for a digit-like blob in top half and bottom half of staff
        var topInk = 0, botInk = 0;
        var topPixels = [], botPixels = [];
        for (var x = startX; x < Math.min(width, endX); x++) {
            var tInk = 0, bInk = 0;
            for (var y = staff.top; y < midY; y++) {
                if (binary[y * width + x] === 1) tInk++;
            }
            for (var y = midY; y <= staff.bottom; y++) {
                if (binary[y * width + x] === 1) bInk++;
            }
            topInk += tInk;
            botInk += bInk;
            if (tInk > sp * 0.2) topPixels.push(x);
            if (bInk > sp * 0.2) botPixels.push(x);
        }

        // If we found time sig symbols, try to identify the numbers
        // For now, use the pixel density patterns
        // Common signatures: 2/4, 3/4, 4/4, 6/8, 3/8
        if (topPixels.length < 3 && botPixels.length < 3) {
            return { beats: 4, beatType: 4 }; // default
        }

        // Simple heuristic: analyze the shape of the top number
        // 2 has a distinctive curve, 3 has two bumps, 4 has straight lines, 6 is round
        var topWidth = topPixels.length > 0 ? topPixels[topPixels.length - 1] - topPixels[0] : 0;
        var topDensity = topInk / Math.max(1, (midY - staff.top) * (endX - startX));

        // Count the number of horizontal crossings in the middle of the top half
        var crossY = Math.round((staff.top + midY) / 2);
        var crossings = 0;
        var prev = 0;
        for (var x = startX; x < endX; x++) {
            var cur = binary[crossY * width + x];
            if (cur === 1 && prev === 0) crossings++;
            prev = cur;
        }

        var beats = 4, beatType = 4;
        // 3 has 2 crossings typically, 2 has 1-2, 4 has 2-3, 6 has 1
        if (topDensity > 0.05) {
            if (crossings <= 1 && topWidth > sp * 0.8) beats = 6;
            else if (crossings >= 3) beats = 4;
            else beats = crossings <= 1 ? 2 : 3;
        }

        // Bottom number: 4 vs 8
        var botCrossY = Math.round((midY + staff.bottom) / 2);
        var botCrossings = 0;
        prev = 0;
        for (var x = startX; x < endX; x++) {
            var cur = binary[botCrossY * width + x];
            if (cur === 1 && prev === 0) botCrossings++;
            prev = cur;
        }
        beatType = botCrossings >= 2 ? 8 : 4;

        return { beats: beats, beatType: beatType };
    },

    /**
     * Find connected components (blobs) — same as v3
     */
    findBlobs: function(binary, width, height) {
        var labels = new Int32Array(binary.length);
        var nextLabel = 1;
        var eq = {};
        function find(x) { while (eq[x] && eq[x] !== x) x = eq[x]; return x; }
        function union(a, b) { a = find(a); b = find(b); if (a !== b) eq[Math.max(a, b)] = Math.min(a, b); }

        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var idx = y * width + x;
                if (binary[idx] === 0) continue;
                var nb = [];
                if (x > 0 && labels[idx - 1] > 0) nb.push(labels[idx - 1]);
                if (y > 0 && labels[idx - width] > 0) nb.push(labels[idx - width]);
                if (x > 0 && y > 0 && labels[idx - width - 1] > 0) nb.push(labels[idx - width - 1]);
                if (x < width - 1 && y > 0 && labels[idx - width + 1] > 0) nb.push(labels[idx - width + 1]);
                if (nb.length === 0) { labels[idx] = nextLabel; eq[nextLabel] = nextLabel; nextLabel++; }
                else { var m = Math.min.apply(null, nb); labels[idx] = m; for (var n = 0; n < nb.length; n++) union(m, nb[n]); }
            }
        }
        var blobs = {};
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var idx = y * width + x;
                if (labels[idx] === 0) continue;
                var r = find(labels[idx]);
                if (!blobs[r]) blobs[r] = { id: r, minX: x, maxX: x, minY: y, maxY: y, pixels: 0 };
                var b = blobs[r];
                if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
                if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
                b.pixels++;
            }
        }
        var result = [];
        var keys = Object.keys(blobs);
        for (var i = 0; i < keys.length; i++) {
            var b = blobs[keys[i]];
            b.width = b.maxX - b.minX + 1; b.height = b.maxY - b.minY + 1;
            b.centerX = Math.round((b.minX + b.maxX) / 2);
            b.centerY = Math.round((b.minY + b.maxY) / 2);
            b.area = b.width * b.height; b.fillRatio = b.pixels / b.area;
            b.aspectRatio = b.width / b.height;
            result.push(b);
        }
        return result;
    },

    /**
     * Filter blobs to noteheads — balanced filtering (not too strict, not too loose)
     */
    filterNoteHeads: function(blobs, staves, noteStartX) {
        if (staves.length === 0) return [];
        var avgSp = 0;
        for (var i = 0; i < staves.length; i++) avgSp += staves[i].spacing;
        avgSp /= staves.length;

        var noteHeads = [];
        for (var i = 0; i < blobs.length; i++) {
            var b = blobs[i];
            // Size: roughly 0.5-2.0 spaces
            if (b.width < avgSp * 0.4 || b.width > avgSp * 2.2) continue;
            if (b.height < avgSp * 0.3 || b.height > avgSp * 1.6) continue;
            // Aspect ratio: noteheads are 0.5 to 2.5
            if (b.aspectRatio < 0.5 || b.aspectRatio > 2.8) continue;
            // Min pixels
            if (b.pixels < avgSp * avgSp * 0.1) continue;

            // Must be near a staff
            var staffIdx = -1;
            for (var s = 0; s < staves.length; s++) {
                var staff = staves[s];
                var margin = staff.spacing * 3;
                if (b.centerY >= staff.top - margin && b.centerY <= staff.bottom + margin) {
                    staffIdx = s; break;
                }
            }
            if (staffIdx === -1) continue;

            // Skip preamble
            var startX = noteStartX ? noteStartX[staffIdx] : 0;
            if (b.centerX < startX) continue;

            // Classify fill
            b.isFilled = b.fillRatio > 0.48;
            if (b.fillRatio < 0.20) continue; // too sparse

            b.staffIndex = staffIdx;
            noteHeads.push(b);
        }
        return noteHeads;
    },

    detectStems: function(noteHeads, binary, width, height, staves) {
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            var staff = staves[nh.staffIndex];
            var stemLen = staff.spacing * 3;
            var hasStemUp = false, hasStemDown = false;
            var sides = [nh.maxX, nh.minX];
            for (var si = 0; si < sides.length; si++) {
                var cx = sides[si];
                var up = 0;
                for (var y = nh.minY - 1; y >= Math.max(0, nh.minY - stemLen); y--) {
                    var f = false;
                    for (var dx = -1; dx <= 1; dx++) { var xx = cx + dx; if (xx >= 0 && xx < width && binary[y * width + xx] === 1) { f = true; break; } }
                    if (f) up++;
                }
                if (up > stemLen * 0.4) { hasStemUp = true; break; }
                var dn = 0;
                for (var y = nh.maxY + 1; y <= Math.min(height - 1, nh.maxY + stemLen); y++) {
                    var f = false;
                    for (var dx = -1; dx <= 1; dx++) { var xx = cx + dx; if (xx >= 0 && xx < width && binary[y * width + xx] === 1) { f = true; break; } }
                    if (f) dn++;
                }
                if (dn > stemLen * 0.4) { hasStemDown = true; break; }
            }
            nh.hasStem = hasStemUp || hasStemDown;
            nh.stemDirection = hasStemUp ? 'up' : (hasStemDown ? 'down' : 'none');
        }
        return noteHeads;
    },

    detectFlags: function(noteHeads, binary, width, height, staves) {
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            if (!nh.hasStem) { nh.flagCount = 0; continue; }
            var staff = staves[nh.staffIndex]; var fz = Math.round(staff.spacing * 1.2);
            var sey = nh.stemDirection === 'up' ? nh.minY - Math.round(staff.spacing * 2.5) : nh.maxY + Math.round(staff.spacing * 2.5);
            var sx = nh.maxX;
            var fp = 0, tp = 0;
            var yS = Math.max(0, Math.min(sey, sey + fz) - 2);
            var yE = Math.min(height - 1, Math.max(sey, sey + fz) + 2);
            for (var y = yS; y <= yE; y++) { for (var x = sx; x < Math.min(width, sx + fz); x++) { tp++; if (binary[y * width + x] === 1) fp++; } }
            var d = tp > 0 ? fp / tp : 0;
            nh.flagCount = d > 0.3 ? 2 : (d > 0.15 ? 1 : 0);
        }
        return noteHeads;
    },

    detectBeams: function(noteHeads, binary, width, height, staves) {
        for (var i = 0; i < noteHeads.length; i++) noteHeads[i].beamCount = 0;
        for (var i = 0; i < noteHeads.length - 1; i++) {
            var a = noteHeads[i], b = noteHeads[i + 1];
            if (!a.hasStem || !b.hasStem || a.staffIndex !== b.staffIndex) continue;
            var staff = staves[a.staffIndex];
            if (Math.abs(b.centerX - a.centerX) > staff.spacing * 5) continue;
            var ae = a.stemDirection === 'up' ? a.minY - Math.round(staff.spacing * 2) : a.maxY + Math.round(staff.spacing * 2);
            var be = b.stemDirection === 'up' ? b.minY - Math.round(staff.spacing * 2) : b.maxY + Math.round(staff.spacing * 2);
            var by = Math.round((ae + be) / 2);
            var sx = Math.min(a.centerX, b.centerX), ex = Math.max(a.centerX, b.centerX);
            var bp = 0, ts = 0;
            for (var dy = -2; dy <= 2; dy++) { var y = by + dy; if (y < 0 || y >= height) continue; for (var x = sx; x <= ex; x++) { ts++; if (binary[y * width + x] === 1) bp++; } }
            if (ts > 0 && bp / ts > 0.4) { a.beamCount = Math.max(a.beamCount, 1); b.beamCount = Math.max(b.beamCount, 1); }
        }
        return noteHeads;
    },

    detectRests: function(blobs, staves, width, noteStartX) {
        var rests = [];
        if (staves.length === 0) return rests;
        var avgSp = 0;
        for (var i = 0; i < staves.length; i++) avgSp += staves[i].spacing;
        avgSp /= staves.length;

        for (var i = 0; i < blobs.length; i++) {
            var b = blobs[i];
            var ns = -1;
            for (var s = 0; s < staves.length; s++) {
                if (b.centerY >= staves[s].top - staves[s].spacing && b.centerY <= staves[s].bottom + staves[s].spacing) { ns = s; break; }
            }
            if (ns === -1) continue;
            var sx = noteStartX ? noteStartX[ns] : 0;
            if (b.centerX < sx) continue;
            var staff = staves[ns];

            if (b.width > avgSp * 0.5 && b.width < avgSp * 2 && b.height > avgSp * 0.2 && b.height < avgSp * 0.8 && b.fillRatio > 0.7 && b.aspectRatio > 1.2) {
                var rt = b.centerY < staff.center ? 'half' : 'whole';
                rests.push({ type: rt, durationValue: rt === 'half' ? 2 : 4, mxlType: rt, centerX: b.centerX, centerY: b.centerY, staffIndex: ns, isRest: true });
                continue;
            }
            if (b.height > avgSp * 1.5 && b.height < avgSp * 4 && b.width < avgSp * 1.2 && b.aspectRatio < 0.6 && b.fillRatio > 0.25 && b.fillRatio < 0.65) {
                rests.push({ type: 'quarter', durationValue: 1, mxlType: 'quarter', centerX: b.centerX, centerY: b.centerY, staffIndex: ns, isRest: true });
                continue;
            }
            if (b.height > avgSp * 0.8 && b.height < avgSp * 2 && b.width < avgSp * 1.0 && b.fillRatio > 0.2 && b.fillRatio < 0.55 && b.aspectRatio < 0.8) {
                rests.push({ type: 'eighth', durationValue: 0.5, mxlType: 'eighth', centerX: b.centerX, centerY: b.centerY, staffIndex: ns, isRest: true });
            }
        }
        return rests;
    },

    detectBarLines: function(binary, width, height, staves) {
        var barLines = [];
        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s]; var st = staff.top - 2; var sb = staff.bottom + 2; var sh = sb - st;
            for (var x = 0; x < width; x++) {
                var br = 0;
                for (var y = st; y <= sb; y++) { if (y >= 0 && y < height && binary[y * width + x] === 1) br++; }
                if (br > sh * 0.8) {
                    var narrow = true;
                    for (var dx = -3; dx <= 3; dx++) { if (dx === 0) continue; var nx = x + dx; if (nx < 0 || nx >= width) continue; var nr = 0; for (var y = st; y <= sb; y++) { if (binary[y * width + nx] === 1) nr++; } if (Math.abs(dx) > 2 && nr > sh * 0.7) { narrow = false; break; } }
                    if (narrow) { var dup = false; for (var b = 0; b < barLines.length; b++) { if (barLines[b].staffIndex === s && Math.abs(barLines[b].x - x) < 8) { dup = true; break; } } if (!dup) barLines.push({ x: x, staffIndex: s }); }
                }
            }
        }
        return barLines;
    },

    classifyDuration: function(noteHeads) {
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            var flags = Math.max(nh.flagCount || 0, nh.beamCount || 0);
            if (!nh.isFilled && !nh.hasStem) { nh.duration = 'whole'; nh.durationValue = 4; nh.mxlType = 'whole'; }
            else if (!nh.isFilled && nh.hasStem) { nh.duration = 'half'; nh.durationValue = 2; nh.mxlType = 'half'; }
            else if (nh.isFilled && nh.hasStem && flags >= 2) { nh.duration = '16th'; nh.durationValue = 0.25; nh.mxlType = '16th'; }
            else if (nh.isFilled && nh.hasStem && flags >= 1) { nh.duration = 'eighth'; nh.durationValue = 0.5; nh.mxlType = 'eighth'; }
            else { nh.duration = 'quarter'; nh.durationValue = 1; nh.mxlType = 'quarter'; }
        }
        return noteHeads;
    },

    assignPitch: function(noteHeads, staves, keySignature) {
        var acc = (keySignature && keySignature.accidentals) ? keySignature.accidentals : {};
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            var staff = staves[nh.staffIndex];
            var halfSpace = staff.spacing / 2;
            var distFromBottom = staff.bottom - nh.centerY;
            var posIndex = Math.round(distFromBottom / halfSpace);
            var pitches = (staff.clef === 'bass') ? this.BASS_PITCHES : this.TREBLE_PITCHES;
            var pitch;
            if (posIndex >= 0 && posIndex < pitches.length) {
                pitch = { step: pitches[posIndex].step, octave: pitches[posIndex].octave };
            } else {
                var steps = this.STEPS;
                var ref = posIndex >= pitches.length ? pitches[pitches.length - 1] : pitches[0];
                var count = posIndex >= pitches.length ? posIndex - pitches.length + 1 : Math.abs(posIndex);
                var dir = posIndex >= pitches.length ? 1 : -1;
                var si = steps.indexOf(ref.step); var oct = ref.octave;
                for (var e = 0; e < count; e++) { si += dir; if (si >= 7) { si = 0; oct++; } if (si < 0) { si = 6; oct--; } }
                pitch = { step: steps[si], octave: oct };
            }
            pitch.alter = acc[pitch.step] || 0;
            nh.pitch = pitch;
            nh.midiNote = this.noteToMidi(pitch.step, pitch.octave, pitch.alter);
            nh.pitchName = pitch.step + (pitch.alter === 1 ? '#' : (pitch.alter === -1 ? 'b' : '')) + pitch.octave;
        }
        return noteHeads;
    },

    /**
     * Organize notes into events, sorted by SYSTEM then by x position.
     * This ensures multi-system scores play in the right order.
     */
    organizeNotes: function(noteHeads, staves) {
        // Sort by system first, then by x within each system
        noteHeads.sort(function(a, b) {
            var sysA = staves[a.staffIndex].systemIndex || 0;
            var sysB = staves[b.staffIndex].systemIndex || 0;
            if (sysA !== sysB) return sysA - sysB;
            return a.centerX - b.centerX;
        });

        var events = [];
        var i = 0;
        while (i < noteHeads.length) {
            var chord = [noteHeads[i]];
            var j = i + 1;
            while (j < noteHeads.length &&
                   (staves[noteHeads[j].staffIndex].systemIndex || 0) === (staves[noteHeads[i].staffIndex].systemIndex || 0) &&
                   Math.abs(noteHeads[j].centerX - noteHeads[i].centerX) < noteHeads[i].width * 1.8) {
                chord.push(noteHeads[j]); j++;
            }
            var minDur = 4;
            for (var c = 0; c < chord.length; c++) { if (chord[c].durationValue < minDur) minDur = chord[c].durationValue; }
            events.push({
                notes: chord, x: chord[0].centerX,
                staffIndex: chord[0].staffIndex,
                systemIndex: staves[chord[0].staffIndex].systemIndex || 0,
                durationValue: minDur,
                duration: chord[0].duration, mxlType: chord[0].mxlType
            });
            i = j;
        }
        return events;
    },

    /**
     * Main detection pipeline v3.1
     */
    detect: function(cleanedBinary, originalBinary, width, height, staves) {
        var keySig = this.detectKeySignature(originalBinary, width, staves);
        var timeSig = this.detectTimeSignature(originalBinary, width, staves);
        var noteStartX = this._findNoteStartX(originalBinary, width, staves);
        var blobs = this.findBlobs(cleanedBinary, width, height);
        var noteHeads = this.filterNoteHeads(blobs, staves, noteStartX);
        noteHeads = this.detectStems(noteHeads, originalBinary, width, height, staves);
        noteHeads = this.detectFlags(noteHeads, originalBinary, width, height, staves);
        noteHeads = this.detectBeams(noteHeads, originalBinary, width, height, staves);
        noteHeads = this.classifyDuration(noteHeads);
        noteHeads = this.assignPitch(noteHeads, staves, keySig);
        var rests = this.detectRests(blobs, staves, width, noteStartX);
        var barLines = this.detectBarLines(originalBinary, width, height, staves);
        var events = this.organizeNotes(noteHeads, staves);

        // Merge rests (also sorted by system)
        for (var r = 0; r < rests.length; r++) {
            var rest = rests[r];
            events.push({
                notes: [], isRest: true, restType: rest.type,
                x: rest.centerX, staffIndex: rest.staffIndex,
                systemIndex: staves[rest.staffIndex].systemIndex || 0,
                durationValue: rest.durationValue, duration: rest.type, mxlType: rest.mxlType
            });
        }

        // Sort by system, then x
        events.sort(function(a, b) {
            if (a.systemIndex !== b.systemIndex) return a.systemIndex - b.systemIndex;
            return a.x - b.x;
        });

        return { noteHeads: noteHeads, events: events, rests: rests, barLines: barLines, keySignature: keySig, timeSignature: timeSig };
    }
};


// =====================================================
// MUSICXML WRITER — Fixed for multi-system scores
// =====================================================
PianoModeOMR.MusicXMLWriter = {

    generate: function(events, staves, options) {
        options = options || {};
        var title = options.title || 'Scanned Score';
        var keySig = options.keySignature || { fifths: 0 };
        var timeSig = options.timeSignature || { beats: 4, beatType: 4 };
        var beats = timeSig.beats;
        var beatType = timeSig.beatType;
        var tempo = options.tempo || 120;
        var divisions = 4;

        var xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n';
        xml += '<score-partwise version="4.0">\n';
        xml += '  <work><work-title>' + this._escapeXml(title) + '</work-title></work>\n';
        xml += '  <identification><creator type="composer">PianoMode OCR</creator>';
        xml += '<encoding><software>PianoMode OMR v3.1</software>';
        xml += '<encoding-date>' + new Date().toISOString().slice(0, 10) + '</encoding-date></encoding></identification>\n';

        // Determine how many unique staff-in-system positions we have
        // For a grand staff: 2 positions (treble=0, bass=1)
        // All systems share the same part structure
        var stavesPerSystem = 1;
        for (var i = 0; i < staves.length; i++) {
            if (staves[i].systemStaffCount > stavesPerSystem) stavesPerSystem = staves[i].systemStaffCount;
        }

        // Single Piano part containing all staves
        xml += '  <part-list>\n';
        xml += '    <score-part id="P1"><part-name>Piano</part-name>';
        xml += '<midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument>';
        xml += '</score-part>\n';
        xml += '  </part-list>\n';

        xml += '  <part id="P1">\n';

        // ALL events from ALL systems go into this single part, in order
        // Events are already sorted by system then by x
        var measures = this._splitIntoMeasures(events, beats, beatType, divisions);

        for (var m = 0; m < measures.length; m++) {
            xml += '    <measure number="' + (m + 1) + '">\n';

            if (m === 0) {
                xml += '      <attributes>\n';
                xml += '        <divisions>' + divisions + '</divisions>\n';
                xml += '        <key><fifths>' + keySig.fifths + '</fifths></key>\n';
                xml += '        <time><beats>' + beats + '</beats><beat-type>' + beatType + '</beat-type></time>\n';
                if (stavesPerSystem >= 2) {
                    xml += '        <staves>2</staves>\n';
                    xml += '        <clef number="1"><sign>G</sign><line>2</line></clef>\n';
                    xml += '        <clef number="2"><sign>F</sign><line>4</line></clef>\n';
                } else {
                    xml += '        <clef><sign>G</sign><line>2</line></clef>\n';
                }
                xml += '      </attributes>\n';
                xml += '      <direction placement="above"><direction-type><metronome>';
                xml += '<beat-unit>quarter</beat-unit><per-minute>' + tempo + '</per-minute>';
                xml += '</metronome></direction-type><sound tempo="' + tempo + '"/></direction>\n';
            }

            var measureEvents = measures[m];
            if (measureEvents.length === 0) {
                xml += '      <note><rest/><duration>' + (divisions * beats) + '</duration><type>whole</type></note>\n';
            } else {
                for (var e = 0; e < measureEvents.length; e++) {
                    var evt = measureEvents[e];
                    var dur = this._durationToDivisions(evt.durationValue, divisions);

                    if (evt.isRest) {
                        xml += '      <note><rest/><duration>' + dur + '</duration><type>' + (evt.mxlType || 'quarter') + '</type>';
                        if (stavesPerSystem >= 2) {
                            var rStaff = (staves[evt.staffIndex] && staves[evt.staffIndex].staffInSystem === 1) ? 2 : 1;
                            xml += '<staff>' + rStaff + '</staff>';
                        }
                        xml += '</note>\n';
                        continue;
                    }

                    for (var n = 0; n < evt.notes.length; n++) {
                        var note = evt.notes[n];
                        xml += '      <note>';
                        if (n > 0) xml += '<chord/>';
                        xml += '<pitch><step>' + note.pitch.step + '</step>';
                        if (note.pitch.alter) xml += '<alter>' + note.pitch.alter + '</alter>';
                        xml += '<octave>' + note.pitch.octave + '</octave></pitch>';
                        xml += '<duration>' + dur + '</duration>';
                        xml += '<type>' + (evt.mxlType || 'quarter') + '</type>';
                        if (stavesPerSystem >= 2) {
                            var sn = (staves[note.staffIndex] && staves[note.staffIndex].staffInSystem === 1) ? 2 : 1;
                            xml += '<staff>' + sn + '</staff>';
                        }
                        xml += '</note>\n';
                    }
                }
            }
            xml += '    </measure>\n';
        }

        xml += '  </part>\n</score-partwise>\n';
        return xml;
    },

    _escapeXml: function(str) { return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },

    _splitIntoMeasures: function(events, beats, beatType, divisions) {
        var divsPerMeasure = divisions * beats;
        var measures = [[]];
        var currentBeat = 0;
        for (var i = 0; i < events.length; i++) {
            var dur = this._durationToDivisions(events[i].durationValue, divisions);
            if (currentBeat + dur > divsPerMeasure) {
                measures.push([]);
                currentBeat = 0;
            }
            measures[measures.length - 1].push(events[i]);
            currentBeat += dur;
            if (currentBeat >= divsPerMeasure) { measures.push([]); currentBeat = 0; }
        }
        if (measures.length > 1 && measures[measures.length - 1].length === 0) measures.pop();
        if (measures.length === 0) measures.push([]);
        return measures;
    },

    _durationToDivisions: function(dv, div) { return Math.round(dv * div); }
};


// =====================================================
// MIDI WRITER
// =====================================================
PianoModeOMR.MIDIWriter = {

    generate: function(events, options) {
        options = options || {};
        var tempo = options.tempo || 120;
        var channel = options.channel || 0;
        var ppq = 480;
        var velocity = 80;
        var trackData = [];

        // Tempo meta event
        var usPerBeat = Math.round(60000000 / tempo);
        trackData.push(0x00, 0xFF, 0x51, 0x03);
        trackData.push((usPerBeat >> 16) & 0xFF, (usPerBeat >> 8) & 0xFF, usPerBeat & 0xFF);

        // Program change: piano
        trackData.push(0x00, 0xC0 | channel, 0x00);

        // Track name
        var name = 'Piano';
        trackData.push(0x00, 0xFF, 0x03);
        this._pushVLQ(trackData, name.length);
        for (var c = 0; c < name.length; c++) trackData.push(name.charCodeAt(c));

        // Note events
        var lastNoteOff = false;
        for (var i = 0; i < events.length; i++) {
            var evt = events[i];
            var durationTicks = Math.round(evt.durationValue * ppq);

            if (evt.isRest || !evt.notes || evt.notes.length === 0) {
                // Rest: insert silence by adding delta to next note
                if (lastNoteOff) {
                    // Handled by the note-off delta of previous note
                } else {
                    // If first event is a rest, push a delta
                    // This is handled by accumulating rest durations below
                }
                continue;
            }

            // Calculate total rest time before this note
            var restBefore = 0;
            for (var r = i - 1; r >= 0; r--) {
                if (events[r].isRest || !events[r].notes || events[r].notes.length === 0) {
                    restBefore += Math.round(events[r].durationValue * ppq);
                } else { break; }
            }

            // Note On
            for (var n = 0; n < evt.notes.length; n++) {
                var note = evt.notes[n];
                var midi = note.midiNote;
                if (midi < 0 || midi > 127) continue;

                if (n === 0) {
                    if (!lastNoteOff && i === 0) {
                        this._pushVLQ(trackData, restBefore || 0);
                    }
                    // Delta 0 if coming right after note-off
                }
                if (n > 0) trackData.push(0x00);

                trackData.push(0x90 | channel, midi & 0x7F, velocity & 0x7F);
            }

            // Note Off after duration + any following rests
            var totalDur = durationTicks;
            for (var r = i + 1; r < events.length; r++) {
                if (events[r].isRest || !events[r].notes || events[r].notes.length === 0) {
                    totalDur += Math.round(events[r].durationValue * ppq);
                } else { break; }
            }

            for (var n = 0; n < evt.notes.length; n++) {
                var note = evt.notes[n];
                var midi = note.midiNote;
                if (midi < 0 || midi > 127) continue;
                if (n === 0) this._pushVLQ(trackData, totalDur);
                else trackData.push(0x00);
                trackData.push(0x80 | channel, midi & 0x7F, 0x00);
            }
            lastNoteOff = true;
        }

        // End of track
        trackData.push(0x00, 0xFF, 0x2F, 0x00);

        // Build MIDI file
        var midi = [];
        midi.push(0x4D, 0x54, 0x68, 0x64); // MThd
        midi.push(0x00, 0x00, 0x00, 0x06); // length 6
        midi.push(0x00, 0x00); // format 0
        midi.push(0x00, 0x01); // 1 track
        midi.push((ppq >> 8) & 0xFF, ppq & 0xFF);
        midi.push(0x4D, 0x54, 0x72, 0x6B); // MTrk
        var tl = trackData.length;
        midi.push((tl >> 24) & 0xFF, (tl >> 16) & 0xFF, (tl >> 8) & 0xFF, tl & 0xFF);
        for (var t = 0; t < trackData.length; t++) midi.push(trackData[t]);
        return new Uint8Array(midi);
    },

    _pushVLQ: function(arr, v) {
        if (v < 0) v = 0;
        var bytes = [v & 0x7F]; v >>= 7;
        while (v > 0) { bytes.push((v & 0x7F) | 0x80); v >>= 7; }
        for (var i = bytes.length - 1; i >= 0; i--) arr.push(bytes[i]);
    },

    toBlob: function(d) { return new Blob([d], { type: 'audio/midi' }); },
    toBlobURL: function(d) { return URL.createObjectURL(this.toBlob(d)); }
};

// =====================================================
// MAIN ORCHESTRATOR (async steps)
// =====================================================
PianoModeOMR.Engine = {
    _yield: function() { return new Promise(function(r) { setTimeout(r, 20); }); },

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
            onProgress(2, 'Converting to grayscale...', 20);
            loaded._gray = PianoModeOMR.ImageProcessor.toGrayscale(loaded.imageData);
            return self._yield().then(function() { return loaded; });
        }).then(function(loaded) {
            onProgress(2, 'Binarizing image...', 30);
            var t = PianoModeOMR.ImageProcessor.otsuThreshold(loaded._gray);
            loaded._binary = PianoModeOMR.ImageProcessor.binarize(loaded._gray, t);
            return self._yield().then(function() { return loaded; });
        }).then(function(loaded) {
            onProgress(2, 'Detecting staff lines...', 40);
            var staves = PianoModeOMR.StaffDetector.detect(loaded._binary, loaded.width, loaded.height);
            if (staves.length === 0) throw new Error('No staff lines detected. Use a clear, high-resolution image.');
            // Group staves into systems
            staves = PianoModeOMR.StaffDetector.groupIntoSystems(staves);
            staves = PianoModeOMR.StaffDetector.detectClefs(loaded._binary, loaded.width, staves);
            var systemCount = 0;
            for (var i = 0; i < staves.length; i++) {
                if ((staves[i].systemIndex || 0) > systemCount) systemCount = staves[i].systemIndex;
            }
            onProgress(2, staves.length + ' staves in ' + (systemCount + 1) + ' system(s)', 45);
            loaded._staves = staves;
            return self._yield().then(function() { return loaded; });
        }).then(function(loaded) {
            onProgress(2, 'Removing staff lines...', 50);
            loaded._cleaned = PianoModeOMR.StaffDetector.removeStaffLines(loaded._binary, loaded.width, loaded.height, loaded._staves);
            return self._yield().then(function() { return loaded; });
        }).then(function(loaded) {
            onProgress(3, 'Detecting notes...', 60);
            return self._yield().then(function() {
                loaded._result = PianoModeOMR.NoteDetector.detect(loaded._cleaned, loaded._binary, loaded.width, loaded.height, loaded._staves);
                return loaded;
            });
        }).then(function(loaded) {
            var result = loaded._result;
            onProgress(3, 'Analyzing...', 75);
            if (result.events.length === 0) throw new Error('No notes detected. The image may be too low quality.');
            var nc = 0, rc = 0;
            for (var e = 0; e < result.events.length; e++) {
                if (result.events[e].isRest) rc++; else nc += result.events[e].notes.length;
            }
            onProgress(3, nc + ' notes, ' + rc + ' rests', 80);
            loaded._noteCount = nc;
            return self._yield().then(function() { return loaded; });
        }).then(function(loaded) {
            onProgress(3, 'Generating MusicXML...', 85);
            var title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
            var musicxml = PianoModeOMR.MusicXMLWriter.generate(loaded._result.events, loaded._staves, {
                title: title,
                keySignature: loaded._result.keySignature,
                timeSignature: loaded._result.timeSignature
            });
            loaded._musicxml = musicxml; loaded._title = title;
            return self._yield().then(function() { return loaded; });
        }).then(function(loaded) {
            onProgress(3, 'Generating MIDI...', 92);
            var midiData = PianoModeOMR.MIDIWriter.generate(loaded._result.events, {});
            var midiBlob = PianoModeOMR.MIDIWriter.toBlob(midiData);
            var midiUrl = URL.createObjectURL(midiBlob);
            var xmlBlob = new Blob([loaded._musicxml], { type: 'application/xml' });
            var xmlUrl = URL.createObjectURL(xmlBlob);
            onProgress(4, 'Done! ' + loaded._noteCount + ' notes in ' + loaded._staves.length + ' staves', 100);
            return {
                musicxml: loaded._musicxml, musicxmlBlob: xmlBlob, musicxmlUrl: xmlUrl,
                midiData: midiData, midiBlob: midiBlob, midiUrl: midiUrl,
                events: loaded._result.events, noteHeads: loaded._result.noteHeads,
                staves: loaded._staves, noteCount: loaded._noteCount, title: loaded._title
            };
        });
    }
};

console.log('[PianoModeOMR] Engine v3.1 loaded — all modules ready');
})();
