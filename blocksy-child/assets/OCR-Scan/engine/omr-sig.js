/**
 * PianoMode OMR Engine — SIGraph + Rhythm + voices (Phase 13)
 *
 * Pragmatic JavaScript port of
 *   app/src/main/java/org/audiveris/omr/sig/SIGraph.java
 *   app/src/main/java/org/audiveris/omr/sheet/rhythm/MeasureBuilder.java
 *   app/src/main/java/org/audiveris/omr/sheet/rhythm/VoicesBuilder.java
 *
 * Audiveris's symbol-interpretation graph is a sophisticated constraint
 * solver that handles head-stem links, beam-head links, accidentals,
 * voice exclusion edges, octave shifts and lyrics. None of that fits
 * a browser port budget, so we substitute a much simpler "assemble
 * notes into measures and voices" pipeline that captures the bits the
 * downstream MusicXML / MIDI writers actually need:
 *
 *   1. **Pitch resolution** — for each Phase 8 head, compute the
 *      half-line position relative to its staff (an integer in
 *      [-7..+7] for normal range, extended via Phase 9 ledgers) and
 *      convert it to a MIDI note number using the staff's Phase 11
 *      clef + key signature.
 *
 *   2. **Duration resolution** — read the Phase 10 stem + Phase 7
 *      beam attached to the head:
 *        no stem    → whole / half (depending on shape NOTEHEAD_VOID
 *                     vs WHOLE_NOTE)
 *        stem only  → quarter (NOTEHEAD_BLACK) or half (NOTEHEAD_VOID)
 *        stem+beam  → eighth (single beam) … 16th, 32nd if multi-beam
 *
 *   3. **Measure assignment** — use Phase 5 GridBars output (system
 *      barlines) to slice each system into measures and bucket every
 *      head + rest into the measure whose x range contains it.
 *
 *   4. **Voice assignment** — within a measure, sort all events by
 *      x; the topmost notes go to voice 1 and the bottom-most go to
 *      voice 2 (typical piano writing). For chords (heads sharing the
 *      same x within 0.5*IL), keep them as a single chord on a
 *      single voice.
 *
 *   5. **Time positions** — assign onset times in beats inside each
 *      measure by walking voice events in order; gaps and rests use
 *      their `dur` directly.
 *
 * Output shape
 * ------------
 *   buildSig(scale, staves, headers, heads, stems, beams, ledgers,
 *            rests, gridBars) → {
 *       systems: [
 *           {
 *               id,
 *               staves,
 *               measures: [
 *                   {
 *                       index, xLeft, xRight,
 *                       voices: [
 *                           {
 *                               id, staff,
 *                               events: [
 *                                   {
 *                                       kind: 'NOTE'|'CHORD'|'REST',
 *                                       x, y,
 *                                       midi:  [int, ...],   // CHORD has multiple
 *                                       pitchStep, octave,
 *                                       alter, duration,
 *                                       startBeat
 *                                   }, ...
 *                               ]
 *                           }, ...
 *                       ]
 *                   }, ...
 *               ]
 *           }, ...
 *       ]
 *   }
 *
 * @package PianoMode
 * @version 6.10.0
 */
(function () {
    'use strict';

    var OMR = window.PianoModeOMR;
    if (!OMR) {
        return;
    }

    // Western music: pitch step letters by half-line index assuming
    // treble clef on staff line index 4 (E4) ascending. We resolve
    // the actual reference per clef inside positionToMidi().
    var STEP_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    var STEP_SEMITONES = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };

    // Half-line position 0 = top staff line, growing downward.
    // For TREBLE: top line (idx 0) is F5, middle line is B4, bottom line is E4.
    // For BASS:   top line (idx 0) is A3, middle line is D3, bottom line is G2.
    // For ALTO:   top line (idx 0) is G4, middle line is C4, bottom line is F3.
    var CLEF_REFERENCE = {
        'TREBLE': { step: 'F', octave: 5 }, // top line note name
        'BASS':   { step: 'A', octave: 3 },
        'ALTO':   { step: 'G', octave: 4 },
        'NONE':   { step: 'F', octave: 5 }
    };

    /**
     * Main entry point.
     */
    function buildSig(scale, staves, headers, heads, stems, beams, ledgers,
                     rests, gridBars) {
        if (!scale || !scale.valid) {
            return { systems: [] };
        }
        if (!staves || staves.length === 0) {
            return { systems: [] };
        }
        var interline = scale.interline;
        heads   = (heads && heads.heads)         ? heads.heads         : (heads || []);
        stems   = (stems && stems.stems)         ? stems.stems         : (stems || []);
        beams   = (beams && beams.beams)         ? beams.beams         : (beams || []);
        ledgers = (ledgers && ledgers.ledgers)   ? ledgers.ledgers     : (ledgers || []);
        rests   = (rests && rests.rests)         ? rests.rests         : (rests || []);

        // Step 1: assign pitch + duration to every head; gather a flat
        //         list of "musical events" tagged by staff.
        var events = [];
        for (var i = 0; i < heads.length; i++) {
            var head  = heads[i];
            var staff = head.staff;
            if (!staff) continue;
            var hdr = staff.header || (headers && headers[staffIdx(staff, staves)]);
            var clef = (hdr && hdr.clef) ? hdr.clef.kind : 'TREBLE';
            var key  = (hdr && hdr.key)  ? hdr.key.fifths : 0;

            var pitchInfo = positionToPitch(head, staff, interline, clef, key);
            var dur = headDuration(head, beams);

            events.push({
                kind:      'NOTE',
                head:      head,
                rest:      null,
                staff:     staff,
                x:         head.x,
                y:         head.y,
                midi:      [pitchInfo.midi],
                pitchStep: pitchInfo.step,
                octave:    pitchInfo.octave,
                alter:     pitchInfo.alter,
                duration:  dur,
                startBeat: 0
            });
        }
        for (var r = 0; r < rests.length; r++) {
            var rst = rests[r];
            events.push({
                kind:      'REST',
                head:      null,
                rest:      rst,
                staff:     rst.staff,
                x:         rst.x,
                y:         rst.y,
                midi:      [],
                pitchStep: null,
                octave:    null,
                alter:     0,
                duration:  rst.dur || 1,
                startBeat: 0
            });
        }

        // Step 2: group events into chords (notes sharing x within 0.5*IL
        //         on the same staff). The chord's pitches are merged into
        //         a single event of kind=CHORD, smallest duration wins.
        var chordTol = 0.5 * interline;
        var chords = mergeChords(events, chordTol);

        // Step 3: build the system → measure structure from gridBars.
        var systems = buildSystems(scale, staves, gridBars);

        // Step 4: assign each event to its measure + voice.
        for (var ci = 0; ci < chords.length; ci++) {
            var ev = chords[ci];
            var sys = findSystemForStaff(systems, ev.staff);
            if (!sys) continue;
            var measure = findMeasureForX(sys, ev.x);
            if (!measure) continue;
            measure._raw = measure._raw || [];
            measure._raw.push(ev);
        }

        // Step 5: split each measure into voices, assign startBeat.
        for (var si = 0; si < systems.length; si++) {
            var system = systems[si];
            for (var mi = 0; mi < system.measures.length; mi++) {
                var m = system.measures[mi];
                m.voices = assignVoices(m._raw || [], interline);
                computeStartBeats(m);
                delete m._raw;
            }
        }

        return { systems: systems };
    }

    // -------------------------------------------------------------------
    // Pitch from head position. We compute half-line position relative
    // to the top staff line (line index 0) and convert via the clef
    // reference. Negative half-lines are above the top line, positive
    // are below.
    // -------------------------------------------------------------------
    function positionToPitch(head, staff, interline, clef, keyFifths) {
        var topLine = staff.lines[0];
        var topY = (topLine.line && topLine.line.getYAtX)
            ? topLine.line.getYAtX(head.x)
            : staff.yTop;
        var halfStep = (head.y - topY) / (interline / 2); // half-line offset
        var hi = Math.round(halfStep); // 0 = top line, +2 = next line down

        var ref = CLEF_REFERENCE[clef] || CLEF_REFERENCE.TREBLE;
        // Each diatonic step downward increases the step index by -1
        // and the octave by 0 or -1.
        var refStepIdx = STEP_NAMES.indexOf(ref.step); // 0..6
        var totalDiatonic = refStepIdx - hi;           // diatonic steps from C0
        var octave = ref.octave + Math.floor(totalDiatonic / 7);
        var stepIdx = ((totalDiatonic % 7) + 7) % 7;
        var step = STEP_NAMES[stepIdx];

        // Apply key signature alteration to this step.
        var alter = keyAlter(step, keyFifths);

        // Apply explicit accidental on the head (overrides key sig).
        if (head.alter) {
            alter = head.alter.semitones;
        }

        var midi = stepToMidi(step, octave) + alter;
        return { step: step, octave: octave, alter: alter, midi: midi };
    }

    function stepToMidi(step, octave) {
        return (octave + 1) * 12 + STEP_SEMITONES[step];
    }

    // Standard order of sharps / flats by fifths.
    var SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
    var FLAT_ORDER  = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
    function keyAlter(step, fifths) {
        if (fifths > 0) {
            for (var i = 0; i < fifths && i < 7; i++) {
                if (SHARP_ORDER[i] === step) return +1;
            }
        } else if (fifths < 0) {
            var n = -fifths;
            for (var j = 0; j < n && j < 7; j++) {
                if (FLAT_ORDER[j] === step) return -1;
            }
        }
        return 0;
    }

    // -------------------------------------------------------------------
    // Duration from head shape + Phase 10 stem + Phase 7 beam.
    // -------------------------------------------------------------------
    function headDuration(head, beams) {
        // Whole / breve: shape carries duration directly.
        if (head.shape === 'WHOLE_NOTE') return 4;
        if (head.shape === 'BREVE')      return 8;

        // Void head with no stem → half (rare without stem but possible).
        // Black head with no stem → quarter fallback.
        if (!head.stem) {
            if (head.shape === 'NOTEHEAD_VOID') return 2;
            return 1;
        }

        // Stem present. Look at attached beam.
        var beam = head.stem.beam || head.beam;
        if (!beam) {
            // No beam → quarter (black) or half (void).
            if (head.shape === 'NOTEHEAD_VOID') return 2;
            return 1;
        }

        // Beam attached. Use beam height vs scale.beamThickness to
        // estimate flag count: 1=eighth, 2=16th, 3=32nd.
        var flagCount = 1;
        if (beam.height) {
            // Beam group height: each beam is ~beamThickness thick. We
            // approximate via height/typical thickness ratio.
            var typical = 4; // default if scale info isn't available here
            var ratio = beam.height / typical;
            if (ratio > 2.4)      flagCount = 3;
            else if (ratio > 1.6) flagCount = 2;
        }
        // Map flag count to fractional duration.
        if (flagCount === 1) return 0.5;
        if (flagCount === 2) return 0.25;
        if (flagCount === 3) return 0.125;
        return 0.5;
    }

    // -------------------------------------------------------------------
    // Merge events that sit at almost the same x and same staff into a
    // single chord event. Rests are passed through untouched.
    // -------------------------------------------------------------------
    function mergeChords(events, tol) {
        events.sort(function (a, b) {
            if (a.staff !== b.staff) return staffOrder(a.staff) - staffOrder(b.staff);
            return a.x - b.x;
        });
        var out = [];
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var last = out[out.length - 1];
            if (ev.kind === 'NOTE'
                && last && last.kind !== 'REST'
                && last.staff === ev.staff
                && Math.abs(last.x - ev.x) <= tol) {
                // Merge.
                if (last.kind === 'NOTE') last.kind = 'CHORD';
                last.midi.push(ev.midi[0]);
                // Smallest duration wins (we want the rhythmic
                // resolution of the fastest member).
                if (ev.duration < last.duration) last.duration = ev.duration;
            } else {
                out.push(ev);
            }
        }
        return out;
    }

    function staffOrder(staff) {
        if (!staff) return 0;
        return staff.id !== undefined ? staff.id : staff.yTop;
    }
    function staffIdx(staff, list) {
        for (var i = 0; i < list.length; i++) {
            if (list[i] === staff) return i;
        }
        return 0;
    }

    // -------------------------------------------------------------------
    // System / measure construction from Phase 5 GridBars output.
    // If GridBars is missing, fall back to a single measure per staff.
    // -------------------------------------------------------------------
    function buildSystems(scale, staves, gridBars) {
        if (gridBars && gridBars.systems && gridBars.systems.length > 0) {
            return gridBars.systems.map(function (sys, idx) {
                var measures = (sys.barlines || []).length > 0
                    ? barlinesToMeasures(sys.staves[0], sys.barlines, idx)
                    : [singleMeasure(sys.staves[0])];
                return {
                    id:       idx + 1,
                    staves:   sys.staves,
                    measures: measures
                };
            });
        }
        // Fallback: each staff is its own system with one measure.
        return staves.map(function (staff, idx) {
            return {
                id:       idx + 1,
                staves:   [staff],
                measures: [singleMeasure(staff)]
            };
        });
    }

    function barlinesToMeasures(staff, barlines, sysIdx) {
        var measures = [];
        var prevX = staff.xLeft;
        var sortedBars = barlines.slice().sort(function (a, b) {
            return (a.x || 0) - (b.x || 0);
        });
        for (var i = 0; i < sortedBars.length; i++) {
            var bx = sortedBars[i].x || sortedBars[i].xMid || sortedBars[i].xLeft;
            measures.push({
                index:  i + 1,
                xLeft:  prevX,
                xRight: bx,
                voices: []
            });
            prevX = bx;
        }
        // Trailing measure to staff.xRight.
        if (prevX < staff.xRight) {
            measures.push({
                index:  measures.length + 1,
                xLeft:  prevX,
                xRight: staff.xRight,
                voices: []
            });
        }
        return measures;
    }

    function singleMeasure(staff) {
        return {
            index:  1,
            xLeft:  staff ? staff.xLeft  : 0,
            xRight: staff ? staff.xRight : 0,
            voices: []
        };
    }

    function findSystemForStaff(systems, staff) {
        for (var i = 0; i < systems.length; i++) {
            for (var j = 0; j < systems[i].staves.length; j++) {
                if (systems[i].staves[j] === staff) return systems[i];
            }
        }
        return systems[0] || null;
    }

    function findMeasureForX(sys, x) {
        for (var i = 0; i < sys.measures.length; i++) {
            var m = sys.measures[i];
            if (x >= m.xLeft && x <= m.xRight) return m;
        }
        // Out of bounds → first or last measure.
        if (sys.measures.length > 0) {
            if (x < sys.measures[0].xLeft) return sys.measures[0];
            return sys.measures[sys.measures.length - 1];
        }
        return null;
    }

    // -------------------------------------------------------------------
    // Voice assignment: simple piano-style top/bottom split. For each
    // staff inside the measure, sort events by x; events with stem dir
    // UP go to voice 1, dir DOWN to voice 2. Rests go to voice 1.
    // -------------------------------------------------------------------
    function assignVoices(events, interline) {
        if (events.length === 0) return [];
        // Bucket by staff.
        var byStaff = {};
        for (var i = 0; i < events.length; i++) {
            var key = staffOrder(events[i].staff);
            if (!byStaff[key]) byStaff[key] = [];
            byStaff[key].push(events[i]);
        }

        var voices = [];
        var voiceId = 1;
        Object.keys(byStaff).forEach(function (k) {
            var bucket = byStaff[k];
            bucket.sort(function (a, b) { return a.x - b.x; });
            var v1 = { id: voiceId++, staff: bucket[0].staff, events: [] };
            var v2 = { id: voiceId++, staff: bucket[0].staff, events: [] };
            for (var j = 0; j < bucket.length; j++) {
                var ev = bucket[j];
                var dir = (ev.head && ev.head.stem && ev.head.stem.dir)
                    ? ev.head.stem.dir
                    : 'UP';
                if (ev.kind === 'REST') {
                    v1.events.push(ev);
                } else if (dir === 'UP') {
                    v1.events.push(ev);
                } else {
                    v2.events.push(ev);
                }
            }
            if (v1.events.length > 0) voices.push(v1);
            if (v2.events.length > 0) voices.push(v2);
        });
        return voices;
    }

    // -------------------------------------------------------------------
    // Walk each voice's events left-to-right, summing durations into
    // startBeat values.
    // -------------------------------------------------------------------
    function computeStartBeats(measure) {
        for (var i = 0; i < measure.voices.length; i++) {
            var v = measure.voices[i];
            v.events.sort(function (a, b) { return a.x - b.x; });
            var t = 0;
            for (var j = 0; j < v.events.length; j++) {
                v.events[j].startBeat = t;
                t += v.events[j].duration || 1;
            }
        }
    }

    // -------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------
    OMR.Sig = {
        buildSig: buildSig
    };

})();
