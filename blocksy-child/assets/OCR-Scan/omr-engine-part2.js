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
     * Classify note duration based on notehead fill + stem
     */
    classifyDuration: function(noteHeads) {
        for (var i = 0; i < noteHeads.length; i++) {
            var nh = noteHeads[i];
            if (!nh.isFilled && !nh.hasStem) {
                nh.duration = 'whole';
                nh.durationValue = 4; // 4 beats
                nh.mxlType = 'whole';
            } else if (!nh.isFilled && nh.hasStem) {
                nh.duration = 'half';
                nh.durationValue = 2;
                nh.mxlType = 'half';
            } else if (nh.isFilled && nh.hasStem) {
                nh.duration = 'quarter';
                nh.durationValue = 1;
                nh.mxlType = 'quarter';
            } else {
                // Filled without stem — treat as quarter
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

        // Step 4: Classify duration
        noteHeads = this.classifyDuration(noteHeads);

        // Step 5: Assign pitch
        noteHeads = this.assignPitch(noteHeads, staves);

        // Step 6: Organize into events (chords, sequence)
        var events = this.organizeNotes(noteHeads);

        return { noteHeads: noteHeads, events: events };
    }
};

console.log('[PianoModeOMR] Note detection & classification loaded');
