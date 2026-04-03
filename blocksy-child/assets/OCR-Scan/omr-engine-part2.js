/**
 * PianoMode OMR Engine - Part 2: Note Detection & Classification
 * Connected component analysis, notehead detection, pitch assignment
 *
 * @package PianoMode
 * @version 1.0.0
 */

window.PianoModeOMR = window.PianoModeOMR || {};

// =====================================================
// NOTE DETECTOR
// =====================================================
PianoModeOMR.NoteDetector = {

    /**
     * Pitch names for treble clef positions (bottom line = E4 up)
     * Index 0 = bottom line (line 1), each +1 = one staff position up
     */
    TREBLE_PITCHES: [
        { step: 'E', octave: 4 }, // line 1
        { step: 'F', octave: 4 }, // space
        { step: 'G', octave: 4 }, // line 2
        { step: 'A', octave: 4 }, // space
        { step: 'B', octave: 4 }, // line 3
        { step: 'C', octave: 5 }, // space
        { step: 'D', octave: 5 }, // line 4
        { step: 'E', octave: 5 }, // space
        { step: 'F', octave: 5 }, // line 5
        { step: 'G', octave: 5 }, // above line 5
        { step: 'A', octave: 5 }, // above
        { step: 'B', octave: 5 }, // above
        { step: 'C', octave: 6 }  // above
    ],

    BASS_PITCHES: [
        { step: 'G', octave: 2 }, // line 1
        { step: 'A', octave: 2 }, // space
        { step: 'B', octave: 2 }, // line 2
        { step: 'C', octave: 3 }, // space
        { step: 'D', octave: 3 }, // line 3
        { step: 'E', octave: 3 }, // space
        { step: 'F', octave: 3 }, // line 4
        { step: 'G', octave: 3 }, // space
        { step: 'A', octave: 3 }, // line 5
        { step: 'B', octave: 3 }, // above
        { step: 'C', octave: 4 }, // above (middle C)
        { step: 'D', octave: 4 }, // above
        { step: 'E', octave: 4 }  // above
    ],

    // Extend pitches below bottom line
    TREBLE_BELOW: [
        { step: 'D', octave: 4 },
        { step: 'C', octave: 4 }, // middle C (ledger line)
        { step: 'B', octave: 3 },
        { step: 'A', octave: 3 }
    ],

    BASS_BELOW: [
        { step: 'F', octave: 2 },
        { step: 'E', octave: 2 },
        { step: 'D', octave: 2 },
        { step: 'C', octave: 2 }
    ],

    /**
     * MIDI note number lookup
     */
    noteToMidi: function(step, octave) {
        var semitones = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };
        return 12 * (octave + 1) + (semitones[step] || 0);
    },

    /**
     * Find connected components (blobs) in binary image
     * Uses two-pass labeling algorithm for efficiency
     */
    findBlobs: function(binary, width, height) {
        var labels = new Int32Array(binary.length);
        var nextLabel = 1;
        var equivalences = {}; // union-find

        function find(x) {
            while (equivalences[x] && equivalences[x] !== x) x = equivalences[x];
            return x;
        }
        function union(a, b) {
            a = find(a);
            b = find(b);
            if (a !== b) equivalences[Math.max(a, b)] = Math.min(a, b);
        }

        // Pass 1: assign provisional labels
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
                    for (var n = 0; n < neighbors.length; n++) {
                        union(minLabel, neighbors[n]);
                    }
                }
            }
        }

        // Pass 2: resolve equivalences
        var blobs = {};
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var idx = y * width + x;
                if (labels[idx] === 0) continue;
                var resolved = find(labels[idx]);
                labels[idx] = resolved;

                if (!blobs[resolved]) {
                    blobs[resolved] = {
                        id: resolved,
                        minX: x, maxX: x,
                        minY: y, maxY: y,
                        pixels: 0
                    };
                }
                var b = blobs[resolved];
                if (x < b.minX) b.minX = x;
                if (x > b.maxX) b.maxX = x;
                if (y < b.minY) b.minY = y;
                if (y > b.maxY) b.maxY = y;
                b.pixels++;
            }
        }

        // Convert to array and add computed properties
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
     * Filter blobs to find note head candidates
     */
    filterNoteHeads: function(blobs, staves) {
        if (staves.length === 0) return [];

        var avgSpacing = 0;
        for (var i = 0; i < staves.length; i++) avgSpacing += staves[i].spacing;
        avgSpacing /= staves.length;

        var minSize = avgSpacing * 0.4;
        var maxSize = avgSpacing * 2.5;
        var noteHeads = [];

        for (var i = 0; i < blobs.length; i++) {
            var b = blobs[i];

            // Size filter: note heads are roughly 1 staff-space wide/tall
            if (b.width < minSize || b.height < minSize) continue;
            if (b.width > maxSize || b.height > maxSize) continue;

            // Aspect ratio: note heads are roughly circular to slightly wide
            if (b.aspectRatio < 0.4 || b.aspectRatio > 3.0) continue;

            // Minimum pixel count
            if (b.pixels < minSize * minSize * 0.3) continue;

            // Must be within or near a staff
            var nearStaff = false;
            for (var s = 0; s < staves.length; s++) {
                var staff = staves[s];
                var margin = staff.spacing * 4; // allow ledger lines
                if (b.centerY >= staff.top - margin && b.centerY <= staff.bottom + margin) {
                    nearStaff = true;
                    b.staffIndex = s;
                    break;
                }
            }
            if (!nearStaff) continue;

            // Classify as filled or open
            b.isFilled = b.fillRatio > 0.55;
            noteHeads.push(b);
        }

        return noteHeads;
    },

    /**
     * Detect if a notehead has a stem (vertical line attached)
     */
    detectStems: function(noteHeads, binary, width, height, staves) {
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            var staff = staves[nh.staffIndex];
            var stemLength = staff.spacing * 2.5;
            var hasStemUp = false, hasStemDown = false;

            // Check above the notehead for stem
            var checkX = nh.maxX; // stems are usually on the right
            var blackCount = 0;
            for (var y = nh.minY - 1; y >= Math.max(0, nh.minY - stemLength); y--) {
                // Check a narrow column (3px wide)
                var found = false;
                for (var dx = -1; dx <= 1; dx++) {
                    var cx = checkX + dx;
                    if (cx >= 0 && cx < width && binary[y * width + cx] === 1) {
                        found = true;
                        break;
                    }
                }
                if (found) blackCount++;
            }
            if (blackCount > stemLength * 0.5) hasStemUp = true;

            // Check below
            checkX = nh.maxX;
            blackCount = 0;
            for (var y = nh.maxY + 1; y <= Math.min(height - 1, nh.maxY + stemLength); y++) {
                var found = false;
                for (var dx = -1; dx <= 1; dx++) {
                    var cx = checkX + dx;
                    if (cx >= 0 && cx < width && binary[y * width + cx] === 1) {
                        found = true;
                        break;
                    }
                }
                if (found) blackCount++;
            }
            if (blackCount > stemLength * 0.5) hasStemDown = true;

            // Also check left side for stems
            if (!hasStemUp && !hasStemDown) {
                checkX = nh.minX;
                blackCount = 0;
                for (var y = nh.minY - 1; y >= Math.max(0, nh.minY - stemLength); y--) {
                    var found = false;
                    for (var dx = -1; dx <= 1; dx++) {
                        var cx = checkX + dx;
                        if (cx >= 0 && cx < width && binary[y * width + cx] === 1) {
                            found = true;
                            break;
                        }
                    }
                    if (found) blackCount++;
                }
                if (blackCount > stemLength * 0.5) hasStemUp = true;

                if (!hasStemUp) {
                    blackCount = 0;
                    for (var y = nh.maxY + 1; y <= Math.min(height - 1, nh.maxY + stemLength); y++) {
                        var found = false;
                        for (var dx = -1; dx <= 1; dx++) {
                            var cx = checkX + dx;
                            if (cx >= 0 && cx < width && binary[y * width + cx] === 1) {
                                found = true;
                                break;
                            }
                        }
                        if (found) blackCount++;
                    }
                    if (blackCount > stemLength * 0.5) hasStemDown = true;
                }
            }

            nh.hasStem = hasStemUp || hasStemDown;
            nh.stemDirection = hasStemUp ? 'up' : (hasStemDown ? 'down' : 'none');
        }
        return noteHeads;
    },

    /**
     * Detect flags on stems (indicates eighth, sixteenth notes)
     * Flags are small ink blobs at the end of a stem, opposite the notehead
     */
    detectFlags: function(noteHeads, binary, width, height, staves) {
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            if (!nh.hasStem) { nh.flagCount = 0; continue; }

            var staff = staves[nh.staffIndex];
            var flagZoneSize = Math.round(staff.spacing * 1.2);
            var flagCount = 0;

            // Flag is at the opposite end of the stem from the notehead
            var stemEndY, stemX;
            if (nh.stemDirection === 'up') {
                stemEndY = nh.minY - Math.round(staff.spacing * 2.5);
                stemX = nh.maxX;
            } else {
                stemEndY = nh.maxY + Math.round(staff.spacing * 2.5);
                stemX = nh.maxX;
            }

            // Count ink density in the flag zone (right side of stem end)
            var flagPixels = 0;
            var totalPixels = 0;
            var yStart = Math.max(0, Math.min(stemEndY, stemEndY + flagZoneSize) - 2);
            var yEnd = Math.min(height - 1, Math.max(stemEndY, stemEndY + flagZoneSize) + 2);

            for (var y = yStart; y <= yEnd; y++) {
                for (var x = stemX; x < Math.min(width, stemX + flagZoneSize); x++) {
                    totalPixels++;
                    if (binary[y * width + x] === 1) flagPixels++;
                }
            }

            var flagDensity = totalPixels > 0 ? flagPixels / totalPixels : 0;

            // One flag = eighth note, two flags = sixteenth
            if (flagDensity > 0.15) {
                flagCount = 1;
                // Check for second flag (higher density = 2 flags)
                if (flagDensity > 0.3) flagCount = 2;
            }

            nh.flagCount = flagCount;
        }
        return noteHeads;
    },

    /**
     * Detect beams connecting stems (thick horizontal lines between stem ends)
     * Beamed notes are typically eighth or sixteenth notes
     */
    detectBeams: function(noteHeads, binary, width, height, staves) {
        // Group noteheads by staff and check for horizontal beam connections
        for (var i = 0; i < noteHeads.length; i++) {
            noteHeads[i].beamCount = 0;
        }

        for (var i = 0; i < noteHeads.length - 1; i++) {
            var nh1 = noteHeads[i];
            var nh2 = noteHeads[i + 1];

            if (!nh1.hasStem || !nh2.hasStem) continue;
            if (nh1.staffIndex !== nh2.staffIndex) continue;

            var staff = staves[nh1.staffIndex];
            var maxGap = staff.spacing * 5; // max horizontal gap between beamed notes
            if (Math.abs(nh2.centerX - nh1.centerX) > maxGap) continue;

            // Check for beam: thick horizontal line connecting stem tips
            var stemEnd1Y, stemEnd2Y;
            if (nh1.stemDirection === 'up') {
                stemEnd1Y = nh1.minY - Math.round(staff.spacing * 2);
            } else {
                stemEnd1Y = nh1.maxY + Math.round(staff.spacing * 2);
            }
            if (nh2.stemDirection === 'up') {
                stemEnd2Y = nh2.minY - Math.round(staff.spacing * 2);
            } else {
                stemEnd2Y = nh2.maxY + Math.round(staff.spacing * 2);
            }

            // Scan for horizontal black pixels between the two stem tops
            var beamY = Math.round((stemEnd1Y + stemEnd2Y) / 2);
            var startX = Math.min(nh1.centerX, nh2.centerX);
            var endX = Math.max(nh1.centerX, nh2.centerX);
            var beamPixels = 0;
            var totalScan = 0;

            for (var dy = -2; dy <= 2; dy++) {
                var y = beamY + dy;
                if (y < 0 || y >= height) continue;
                for (var x = startX; x <= endX; x++) {
                    totalScan++;
                    if (binary[y * width + x] === 1) beamPixels++;
                }
            }

            var beamRatio = totalScan > 0 ? beamPixels / totalScan : 0;
            if (beamRatio > 0.4) {
                // Beam detected
                nh1.beamCount = Math.max(nh1.beamCount, 1);
                nh2.beamCount = Math.max(nh2.beamCount, 1);

                // Check for double beam (sixteenth notes)
                var beam2Y = beamY + (nh1.stemDirection === 'up' ? Math.round(staff.spacing * 0.5) : -Math.round(staff.spacing * 0.5));
                var beam2Pixels = 0;
                var total2 = 0;
                for (var dy = -1; dy <= 1; dy++) {
                    var y = beam2Y + dy;
                    if (y < 0 || y >= height) continue;
                    for (var x = startX; x <= endX; x++) {
                        total2++;
                        if (binary[y * width + x] === 1) beam2Pixels++;
                    }
                }
                if (total2 > 0 && beam2Pixels / total2 > 0.4) {
                    nh1.beamCount = Math.max(nh1.beamCount, 2);
                    nh2.beamCount = Math.max(nh2.beamCount, 2);
                }
            }
        }
        return noteHeads;
    },

    /**
     * Detect rests in the cleaned binary image
     * Returns array of rest objects with position and type
     */
    detectRests: function(blobs, staves, width) {
        var rests = [];
        if (staves.length === 0) return rests;

        var avgSpacing = 0;
        for (var i = 0; i < staves.length; i++) avgSpacing += staves[i].spacing;
        avgSpacing /= staves.length;

        for (var i = 0; i < blobs.length; i++) {
            var b = blobs[i];

            // Rests are typically taller than wide (except whole/half rests)
            // and positioned within the staff
            var nearStaff = -1;
            for (var s = 0; s < staves.length; s++) {
                var staff = staves[s];
                if (b.centerY >= staff.top - staff.spacing && b.centerY <= staff.bottom + staff.spacing) {
                    nearStaff = s;
                    break;
                }
            }
            if (nearStaff === -1) continue;

            var staff = staves[nearStaff];

            // Whole rest: small rectangular blob sitting below line 4
            // Half rest: small rectangular blob sitting on line 3
            if (b.width > avgSpacing * 0.5 && b.width < avgSpacing * 2 &&
                b.height > avgSpacing * 0.2 && b.height < avgSpacing * 0.8 &&
                b.fillRatio > 0.7 && b.aspectRatio > 1.2) {

                var restType, durValue;
                // If center is above staff center → half rest, below → whole rest
                if (b.centerY < staff.center) {
                    restType = 'half'; durValue = 2;
                } else {
                    restType = 'whole'; durValue = 4;
                }

                rests.push({
                    type: restType,
                    durationValue: durValue,
                    mxlType: restType,
                    centerX: b.centerX,
                    centerY: b.centerY,
                    staffIndex: nearStaff,
                    isRest: true
                });
                continue;
            }

            // Quarter rest: tall, narrow, zigzag shape
            if (b.height > avgSpacing * 1.5 && b.height < avgSpacing * 4 &&
                b.width < avgSpacing * 1.2 &&
                b.aspectRatio < 0.6 && b.fillRatio > 0.25 && b.fillRatio < 0.65) {

                rests.push({
                    type: 'quarter',
                    durationValue: 1,
                    mxlType: 'quarter',
                    centerX: b.centerX,
                    centerY: b.centerY,
                    staffIndex: nearStaff,
                    isRest: true
                });
                continue;
            }

            // Eighth rest: small hook shape
            if (b.height > avgSpacing * 0.8 && b.height < avgSpacing * 2 &&
                b.width < avgSpacing * 1.0 &&
                b.fillRatio > 0.2 && b.fillRatio < 0.55 &&
                b.pixels > avgSpacing * 0.5) {

                // Check it's not a notehead (noteheads are more circular)
                if (b.aspectRatio < 0.8 && b.height > b.width * 1.2) {
                    rests.push({
                        type: 'eighth',
                        durationValue: 0.5,
                        mxlType: 'eighth',
                        centerX: b.centerX,
                        centerY: b.centerY,
                        staffIndex: nearStaff,
                        isRest: true
                    });
                }
            }
        }

        return rests;
    },

    /**
     * Detect bar lines (vertical lines spanning full staff height)
     */
    detectBarLines: function(binary, width, height, staves) {
        var barLines = [];

        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            var staffTop = staff.top - 2;
            var staffBot = staff.bottom + 2;
            var staffHeight = staffBot - staffTop;

            // Scan each x column for vertical black runs
            for (var x = 0; x < width; x++) {
                var blackRun = 0;
                for (var y = staffTop; y <= staffBot; y++) {
                    if (y >= 0 && y < height && binary[y * width + x] === 1) {
                        blackRun++;
                    }
                }

                // Bar line: >80% of staff height filled, narrow (1-4px wide)
                if (blackRun > staffHeight * 0.8) {
                    // Check it's narrow (not a brace or thick symbol)
                    var isNarrow = true;
                    for (var dx = -3; dx <= 3; dx++) {
                        if (dx === 0) continue;
                        var nx = x + dx;
                        if (nx < 0 || nx >= width) continue;
                        var nRun = 0;
                        for (var y = staffTop; y <= staffBot; y++) {
                            if (binary[y * width + nx] === 1) nRun++;
                        }
                        if (Math.abs(dx) > 2 && nRun > staffHeight * 0.7) {
                            isNarrow = false;
                            break;
                        }
                    }

                    if (isNarrow) {
                        // Avoid duplicates (merge close bar lines)
                        var isDuplicate = false;
                        for (var b = 0; b < barLines.length; b++) {
                            if (barLines[b].staffIndex === s && Math.abs(barLines[b].x - x) < 8) {
                                isDuplicate = true;
                                break;
                            }
                        }
                        if (!isDuplicate) {
                            barLines.push({ x: x, staffIndex: s });
                        }
                    }
                }
            }
        }

        return barLines;
    },

    /**
     * Classify note duration based on notehead fill + stem + flags + beams
     * Now supports: whole, half, quarter, eighth, sixteenth
     */
    classifyDuration: function(noteHeads) {
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            var flags = Math.max(nh.flagCount || 0, nh.beamCount || 0);

            if (!nh.isFilled && !nh.hasStem) {
                nh.duration = 'whole';
                nh.durationValue = 4;
                nh.mxlType = 'whole';
            } else if (!nh.isFilled && nh.hasStem) {
                nh.duration = 'half';
                nh.durationValue = 2;
                nh.mxlType = 'half';
            } else if (nh.isFilled && nh.hasStem && flags >= 2) {
                nh.duration = '16th';
                nh.durationValue = 0.25;
                nh.mxlType = '16th';
            } else if (nh.isFilled && nh.hasStem && flags >= 1) {
                nh.duration = 'eighth';
                nh.durationValue = 0.5;
                nh.mxlType = 'eighth';
            } else if (nh.isFilled && nh.hasStem) {
                nh.duration = 'quarter';
                nh.durationValue = 1;
                nh.mxlType = 'quarter';
            } else {
                nh.duration = 'quarter';
                nh.durationValue = 1;
                nh.mxlType = 'quarter';
            }
        }
        return noteHeads;
    },

    /**
     * Assign pitch to each notehead based on vertical position relative to staff
     */
    assignPitch: function(noteHeads, staves) {
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            var staff = staves[nh.staffIndex];
            var halfSpace = staff.spacing / 2;

            // Calculate position index relative to bottom line (line 1)
            // Each staff position = half a space
            var distFromBottom = staff.bottom - nh.centerY;
            var posIndex = Math.round(distFromBottom / halfSpace);

            // Look up pitch
            var pitches = (staff.clef === 'bass') ? this.BASS_PITCHES : this.TREBLE_PITCHES;
            var belowPitches = (staff.clef === 'bass') ? this.BASS_BELOW : this.TREBLE_BELOW;

            var pitch;
            if (posIndex >= 0 && posIndex < pitches.length) {
                pitch = pitches[posIndex];
            } else if (posIndex < 0 && Math.abs(posIndex) <= belowPitches.length) {
                pitch = belowPitches[Math.abs(posIndex) - 1];
            } else if (posIndex >= pitches.length) {
                // Above the staff — extrapolate
                var extra = posIndex - pitches.length + 1;
                var lastPitch = pitches[pitches.length - 1];
                var steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
                var si = steps.indexOf(lastPitch.step);
                var oct = lastPitch.octave;
                for (var e = 0; e < extra; e++) {
                    si++;
                    if (si >= 7) { si = 0; oct++; }
                }
                pitch = { step: steps[si], octave: oct };
            } else {
                // Far below — extrapolate
                var extra = Math.abs(posIndex) - belowPitches.length;
                var lastPitch = belowPitches[belowPitches.length - 1];
                var steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
                var si = steps.indexOf(lastPitch.step);
                var oct = lastPitch.octave;
                for (var e = 0; e < extra; e++) {
                    si--;
                    if (si < 0) { si = 6; oct--; }
                }
                pitch = { step: steps[si], octave: oct };
            }

            nh.pitch = pitch;
            nh.midiNote = this.noteToMidi(pitch.step, pitch.octave);
            nh.pitchName = pitch.step + pitch.octave;
        }

        return noteHeads;
    },

    /**
     * Sort notes left-to-right, detect chords (notes at same x position)
     */
    organizeNotes: function(noteHeads) {
        // Sort by x position
        noteHeads.sort(function(a, b) { return a.centerX - b.centerX; });

        // Group into chords (notes within a small x-range)
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

            // Use shortest duration in chord
            var minDuration = 4;
            for (var c = 0; c < chord.length; c++) {
                if (chord[c].durationValue < minDuration) minDuration = chord[c].durationValue;
            }

            events.push({
                notes: chord,
                x: chord[0].centerX,
                staffIndex: chord[0].staffIndex,
                durationValue: minDuration,
                duration: chord[0].duration,
                mxlType: chord[0].mxlType
            });
            i = j;
        }

        return events;
    },

    /**
     * Main detection pipeline
     */
    detect: function(cleanedBinary, originalBinary, width, height, staves) {
        // Step 1: Find all blobs in the cleaned (staff-removed) image
        var blobs = this.findBlobs(cleanedBinary, width, height);

        // Step 2: Filter to note head candidates
        var noteHeads = this.filterNoteHeads(blobs, staves);

        // Step 3: Detect stems (using original binary with staff lines)
        noteHeads = this.detectStems(noteHeads, originalBinary, width, height, staves);

        // Step 4: Detect flags and beams (eighth/sixteenth notes)
        noteHeads = this.detectFlags(noteHeads, originalBinary, width, height, staves);
        noteHeads = this.detectBeams(noteHeads, originalBinary, width, height, staves);

        // Step 5: Classify duration (now uses flags + beams)
        noteHeads = this.classifyDuration(noteHeads);

        // Step 6: Assign pitch
        noteHeads = this.assignPitch(noteHeads, staves);

        // Step 7: Detect rests
        var rests = this.detectRests(blobs, staves, width);

        // Step 8: Detect bar lines for measure segmentation
        var barLines = this.detectBarLines(originalBinary, width, height, staves);

        // Step 9: Organize into events (notes + rests, sorted left-to-right)
        var events = this.organizeNotes(noteHeads);

        // Merge rests into events timeline
        for (var r = 0; r < rests.length; r++) {
            var rest = rests[r];
            events.push({
                notes: [],
                isRest: true,
                restType: rest.type,
                x: rest.centerX,
                staffIndex: rest.staffIndex,
                durationValue: rest.durationValue,
                duration: rest.type,
                mxlType: rest.mxlType
            });
        }

        // Re-sort all events by x position
        events.sort(function(a, b) { return a.x - b.x; });

        return {
            noteHeads: noteHeads,
            events: events,
            rests: rests,
            barLines: barLines
        };
    }
};

console.log('[PianoModeOMR] Note detection & classification loaded');
