/**
 * PianoMode OMR Engine - Part 3: MusicXML & MIDI Generation
 * Generates standard MusicXML and MIDI files from detected notes
 *
 * @package PianoMode
 * @version 1.0.0
 */

window.PianoModeOMR = window.PianoModeOMR || {};

// =====================================================
// MUSICXML WRITER
// =====================================================
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
                    xml += '        <key><fifths>0</fifths></key>\n';
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

                        for (var n = 0; n < evt.notes.length; n++) {
                            var note = evt.notes[n];
                            xml += '      <note>\n';

                            // Chord (not first note in chord)
                            if (n > 0) {
                                xml += '        <chord/>\n';
                            }

                            xml += '        <pitch>\n';
                            xml += '          <step>' + note.pitch.step + '</step>\n';
                            xml += '          <octave>' + note.pitch.octave + '</octave>\n';
                            xml += '        </pitch>\n';
                            xml += '        <duration>' + dur + '</duration>\n';
                            xml += '        <type>' + (evt.mxlType || 'quarter') + '</type>\n';

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

            // Note On for all notes in chord (delta 0 for chord notes)
            for (var n = 0; n < evt.notes.length; n++) {
                var note = evt.notes[n];
                var midiNote = note.midiNote;
                if (midiNote < 0 || midiNote > 127) continue;

                if (n === 0 && i === 0) {
                    trackData.push(0x00); // delta 0 for first note
                } else if (n === 0 && i > 0) {
                    // Already handled below (delta after note off)
                } else {
                    trackData.push(0x00); // chord: delta 0
                }

                trackData.push(0x90 | channel); // Note On
                trackData.push(midiNote & 0x7F);
                trackData.push(velocity & 0x7F);
            }

            // Note Off after duration
            for (var n = 0; n < evt.notes.length; n++) {
                var note = evt.notes[n];
                var midiNote = note.midiNote;
                if (midiNote < 0 || midiNote > 127) continue;

                if (n === 0) {
                    this._pushVLQ(trackData, durationTicks);
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
// MAIN ORCHESTRATOR
// =====================================================
PianoModeOMR.Engine = {

    /**
     * Process an image or PDF file end-to-end.
     *
     * @param {File} file - User-uploaded file
     * @param {Function} onProgress - callback(step, message)
     * @returns {Promise<Object>} { musicxml, midiBlob, midiUrl, events, staves, noteCount }
     */
    process: function(file, onProgress) {
        onProgress = onProgress || function() {};
        var self = this;

        return new Promise(function(resolve, reject) {
            var isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

            onProgress(1, 'Loading file...');

            var loadPromise = isPDF
                ? PianoModeOMR.ImageProcessor.loadPDF(file)
                : PianoModeOMR.ImageProcessor.loadImage(file);

            loadPromise.then(function(loaded) {
                onProgress(1, 'Image loaded (' + loaded.width + 'x' + loaded.height + ')');

                // Grayscale
                onProgress(2, 'Converting to grayscale...');
                var gray = PianoModeOMR.ImageProcessor.toGrayscale(loaded.imageData);

                // Binarize
                onProgress(2, 'Binarizing image...');
                var threshold = PianoModeOMR.ImageProcessor.otsuThreshold(gray);
                var binary = PianoModeOMR.ImageProcessor.binarize(gray, threshold);

                // Detect staff lines
                onProgress(2, 'Detecting staff lines...');
                var staves = PianoModeOMR.StaffDetector.detect(binary, loaded.width, loaded.height);

                if (staves.length === 0) {
                    reject(new Error('No staff lines detected. Please use a clear, high-resolution image of printed sheet music.'));
                    return;
                }

                onProgress(2, staves.length + ' staff(s) detected');

                // Detect clefs
                staves = PianoModeOMR.StaffDetector.detectClefs(binary, loaded.width, staves);

                // Remove staff lines for note detection
                onProgress(2, 'Removing staff lines...');
                var cleaned = PianoModeOMR.StaffDetector.removeStaffLines(
                    binary, loaded.width, loaded.height, staves
                );

                // Detect notes
                onProgress(3, 'Detecting notes...');
                var result = PianoModeOMR.NoteDetector.detect(
                    cleaned, binary, loaded.width, loaded.height, staves
                );

                if (result.events.length === 0) {
                    reject(new Error('No notes detected. The image may be too low quality or not contain standard music notation.'));
                    return;
                }

                var noteCount = 0;
                for (var e = 0; e < result.events.length; e++) {
                    noteCount += result.events[e].notes.length;
                }
                onProgress(3, noteCount + ' notes detected');

                // Generate MusicXML
                onProgress(3, 'Generating MusicXML...');
                var title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
                var musicxml = PianoModeOMR.MusicXMLWriter.generate(
                    result.events, staves, { title: title }
                );

                // Generate MIDI
                onProgress(3, 'Generating MIDI...');
                var midiData = PianoModeOMR.MIDIWriter.generate(result.events, {});
                var midiBlob = PianoModeOMR.MIDIWriter.toBlob(midiData);
                var midiUrl = URL.createObjectURL(midiBlob);

                // MusicXML blob
                var xmlBlob = new Blob([musicxml], { type: 'application/xml' });
                var xmlUrl = URL.createObjectURL(xmlBlob);

                onProgress(4, 'Done! ' + noteCount + ' notes in ' + staves.length + ' staff(s)');

                resolve({
                    musicxml: musicxml,
                    musicxmlBlob: xmlBlob,
                    musicxmlUrl: xmlUrl,
                    midiData: midiData,
                    midiBlob: midiBlob,
                    midiUrl: midiUrl,
                    events: result.events,
                    noteHeads: result.noteHeads,
                    staves: staves,
                    noteCount: noteCount,
                    title: title
                });

            }).catch(function(err) {
                reject(err);
            });
        });
    }
};

console.log('[PianoModeOMR] MusicXML writer, MIDI writer & orchestrator loaded');
