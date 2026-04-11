/**
 * PianoMode OMR Engine — Phase 14 (part 2) MIDI writer
 *
 * Consumes the Phase 13 SIG output (OMR.SIG.build) and emits a Standard
 * MIDI File (format 1) byte stream + a Blob URL the player can load.
 *
 * Counterpart of omr-musicxml.js. Both phases live downstream of Phase 13
 * and share the same event model:
 *
 *     sig.systems[*].measures[*].voices[*].events[*]
 *       { kind: 'NOTE'|'CHORD'|'REST',
 *         midi: [int, ...],          // empty for REST
 *         duration: float (quarters),
 *         startBeat: float (quarters, measure-local) }
 *
 * Output: a format-1 SMF with:
 *   - 1 conductor track (track 0): tempo + time signature
 *   - 1 track per Part collected the same way as MusicXmlNew
 *     (grand-staff system collapses staves into a single Piano part)
 *
 * Each Part track receives all chord/note events from every measure,
 * each note On at (measureStartTicks + event.startBeat * DIV) and
 * Off at (start + event.duration * DIV). Rests advance time only.
 *
 * Channel assignment:
 *   - Part 0 (grand staff or first staff)  -> channel 0 (piano)
 *   - Part 1 / extra staves                 -> channel 1 (piano)
 *
 * Velocity is fixed (80) — Audiveris does not infer dynamics.
 *
 * Tempo defaults to 120 bpm (500_000 microseconds per quarter) which is
 * the SMF default; we still emit the meta event explicitly so the player
 * doesn't have to assume.
 *
 * @package PianoMode
 */
(function () {
    'use strict';

    var OMR = window.PianoModeOMR = window.PianoModeOMR || {};

    // Resolution: ticks per quarter note. 480 is high enough to represent
    // 64th tuplets without rounding error and is what most DAWs default to.
    var DIVISION       = 480;
    var DEFAULT_TEMPO  = 500000;   // microseconds per quarter note (120 bpm)
    var DEFAULT_VEL    = 80;
    var PIANO_PROGRAM  = 0;        // GM Acoustic Grand Piano

    // ---------------------------------------------------------------------
    // Byte writer — append-only Uint8Array buffer with auto-grow.
    // ---------------------------------------------------------------------
    function ByteWriter() {
        this.buf = new Uint8Array(1024);
        this.len = 0;
    }
    ByteWriter.prototype._ensure = function (n) {
        if (this.len + n <= this.buf.length) return;
        var nb = this.buf.length;
        while (nb < this.len + n) nb *= 2;
        var copy = new Uint8Array(nb);
        copy.set(this.buf);
        this.buf = copy;
    };
    ByteWriter.prototype.u8 = function (b) {
        this._ensure(1);
        this.buf[this.len++] = b & 0xFF;
    };
    ByteWriter.prototype.u16 = function (v) {
        this._ensure(2);
        this.buf[this.len++] = (v >>> 8) & 0xFF;
        this.buf[this.len++] = v & 0xFF;
    };
    ByteWriter.prototype.u32 = function (v) {
        this._ensure(4);
        this.buf[this.len++] = (v >>> 24) & 0xFF;
        this.buf[this.len++] = (v >>> 16) & 0xFF;
        this.buf[this.len++] = (v >>> 8)  & 0xFF;
        this.buf[this.len++] = v & 0xFF;
    };
    ByteWriter.prototype.bytes = function (arr) {
        this._ensure(arr.length);
        for (var i = 0; i < arr.length; i++) {
            this.buf[this.len++] = arr[i] & 0xFF;
        }
    };
    ByteWriter.prototype.ascii = function (str) {
        this._ensure(str.length);
        for (var i = 0; i < str.length; i++) {
            this.buf[this.len++] = str.charCodeAt(i) & 0x7F;
        }
    };
    // Variable Length Quantity (SMF style — 7 bits per byte, MSB=1 = more).
    ByteWriter.prototype.vlq = function (v) {
        if (v < 0) v = 0;
        var stack = [v & 0x7F];
        v >>>= 7;
        while (v > 0) {
            stack.push((v & 0x7F) | 0x80);
            v >>>= 7;
        }
        for (var i = stack.length - 1; i >= 0; i--) {
            this.u8(stack[i]);
        }
    };
    ByteWriter.prototype.toUint8 = function () {
        return this.buf.subarray(0, this.len);
    };

    // ---------------------------------------------------------------------
    // Part collection — same logic as MusicXmlNew, kept inline so the two
    // writers don't import each other (load order is unspecified).
    // ---------------------------------------------------------------------
    function collectParts(sig) {
        var parts = [];
        if (!sig || !sig.systems) return parts;

        var systems = sig.systems;
        var grandStaff = (systems.length > 0
                          && systems[0].staves
                          && systems[0].staves.length === 2);

        if (grandStaff) {
            // Single piano part containing both staves of every system.
            var p = { id: 'P1', name: 'Piano', staffCount: 2, systems: systems };
            parts.push(p);
        } else {
            // One part per staff, distributed across systems by index.
            var maxStaves = 0;
            for (var s = 0; s < systems.length; s++) {
                if (systems[s].staves && systems[s].staves.length > maxStaves) {
                    maxStaves = systems[s].staves.length;
                }
            }
            for (var i = 0; i < maxStaves; i++) {
                parts.push({
                    id: 'P' + (i + 1),
                    name: 'Staff ' + (i + 1),
                    staffCount: 1,
                    systems: systems,
                    staffFilter: i
                });
            }
        }
        return parts;
    }

    // ---------------------------------------------------------------------
    // Flatten all events of a Part into an absolute-tick list of
    // {tick, on:[midi...], off:[midi...]} groups. The caller then walks
    // them in order to emit Note On / Note Off events.
    //
    // For chord events we put every member into the on/off lists at the
    // same tick — the player gets simultaneous polyphony "for free" since
    // SMF allows multiple events at the same delta=0.
    // ---------------------------------------------------------------------
    function flattenPartEvents(part) {
        var events = [];   // { tick, type:'on'|'off', midi:[...] }

        for (var sIdx = 0; sIdx < part.systems.length; sIdx++) {
            var sys = part.systems[sIdx];
            if (!sys.measures) continue;

            for (var mIdx = 0; mIdx < sys.measures.length; mIdx++) {
                var measure = sys.measures[mIdx];
                if (!measure.voices) continue;

                // Per-measure absolute tick origin. Audiveris computes
                // measure durations from the time signature, but at this
                // stage we don't have a guaranteed time sig per system, so
                // we approximate the measure length as the max
                // (startBeat + duration) seen in any of its voices.
                var measureLen = measureDuration(measure);
                var measureTick = ticksAtMeasure(part, sys, mIdx);

                for (var vIdx = 0; vIdx < measure.voices.length; vIdx++) {
                    var voice = measure.voices[vIdx];
                    if (!voice.events) continue;
                    if (part.staffFilter != null
                        && voice.staff !== part.staffFilter) continue;

                    for (var eIdx = 0; eIdx < voice.events.length; eIdx++) {
                        var ev = voice.events[eIdx];
                        if (!ev) continue;
                        if (ev.kind === 'REST') continue;

                        var midi = ev.midi || [];
                        if (!midi.length) continue;

                        var startQ = (ev.startBeat || 0);
                        var durQ   = (ev.duration  || 1);
                        var onT    = measureTick + Math.round(startQ * DIVISION);
                        var offT   = measureTick + Math.round((startQ + durQ) * DIVISION);

                        events.push({ tick: onT,  type: 'on',  midi: midi.slice() });
                        events.push({ tick: offT, type: 'off', midi: midi.slice() });
                    }
                }

                // Cache the measure length on the part for ticksAtMeasure.
                if (!part._mLens) part._mLens = {};
                part._mLens[sIdx + ':' + mIdx] = measureLen;
            }
        }

        // Stable sort by tick, off-before-on at identical ticks (so a note
        // ending and another starting at the same tick don't collide).
        events.sort(function (a, b) {
            if (a.tick !== b.tick) return a.tick - b.tick;
            if (a.type === b.type) return 0;
            return a.type === 'off' ? -1 : 1;
        });

        return events;
    }

    function measureDuration(measure) {
        var maxEnd = 0;
        var voices = measure.voices || [];
        for (var i = 0; i < voices.length; i++) {
            var evs = voices[i].events || [];
            for (var j = 0; j < evs.length; j++) {
                var e = evs[j];
                var end = (e.startBeat || 0) + (e.duration || 1);
                if (end > maxEnd) maxEnd = end;
            }
        }
        if (maxEnd <= 0) maxEnd = 4; // fallback to one whole measure
        return maxEnd;
    }

    function ticksAtMeasure(part, currentSystem, measureIndex) {
        // Sum measure durations of every preceding measure of the part.
        var ticks = 0;
        for (var sIdx = 0; sIdx < part.systems.length; sIdx++) {
            var sys = part.systems[sIdx];
            var measures = sys.measures || [];
            for (var mIdx = 0; mIdx < measures.length; mIdx++) {
                if (sys === currentSystem && mIdx === measureIndex) {
                    return ticks;
                }
                var len = (part._mLens && part._mLens[sIdx + ':' + mIdx])
                          || measureDuration(measures[mIdx]);
                ticks += Math.round(len * DIVISION);
            }
        }
        return ticks;
    }

    // ---------------------------------------------------------------------
    // Track encoders.
    // ---------------------------------------------------------------------
    function encodeConductorTrack(sig) {
        var w = new ByteWriter();

        // Track name "Conductor".
        w.vlq(0);
        w.bytes([0xFF, 0x03]);
        w.vlq(9);
        w.ascii('Conductor');

        // Tempo (default 120bpm).
        w.vlq(0);
        w.bytes([0xFF, 0x51, 0x03,
                 (DEFAULT_TEMPO >>> 16) & 0xFF,
                 (DEFAULT_TEMPO >>> 8)  & 0xFF,
                 DEFAULT_TEMPO & 0xFF]);

        // Time signature (best effort: read first measure's first voice
        // duration if present, else default 4/4).
        var num = 4, den = 4;
        if (sig && sig.systems && sig.systems[0]) {
            var hdr = (sig.systems[0].headers || {});
            var t   = hdr.time;
            if (t && t.kind === 'NUMERIC' && t.numerator && t.denominator) {
                num = t.numerator;
                den = t.denominator;
            } else if (t && t.kind === 'COMMON') {
                num = 4; den = 4;
            } else if (t && t.kind === 'CUT') {
                num = 2; den = 2;
            }
        }
        var denExp = Math.round(Math.log(den) / Math.log(2)); // 4 -> 2
        w.vlq(0);
        w.bytes([0xFF, 0x58, 0x04, num, denExp, 24, 8]);

        // End of track.
        w.vlq(0);
        w.bytes([0xFF, 0x2F, 0x00]);

        return w.toUint8();
    }

    function encodePartTrack(part, channel) {
        var w = new ByteWriter();

        // Track name.
        var name = part.name || ('Part ' + part.id);
        w.vlq(0);
        w.bytes([0xFF, 0x03]);
        w.vlq(name.length);
        w.ascii(name);

        // Program change to Acoustic Grand Piano (channel 0/1).
        w.vlq(0);
        w.u8(0xC0 | (channel & 0x0F));
        w.u8(PIANO_PROGRAM);

        // Note events.
        var events = flattenPartEvents(part);
        var prevTick = 0;
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var delta = Math.max(0, ev.tick - prevTick);
            for (var k = 0; k < ev.midi.length; k++) {
                var note = ev.midi[k] & 0x7F;
                w.vlq(k === 0 ? delta : 0);
                if (ev.type === 'on') {
                    w.u8(0x90 | (channel & 0x0F));
                    w.u8(note);
                    w.u8(DEFAULT_VEL);
                } else {
                    w.u8(0x80 | (channel & 0x0F));
                    w.u8(note);
                    w.u8(0x40);
                }
            }
            prevTick = ev.tick;
        }

        // End of track.
        w.vlq(0);
        w.bytes([0xFF, 0x2F, 0x00]);

        return w.toUint8();
    }

    // ---------------------------------------------------------------------
    // Public entry point.
    // ---------------------------------------------------------------------
    function buildMidi(sig /*, scale, options*/) {
        var parts = collectParts(sig);
        var trackBlobs = [];

        // Conductor track.
        trackBlobs.push(encodeConductorTrack(sig));

        // Part tracks.
        for (var i = 0; i < parts.length; i++) {
            var ch = (i === 0) ? 0 : 1;
            trackBlobs.push(encodePartTrack(parts[i], ch));
        }

        // Header chunk.
        var hdr = new ByteWriter();
        hdr.ascii('MThd');
        hdr.u32(6);                       // header length
        hdr.u16(1);                       // format 1
        hdr.u16(trackBlobs.length);       // number of tracks
        hdr.u16(DIVISION);                // ticks per quarter

        // Concatenate header + each track chunk (MTrk + length + bytes).
        var totalLen = hdr.len;
        for (var t = 0; t < trackBlobs.length; t++) {
            totalLen += 4 + 4 + trackBlobs[t].length;
        }
        var out = new Uint8Array(totalLen);
        out.set(hdr.toUint8(), 0);
        var off = hdr.len;
        for (var t2 = 0; t2 < trackBlobs.length; t2++) {
            out[off++] = 0x4D; // M
            out[off++] = 0x54; // T
            out[off++] = 0x72; // r
            out[off++] = 0x6B; // k
            var L = trackBlobs[t2].length;
            out[off++] = (L >>> 24) & 0xFF;
            out[off++] = (L >>> 16) & 0xFF;
            out[off++] = (L >>> 8)  & 0xFF;
            out[off++] = L & 0xFF;
            out.set(trackBlobs[t2], off);
            off += L;
        }

        // Convenience: Blob URL the player can <audio src=...> or fetch().
        var url = null;
        try {
            if (typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
                var blob = new Blob([out], { type: 'audio/midi' });
                url = URL.createObjectURL(blob);
            }
        } catch (e) { /* node / sandbox without Blob — skip */ }

        return {
            bytes:    out,
            byteLen:  out.length,
            blobUrl:  url,
            division: DIVISION,
            tempo:    DEFAULT_TEMPO,
            partCount: parts.length
        };
    }

    OMR.MidiNew = OMR.MidiNew || {};
    OMR.MidiNew.buildMidi = buildMidi;

    if (typeof console !== 'undefined' && console.log) {
        console.log('[PianoModeOMR] omr-midi.js loaded — '
                    + (OMR.VERSION || '?'));
    }
})();
