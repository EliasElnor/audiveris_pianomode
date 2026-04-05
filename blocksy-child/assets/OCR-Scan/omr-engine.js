/**
 * PianoMode OMR Engine v5.0 — Production-Grade Client-Side Music Recognition
 * Converts sheet music images/PDFs into MusicXML + MIDI entirely in the browser.
 *
 * v5.0 improvements over v4.0:
 * - Projection-based barline detection (Audiveris StaffProjector approach)
 * - Measure-based note organization using detected barlines
 * - Proper time assignment within measures
 * - Beam group detection with morphological approach
 * - Improved key/time signature detection
 * - Proper grand staff handling
 * - MusicXML with correct timing, voices, backup/forward
 * - Fixed MIDI generation with proper delta times
 *
 * @package PianoMode
 * @version 5.0.0
 */
(function() {
'use strict';

var OMR = window.PianoModeOMR = {};

// =====================================================
// IMAGE PROCESSOR
// =====================================================
PianoModeOMR.ImageProcessor = {

    loadImage: function(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                var img = new Image();
                img.onload = function() {
                    var canvas = document.createElement('canvas');
                    var scale = 1;
                    if (img.width > 3000 || img.height > 3000) {
                        scale = 3000 / Math.max(img.width, img.height);
                    }
                    canvas.width = Math.round(img.width * scale);
                    canvas.height = Math.round(img.height * scale);
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    resolve({ imageData: imageData, width: canvas.width, height: canvas.height, canvas: canvas });
                };
                img.onerror = function() { reject(new Error('Failed to load image')); };
                img.src = e.target.result;
            };
            reader.onerror = function() { reject(new Error('Failed to read file')); };
            reader.readAsDataURL(file);
        });
    },

    loadPDF: function(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                var typedArray = new Uint8Array(e.target.result);
                if (typeof pdfjsLib === 'undefined') { reject(new Error('PDF.js library not loaded')); return; }
                pdfjsLib.getDocument({ data: typedArray }).promise.then(function(pdf) {
                    pdf.getPage(1).then(function(page) {
                        var scale = 3.0;
                        var viewport = page.getViewport({ scale: scale });
                        var canvas = document.createElement('canvas');
                        canvas.width = viewport.width;
                        canvas.height = viewport.height;
                        var ctx = canvas.getContext('2d');
                        page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function() {
                            var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                            resolve({ imageData: imageData, width: canvas.width, height: canvas.height, canvas: canvas, totalPages: pdf.numPages });
                        });
                    });
                }).catch(reject);
            };
            reader.onerror = function() { reject(new Error('Failed to read PDF')); };
            reader.readAsArrayBuffer(file);
        });
    },

    toGrayscale: function(imageData) {
        var data = imageData.data;
        var gray = new Uint8Array(imageData.width * imageData.height);
        for (var i = 0; i < gray.length; i++) {
            gray[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
        }
        return gray;
    },

    otsuThreshold: function(gray) {
        var hist = new Array(256).fill(0);
        for (var i = 0; i < gray.length; i++) hist[gray[i]]++;
        var total = gray.length;
        var sumAll = 0;
        for (var t = 0; t < 256; t++) sumAll += t * hist[t];
        var sumBg = 0, wBg = 0, best = 0, bestT = 0;
        for (var t = 0; t < 256; t++) {
            wBg += hist[t]; if (wBg === 0) continue;
            var wFg = total - wBg; if (wFg === 0) break;
            sumBg += t * hist[t];
            var between = wBg * wFg * Math.pow(sumBg / wBg - (sumAll - sumBg) / wFg, 2);
            if (between > best) { best = between; bestT = t; }
        }
        return bestT;
    },

    binarize: function(gray, threshold) {
        var binary = new Uint8Array(gray.length);
        for (var i = 0; i < gray.length; i++) binary[i] = gray[i] < threshold ? 1 : 0;
        return binary;
    },

    cleanNoise: function(binary, width, height) {
        var cleaned = new Uint8Array(binary);
        var eroded = new Uint8Array(binary.length);
        for (var y = 1; y < height - 1; y++) {
            for (var x = 1; x < width - 1; x++) {
                var idx = y * width + x;
                if (binary[idx] === 1 && binary[idx-1] === 1 && binary[idx+1] === 1 &&
                    binary[idx-width] === 1 && binary[idx+width] === 1) {
                    eroded[idx] = 1;
                }
            }
        }
        for (var y = 1; y < height - 1; y++) {
            for (var x = 1; x < width - 1; x++) {
                var idx = y * width + x;
                if (eroded[idx] === 1) {
                    cleaned[idx] = 1; cleaned[idx-1] = 1; cleaned[idx+1] = 1;
                    cleaned[idx-width] = 1; cleaned[idx+width] = 1;
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

    detect: function(binary, width, height) {
        var projection = new Uint32Array(height);
        for (var y = 0; y < height; y++) {
            var count = 0, offset = y * width;
            for (var x = 0; x < width; x++) { if (binary[offset + x] === 1) count++; }
            projection[y] = count;
        }
        var mean = 0;
        for (var y = 0; y < height; y++) mean += projection[y];
        mean /= height;
        var lineThreshold = Math.max(mean * 2, width * 0.3);
        var candidateRows = [];
        for (var y = 0; y < height; y++) { if (projection[y] >= lineThreshold) candidateRows.push(y); }
        var lines = [];
        if (candidateRows.length === 0) return [];
        var start = candidateRows[0], end = candidateRows[0];
        for (var i = 1; i < candidateRows.length; i++) {
            if (candidateRows[i] - end <= 2) { end = candidateRows[i]; }
            else { lines.push(Math.round((start + end) / 2)); start = candidateRows[i]; end = candidateRows[i]; }
        }
        lines.push(Math.round((start + end) / 2));
        return this._groupIntoStaves(lines);
    },

    _groupIntoStaves: function(lines) {
        if (lines.length < 5) return [];
        var staves = [], used = new Array(lines.length).fill(false);
        for (var i = 0; i <= lines.length - 5; i++) {
            if (used[i]) continue;
            var spacing = [];
            for (var j = 0; j < 4; j++) spacing.push(lines[i + j + 1] - lines[i + j]);
            spacing.sort(function(a,b) { return a - b; });
            var median = spacing[1];
            var ok = true;
            for (var j = 0; j < 4; j++) { if (Math.abs(spacing[j] - median) > median * 0.4) { ok = false; break; } }
            if (ok && median > 3) {
                var staffLines = [];
                for (var j = 0; j < 5; j++) { staffLines.push(lines[i + j]); used[i + j] = true; }
                var avgSpacing = (staffLines[4] - staffLines[0]) / 4;
                staves.push({ lines: staffLines, top: staffLines[0], bottom: staffLines[4], spacing: avgSpacing, center: Math.round((staffLines[0] + staffLines[4]) / 2) });
            }
        }
        return staves;
    },

    groupIntoSystems: function(staves) {
        if (staves.length === 0) return staves;
        var systems = [[0]];
        for (var i = 1; i < staves.length; i++) {
            var gap = staves[i].top - staves[i - 1].bottom;
            if (gap > staves[i].spacing * 3) systems.push([i]);
            else systems[systems.length - 1].push(i);
        }
        for (var sys = 0; sys < systems.length; sys++) {
            for (var j = 0; j < systems[sys].length; j++) {
                var si = systems[sys][j];
                staves[si].systemIndex = sys;
                staves[si].staffInSystem = j;
                staves[si].systemStaffCount = systems[sys].length;
            }
        }
        return staves;
    },

    removeStaffLines: function(binary, width, height, staves) {
        var cleaned = new Uint8Array(binary);
        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            var lt = Math.max(2, Math.round(staff.spacing * 0.15));
            for (var l = 0; l < staff.lines.length; l++) {
                var lineY = staff.lines[l];
                for (var dy = -lt; dy <= lt; dy++) {
                    var y = lineY + dy;
                    if (y < 0 || y >= height) continue;
                    for (var x = 0; x < width; x++) {
                        var idx = y * width + x;
                        if (cleaned[idx] === 1) {
                            var aboveY = Math.max(0, y - lt - 1);
                            var belowY = Math.min(height - 1, y + lt + 1);
                            if (binary[aboveY * width + x] === 0 && binary[belowY * width + x] === 0) {
                                cleaned[idx] = 0;
                            }
                        }
                    }
                }
            }
        }
        return cleaned;
    },

    detectClefs: function(binary, width, staves) {
        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            if (staff.systemStaffCount >= 2) {
                staff.clef = (staff.staffInSystem === 0) ? 'treble' : 'bass';
            } else {
                var leftRegion = Math.min(width, Math.round(staff.spacing * 6));
                var upperInk = 0, lowerInk = 0, midY = staff.center;
                for (var y = staff.top - staff.spacing; y < midY; y++) {
                    if (y < 0) continue;
                    for (var x = 0; x < leftRegion; x++) { if (binary[y * width + x] === 1) upperInk++; }
                }
                for (var y = midY; y <= staff.bottom + staff.spacing; y++) {
                    for (var x = 0; x < leftRegion; x++) { if (binary[y * width + x] === 1) lowerInk++; }
                }
                staff.clef = (upperInk >= lowerInk) ? 'treble' : 'bass';
            }
        }
        return staves;
    }
};

/* =========================================================================
 *  MODULE 2: StaffDetector
 *  Uses horizontal projection to find staff lines, groups them into 5-line
 *  staves, and detects clef types.
 * ========================================================================= */
OMR.StaffDetector = {

    /**
     * Main detection entry point.
     * Returns { staves, staffSpacing, systems }
     *   staves[i] = { lines: [y0..y4], top, bottom, left, right, spacing, clef, staffIndex }
     *   systems[i] = { staves: [staff, staff], top, bottom }
     */
    detect: function(bin, width, height) {
        // Step 1: horizontal projection (count black pixels per row)
        var hProj = new Uint32Array(height);
        var x, y, idx;
        for (y = 0; y < height; y++) {
            var count = 0;
            idx = y * width;
            for (x = 0; x < width; x++) {
                if (bin[idx + x] === 1) count++;
            }
            hProj[y] = count;
        }

        // Step 2: find staff line candidates
        // A staff line row has many more black pixels than average
        var totalBlack = 0;
        for (y = 0; y < height; y++) totalBlack += hProj[y];
        var avgBlack = totalBlack / height;
        var lineThreshold = Math.max(avgBlack * 2.0, width * 0.15);

        var lineRows = [];
        for (y = 0; y < height; y++) {
            if (hProj[y] >= lineThreshold) {
                lineRows.push(y);
            }
        }

        // Step 3: merge consecutive rows into line segments
        var lineSegments = [];
        if (lineRows.length > 0) {
            var segStart = lineRows[0];
            var segEnd = lineRows[0];
            for (var i = 1; i < lineRows.length; i++) {
                if (lineRows[i] <= segEnd + 2) {
                    segEnd = lineRows[i];
                } else {
                    lineSegments.push({ y: Math.round((segStart + segEnd) / 2), top: segStart, bottom: segEnd, thickness: segEnd - segStart + 1 });
                    segStart = lineRows[i];
                    segEnd = lineRows[i];
                }
            }
            lineSegments.push({ y: Math.round((segStart + segEnd) / 2), top: segStart, bottom: segEnd, thickness: segEnd - segStart + 1 });
        }

        // Step 4: group line segments into 5-line staves
        // Expect roughly equal spacing between consecutive lines in a staff
        var staves = [];
        var used = new Array(lineSegments.length);
        for (i = 0; i < used.length; i++) used[i] = false;

        for (i = 0; i <= lineSegments.length - 5; i++) {
            if (used[i]) continue;

            // Try to form a 5-line group starting at segment i
            var group = [lineSegments[i]];
            var lastIdx = i;
            var valid = true;

            for (var g = 1; g < 5; g++) {
                var expectedSpacing = (group.length > 1) ?
                    (group[group.length - 1].y - group[0].y) / (group.length - 1) : 0;
                var bestJ = -1;
                var bestDist = Infinity;

                for (var j = lastIdx + 1; j < lineSegments.length && j <= lastIdx + 4; j++) {
                    if (used[j]) continue;
                    var gap = lineSegments[j].y - group[group.length - 1].y;
                    if (gap < 3) continue;
                    if (gap > 50) break;

                    if (expectedSpacing > 0) {
                        var dev = Math.abs(gap - expectedSpacing);
                        if (dev < bestDist && dev < expectedSpacing * 0.5) {
                            bestDist = dev;
                            bestJ = j;
                        }
                    } else {
                        if (gap < bestDist && gap >= 5 && gap <= 40) {
                            bestDist = gap;
                            bestJ = j;
                        }
                    }
                }

                if (bestJ === -1) {
                    valid = false;
                    break;
                }
                group.push(lineSegments[bestJ]);
                lastIdx = bestJ;
            }

            if (!valid || group.length !== 5) continue;

            // Validate spacing consistency
            var spacings = [];
            for (g = 1; g < 5; g++) {
                spacings.push(group[g].y - group[g - 1].y);
            }
            var avgSpacing = (spacings[0] + spacings[1] + spacings[2] + spacings[3]) / 4;
            var maxDev = 0;
            for (g = 0; g < 4; g++) {
                var d = Math.abs(spacings[g] - avgSpacing);
                if (d > maxDev) maxDev = d;
            }
            if (maxDev > avgSpacing * 0.35) continue;

            // Valid staff found
            var lines = [];
            for (g = 0; g < 5; g++) {
                lines.push(group[g].y);
                // Mark used — find the index
                for (var k = 0; k < lineSegments.length; k++) {
                    if (lineSegments[k] === group[g]) { used[k] = true; break; }
                }
            }

            // Find staff horizontal extent
            var staffTop = lines[0] - Math.round(avgSpacing);
            var staffBottom = lines[4] + Math.round(avgSpacing);
            if (staffTop < 0) staffTop = 0;
            if (staffBottom >= height) staffBottom = height - 1;

            var staffLeft = width, staffRight = 0;
            for (y = lines[0]; y <= lines[4]; y++) {
                for (x = 0; x < width; x++) {
                    if (bin[y * width + x] === 1) {
                        if (x < staffLeft) staffLeft = x;
                        if (x > staffRight) staffRight = x;
                    }
                }
            }
            if (staffLeft > 20) staffLeft -= 10;
            if (staffRight < width - 20) staffRight += 10;

            staves.push({
                lines: lines,
                top: staffTop,
                bottom: staffBottom,
                left: staffLeft,
                right: staffRight,
                spacing: avgSpacing,
                lineThickness: Math.round((group[0].thickness + group[1].thickness + group[2].thickness + group[3].thickness + group[4].thickness) / 5),
                clef: 'treble',
                staffIndex: staves.length
            });
        }

        if (staves.length === 0) {
            console.warn('[StaffDetector] No staves found');
            return { staves: [], staffSpacing: 12, systems: [] };
        }

        // Global staff spacing
        var globalSpacing = 0;
        for (i = 0; i < staves.length; i++) globalSpacing += staves[i].spacing;
        globalSpacing = globalSpacing / staves.length;

        // Group into systems
        var systems = this.groupIntoSystems(staves, globalSpacing);

        // Detect clefs
        this.detectClefs(bin, width, height, staves);

        // Re-index staves
        for (i = 0; i < staves.length; i++) {
            staves[i].staffIndex = i;
        }

        console.log('[StaffDetector] Found ' + staves.length + ' staves in ' + systems.length + ' systems, spacing=' + Math.round(globalSpacing));

        return {
            staves: staves,
            staffSpacing: globalSpacing,
            systems: systems
        };
    },

    /**
     * Group staves into systems (grand staff detection).
     * Two staves close together (gap < 3x spacing) form a grand staff system.
     */
    groupIntoSystems: function(staves, spacing) {
        var systems = [];
        var i = 0;
        while (i < staves.length) {
            if (i + 1 < staves.length) {
                var gap = staves[i + 1].lines[0] - staves[i].lines[4];
                // Grand staff: gap between bottom of top staff and top of bottom staff < 3x spacing
                if (gap < spacing * 3.5 && gap > 0) {
                    systems.push({
                        staves: [staves[i], staves[i + 1]],
                        top: staves[i].top,
                        bottom: staves[i + 1].bottom,
                        isGrandStaff: true
                    });
                    i += 2;
                    continue;
                }
            }
            systems.push({
                staves: [staves[i]],
                top: staves[i].top,
                bottom: staves[i].bottom,
                isGrandStaff: false
            });
            i++;
        }
        return systems;
    },

    /**
     * Remove staff lines from binary image to aid note detection.
     * Only removes pixels that are part of thin horizontal runs.
     */
    removeStaffLines: function(bin, width, height, staves) {
        var cleaned = new Uint8Array(bin);
        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            var maxThick = staff.lineThickness + 2;

            for (var lineIdx = 0; lineIdx < 5; lineIdx++) {
                var lineY = staff.lines[lineIdx];
                var searchTop = lineY - Math.ceil(maxThick / 2);
                var searchBot = lineY + Math.ceil(maxThick / 2);
                if (searchTop < 0) searchTop = 0;
                if (searchBot >= height) searchBot = height - 1;

                for (var x = staff.left; x <= staff.right; x++) {
                    // Count vertical black run at this x through the line region
                    var runTop = -1, runBot = -1;
                    for (var y = searchTop; y <= searchBot; y++) {
                        if (bin[y * width + x] === 1) {
                            if (runTop === -1) runTop = y;
                            runBot = y;
                        }
                    }
                    if (runTop === -1) continue;
                    var runLen = runBot - runTop + 1;

                    // Only erase if thin (staff line) — not if something thicker crosses
                    if (runLen <= maxThick) {
                        // Check if there's foreground above or below (would indicate a note/stem crossing)
                        var hasAbove = (runTop > 0 && bin[(runTop - 1) * width + x] === 1);
                        var hasBelow = (runBot < height - 1 && bin[(runBot + 1) * width + x] === 1);

                        // If the vertical run is only staff-line thickness AND
                        // there is NOT foreground both above and below, erase it
                        if (!(hasAbove && hasBelow)) {
                            for (var ey = runTop; ey <= runBot; ey++) {
                                cleaned[ey * width + x] = 0;
                            }
                        }
                    }
                }
            }
        }
        return cleaned;
    },

    /**
     * Detect clef type for each staff by analyzing the left region.
     * Treble clef is taller, bass clef is shorter with dots.
     */
    detectClefs: function(bin, width, height, staves) {
        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            var sp = staff.spacing;
            var regionLeft = staff.left;
            var regionRight = Math.min(staff.left + Math.round(sp * 3), staff.right);
            var regionTop = staff.lines[0] - Math.round(sp * 1.5);
            var regionBottom = staff.lines[4] + Math.round(sp * 1.5);
            if (regionTop < 0) regionTop = 0;
            if (regionBottom >= height) regionBottom = height - 1;

            // Count black pixels above and below staff center
            var centerY = Math.round((staff.lines[0] + staff.lines[4]) / 2);
            var aboveCount = 0, belowCount = 0;
            for (var y = regionTop; y <= regionBottom; y++) {
                for (var x = regionLeft; x < regionRight; x++) {
                    if (bin[y * width + x] === 1) {
                        if (y < centerY) aboveCount++;
                        else belowCount++;
                    }
                }
            }

            // Treble clef extends significantly above center, bass clef is more balanced/below-heavy
            var ratio = (aboveCount + 1) / (belowCount + 1);
            // Also check extent above top line
            var extentAbove = 0;
            for (y = regionTop; y < staff.lines[0]; y++) {
                for (x = regionLeft; x < regionRight; x++) {
                    if (bin[y * width + x] === 1) { extentAbove++; break; }
                }
            }
            var extentBelow = 0;
            for (y = staff.lines[4] + 1; y <= regionBottom; y++) {
                for (x = regionLeft; x < regionRight; x++) {
                    if (bin[y * width + x] === 1) { extentBelow++; break; }
                }
            }

            if (extentAbove > sp * 1.2 && ratio > 0.7) {
                staff.clef = 'treble';
            } else {
                staff.clef = 'bass';
            }
        }
    }
};


// =====================================================
// NOTE DETECTOR v5.0 — Audiveris-inspired algorithms
// Chamfer distance + template matching + projection barlines
// + measure-based organization + proper rhythm
// =====================================================
PianoModeOMR.NoteDetector = {

    STEPS: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],

    TREBLE_PITCHES: [
        {s:'E',o:4},{s:'F',o:4},{s:'G',o:4},{s:'A',o:4},{s:'B',o:4},
        {s:'C',o:5},{s:'D',o:5},{s:'E',o:5},{s:'F',o:5},{s:'G',o:5},
        {s:'A',o:5},{s:'B',o:5},{s:'C',o:6},{s:'D',o:6},{s:'E',o:6},
        {s:'F',o:6},{s:'G',o:6}
    ],
    BASS_PITCHES: [
        {s:'G',o:2},{s:'A',o:2},{s:'B',o:2},{s:'C',o:3},{s:'D',o:3},
        {s:'E',o:3},{s:'F',o:3},{s:'G',o:3},{s:'A',o:3},{s:'B',o:3},
        {s:'C',o:4},{s:'D',o:4},{s:'E',o:4},{s:'F',o:4},{s:'G',o:4},
        {s:'A',o:4},{s:'B',o:4}
    ],

    noteToMidi: function(step, octave, alter) {
        var semi = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
        return 12 * (octave + 1) + (semi[step] || 0) + (alter || 0);
    },

    // -------------------------------------------------------
    // CHAMFER DISTANCE TRANSFORM (3x3 mask)
    // -------------------------------------------------------
    computeDistanceTransform: function(binary, width, height) {
        var INF = 9999;
        var dist = new Int32Array(width * height);
        for (var i = 0; i < binary.length; i++) dist[i] = binary[i] === 1 ? 0 : INF;
        for (var y = 1; y < height; y++) {
            for (var x = 1; x < width - 1; x++) {
                var idx = y * width + x;
                var d = dist[idx];
                d = Math.min(d, dist[idx - width - 1] + 4);
                d = Math.min(d, dist[idx - width] + 3);
                d = Math.min(d, dist[idx - width + 1] + 4);
                d = Math.min(d, dist[idx - 1] + 3);
                dist[idx] = d;
            }
        }
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
        for (var i = 0; i < dist.length; i++) dist[i] = Math.round(dist[i] / 3);
        return dist;
    },

    // -------------------------------------------------------
    // NOTEHEAD TEMPLATE (synthetic ellipse)
    // -------------------------------------------------------
    _createNoteheadTemplate: function(spacing, isFilled) {
        var w = Math.round(spacing * 1.35);
        var h = Math.round(spacing * 0.8);
        var hw = Math.floor(w / 2);
        var hh = Math.floor(h / 2);
        var points = [];
        var tiltAngle = 0.35; // ~20 degrees

        for (var dy = -hh - 1; dy <= hh + 1; dy++) {
            for (var dx = -hw - 1; dx <= hw + 1; dx++) {
                var rx = dx * Math.cos(tiltAngle) + dy * Math.sin(tiltAngle);
                var ry = -dx * Math.sin(tiltAngle) + dy * Math.cos(tiltAngle);
                var ellipseVal = (rx * rx) / (hw * hw) + (ry * ry) / (hh * hh);

                if (isFilled) {
                    if (ellipseVal <= 1.0) points.push({x:dx, y:dy, expected:0});
                    else if (ellipseVal <= 1.5) points.push({x:dx, y:dy, expected:1});
                } else {
                    if (ellipseVal <= 1.0 && ellipseVal >= 0.4) points.push({x:dx, y:dy, expected:0});
                    else if (ellipseVal < 0.4) points.push({x:dx, y:dy, expected:-1});
                    else if (ellipseVal <= 1.5) points.push({x:dx, y:dy, expected:1});
                }
            }
        }
        return { points: points, width: w, height: h };
    },

    // -------------------------------------------------------
    // TEMPLATE EVALUATION (Audiveris-style weighted scoring)
    // -------------------------------------------------------
    _evaluateTemplate: function(template, cx, cy, distTransform, width, height) {
        var foreWeight = 4.0, backWeight = 1.0, holeWeight = 0.5;
        var totalWeight = 0, totalDist = 0;

        for (var i = 0; i < template.points.length; i++) {
            var p = template.points[i];
            var nx = cx + p.x, ny = cy + p.y;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            var actualDist = distTransform[ny * width + nx];
            var weight, dist;

            if (p.expected === 0) { weight = foreWeight; dist = actualDist > 0 ? 1 : 0; }
            else if (p.expected > 0) { weight = backWeight; dist = actualDist === 0 ? 1 : 0; }
            else { weight = holeWeight; dist = actualDist === 0 ? 1 : 0; }

            totalDist += weight * dist;
            totalWeight += weight;
        }
        return totalWeight > 0 ? totalDist / totalWeight : 1.0;
    },

    // -------------------------------------------------------
    // BARLINE DETECTION — Audiveris StaffProjector approach
    // Uses vertical projection + derivative threshold
    // -------------------------------------------------------
    detectBarLines: function(binary, width, height, staves) {
        var allBarLines = [];

        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            var sp = staff.spacing;
            var staffH = staff.bottom - staff.top;
            var staffBarLines = [];

            // Step 1: Compute vertical projection within staff bounds
            var projection = new Uint16Array(width);
            for (var x = 0; x < width; x++) {
                var count = 0;
                for (var y = staff.top - 2; y <= staff.bottom + 2; y++) {
                    if (y >= 0 && y < height && binary[y * width + x] === 1) count++;
                }
                projection[x] = count;
            }

            // Step 2: Compute derivatives
            var derivatives = new Int16Array(width);
            for (var x = 1; x < width; x++) {
                derivatives[x] = projection[x] - projection[x - 1];
            }

            // Step 3: Adaptive threshold from top derivatives (Audiveris approach)
            var sortedDer = [];
            for (var x = 0; x < width; x++) sortedDer.push(Math.abs(derivatives[x]));
            sortedDer.sort(function(a, b) { return b - a; });
            var topN = Math.min(5, sortedDer.length);
            var eliteDer = 0;
            for (var i = 0; i < topN; i++) eliteDer += sortedDer[i];
            eliteDer /= topN;
            var derivThreshold = Math.round(eliteDer * 0.3);
            var barThreshold = Math.round(staffH * 0.65); // min pixel count for barline

            // Step 4: Find peaks using derivative crossings
            var inPeak = false, peakStart = 0;
            for (var x = Math.round(sp * 2); x < width; x++) {
                if (!inPeak && derivatives[x] >= derivThreshold) {
                    peakStart = x;
                    inPeak = true;
                } else if (inPeak && derivatives[x] <= -derivThreshold) {
                    // Peak end found — validate
                    var peakEnd = x;
                    var peakWidth = peakEnd - peakStart;

                    // Barline must be narrow
                    if (peakWidth < sp * 1.5 && peakWidth > 0) {
                        // Check pixel count within peak
                        var maxCount = 0;
                        for (var px = peakStart; px <= peakEnd; px++) {
                            if (projection[px] > maxCount) maxCount = projection[px];
                        }
                        // Must span most of staff height
                        if (maxCount >= barThreshold) {
                            var barX = Math.round((peakStart + peakEnd) / 2);
                            // Check it's not too close to previous barline
                            var tooClose = false;
                            for (var b = staffBarLines.length - 1; b >= 0; b--) {
                                if (Math.abs(staffBarLines[b].x - barX) < sp * 1.5) { tooClose = true; break; }
                            }
                            if (!tooClose) {
                                staffBarLines.push({ x: barX, staffIndex: s, projection: maxCount });
                            }
                        }
                    }
                    inPeak = false;
                }
            }

            // Also detect barlines using simple high-count columns as fallback
            for (var x = Math.round(sp * 2); x < width; x++) {
                if (projection[x] >= barThreshold) {
                    // Check narrowness
                    var narrow = true;
                    for (var dx = -4; dx <= 4; dx++) {
                        if (dx === 0) continue;
                        var nx = x + dx;
                        if (nx >= 0 && nx < width && Math.abs(dx) > 2 && projection[nx] >= barThreshold * 0.85) {
                            narrow = false; break;
                        }
                    }
                    if (narrow) {
                        var dup = false;
                        for (var b = 0; b < staffBarLines.length; b++) {
                            if (Math.abs(staffBarLines[b].x - x) < sp * 1.5) { dup = true; break; }
                        }
                        if (!dup) staffBarLines.push({ x: x, staffIndex: s, projection: projection[x] });
                    }
                }
            }

            // Sort barlines by x position
            staffBarLines.sort(function(a, b) { return a.x - b.x; });
            allBarLines = allBarLines.concat(staffBarLines);
        }

        return allBarLines;
    },

    // -------------------------------------------------------
    // PREAMBLE DETECTION — find where notes start (after clef/key/time)
    // -------------------------------------------------------
    _findNoteStartX: function(binary, width, staves) {
        var results = [];
        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            var sp = staff.spacing;
            var minSkip = Math.round(sp * 2.5);
            var maxSearch = Math.min(width, Math.round(sp * 8));
            var bestGap = minSkip;

            // Find the first significant gap in ink (end of preamble)
            var gapStart = -1, gapLen = 0;
            for (var x = minSkip; x < maxSearch; x++) {
                var ink = 0;
                for (var y = staff.top; y <= staff.bottom; y++) {
                    if (binary[y * width + x] === 1) ink++;
                }
                var staffH = staff.bottom - staff.top;
                if (ink < staffH * 0.1) {
                    if (gapStart === -1) gapStart = x;
                    gapLen++;
                    if (gapLen >= sp * 0.3) bestGap = gapStart + gapLen;
                } else {
                    gapStart = -1;
                    gapLen = 0;
                }
            }
            results.push(bestGap);
        }
        return results;
    },

    // -------------------------------------------------------
    // KEY SIGNATURE DETECTION — Audiveris KeyBuilder approach
    // -------------------------------------------------------
    detectKeySignature: function(binary, width, staves) {
        if (staves.length === 0) return { fifths: 0, accidentals: {} };
        var staff = staves[0];
        var sp = staff.spacing;
        var startX = Math.round(sp * 2.5);
        var endX = Math.round(sp * 6);
        var top = staff.top - Math.round(sp);
        var bot = staff.bottom + Math.round(sp);
        var imgH = Math.floor(binary.length / width);

        // X-axis projection in key signature region
        var cols = [];
        for (var x = startX; x < Math.min(width, endX); x++) {
            var ink = 0;
            for (var y = Math.max(0, top); y <= Math.min(bot, imgH - 1); y++) {
                if (binary[y * width + x] === 1) ink++;
            }
            cols.push(ink);
        }

        // Find ink clusters
        var inCl = false, clS = 0, clusters = [];
        var clThreshold = sp * 0.25;
        for (var i = 0; i < cols.length; i++) {
            if (cols[i] > clThreshold && !inCl) { inCl = true; clS = i; }
            else if (cols[i] <= clThreshold && inCl) {
                inCl = false;
                var w = i - clS;
                if (w > sp * 0.15 && w < sp * 2.0) {
                    clusters.push({ start: clS + startX, width: w, end: i + startX });
                }
            }
        }

        if (clusters.length === 0) return { fifths: 0, accidentals: {} };

        // Differentiate sharps vs flats by cluster width pattern
        // Sharps: ~2 narrow stems per accidental (wider overall)
        // Flats: ~1 stem per accidental (narrower)
        var avgClWidth = 0;
        for (var i = 0; i < clusters.length; i++) avgClWidth += clusters[i].width;
        avgClWidth /= clusters.length;

        // Count distinct accidental symbols
        // Sharp clusters are wider (~sp*0.8-1.4), flat clusters narrower (~sp*0.3-0.7)
        var isSharp = avgClWidth > sp * 0.6;
        var count = clusters.length;

        // For sharps, adjacent narrow clusters may be parts of same sharp
        if (isSharp && count > 1) {
            var mergedCount = 0;
            var i = 0;
            while (i < clusters.length) {
                mergedCount++;
                // Check if next cluster is very close (part of same sharp)
                if (i + 1 < clusters.length && clusters[i + 1].start - clusters[i].end < sp * 0.4) {
                    i += 2; // Skip paired cluster
                } else {
                    i++;
                }
            }
            count = mergedCount;
        }

        count = Math.min(count, 7);
        var fifths = isSharp ? count : -count;

        var acc = {};
        var so = ['F','C','G','D','A','E','B'], fo = ['B','E','A','D','G','C','F'];
        if (fifths > 0) { for (var i = 0; i < fifths; i++) acc[so[i]] = 1; }
        else if (fifths < 0) { for (var i = 0; i < -fifths; i++) acc[fo[i]] = -1; }

        return { fifths: fifths, accidentals: acc };
    },

    // -------------------------------------------------------
    // TIME SIGNATURE DETECTION
    // -------------------------------------------------------
    detectTimeSignature: function(binary, width, staves) {
        if (staves.length === 0) return { beats: 4, beatType: 4 };
        var staff = staves[0];
        var sp = staff.spacing;
        var startX = Math.round(sp * 4.5);
        var endX = Math.round(sp * 7.5);
        var midY = staff.center;

        // Check for ink in the time signature region
        var topInk = 0, botInk = 0;
        for (var x = startX; x < Math.min(width, endX); x++) {
            for (var y = staff.top; y < midY; y++) { if (binary[y * width + x] === 1) topInk++; }
            for (var y = midY; y <= staff.bottom; y++) { if (binary[y * width + x] === 1) botInk++; }
        }

        if (topInk < sp * 2 && botInk < sp * 2) return { beats: 4, beatType: 4 };

        // Horizontal crossing analysis at 25% and 75% of staff
        var crossY1 = Math.round(staff.top + (staff.bottom - staff.top) * 0.25);
        var crossY2 = Math.round(staff.top + (staff.bottom - staff.top) * 0.75);

        function countCrossings(yy) {
            var crossings = 0, prev = 0;
            for (var x = startX; x < Math.min(width, endX); x++) {
                var cur = binary[yy * width + x];
                if (cur === 1 && prev === 0) crossings++;
                prev = cur;
            }
            return crossings;
        }

        var topCross = countCrossings(crossY1);
        var botCross = countCrossings(crossY2);

        // Map crossings to number
        var topNum = topCross >= 4 ? 6 : (topCross >= 3 ? 4 : (topCross >= 2 ? 3 : 2));
        var botNum = botCross >= 3 ? 8 : 4;

        // Common time signatures
        if (topNum === 6 && botNum === 8) return { beats: 6, beatType: 8 };
        if (topNum === 3 && botNum === 8) return { beats: 3, beatType: 8 };
        if (topNum === 3 && botNum === 4) return { beats: 3, beatType: 4 };
        if (topNum === 2 && botNum === 4) return { beats: 2, beatType: 4 };
        if (topNum === 2 && botNum === 2) return { beats: 2, beatType: 2 };

        return { beats: topNum, beatType: botNum };
    },

    // -------------------------------------------------------
    // POSITION-BASED NOTEHEAD SCANNING
    // -------------------------------------------------------
    scanForNoteheads: function(binary, distTransform, width, height, staves, noteStartX) {
        var noteHeads = [];
        var filledTemplate = null, voidTemplate = null;

        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            var sp = staff.spacing;
            var halfSp = sp / 2;
            var startX = noteStartX ? noteStartX[s] : Math.round(sp * 3);

            if (!filledTemplate || Math.abs(filledTemplate.height - sp * 0.8) > 2) {
                filledTemplate = this._createNoteheadTemplate(sp, true);
                voidTemplate = this._createNoteheadTemplate(sp, false);
            }

            // Scan positions: -6 to +14 (covers ledger lines)
            for (var pos = -6; pos <= 14; pos++) {
                var pitchY = Math.round(staff.bottom - pos * halfSp);
                var step = Math.max(2, Math.round(sp * 0.25));

                for (var x = startX; x < width - Math.round(sp); x += step) {
                    // Quick ink check
                    var hasInk = false;
                    for (var dy = -Math.round(halfSp * 0.8); dy <= Math.round(halfSp * 0.8); dy++) {
                        var py = pitchY + dy;
                        if (py >= 0 && py < height && binary[py * width + x] === 1) { hasInk = true; break; }
                    }
                    if (!hasInk) continue;

                    var filledScore = this._evaluateTemplate(filledTemplate, x, pitchY, distTransform, width, height);
                    var voidScore = this._evaluateTemplate(voidTemplate, x, pitchY, distTransform, width, height);
                    var bestScore = Math.min(filledScore, voidScore);
                    var isFilled = filledScore <= voidScore;

                    if (bestScore < 0.35) {
                        // Duplicate check
                        var isDup = false;
                        for (var n = noteHeads.length - 1; n >= Math.max(0, noteHeads.length - 30); n--) {
                            var prev = noteHeads[n];
                            if (prev.staffIndex === s &&
                                Math.abs(prev.centerX - x) < sp * 0.5 &&
                                Math.abs(prev.centerY - pitchY) < halfSp * 0.7) {
                                if (bestScore < prev.matchScore) noteHeads.splice(n, 1);
                                else { isDup = true; }
                                break;
                            }
                        }
                        if (isDup) continue;

                        noteHeads.push({
                            centerX: x, centerY: pitchY,
                            minX: x - Math.round(sp * 0.7), maxX: x + Math.round(sp * 0.7),
                            minY: pitchY - Math.round(sp * 0.42), maxY: pitchY + Math.round(sp * 0.42),
                            width: Math.round(sp * 1.35), height: Math.round(sp * 0.8),
                            isFilled: isFilled, staffIndex: s, posIndex: pos,
                            matchScore: bestScore, pixels: Math.round(sp * sp * 0.5)
                        });
                    }
                }
            }
        }

        // Global dedup: sort by score, keep best at each grid position
        noteHeads.sort(function(a, b) { return a.matchScore - b.matchScore; });
        var filtered = [], used = {};
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            var key = nh.staffIndex + '_' + Math.round(nh.centerX / (staves[nh.staffIndex].spacing * 0.4)) + '_' + nh.posIndex;
            if (!used[key]) { used[key] = true; filtered.push(nh); }
        }
        return filtered;
    },

    // -------------------------------------------------------
    // STEM DETECTION — improved vertical line search
    // -------------------------------------------------------
    detectStems: function(noteHeads, binary, width, height, staves) {
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            var staff = staves[nh.staffIndex];
            var sp = staff.spacing;
            var stemLen = sp * 3;
            var minStemLen = sp * 1.8;
            var bestStemUp = 0, bestStemDown = 0;
            var stemX = -1;

            // Check both sides of notehead for stem
            var sides = [nh.maxX, nh.minX, nh.centerX + Math.round(sp * 0.5), nh.centerX - Math.round(sp * 0.5)];
            for (var si = 0; si < sides.length; si++) {
                var cx = sides[si];
                if (cx < 0 || cx >= width) continue;

                // Check upward
                var upCount = 0;
                for (var y = nh.minY - 1; y >= Math.max(0, nh.minY - stemLen); y--) {
                    var found = false;
                    for (var dx = -1; dx <= 1; dx++) {
                        var xx = cx + dx;
                        if (xx >= 0 && xx < width && binary[y * width + xx] === 1) { found = true; break; }
                    }
                    if (found) upCount++;
                    else if (upCount > 0) break; // stop at first gap
                }
                if (upCount > bestStemUp) { bestStemUp = upCount; }

                // Check downward
                var downCount = 0;
                for (var y = nh.maxY + 1; y <= Math.min(height - 1, nh.maxY + stemLen); y++) {
                    var found = false;
                    for (var dx = -1; dx <= 1; dx++) {
                        var xx = cx + dx;
                        if (xx >= 0 && xx < width && binary[y * width + xx] === 1) { found = true; break; }
                    }
                    if (found) downCount++;
                    else if (downCount > 0) break;
                }
                if (downCount > bestStemDown) { bestStemDown = downCount; }
            }

            nh.hasStem = bestStemUp >= minStemLen || bestStemDown >= minStemLen;
            if (bestStemUp >= minStemLen && bestStemDown >= minStemLen) {
                nh.stemDirection = bestStemUp > bestStemDown ? 'up' : 'down';
            } else {
                nh.stemDirection = bestStemUp >= minStemLen ? 'up' : (bestStemDown >= minStemLen ? 'down' : 'none');
            }
            nh.stemLength = Math.max(bestStemUp, bestStemDown);
        }
        return noteHeads;
    },

    // -------------------------------------------------------
    // FLAG DETECTION — improved region analysis
    // -------------------------------------------------------
    detectFlags: function(noteHeads, binary, width, height, staves) {
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            if (!nh.hasStem) { nh.flagCount = 0; continue; }
            var staff = staves[nh.staffIndex];
            var sp = staff.spacing;

            // Flag region is at the end of the stem, on the right side
            var stemEndY = nh.stemDirection === 'up'
                ? nh.minY - Math.round(nh.stemLength * 0.8)
                : nh.maxY + Math.round(nh.stemLength * 0.8);

            var flagRegionH = Math.round(sp * 1.5);
            var flagRegionW = Math.round(sp * 1.2);

            var fx = nh.centerX; // flags extend to the right from stem
            var yStart = Math.max(0, Math.min(stemEndY, stemEndY - flagRegionH));
            var yEnd = Math.min(height - 1, Math.max(stemEndY, stemEndY + flagRegionH));

            var flagPixels = 0, totalPixels = 0;
            for (var y = yStart; y <= yEnd; y++) {
                for (var x = fx; x < Math.min(width, fx + flagRegionW); x++) {
                    totalPixels++;
                    if (binary[y * width + x] === 1) flagPixels++;
                }
            }

            var density = totalPixels > 0 ? flagPixels / totalPixels : 0;

            // Check for multiple flag bands (16th, 32nd notes)
            if (density > 0.25) {
                // Count distinct horizontal bands of ink
                var bands = 0, inBand = false;
                for (var y = yStart; y <= yEnd; y++) {
                    var rowInk = 0;
                    for (var x = fx; x < Math.min(width, fx + flagRegionW); x++) {
                        if (binary[y * width + x] === 1) rowInk++;
                    }
                    if (rowInk > flagRegionW * 0.3) {
                        if (!inBand) { bands++; inBand = true; }
                    } else {
                        inBand = false;
                    }
                }
                nh.flagCount = Math.min(bands, 4); // cap at 4 (64th note)
                if (nh.flagCount === 0 && density > 0.15) nh.flagCount = 1;
            } else {
                nh.flagCount = 0;
            }
        }
        return noteHeads;
    },

    // -------------------------------------------------------
    // BEAM DETECTION — connect beamed notes
    // -------------------------------------------------------
    detectBeams: function(noteHeads, binary, width, height, staves) {
        for (var i = 0; i < noteHeads.length; i++) { noteHeads[i].beamCount = 0; noteHeads[i].beamGroup = -1; }

        var groupId = 0;

        for (var i = 0; i < noteHeads.length - 1; i++) {
            var a = noteHeads[i], b = noteHeads[i + 1];
            if (!a.hasStem || !b.hasStem || a.staffIndex !== b.staffIndex) continue;
            var staff = staves[a.staffIndex];
            var sp = staff.spacing;
            if (Math.abs(b.centerX - a.centerX) > sp * 5) continue;

            // Get stem endpoints
            var aEndY = a.stemDirection === 'up' ? a.minY - Math.round(a.stemLength * 0.7) : a.maxY + Math.round(a.stemLength * 0.7);
            var bEndY = b.stemDirection === 'up' ? b.minY - Math.round(b.stemLength * 0.7) : b.maxY + Math.round(b.stemLength * 0.7);

            var sx = Math.min(a.centerX, b.centerX);
            var ex = Math.max(a.centerX, b.centerX);
            if (ex - sx < sp * 0.3) continue;

            // Check for beam lines between stem endpoints
            var beamCount = 0;
            var searchH = Math.round(sp * 2);
            var midY = Math.round((aEndY + bEndY) / 2);
            var yFrom = Math.max(0, midY - searchH);
            var yTo = Math.min(height - 1, midY + searchH);

            // Scan for horizontal bands of high ink density
            var inBeam = false;
            for (var y = yFrom; y <= yTo; y++) {
                var ink = 0, total = ex - sx + 1;
                for (var x = sx; x <= ex; x++) {
                    if (x >= 0 && x < width && binary[y * width + x] === 1) ink++;
                }
                if (ink / total > 0.45) {
                    if (!inBeam) { beamCount++; inBeam = true; }
                } else {
                    inBeam = false;
                }
            }

            if (beamCount > 0) {
                beamCount = Math.min(beamCount, 4);
                a.beamCount = Math.max(a.beamCount, beamCount);
                b.beamCount = Math.max(b.beamCount, beamCount);

                // Assign beam group
                if (a.beamGroup >= 0) {
                    b.beamGroup = a.beamGroup;
                } else if (b.beamGroup >= 0) {
                    a.beamGroup = b.beamGroup;
                } else {
                    a.beamGroup = groupId;
                    b.beamGroup = groupId;
                    groupId++;
                }
            }
        }
        return noteHeads;
    },

    // -------------------------------------------------------
    // REST DETECTION — improved shape analysis
    // -------------------------------------------------------
    detectRests: function(binary, width, height, staves, noteStartX, barLines) {
        var rests = [];
        if (staves.length === 0) return rests;

        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            var sp = staff.spacing;
            var sx = noteStartX ? noteStartX[s] : Math.round(sp * 3);
            var staffRests = [];

            // Scan x positions looking for rest-shaped blobs
            var step = Math.round(sp * 0.4);
            for (var x = sx; x < width - sp; x += step) {
                // Count ink in a vertical column at staff center
                var centerInk = 0;
                for (var y = staff.top; y <= staff.bottom; y++) {
                    if (binary[y * width + x] === 1) centerInk++;
                }

                // Rest-like regions have moderate ink (not full barline, not empty)
                var staffH = staff.bottom - staff.top;
                if (centerInk < staffH * 0.15 || centerInk > staffH * 0.75) continue;

                // Analyze the shape more carefully
                var blobTop = -1, blobBot = -1;
                for (var y = staff.top - sp; y <= staff.bottom + sp; y++) {
                    if (y >= 0 && y < height && binary[y * width + x] === 1) {
                        if (blobTop === -1) blobTop = y;
                        blobBot = y;
                    }
                }
                if (blobTop === -1) continue;

                var blobH = blobBot - blobTop + 1;
                var blobCenterY = (blobTop + blobBot) / 2;

                // Measure horizontal extent
                var blobLeft = x, blobRight = x;
                for (var dx = 1; dx < sp * 2; dx++) {
                    if (x + dx < width) {
                        var col = 0;
                        for (var y = blobTop; y <= blobBot; y++) {
                            if (binary[y * width + x + dx] === 1) col++;
                        }
                        if (col > blobH * 0.15) blobRight = x + dx; else break;
                    }
                }
                for (var dx = 1; dx < sp * 2; dx++) {
                    if (x - dx >= 0) {
                        var col = 0;
                        for (var y = blobTop; y <= blobBot; y++) {
                            if (binary[y * width + x - dx] === 1) col++;
                        }
                        if (col > blobH * 0.15) blobLeft = x - dx; else break;
                    }
                }

                var blobW = blobRight - blobLeft + 1;
                var blobArea = 0;
                for (var by = blobTop; by <= blobBot; by++) {
                    for (var bx = blobLeft; bx <= blobRight; bx++) {
                        if (binary[by * width + bx] === 1) blobArea++;
                    }
                }
                var fillRatio = blobArea / (blobW * blobH);
                var aspectRatio = blobW / blobH;

                var restType = null, durValue = 0, mxlType = null;

                // Whole rest: wide rectangle hanging from line 3 (4th line from bottom)
                if (blobW > sp * 0.4 && blobW < sp * 2.0 && blobH > sp * 0.2 && blobH < sp * 0.7 &&
                    fillRatio > 0.65 && aspectRatio > 1.0 && blobCenterY < staff.center) {
                    restType = 'whole'; durValue = 4; mxlType = 'whole';
                }
                // Half rest: similar but sitting on line 2 (3rd line from bottom)
                else if (blobW > sp * 0.4 && blobW < sp * 2.0 && blobH > sp * 0.2 && blobH < sp * 0.7 &&
                    fillRatio > 0.65 && aspectRatio > 1.0 && blobCenterY >= staff.center) {
                    restType = 'half'; durValue = 2; mxlType = 'half';
                }
                // Quarter rest: tall zigzag, narrow
                else if (blobH > sp * 1.5 && blobH < sp * 4.0 && blobW < sp * 1.2 &&
                    fillRatio > 0.2 && fillRatio < 0.6 && aspectRatio < 0.7) {
                    restType = 'quarter'; durValue = 1; mxlType = 'quarter';
                }
                // Eighth rest: curved, shorter
                else if (blobH > sp * 0.7 && blobH < sp * 2.0 && blobW < sp * 1.0 &&
                    fillRatio > 0.15 && fillRatio < 0.55 && aspectRatio < 0.9) {
                    restType = 'eighth'; durValue = 0.5; mxlType = 'eighth';
                }

                if (restType) {
                    // Check not duplicate
                    var dup = false;
                    for (var r = 0; r < staffRests.length; r++) {
                        if (Math.abs(staffRests[r].centerX - x) < sp * 1.0) { dup = true; break; }
                    }
                    if (!dup) {
                        staffRests.push({
                            type: restType, durationValue: durValue, mxlType: mxlType,
                            centerX: Math.round((blobLeft + blobRight) / 2),
                            centerY: Math.round(blobCenterY),
                            staffIndex: s, isRest: true
                        });
                        x = blobRight + Math.round(sp * 0.5); // skip past this rest
                    }
                }
            }
            rests = rests.concat(staffRests);
        }
        return rests;
    },

    // -------------------------------------------------------
    // DURATION CLASSIFICATION
    // -------------------------------------------------------
    classifyDuration: function(noteHeads) {
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            var flags = Math.max(nh.flagCount || 0, nh.beamCount || 0);

            if (!nh.isFilled && !nh.hasStem) {
                nh.duration = 'whole'; nh.durationValue = 4; nh.mxlType = 'whole';
            } else if (!nh.isFilled && nh.hasStem) {
                nh.duration = 'half'; nh.durationValue = 2; nh.mxlType = 'half';
            } else if (nh.isFilled && nh.hasStem) {
                if (flags >= 3) { nh.duration = '32nd'; nh.durationValue = 0.125; nh.mxlType = '32nd'; }
                else if (flags >= 2) { nh.duration = '16th'; nh.durationValue = 0.25; nh.mxlType = '16th'; }
                else if (flags >= 1) { nh.duration = 'eighth'; nh.durationValue = 0.5; nh.mxlType = 'eighth'; }
                else { nh.duration = 'quarter'; nh.durationValue = 1; nh.mxlType = 'quarter'; }
            } else {
                nh.duration = 'quarter'; nh.durationValue = 1; nh.mxlType = 'quarter';
            }
        }
        return noteHeads;
    },

    // -------------------------------------------------------
    // PITCH ASSIGNMENT
    // -------------------------------------------------------
    assignPitch: function(noteHeads, staves, keySig) {
        var acc = (keySig && keySig.accidentals) ? keySig.accidentals : {};
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            var staff = staves[nh.staffIndex];
            var pitches = (staff.clef === 'bass') ? this.BASS_PITCHES : this.TREBLE_PITCHES;
            var posIndex = nh.posIndex;
            var pitch;

            if (posIndex >= 0 && posIndex < pitches.length) {
                pitch = { step: pitches[posIndex].s, octave: pitches[posIndex].o };
            } else {
                var steps = this.STEPS;
                var ref = posIndex >= pitches.length ? pitches[pitches.length - 1] : pitches[0];
                var count = posIndex >= pitches.length ? posIndex - pitches.length + 1 : Math.abs(posIndex);
                var dir = posIndex >= 0 ? 1 : -1;
                var si = steps.indexOf(ref.s);
                var oct = ref.o;
                for (var e = 0; e < count; e++) {
                    si += dir;
                    if (si >= 7) { si = 0; oct++; }
                    if (si < 0) { si = 6; oct--; }
                }
                pitch = { step: steps[si], octave: oct };
            }
            pitch.alter = acc[pitch.step] || 0;
            nh.pitch = pitch;
            nh.midiNote = this.noteToMidi(pitch.step, pitch.octave, pitch.alter);
            nh.pitchName = pitch.step + (pitch.alter === 1 ? '#' : (pitch.alter === -1 ? 'b' : '')) + pitch.octave;
        }
        return noteHeads;
    },

    // -------------------------------------------------------
    // ORGANIZE NOTES INTO MEASURES (using barlines!)
    // -------------------------------------------------------
    organizeNotes: function(noteHeads, staves, barLines, rests, timeSig) {
        var beats = timeSig ? timeSig.beats : 4;
        var beatType = timeSig ? timeSig.beatType : 4;
        var measureDuration = beats * (4 / beatType); // in quarter note units

        // Get barline positions per staff
        var staffBarPositions = {};
        for (var s = 0; s < staves.length; s++) staffBarPositions[s] = [0]; // start at 0
        for (var b = 0; b < barLines.length; b++) {
            var bl = barLines[b];
            staffBarPositions[bl.staffIndex].push(bl.x);
        }
        // Add end-of-page position
        for (var s = 0; s < staves.length; s++) {
            staffBarPositions[s].push(99999);
            staffBarPositions[s].sort(function(a, b) { return a - b; });
        }

        // Combine all events (notes + rests) and sort by system then x
        var allEvents = [];

        // Group noteheads into chords first
        var sortedHeads = noteHeads.slice().sort(function(a, b) {
            var sA = staves[a.staffIndex].systemIndex || 0;
            var sB = staves[b.staffIndex].systemIndex || 0;
            if (sA !== sB) return sA - sB;
            return a.centerX - b.centerX;
        });

        var i = 0;
        while (i < sortedHeads.length) {
            var chord = [sortedHeads[i]];
            var j = i + 1;
            var sp = staves[sortedHeads[i].staffIndex].spacing;
            while (j < sortedHeads.length &&
                   (staves[sortedHeads[j].staffIndex].systemIndex || 0) === (staves[sortedHeads[i].staffIndex].systemIndex || 0) &&
                   Math.abs(sortedHeads[j].centerX - sortedHeads[i].centerX) < sp * 1.2) {
                chord.push(sortedHeads[j]);
                j++;
            }
            var minDur = 4;
            for (var c = 0; c < chord.length; c++) {
                if (chord[c].durationValue < minDur) minDur = chord[c].durationValue;
            }
            allEvents.push({
                notes: chord, isRest: false, x: chord[0].centerX,
                staffIndex: chord[0].staffIndex,
                systemIndex: staves[chord[0].staffIndex].systemIndex || 0,
                durationValue: minDur, duration: chord[0].duration, mxlType: chord[0].mxlType
            });
            i = j;
        }

        // Add rests
        for (var r = 0; r < rests.length; r++) {
            allEvents.push({
                notes: [], isRest: true, restType: rests[r].type, x: rests[r].centerX,
                staffIndex: rests[r].staffIndex,
                systemIndex: staves[rests[r].staffIndex].systemIndex || 0,
                durationValue: rests[r].durationValue, duration: rests[r].type, mxlType: rests[r].mxlType
            });
        }

        // Sort all events by system, then by x position
        allEvents.sort(function(a, b) {
            if (a.systemIndex !== b.systemIndex) return a.systemIndex - b.systemIndex;
            return a.x - b.x;
        });

        // Assign events to measures based on barline positions
        for (var e = 0; e < allEvents.length; e++) {
            var evt = allEvents[e];
            var bars = staffBarPositions[evt.staffIndex] || [0, 99999];

            // Find which measure this event falls in
            var measureNum = 0;
            for (var m = 0; m < bars.length - 1; m++) {
                if (evt.x >= bars[m] && evt.x < bars[m + 1]) {
                    measureNum = m;
                    break;
                }
            }

            // Calculate global measure number (across systems)
            var sysOffset = 0;
            if (evt.systemIndex > 0) {
                // Count measures in previous systems
                for (var prevSys = 0; prevSys < evt.systemIndex; prevSys++) {
                    // Find a staff in this system
                    for (var ss = 0; ss < staves.length; ss++) {
                        if ((staves[ss].systemIndex || 0) === prevSys) {
                            sysOffset += Math.max(1, (staffBarPositions[ss] || [0, 99999]).length - 2);
                            break;
                        }
                    }
                }
            }

            evt.measureIndex = sysOffset + measureNum;
            evt.measureLocalX = bars[measureNum] || 0;
            evt.measureWidth = (bars[measureNum + 1] || 99999) - (bars[measureNum] || 0);
        }

        return allEvents;
    },

    // -------------------------------------------------------
    // MAIN PIPELINE v5.0
    // -------------------------------------------------------
    detect: function(cleanedBinary, originalBinary, width, height, staves) {
        var distTransform = this.computeDistanceTransform(originalBinary, width, height);
        var keySig = this.detectKeySignature(originalBinary, width, staves);
        var timeSig = this.detectTimeSignature(originalBinary, width, staves);
        var noteStartX = this._findNoteStartX(originalBinary, width, staves);
        var noteHeads = this.scanForNoteheads(originalBinary, distTransform, width, height, staves, noteStartX);

        noteHeads = this.detectStems(noteHeads, originalBinary, width, height, staves);
        noteHeads = this.detectFlags(noteHeads, originalBinary, width, height, staves);
        noteHeads = this.detectBeams(noteHeads, originalBinary, width, height, staves);
        noteHeads = this.classifyDuration(noteHeads);
        noteHeads = this.assignPitch(noteHeads, staves, keySig);

        var barLines = this.detectBarLines(originalBinary, width, height, staves);
        var rests = this.detectRests(cleanedBinary, width, height, staves, noteStartX, barLines);
        var events = this.organizeNotes(noteHeads, staves, barLines, rests, timeSig);

        return { noteHeads: noteHeads, events: events, rests: rests, barLines: barLines, keySignature: keySig, timeSignature: timeSig };
    }
};

// =====================================================
// MUSICXML WRITER v5.0 — Proper timing, voices, measures
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
        var divisions = 16; // Fine granularity: supports up to 64th notes

        // Determine staves per system for grand staff
        var stavesPerSystem = 1;
        for (var i = 0; i < staves.length; i++) {
            if (staves[i].systemStaffCount > stavesPerSystem) stavesPerSystem = staves[i].systemStaffCount;
        }

        var xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n';
        xml += '<score-partwise version="4.0">\n';
        xml += '  <work><work-title>' + this._escapeXml(title) + '</work-title></work>\n';
        xml += '  <identification><creator type="composer">PianoMode OCR</creator>';
        xml += '<encoding><software>PianoMode OMR v5.0</software>';
        xml += '<encoding-date>' + new Date().toISOString().slice(0, 10) + '</encoding-date></encoding></identification>\n';

        xml += '  <part-list>\n';
        xml += '    <score-part id="P1"><part-name>Piano</part-name>';
        xml += '<midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument>';
        xml += '</score-part>\n';
        xml += '  </part-list>\n';
        xml += '  <part id="P1">\n';

        // Group events by measure
        var measureGroups = {};
        for (var i = 0; i < events.length; i++) {
            var mi = events[i].measureIndex || 0;
            if (!measureGroups[mi]) measureGroups[mi] = [];
            measureGroups[mi].push(events[i]);
        }

        var measureKeys = Object.keys(measureGroups).map(Number).sort(function(a, b) { return a - b; });
        if (measureKeys.length === 0) measureKeys = [0];

        var divsPerMeasure = divisions * beats * (4 / beatType) / 4 * 4;
        // Simplify: divisions=16, quarter note=16 divs
        // divsPerMeasure = beats * (4/beatType) * divisions
        divsPerMeasure = Math.round(beats * (4 / beatType) * divisions);

        for (var mi = 0; mi < measureKeys.length; mi++) {
            var measureNum = mi + 1;
            var measureEvents = measureGroups[measureKeys[mi]] || [];

            xml += '    <measure number="' + measureNum + '">\n';

            if (mi === 0) {
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

            if (measureEvents.length === 0) {
                xml += '      <note><rest/><duration>' + divsPerMeasure + '</duration><type>whole</type>';
                if (stavesPerSystem >= 2) xml += '<staff>1</staff>';
                xml += '</note>\n';
            } else {
                // Separate events by staff for voice assignment
                var staff1Events = [];
                var staff2Events = [];

                for (var e = 0; e < measureEvents.length; e++) {
                    var evt = measureEvents[e];
                    var staffNum = (staves[evt.staffIndex] && staves[evt.staffIndex].staffInSystem === 1) ? 2 : 1;
                    if (staffNum === 2) staff2Events.push(evt);
                    else staff1Events.push(evt);
                }

                // Write voice 1 (staff 1)
                xml += this._writeVoiceEvents(staff1Events, 1, 1, divisions, divsPerMeasure, stavesPerSystem);

                // Write voice 2 (staff 2) with backup
                if (stavesPerSystem >= 2 && staff2Events.length > 0) {
                    xml += '      <backup><duration>' + divsPerMeasure + '</duration></backup>\n';
                    xml += this._writeVoiceEvents(staff2Events, 2, 2, divisions, divsPerMeasure, stavesPerSystem);
                }
            }

            xml += '    </measure>\n';
        }

        xml += '  </part>\n</score-partwise>\n';
        return xml;
    },

    _writeVoiceEvents: function(events, voice, staffNum, divisions, divsPerMeasure, stavesPerSystem) {
        var xml = '';
        var currentTime = 0;

        // Sort events by x position
        events.sort(function(a, b) { return a.x - b.x; });

        // Calculate proportional time positions within measure
        if (events.length > 0) {
            var minX = events[0].measureLocalX || events[0].x;
            var measureW = events[0].measureWidth || 1;

            for (var e = 0; e < events.length; e++) {
                var evt = events[e];
                var dur = this._durationToDivisions(evt.durationValue, divisions);

                // Ensure we don't exceed measure
                if (currentTime + dur > divsPerMeasure) {
                    dur = divsPerMeasure - currentTime;
                    if (dur <= 0) break;
                }

                if (evt.isRest) {
                    xml += '      <note><rest/><duration>' + dur + '</duration>';
                    xml += '<voice>' + voice + '</voice>';
                    xml += '<type>' + (evt.mxlType || 'quarter') + '</type>';
                    if (stavesPerSystem >= 2) xml += '<staff>' + staffNum + '</staff>';
                    xml += '</note>\n';
                } else {
                    for (var n = 0; n < evt.notes.length; n++) {
                        var note = evt.notes[n];
                        xml += '      <note>';
                        if (n > 0) xml += '<chord/>';
                        xml += '<pitch><step>' + note.pitch.step + '</step>';
                        if (note.pitch.alter) xml += '<alter>' + note.pitch.alter + '</alter>';
                        xml += '<octave>' + note.pitch.octave + '</octave></pitch>';
                        xml += '<duration>' + dur + '</duration>';
                        xml += '<voice>' + voice + '</voice>';
                        xml += '<type>' + (evt.mxlType || 'quarter') + '</type>';
                        if (stavesPerSystem >= 2) xml += '<staff>' + staffNum + '</staff>';
                        xml += '</note>\n';
                    }
                }
                currentTime += dur;
            }
        }

        // Fill remaining time with rest
        if (currentTime < divsPerMeasure) {
            var remaining = divsPerMeasure - currentTime;
            xml += '      <note><rest/><duration>' + remaining + '</duration>';
            xml += '<voice>' + voice + '</voice>';
            xml += '<type>' + this._divisionsToType(remaining, divisions) + '</type>';
            if (stavesPerSystem >= 2) xml += '<staff>' + staffNum + '</staff>';
            xml += '</note>\n';
        }

        return xml;
    },

    _escapeXml: function(str) { return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },

    _durationToDivisions: function(dv, div) {
        // dv is in quarter-note units: 4=whole, 2=half, 1=quarter, 0.5=eighth, etc.
        return Math.max(1, Math.round(dv * div));
    },

    _divisionsToType: function(divs, divisions) {
        var ratio = divs / divisions;
        if (ratio >= 4) return 'whole';
        if (ratio >= 2) return 'half';
        if (ratio >= 1) return 'quarter';
        if (ratio >= 0.5) return 'eighth';
        if (ratio >= 0.25) return '16th';
        return '32nd';
    }
};


// =====================================================
// MIDI WRITER v5.0 — Fixed delta times and rest handling
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

        // Build a timeline of note-on and note-off events
        var timeline = [];
        var currentTick = 0;

        for (var i = 0; i < events.length; i++) {
            var evt = events[i];
            var durationTicks = Math.max(1, Math.round(evt.durationValue * ppq));

            if (evt.isRest || !evt.notes || evt.notes.length === 0) {
                // Rest: advance time without playing
                currentTick += durationTicks;
                continue;
            }

            // Note on events at currentTick
            for (var n = 0; n < evt.notes.length; n++) {
                var midi = evt.notes[n].midiNote;
                if (midi < 0 || midi > 127) continue;
                timeline.push({ tick: currentTick, type: 'on', midi: midi, velocity: velocity });
                timeline.push({ tick: currentTick + durationTicks, type: 'off', midi: midi, velocity: 0 });
            }

            currentTick += durationTicks;
        }

        // Sort timeline: note-off before note-on at same tick
        timeline.sort(function(a, b) {
            if (a.tick !== b.tick) return a.tick - b.tick;
            if (a.type !== b.type) return a.type === 'off' ? -1 : 1;
            return a.midi - b.midi;
        });

        // Convert timeline to MIDI events with delta times
        var prevTick = 0;
        for (var t = 0; t < timeline.length; t++) {
            var te = timeline[t];
            var delta = te.tick - prevTick;
            this._pushVLQ(trackData, delta);

            if (te.type === 'on') {
                trackData.push(0x90 | channel, te.midi & 0x7F, te.velocity & 0x7F);
            } else {
                trackData.push(0x80 | channel, te.midi & 0x7F, 0x00);
            }
            prevTick = te.tick;
        }

        // End of track
        trackData.push(0x00, 0xFF, 0x2F, 0x00);

        // Build MIDI file
        var midi = [];
        midi.push(0x4D, 0x54, 0x68, 0x64); // MThd
        midi.push(0x00, 0x00, 0x00, 0x06);
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
// MAIN ENGINE ORCHESTRATOR (async steps)
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
            onProgress(2, 'Binarizing image...', 28);
            var t = PianoModeOMR.ImageProcessor.otsuThreshold(loaded._gray);
            loaded._binary = PianoModeOMR.ImageProcessor.binarize(loaded._gray, t);
            return self._yield().then(function() { return loaded; });
        }).then(function(loaded) {
            onProgress(2, 'Detecting staff lines...', 35);
            var staves = PianoModeOMR.StaffDetector.detect(loaded._binary, loaded.width, loaded.height);
            if (staves.length === 0) throw new Error('No staff lines detected. Use a clear, high-resolution image.');
            staves = PianoModeOMR.StaffDetector.groupIntoSystems(staves);
            staves = PianoModeOMR.StaffDetector.detectClefs(loaded._binary, loaded.width, staves);
            var systemCount = 0;
            for (var i = 0; i < staves.length; i++) { if ((staves[i].systemIndex || 0) > systemCount) systemCount = staves[i].systemIndex; }
            onProgress(2, staves.length + ' staves in ' + (systemCount + 1) + ' system(s)', 42);
            loaded._staves = staves;
            return self._yield().then(function() { return loaded; });
        }).then(function(loaded) {
            onProgress(2, 'Removing staff lines...', 48);
            loaded._cleaned = PianoModeOMR.StaffDetector.removeStaffLines(loaded._binary, loaded.width, loaded.height, loaded._staves);
            return self._yield().then(function() { return loaded; });
        }).then(function(loaded) {
            onProgress(2, 'Computing distance transform...', 52);
            return self._yield().then(function() { return loaded; });
        }).then(function(loaded) {
            onProgress(3, 'Detecting notes & barlines...', 58);
            return self._yield().then(function() {
                loaded._result = PianoModeOMR.NoteDetector.detect(loaded._cleaned, loaded._binary, loaded.width, loaded.height, loaded._staves);
                return loaded;
            });
        }).then(function(loaded) {
            var result = loaded._result;
            onProgress(3, 'Analyzing results...', 75);
            if (result.events.length === 0) throw new Error('No notes detected. The image may be too low quality.');
            var nc = 0, rc = 0;
            for (var e = 0; e < result.events.length; e++) {
                if (result.events[e].isRest) rc++; else nc += result.events[e].notes.length;
            }
            onProgress(3, nc + ' notes, ' + rc + ' rests, ' + result.barLines.length + ' barlines', 80);
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
            loaded._musicxml = musicxml;
            loaded._title = title;
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

console.log('[PianoModeOMR] Engine v5.0 loaded — all modules ready');
})();
