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
// NOTE DETECTOR v4.0 — Audiveris-inspired algorithms
// Uses chamfer distance transform + template matching
// =====================================================
PianoModeOMR.NoteDetector = {

    STEPS: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],

    // Treble: bottom line = E4 (posIndex 0), each +1 = next diatonic step up
    TREBLE_PITCHES: [
        {s:'E',o:4},{s:'F',o:4},{s:'G',o:4},{s:'A',o:4},{s:'B',o:4},
        {s:'C',o:5},{s:'D',o:5},{s:'E',o:5},{s:'F',o:5},{s:'G',o:5},
        {s:'A',o:5},{s:'B',o:5},{s:'C',o:6}
    ],
    BASS_PITCHES: [
        {s:'G',o:2},{s:'A',o:2},{s:'B',o:2},{s:'C',o:3},{s:'D',o:3},
        {s:'E',o:3},{s:'F',o:3},{s:'G',o:3},{s:'A',o:3},{s:'B',o:3},
        {s:'C',o:4},{s:'D',o:4},{s:'E',o:4}
    ],

    noteToMidi: function(step, octave, alter) {
        var semi = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
        return 12 * (octave + 1) + (semi[step] || 0) + (alter || 0);
    },

    // -------------------------------------------------------
    // CHAMFER DISTANCE TRANSFORM (3x3 mask, Audiveris-style)
    // Computes distance from each pixel to nearest foreground
    // -------------------------------------------------------
    computeDistanceTransform: function(binary, width, height) {
        var INF = 9999;
        var dist = new Int32Array(width * height);
        // Initialize: foreground=0, background=INF
        for (var i = 0; i < binary.length; i++) {
            dist[i] = binary[i] === 1 ? 0 : INF;
        }
        // Forward pass (top-left to bottom-right)
        for (var y = 1; y < height; y++) {
            for (var x = 1; x < width - 1; x++) {
                var idx = y * width + x;
                var d = dist[idx];
                d = Math.min(d, dist[idx - width - 1] + 4); // diagonal
                d = Math.min(d, dist[idx - width] + 3);     // above
                d = Math.min(d, dist[idx - width + 1] + 4); // diagonal
                d = Math.min(d, dist[idx - 1] + 3);         // left
                dist[idx] = d;
            }
        }
        // Backward pass (bottom-right to top-left)
        for (var y = height - 2; y >= 0; y--) {
            for (var x = width - 2; x >= 1; x--) {
                var idx = y * width + x;
                var d = dist[idx];
                d = Math.min(d, dist[idx + width + 1] + 4);
                d = Math.min(d, dist[idx + width] + 3);
                d = Math.min(d, dist[idx + width - 1] + 4);
                d = Math.min(d, dist[idx + 1] + 3);
                dist[idx] = d;
            }
        }
        // Normalize by 3 (the chamfer3 normalizer)
        for (var i = 0; i < dist.length; i++) {
            dist[i] = Math.round(dist[i] / 3);
        }
        return dist;
    },

    // -------------------------------------------------------
    // SYNTHETIC NOTEHEAD TEMPLATE
    // Creates an elliptical template matching a notehead shape
    // Returns array of {x, y, expected} relative to center
    // expected: 0=foreground, 1=background, -1=hole (for void)
    // -------------------------------------------------------
    _createNoteheadTemplate: function(spacing, isFilled) {
        // Notehead dimensions relative to staff spacing
        var w = Math.round(spacing * 1.4); // width
        var h = Math.round(spacing * 0.85); // height
        var hw = Math.floor(w / 2);
        var hh = Math.floor(h / 2);
        var points = [];

        for (var dy = -hh - 1; dy <= hh + 1; dy++) {
            for (var dx = -hw - 1; dx <= hw + 1; dx++) {
                // Slightly tilted ellipse (noteheads tilt ~20 degrees)
                var rx = dx * Math.cos(0.35) + dy * Math.sin(0.35);
                var ry = -dx * Math.sin(0.35) + dy * Math.cos(0.35);
                var ellipseVal = (rx * rx) / (hw * hw) + (ry * ry) / (hh * hh);

                if (isFilled) {
                    if (ellipseVal <= 1.0) {
                        points.push({x: dx, y: dy, expected: 0}); // foreground
                    } else if (ellipseVal <= 1.6) {
                        points.push({x: dx, y: dy, expected: 1}); // near background
                    }
                } else {
                    // Void (hollow) notehead
                    if (ellipseVal <= 1.0 && ellipseVal >= 0.45) {
                        points.push({x: dx, y: dy, expected: 0}); // ring foreground
                    } else if (ellipseVal < 0.45) {
                        points.push({x: dx, y: dy, expected: -1}); // hole
                    } else if (ellipseVal <= 1.6) {
                        points.push({x: dx, y: dy, expected: 1}); // background
                    }
                }
            }
        }
        return { points: points, width: w, height: h };
    },

    // -------------------------------------------------------
    // TEMPLATE MATCHING — Evaluate template at position
    // Returns score 0 (perfect match) to 1 (no match)
    // Inspired by Audiveris Template.evaluate()
    // -------------------------------------------------------
    _evaluateTemplate: function(template, cx, cy, distTransform, width, height) {
        var foreWeight = 4.0;
        var backWeight = 1.0;
        var holeWeight = 0.5;
        var totalWeight = 0;
        var totalDist = 0;

        for (var i = 0; i < template.points.length; i++) {
            var p = template.points[i];
            var nx = cx + p.x;
            var ny = cy + p.y;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

            var actualDist = distTransform[ny * width + nx];
            var weight, dist;

            if (p.expected === 0) {
                // Expected foreground: good if actualDist is 0 (on foreground)
                weight = foreWeight;
                dist = actualDist > 0 ? 1 : 0;
            } else if (p.expected > 0) {
                // Expected background: good if actualDist > 0
                weight = backWeight;
                dist = actualDist === 0 ? 1 : 0;
            } else {
                // Expected hole: good if actualDist > 0 (white inside)
                weight = holeWeight;
                dist = actualDist === 0 ? 1 : 0;
            }

            totalDist += weight * dist;
            totalWeight += weight;
        }

        return totalWeight > 0 ? totalDist / totalWeight : 1.0;
    },

    // -------------------------------------------------------
    // POSITION-BASED SCANNING (Audiveris NoteHeadsBuilder style)
    // Scans each pitch position on each staff for noteheads
    // -------------------------------------------------------
    scanForNoteheads: function(binary, distTransform, width, height, staves, noteStartX) {
        var noteHeads = [];
        var filledTemplate = null;
        var voidTemplate = null;

        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            var sp = staff.spacing;
            var halfSp = sp / 2;
            var startX = noteStartX ? noteStartX[s] : Math.round(sp * 3);

            // Create templates sized for this staff
            if (!filledTemplate || Math.abs(filledTemplate.height - sp * 0.85) > 2) {
                filledTemplate = this._createNoteheadTemplate(sp, true);
                voidTemplate = this._createNoteheadTemplate(sp, false);
            }

            // Scan pitch positions: from 4 below bottom line to 4 above top line
            // Position 0 = bottom line, +1 = next space up, etc.
            // Range: -4 to +12 (covers ledger lines above and below)
            for (var pos = -4; pos <= 12; pos++) {
                var pitchY = Math.round(staff.bottom - pos * halfSp);

                // Scan x positions across the staff
                var step = Math.max(2, Math.round(sp * 0.3));
                for (var x = startX; x < width - Math.round(sp); x += step) {
                    // Quick pre-check: is there ink nearby?
                    var hasInk = false;
                    for (var dy = -Math.round(halfSp); dy <= Math.round(halfSp); dy++) {
                        var py = pitchY + dy;
                        if (py >= 0 && py < height && binary[py * width + x] === 1) {
                            hasInk = true; break;
                        }
                    }
                    if (!hasInk) continue;

                    // Evaluate filled template
                    var filledScore = this._evaluateTemplate(filledTemplate, x, pitchY, distTransform, width, height);
                    // Evaluate void template
                    var voidScore = this._evaluateTemplate(voidTemplate, x, pitchY, distTransform, width, height);

                    var bestScore = Math.min(filledScore, voidScore);
                    var isFilled = filledScore <= voidScore;

                    // Accept if score is good enough (lower = better match)
                    if (bestScore < 0.38) {
                        // Check for duplicate at similar position
                        var isDup = false;
                        for (var n = noteHeads.length - 1; n >= Math.max(0, noteHeads.length - 20); n--) {
                            var prev = noteHeads[n];
                            if (prev.staffIndex === s &&
                                Math.abs(prev.centerX - x) < sp * 0.6 &&
                                Math.abs(prev.centerY - pitchY) < halfSp * 0.8) {
                                // Keep the better match
                                if (bestScore < prev.matchScore) {
                                    noteHeads.splice(n, 1);
                                } else {
                                    isDup = true;
                                }
                                break;
                            }
                        }
                        if (isDup) continue;

                        noteHeads.push({
                            centerX: x,
                            centerY: pitchY,
                            minX: x - Math.round(sp * 0.7),
                            maxX: x + Math.round(sp * 0.7),
                            minY: pitchY - Math.round(sp * 0.45),
                            maxY: pitchY + Math.round(sp * 0.45),
                            width: Math.round(sp * 1.4),
                            height: Math.round(sp * 0.85),
                            isFilled: isFilled,
                            staffIndex: s,
                            posIndex: pos,
                            matchScore: bestScore,
                            pixels: Math.round(sp * sp * 0.5) // approximate
                        });
                    }
                }
            }
        }

        // Sort by match quality and remove weaker overlapping detections
        noteHeads.sort(function(a, b) { return a.matchScore - b.matchScore; });
        var filtered = [];
        var used = {};
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            var key = nh.staffIndex + '_' + Math.round(nh.centerX / (staves[nh.staffIndex].spacing * 0.5)) +
                      '_' + nh.posIndex;
            if (!used[key]) {
                used[key] = true;
                filtered.push(nh);
            }
        }

        return filtered;
    },

    // -------------------------------------------------------
    // STEM DETECTION — Find vertical lines attached to noteheads
    // -------------------------------------------------------
    detectStems: function(noteHeads, binary, width, height, staves) {
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            var staff = staves[nh.staffIndex];
            var stemLen = staff.spacing * 3;
            var hasStemUp = false, hasStemDown = false;

            var sides = [nh.maxX, nh.minX];
            for (var si = 0; si < sides.length; si++) {
                var cx = sides[si];
                // Check upward
                var upCount = 0;
                for (var y = nh.minY - 1; y >= Math.max(0, nh.minY - stemLen); y--) {
                    var found = false;
                    for (var dx = -1; dx <= 1; dx++) {
                        var xx = cx + dx;
                        if (xx >= 0 && xx < width && binary[y * width + xx] === 1) { found = true; break; }
                    }
                    if (found) upCount++;
                }
                if (upCount > stemLen * 0.4) { hasStemUp = true; break; }
                // Check downward
                var downCount = 0;
                for (var y = nh.maxY + 1; y <= Math.min(height - 1, nh.maxY + stemLen); y++) {
                    var found = false;
                    for (var dx = -1; dx <= 1; dx++) {
                        var xx = cx + dx;
                        if (xx >= 0 && xx < width && binary[y * width + xx] === 1) { found = true; break; }
                    }
                    if (found) downCount++;
                }
                if (downCount > stemLen * 0.4) { hasStemDown = true; break; }
            }
            nh.hasStem = hasStemUp || hasStemDown;
            nh.stemDirection = hasStemUp ? 'up' : (hasStemDown ? 'down' : 'none');
        }
        return noteHeads;
    },

    // -------------------------------------------------------
    // FLAG & BEAM DETECTION
    // -------------------------------------------------------
    detectFlags: function(noteHeads, binary, width, height, staves) {
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            if (!nh.hasStem) { nh.flagCount = 0; continue; }
            var staff = staves[nh.staffIndex];
            var fz = Math.round(staff.spacing * 1.2);
            var sey = nh.stemDirection === 'up'
                ? nh.minY - Math.round(staff.spacing * 2.5)
                : nh.maxY + Math.round(staff.spacing * 2.5);
            var sx = nh.stemDirection === 'up' ? nh.maxX : nh.maxX;
            var fp = 0, tp = 0;
            var yS = Math.max(0, Math.min(sey, sey + fz) - 2);
            var yE = Math.min(height - 1, Math.max(sey, sey + fz) + 2);
            for (var y = yS; y <= yE; y++) {
                for (var x = sx; x < Math.min(width, sx + fz); x++) { tp++; if (binary[y * width + x] === 1) fp++; }
            }
            var d = tp > 0 ? fp / tp : 0;
            nh.flagCount = d > 0.3 ? 2 : (d > 0.12 ? 1 : 0);
        }
        return noteHeads;
    },

    detectBeams: function(noteHeads, binary, width, height, staves) {
        for (var i = 0; i < noteHeads.length; i++) noteHeads[i].beamCount = 0;
        for (var i = 0; i < noteHeads.length - 1; i++) {
            var a = noteHeads[i], b = noteHeads[i + 1];
            if (!a.hasStem || !b.hasStem || a.staffIndex !== b.staffIndex) continue;
            var staff = staves[a.staffIndex];
            if (Math.abs(b.centerX - a.centerX) > staff.spacing * 6) continue;
            var ae = a.stemDirection === 'up' ? a.minY - Math.round(staff.spacing * 2) : a.maxY + Math.round(staff.spacing * 2);
            var be = b.stemDirection === 'up' ? b.minY - Math.round(staff.spacing * 2) : b.maxY + Math.round(staff.spacing * 2);
            var by = Math.round((ae + be) / 2);
            var sx = Math.min(a.centerX, b.centerX), ex = Math.max(a.centerX, b.centerX);
            var bp = 0, ts = 0;
            for (var dy = -2; dy <= 2; dy++) {
                var y = by + dy; if (y < 0 || y >= height) continue;
                for (var x = sx; x <= ex; x++) { ts++; if (binary[y * width + x] === 1) bp++; }
            }
            if (ts > 0 && bp / ts > 0.35) {
                a.beamCount = Math.max(a.beamCount, 1); b.beamCount = Math.max(b.beamCount, 1);
            }
        }
        return noteHeads;
    },

    // -------------------------------------------------------
    // KEY SIGNATURE, TIME SIGNATURE, PREAMBLE DETECTION
    // -------------------------------------------------------
    _findNoteStartX: function(binary, width, staves) {
        var results = [];
        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s]; var sp = staff.spacing;
            var minSkip = Math.round(sp * 3);
            var bestGap = minSkip;
            for (var x = minSkip; x < Math.min(width, Math.round(sp * 7)); x++) {
                var ink = 0;
                for (var y = staff.top; y <= staff.bottom; y++) {
                    if (binary[y * width + x] === 1) ink++;
                }
                if (ink < (staff.bottom - staff.top) * 0.12) bestGap = x;
            }
            results.push(bestGap);
        }
        return results;
    },

    detectKeySignature: function(binary, width, staves) {
        if (staves.length === 0) return { fifths: 0, accidentals: {} };
        var staff = staves[0]; var sp = staff.spacing;
        var startX = Math.round(sp * 3); var endX = Math.round(sp * 6.5);
        var top = staff.top - Math.round(sp); var bot = staff.bottom + Math.round(sp);
        var imgH = Math.floor(binary.length / width);

        var cols = [];
        for (var x = startX; x < Math.min(width, endX); x++) {
            var ink = 0;
            for (var y = Math.max(0, top); y <= Math.min(bot, imgH - 1); y++) {
                if (binary[y * width + x] === 1) ink++;
            }
            cols.push(ink);
        }
        var inCl = false, clS = 0, clusters = [];
        for (var i = 0; i < cols.length; i++) {
            if (cols[i] > sp * 0.3 && !inCl) { inCl = true; clS = i; }
            else if (cols[i] <= sp * 0.3 && inCl) {
                inCl = false; var w = i - clS;
                if (w > sp * 0.2 && w < sp * 1.8) clusters.push({ start: clS + startX, width: w });
            }
        }
        var sc = 0, fc = 0;
        for (var c = 0; c < clusters.length; c++) {
            var cl = clusters[c]; var maxH = 0;
            for (var y = Math.max(0, top); y <= bot; y++) {
                for (var x = cl.start; x < cl.start + cl.width; x++) {
                    if (x < width && binary[y * width + x] === 1) { var h = y - top; if (h > maxH) maxH = h; }
                }
            }
            if (maxH > sp * 2) sc++; else if (maxH > sp * 0.5) fc++;
        }
        var fifths = sc > fc ? Math.min(sc, 7) : (fc > sc ? -Math.min(fc, 7) : 0);
        var acc = {};
        var so = ['F','C','G','D','A','E','B'], fo = ['B','E','A','D','G','C','F'];
        if (fifths > 0) for (var i = 0; i < fifths; i++) acc[so[i]] = 1;
        else if (fifths < 0) for (var i = 0; i < -fifths; i++) acc[fo[i]] = -1;
        return { fifths: fifths, accidentals: acc };
    },

    detectTimeSignature: function(binary, width, staves) {
        if (staves.length === 0) return { beats: 4, beatType: 4 };
        var staff = staves[0]; var sp = staff.spacing;
        var startX = Math.round(sp * 5); var endX = Math.round(sp * 7.5);
        var midY = staff.center;
        var topInk = 0, botInk = 0;
        for (var x = startX; x < Math.min(width, endX); x++) {
            for (var y = staff.top; y < midY; y++) { if (binary[y * width + x] === 1) topInk++; }
            for (var y = midY; y <= staff.bottom; y++) { if (binary[y * width + x] === 1) botInk++; }
        }
        if (topInk < sp * 2 && botInk < sp * 2) return { beats: 4, beatType: 4 };
        // Heuristic for common time sigs
        var crossY = Math.round((staff.top + midY) / 2);
        var crossings = 0; var prev = 0;
        for (var x = startX; x < endX; x++) {
            var cur = (x < width) ? binary[crossY * width + x] : 0;
            if (cur === 1 && prev === 0) crossings++;
            prev = cur;
        }
        var beats = crossings >= 3 ? 4 : (crossings <= 1 ? 2 : 3);
        var botCrossY = Math.round((midY + staff.bottom) / 2);
        var botCrossings = 0; prev = 0;
        for (var x = startX; x < endX; x++) {
            var cur = (x < width) ? binary[botCrossY * width + x] : 0;
            if (cur === 1 && prev === 0) botCrossings++;
            prev = cur;
        }
        return { beats: beats, beatType: botCrossings >= 2 ? 8 : 4 };
    },

    // -------------------------------------------------------
    // REST & BARLINE DETECTION
    // -------------------------------------------------------
    detectRests: function(binary, width, height, staves, noteStartX) {
        // Use blob detection for rests (they have distinctive shapes)
        var blobs = this._findBlobs(binary, width, height);
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

            // Whole/half rest
            if (b.width > avgSp * 0.5 && b.width < avgSp * 2 && b.height > avgSp * 0.2 && b.height < avgSp * 0.8 && b.fillRatio > 0.7 && b.aspectRatio > 1.2) {
                var rt = b.centerY < staff.center ? 'half' : 'whole';
                rests.push({type:rt, durationValue: rt==='half'?2:4, mxlType:rt, centerX:b.centerX, centerY:b.centerY, staffIndex:ns, isRest:true});
                continue;
            }
            // Quarter rest
            if (b.height > avgSp * 1.5 && b.height < avgSp * 4 && b.width < avgSp * 1.2 && b.aspectRatio < 0.6 && b.fillRatio > 0.25 && b.fillRatio < 0.65) {
                rests.push({type:'quarter', durationValue:1, mxlType:'quarter', centerX:b.centerX, centerY:b.centerY, staffIndex:ns, isRest:true});
                continue;
            }
            // Eighth rest
            if (b.height > avgSp * 0.8 && b.height < avgSp * 2 && b.width < avgSp * 1.0 && b.fillRatio > 0.2 && b.fillRatio < 0.55 && b.aspectRatio < 0.8) {
                rests.push({type:'eighth', durationValue:0.5, mxlType:'eighth', centerX:b.centerX, centerY:b.centerY, staffIndex:ns, isRest:true});
            }
        }
        return rests;
    },

    // Simple blob finder for rests
    _findBlobs: function(binary, width, height) {
        var labels = new Int32Array(binary.length);
        var next = 1; var eq = {};
        function find(x) { while (eq[x] && eq[x] !== x) x = eq[x]; return x; }
        function union(a, b) { a = find(a); b = find(b); if (a !== b) eq[Math.max(a,b)] = Math.min(a,b); }
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var idx = y * width + x;
                if (binary[idx] === 0) continue;
                var nb = [];
                if (x > 0 && labels[idx-1] > 0) nb.push(labels[idx-1]);
                if (y > 0 && labels[idx-width] > 0) nb.push(labels[idx-width]);
                if (x > 0 && y > 0 && labels[idx-width-1] > 0) nb.push(labels[idx-width-1]);
                if (x < width-1 && y > 0 && labels[idx-width+1] > 0) nb.push(labels[idx-width+1]);
                if (nb.length === 0) { labels[idx] = next; eq[next] = next; next++; }
                else { var m = Math.min.apply(null, nb); labels[idx] = m; for (var n = 0; n < nb.length; n++) union(m, nb[n]); }
            }
        }
        var blobs = {};
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var idx = y * width + x; if (labels[idx] === 0) continue;
                var r = find(labels[idx]);
                if (!blobs[r]) blobs[r] = {minX:x,maxX:x,minY:y,maxY:y,pixels:0};
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
            b.fillRatio = b.pixels / (b.width * b.height);
            b.aspectRatio = b.width / b.height;
            result.push(b);
        }
        return result;
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
                    if (narrow) { var dup = false; for (var b = 0; b < barLines.length; b++) { if (barLines[b].staffIndex === s && Math.abs(barLines[b].x - x) < 8) { dup = true; break; } } if (!dup) barLines.push({x:x, staffIndex:s}); }
                }
            }
        }
        return barLines;
    },

    // -------------------------------------------------------
    // DURATION, PITCH, ORGANIZE
    // -------------------------------------------------------
    classifyDuration: function(noteHeads) {
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            var flags = Math.max(nh.flagCount || 0, nh.beamCount || 0);
            if (!nh.isFilled && !nh.hasStem) { nh.duration='whole'; nh.durationValue=4; nh.mxlType='whole'; }
            else if (!nh.isFilled && nh.hasStem) { nh.duration='half'; nh.durationValue=2; nh.mxlType='half'; }
            else if (nh.isFilled && nh.hasStem && flags >= 2) { nh.duration='16th'; nh.durationValue=0.25; nh.mxlType='16th'; }
            else if (nh.isFilled && nh.hasStem && flags >= 1) { nh.duration='eighth'; nh.durationValue=0.5; nh.mxlType='eighth'; }
            else { nh.duration='quarter'; nh.durationValue=1; nh.mxlType='quarter'; }
        }
        return noteHeads;
    },

    assignPitch: function(noteHeads, staves, keySig) {
        var acc = (keySig && keySig.accidentals) ? keySig.accidentals : {};
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            var staff = staves[nh.staffIndex];
            var pitches = (staff.clef === 'bass') ? this.BASS_PITCHES : this.TREBLE_PITCHES;

            // posIndex was already computed during scanning
            var posIndex = nh.posIndex;
            var pitch;
            if (posIndex >= 0 && posIndex < pitches.length) {
                pitch = { step: pitches[posIndex].s, octave: pitches[posIndex].o };
            } else {
                var steps = this.STEPS;
                var ref = posIndex >= pitches.length ? pitches[pitches.length - 1] : pitches[0];
                var count = posIndex >= pitches.length ? posIndex - pitches.length + 1 : Math.abs(posIndex);
                var dir = posIndex >= 0 ? 1 : -1;
                var si = steps.indexOf(ref.s); var oct = ref.o;
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

    organizeNotes: function(noteHeads, staves) {
        noteHeads.sort(function(a, b) {
            var sA = staves[a.staffIndex].systemIndex || 0;
            var sB = staves[b.staffIndex].systemIndex || 0;
            if (sA !== sB) return sA - sB;
            return a.centerX - b.centerX;
        });
        var events = []; var i = 0;
        while (i < noteHeads.length) {
            var chord = [noteHeads[i]]; var j = i + 1;
            while (j < noteHeads.length &&
                   (staves[noteHeads[j].staffIndex].systemIndex||0) === (staves[noteHeads[i].staffIndex].systemIndex||0) &&
                   Math.abs(noteHeads[j].centerX - noteHeads[i].centerX) < noteHeads[i].width * 1.5) {
                chord.push(noteHeads[j]); j++;
            }
            var minDur = 4;
            for (var c = 0; c < chord.length; c++) { if (chord[c].durationValue < minDur) minDur = chord[c].durationValue; }
            events.push({
                notes: chord, x: chord[0].centerX, staffIndex: chord[0].staffIndex,
                systemIndex: staves[chord[0].staffIndex].systemIndex || 0,
                durationValue: minDur, duration: chord[0].duration, mxlType: chord[0].mxlType
            });
            i = j;
        }
        return events;
    },

    // -------------------------------------------------------
    // MAIN PIPELINE v4.0
    // -------------------------------------------------------
    detect: function(cleanedBinary, originalBinary, width, height, staves) {
        // Step 1: Compute distance transform on the original binary
        var distTransform = this.computeDistanceTransform(originalBinary, width, height);

        // Step 2: Detect key & time signatures
        var keySig = this.detectKeySignature(originalBinary, width, staves);
        var timeSig = this.detectTimeSignature(originalBinary, width, staves);

        // Step 3: Find note start positions (skip preamble)
        var noteStartX = this._findNoteStartX(originalBinary, width, staves);

        // Step 4: TEMPLATE-MATCHING NOTEHEAD SCAN (the big improvement!)
        var noteHeads = this.scanForNoteheads(originalBinary, distTransform, width, height, staves, noteStartX);

        // Step 5: Detect stems, flags, beams
        noteHeads = this.detectStems(noteHeads, originalBinary, width, height, staves);
        noteHeads = this.detectFlags(noteHeads, originalBinary, width, height, staves);
        noteHeads = this.detectBeams(noteHeads, originalBinary, width, height, staves);

        // Step 6: Classify duration and assign pitch
        noteHeads = this.classifyDuration(noteHeads);
        noteHeads = this.assignPitch(noteHeads, staves, keySig);

        // Step 7: Detect rests and bar lines
        var rests = this.detectRests(cleanedBinary, width, height, staves, noteStartX);
        var barLines = this.detectBarLines(originalBinary, width, height, staves);

        // Step 8: Organize into events
        var events = this.organizeNotes(noteHeads, staves);

        // Merge rests
        for (var r = 0; r < rests.length; r++) {
            events.push({
                notes:[], isRest:true, restType:rests[r].type, x:rests[r].centerX,
                staffIndex:rests[r].staffIndex, systemIndex: staves[rests[r].staffIndex].systemIndex||0,
                durationValue:rests[r].durationValue, duration:rests[r].type, mxlType:rests[r].mxlType
            });
        }
        events.sort(function(a, b) {
            if (a.systemIndex !== b.systemIndex) return a.systemIndex - b.systemIndex;
            return a.x - b.x;
        });

        return { noteHeads:noteHeads, events:events, rests:rests, barLines:barLines, keySignature:keySig, timeSignature:timeSig };
    }
};

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

console.log('[PianoModeOMR] Engine v4.0 loaded — all modules ready');
})();
