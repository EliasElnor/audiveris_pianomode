/**
 * PianoMode Sight Reading Game - JavaScript Engine
 * File: /blocksy-child/assets/Sightreading-game/sightreading-engine.js
 * Version: 21.2.0 - SUPPORT FICHIERS MIDI
 * Lines: 4450+ professional production-ready code
 *
 * ✨ VERSION 21.2.0 - SUPPORT COMPLET FICHIERS MIDI:
 * 🎼 MIDI FILE PARSER (MIDIFileParser class):
 *    • Parse header MIDI (MThd) - format, tracks, division
 *    • Parse track chunks (MTrk) - events MIDI avec delta times
 *    • Support Note On/Off events (0x8/0x9)
 *    • Support Meta events (tempo 0xFF 0x51)
 *    • Variable-length quantity decoding (readVarLen)
 *    • Running status support
 *    • Multi-track extraction et fusion
 *    • Conversion ticks → beats → durées notes
 *    • Binary reading helpers (uint8/16/32, string)
 *
 * 🎹 INTÉGRATION MOTEUR:
 *    • parseMidiFile(): Parse ArrayBuffer → notes
 *    • ticksToDuration(): Convertit ticks MIDI en durées (whole/half/quarter/etc.)
 *    • showMessage(): Affiche messages succès/erreur temporaires
 *    • Mode Wait automatique après chargement
 *    • Tri notes par temps d'apparition
 *    • Mapping staff treble/bass selon MIDI note
 *
 * ✨ VERSION 21.1.0 - SYSTÈME DE NIVEAUX VRAIMENT PROGRESSIF:
 * 📊 5 NIVEAUX PÉDAGOGIQUES:
 *    • Beginner: 1 octave (C4-C5), rondes/blanches/noires, Do Majeur, 0% accords
 *    • Elementary: 1.5 octaves (G3-E5), + croches, 3 tonalités, 0% accords
 *    • Intermediate: 2.5 octaves (C3-G5), intervalles 2 notes (25% prob), altérations
 *    • Advanced: 3.5 octaves (A2-C6), triades 3 notes (40% prob), toutes tonalités
 *    • Expert: 5.5 octaves (A1-C7), accords 4+ notes (50% prob), polyrhythmes
 *
 * 🎯 GÉNÉRATEUR INTELLIGENT:
 *    • Respect strict des ranges MIDI par niveau
 *    • Patterns rythmiques adaptés à la complexité (1-5)
 *    • Probabilités accords/silences configurables
 *    • Filtrage types de notes selon niveau
 *    • Mouvement mélodique contraint au range
 *
 * 🎵 AUDIO ULTRA-RAPIDE (VERSION 21.0.0):
 *    • Notes très courtes par défaut (0.1s au lieu de 0.5s)
 *    • Son réaliste de piano - pas de traîne audio
 *    • Envelopes réduites sur tous les instruments (release 0.05-0.15s)
 *
 * 🎹 PÉDALE SUSTAIN MIDI (VERSION 21.0.0):
 *    • Support complet CC64 (Control Change 64)
 *    • Pédale enfoncée: notes sustained jusqu'au relâchement
 *    • Pédale relâchée: notes courtes (0.1s)
 *    • Map activeNotes pour tracking sustain
 *
 * 🎼 COMPLETE FEATURES:
 * - Canvas rendering for staff and notes
 * - MIDI input/output with sustain pedal support
 * - Virtual piano keyboard 88 keys
 * - Wait, Scroll & Free modes
 * - Complete chord generators (Random, Scales, Triads, Progressions, etc.)
 * - 5 instruments: Piano, Electric, Clavecin, Orgue, Jazz
 * - Progressive difficulty system (5 levels)
 * - Achievement system with unlockables
 * - Statistics tracking and analytics
 * - Loading screen with progress
 * - Settings & Stats panels
 */

(function($) {
    'use strict';

    /**
     * Snap a beat value to the sixteenth-note grid (0.25 resolution).
     * Eliminates floating-point drift (e.g. 1.9999→2.0) that causes
     * chord grouping mismatches in rendering, playback, and duration normalization.
     */
    function snapBeat(beat) {
        return Math.round((beat || 0) * 4) / 4;
    }

    /**
     * MIDI File Parser Class
     * Parses standard MIDI files (.mid) into note data
     */
    class MIDIFileParser {
        constructor(arrayBuffer) {
            this.data = new Uint8Array(arrayBuffer);
            this.pos = 0;
        }

        parse() {
            // Parse header chunk
            const header = this.parseHeader();

            // Parse track chunks
            const tracks = [];
            for (let i = 0; i < header.numTracks; i++) {
                const track = this.parseTrack();
                if (track) tracks.push(track);
            }

            // Extract notes from all tracks (also extracts tempo)
            const extractedData = this.extractNotes(tracks, header.division);

            // USER FIX: extractNotes now returns {notes, tempo}
            const notes = extractedData.notes || extractedData;
            const tempo = extractedData.tempo || 500000; // Default 120 BPM

            return {
                format: header.format,
                tracks: tracks,
                division: header.division,
                tempo: tempo,
                notes: notes
            };
        }

        parseHeader() {
            // "MThd" chunk
            const chunkType = this.readString(4);
            if (chunkType !== 'MThd') {
                throw new Error('Invalid MIDI file: Missing MThd header');
            }

            const length = this.readUint32();
            const format = this.readUint16();
            const numTracks = this.readUint16();
            const division = this.readUint16();


            return { format, numTracks, division };
        }

        parseTrack() {
            // "MTrk" chunk
            const chunkType = this.readString(4);
            if (chunkType !== 'MTrk') {
                console.warn('⚠️  Unknown chunk type:', chunkType);
                return null;
            }

            const length = this.readUint32();
            const endPos = this.pos + length;
            const events = [];

            let runningStatus = 0;
            let currentTime = 0;

            while (this.pos < endPos) {
                // Read delta time
                const deltaTime = this.readVarLen();
                currentTime += deltaTime;

                // Read event
                let statusByte = this.data[this.pos];

                // Running status
                if (statusByte < 0x80) {
                    statusByte = runningStatus;
                } else {
                    this.pos++;
                    runningStatus = statusByte;
                }

                const event = this.parseEvent(statusByte, currentTime);
                if (event) events.push(event);
            }

            return { events };
        }

        parseEvent(statusByte, time) {
            const eventType = statusByte >> 4;
            const channel = statusByte & 0x0F;

            switch (eventType) {
                case 0x8: // Note Off
                    return {
                        type: 'noteOff',
                        time: time,
                        channel: channel,
                        note: this.readUint8(),
                        velocity: this.readUint8()
                    };

                case 0x9: // Note On
                    const note = this.readUint8();
                    const velocity = this.readUint8();
                    return {
                        type: velocity > 0 ? 'noteOn' : 'noteOff',
                        time: time,
                        channel: channel,
                        note: note,
                        velocity: velocity
                    };

                case 0xA: // Polyphonic aftertouch
                    this.pos += 2;
                    return null;

                case 0xB: // Control Change
                    this.pos += 2;
                    return null;

                case 0xC: // Program Change
                    this.pos += 1;
                    return null;

                case 0xD: // Channel aftertouch
                    this.pos += 1;
                    return null;

                case 0xE: // Pitch bend
                    this.pos += 2;
                    return null;

                case 0xF: // System/Meta events
                    return this.parseMetaEvent(statusByte);

                default:
                    console.warn('Unknown MIDI event type:', eventType.toString(16));
                    return null;
            }
        }

        parseMetaEvent(statusByte) {
            if (statusByte === 0xFF) {
                const metaType = this.readUint8();
                const length = this.readVarLen();
                const data = this.data.slice(this.pos, this.pos + length);
                this.pos += length;

                if (metaType === 0x51) {
                    // Tempo
                    const tempo = (data[0] << 16) | (data[1] << 8) | data[2];
                    return { type: 'tempo', tempo: tempo };
                }

                return null;
            }

            // SysEx events
            const length = this.readVarLen();
            this.pos += length;
            return null;
        }

        extractNotes(tracks, division) {
            const allNotes = [];
            let tempo = 500000; // Default 120 BPM

            tracks.forEach(track => {
                const activeNotes = new Map(); // MIDI note → start event

                track.events.forEach(event => {
                    // USER FIX: Extract tempo from MIDI events
                    if (event.type === 'tempo') {
                        tempo = event.tempo;
                    }

                    if (event.type === 'noteOn') {
                        // Stocker le début de la note
                        activeNotes.set(event.note, event);
                    } else if (event.type === 'noteOff') {
                        // Trouver le noteOn correspondant
                        const startEvent = activeNotes.get(event.note);
                        if (startEvent) {
                            const durationTicks = event.time - startEvent.time;
                            const beat = startEvent.time / division;

                            allNotes.push({
                                midi: event.note,
                                startTime: startEvent.time,
                                endTime: event.time,
                                durationTicks: durationTicks,
                                beat: beat,
                                velocity: startEvent.velocity,
                                tempo: tempo
                            });

                            activeNotes.delete(event.note);
                        }
                    }
                });
            });

            // Trier par temps de début
            allNotes.sort((a, b) => a.startTime - b.startTime);

            // ✅ USER REQUEST: NO RESTS - Only notes! Rests are removed
            // Notes are processed directly without inserting silences
            const notesWithRests = [];
            let currentTime = 0;

            allNotes.forEach((note, index) => {
                const noteBeat = note.beat;

                // Add the note (no rest insertion - continuous playback)
                notesWithRests.push(note);
                currentTime = noteBeat + (note.durationTicks / division);
            });

            // USER FIX: Return both notes and tempo for use in parse()
            return {
                notes: notesWithRests.length > 0 ? notesWithRests : allNotes,
                tempo: tempo
            };
        }

        // Binary reading helpers
        readString(length) {
            let str = '';
            for (let i = 0; i < length; i++) {
                str += String.fromCharCode(this.data[this.pos++]);
            }
            return str;
        }

        readUint8() {
            return this.data[this.pos++];
        }

        readUint16() {
            const value = (this.data[this.pos] << 8) | this.data[this.pos + 1];
            this.pos += 2;
            return value;
        }

        readUint32() {
            const value = (this.data[this.pos] << 24) | (this.data[this.pos + 1] << 16) |
                          (this.data[this.pos + 2] << 8) | this.data[this.pos + 3];
            this.pos += 4;
            return value;
        }

        readVarLen() {
            let value = 0;
            let byte;
            do {
                byte = this.readUint8();
                value = (value << 7) | (byte & 0x7F);
            } while (byte & 0x80);
            return value;
        }
    }

    /**
     * MusicXML Parser Class
     * Parses MusicXML files (.musicxml, .xml) into note data for the sightreading engine.
     * Supports: notes, rests, chords, accidentals, key signatures, time signatures,
     * dynamics, articulations, ties, and multi-staff (grand staff) notation.
     */
    class MusicXMLParser {
        constructor(xmlString) {
            const parser = new DOMParser();
            this.doc = parser.parseFromString(xmlString, 'text/xml');

            // Check for parse errors
            const parseError = this.doc.querySelector('parsererror');
            if (parseError) {
                throw new Error('Invalid MusicXML file: ' + parseError.textContent.substring(0, 100));
            }
        }

        parse() {
            const result = {
                title: '',
                composer: '',
                tempo: 120,
                timeSignature: '4/4',
                keySignature: 'C',
                divisions: 1,
                notes: [],
                measures: [] // Per-measure metadata for rendering
            };

            // Extract metadata
            const workTitle = this.doc.querySelector('work > work-title');
            const movementTitle = this.doc.querySelector('movement-title');
            const creator = this.doc.querySelector('identification > creator[type="composer"]');

            result.title = (movementTitle && movementTitle.textContent) ||
                          (workTitle && workTitle.textContent) || 'Untitled';
            result.composer = (creator && creator.textContent) || '';

            // Get all parts - find the piano part
            const parts = this.doc.querySelectorAll('part');
            if (parts.length === 0) {
                throw new Error('No parts found in MusicXML file');
            }

            // Try to find piano part, otherwise use first part
            let part = parts[0];
            const partList = this.doc.querySelectorAll('part-list > score-part');
            for (let i = 0; i < partList.length; i++) {
                const partName = partList[i].querySelector('part-name');
                if (partName) {
                    const name = partName.textContent.toLowerCase();
                    if (name.includes('piano') || name.includes('keyboard') || name.includes('klavier')) {
                        const partId = partList[i].getAttribute('id');
                        // Escape partId for CSS selector to prevent injection
                        const safeId = CSS.escape ? CSS.escape(partId) : partId.replace(/[^\w-]/g, '');
                        const found = this.doc.querySelector(`part[id="${safeId}"]`);
                        if (found) { part = found; break; }
                    }
                }
            }

            const measures = part.querySelectorAll('measure');

            // Security: limit measure count to prevent memory exhaustion
            const MAX_MEASURES = 5000;
            if (measures.length > MAX_MEASURES) {
                console.warn(`MusicXML has ${measures.length} measures, truncating to ${MAX_MEASURES}`);
            }

            let currentDivisions = 1;
            let currentKeyFifths = 0;
            let currentTimeSigBeats = 4;
            let currentTimeSigBeatType = 4;
            let currentTempo = 120;
            let staves = 1; // Track number of staves (1 or 2 for grand staff)

            // Repeat tracking: detect forward/backward repeat barlines
            const repeatMarkers = []; // { startMeasure, endMeasure, times }
            let repeatStartMeasure = 0; // Default: repeat from beginning

            measures.forEach((measure, measureIndex) => {
                // Security: skip measures beyond limit
                if (measureIndex >= MAX_MEASURES) return;

                // Check for repeat barlines
                const barlines = measure.querySelectorAll('barline');
                barlines.forEach(barline => {
                    const repeat = barline.querySelector('repeat');
                    if (repeat) {
                        const dir = repeat.getAttribute('direction');
                        if (dir === 'forward') {
                            repeatStartMeasure = measureIndex;
                        } else if (dir === 'backward') {
                            const times = parseInt(repeat.getAttribute('times')) || 2;
                            repeatMarkers.push({
                                startMeasure: repeatStartMeasure,
                                endMeasure: measureIndex,
                                times: times
                            });
                            // Reset start for next repeat section
                            repeatStartMeasure = measureIndex + 1;
                        }
                    }
                });

                // Check for attributes (key, time, divisions changes)
                const attributes = measure.querySelector('attributes');
                if (attributes) {
                    const div = attributes.querySelector('divisions');
                    if (div) currentDivisions = Math.max(1, parseInt(div.textContent) || 1);

                    const stavesElem = attributes.querySelector('staves');
                    if (stavesElem) staves = parseInt(stavesElem.textContent) || 1;

                    const key = attributes.querySelector('key > fifths');
                    if (key) {
                        currentKeyFifths = parseInt(key.textContent) || 0;
                        result.keySignature = this._fifthsToKey(currentKeyFifths);
                    }

                    const timeBeats = attributes.querySelector('time > beats');
                    const timeBeatType = attributes.querySelector('time > beat-type');
                    if (timeBeats) currentTimeSigBeats = parseInt(timeBeats.textContent) || 4;
                    if (timeBeatType) currentTimeSigBeatType = parseInt(timeBeatType.textContent) || 4;
                    result.timeSignature = `${currentTimeSigBeats}/${currentTimeSigBeatType}`;
                }

                // Check for tempo and dynamics in direction elements
                const directions = measure.querySelectorAll('direction');
                directions.forEach(dir => {
                    const sound = dir.querySelector('sound');
                    if (sound) {
                        const tempo = sound.getAttribute('tempo');
                        if (tempo) { currentTempo = parseFloat(tempo); result.tempo = currentTempo; }
                        const dynamics = sound.getAttribute('dynamics');
                        if (dynamics) {
                            // Store dynamic marking for this measure
                            if (!result.dynamics) result.dynamics = [];
                            result.dynamics.push({
                                measure: measureIndex,
                                value: parseFloat(dynamics),
                                type: this._dynamicsValueToName(parseFloat(dynamics))
                            });
                        }
                    }
                    // Check for explicit dynamic markings (pp, p, mp, mf, f, ff, etc.)
                    const dynamicsElem = dir.querySelector('dynamics');
                    if (dynamicsElem) {
                        const dynChild = dynamicsElem.firstElementChild;
                        if (dynChild) {
                            if (!result.dynamics) result.dynamics = [];
                            result.dynamics.push({
                                measure: measureIndex,
                                type: dynChild.tagName // pp, p, mp, mf, f, ff, etc.
                            });
                        }
                    }
                    // Check for wedges (crescendo/diminuendo)
                    const wedge = dir.querySelector('wedge');
                    if (wedge) {
                        if (!result.wedges) result.wedges = [];
                        result.wedges.push({
                            measure: measureIndex,
                            type: wedge.getAttribute('type') // crescendo, diminuendo, stop
                        });
                    }
                    // Check for pedal markings
                    const pedalElem = dir.querySelector('direction-type > pedal');
                    if (pedalElem) {
                        if (!result.pedalMarks) result.pedalMarks = [];
                        result.pedalMarks.push({
                            measure: measureIndex,
                            type: pedalElem.getAttribute('type'), // start, stop, change
                            line: pedalElem.getAttribute('line') === 'yes'
                        });
                    }
                    // Check for rehearsal marks
                    const rehearsal = dir.querySelector('direction-type > rehearsal');
                    if (rehearsal) {
                        if (!result.rehearsalMarks) result.rehearsalMarks = [];
                        result.rehearsalMarks.push({
                            measure: measureIndex,
                            text: rehearsal.textContent
                        });
                    }
                });
                // Also check top-level sound elements
                const topSounds = measure.querySelectorAll(':scope > sound');
                topSounds.forEach(sound => {
                    const tempo = sound.getAttribute('tempo');
                    if (tempo) { currentTempo = parseFloat(tempo); result.tempo = currentTempo; }
                });

                // Store measure metadata (including key/time sig for mid-piece changes)
                result.measures.push({
                    index: measureIndex,
                    timeSignature: `${currentTimeSigBeats}/${currentTimeSigBeatType}`,
                    beatsPerMeasure: currentTimeSigBeats,
                    beatType: currentTimeSigBeatType,
                    divisions: currentDivisions,
                    keySignature: this._fifthsToKey(currentKeyFifths)
                });

                // Per-voice beat tracking for proper multi-voice handling
                const voiceBeatPositions = {};
                let mainBeat = 0; // Fallback beat tracker

                const children = measure.children;
                for (let i = 0; i < children.length; i++) {
                    const elem = children[i];

                    if (elem.tagName === 'note') {
                        // Skip grace notes (they don't occupy time)
                        const isGrace = elem.querySelector('grace') !== null;
                        const isChord = elem.querySelector('chord') !== null;
                        const voiceElem = elem.querySelector('voice');
                        const voiceNum = voiceElem ? parseInt(voiceElem.textContent) || 1 : 1;

                        // Initialize voice beat position if needed
                        if (voiceBeatPositions[voiceNum] === undefined) {
                            voiceBeatPositions[voiceNum] = mainBeat;
                        }

                        // MusicXML chord: <chord/> means this note starts at same time as previous note
                        // The previous note already advanced voiceBeatPositions, so we revert it
                        let safeBeatDivisions;
                        if (isChord) {
                            // Use the stored chord origin (where the chord started)
                            safeBeatDivisions = Math.max(0, voiceBeatPositions['_chordOrigin_' + voiceNum] || 0);
                        } else {
                            safeBeatDivisions = voiceBeatPositions[voiceNum];
                            // Store the origin for any following chord notes
                            voiceBeatPositions['_chordOrigin_' + voiceNum] = safeBeatDivisions;
                        }

                        const noteData = this._parseNote(elem, measureIndex, safeBeatDivisions, currentDivisions, currentTimeSigBeats, staves);

                        if (noteData && !isGrace) {
                            result.notes.push(noteData);
                        }

                        // Advance beat for non-chord, non-grace notes
                        if (!isChord && !isGrace) {
                            const duration = elem.querySelector('duration');
                            if (duration) {
                                const dur = parseInt(duration.textContent) || 0;
                                voiceBeatPositions[voiceNum] = (voiceBeatPositions[voiceNum] || 0) + dur;
                                // Also advance main beat to highest voice position
                                mainBeat = Math.max(mainBeat, voiceBeatPositions[voiceNum]);
                            }
                        }
                    } else if (elem.tagName === 'forward') {
                        const duration = elem.querySelector('duration');
                        if (duration) {
                            const dur = parseInt(duration.textContent) || 0;
                            mainBeat += dur;
                            // Forward only advances main beat position, not individual voices
                            // Per MusicXML spec, forward is for spacing, not voice-specific advancement
                        }
                    } else if (elem.tagName === 'backup') {
                        const duration = elem.querySelector('duration');
                        if (duration) {
                            const dur = parseInt(duration.textContent) || 0;
                            mainBeat = Math.max(0, mainBeat - dur);
                            // After backup, the next voice's notes start from the backed-up position
                            // Set all voice positions to the new mainBeat so the next voice starts correctly
                            // Also reset chord origins — stale origins after backup cause wrong timing
                            Object.keys(voiceBeatPositions).forEach(v => {
                                voiceBeatPositions[v] = mainBeat;
                            });
                        }
                    }
                }
            });

            // Expand repeats: duplicate notes from repeated sections
            if (repeatMarkers.length > 0) {
                // Process repeats in reverse order to maintain correct measure indices
                for (let ri = repeatMarkers.length - 1; ri >= 0; ri--) {
                    const rep = repeatMarkers[ri];
                    // times=2 means play twice total, so add 1 extra copy
                    const extraCopies = rep.times - 1;
                    if (extraCopies <= 0) continue;

                    // Find all notes in the repeat section
                    const repeatNotes = result.notes.filter(n =>
                        n.measure >= rep.startMeasure && n.measure <= rep.endMeasure
                    );

                    const sectionLength = rep.endMeasure - rep.startMeasure + 1;

                    // Shift all notes AFTER the repeat section forward
                    const shift = sectionLength * extraCopies;
                    result.notes.forEach(n => {
                        if (n.measure > rep.endMeasure) {
                            n.measure += shift;
                        }
                    });

                    // Also shift measure metadata
                    result.measures.forEach(m => {
                        if (m.index > rep.endMeasure) {
                            m.index += shift;
                        }
                    });

                    // Add copies of the repeated notes
                    for (let copy = 1; copy <= extraCopies; copy++) {
                        const offset = sectionLength * copy;
                        repeatNotes.forEach(n => {
                            const clone = Object.assign({}, n);
                            clone.measure = n.measure + offset;
                            result.notes.push(clone);
                        });
                    }
                }

                // Re-sort notes after repeat expansion
                result.notes.sort((a, b) => {
                    if (a.measure !== b.measure) return a.measure - b.measure;
                    return a.beat - b.beat;
                });
            }

            result.divisions = currentDivisions;
            result.staves = staves;
            return result;
        }

        _getNoteDuration(noteElem) {
            const duration = noteElem.querySelector('duration');
            return duration ? parseInt(duration.textContent) || 0 : 0;
        }

        _parseNote(noteElem, measureIndex, currentBeatDivisions, divisions, beatsPerMeasure, staves) {
            const isRest = noteElem.querySelector('rest') !== null;
            const duration = noteElem.querySelector('duration');
            const type = noteElem.querySelector('type');
            const staff = noteElem.querySelector('staff');
            const dot = noteElem.querySelector('dot');
            const dots = noteElem.querySelectorAll('dot'); // Multiple dots possible
            const voice = noteElem.querySelector('voice');
            const printObject = noteElem.getAttribute('print-object');

            // Skip hidden notes
            if (printObject === 'no') return null;

            const durationVal = duration ? (parseInt(duration.textContent) || divisions) : divisions;
            const beatPosition = divisions > 0 ? currentBeatDivisions / divisions : 0;

            // Determine note duration name
            let durationName = 'quarter';
            if (type) {
                const typeMap = {
                    'whole': 'whole', 'half': 'half', 'quarter': 'quarter',
                    'eighth': 'eighth', '16th': 'sixteenth', '32nd': 'thirty-second',
                    '64th': 'thirty-second', '128th': 'thirty-second',
                    'breve': 'whole', 'long': 'whole'
                };
                durationName = typeMap[type.textContent] || 'quarter';
            } else {
                // Infer from duration value
                const beats = divisions > 0 ? durationVal / divisions : 1;
                if (beats >= 4) durationName = 'whole';
                else if (beats >= 2) durationName = 'half';
                else if (beats >= 1) durationName = 'quarter';
                else if (beats >= 0.5) durationName = 'eighth';
                else durationName = 'sixteenth';
            }

            // Handle dotted notes
            if (dots.length > 0) {
                durationName = 'dotted-' + durationName;
            }

            // Handle tuplets - extract actual-notes count for visual indicator
            const timeModification = noteElem.querySelector('time-modification');
            let isTuplet = false;
            let tupletActual = 0;
            if (timeModification) {
                isTuplet = true;
                const actualNotes = timeModification.querySelector('actual-notes');
                tupletActual = actualNotes ? parseInt(actualNotes.textContent) || 3 : 3;
            }

            if (isRest) {
                // Determine staff for rests
                let staffName = 'treble';
                if (staff) {
                    staffName = parseInt(staff.textContent) === 2 ? 'bass' : 'treble';
                }
                return {
                    midi: null,
                    isRest: true,
                    duration: durationName,
                    measure: measureIndex,
                    beat: beatPosition,
                    staff: staffName,
                    velocity: 0,
                    voice: voice ? parseInt(voice.textContent) || 1 : 1,
                    isTuplet: isTuplet
                };
            }

            // Parse pitch
            const pitch = noteElem.querySelector('pitch');
            if (!pitch) return null;

            const step = pitch.querySelector('step');
            const octave = pitch.querySelector('octave');
            const alter = pitch.querySelector('alter');

            if (!step || !octave) return null;

            const stepName = step.textContent;
            const octaveNum = parseInt(octave.textContent);
            const alterVal = alter ? parseFloat(alter.textContent) : 0;

            // Convert to MIDI
            const midi = this._pitchToMidi(stepName, octaveNum, Math.round(alterVal));

            // Determine accidental
            let accidental = null;
            const accElem = noteElem.querySelector('accidental');
            if (accElem) {
                const accMap = {
                    'sharp': 'sharp', 'flat': 'flat', 'natural': 'natural',
                    'double-sharp': 'sharp', 'double-flat': 'flat',
                    'sharp-sharp': 'sharp', 'flat-flat': 'flat',
                    'quarter-flat': 'flat', 'quarter-sharp': 'sharp'
                };
                accidental = accMap[accElem.textContent] || null;
            } else if (Math.round(alterVal) === 1) {
                accidental = 'sharp';
            } else if (Math.round(alterVal) === -1) {
                accidental = 'flat';
            }

            // Determine staff - use explicit staff assignment when available
            let staffName;
            let xmlStaffExplicit = false;
            if (staff) {
                staffName = parseInt(staff.textContent) === 2 ? 'bass' : 'treble';
                xmlStaffExplicit = true; // MusicXML explicitly assigned this staff
            } else if (staves >= 2) {
                // Grand staff: auto-assign based on MIDI
                staffName = midi >= 60 ? 'treble' : 'bass';
            } else {
                staffName = 'treble';
            }

            // Check for tie
            const tieStart = noteElem.querySelector('tie[type="start"]');
            const tieStop = noteElem.querySelector('tie[type="stop"]');

            // Check for beam info
            const beams = noteElem.querySelectorAll('beam');
            let beamInfo = null;
            if (beams.length > 0) {
                beamInfo = beams[0].textContent; // 'begin', 'continue', 'end'
            }

            // Extract articulations (staccato, accent, tenuto, etc.)
            const notations = noteElem.querySelector('notations');
            let articulations = null;
            let ornaments = null;
            let slur = null;
            let pedal = null;
            let fingering = null;
            let fermata = false;
            let arpeggiate = false;

            if (notations) {
                // Articulations
                const articulationsElem = notations.querySelector('articulations');
                if (articulationsElem) {
                    articulations = [];
                    const artChildren = articulationsElem.children;
                    for (let ai = 0; ai < artChildren.length; ai++) {
                        articulations.push(artChildren[ai].tagName); // staccato, accent, tenuto, staccatissimo, etc.
                    }
                    if (articulations.length === 0) articulations = null;
                }

                // Ornaments (trill, turn, mordent, tremolo, etc.)
                const ornamentsElem = notations.querySelector('ornaments');
                if (ornamentsElem) {
                    ornaments = [];
                    const ornChildren = ornamentsElem.children;
                    for (let oi = 0; oi < ornChildren.length; oi++) {
                        const tag = ornChildren[oi].tagName;
                        if (tag === 'tremolo') {
                            ornaments.push({ type: 'tremolo', value: parseInt(ornChildren[oi].textContent) || 1 });
                        } else {
                            ornaments.push({ type: tag }); // trill-mark, turn, inverted-turn, mordent, inverted-mordent
                        }
                    }
                    if (ornaments.length === 0) ornaments = null;
                }

                // Slurs
                const slurElem = notations.querySelector('slur');
                if (slurElem) {
                    slur = {
                        type: slurElem.getAttribute('type'), // start, stop, continue
                        number: parseInt(slurElem.getAttribute('number')) || 1
                    };
                }

                // Fermata
                if (notations.querySelector('fermata')) {
                    fermata = true;
                }

                // Arpeggiate
                if (notations.querySelector('arpeggiate')) {
                    arpeggiate = true;
                }

                // Fingering (from technical element)
                const technical = notations.querySelector('technical');
                if (technical) {
                    const fingeringElem = technical.querySelector('fingering');
                    if (fingeringElem) {
                        fingering = parseInt(fingeringElem.textContent) || null;
                    }
                }
            }

            const noteResult = {
                midi: midi,
                isRest: false,
                duration: durationName,
                measure: measureIndex,
                beat: beatPosition,
                staff: staffName,
                _xmlStaff: xmlStaffExplicit, // Preserve MusicXML explicit staff assignment
                accidental: accidental,
                velocity: 80,
                tieStart: !!tieStart,
                tieStop: !!tieStop,
                voice: voice ? parseInt(voice.textContent) || 1 : 1,
                beamInfo: beamInfo,
                isTuplet: isTuplet,
                tupletActual: tupletActual,
                noteName: stepName + (Math.round(alterVal) === 1 ? '#' : Math.round(alterVal) === -1 ? 'b' : '') + octaveNum
            };

            // Only add optional fields when present (keeps objects small)
            if (articulations) noteResult.articulations = articulations;
            if (ornaments) noteResult.ornaments = ornaments;
            if (slur) noteResult.slur = slur;
            if (fermata) noteResult.fermata = true;
            if (arpeggiate) noteResult.arpeggiate = true;
            if (fingering) noteResult.fingering = fingering;

            return noteResult;
        }

        _dynamicsValueToName(value) {
            if (value <= 20) return 'ppp';
            if (value <= 35) return 'pp';
            if (value <= 50) return 'p';
            if (value <= 65) return 'mp';
            if (value <= 80) return 'mf';
            if (value <= 95) return 'f';
            if (value <= 110) return 'ff';
            return 'fff';
        }

        _pitchToMidi(step, octave, alter) {
            const stepToSemitone = {
                'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11
            };
            return (octave + 1) * 12 + (stepToSemitone[step] || 0) + alter;
        }

        _fifthsToKey(fifths) {
            const sharpKeys = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
            const flatKeys = ['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];

            if (fifths >= 0 && fifths < sharpKeys.length) return sharpKeys[fifths];
            if (fifths < 0 && Math.abs(fifths) < flatKeys.length) return flatKeys[Math.abs(fifths)];
            return 'C';
        }
    }

    /**
     * ChordDetector Class
     * Detects chords by buffering notes played within a short time window
     * PRIO 1 FIX: Enables chord recognition in all modes
     */
    class ChordDetector {
        constructor(windowMs = 100) {
            this.windowMs = windowMs; // Time window to consider notes as chord (100ms)
            this.buffer = []; // Buffer of recent notes with timestamps
            this.lastProcessedTime = 0;
        }

        /**
         * Add a note to the buffer
         * @param {number} midi - MIDI note number
         * @param {number} timestamp - Timestamp in ms (performance.now())
         */
        addNote(midi, timestamp = performance.now()) {
            this.buffer.push({
                midi: midi,
                timestamp: timestamp
            });
        }

        /**
         * Get current chord (notes within time window)
         * CRITICAL FIX: Don't filter by current time - use timeout mechanism instead
         * The timeout in handleNoteInput already waits for chord completion
         * Filtering by time was causing first notes to be removed when timeout fires
         * @returns {Array<number>} Array of MIDI numbers forming current chord
         */
        getCurrentChord() {
            // CRITICAL FIX: Don't filter by time - all notes in buffer are valid
            // The timeout mechanism ensures we only process after chord completion
            // Previous bug: notes played >100ms before timeout would be filtered out
            // causing chord recognition to fail

            // If buffer is empty, return empty array
            if (this.buffer.length === 0) {
                return [];
            }

            // OPTIONAL: Only filter if notes are VERY old (> 500ms) as safety net
            const now = performance.now();
            const veryOldThreshold = 500; // 500ms safety threshold
            this.buffer = this.buffer.filter(note => {
                return (now - note.timestamp) < veryOldThreshold;
            });

            // Extract MIDI numbers from buffer
            const chord = this.buffer.map(note => note.midi);

            // Remove duplicates (same note pressed twice quickly)
            const uniqueChord = [...new Set(chord)];

            // Sort chord ascending (lowest to highest)
            uniqueChord.sort((a, b) => a - b);

            return uniqueChord;
        }

        /**
         * Get current chord WITH timestamps (for Free Mode sequential vs simultaneous detection)
         * CRITICAL FIX: Same as getCurrentChord - don't filter by time
         * @returns {Array<{midi: number, timestamp: number}>} Array of note objects with MIDI and timestamps
         */
        getChordWithTimestamps() {
            // CRITICAL FIX: Don't filter by time - timeout mechanism handles freshness
            // Only filter very old notes (> 500ms) as safety net
            const now = performance.now();
            const veryOldThreshold = 500;
            this.buffer = this.buffer.filter(note => {
                return (now - note.timestamp) < veryOldThreshold;
            });

            // Sort by timestamp (oldest first), then by MIDI
            const chordWithTimestamps = [...this.buffer].sort((a, b) => {
                if (Math.abs(a.timestamp - b.timestamp) < 1) { // Same timestamp (< 1ms)
                    return a.midi - b.midi; // Sort by MIDI if simultaneous
                }
                return a.timestamp - b.timestamp; // Sort by time otherwise
            });

            return chordWithTimestamps;
        }

        /**
         * Check if notes were played together (within window)
         * @returns {boolean}
         */
        isChord() {
            return this.buffer.length > 1;
        }

        /**
         * Clear the buffer
         */
        clear() {
            this.buffer = [];
        }

        /**
         * Get the time since last note
         * @returns {number} Time in ms
         */
        getTimeSinceLastNote() {
            if (this.buffer.length === 0) return Infinity;
            const lastNote = this.buffer[this.buffer.length - 1];
            return performance.now() - lastNote.timestamp;
        }
    }

    /**
     * Main Sight Reading Engine Class
     */
    class SightReadingEngine {
        constructor(container) {
            this.container = container;
            this.config = window.srtConfig || {};

            // Built-in difficulty configurations
            if (!this.config.difficulties) {
                this.config.difficulties = {
                    'beginner': {
                        note_types: ['whole', 'half'],
                        complexity_factor: 1,
                        range: ['C3', 'E5'],
                        measures: 4,
                        tempo_range: [55, 70],
                        max_interval: 3,
                        chord_prob: 0,
                        rest_prob: 0.05,
                        // Beginner: simple melody + stepwise + basic scale fragments + simple arpeggio
                        section_types: ['melody', 'stepwise', 'scale_fragment', 'simple_arpeggio']
                    },
                    'elementary': {
                        note_types: ['whole', 'half'],
                        complexity_factor: 1.2,
                        range: ['C3', 'G5'],
                        measures: 6,
                        tempo_range: [50, 65],
                        max_interval: 4,
                        chord_prob: 0,
                        rest_prob: 0.05,
                        // Elementary: more variety - scales, arpeggios, triads (broken)
                        section_types: ['melody', 'stepwise', 'scale_fragment', 'simple_arpeggio', 'broken_triad', 'melody']
                    },
                    'intermediate': {
                        note_types: ['whole', 'half', 'quarter'],
                        complexity_factor: 1.6,
                        range: ['C3', 'A5'],
                        measures: 4,
                        tempo_range: [55, 80],
                        max_interval: 5,
                        chord_prob: 0.05,
                        rest_prob: 0.08,
                        // Intermediate: scales, arpeggios, triads, simple progressions, intervals
                        section_types: ['melody', 'stepwise', 'arpeggio_melody', 'scale_fragment', 'broken_triad', 'simple_progression', 'interval_passage']
                    },
                    'advanced': {
                        note_types: ['half', 'dotted-half', 'quarter', 'dotted-quarter', 'eighth'],
                        complexity_factor: 3,
                        range: ['C2', 'C6'],
                        measures: 8,
                        tempo_range: [70, 120],
                        max_interval: 10,
                        chord_prob: 0.30,
                        rest_prob: 0.06,
                        // Advanced: all patterns including chord progressions, scale runs, dense chords
                        section_types: ['melody', 'chord_passage', 'arpeggio_melody', 'scale_run', 'dense_chords', 'interval_passage', 'triplet', 'chord_passage', 'simple_progression', 'broken_triad', 'octave_passage']
                    },
                    'expert': {
                        note_types: ['half', 'dotted-half', 'quarter', 'dotted-quarter', 'eighth', 'sixteenth'],
                        complexity_factor: 5,
                        range: ['C2', 'C7'],
                        measures: 10,
                        tempo_range: [90, 160],
                        max_interval: 24,
                        chord_prob: 0.45,
                        rest_prob: 0.03,
                        // Expert: everything, complex progressions, trills, dense chords
                        section_types: ['dense_chords', 'trill', 'arpeggio_melody', 'scale_run', 'dense_chords', 'triplet', 'chord_passage', 'simple_progression', 'octave_passage', 'interval_passage', 'broken_triad', 'dense_chords', 'trill']
                    },
                    'custom': {
                        // Custom: intermediate-level defaults, user has manually tweaked settings
                        note_types: ['whole', 'half', 'quarter'],
                        complexity_factor: 2,
                        range: ['C3', 'A5'],
                        measures: 6,
                        tempo_range: [55, 100],
                        max_interval: 6,
                        chord_prob: 0.10,
                        rest_prob: 0.05,
                        section_types: ['melody', 'stepwise', 'arpeggio_melody', 'scale_fragment', 'broken_triad', 'simple_progression', 'interval_passage']
                    }
                };
            }

            // Add notation systems to config if not present
            if (!this.config.notationSystems) {
                this.config.notationSystems = {
                    'international': {
                        'C': 'C', 'C#': 'C#', 'D': 'D', 'D#': 'D#',
                        'E': 'E', 'F': 'F', 'F#': 'F#', 'G': 'G',
                        'G#': 'G#', 'A': 'A', 'A#': 'A#', 'B': 'B'
                    },
                    'latin': {
                        'C': 'Do', 'C#': 'Do#', 'D': 'Ré', 'D#': 'Ré#',
                        'E': 'Mi', 'F': 'Fa', 'F#': 'Fa#', 'G': 'Sol',
                        'G#': 'Sol#', 'A': 'La', 'A#': 'La#', 'B': 'Si'
                    }
                };
            }

            this.canvas = null;
            this.ctx = null;
            this.piano = null;
            this.midi = null;
            this.audio = null;
            this.notes = [];
            this.currentNoteIndex = 0;
            this.midiFileLoaded = false; // CRITICAL: Track if MIDI file is loaded (prevents random note generation)
            this.isPlaying = false;
            this.isPaused = false;
            this.isListening = false; // USER REQUEST: Track Listen mode playback
            this.listenPaused = false;
            this.listenCompleted = false; // Track if listen finished naturally (for stop/play re-listen)
            this._listenResumeResolve = null;
            this.mode = 'wait'; // 'free', 'wait', or 'scroll' — default: wait with random sheet
            this.tempo = 60; // Tempo par défaut : 60 BPM
            this.freeMode_playedNotes = []; // Notes played in free mode
            this.ghostNotes = []; // USER REQUEST: Visual feedback for incorrect notes played in Wait/Scroll modes
            this.scrollPaused = false; // Pause scroll mode on wrong note
            this.sustainPedalActive = false; // USER FIX: Sustain pedal state (false = notes stop on release)
            this.exerciseMode = false; // Exercise mode: fingering numbers + next-note highlighting
            this.exerciseShowFingering = true;
            this.exerciseHighlightNext = true;
            this.score = 0;
            this.streak = 0;
            this.bestStreak = 0;
            this.correctNotes = 0;
            this.incorrectNotes = 0;
            this.sessionStartTime = null;
            this.sessionDuration = 0;
            // CRITIQUE: Position initiale calculée dynamiquement dans generateInitialNotes()
            // La barre dorée est positionnée où la première note apparaît
            this.initialPlayheadPosition = 0; // Will be calculated after notes are generated
            this.playheadPosition = this.initialPlayheadPosition;
            this.scrollSpeed = 1;
            this.metronomeEnabled = false;
            this.metronomeBeat = 0;
            this.achievements = [];
            this.userSettings = {};
            this.staffSettings = {
                clef: 'treble',
                keySignature: 'C',
                timeSignature: '4/4'
            };
            this.noteGenerator = null;
            this.renderer = null;
            this.animationFrame = null;
            this.lastFrameTime = 0;
            this.deltaTime = 0;
            this._renderDirty = true;  // Dirty flag for render optimization
            this._initialized = false; // True after full init (canvas+renderer+animLoop ready)
            this._saveSettingsTimer = null; // Debounce timer for saveSettings AJAX
            this._ajaxEnabled = false; // Only true after first successful AJAX or valid nonce check

            // Chord detection system (PRIO 1 FIX)
            this.chordDetector = new ChordDetector();
            this.pendingNotes = []; // Buffer for notes being processed

            // Wait Mode improvements (PRIO 2)
            this.waitModeAttempts = 0; // Number of attempts for current note
            this.waitModeHintsEnabled = true; // Show hints after 3 wrong attempts
            this.waitModeOctaveTolerance = false; // Accept notes in different octaves
            this.waitModeMaxHints = 3; // Max wrong attempts before hint
            this.waitModeNoteStartTime = 0; // Timestamp when current note started

            // USER REQUEST: Wait mode auto-scroll
            this.waitModeScrollOffset = 0; // Scroll offset for wait mode
            this.waitModeVisibleWidth = 800; // Approximate visible width of notes area

            this.init();
        }
        
        /**
         * Initialize the engine with visible progress
         */
        async init() {
            try {
                // Fast init — no artificial delays. Progress updates are visual-only.
                this.updateLoadingProgress(5, 'Loading user settings...');
                this.loadUserSettings();

                this.updateLoadingProgress(15, 'Setting up canvas...');
                this.setupCanvas();

                this.updateLoadingProgress(30, 'Creating virtual piano...');
                this.setupPiano();

                this.updateLoadingProgress(50, 'Configuring MIDI...');
                this.setupMIDI();

                this.updateLoadingProgress(65, 'Initializing audio...');
                this.setupAudio();

                this.updateLoadingProgress(75, 'Setting up controls...');
                this.setupEventListeners();

                this.updateLoadingProgress(85, 'Preparing note generator...');
                this.setupNoteGenerator();

                this.updateLoadingProgress(92, 'Setting up renderer...');
                this.setupRenderer();

                this.updateLoadingProgress(95, 'Loading statistics...');
                this.loadOverallStats();

                // Ne PAS générer de notes en mode free par défaut
                this.notes = [];

                this.updateLoadingProgress(100, 'Ready!');
                // Brief pause so user sees 100% before button appears
                await this.delay(200);

                this.showLetsPlayButton();

            } catch (error) {
                console.error('Initialization error:', error);
                this.updateLoadingProgress(100, 'Error occurred - click to try anyway');
                this.showLetsPlayButton();
            }
        }

        /**
         * Helper delay function
         */
        delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        /**
         * Update loading progress bar and message
         */
        updateLoadingProgress(percent, message) {
            const $percentage = $('#srtLoadingPercentage');
            const $tips = $('#srtLoadingTips p');
            const ring = document.getElementById('srtLoadingRing');

            if ($percentage.length) {
                $percentage.text(Math.round(percent) + '%');
            }
            if ($tips.length && message) {
                $tips.text(message);
            }
            // Update SVG ring progress (ring wraps around logo, r=90)
            if (ring) {
                const circumference = 2 * Math.PI * 90; // r=90
                const offset = circumference - (percent / 100) * circumference;
                ring.style.strokeDashoffset = offset;
            }
        }

        /**
         * Show Let's Play button
         */
        showLetsPlayButton() {
            const $btn = $('#srtLetsPlayBtn');
            if ($btn.length) {
                $btn.prop('disabled', false);
                $btn.css({
                    'display': 'inline-flex',
                    'opacity': 0
                });
                $btn.animate({ 'opacity': 1 }, 500);

                // Attach click handler
                $btn.off('click').on('click', async () => {
                    // ✅ START AUDIO CONTEXT HERE (after user gesture)
                    try {
                        await this.audio.startAudio();
                    } catch (error) {
                        console.error('❌ Error starting audio:', error);
                    }

                    this.hideLoadingScreen();

                    // RE-INITIALIZE canvas and piano NOW that interface is visible
                    setTimeout(() => {
                        this.setupCanvas();
                        this.setupPiano();
                        this.setupRenderer();
                        // Mark as fully initialized — render() calls are now safe
                        this._initialized = true;
                        this._ajaxEnabled = !!(this.config.isLoggedIn && this.config.nonce && this.config.ajaxUrl);
                        // Don't generate notes in free mode
                        if (this.mode !== 'free') {
                            this.generateInitialNotes();
                        }
                        this.startAnimationLoop();
                    }, 600); // Wait for fadeIn to complete
                });

            } else {
                console.warn('⚠️ Let\'s Play button not found, using auto-start fallback');
                // Fallback: auto-start the app after loading
                setTimeout(() => {
                    // Start audio (may not work without user gesture, but try)
                    this.audio.startAudio().catch(() => {
                        console.warn('⚠️ Audio not started (needs user interaction)');
                    });

                    this.hideLoadingScreen();
                    this.setupCanvas();
                    this.setupPiano();
                    this.setupRenderer();
                    this._initialized = true;
                    this._ajaxEnabled = !!(this.config.isLoggedIn && this.config.nonce && this.config.ajaxUrl);
                    if (this.mode !== 'free') {
                        this.generateInitialNotes();
                    }
                    this.startAnimationLoop();
                }, 2000); // Wait 2s for loading to complete
            }
        }
        
        /**
         * Load user settings
         */
        loadUserSettings() {
            this.userSettings = {
                ...this.config.userSettings,
                ...this.getLocalSettings()
            };

            // Default to ELEMENTARY on page load
            // Elementary = grand staff (2 staves), single notes, 2 hands, easy keys
            this.userSettings.difficulty = 'elementary';
            this.userSettings.hands_count = 2;
            this.userSettings.notes_count = 1;
            this.userSettings.key_signature = 'C';

            // Set grand staff for elementary (2 staves: treble + bass)
            this.staffSettings.clef = 'grand';
            this.staffSettings.keySignature = 'C';

            // GEO-NOTATION: Default notation system from geo-detection if not already set
            if (!this.userSettings.notation_system) {
                this.userSettings.notation_system = (window.pmNotation && window.pmNotation.system) || 'international';
            }

            // Update UI to show 'elementary' as active difficulty
            setTimeout(() => {
                // Difficulty select
                $('#srtDifficultySelect').val('elementary');
                // Update hands slider UI to match
                $('#srtHandsSlider').val(2);
                $('#srtHandsValue').text(2);
                // Update clef UI to grand
                $('.srt-btn-option[data-clef]').removeClass('active');
                $('.srt-btn-option[data-clef="grand"]').addClass('active');
                // Update key UI
                $('.srt-key-btn').removeClass('active');
                $(`.srt-key-btn[data-key="C"]`).addClass('active');
                // Mode buttons: highlight 'wait' as default
                $('.srt-mode-btn').removeClass('active');
                $(`.srt-mode-btn[data-mode="wait"]`).addClass('active');
                // Show counting checkbox (not free mode)
                $('#srtShowCounting').parent('.srt-checkbox-label-bottom').show();
                // Sync notation dropdown with geo-detected default
                if (this.userSettings.notation_system) {
                    $('#srtNotationSystem').val(this.userSettings.notation_system);
                }
            }, 100);
        }
        
        /**
         * Get settings from localStorage
         */
        getLocalSettings() {
            try {
                const settings = localStorage.getItem('srt_settings');
                return settings ? JSON.parse(settings) : {};
            } catch (e) {
                console.error('Failed to load local settings:', e);
                return {};
            }
        }
        
        /**
         * Save settings to localStorage
         */
        saveLocalSettings() {
            try {
                localStorage.setItem('srt_settings', JSON.stringify(this.userSettings));
            } catch (e) {
                console.error('Failed to save local settings:', e);
            }
        }
        
        /**
         * Setup canvas for rendering
         */
        setupCanvas() {
            this.canvas = document.getElementById('srtScoreCanvas');
            if (!this.canvas) {
                console.error('❌ Canvas element not found');
                return;
            }

            this.ctx = this.canvas.getContext('2d');
            this.resizeCanvas();

            // Setup high DPI support
            const dpr = window.devicePixelRatio || 1;
            const rect = this.canvas.getBoundingClientRect();

            // TAILLE NORMALE - Le canvas reste à sa taille normale
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            this.ctx.scale(dpr, dpr);

            // Set canvas styles - TAILLE NORMALE
            this.canvas.style.width = rect.width + 'px';
            this.canvas.style.height = rect.height + 'px';

        }
        
        /**
         * Resize canvas to fit container
         */
        resizeCanvas() {
            const container = this.canvas.parentElement;
            const rect = container.getBoundingClientRect();

            this.canvas.style.width = rect.width + 'px';
            this.canvas.style.height = rect.height + 'px';

            const dpr = window.devicePixelRatio || 1;
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;

            if (this.ctx) {
                this.ctx.scale(dpr, dpr);
            }

            // Force staff position recalculation on resize
            if (this.renderer) {
                this.renderer.staffY = null;
            }
            // Invalidate cached canvas width for playhead positioning
            this._cachedCanvasWidth = rect.width;
        }
        
        /**
         * Setup virtual piano keyboard
         */
        setupPiano() {
            this.piano = new VirtualPiano(this);
            this.piano.init();

            // USER FIX: Initialize piano with the default notation system (international)
            // This ensures piano labels match the staff's default
            const notationSystem = this.userSettings.notation_system || 'international';
            this.piano.updateNoteNameSystem(notationSystem);

            // Keyboard mapping: only show if user previously enabled it in settings
            const showKbMapping = this.userSettings.show_keyboard_mapping === true;
            if (showKbMapping) {
                this.piano.showKeyboardMapping(true);
                $('#srtShowKeyboardMapping').prop('checked', true);
            }
        }
        
        /**
         * Setup MIDI support
         */
        setupMIDI() {
            this.midi = new MIDIManager(this);
            this.midi.init();
        }
        
        /**
         * Setup audio context and synthesis
         */
        setupAudio() {
            this.audio = new AudioManager(this);
            this.audio.init();
        }
        
        /**
         * Setup all event listeners
         */
        setupEventListeners() {
            // CRITICAL FIX: Sync UI checkboxes with userSettings on startup
            // This prevents note labels from showing when display_notes is false
            $('#srtDisplayNotes').prop('checked', this.userSettings.display_notes || false);
            $('#srtStaffNoteNames').prop('checked', this.userSettings.display_notes || false);

            // PORTRAIT MODE: "Stay in Portrait" button
            $('#srtStayPortraitBtn').on('click', () => {
                $('.srt-container').addClass('srt-portrait-mode');
                // Resize canvas for portrait dimensions
                if (this.canvas) {
                    this.resizeCanvas();
                    this.requestRender();
                }
            });

            // Hide "Show Counting" checkbox in Free mode on initial load
            if (this.mode === 'free') {
                $('#srtShowCounting').parent('.srt-checkbox-label-bottom').hide();
            }

            // Play/Pause/Stop buttons
            $('#srtPlayBtn').on('click', () => this.start());
            $('#srtPauseBtn').on('click', () => this.pause());
            $('#srtStopBtn').on('click', () => this.stop());
            $('#srtResetBtn').on('click', () => this.reset());

            // USER FIX: Listen button - Toggle listen mode (start if not listening, stop if listening)
            $('#srtListenBtn').on('click', () => {
                if (this.isListening) {
                    this.stopListening();
                } else {
                    this.listen();
                }
            });
            
            // Mode buttons
            $('.srt-mode-btn').on('click', (e) => {
                const mode = $(e.currentTarget).data('mode');
                this.setMode(mode);
            });

            // Free mode: Save composition
            $('#srtSaveComposition').on('click', () => this._saveFreeModeComposition());
            // Free mode: Export as MusicXML
            $('#srtExportXML').on('click', () => this._exportFreeModeXML());
            // Free mode: Replay saved composition
            $('#srtReplayComposition').on('click', () => this._replayFreeModeComposition());
            
            // Tempo slider
            $('#srtTempoSlider').on('input', (e) => {
                this.setTempo(parseInt(e.target.value));
            });
            
            // Metronome button
            $('#srtMetronomeBtn').on('click', () => {
                this.toggleMetronome();
            });
            
            // Settings button
            $('#srtSettingsBtn').on('click', () => {
                this.toggleSettingsPanel();
            });

            // Settings panel close (X button)
            $('#srtPanelClose, #srtSettingsPanelClose').on('click', () => {
                this.closeSettingsPanel();
            });

            // Settings panel chevron (arrow button)
            $('#srtSettingsChevron').on('click', () => {
                this.closeSettingsPanel();
            });

            // Stats button
            $('#srtStatsBtn').on('click', () => {
                this.toggleStatsPanel();
            });

            // Stats panel close (X button)
            $('#srtStatsPanelClose').on('click', () => {
                this.closeStatsPanel();
            });

            // Stats panel chevron (arrow button)
            $('#srtStatsChevron').on('click', () => {
                this.closeStatsPanel();
            });

            // Fullscreen button
            $('#srtFullscreenBtn').on('click', () => {
                this.toggleFullscreen();
            });

            // Difficulty selector
            $('#srtDifficultySelect').on('change', (e) => {
                this.setDifficulty(e.target.value);
            });

            // CORRECTED: Staff type buttons (HTML uses .srt-staff-btn not .srt-btn-option)
            $('.srt-staff-btn').on('click', (e) => {
                const staff = $(e.currentTarget).data('staff');
                $('.srt-staff-btn').removeClass('active');
                $(e.currentTarget).addClass('active');
                this.setClef(staff); // Update clef
            });

            // Generator type buttons — non-random generators mark difficulty as Custom
            $('.srt-generator-btn').on('click', (e) => {
                const generator = $(e.currentTarget).data('generator');
                $('.srt-generator-btn').removeClass('active');
                $(e.currentTarget).addClass('active');
                if (generator !== 'random') {
                    this._markCustomDifficulty();
                }
                this.setGeneratorType(generator);
            });

            // CORRECTED: Key signature buttons (HTML uses .srt-key-btn)
            $('.srt-key-btn').on('click', (e) => {
                const key = $(e.currentTarget).data('key');
                $('.srt-key-btn').removeClass('active');
                $(e.currentTarget).addClass('active');
                this.setKeySignature(key);
            });

            // Notes per chord slider — adds/removes harmony to existing notes
            $('#srtNotesSlider').on('input', (e) => {
                const value = parseInt(e.target.value);
                $('#srtNotesValue').text(value);
                this.userSettings.notes_count = value;
                this._markCustomDifficulty();
                if (this.mode !== 'free' && this.notes && this.notes.length > 0) {
                    this._adjustChordDensity(value);
                }
            });

            // Hands slider — adds bass clef notes to existing or removes them
            $('#srtHandsSlider').on('input', (e) => {
                const value = parseInt(e.target.value);
                $('#srtHandsValue').text(value);
                this.userSettings.hands_count = value;
                this._markCustomDifficulty();
                if (this.mode !== 'free' && this.notes && this.notes.length > 0) {
                    this._adjustHands(value);
                }
            });

            // Key Signature buttons (.srt-key-btn) control tonality for ALL generators
            // Event listeners for Key Signature buttons are already set up above (line ~402)

            $('#srtScaleType').on('change', (e) => {
                this.userSettings.scale_type = e.target.value;
                this.saveSettings();
                // Always regenerate when scale type changes (affects ALL generators, not just 'scales')
                if (this.mode !== 'free') {
                    this.generateInitialNotes();
                }
            });

            $('#srtScalePattern').on('change', (e) => {
                this.userSettings.scale_pattern = e.target.value;
                this.saveSettings();
                // Always regenerate when scale pattern changes
                if (this.mode !== 'free') {
                    this.generateInitialNotes();
                }
            });

            // Display Note Names checkbox (Settings panel - APPLIQUE AUX DEUX staff + piano)
            $('#srtDisplayNotes').on('change', (e) => {
                const isChecked = e.target.checked;

                // Apply to BOTH staff and piano separately
                this.userSettings.display_notes_staff = isChecked;
                this.userSettings.display_notes_piano = isChecked;

                // Update STAFF note names
                if (this.renderer) {
                    const system = isChecked ? this.userSettings.notation_system : 'none';
                    this.renderer.setNoteNameSystem(system);
                    this.requestRender();
                }

                // Update PIANO note labels
                const pianoContainer = document.getElementById('srtPianoContainer');
                if (pianoContainer) {
                    if (isChecked) {
                        pianoContainer.classList.add('srt-show-key-names');
                    } else {
                        pianoContainer.classList.remove('srt-show-key-names');
                    }
                }

                // Sync individual checkboxes to match settings
                $('#srtStaffNoteNames').prop('checked', isChecked);
                $('#srtPianoNoteNames').prop('checked', isChecked);

                this.saveSettings();
            });

            // Exercise Mode checkboxes
            $('#srtExerciseMode').on('change', (e) => {
                this.exerciseMode = e.target.checked;
                // Assign fingering to existing notes when exercise mode is toggled ON
                if (this.exerciseMode && this.notes && this.notes.length > 0) {
                    this._assignFingering();
                    this._lastExerciseIdx = -1; // Force recompute of next-note markers
                }
                if (!this.exerciseMode && this.piano) {
                    this.piano.clearExerciseHighlights();
                }
                this.requestRender();
                this.saveSettings();
            });
            $('#srtShowFingering').on('change', (e) => {
                this.exerciseShowFingering = e.target.checked;
                this.requestRender();
            });
            $('#srtHighlightNext').on('change', (e) => {
                this.exerciseHighlightNext = e.target.checked;
                this.requestRender();
            });

            // Staff Note Names checkbox (INDEPENDENT - only affects staff)
            $('#srtStaffNoteNames').on('change', (e) => {
                const isChecked = e.target.checked;
                this.userSettings.display_notes_staff = isChecked;

                // Update STAFF note names ONLY
                if (this.renderer) {
                    const system = isChecked ? this.userSettings.notation_system : 'none';
                    this.renderer.setNoteNameSystem(system);
                    this.requestRender();
                }

                // Do NOT sync piano or settings checkbox (independent)
                this.saveSettings();
            });

            // Show Counting checkbox (FEATURE: display beat counts under notes)
            $('#srtShowCounting').on('change', (e) => {
                const isChecked = e.target.checked;
                this.userSettings.show_counting = isChecked;

                // Update counting display
                if (this.renderer) {
                    this.renderer.showCounting = isChecked;
                    this.requestRender();
                }

                this.saveSettings();
            });

            // Piano Note Names checkbox (INDEPENDENT - only affects piano)
            $('#srtPianoNoteNames').on('change', (e) => {
                const isChecked = e.target.checked;
                this.userSettings.display_notes_piano = isChecked;

                // Update PIANO note labels ONLY
                const pianoContainer = document.getElementById('srtPianoContainer');
                if (pianoContainer) {
                    if (isChecked) {
                        pianoContainer.classList.add('srt-show-key-names');
                    } else {
                        pianoContainer.classList.remove('srt-show-key-names');
                    }
                }

                // Do NOT sync staff or settings checkbox (independent)
                this.saveSettings();
            });

            // Sustain pedal via ALT key HOLD (keydown = ON, keyup = OFF)
            // Uses centralized setSustainState() to avoid conflicts with click toggle
            $(document).on('keydown', (e) => {
                if (e.key === 'Alt' && !e.repeat) {
                    e.preventDefault();
                    this.setSustainState(true);
                }
            });
            $(document).on('keyup', (e) => {
                if (e.key === 'Alt') {
                    e.preventDefault();
                    this.setSustainState(false);
                }
            });

            // Sustain indicator click toggle
            $(document).on('click', '#srtSustainIndicator', () => {
                this.toggleSustainPedal();
            });

            // Notation System select (applies to BOTH staff and piano)
            // USER FIX: Always update BOTH immediately, no toggle required
            $('#srtNotationSystem').on('change', (e) => {
                this.userSettings.notation_system = e.target.value;

                // USER FIX: ALWAYS update renderer's note name system
                // This ensures staff notes update immediately when notation system changes
                if (this.renderer) {
                    // Check if either display_notes or individual staff notes is enabled
                    const staffNotesEnabled = this.userSettings.display_notes ||
                                               $('#srtStaffNoteNames').prop('checked');
                    if (staffNotesEnabled) {
                        this.renderer.setNoteNameSystem(e.target.value);
                    }
                    this.requestRender(); // Always re-render to apply changes immediately
                }

                // Update piano labels (re-create labels with new system)
                if (this.piano) {
                    this.piano.updateNoteNameSystem(e.target.value);
                }

                this.saveSettings();
            });

            // Computer keyboard mapping toggle (desktop only)
            // Show the setting group only on desktop (not touch devices)
            if (!('ontouchstart' in window) && window.matchMedia('(min-width: 1024px)').matches) {
                $('#srtKeyboardMappingGroup').show();
            }
            $('#srtShowKeyboardMapping').on('change', (e) => {
                this.userSettings.show_keyboard_mapping = e.target.checked;
                if (this.piano) {
                    this.piano.showKeyboardMapping(e.target.checked);
                }
                this.saveSettings();
            });

            // MIDI Refresh button
            $('#srtMidiRefreshBtn').on('click', () => {
                if (this.midiManager) {
                    this.midiManager.refreshDevices();
                }
            });

            // MIDI Through checkbox
            $('#srtMidiThrough').on('change', (e) => {
                this.userSettings.midi_through = e.target.checked;
                this.saveSettings();
            });

            // Wait Mode Settings (PRIO 2)
            $('#srtWaitModeHints').on('change', (e) => {
                this.waitModeHintsEnabled = e.target.checked;
            });

            $('#srtWaitModeOctaveTolerance').on('change', (e) => {
                this.waitModeOctaveTolerance = e.target.checked;
            });

            $('#srtWaitModeMaxHints').on('change', (e) => {
                const value = parseInt(e.target.value, 10);
                if (value >= 1 && value <= 10) {
                    this.waitModeMaxHints = value;
                }
            });

            // Populate song selector from server partitions
            this.populatePartitionSelector();

            // Load Song button - load from server partition or built-in song
            $('#srtLoadSongBtn').on('click', () => {
                const val = $('#srtSongSelect').val();
                if (!val) return;

                // Check if it's a server partition (prefixed with 'partition_')
                if (val.startsWith('partition_')) {
                    const partitionData = this.serverPartitions.find(p => 'partition_' + p.id === val);
                    if (partitionData) {
                        this.loadPartitionFromServer(partitionData);
                    }
                } else {
                    this.loadSong(val);
                }
            });

            // Score File Upload (MIDI + MusicXML)
            $('#srtMidiUpload, #srtScoreUpload').on('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    this.loadScoreFile(file);
                }
            });

            // Key signature selector
            $('#srtKeySignature').on('change', (e) => {
                this.setKeySignature(e.target.value);
            });
            
            // Time signature selector
            $('#srtTimeSignature').on('change', (e) => {
                this.setTimeSignature(e.target.value);
            });
            
            // Note range selectors — mark custom difficulty when changed
            $('#srtRangeMin, #srtRangeMax').on('change', () => {
                this._markCustomDifficulty();
                this.updateNoteRange();
            });
            
            // Hands buttons
            $('.srt-btn-option[data-hands]').on('click', (e) => {
                const hands = $(e.currentTarget).data('hands');
                this.setHands(hands);
            });
            
            // Accidentals switch
            $('#srtAccidentals').on('change', (e) => {
                this.setAccidentals(e.target.checked);
            });
            
            // Chord density slider
            $('#srtChordDensity').on('input', (e) => {
                this.setChordDensity(parseInt(e.target.value));
            });
            
            // Note names selector
            $('#srtNoteNames').on('change', (e) => {
                this.setNoteNames(e.target.value);
            });
            
            // Show keyboard switch
            $('#srtShowKeyboard').on('change', (e) => {
                this.toggleKeyboard(e.target.checked);
            });
            
            // Show stats switch
            $('#srtShowStats').on('change', (e) => {
                this.toggleStats(e.target.checked);
            });
            
            // Highlight errors switch
            $('#srtHighlightErrors').on('change', (e) => {
                this.setHighlightErrors(e.target.checked);
            });
            
            // Piano sound selector (matches HTML id="srtSoundSelect")
            $('#srtSoundSelect').on('change', (e) => {
                this.setPianoSound(e.target.value);
            });
            
            // Volume sliders (CORRIGÉ: IDs HTML corrects!)
            $('#srtVolumeSlider').on('input', (e) => {
                const volume = parseInt(e.target.value);
                this.setVolume(volume);
            });

            $('#srtMetronomeVolume').on('input', (e) => {
                this.setMetronomeVolume(parseInt(e.target.value));
            });
            
            // MIDI refresh button
            $('#srtMidiRefresh').on('click', () => {
                this.midi.refreshDevices();
            });
            
            // MIDI selectors
            $('#srtMidiInput, #srtMidiOutput, #srtMidiChannel').on('change', () => {
                this.updateMIDISettings();
            });
            
            // Octave controls
            $('#srtOctaveDown').on('click', () => {
                this.piano.changeOctave(-1);
            });
            
            $('#srtOctaveUp').on('click', () => {
                this.piano.changeOctave(1);
            });
            
            // Transpose selector
            $('#srtTranspose').on('change', (e) => {
                this.piano.setTranspose(parseInt(e.target.value));
            });
            
            // Sustain button
            $('#srtSustainBtn').on('click', () => {
                this.piano.toggleSustain();
            });
            
            // Custom sound upload
            $('#srtSoundSelect').on('change', (e) => {
                if (e.target.value === 'custom') {
                    $('#srtCustomSoundRow').show();
                } else {
                    $('#srtCustomSoundRow').hide();
                }
            });
            
            $('#srtUploadBtn').on('click', () => {
                this.uploadCustomSound();
            });
            
            // Window resize
            $(window).on('resize', () => {
                this.resizeCanvas();
                if (this.renderer) {
                    this.renderer.resize();
                }
                this.requestRender();
            });

            // ResizeObserver for when container size changes (CSS, fullscreen, etc.)
            if (typeof ResizeObserver !== 'undefined' && this.canvas.parentElement) {
                const resizeObserver = new ResizeObserver(() => {
                    this.resizeCanvas();
                    if (this.renderer) {
                        this.renderer.resize();
                    }
                    this.requestRender();
                });
                resizeObserver.observe(this.canvas.parentElement);
            }
            
            // Keyboard shortcuts
            $(document).on('keydown', (e) => {
                this.handleKeyboardShortcut(e);
            });

            // Prevent context menu on canvas
            this.canvas.addEventListener('contextmenu', (e) => {
                e.preventDefault();
            });

            // Fullscreen change event (scroll app when entering/exiting fullscreen)
            document.addEventListener('fullscreenchange', () => {
                this.handleFullscreenChange();
            });
            document.addEventListener('webkitfullscreenchange', () => {
                this.handleFullscreenChange();
            });
            document.addEventListener('mozfullscreenchange', () => {
                this.handleFullscreenChange();
            });
            document.addEventListener('MSFullscreenChange', () => {
                this.handleFullscreenChange();
            });

            // Guide Modal Event Listeners
            $('#srtGuideBtn').on('click', () => {
                $('#srtGuideModal').css('display', 'flex').hide().fadeIn(300);
            });

            $('#srtGuideClose, #srtGuideCloseBtn').on('click', () => {
                $('#srtGuideModal').fadeOut(300);
            });

            $('.srt-guide-overlay').on('click', () => {
                $('#srtGuideModal').fadeOut(300);
            });

            // Reset Stats Button
            $('#srtResetStatsBtn').on('click', () => {
                this.resetAllStats();
            });

            // Reset Stats Modal Buttons
            $('#srtResetConfirm').on('click', () => {
                this.confirmResetStats();
            });

            $('#srtResetCancel, .srt-reset-overlay').on('click', () => {
                $('#srtResetModal').fadeOut(300);
            });
        }
        
        /**
         * Setup note generator
         */
        setupNoteGenerator() {
            this.noteGenerator = new NoteGenerator(this);
        }
        
        /**
         * Setup renderer
         */
        setupRenderer() {
            this.renderer = new StaffRenderer(this);

            // Initialize note name display based on user settings
            if (this.userSettings.display_notes) {
                this.renderer.setNoteNameSystem(this.userSettings.notation_system || 'international');
            } else {
                this.renderer.setNoteNameSystem('none');
            }
        }
        
        /**
         * Generate initial notes
         * USER REQUEST: Stop Listen mode when staff changes
         */
        generateInitialNotes() {
            // USER REQUEST: Stop Listen mode when staff changes
            if (this.isListening) {
                this.stopListening();
            }

            // Reset scroll offsets when generating new notes
            this.currentNoteIndex = 0;

            // Reset stats for new exercise
            this.correctNotes = 0;
            this.incorrectNotes = 0;
            this.score = 0;
            this.streak = 0;
            this.bestStreak = 0;
            this.currentStreak = 0;
            this.updateAllDisplays();

            // Randomly assign time signature for generated exercises (not file-loaded)
            // Mostly 4/4 and 3/4, occasionally 2/4 or 6/8
            if (!this.midiFileLoaded) {
                const randomTimeSignatures = ['4/4', '4/4', '4/4', '4/4', '3/4', '3/4', '3/4', '2/4', '6/8'];
                const randomTS = randomTimeSignatures[Math.floor(Math.random() * randomTimeSignatures.length)];
                this.staffSettings.timeSignature = randomTS;
                if (this.renderer) {
                    this.renderer.setTimeSignature(randomTS);
                }
            }

            // CRITICAL FIX: If MusicXML/MIDI file is loaded, DON'T overwrite notes
            if (!this.midiFileLoaded) {
                try {
                    this.notes = this.noteGenerator.generate();
                } catch (e) {
                    console.error('Note generation error, falling back to random:', e);
                    this.notes = this.noteGenerator.generateRandomNotes();
                }
                // Safety: ensure notes is never empty (prevents disappearing staff)
                if (!this.notes || this.notes.length === 0) {
                    this.notes = this.noteGenerator.generateRandomNotes();
                }
            }

            // POST-GENERATION SANITIZATION: enforce hard constraints
            this._sanitizeGeneratedNotes();

            // CRITICAL: Sort notes by time position so same-beat notes are adjacent
            // This ensures getExpectedNotesAtIndex correctly groups chords
            this.notes.sort((a, b) => {
                const timeA = (a.measure || 0) * 100 + snapBeat(a.beat || 0);
                const timeB = (b.measure || 0) * 100 + snapBeat(b.beat || 0);
                return timeA - timeB;
            });

            // EXERCISE MODE: Assign fingering numbers if enabled
            if (this.exerciseMode) {
                this._assignFingering();
            }

            // Reset timeline beat tracker
            this._timelineMeasure = 0;
            this._timelineBeat = 0;

            // Calculate optimal measure width for current time signature and notes
            this.calculateOptimalMeasureWidth();

            // CRITICAL FIX: Calculate initial playhead position so first note appears at playhead
            // USER FIX: First note must start at SAME position in ALL modes (wait, scroll, free)
            // The visual playhead is positioned dynamically based on calculatedNoteStartX
            // For first note to appear there: firstNoteWorldX - offset = visualPlayheadX
            // So: offset = firstNoteWorldX - visualPlayheadX
            if (this.renderer && this.notes.length > 0) {
                // Dynamic playhead position: where first note starts on screen
                const visualPlayheadX = this.getVisualPlayheadX();
                const firstNote = this.notes[0];
                const firstNoteWorldX = this.renderer.getNoteX(firstNote);

                // Center the first note under the playhead band (band is 14px wide)
                // So we want the note center to be at playheadX + 7 (center of band)
                this.initialPlayheadPosition = firstNoteWorldX - visualPlayheadX - 7;
                this.playheadPosition = this.initialPlayheadPosition;

                // USER FIX: CRITICAL - Set wait mode scroll offset to SAME position
                // This ensures the first note appears at the SAME X position in both modes
                this.waitModeScrollOffset = this.initialPlayheadPosition;

                // Playhead positioned at firstNoteWorldX minus visualPlayheadX
            } else {
                // Fallback: reset to 0 if no renderer or notes
                this.waitModeScrollOffset = 0;
            }

            // CRITICAL FIX: Re-render after generating notes so they appear on screen!
            if (this.renderer) {
                this.render();
            }
        }

        /**
         * POST-GENERATION SANITIZATION
         * Enforces hard constraints on ALL generated notes.
         * Called after every generate, reset, and generateMoreNotes.
         */
        _sanitizeGeneratedNotes() {
            if (!this.notes || this.notes.length === 0) return;

            const MAX_PER_STAFF = 5;
            const handsCount = parseInt(this.userSettings.hands_count) || 1;
            const notesPerChord = parseInt(this.userSettings.notes_count) || 1;

            // TREBLE RANGE: C4(60) to C6(84) — visible on treble staff
            // BASS RANGE: C2(36) to B3(59) — visible on bass staff
            const TREBLE_MIN = 60;
            const TREBLE_MAX = 84;
            const BASS_MIN = 36;
            const BASS_MAX = 59;

            // Step 1: For hands=1 (treble only), ALL notes must be in treble range
            if (handsCount === 1) {
                this.notes = this.notes.filter(n => {
                    if (n.isRest) {
                        // Remove bass rests
                        if (n.staff === 'bass') return false;
                        return true;
                    }
                    if (!n.midi) return true;

                    // Push notes below middle C up to treble range
                    while (n.midi < TREBLE_MIN) n.midi += 12;
                    // Push notes too high down
                    while (n.midi > TREBLE_MAX) n.midi -= 12;
                    // If still out of range, discard
                    if (n.midi < TREBLE_MIN || n.midi > TREBLE_MAX) return false;

                    n.staff = 'treble';
                    return true;
                });
            } else {
                // Step 1b: For hands=2, clamp to valid ranges
                this.notes.forEach(n => {
                    if (n.isRest || !n.midi) return;
                    // Clamp to overall piano range
                    while (n.midi < BASS_MIN) n.midi += 12;
                    while (n.midi > TREBLE_MAX) n.midi -= 12;
                    // Fix staff assignment based on MIDI value
                    n.staff = n.midi >= TREBLE_MIN ? 'treble' : 'bass';
                });
            }

            // Step 2: Enforce max notes per chord per staff per beat position
            const positionMap = new Map();
            this.notes.forEach(n => {
                if (n.isRest) return;
                const key = `${n.measure}-${snapBeat(n.beat)}-${n.staff}`;
                if (!positionMap.has(key)) positionMap.set(key, []);
                positionMap.get(key).push(n);
            });

            const toRemove = new Set();
            positionMap.forEach((notesAtPos) => {
                // Enforce BOTH max per staff AND notes_count setting
                const maxAllowed = Math.min(MAX_PER_STAFF, Math.max(notesPerChord, 1));
                if (notesAtPos.length > maxAllowed) {
                    notesAtPos.sort((a, b) => a.midi - b.midi);
                    // Keep evenly spaced notes for better voicing
                    const step = notesAtPos.length / maxAllowed;
                    const keep = new Set();
                    for (let i = 0; i < maxAllowed; i++) {
                        keep.add(notesAtPos[Math.round(i * step)]);
                    }
                    notesAtPos.forEach(n => {
                        if (!keep.has(n)) toRemove.add(n);
                    });
                }
            });

            if (toRemove.size > 0) {
                this.notes = this.notes.filter(n => !toRemove.has(n));
            }

            // Step 3: Remove duplicate MIDI at same position
            const seenPositions = new Set();
            this.notes = this.notes.filter(n => {
                if (n.isRest) return true;
                const key = `${n.measure}-${snapBeat(n.beat)}-${n.midi}`;
                if (seenPositions.has(key)) return false;
                seenPositions.add(key);
                return true;
            });

            // Step 4: Prevent 3+ consecutive identical notes (same MIDI)
            // Scan treble and bass separately
            ['treble', 'bass'].forEach(staff => {
                const staffNotes = this.notes.filter(n => !n.isRest && n.staff === staff);
                staffNotes.sort((a, b) => {
                    const posA = (a.measure || 0) * 1000 + (a.beat || 0);
                    const posB = (b.measure || 0) * 1000 + (b.beat || 0);
                    return posA - posB;
                });
                for (let i = 2; i < staffNotes.length; i++) {
                    if (staffNotes[i].midi === staffNotes[i-1].midi && staffNotes[i].midi === staffNotes[i-2].midi) {
                        // 3 same notes in a row - shift the 3rd note up or down by a scale step
                        const shift = Math.random() < 0.5 ? 1 : -1;
                        const newMidi = staffNotes[i].midi + (shift * 2); // whole step
                        if (newMidi >= 21 && newMidi <= 108) {
                            staffNotes[i].midi = newMidi;
                            staffNotes[i].staff = newMidi >= 60 ? 'treble' : 'bass';
                        }
                    }
                }
            });

            // Step 4b: Snap close beat values and remove near-overlapping notes
            // Notes within 0.2 beats of each other on the SAME staff get snapped to the same beat (chord)
            // Notes within 0.2 beats on DIFFERENT staves in beginner/elementary get the later one removed
            const beatMap = new Map();
            this.notes.forEach(n => {
                if (n.isRest) return;
                const key = `${n.measure}`;
                if (!beatMap.has(key)) beatMap.set(key, []);
                beatMap.get(key).push(n);
            });
            const nearOverlapRemove = new Set();
            beatMap.forEach(notesInMeasure => {
                notesInMeasure.sort((a, b) => snapBeat(a.beat) - snapBeat(b.beat));
                for (let i = 1; i < notesInMeasure.length; i++) {
                    const prev = notesInMeasure[i - 1];
                    const curr = notesInMeasure[i];
                    const gap = Math.abs((curr.beat || 0) - (prev.beat || 0));
                    if (gap > 0 && gap < 0.2) {
                        if (prev.staff === curr.staff) {
                            // Same staff: snap to chord (same beat)
                            curr.beat = prev.beat;
                        } else {
                            // Different staves, near-overlapping: remove the later one
                            // to prevent visual superposition
                            nearOverlapRemove.add(curr);
                        }
                    }
                }
            });
            if (nearOverlapRemove.size > 0) {
                this.notes = this.notes.filter(n => !nearOverlapRemove.has(n));
            }

            // Step 4b2: RE-ENFORCE notesPerChord after beat-snapping
            // Beat snapping (4b) can merge notes that were at different beats into the same beat,
            // creating chords that exceed the notesPerChord limit. Re-check and cull.
            {
                const postSnapMap = new Map();
                this.notes.forEach(n => {
                    if (n.isRest) return;
                    const key = `${n.measure}-${snapBeat(n.beat)}-${n.staff}`;
                    if (!postSnapMap.has(key)) postSnapMap.set(key, []);
                    postSnapMap.get(key).push(n);
                });
                const postSnapRemove = new Set();
                const maxAllowed = Math.min(MAX_PER_STAFF, Math.max(notesPerChord, 1));
                postSnapMap.forEach(notesAtPos => {
                    if (notesAtPos.length > maxAllowed) {
                        notesAtPos.sort((a, b) => a.midi - b.midi);
                        const step = notesAtPos.length / maxAllowed;
                        const keep = new Set();
                        for (let i = 0; i < maxAllowed; i++) {
                            keep.add(notesAtPos[Math.round(i * step)]);
                        }
                        notesAtPos.forEach(n => {
                            if (!keep.has(n)) postSnapRemove.add(n);
                        });
                    }
                });
                if (postSnapRemove.size > 0) {
                    this.notes = this.notes.filter(n => !postSnapRemove.has(n));
                }
            }

            // Step 4c: BEGINNER MODE - absolutely no simultaneous notes across treble and bass
            // If any beat has notes on BOTH staves, remove the bass note(s) at that beat
            if ((this.userSettings.difficulty === 'beginner' || this.userSettings.difficulty === 'elementary') && handsCount >= 2) {
                const beatsByMeasure = new Map();
                this.notes.forEach(n => {
                    if (n.isRest) return;
                    const key = `${n.measure}-${snapBeat(n.beat)}`;
                    if (!beatsByMeasure.has(key)) beatsByMeasure.set(key, { treble: [], bass: [] });
                    beatsByMeasure.get(key)[n.staff === 'treble' ? 'treble' : 'bass'].push(n);
                });
                const removeSet = new Set();
                beatsByMeasure.forEach(({ treble, bass }) => {
                    if (treble.length > 0 && bass.length > 0) {
                        // Both staves have notes at same beat - remove bass notes
                        bass.forEach(n => removeSet.add(n));
                    }
                });
                if (removeSet.size > 0) {
                    this.notes = this.notes.filter(n => !removeSet.has(n));
                }
            }

            // Step 4d: Normalize chord durations - all notes at same beat on same staff get same duration
            // In real music, chords always share the same rhythm
            // Use snapped beat (sixteenth-note grid) for grouping to catch near-coincident notes
            const chordDurMap = new Map();
            this.notes.forEach(n => {
                if (n.isRest) return;
                const snappedBeat = snapBeat(n.beat); // Snap to sixteenth grid
                const key = `${n.measure}-${snappedBeat}-${n.staff}`;
                if (!chordDurMap.has(key)) chordDurMap.set(key, []);
                chordDurMap.get(key).push(n);
            });
            // Duration priority: use the shortest duration in the group
            const durOrder = ['thirty-second', 'sixteenth', 'eighth', 'dotted-eighth', 'quarter', 'dotted-quarter', 'half', 'dotted-half', 'whole'];
            chordDurMap.forEach(group => {
                if (group.length <= 1) return;
                // Snap all beats to the same value (first note's snapped beat)
                const snappedBeat = snapBeat(group[0].beat);
                // Find the shortest duration
                let shortest = group[0].duration;
                let shortestIdx = durOrder.indexOf(shortest);
                group.forEach(n => {
                    const idx = durOrder.indexOf(n.duration);
                    if (idx >= 0 && (shortestIdx < 0 || idx < shortestIdx)) {
                        shortest = n.duration;
                        shortestIdx = idx;
                    }
                });
                // Apply same beat and same duration to all notes in the chord
                group.forEach(n => {
                    n.duration = shortest;
                    n.beat = snappedBeat;
                });
            });

            // Step 4e: Prevent duration overlaps on same staff
            // If a note's duration extends past the next note's beat on the same staff, shorten it
            const durBeatsMap = {
                'thirty-second': 0.125, 'sixteenth': 0.25, 'eighth': 0.5, 'dotted-eighth': 0.75,
                'quarter': 1, 'dotted-quarter': 1.5, 'half': 2, 'dotted-half': 3, 'whole': 4
            };
            ['treble', 'bass'].forEach(staff => {
                const staffNotes = this.notes
                    .filter(n => !n.isRest && n.staff === staff)
                    .sort((a, b) => {
                        const pa = (a.measure || 0) * 100 + (a.beat || 0);
                        const pb = (b.measure || 0) * 100 + (b.beat || 0);
                        return pa - pb;
                    });
                for (let i = 0; i < staffNotes.length - 1; i++) {
                    const curr = staffNotes[i];
                    const next = staffNotes[i + 1];
                    // Skip chord notes at same position
                    if (curr.measure === next.measure && Math.abs((curr.beat || 0) - (next.beat || 0)) < 0.05) continue;
                    const currEnd = (curr.measure || 0) * 100 + (curr.beat || 0) + (durBeatsMap[curr.duration] || 1);
                    const nextStart = (next.measure || 0) * 100 + (next.beat || 0);
                    if (currEnd > nextStart + 0.05) {
                        // Shorten current note to fit
                        const gap = nextStart - ((curr.measure || 0) * 100 + (curr.beat || 0));
                        // Find the longest duration that fits
                        let bestDur = curr.duration;
                        for (const [dur, beats] of Object.entries(durBeatsMap)) {
                            if (beats <= gap + 0.05 && beats >= (durBeatsMap[bestDur] || 0)) {
                                // Don't shorten to something longer than current
                                if (beats <= (durBeatsMap[curr.duration] || 1)) {
                                    bestDur = dur;
                                }
                            }
                        }
                        // Only shorten if the best fit is actually shorter
                        if ((durBeatsMap[bestDur] || 1) < (durBeatsMap[curr.duration] || 1)) {
                            curr.duration = bestDur;
                        }
                    }
                }
            });

            // Step 5: Sort notes by position (measure, then beat, then MIDI for chord grouping)
            this.notes.sort((a, b) => {
                const posA = (a.measure || 0) * 1000 + (a.beat || 0);
                const posB = (b.measure || 0) * 1000 + (b.beat || 0);
                if (Math.abs(posA - posB) > 0.001) return posA - posB;
                return (a.midi || 0) - (b.midi || 0);
            });
        }

        /**
         * EXERCISE MODE: Assign fingering numbers to notes
         * Uses proper piano fingering pedagogy:
         *
         * RIGHT HAND (treble):
         *   - C major scale: 1-2-3-1-2-3-4-5 (thumb crosses under after 3)
         *   - Descending: 5-4-3-2-1-3-2-1 (finger 3 crosses over thumb)
         *   - Thumb on C and F (white key groups of 2 and 3)
         *
         * LEFT HAND (bass):
         *   - C major ascending: 5-4-3-2-1-3-2-1 (mirror of right hand descending)
         *   - Thumb on C and G
         *
         * Rules:
         *   1. Never use thumb on black keys
         *   2. Thumb tuck after finger 3 or 4 in scale passages
         *   3. Finger 3 or 4 crosses over thumb going down (RH) or up (LH)
         *   4. Large leaps reset hand position
         *   5. Repeated notes alternate fingers (3-2 or 2-1)
         */
        _assignFingering() {
            if (!this.notes || this.notes.length === 0) return;

            const diff = this.userSettings.difficulty;
            if (diff !== 'beginner' && diff !== 'elementary' && diff !== 'intermediate') return;

            // Helper: is this MIDI note a black key?
            const isBlackKey = (midi) => {
                const pc = midi % 12;
                return [1, 3, 6, 8, 10].includes(pc); // C#, D#, F#, G#, A#
            };

            // Helper: get scale degree within octave (0-6 for white keys)
            const whiteKeyDegree = (midi) => {
                const pc = midi % 12;
                const map = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
                return map[pc] !== undefined ? map[pc] : -1;
            };

            // Standard C major fingering patterns per octave
            // Right hand ascending: C=1, D=2, E=3, F=1, G=2, A=3, B=4 (then C=1)
            const rhAscending = { 0: 1, 1: 2, 2: 3, 3: 1, 4: 2, 5: 3, 6: 4 };
            // Right hand descending: C=1, B=4, A=3, G=2, F=1, E=3, D=2
            const rhDescending = { 0: 1, 6: 4, 5: 3, 4: 2, 3: 1, 2: 3, 1: 2 };
            // Left hand ascending: C=5, D=4, E=3, F=2, G=1, A=3, B=2
            const lhAscending = { 0: 5, 1: 4, 2: 3, 3: 2, 4: 1, 5: 3, 6: 2 };
            // Left hand descending: C=5 (or 1 at top), same pattern reversed
            const lhDescending = { 0: 5, 1: 4, 2: 3, 3: 2, 4: 1, 5: 3, 6: 2 };

            ['treble', 'bass'].forEach(staff => {
                const isRH = staff === 'treble';
                const staffNotes = this.notes.filter(n => !n.isRest && n.staff === staff);
                staffNotes.sort((a, b) => {
                    const posA = (a.measure || 0) * 1000 + (a.beat || 0);
                    const posB = (b.measure || 0) * 1000 + (b.beat || 0);
                    return posA - posB;
                });

                if (staffNotes.length === 0) return;

                let lastFinger = 0;
                let lastMidi = 0;

                for (let i = 0; i < staffNotes.length; i++) {
                    const note = staffNotes[i];
                    const midi = note.midi;
                    const wkDeg = whiteKeyDegree(midi);
                    const black = isBlackKey(midi);

                    if (i === 0) {
                        // First note: use scale-based fingering
                        if (black) {
                            lastFinger = isRH ? 2 : 3; // Avoid thumb on black keys
                        } else if (wkDeg >= 0) {
                            lastFinger = isRH ? rhAscending[wkDeg] : lhAscending[wkDeg];
                        } else {
                            lastFinger = 1;
                        }
                        note._fingering = lastFinger;
                        lastMidi = midi;
                        continue;
                    }

                    const interval = midi - lastMidi; // positive = ascending, negative = descending
                    const absInterval = Math.abs(interval);

                    // Same note repeated: alternate fingers
                    if (absInterval === 0) {
                        lastFinger = lastFinger === 3 ? 2 : (lastFinger === 2 ? 1 : (lastFinger === 1 ? 2 : lastFinger - 1));
                        note._fingering = Math.max(1, Math.min(5, lastFinger));
                        continue;
                    }

                    // Large leap (> octave): reset hand position
                    if (absInterval > 12) {
                        if (black) {
                            lastFinger = isRH ? 2 : 3;
                        } else if (wkDeg >= 0) {
                            lastFinger = isRH ?
                                (interval > 0 ? rhAscending[wkDeg] : rhDescending[wkDeg]) :
                                (interval > 0 ? lhAscending[wkDeg] : lhDescending[wkDeg]);
                        } else {
                            lastFinger = isRH ? 1 : 5;
                        }
                        note._fingering = lastFinger;
                        lastMidi = midi;
                        continue;
                    }

                    // Stepwise or small interval motion
                    if (isRH) {
                        if (interval > 0) {
                            // RH ascending
                            if (lastFinger >= 3 && !black) {
                                // Thumb tuck: after finger 3 or 4, cross thumb under
                                lastFinger = 1;
                            } else if (lastFinger === 5) {
                                // At pinky, must reset
                                lastFinger = black ? 2 : 1;
                            } else {
                                lastFinger = lastFinger + 1;
                            }
                        } else {
                            // RH descending
                            if (lastFinger === 1 && !black) {
                                // Finger crosses over thumb
                                lastFinger = 3;
                            } else if (lastFinger === 1 && black) {
                                lastFinger = 2;
                            } else {
                                lastFinger = lastFinger - 1;
                            }
                        }
                    } else {
                        // Left hand (mirror of right hand)
                        if (interval > 0) {
                            // LH ascending
                            if (lastFinger === 1 && !black) {
                                lastFinger = 3;
                            } else if (lastFinger === 1 && black) {
                                lastFinger = 2;
                            } else {
                                lastFinger = lastFinger - 1;
                            }
                        } else {
                            // LH descending
                            if (lastFinger >= 3 && !black) {
                                lastFinger = 1;
                            } else if (lastFinger === 5) {
                                lastFinger = black ? 4 : 5;
                            } else {
                                lastFinger = lastFinger + 1;
                            }
                        }
                    }

                    // Clamp and apply rule: never thumb on black key
                    lastFinger = Math.max(1, Math.min(5, lastFinger));
                    if (black && lastFinger === 1) {
                        lastFinger = isRH ? 2 : 2;
                    }
                    if (black && lastFinger === 5) {
                        lastFinger = 4; // Pinky on black key is unusual in scale passages
                    }

                    note._fingering = lastFinger;
                    lastMidi = midi;
                }
            });
        }

        /**
         * EXERCISE MODE: Mark the next notes to play for visual guidance
         * Called during render to highlight upcoming notes
         */
        _markExerciseNextNotes() {
            // Skip entirely if exercise mode is off (no DOM operations)
            if (!this.exerciseMode) return;
            if (!this.notes || this.notes.length === 0) return;

            // Only recompute if the current note index changed — avoids DOM thrashing
            let currentIdx;
            if (this.mode === 'wait') {
                currentIdx = this.currentNoteIndex;
            } else {
                // PERF: Start scanning from last known index instead of 0
                const startFrom = Math.max(0, this._lastExerciseIdx || 0);
                currentIdx = -1;
                for (let i = startFrom; i < this.notes.length; i++) {
                    const n = this.notes[i];
                    if (!n.isRest && !n.played && !n.missed) { currentIdx = i; break; }
                }
            }
            if (currentIdx === this._lastExerciseIdx && currentIdx >= 0) return;

            // Clear previous markings only on the notes that were marked
            if (this._exerciseMarkedIndices) {
                for (let i = 0; i < this._exerciseMarkedIndices.length; i++) {
                    this.notes[this._exerciseMarkedIndices[i]]._exerciseNext = false;
                }
            }
            this._exerciseMarkedIndices = [];
            this._lastExerciseIdx = currentIdx;

            // Clear piano exercise highlights ONLY when index actually changed
            if (this.piano) this.piano.clearExerciseHighlights();

            if (currentIdx < 0 || currentIdx >= this.notes.length) return;

            // Find the beat position of the next note(s)
            const nextNote = this.notes[currentIdx];
            if (nextNote.isRest) return;
            const nextPos = (nextNote.measure || 0) * 1000 + (nextNote.beat || 0);

            // Mark all notes at this same beat position
            const nextMidis = [];
            for (let i = currentIdx; i < this.notes.length; i++) {
                const n = this.notes[i];
                if (n.isRest || n.played || n.missed) continue;
                const pos = (n.measure || 0) * 1000 + (n.beat || 0);
                if (Math.abs(pos - nextPos) < 0.01) {
                    n._exerciseNext = true;
                    this._exerciseMarkedIndices.push(i);
                    nextMidis.push(n.midi);
                } else if (pos > nextPos + 0.1) {
                    break; // Notes are sorted, no need to check further
                }
            }

            // Highlight the corresponding piano keys in blue
            if (this.exerciseHighlightNext && this.piano) {
                nextMidis.forEach(midi => {
                    this.piano.highlightKeyExercise(midi);
                });
            }
        }

        /**
         * Load a song from the library by ID
         * USER FIX: Changed getSongById → getSong (ROOT CAUSE #1)
         */
        loadSong(songId) {
            if (!window.SRTSongs) {
                console.error('❌ SRTSongs library not loaded');
                return;
            }

            // ROOT CAUSE #1 FIX: Use getSong instead of getSongById
            const song = window.SRTSongs.getSong(songId);
            if (!song) {
                console.error('❌ Song not found:', songId);
                return;
            }

            // Convert song format to note format
            this.notes = [];
            let measure = 0;
            let beat = 0;

            song.notes.forEach((noteData) => {
                if (noteData.type === 'rest') {
                    // Skip rest
                    beat += noteData.beats || 1;
                } else if (noteData.type === 'chord') {
                    // Chord - add all notes at same position
                    noteData.notes.forEach((midi, index) => {
                        this.notes.push({
                            midi: midi,
                            duration: noteData.duration,
                            measure: measure,
                            beat: beat,
                            staff: midi >= 60 ? 'treble' : 'bass',
                            chord: true,
                            chordOffset: index * 0.5
                        });
                    });
                    beat += noteData.beats || 1;
                } else {
                    // Single note
                    this.notes.push({
                        midi: noteData.midi,
                        duration: noteData.duration,
                        measure: measure,
                        beat: beat,
                        staff: noteData.midi >= 60 ? 'treble' : 'bass'
                    });
                    beat += noteData.beats || 1;
                }

                // Move to next measure when beat >= 4
                while (beat >= 4) {
                    beat -= 4;
                    measure++;
                }
            });

            // Update tempo and key signature from song
            if (song.tempo) {
                this.setTempo(song.tempo);
                $('#srtTempoSlider').val(song.tempo);
                $('#srtTempoValue').text(song.tempo);
            }

            if (song.keySignature) {
                this.setKeySignature(song.keySignature);
            }

            // Render the loaded song
            this.requestRender();
        }

        /**
         * Load and parse a MIDI file
         */
        loadMidiFile(file) {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    this.parseMidiFile(arrayBuffer, file.name);
                } catch (error) {
                    this.showMessage('Error loading MIDI file: ' + error.message, 'error');
                }
            };

            reader.onerror = () => {
                this.showMessage('Error reading file', 'error');
            };

            reader.readAsArrayBuffer(file);
        }

        /**
         * Parse MIDI file arrayBuffer
         * Basic MIDI parser - supports simple MIDI files
         */
        parseMidiFile(arrayBuffer, filename) {

            try {
                const parser = new MIDIFileParser(arrayBuffer);
                const midiData = parser.parse();

                //     format: midiData.format,
                //     tracks: midiData.tracks.length,
                //     division: midiData.division,
                //     tempo: midiData.tempo,
                //     notes: midiData.notes.length,
                //     tempoBPM: Math.round(60000000 / midiData.tempo)
                // });

                // USER FIX: Apply detected tempo from MIDI file
                if (midiData.tempo) {
                    const tempoBPM = Math.round(60000000 / midiData.tempo);
                    this.setTempo(tempoBPM);
                    $('#srtTempoSlider').val(tempoBPM);
                    $('#srtTempoValue').text(tempoBPM);
                }

                // Convertir les notes MIDI en format engine
                // USER FIX: Handle both notes AND rests (silences) with isRest flag
                this.notes = midiData.notes.map((note, index) => {
                    // Check if this is a rest (silence)
                    if (note.isRest || note.midi === null) {
                        return {
                            midi: null,
                            isRest: true,
                            duration: this.ticksToDuration(note.durationTicks, midiData.division, midiData.tempo),
                            measure: note.measure !== undefined ? note.measure : Math.floor(note.beat / 4),
                            beat: note.beatInMeasure !== undefined ? note.beatInMeasure : (note.beat % 4),
                            staff: 'treble', // Rests typically shown on middle staff
                            velocity: 0
                        };
                    }

                    // Regular note
                    return {
                        midi: note.midi,
                        duration: this.ticksToDuration(note.durationTicks, midiData.division, midiData.tempo),
                        measure: Math.floor(note.beat / 4),
                        beat: note.beat % 4,
                        staff: note.midi >= 60 ? 'treble' : 'bass',
                        accidental: this.getAccidentalForMIDI(note.midi),
                        velocity: note.velocity
                    };
                });

                // Tri par temps d'apparition
                this.notes.sort((a, b) => (a.measure * 4 + snapBeat(a.beat)) - (b.measure * 4 + snapBeat(b.beat)));

                // Count notes and rests separately
                const noteCount = this.notes.filter(n => !n.isRest).length;
                const restCount = this.notes.filter(n => n.isRest).length;


                // CRITICAL: Mark that MIDI file is loaded (prevents random note generation)
                this.midiFileLoaded = true;
                this._disableGeneratorSettings();

                // Calculate optimal measure width for this piece
                this.calculateOptimalMeasureWidth();

                // Afficher message de succès avec stats détaillées
                this.showMessage(
                    `✅ MIDI chargé: ${filename}<br>` +
                    `📊 ${noteCount} notes + ${restCount} silences<br>` +
                    `🎵 Tempo: ${Math.round(60000000 / midiData.tempo)} BPM<br>` +
                    `🎹 Mode: <strong>Wait</strong> (switch to Scroll for automatic playback)`,
                    'success'
                );

                // Mode Wait WITHOUT resetting loaded notes (fromFileLoad=true)
                this.setMode('wait', true);

                // Calculate playhead positions for loaded notes
                if (this.renderer && this.notes.length > 0) {
                    const visualPlayheadX = this.getVisualPlayheadX();
                    const firstNote = this.notes[0];
                    const firstNoteWorldX = this.renderer.getNoteX(firstNote);
                    this.initialPlayheadPosition = firstNoteWorldX - visualPlayheadX - 7;
                    this.playheadPosition = this.initialPlayheadPosition;
                    this.waitModeScrollOffset = this.initialPlayheadPosition;
                }

                this.requestRender();

            } catch (error) {
                console.error('❌ Erreur parsing MIDI:', error);
                this.showMessage('❌ Erreur lors du chargement du fichier MIDI: ' + error.message, 'error');
                this.midiFileLoaded = false;
            }
        }

        ticksToDuration(ticks, division, tempo) {
            // USER FIX: Improved duration detection with dotted notes support
            // division = ticks par quarter note
            // tempo = microsecondes par quarter note
            const quarterNoteTicks = division;
            const beats = ticks / quarterNoteTicks;

            // Mapper à des durées standard (avec support dotted notes)
            if (beats >= 3.5) return 'whole';
            if (beats >= 2.75) return 'dotted-half'; // 3 beats
            if (beats >= 1.75) return 'half';        // 2 beats
            if (beats >= 1.25) return 'dotted-quarter'; // 1.5 beats
            if (beats >= 0.75) return 'quarter';     // 1 beat
            if (beats >= 0.625) return 'dotted-eighth'; // 0.75 beats
            if (beats >= 0.375) return 'eighth';     // 0.5 beats
            if (beats >= 0.1875) return 'sixteenth'; // 0.25 beats
            return 'sixteenth'; // Default pour notes très courtes
        }

        /**
         * Load and parse a MusicXML file (.musicxml, .xml)
         * Provides full sheet music with proper notation
         */
        loadMusicXMLFile(file) {
            // Security: limit file size to prevent DoS from massive XML files
            const MAX_XML_SIZE = 50 * 1024 * 1024; // 50MB max
            if (file.size > MAX_XML_SIZE) {
                this.showMessage('File too large (max 50MB)', 'error');
                return;
            }

            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const xmlString = e.target.result;
                    this.parseMusicXML(xmlString, file.name);
                } catch (error) {
                    this.showMessage('Error loading MusicXML file: ' + error.message, 'error');
                }
            };

            reader.onerror = () => {
                this.showMessage('Error reading MusicXML file', 'error');
            };

            reader.readAsText(file);
        }

        /**
         * Parse MusicXML string into engine notes
         */
        parseMusicXML(xmlString, filename) {
            try {
                const parser = new MusicXMLParser(xmlString);
                const xmlData = parser.parse();

                // Apply tempo
                if (xmlData.tempo) {
                    this.setTempo(Math.round(xmlData.tempo));
                    $('#srtTempoSlider').val(Math.round(xmlData.tempo));
                    $('#srtTempoValue').text(Math.round(xmlData.tempo));
                }

                // Apply key signature
                if (xmlData.keySignature) {
                    this.setKeySignature(xmlData.keySignature);
                    $('.srt-key-btn').removeClass('active');
                    $(`.srt-key-btn[data-key="${xmlData.keySignature}"]`).addClass('active');
                }

                // Apply time signature
                if (xmlData.timeSignature) {
                    this.staffSettings.timeSignature = xmlData.timeSignature;
                    if (this.renderer) {
                        this.renderer.timeSignature = xmlData.timeSignature;
                        this.renderer.setTimeSignature(xmlData.timeSignature);
                    }
                }

                // Apply grand staff if 2 staves detected
                if (xmlData.staves >= 2) {
                    this.staffSettings.clef = 'grand';
                    if (this.renderer) {
                        this.renderer.clef = 'grand';
                    }
                    // Update UI to reflect grand staff
                    $('.srt-staff-btn').removeClass('active');
                    $('.srt-staff-btn[data-clef="grand"]').addClass('active');
                }

                // Store measure metadata for rendering
                if (xmlData.measures) {
                    this._xmlMeasures = xmlData.measures;
                    this._xmlDynamics = xmlData.dynamics || [];
                    this._xmlWedges = xmlData.wedges || [];
                    this._xmlPedalMarks = xmlData.pedalMarks || [];
                    this._xmlRehearsalMarks = xmlData.rehearsalMarks || [];
                }

                // Convert MusicXML notes to engine format
                // Filter out tie continuations (they don't need separate input)
                // and remove voice 2+ rests that overlap with voice 1 notes
                this.notes = xmlData.notes
                    .filter(note => {
                        // Remove tie continuations - player already played the start
                        if (note.tieStop && !note.tieStart) return false;
                        // Remove voice 2+ rests that are just padding
                        if (note.isRest && (note.voice || 1) > 1) return false;
                        return true;
                    })
                    .map(note => {
                        if (note.isRest) {
                            return {
                                midi: null,
                                isRest: true,
                                duration: note.duration,
                                measure: note.measure,
                                beat: note.beat,
                                staff: note.staff || 'treble',
                                velocity: 0,
                                voice: note.voice || 1
                            };
                        }

                        const mapped = {
                            midi: note.midi,
                            duration: note.duration,
                            measure: note.measure,
                            beat: note.beat,
                            staff: note.staff || (note.midi >= 60 ? 'treble' : 'bass'),
                            _xmlStaff: note._xmlStaff || false, // Preserve explicit staff assignment
                            accidental: note.accidental,
                            velocity: note.velocity || 80,
                            tieStart: note.tieStart,
                            voice: note.voice || 1,
                            beamInfo: note.beamInfo,
                            noteName: note.noteName
                        };
                        // Pass through optional MusicXML fields
                        if (note.articulations) mapped.articulations = note.articulations;
                        if (note.ornaments) mapped.ornaments = note.ornaments;
                        if (note.slur) mapped.slur = note.slur;
                        if (note.fermata) mapped.fermata = true;
                        if (note.arpeggiate) mapped.arpeggiate = true;
                        if (note.fingering) mapped.fingering = note.fingering;
                        if (note.isTuplet) mapped.isTuplet = true;
                        return mapped;
                    });

                // Clamp extreme MIDI values from MXL to playable range
                this.notes.forEach(n => {
                    if (n.isRest || !n.midi) return;
                    // Octave shift to keep within visible staff range
                    while (n.midi < 36) n.midi += 12;  // Below C2
                    while (n.midi > 96) n.midi -= 12;  // Above C7
                    // Only auto-assign staff if MusicXML didn't provide explicit staff
                    // (explicit staff assignment is already handled in _parseNote)
                    if (!n._xmlStaff) {
                        n.staff = n.midi >= 60 ? 'treble' : 'bass';
                    }
                });

                // Sort by measure then beat, keeping simultaneous notes together
                this.notes.sort((a, b) => {
                    if (a.measure !== b.measure) return a.measure - b.measure;
                    if (Math.abs(a.beat - b.beat) > 0.001) return a.beat - b.beat;
                    // Same position: sort by staff (treble first), then by MIDI (high to low)
                    if (a.staff !== b.staff) return a.staff === 'treble' ? -1 : 1;
                    return (b.midi || 0) - (a.midi || 0);
                });

                // Count notes and rests
                const noteCount = this.notes.filter(n => !n.isRest).length;
                const restCount = this.notes.filter(n => n.isRest).length;
                const measureCount = this.notes.length > 0 ?
                    Math.max(...this.notes.map(n => n.measure)) + 1 : 0;

                // CRITICAL: Mark as loaded BEFORE setMode to prevent note regeneration
                this.midiFileLoaded = true;
                this._disableGeneratorSettings();

                // Calculate optimal measure width based on note density
                this.calculateOptimalMeasureWidth();

                // Build title display
                const title = xmlData.title || filename;
                const composer = xmlData.composer ? ` - ${xmlData.composer}` : '';

                this.showMessage(
                    `MusicXML loaded: ${title}${composer}<br>` +
                    `${noteCount} notes + ${restCount} rests | ${measureCount} measures<br>` +
                    `Key: ${xmlData.keySignature} | Time: ${xmlData.timeSignature} | Tempo: ${Math.round(xmlData.tempo)} BPM`,
                    'success'
                );

                // Preserve current mode when loading files (don't force wait mode)
                this.setMode(this.mode || 'wait', true);

                // Calculate playhead positions for loaded notes
                if (this.renderer && this.notes.length > 0) {
                    const visualPlayheadX = this.getVisualPlayheadX();
                    const firstNote = this.notes[0];
                    const firstNoteWorldX = this.renderer.getNoteX(firstNote);
                    this.initialPlayheadPosition = firstNoteWorldX - visualPlayheadX - 7;
                    this.playheadPosition = this.initialPlayheadPosition;
                    this.waitModeScrollOffset = this.initialPlayheadPosition;
                }

                this.requestRender();

            } catch (error) {
                console.error('Error parsing MusicXML:', error);
                this.showMessage('Error parsing MusicXML: ' + error.message, 'error');
                this.midiFileLoaded = false;
            }
        }

        /**
         * Calculate optimal measure width based on time signature, note density, and accidentals.
         */
        calculateOptimalMeasureWidth() {
            if (!this.renderer) return;

            // Parse time signature
            const tsParts = (this.renderer.timeSignature || '4/4').split('/');
            const tsNumerator = parseInt(tsParts[0]) || 4;

            // Minimum width per beat division to keep notes readable
            // Use wider spacing for loaded files (MXL/MIDI) which have denser notation
            const minPerBeat = this.midiFileLoaded ? 45 : 30;
            const tsBasedWidth = tsNumerator * minPerBeat;

            // Start with time-signature-based minimum
            let calculatedWidth = Math.max(this.midiFileLoaded ? 300 : 250, tsBasedWidth);

            // If notes exist, also factor in density
            if (this.notes && this.notes.length > 0) {
                const measureBeatCounts = {};
                let hasAccidentals = false;

                for (const note of this.notes) {
                    if (note.isRest) continue;
                    const m = note.measure || 0;
                    const beatKey = `${m}-${snapBeat(note.beat)}`;
                    if (!measureBeatCounts[m]) measureBeatCounts[m] = new Set();
                    measureBeatCounts[m].add(beatKey);

                    if (note.accidental || (note.midi && [1, 3, 6, 8, 10].includes(note.midi % 12))) {
                        hasAccidentals = true;
                    }
                }

                let maxBeats = tsNumerator;
                for (const m in measureBeatCounts) {
                    maxBeats = Math.max(maxBeats, measureBeatCounts[m].size);
                }

                const perBeatWidth = this.midiFileLoaded ? 50 : 35;
                const densityWidth = maxBeats * perBeatWidth + (hasAccidentals ? 30 : 0);
                calculatedWidth = Math.max(calculatedWidth, densityWidth);
            }

            // Cap at reasonable max — allow wider measures for loaded files (MXL/MIDI)
            // Complex classical pieces need more space for dense passages
            const maxWidth = this.midiFileLoaded ? 800 : 600;
            this.renderer.measureWidth = Math.min(calculatedWidth, maxWidth);

            // PERFORMANCE FIX: Cache max measure index to avoid expensive
            // Math.max(...notes.map(...)) calls on every render frame
            this._cachedMaxMeasure = 4;
            if (this.notes && this.notes.length > 0) {
                let maxM = 0;
                for (let i = 0; i < this.notes.length; i++) {
                    const m = this.notes[i].measure || 0;
                    if (m > maxM) maxM = m;
                }
                this._cachedMaxMeasure = maxM + 1;
            }
        }

        /**
         * Universal file loader - detects MIDI or MusicXML and routes accordingly
         */
        loadScoreFile(file) {
            const name = file.name.toLowerCase();
            if (name.endsWith('.mid') || name.endsWith('.midi')) {
                this.loadMidiFile(file);
            } else if (name.endsWith('.mxl')) {
                this.loadMXLFile(file);
            } else if (name.endsWith('.musicxml') || name.endsWith('.xml')) {
                this.loadMusicXMLFile(file);
            } else {
                this.showMessage('Unsupported format. Use .mxl, .musicxml, .xml, .mid or .midi', 'error');
            }
        }

        /**
         * Load compressed MusicXML (.mxl) file using JSZip
         * MXL = ZIP archive containing MusicXML + META-INF/container.xml
         */
        loadMXLFile(file) {
            if (typeof JSZip === 'undefined') {
                this.showMessage('JSZip library not loaded. Cannot open .mxl files.', 'error');
                return;
            }

            this.showMessage('Decompressing MXL file...', 'info');

            const reader = new FileReader();
            reader.onload = (e) => {
                JSZip.loadAsync(e.target.result)
                    .then(zip => {
                        // First try META-INF/container.xml to find the rootfile
                        const containerFile = zip.file('META-INF/container.xml');
                        if (containerFile) {
                            return containerFile.async('text').then(containerXml => {
                                const parser = new DOMParser();
                                const doc = parser.parseFromString(containerXml, 'text/xml');
                                const rootfile = doc.querySelector('rootfile');
                                const fullPath = rootfile ? rootfile.getAttribute('full-path') : null;
                                if (fullPath && zip.file(fullPath)) {
                                    return zip.file(fullPath).async('text');
                                }
                                // Fallback: find any .musicxml or .xml file
                                return this._findMusicXMLInZip(zip);
                            });
                        }
                        // No container.xml - find any .musicxml or .xml file
                        return this._findMusicXMLInZip(zip);
                    })
                    .then(xmlString => {
                        if (!xmlString) {
                            throw new Error('No MusicXML file found inside the MXL archive');
                        }
                        this.parseMusicXML(xmlString, file.name);
                    })
                    .catch(err => {
                        console.error('MXL decompression error:', err);
                        this.showMessage('Error reading MXL file: ' + err.message, 'error');
                    });
            };

            reader.onerror = () => {
                this.showMessage('Error reading MXL file', 'error');
            };

            reader.readAsArrayBuffer(file);
        }

        /**
         * Find the MusicXML file inside a ZIP archive (fallback when no container.xml)
         */
        _findMusicXMLInZip(zip) {
            const candidates = [];
            zip.forEach((path, entry) => {
                const lower = path.toLowerCase();
                if (!entry.dir && (lower.endsWith('.musicxml') || lower.endsWith('.xml')) && !lower.includes('container.xml')) {
                    candidates.push(entry);
                }
            });
            if (candidates.length > 0) {
                return candidates[0].async('text');
            }
            return null;
        }

        /**
         * Populate the song selector dropdown with server-stored partitions
         */
        populatePartitionSelector() {
            this.serverPartitions = [];
            const $select = $('#srtSongSelect');

            // Load partitions from srtConfig (passed via wp_localize_script)
            if (typeof srtConfig !== 'undefined' && srtConfig.partitions && srtConfig.partitions.length > 0) {
                this.serverPartitions = srtConfig.partitions;

                // Add partition options grouped under an optgroup
                const $group = $('<optgroup>').attr('label', 'Library Partitions');
                srtConfig.partitions.forEach(p => {
                    const label = p.title + (p.composer ? ' - ' + p.composer : '') + ' [' + p.file_type.toUpperCase() + ']';
                    $group.append($('<option>').val('partition_' + p.id).text(label));
                });
                $select.append($group);
            }

            // Add built-in songs if they exist
            if (typeof SightReadingSongs !== 'undefined' && SightReadingSongs.length > 0) {
                const $builtinGroup = $('<optgroup>').attr('label', 'Built-in Songs');
                SightReadingSongs.forEach(s => {
                    $builtinGroup.append($('<option>').val(s.id).text(s.title));
                });
                $select.append($builtinGroup);
            }
        }

        /**
         * Load a partition from the server by fetching its file URL
         */
        loadPartitionFromServer(partitionData) {
            this.showMessage('Loading: ' + partitionData.title + '...', 'info');

            // Reset listen/playback state from any previous partition
            if (this.isListening) {
                this.stopListening();
            }
            this.listenCompleted = false;
            $('#srtListenBtn').prop('disabled', false).css('opacity', '1');

            fetch(partitionData.file_url)
                .then(response => {
                    if (!response.ok) throw new Error('Failed to fetch partition file');
                    // MXL and MIDI need ArrayBuffer, MusicXML needs text
                    const url = partitionData.file_url.toLowerCase();
                    return (partitionData.file_type === 'midi' || url.endsWith('.mxl'))
                        ? response.arrayBuffer() : response.text();
                })
                .then(data => {
                    const url = partitionData.file_url.toLowerCase();
                    if (partitionData.file_type === 'midi') {
                        const blob = new Blob([data], { type: 'audio/midi' });
                        const file = new File([blob], partitionData.title + '.mid', { type: 'audio/midi' });
                        this.loadMidiFile(file);
                    } else if (url.endsWith('.mxl')) {
                        // MXL from server - decompress then parse
                        const blob = new Blob([data]);
                        const file = new File([blob], partitionData.title + '.mxl');
                        this.loadMXLFile(file);
                        return; // loadMXLFile shows its own message
                    } else {
                        this.parseMusicXML(data, partitionData.title);
                    }
                    this.showMessage('Loaded: ' + partitionData.title, 'success');
                })
                .catch(err => {
                    console.error('Error loading partition:', err);
                    this.showMessage('Error loading partition: ' + err.message, 'error');
                });
        }

        /**
         * CRITICAL: Automatically detect accidental for a MIDI note
         * Returns 'sharp', 'flat', or null based on the key signature and note
         */
        getAccidentalForMIDI(midi) {
            // USER REQUEST: ALWAYS use SHARPS for black keys by default
            const pitchClass = midi % 12;

            // Black keys (sharp/flat notes) need accidentals
            const blackKeyPitchClasses = [1, 3, 6, 8, 10]; // C#, D#, F#, G#, A#

            if (!blackKeyPitchClasses.includes(pitchClass)) {
                // White key - no accidental needed (C, D, E, F, G, A, B)
                return null;
            }

            // USER REQUEST: Default to SHARP - professional standard
            return 'sharp';
        }

        showMessage(message, type = 'info') {
            // Remove any existing messages to prevent stacking
            $('.srt-message').stop(true, true).remove();

            // Sanitize message to prevent XSS from error messages (e.g., malicious XML filenames)
            const sanitized = typeof message === 'string'
                ? message.replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    .replace(/&lt;br&gt;/gi, '<br>') // Allow <br> tags only
                : '';

            const $message = $('<div>')
                .addClass('srt-message srt-message-' + type)
                .html(sanitized)
                .css({
                    position: 'fixed',
                    top: '200px',
                    right: '20px',
                    padding: '15px 25px',
                    background: type === 'error' ? '#F44336' : type === 'warning' ? '#B08A2E' : '#C59D3A',
                    color: '#fff',
                    borderRadius: '10px',
                    boxShadow: '0 6px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.1)',
                    zIndex: 100000,
                    fontFamily: 'Montserrat, sans-serif',
                    fontSize: '14px',
                    fontWeight: '600',
                    maxWidth: '400px',
                    lineHeight: '1.4',
                    opacity: 0
                });

            const $msgContainer = $('.srt-container');
            if ($msgContainer.length) {
                $msgContainer.append($message);
            } else {
                $('body').append($message);
            }

            $message.animate({ opacity: 1 }, 200).delay(2500).animate({ opacity: 0 }, 300, function() {
                $(this).remove();
            });
        }

        /**
         * Hide loading screen and show main interface
         */
        hideLoadingScreen() {
            $('.srt-loading-screen').fadeOut(500, () => {
                // Show main interface elements — use css('display') to preserve flex layout
                $('#srtHeader').css('display', 'flex').hide().fadeIn(400);
                $('#srtToolbar').css('display', 'flex').hide().fadeIn(400);
                $('#srtMainArea').css('display', 'flex').hide().fadeIn(400);
            });
        }
        
        /**
         * Start animation loop
         */
        startAnimationLoop() {
            // PERFORMANCE: Cancel any existing animation loop to prevent duplicates
            if (this.animationFrame) {
                cancelAnimationFrame(this.animationFrame);
                this.animationFrame = null;
            }
            this.lastFrameTime = null;

            const animate = (timestamp) => {
                if (!this.lastFrameTime) {
                    this.lastFrameTime = timestamp;
                }

                this.deltaTime = timestamp - this.lastFrameTime;
                this.lastFrameTime = timestamp;

                this.update(this.deltaTime);
                this.render();

                this.animationFrame = requestAnimationFrame(animate);
            };

            this.animationFrame = requestAnimationFrame(animate);
        }
        
        /**
         * Update game state
         */
        update(deltaTime) {
            // Always update visual effects (particles, ghosts) even when not playing
            if (this.renderer) {
                this.renderer.updateParticles();
                this.renderer.updateGhostNotes();
                // If particles/ghosts exist, mark dirty so they render even when paused
                if ((this.renderer._particles && this.renderer._particles.length > 0) ||
                    (this.ghostNotes && this.ghostNotes.length > 0)) {
                    this._renderDirty = true;
                }
            }

            if (!this.isPlaying || this.isPaused) {
                return;
            }

            // Update session duration
            if (this.sessionStartTime) {
                this.sessionDuration = (Date.now() - this.sessionStartTime) / 1000;
            }

            // Update based on mode
            if (this.mode === 'scroll') {
                this.updateScrollMode(deltaTime);
            } else {
                this.updateWaitMode(deltaTime);
            }

            // Update timeline beat tracker (synced to tempo)
            this.updateTimelineBeat(deltaTime);

            if (this.metronomeEnabled) {
                this.updateMetronomeVisual();
            }

            // Exercise mode: update piano highlights (only when index changes)
            if (this.exerciseMode) {
                this._markExerciseNextNotes();
            }

            // Throttle expensive UI updates to ~4fps (every 15 frames)
            this._updateFrameCount = (this._updateFrameCount || 0) + 1;
            if (this._updateFrameCount >= 15) {
                this._updateFrameCount = 0;
                this.updateAllDisplays();
                this.checkAchievements();
            }
        }
        
        /**
         * Update scroll mode
         */
        /**
         * Cache scroll speed parameters — only recompute when tempo/time sig/measure width change
         */
        _updateScrollSpeedCache() {
            const ts = this.renderer?.timeSignature || '4/4';
            const mw = this.renderer?.measureWidth || 250;
            const tempo = this.tempo;
            if (ts === this._scrollCache_ts && mw === this._scrollCache_mw && tempo === this._scrollCache_tempo) {
                return; // No change
            }
            this._scrollCache_ts = ts;
            this._scrollCache_mw = mw;
            this._scrollCache_tempo = tempo;
            const tsParts = ts.split('/');
            const tsTop = parseInt(tsParts[0]) || 4;
            const tsBot = parseInt(tsParts[1]) || 4;
            const quarterBeats = (tsTop * 4) / tsBot;
            const pixelsPerBeat = mw / quarterBeats;
            this._scrollPixelsPerMs = (tempo / 60) * pixelsPerBeat / 1000;
        }

        updateScrollMode(deltaTime) {
            if (this.scrollPaused) return;

            // Use cached scroll speed (avoids string parsing every frame)
            this._updateScrollSpeedCache();
            this.playheadPosition += this._scrollPixelsPerMs * deltaTime;

            // Check if notes have passed the playhead
            this.checkNotesInScrollMode();

            // Update playhead visual (uses cached canvas width, no layout thrashing)
            this.updatePlayheadVisual();
        }
        
        /**
         * Update wait mode
         */
        updateWaitMode(deltaTime) {
            // In wait mode, the game waits for the correct note to be played
            // No automatic scrolling

            // Check if current note has been played
            if (this.currentNoteIndex < this.notes.length) {
                // CRITICAL: Highlight ALL notes in the chord, not just the first one
                const expectedNotes = this.getExpectedNotesAtIndex(this.currentNoteIndex);

                // Visual feedback for ALL notes in the chord
                // CORRECTION: Ne pas entourer les silences (user feedback)
                // FIX: Never re-highlight notes that already have a terminal state
                expectedNotes.forEach(note => {
                    if (!note.highlighted && !note.isRest && note.midi !== null
                        && !note.played && !note.missed && !note.imprecise) {
                        note.highlighted = true;
                    }
                });
            }

            // FEATURE: Continuous generation for elementary+ (user feedback)
            // In beginner mode, stop at container end
            // In elementary+, generate infinite notes with scrolling measures
            const difficulty = this.userSettings.difficulty || 'beginner';
            if (difficulty !== 'beginner' && this.shouldGenerateMoreNotes()) {
                this.generateMoreNotes();
            }
        }
        
        /**
         * Update timeline beat tracker — synced to tempo.
         * Tracks current measure + fractional beat for timeline highlighting.
         * In wait mode: flows at tempo but pauses at measure end until user plays.
         * In scroll mode: derived from playhead position.
         */
        updateTimelineBeat(deltaTime) {
            if (!this.renderer) return;
            // PERF: Use cached time signature from renderer (already parsed)
            const beatsPerMeasure = this.renderer._tsCache_top || parseInt((this.renderer.timeSignature || '4/4').split('/')[0]) || 4;

            if (this.mode === 'scroll') {
                // In scroll mode: derive from playhead position
                const visualX = this.getVisualPlayheadX();
                const phWorld = this.playheadPosition + visualX;
                const noteStartX = this.renderer.calculatedNoteStartX || 200;
                const barLineMargin = 25;
                const mw = this.renderer.measureWidth;
                const beatWidth = mw / beatsPerMeasure;
                // Calculate which measure and beat the playhead is at
                const relX = phWorld - noteStartX - barLineMargin;
                if (relX >= 0) {
                    const measureF = relX / (mw + barLineMargin);
                    const measure = Math.floor(measureF);
                    const insideMeasure = relX - measure * (mw + barLineMargin);
                    const beat = Math.max(0, (insideMeasure - barLineMargin) / beatWidth);
                    this._timelineMeasure = measure;
                    this._timelineBeat = Math.min(beat, beatsPerMeasure - 0.01);
                }
            } else if (this.mode === 'wait') {
                // In wait mode: advance at tempo speed, pause at measure boundaries
                if (this._timelineBeat === undefined) {
                    this._timelineMeasure = 0;
                    this._timelineBeat = 0;
                }
                const beatsPerSecond = this.tempo / 60;
                const beatAdvance = (beatsPerSecond * deltaTime) / 1000;
                this._timelineBeat += beatAdvance;

                if (this._timelineBeat >= beatsPerMeasure) {
                    // Reached end of measure — check if user has moved to next measure
                    const currentNoteMeasure = this.notes[this.currentNoteIndex]?.measure ?? 0;
                    if (currentNoteMeasure > this._timelineMeasure) {
                        // User has played into the next measure, advance timeline
                        this._timelineMeasure = currentNoteMeasure;
                        this._timelineBeat = 0;
                    } else {
                        // Clamp at end of measure — wait for user
                        this._timelineBeat = beatsPerMeasure - 0.01;
                    }
                }
            }
        }

        /**
         * Visual-only metronome update (called from animation loop)
         * Audio ticking is handled exclusively by startMetronomeIndependent() via setInterval
         * This prevents double-ticking and ensures perfectly regular rhythm
         */
        updateMetronomeVisual() {
            // Only update visual indicator — audio is handled by the independent interval
        }
        
        /**
         * Request a render on the next animation frame.
         * All external code should call this instead of render() directly.
         * The animation loop checks _renderDirty and calls _doRender().
         */
        requestRender() {
            this._renderDirty = true;
        }

        /**
         * Render the scene — called ONLY by the animation loop.
         * External code must use requestRender() instead.
         */
        render() {
            // Silent no-op if not yet initialized (canvas/renderer not ready)
            if (!this._initialized || !this.ctx || !this.renderer) {
                return;
            }

            // Clear canvas and draw warm parchment background
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.renderer.drawParchmentBackground();

            // Render staff FIRST (AVANT translate) - clés/armature/4/4 restent FIXES!
            this.renderer.renderStaff();

            // ENSUITE: In scroll OR free OR wait mode, translate canvas so notes scroll right to left
            // Notes ET barres de mesure bougent ensemble!
            if (this.mode === 'scroll') {
                this.ctx.save();
                // Translate by negative playhead position to scroll notes left
                this.ctx.translate(-this.playheadPosition, 0);
            } else if (this.mode === 'free' && this.scrollOffset) {
                this.ctx.save();
                // CRITICAL FIX: Translate in free mode to scroll notes when reaching container end
                this.ctx.translate(this.scrollOffset, 0);
            } else if (this.mode === 'wait' && this.waitModeScrollOffset) {
                this.ctx.save();
                // USER REQUEST: Wait mode auto-scroll when 4 notes before end of visible staff
                this.ctx.translate(-this.waitModeScrollOffset, 0);
            }

            // CRITICAL: Clip notes to prevent them from overlapping clef/key/time signature
            // Notes must disappear under the armature (clef, key sig, time sig) during scroll
            // The clip rect must be in the TRANSLATED coordinate space
            if (this.mode === 'scroll' || (this.mode === 'free' && this.scrollOffset) || (this.mode === 'wait' && this.waitModeScrollOffset)) {
                const canvasWidth = this.canvas.width / (window.devicePixelRatio || 1);
                const canvasHeight = this.canvas.height / (window.devicePixelRatio || 1);
                // Screen-space armature boundary
                const armatureScreenX = (this.renderer && this.renderer.calculatedNoteStartX)
                    ? this.renderer.calculatedNoteStartX - 15
                    : 185;

                // Convert screen-space clip position to translated coordinate space
                let clipX = armatureScreenX;
                if (this.mode === 'scroll') {
                    clipX = armatureScreenX + this.playheadPosition;
                } else if (this.mode === 'free') {
                    clipX = armatureScreenX - this.scrollOffset;
                } else if (this.mode === 'wait') {
                    clipX = armatureScreenX + this.waitModeScrollOffset;
                }

                // Create clipping rectangle in translated space
                this.ctx.beginPath();
                this.ctx.rect(clipX, 0, canvasWidth * 10, canvasHeight);
                this.ctx.clip();
            }

            // Render measure lines (barres de mesure) - APRÈS translate pour qu'elles bougent!
            this.renderer.renderMeasureLines();

            // Render key/time signature changes at measure boundaries
            this.renderer.renderSignatureChanges();

            // Render notes (avec translate en scroll/free mode)
            // Notes are now clipped and won't appear over symbols
            this.renderer.renderNotes(this.notes);

            // Render ties between connected notes (curved lines for held notes)
            this.renderer.renderTies(this.notes);

            // Render slurs (legato arcs between different pitches)
            this.renderer.renderSlurs(this.notes);

            // Render articulation marks (staccato, accent, tenuto, fermata)
            this.renderer.renderArticulations(this.notes);

            // Render dynamic markings (pp, p, mf, f, ff, etc.)
            this.renderer.renderDynamics();

            // Render crescendo/diminuendo wedges (hairpins)
            this.renderer.renderWedges();

            // Render feedback layer
            this.renderer.renderFeedback();

            // USER REQUEST: Render ghost notes (incorrect notes played)
            this.renderer.renderGhostNotes(this.ghostNotes);

            // Render end bar (Fine) for scroll and wait modes - scrolls with notes
            if (this.mode === 'scroll' || this.mode === 'wait') {
                this.renderer.renderEndBar();
            }

            // USER FIX: In wait mode, notes to play are colored GOLD (no more circles)
            // The gold highlighting is handled by note.highlighted = true in updateWaitMode()
            // Circles have been REMOVED per user request - notes are simply colored:
            // - GOLD = to play
            // - GREEN = correct on first try
            // - YELLOW = correct after mistakes

            // USER FIX: Add "Start here" blinking indicator in wait mode
            if (this.mode === 'wait' && this.currentNoteIndex === 0 && this.notes.length > 0) {
                const firstNote = this.notes[0];
                if (!firstNote.played && !firstNote.isRest) {
                    this.renderer.renderStartHereIndicator(firstNote);
                }
            }

            // Restore canvas transform after rendering notes
            if (this.mode === 'scroll' || (this.mode === 'free' && this.scrollOffset) || (this.mode === 'wait' && this.waitModeScrollOffset)) {
                this.ctx.restore();
            }

            // Render playhead band (for scroll mode) - drawn AFTER restoring transform
            // so it stays at a fixed position on screen (the playhead is fixed, notes scroll)
            if (this.mode === 'scroll') {
                this.renderer.renderPlayheadBand(this.playheadPosition);
                // Re-render staff on top of the playhead mask so clef/armature remain visible
                this.renderer.renderStaff();
            }
        }
        
        /**
         * Start the game
         */
        start() {
            // Resume listen mode if paused
            if (this.isListening && this.listenPaused) {
                this.listenPaused = false;
                // Resolve the pause promise to continue playback
                if (this._listenResumeResolve) {
                    this._listenResumeResolve();
                    this._listenResumeResolve = null;
                }
                $('#srtPlayBtn').hide();
                $('#srtPauseBtn').show();
                return;
            }

            // If listen completed, Play re-listens from beginning
            if (this.listenCompleted) {
                this.listenCompleted = false;
                this.waitModeScrollOffset = 0;
                this.currentNoteIndex = 0;
                this.listen();
                return;
            }

            if (this.isPlaying || this._countdownActive) {
                return;
            }

            // In free mode, play back the recorded notes instead of generating new ones
            if (this.mode === 'free') {
                this.playRecordedNotes();
                return;
            }

            // Show countdown "3, 2, 1" for Scroll mode BEFORE starting
            if (this.mode === 'scroll') {
                this.showCountdown(() => {
                    this._startScrollMode();
                });
                return;
            }

            // For wait mode, start immediately
            this._startScrollMode();
        }

        /**
         * USER FIX: Play back recorded notes in free mode
         * Plays the notes that were recorded on the staff instead of generating new ones
         */
        playRecordedNotes() {
            // Check if there are any recorded notes to play
            if (!this.freeMode_playedNotes || this.freeMode_playedNotes.length === 0) {
                this.showToast('No notes recorded. Play some notes first!', 'info');
                return;
            }

            // Set playing state
            this.isPlaying = true;
            this.isPaused = false;
            this.isListening = true; // Use listen mode for playback

            // Update UI
            $('#srtPlayBtn').hide();
            $('#srtPauseBtn').show();

            // Group notes by beat position for playback
            // CRITICAL: Use rounded beat key to avoid floating-point mismatches
            // that cause simultaneous notes to play sequentially
            const notesByBeat = new Map();
            this.freeMode_playedNotes.forEach(note => {
                const beatKey = `${note.measure || 0}-${snapBeat(note.beat)}`;
                if (!notesByBeat.has(beatKey)) {
                    notesByBeat.set(beatKey, []);
                }
                notesByBeat.get(beatKey).push(note);
            });

            // Sort beats by position
            const sortedBeats = Array.from(notesByBeat.keys()).sort((a, b) => {
                const [mA, bA] = a.split('-').map(Number);
                const [mB, bB] = b.split('-').map(Number);
                return (mA * 4 + bA) - (mB * 4 + bB);
            });

            // Calculate timing based on tempo
            const beatDuration = 60000 / this.tempo; // ms per beat
            let currentDelay = 0;
            const playbackTimeouts = [];

            // Schedule playback of each beat position
            sortedBeats.forEach((beatKey, index) => {
                const notesAtBeat = notesByBeat.get(beatKey);
                const delay = index * beatDuration * 0.5; // Notes are at 0.5 beat intervals

                const timeoutId = setTimeout(() => {
                    // Play ALL notes at this beat position SIMULTANEOUSLY
                    // Use playNoteAttack (not playNote) for true simultaneity
                    notesAtBeat.forEach(note => {
                        if (note.midi) {
                            this.audio.playNoteAttack(note.midi, 90);
                            this.piano.highlightKey(note.midi);
                        }
                    });

                    // Release all notes after duration
                    setTimeout(() => {
                        notesAtBeat.forEach(note => {
                            if (note.midi) {
                                this.audio.releaseNote(note.midi);
                                this.piano.releaseKey(note.midi);
                            }
                        });
                    }, beatDuration * 0.4);
                }, delay);

                playbackTimeouts.push(timeoutId);
            });

            // Store timeouts for potential cancellation
            this.playbackTimeouts = playbackTimeouts;

            // Calculate total duration
            const totalDuration = sortedBeats.length * beatDuration * 0.5;

            // Auto-stop after playback completes
            setTimeout(() => {
                this.stopPlayback();
            }, totalDuration + 500); // Add 500ms buffer
        }

        /**
         * Stop playback of recorded notes
         */
        stopPlayback() {
            // Clear all pending playback timeouts
            if (this.playbackTimeouts) {
                this.playbackTimeouts.forEach(id => clearTimeout(id));
                this.playbackTimeouts = [];
            }

            // Reset playing state
            this.isPlaying = false;
            this.isListening = false;

            // Update UI
            $('#srtPauseBtn').hide();
            $('#srtPlayBtn').show();

            // Release all keys
            this.piano.releaseAllKeys();

            // Playback stopped
        }

        /**
         * User Request: Display countdown "3, 2, 1" before starting Scroll mode
         * USER IMPROVEMENT: More fluid, precise countdown with transparent background
         */
        showCountdown(callback) {
            // Prevent double countdown
            if (this._countdownActive) return;
            this._countdownActive = true;

            // Remove any existing countdown overlay
            $('.srt-countdown-overlay').remove();

            const $overlay = $('<div class="srt-countdown-overlay"></div>');
            const $number = $('<div class="srt-countdown-number"></div>');
            $overlay.append($number);
            $('#srtStaffContainer').append($overlay);

            let count = 3;
            const intervalMs = 550; // Faster countdown (550ms per number)

            const showNext = () => {
                if (count > 0) {
                    $number.text(count);
                    $number.css('animation', 'none');
                    void $number[0].offsetWidth;
                    $number.css('animation', `countdown-fade-smooth ${intervalMs / 1000}s cubic-bezier(0.4, 0, 0.2, 1)`);
                    count--;
                    setTimeout(showNext, intervalMs);
                } else {
                    // Countdown finished — unblock input, remove overlay, start scroll
                    this._countdownActive = false;
                    $overlay.remove();
                    if (callback) callback();
                }
            };

            showNext();
        }

        /**
         * Internal function: Actually start the game (called after countdown or immediately)
         */
        _startScrollMode() {
            if (this.isPlaying) {
                return;
            }

            this.isPlaying = true;
            this.isPaused = false;
            this._scrollScanIdx = 0; // Reset scan index for fresh start
            this.sessionStartTime = Date.now();

            // Update UI
            $('#srtPlayBtn').hide();
            $('#srtPauseBtn').show();

            // Start metronome if enabled
            if (this.metronomeEnabled) {
                this.lastMetronomeBeat = Date.now();
            }

            // Play start sound
            this.audio.playSound('start');

            // Log session start
            this.logEvent('session_start', {
                difficulty: this.userSettings.difficulty,
                mode: this.mode
            });
        }
        
        /**
         * Pause the game (also works for listen mode)
         */
        pause() {
            // Support pausing listen mode
            if (this.isListening && !this.listenPaused) {
                this.listenPaused = true;
                // Mute current notes
                if (this.audio) this.audio.stopAll();
                if (this.piano) this.piano.releaseAllKeys();
                // Update UI
                $('#srtPauseBtn').hide();
                $('#srtPlayBtn').show();
                this.logEvent('listen_pause');
                return;
            }

            if (!this.isPlaying || this.isPaused) {
                return;
            }

            this.isPaused = true;

            // Update UI
            $('#srtPauseBtn').hide();
            $('#srtPlayBtn').show();

            // Pause audio
            this.audio.pauseAll();

            // Log pause event
            this.logEvent('session_pause');
        }
        
        /**
         * Stop the game
         * USER FIX: Return to start without displacing notes on staff
         * USER REQUEST: Also stop Listen mode if active
         * USER FIX: Also stop free mode playback if active
         */
        stop() {
            // Stop Listen mode if active
            if (this.isListening) {
                this.stopListening();
            }

            // Always re-enable listen button
            if (this.listenCompleted) {
                this.listenCompleted = false;
                $('#srtListenBtn').prop('disabled', false).css('opacity', '1');
            }

            // Stop free mode playback if active
            if (this.mode === 'free' && this.playbackTimeouts && this.playbackTimeouts.length > 0) {
                this.stopPlayback();
            }

            const wasPlaying = this.isPlaying;
            this.isPlaying = false;
            this.isPaused = false;
            this.scrollPaused = false;

            // Update UI
            $('#srtPauseBtn').hide();
            $('#srtPlayBtn').show();

            // Stop audio
            if (this.audio) this.audio.stopAll();

            // Release all piano keys
            if (this.piano) {
                this.piano.releaseAllKeys();
            }

            // Save session data if was playing
            if (wasPlaying) {
                this.saveSession();
            }

            // ALWAYS reset game state to beginning
            this.currentNoteIndex = 0;
            this.playheadPosition = this.initialPlayheadPosition || 0;
            this.waitModeScrollOffset = 0;
            if (this.scrollOffset !== undefined) {
                this.scrollOffset = 0;
            }

            // Reset note states without regenerating
            if (this.notes && this.notes.length > 0) {
                this.notes.forEach(note => {
                    note.played = false;
                    note.highlighted = false;
                    note.missed = false;
                    note.imprecise = false;
                });
            }

            // Clear feedback and ghost notes
            this.ghostNotes = [];
            if (this.renderer) {
                this.renderer.clearFeedback();
            }

            // Update all displays
            this.updateAllDisplays();
            this.requestRender();

            // Log session end
            if (wasPlaying) {
                this.logEvent('session_stop', {
                    duration: this.sessionDuration,
                    score: this.score,
                    accuracy: this.getAccuracy()
                });
            }
        }
        
        /**
         * Reset the game - generates fresh content using ONLY internal generators
         * Randomizes generator type, key signature, and settings based on difficulty
         * Does NOT load server partitions or library songs (those are for explicit file loading)
         */
        reset() {
            // Stop listen mode explicitly before everything
            if (this.isListening) {
                this.stopListening();
            }

            // Re-enable listen button (reset always generates new sheet)
            this.listenCompleted = false;
            $('#srtListenBtn').prop('disabled', false).css('opacity', '1');

            // Stop the game
            this.stop();

            // Release all piano keys
            if (this.piano) {
                this.piano.releaseAllKeys();
            }

            // Reset statistics
            this.score = 0;
            this.streak = 0;
            this.bestStreak = 0;
            this.correctNotes = 0;
            this.incorrectNotes = 0;
            this.sessionDuration = 0;
            this.sessionStartTime = null;

            // Clear any loaded file - reset always generates fresh content
            this.midiFileLoaded = false;
            this._enableGeneratorSettings();

            // Reset exercise mode markers (but keep exercise mode enabled if user has it on)
            this._lastExerciseIdx = -1;
            if (this.piano) this.piano.clearExerciseHighlights();

            // CRITICAL FIX: Reset ALL scroll/display positions to 0 BEFORE generating
            // This ensures the display starts at the beginning, not at the end of previous piece
            this.initialPlayheadPosition = 0;
            this.playheadPosition = 0;
            this.waitModeScrollOffset = 0;
            this.scrollOffset = 0;
            this.currentNoteIndex = 0;
            this._timelineMeasure = 0;
            this._timelineBeat = 0;

            if (this.mode !== 'free') {
                const difficulty = this.userSettings.difficulty || 'elementary';

                // Always use 'random' generator which now picks from ALL types
                // weighted by difficulty level
                this.userSettings.generator_type = 'random';
                $('.srt-generator-btn').removeClass('active');
                $(`.srt-generator-btn[data-generator="random"]`).addClass('active');

                // Randomize difficulty settings (key, hands, notes) for variety
                if (difficulty !== 'beginner') {
                    this.randomizeDifficultySettings(difficulty);
                }

                // Generate fresh notes (this will recalculate initialPlayheadPosition)
                this.generateInitialNotes();
            } else {
                // In free mode, keep staff empty
                this.notes = [];
                this.freeMode_playedNotes = [];
                this.render();
            }

            // Update displays
            this.updateAllDisplays();

            // Clear feedback
            if (this.renderer) {
                this.renderer.clearFeedback();
            }

            // Log reset event
            this.logEvent('session_reset');
        }

        /**
         * Load a random song from the SightReadingSongsLibrary
         * Converts the library format (pitch/octave/duration) to engine format (midi/beat/measure)
         */
        _loadRandomLibrarySong() {
            const lib = window.SightReadingSongsLibrary;
            if (!lib || !lib.songs) {
                // CRITICAL FIX: Use generateRandom() directly to avoid infinite recursion
                // generateInitialNotes() → generate() → 'song' → _loadRandomLibrarySong() → LOOP!
                this.notes = this.noteGenerator.generateRandom();
                this.notes.forEach(n => { if (n.beat !== undefined) n.beat = snapBeat(n.beat); });
                this.calculateOptimalMeasureWidth();
                this.requestRender();
                return;
            }

            // Filter songs matching current difficulty if possible
            const difficulty = this.userSettings.difficulty || 'beginner';
            let candidates = Object.values(lib.songs).filter(s => s.difficulty === difficulty);

            // DIFFICULTY FIX: If no exact match, try adjacent difficulty levels
            // but NEVER serve beginner content to expert users
            if (candidates.length === 0) {
                const difficultyOrder = ['beginner', 'elementary', 'intermediate', 'advanced', 'expert'];
                const currentIdx = difficultyOrder.indexOf(difficulty);
                // Try one level below, then one above
                for (let offset = 1; offset <= 2 && candidates.length === 0; offset++) {
                    if (currentIdx - offset >= 0) {
                        candidates = Object.values(lib.songs).filter(s => s.difficulty === difficultyOrder[currentIdx - offset]);
                    }
                    if (candidates.length === 0 && currentIdx + offset < difficultyOrder.length) {
                        candidates = Object.values(lib.songs).filter(s => s.difficulty === difficultyOrder[currentIdx + offset]);
                    }
                }
            }

            if (candidates.length === 0) {
                // CRITICAL FIX: Use generateRandom() directly to avoid infinite recursion
                // No songs at all - fall back to generators which respect difficulty
                this.notes = this.noteGenerator.generateRandom();
                this.notes.forEach(n => { if (n.beat !== undefined) n.beat = snapBeat(n.beat); });
                this.calculateOptimalMeasureWidth();
                this.requestRender();
                return;
            }

            const song = candidates[Math.floor(Math.random() * candidates.length)];

            // Pitch name to semitone mapping
            const stepToSemitone = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };

            const pitchToMidi = (pitchStr, octave) => {
                // Handle names like 'C', 'F#', 'Bb', 'Eb'
                let step = pitchStr[0].toUpperCase();
                let alter = 0;
                if (pitchStr.includes('#')) alter = 1;
                else if (pitchStr.includes('b')) alter = -1;
                return (octave + 1) * 12 + (stepToSemitone[step] || 0) + alter;
            };

            const beatsToDuration = (beats) => {
                if (beats >= 4) return 'whole';
                if (beats >= 3) return 'dotted-half';
                if (beats >= 2) return 'half';
                if (beats >= 1.5) return 'dotted-quarter';
                if (beats >= 1) return 'quarter';
                if (beats >= 0.75) return 'dotted-eighth';
                if (beats >= 0.5) return 'eighth';
                return 'sixteenth';
            };

            // Convert song measures to engine notes
            this.notes = [];
            if (song.measures) {
                song.measures.forEach((measure, mIdx) => {
                    if (measure.notes) {
                        measure.notes.forEach(n => {
                            const midi = pitchToMidi(n.pitch, n.octave || 4);
                            this.notes.push({
                                midi: midi,
                                duration: beatsToDuration(n.duration || 1),
                                measure: mIdx,
                                beat: n.beat || 0,
                                staff: midi >= 60 ? 'treble' : 'bass',
                                accidental: n.pitch.includes('#') ? 'sharp' : (n.pitch.includes('b') ? 'flat' : null)
                            });
                        });
                    }
                });
            }

            // CRITICAL: Set midiFileLoaded BEFORE applying settings to prevent
            // setKeySignature() → generateInitialNotes() from overwriting our notes
            this.midiFileLoaded = true;

            // Apply song settings WITHOUT triggering regeneration
            if (song.tempo) {
                this.tempo = song.tempo;
                this.scrollSpeed = song.tempo / 100;
                $('#srtTempoSlider').val(song.tempo);
                $('#srtTempoValue').text(song.tempo);
            }
            if (song.keySignature) {
                // Set key directly without calling setKeySignature() which triggers generateInitialNotes
                this.staffSettings.keySignature = song.keySignature;
                this.userSettings.key_signature = song.keySignature;
                if (this.renderer) {
                    this.renderer.setKeySignature(song.keySignature);
                }
                $('.srt-key-btn').removeClass('active');
                $(`.srt-key-btn[data-key="${song.keySignature}"]`).addClass('active');
            }
            if (song.timeSignature) {
                this.staffSettings.timeSignature = song.timeSignature;
                if (this.renderer) {
                    this.renderer.setTimeSignature(song.timeSignature);
                }
            }

            // Disable generator settings since a song is loaded
            this._disableGeneratorSettings();
            this.calculateOptimalMeasureWidth();

            // Position playhead
            if (this.renderer && this.notes.length > 0) {
                const visualPlayheadX = this.getVisualPlayheadX();
                const firstNote = this.notes[0];
                const firstNoteWorldX = this.renderer.getNoteX(firstNote);
                this.initialPlayheadPosition = firstNoteWorldX - visualPlayheadX - 7;
                this.playheadPosition = this.initialPlayheadPosition;
                this.waitModeScrollOffset = this.initialPlayheadPosition;
            }

            this.showMessage(`Loaded: ${song.title} (${song.composer || 'Traditional'})`, 'success');
            this.requestRender();
        }

        /**
         * USER REQUEST: Listen button - Play all notes on the staff then return to start
         * Mode Wait/Scroll: Play partition then return to beginning
         * Mode Free: Play all displayed notes then stop
         */
        async listen() {
            if (this.isPlaying && !this.isPaused) {
                this.showMessage('Stop the game first to listen', 'warning');
                return;
            }
            if (this.isListening) return;
            if (!this.notes || this.notes.length === 0) {
                this.showMessage('No notes to play', 'warning');
                return;
            }
            if (!this.audio || !this.audio.isReady) {
                this.showMessage('Audio engine not ready. Please wait...', 'warning');
                return;
            }

            this.isListening = true;
            this.listenStopped = false;
            this.listenPaused = false;
            this.listenCompleted = false;
            $('#srtListenBtn').prop('disabled', true).css('opacity', '0.6');
            // Show pause button during listen playback
            $('#srtPlayBtn').hide();
            $('#srtPauseBtn').show();

            // Reset all note states for clean listen playback
            this.notes.forEach(n => {
                n._listenPlayed = false;
                n.played = false;
                n.highlighted = false;
            });

            // Declare scrollAnimFrame outside try so finally can access it
            let scrollAnimFrame = null;

            try {
                // Duration multipliers relative to quarter note
                const durationMultipliers = {
                    'whole': 4, 'dotted-half': 3, 'half': 2,
                    'dotted-quarter': 1.5, 'quarter': 1,
                    'dotted-eighth': 0.75, 'eighth': 0.5,
                    'sixteenth': 0.25, 'rest': 1
                };
                const getDurationMs = (durationType) => {
                    const qDur = (60 / this.tempo) * 1000;
                    return qDur * (durationMultipliers[durationType] || 1);
                };
                const getDurationSec = (durationType) => getDurationMs(durationType) / 1000;

                // Pause-aware delay: waits ms, but pauses if listenPaused is true
                const listenDelay = (ms) => {
                    return new Promise(resolve => {
                        const startTime = Date.now();
                        let remaining = ms;
                        const tick = () => {
                            if (this.listenStopped) { resolve(); return; }
                            if (this.listenPaused) {
                                // Store resolver so resume can call it
                                this._listenResumeResolve = () => {
                                    // Continue with remaining time after resume
                                    const elapsed = Date.now() - startTime;
                                    remaining = Math.max(0, ms - elapsed);
                                    if (remaining <= 0) { resolve(); return; }
                                    setTimeout(tick, Math.min(remaining, 50));
                                };
                                return; // Stop ticking, wait for resume
                            }
                            const elapsed = Date.now() - startTime;
                            remaining = ms - elapsed;
                            if (remaining <= 0) { resolve(); return; }
                            setTimeout(tick, Math.min(remaining, 50));
                        };
                        setTimeout(tick, Math.min(ms, 50));
                    });
                };

                // Sort and group notes by timeline position (using snapped beats for stable sort)
                const sortedNotes = [...this.notes].sort((a, b) => {
                    const posA = (a.measure || 0) * 4 + snapBeat(a.beat);
                    const posB = (b.measure || 0) * 4 + snapBeat(b.beat);
                    return posA - posB;
                });

                // Group notes at exact same position (chords)
                // Use string key to avoid floating point comparison issues
                const noteGroups = [];
                let currentGroup = [];
                let currentKey = '';
                let currentPos = -999;

                for (const note of sortedNotes) {
                    const pos = (note.measure || 0) * 4 + snapBeat(note.beat);
                    const key = `${note.measure || 0}-${snapBeat(note.beat)}`;
                    if (key === currentKey) {
                        currentGroup.push(note);
                    } else {
                        if (currentGroup.length > 0) noteGroups.push({ notes: [...currentGroup], pos: currentPos });
                        currentGroup = [note];
                        currentKey = key;
                        currentPos = pos;
                    }
                }
                if (currentGroup.length > 0) noteGroups.push({ notes: currentGroup, pos: currentPos });

                // Smooth scroll animation state
                const canvasWidth = this.renderer
                    ? (this.canvas.width / (window.devicePixelRatio || 1))
                    : 800;
                const noteStartX = (this.renderer && this.renderer.calculatedNoteStartX) || 200;
                let targetScrollOffset = this.waitModeScrollOffset;
                let currentScrollOffset = this.waitModeScrollOffset;

                // FIX: Use lightweight scroll lerp that updates offset only (no extra render loop)
                // The main startAnimationLoop already calls render() every frame
                const animateScroll = () => {
                    if (this.listenStopped) {
                        if (scrollAnimFrame) cancelAnimationFrame(scrollAnimFrame);
                        return;
                    }
                    // Lerp toward target (smooth easing)
                    const diff = targetScrollOffset - currentScrollOffset;
                    if (Math.abs(diff) > 1) {
                        currentScrollOffset += diff * 0.15;
                        this.waitModeScrollOffset = Math.round(currentScrollOffset);
                    } else {
                        currentScrollOffset = targetScrollOffset;
                        this.waitModeScrollOffset = targetScrollOffset;
                    }
                    // NOTE: No this.render() here - main animation loop handles rendering
                    scrollAnimFrame = requestAnimationFrame(animateScroll);
                };
                scrollAnimFrame = requestAnimationFrame(animateScroll);

                for (let i = 0; i < noteGroups.length; i++) {
                    if (this.listenStopped) break;
                    // Wait while paused
                    while (this.listenPaused && !this.listenStopped) {
                        await new Promise(r => { this._listenResumeResolve = r; });
                    }
                    if (this.listenStopped) break;

                    const group = noteGroups[i];
                    const firstNote = group.notes[0];

                    // Update counting timeline position for this note group
                    this._timelineMeasure = firstNote.measure || 0;
                    this._timelineBeat = firstNote.beat || 0;

                    // Tick metronome on integer beats during listen
                    if (this.metronomeEnabled && this.audio) {
                        const beat = firstNote.beat || 0;
                        if (Math.abs(beat - Math.round(beat)) < 0.05) {
                            const isDownbeat = Math.round(beat) === 0;
                            this.audio.playMetronomeTick(isDownbeat);
                        }
                    }

                    // Highlight upcoming notes (gold) before playing
                    group.notes.forEach(n => {
                        n.highlighted = true;
                    });

                    // Calculate scroll target to keep current note visible
                    if (this.renderer) {
                        const noteX = this.renderer.getNoteX(firstNote);
                        // Target: note should appear ~1/3 from the left
                        const idealX = noteStartX + canvasWidth * 0.3;
                        const neededScroll = noteX - idealX;
                        if (neededScroll > targetScrollOffset + 10) {
                            targetScrollOffset = neededScroll;
                        }
                    }

                    // Handle rests - wait without playing
                    if (firstNote.isRest || firstNote.duration === 'rest' || firstNote.midi === null) {
                        await listenDelay(getDurationMs(firstNote.duration));
                        group.notes.forEach(n => { n.highlighted = false; });
                        continue;
                    }

                    // Play all notes in this group using attack/release for proper sustain
                    const midiNotes = group.notes.filter(n => n.midi).map(n => n.midi);
                    const noteDurationSec = getDurationSec(firstNote.duration);

                    for (const midi of midiNotes) {
                        this.audio.playNoteAttack(midi, 90);
                        this.piano.highlightKey(midi);
                    }

                    // Mark as playing (green)
                    group.notes.forEach(n => {
                        n.highlighted = false;
                        n._listenPlayed = true;
                        n.played = true;
                    });

                    // Calculate time to next note group for scheduling
                    let waitTime;
                    if (i + 1 < noteGroups.length) {
                        const nextPos = noteGroups[i + 1].pos;
                        const beatDiff = nextPos - group.pos;
                        const qDur = (60 / this.tempo) * 1000;
                        waitTime = beatDiff * qDur;
                        // Clamp to prevent extremely long waits
                        waitTime = Math.min(waitTime, getDurationMs('whole') * 2);
                    } else {
                        waitTime = getDurationMs(firstNote.duration);
                    }

                    // Release notes after their actual duration
                    const releaseDelay = Math.min(waitTime * 0.85, getDurationMs(firstNote.duration) * 0.9);
                    setTimeout(() => {
                        for (const midi of midiNotes) {
                            this.audio.releaseNote(midi);
                            this.piano.releaseKey(midi);
                        }
                    }, releaseDelay);

                    // Wait for the interval to next note (pause-aware)
                    await listenDelay(waitTime);

                    // Update counting timeline position during listen
                    if (this.renderer && group.notes[0]) {
                        const n = group.notes[0];
                        this._timelineMeasure = n.measure || 0;
                        this._timelineBeat = n.beat || 0;
                    }
                }

            } catch (error) {
                console.error('Listen error:', error);
                this.showMessage('Playback error', 'error');
            } finally {
                const wasStopped = this.listenStopped;
                this.isListening = false;
                this.listenPaused = false;
                this._listenResumeResolve = null;
                // FIX: Cancel the listen scroll RAF loop to prevent competing loops
                if (scrollAnimFrame) cancelAnimationFrame(scrollAnimFrame);
                scrollAnimFrame = null;

                // Release any stuck notes
                if (this.audio) this.audio.stopAll();
                if (this.piano) this.piano.releaseAllKeys();

                // Reset listen state - notes must go back to black (not green)
                this.notes.forEach(n => {
                    delete n._listenPlayed;
                    n.highlighted = false;
                    n.played = false;
                    n.missed = false;
                    n.imprecise = false;
                });

                // Always re-enable listen button and reset to start
                this.listenCompleted = false;
                $('#srtListenBtn').prop('disabled', false).css('opacity', '1');
                // Return partition to beginning
                this.waitModeScrollOffset = 0;
                this.playheadPosition = this.initialPlayheadPosition || 0;
                this.currentNoteIndex = 0;

                // Restore play button
                $('#srtPauseBtn').hide();
                $('#srtPlayBtn').show();

                this.requestRender();
            }
        }

        /**
         * USER REQUEST: Stop Listen mode - can be triggered by Stop button or staff changes
         */
        stopListening() {
            if (!this.isListening) return;

            this.isListening = false;
            this.listenStopped = true;
            this.listenPaused = false;

            // Unblock any paused delay
            if (this._listenResumeResolve) {
                this._listenResumeResolve();
                this._listenResumeResolve = null;
            }

            if (this.audio) {
                this.audio.stopAll();
            }
            if (this.piano) {
                this.piano.releaseAllKeys();
            }

            // Clean up listen-played visual state
            if (this.notes) {
                this.notes.forEach(n => {
                    delete n._listenPlayed;
                    n.played = false;
                });
            }

            // Reset scroll to beginning
            this.waitModeScrollOffset = 0;
            this.playheadPosition = this.initialPlayheadPosition || 0;
            this.currentNoteIndex = 0;
            this.requestRender();

            $('#srtListenBtn').prop('disabled', false).css('opacity', '1');
            // Restore play button
            $('#srtPauseBtn').hide();
            $('#srtPlayBtn').show();
        }

        /**
         * Handle note input - UPDATED WITH CHORD DETECTION (PRIO 1 FIX - HOTFIX v2)
         * OPTIMIZED: Faster processing, especially in Free mode
         */
        handleNoteInput(note, velocity = 127, source = 'keyboard') {
            // USER FIX: Play note with sustain pedal awareness
            // If pedal is OFF, use short duration (note stops on key release)
            // If pedal is ON, use triggerAttack (note sustains until pedal release)
            if (this.sustainPedalActive) {
                this.audio.playNoteWithSustain(note, velocity);
            } else {
                // Short note - will be released when key is released
                this.audio.playNoteAttack(note, velocity);
            }
            this.piano.highlightKey(note);

            // Add note to chord detector
            this.chordDetector.addNote(note);

            // Clear any pending timeout
            if (this.chordDetectionTimeout) {
                clearTimeout(this.chordDetectionTimeout);
            }

            // Adaptive timeout based on mode and context
            // Free mode: 50ms (fast feedback)
            // Wait/Scroll: 120ms (allow time for chord input - increased from 80ms)
            // CRITICAL FIX: Increased timeout to give users more time to play all chord notes
            const timeout = this.mode === 'free' ? 50 : 120;

            // Wait for potential chord completion
            this.chordDetectionTimeout = setTimeout(() => {
                // Get the complete chord (or single note)
                // CRITIQUE: Free Mode needs timestamps to distinguish rapid sequential from simultaneous
                let chord;
                if (this.mode === 'free') {
                    chord = this.chordDetector.getChordWithTimestamps(); // Returns [{midi, timestamp}, ...]
                } else {
                    chord = this.chordDetector.getCurrentChord(); // Returns [midi, midi, ...]
                }

                //     isChord: chord.length > 1,
                //     notes: chord,
                //     mode: this.mode,
                //     timeout: timeout
                // });

                // Block input during countdown
                if (this._countdownActive) {
                    this.chordDetector.clear();
                    return;
                }

                // Process the chord/note based on mode
                if (this.mode === 'free') {
                    // Free mode: add chord/note to staff (with timestamps)
                    this.handleFreeMode(chord);
                } else if (!this.isPlaying || this.isPaused) {
                    // Auto-start: if in wait/scroll mode and user plays a note, start automatically
                    if ((this.mode === 'wait' || this.mode === 'scroll') && this.notes.length > 0) {
                        this.start();
                        // After starting, process the note
                        if (this.mode === 'wait') {
                            this.checkNoteInWaitMode(chord);
                        } else if (this.mode === 'scroll') {
                            this.checkNoteInScrollMode(chord);
                        }
                    } else {
                        this.chordDetector.clear();
                        return;
                    }
                } else if (this.mode === 'wait') {
                    this.checkNoteInWaitMode(chord);
                } else if (this.mode === 'scroll') {
                    this.checkNoteInScrollMode(chord);
                }

                // Clear the detector buffer
                this.chordDetector.clear();

                // Log note input
                const midiNotes = this.mode === 'free'
                    ? chord.map(n => n.midi) // Extract MIDI from objects
                    : chord; // Already MIDI array
                this.logEvent('note_input', {
                    notes: midiNotes,
                    isChord: chord.length > 1,
                    velocity: velocity,
                    source: source,
                    mode: this.mode
                });
            }, timeout); // Adaptive timeout
        }

        /**
         * Handle note/chord in free mode - add to staff
         * UPDATED: Now distinguishes rapid sequential notes from true simultaneous chords
         * CRITIQUE FIX: Notes rapides ne doivent pas s'empiler - seulement les vrais accords
         * @param {Array<{midi: number, timestamp: number}>} notesWithTimestamps - Array of note objects with MIDI and timestamps
         */
        handleFreeMode(notesWithTimestamps) {
            // Normalize input to array of objects
            const noteObjects = Array.isArray(notesWithTimestamps) ? notesWithTimestamps : [notesWithTimestamps];

            if (noteObjects.length === 0) return;

            // CRITIQUE: Analyze timestamp gaps to distinguish true chords from rapid sequential notes
            // True simultaneous chord: all notes within 15ms of each other
            // Rapid sequential: gaps > 15ms between consecutive notes
            const SIMULTANEOUS_THRESHOLD_MS = 15;

            let isTrueChord = true;
            if (noteObjects.length > 1) {
                // Check gaps between consecutive notes
                for (let i = 1; i < noteObjects.length; i++) {
                    const gap = noteObjects[i].timestamp - noteObjects[i-1].timestamp;
                    if (gap > SIMULTANEOUS_THRESHOLD_MS) {
                        isTrueChord = false;
                        break;
                    }
                }
            }

            //     noteCount: noteObjects.length,
            //     isTrueChord: isTrueChord,
            //     timestamps: noteObjects.map(n => n.timestamp),
            //     gaps: noteObjects.length > 1
            //         ? noteObjects.slice(1).map((n, i) => n.timestamp - noteObjects[i].timestamp)
            //         : []
            // });

            // Process notes based on whether they're a true chord or rapid sequence
            if (isTrueChord) {
                // TRUE CHORD: All notes share same beatPosition (stack vertically)
                const beatPosition = this.freeMode_playedNotes.length * 0.5;
                const measureNumber = Math.floor(beatPosition / 4);
                const beatInMeasure = beatPosition % 4;

                noteObjects.forEach((noteObj, chordIndex) => {
                    const staffType = noteObj.midi >= 57 ? 'treble' : 'bass';

                    const newNote = {
                        midi: noteObj.midi,
                        duration: 'quarter',
                        measure: measureNumber,
                        beat: beatInMeasure,
                        played: true,
                        staff: staffType,
                        timestamp: noteObj.timestamp,
                        isChord: true,
                        chordIndex: chordIndex,
                        chordSize: noteObjects.length
                    };

                    this.freeMode_playedNotes.push(newNote);
                });

            } else {
                // RAPID SEQUENTIAL: Each note gets its own beatPosition (display horizontally)
                noteObjects.forEach((noteObj) => {
                    const beatPosition = this.freeMode_playedNotes.length * 0.5;
                    const measureNumber = Math.floor(beatPosition / 4);
                    const beatInMeasure = beatPosition % 4;
                    const staffType = noteObj.midi >= 57 ? 'treble' : 'bass';

                    const newNote = {
                        midi: noteObj.midi,
                        duration: 'quarter',
                        measure: measureNumber,
                        beat: beatInMeasure,
                        played: true,
                        staff: staffType,
                        timestamp: noteObj.timestamp,
                        isChord: false, // NOT a chord - sequential
                        chordIndex: 0,
                        chordSize: 1
                    };

                    this.freeMode_playedNotes.push(newNote);

                });
            }

            // FREE PLAY SCROLL: Notes fill visible staff first, then scroll left
            // Limit rendered notes to prevent performance issues when playing fast
            const maxRenderNotes = 80;
            const allNotes = this.freeMode_playedNotes;
            const renderStart = Math.max(0, allNotes.length - maxRenderNotes);
            const notesToRender = allNotes.slice(renderStart);

            // If we're windowing, remap beat positions to start from 0
            if (renderStart > 0) {
                const beatPositionMap = new Map();
                let adjustedBeatCounter = 0;
                notesToRender.forEach(note => {
                    const key = `${note.measure}-${snapBeat(note.beat)}`;
                    if (!beatPositionMap.has(key)) {
                        const adjBeat = adjustedBeatCounter * 0.5;
                        beatPositionMap.set(key, {
                            measure: Math.floor(adjBeat / 4),
                            beat: adjBeat % 4
                        });
                        adjustedBeatCounter++;
                    }
                });
                this.notes = notesToRender.map(note => {
                    const adj = beatPositionMap.get(`${note.measure}-${snapBeat(note.beat)}`);
                    return { ...note, measure: adj.measure, beat: adj.beat };
                });
            } else {
                this.notes = allNotes.map(note => ({ ...note }));
            }

            // Calculate if the last note exceeds the visible staff area
            if (this.renderer && this.notes.length > 0) {
                const lastNote = this.notes[this.notes.length - 1];
                const lastNoteX = this.renderer.getNoteX(lastNote);
                const canvasWidth = this.canvas.width / (window.devicePixelRatio || 1);
                const rightMargin = 80;

                if (lastNoteX > canvasWidth - rightMargin) {
                    const targetOffset = -(lastNoteX - canvasWidth + rightMargin);
                    // Smooth scrolling - ease towards target
                    const currentOffset = this.scrollOffset || 0;
                    this.scrollOffset = currentOffset + (targetOffset - currentOffset) * 0.6;
                } else {
                    this.scrollOffset = 0;
                }
            }

            // Render immediately
            this.requestRender();
        }
        
        /**
         * Check note/chord in wait mode - IMPROVED (PRIO 1 + PRIO 2)
         * @param {Array<number>|number} playedChord - Array of MIDI notes (chord) or single MIDI note
         */
        checkNoteInWaitMode(playedChord) {
            if (this.currentNoteIndex >= this.notes.length) {
                return;
            }

            // Normalize input to array
            const playedNotes = Array.isArray(playedChord) ? playedChord : [playedChord];

            // Get expected note(s) at current position
            // If it's a chord, we need to collect ALL notes at the same beat position
            const expectedNotes = this.getExpectedNotesAtIndex(this.currentNoteIndex);

            // Filter out rests and tie continuations from expected notes
            // CRITICAL: Don't skip the ENTIRE group just because one staff has a rest
            // A rest on treble staff should NOT prevent playing bass notes at the same beat
            const playableNotes = expectedNotes.filter(n => !n.isRest && n.midi !== null && !n.tieContinuation);

            // If ALL notes at this position are rests/ties, skip to next position
            if (playableNotes.length === 0) {
                // Mark rests as played so they advance
                expectedNotes.forEach(n => { if (n.isRest) n.played = true; });
                this.currentNoteIndex += expectedNotes.length;

                if (this.currentNoteIndex >= this.notes.length) {
                    this.handleExerciseComplete();
                    return;
                }

                // Recursively check next position (limit recursion depth)
                const nextExpected = this.getExpectedNotesAtIndex(this.currentNoteIndex);
                const nextPlayable = nextExpected.filter(n => !n.isRest && n.midi !== null && !n.tieContinuation);
                if (nextPlayable.length === 0 && this.currentNoteIndex < this.notes.length) {
                    // Still rests - advance again
                    nextExpected.forEach(n => { if (n.isRest) n.played = true; });
                    this.currentNoteIndex += nextExpected.length;
                    if (this.currentNoteIndex >= this.notes.length) {
                        this.handleExerciseComplete();
                        return;
                    }
                }
                // Update expectedNotes for the comparison below
                expectedNotes.length = 0;
                expectedNotes.push(...this.getExpectedNotesAtIndex(this.currentNoteIndex));
            }

            // Use only playable notes (non-rests) for comparison
            const filteredExpected = expectedNotes.filter(n => !n.isRest && n.midi !== null && !n.tieContinuation);
            if (filteredExpected.length === 0) return;

            // Start timing for this note if first attempt
            if (this.waitModeAttempts === 0) {
                this.waitModeNoteStartTime = performance.now();
            }

            // DEBUG MODE WAIT
            //     playedNotes,
            //     playedIsChord: playedNotes.length > 1,
            //     expectedNotes: expectedNotes.map(n => n.midi),
            //     expectedIsChord: expectedNotes.length > 1,
            //     currentIndex: this.currentNoteIndex,
            //     attempts: this.waitModeAttempts,
            //     octaveTolerance: this.waitModeOctaveTolerance
            // });

            // Compare played vs expected (with octave tolerance setting)
            // Use filteredExpected (no rests) so rests on one staff don't block the other
            const isCorrect = this.isCorrectChord(playedNotes, filteredExpected);


            if (isCorrect) {
                // Calculate time spent on this note
                const timeSpent = performance.now() - this.waitModeNoteStartTime;

                // USER FIX: Track if there were mistakes before correct answer
                const hadMistakes = this.waitModeAttempts > 0;

                // Reset attempts counter
                this.waitModeAttempts = 0;

                // USER FIX: Mark notes based on whether there were mistakes
                // - GREEN (played=true): correct on first try
                // - YELLOW (imprecise=true): correct after mistakes
                // Note: incorrect attempts were already counted in handleIncorrectNote
                expectedNotes.forEach(note => {
                    note.highlighted = false; // Remove gold highlight
                    if (hadMistakes) {
                        note.imprecise = true; // YELLOW - correct but after mistakes
                        // Don't increment incorrectNotes again - already counted per wrong attempt
                    } else {
                        note.played = true; // GREEN - correct on first try
                    }
                    this.handleCorrectNote(note);
                });

                // Advance by the number of notes in the chord
                this.currentNoteIndex += expectedNotes.length;

                // Auto-skip trailing rests/ties at end of piece so game completes immediately
                while (this.currentNoteIndex < this.notes.length) {
                    const nextGroup = this.getExpectedNotesAtIndex(this.currentNoteIndex);
                    const nextPlayable = nextGroup.filter(n => !n.isRest && n.midi !== null && !n.tieContinuation);
                    if (nextPlayable.length === 0) {
                        nextGroup.forEach(n => { if (n.isRest) n.played = true; });
                        this.currentNoteIndex += nextGroup.length;
                    } else {
                        break;
                    }
                }

                // Force exercise mode to refresh next-note highlighting
                this._lastExerciseIdx = -1;

                // USER REQUEST: Auto-scroll in wait mode when approaching end of visible area
                // Check if current note is near the right edge of visible staff
                this.checkWaitModeAutoScroll();

                // Check if exercise complete
                if (this.currentNoteIndex >= this.notes.length) {
                    this.handleExerciseComplete();
                }
            } else {
                // Increment attempt counter
                this.waitModeAttempts++;


                // Show hint after max attempts (PRIO 2)
                if (this.waitModeAttempts >= this.waitModeMaxHints) {
                    this.showWaitModeHint(expectedNotes);
                }

                // Handle incorrect feedback
                this.handleIncorrectNote(playedNotes, expectedNotes[0]);
            }
        }

        /**
         * USER REQUEST: Auto-scroll in wait mode when approaching end of visible staff
         * Scrolls the notes left when player is 4 notes from the end of visible area
         */
        checkWaitModeAutoScroll() {
            if (this.currentNoteIndex >= this.notes.length) return;

            // Get the current note's X position
            const currentNote = this.notes[this.currentNoteIndex];
            if (!currentNote) return;

            // Calculate the note's visual X position (accounting for scroll offset)
            const noteX = this.renderer ? this.renderer.getNoteX(currentNote) : 0;
            const visibleNoteX = noteX - this.waitModeScrollOffset;

            // Get canvas width for visible area calculation
            const canvasWidth = this.canvas ? this.canvas.width / (window.devicePixelRatio || 1) : 1200;
            const staffEndX = canvasWidth - 100; // Leave some margin on the right

            // If the current note is near the right edge, scroll
            // USER REQUEST: scroll when 4 notes before end of visible area
            if (visibleNoteX > staffEndX - 200) { // 200px threshold = approximately 4 notes
                // Calculate scroll amount (one measure width, approximately)
                const scrollAmount = 150; // Scroll by approximately 150px (1-2 notes worth)
                this.waitModeScrollOffset += scrollAmount;

                // Apply smooth scroll animation
                this.animateWaitModeScroll(scrollAmount);
            }
        }

        /**
         * Animate smooth scrolling in wait mode
         */
        animateWaitModeScroll(targetScrollAmount) {
            // Update the scroll offset which is used in rendering
            // The render function should use this.waitModeScrollOffset to translate the canvas
            // Force a re-render
            if (this.renderer) {
                this.requestRender();
            }
        }

        /**
         * Get current expected note(s) for auto-start feature
         * Returns the note(s) that should be played next based on current game mode
         * @returns {Array|null} Array of expected note objects, or null if none
         */
        getCurrentExpectedNote() {
            if (this.mode === 'wait') {
                // In wait mode, return the note(s) at current index
                return this.getExpectedNotesAtIndex(this.currentNoteIndex);
            } else if (this.mode === 'scroll') {
                // In scroll mode, return the first note(s) in playhead range
                const visualPlayheadX = this.getVisualPlayheadX(); // Dynamic position
                const playheadRange = 80; // Increased from 50 for better click-to-play detection

                const notesInRange = this.notes.filter(note => {
                    const notePosition = this.getNotePosition(note);
                    const playheadWorldPosition = this.playheadPosition + visualPlayheadX;
                    return Math.abs(notePosition - playheadWorldPosition) < playheadRange && !note.played;
                });

                if (notesInRange.length > 0) {
                    // Group by beat to get first chord/note
                    const chordGroups = this.groupNotesByBeat(notesInRange);
                    return chordGroups.length > 0 ? chordGroups[0] : null;
                }

                // FIX: If game not started, return first unplayed note(s) for click-to-play
                // This ensures click-to-play works even if playhead position isn't perfect
                if (!this.isPlaying && this.notes.length > 0) {
                    const firstUnplayed = this.notes.filter(n => !n.played && !n.missed);
                    if (firstUnplayed.length > 0) {
                        const firstNote = firstUnplayed[0];
                        const targetBeat = snapBeat(firstNote.beat);
                        const targetMeasure = firstNote.measure;
                        // Get all notes at same beat position (chord)
                        const chordNotes = firstUnplayed.filter(n =>
                            n.measure === targetMeasure && snapBeat(n.beat) === targetBeat
                        );
                        return chordNotes;
                    }
                }
            }

            return null;
        }

        /**
         * Get expected note(s) at current index
         * CRITICAL FIX: ALWAYS check for notes at the same beat position
         * Don't rely on isChord flag - always collect all notes at same measure+beat
         * @param {number} index - Current note index
         * @returns {Array} Array of expected note objects
         */
        getExpectedNotesAtIndex(index) {
            if (index >= this.notes.length) return [];

            const firstNote = this.notes[index];
            const expectedNotes = [firstNote];

            // CRITICAL FIX: ALWAYS collect notes at same beat position
            // Previously only checked if isChord flag was true - caused chord recognition to fail
            // when notes weren't explicitly marked as chords
            const targetMeasure = firstNote.measure;
            const targetBeat = snapBeat(firstNote.beat);

            // Collect all subsequent notes at the same beat (regardless of isChord flag)
            // Use snapped beats to avoid floating-point mismatches (e.g. 1.999 vs 2.0)
            for (let i = index + 1; i < this.notes.length; i++) {
                const nextNote = this.notes[i];

                // Same measure and beat (snapped) = same chord
                if (nextNote.measure === targetMeasure && snapBeat(nextNote.beat) === targetBeat) {
                    expectedNotes.push(nextNote);
                } else {
                    break; // Different beat, stop collecting
                }
            }

            //     index,
            //     expectedCount: expectedNotes.length,
            //     notes: expectedNotes.map(n => n.midi),
            //     isChord: expectedNotes.length > 1
            // });

            return expectedNotes;
        }

        /**
         * Check if two MIDI notes match, with optional octave tolerance (PRIO 2)
         * @param {number} playedMidi - Played MIDI note
         * @param {number} expectedMidi - Expected MIDI note
         * @param {boolean} octaveTolerance - Allow octave differences
         * @returns {boolean} True if notes match
         */
        notesMatch(playedMidi, expectedMidi, octaveTolerance = false) {
            if (playedMidi === expectedMidi) {
                return true;
            }

            if (octaveTolerance) {
                // Compare note classes (C, D, E, F, G, A, B) regardless of octave
                const playedClass = playedMidi % 12;
                const expectedClass = expectedMidi % 12;
                return playedClass === expectedClass;
            }

            return false;
        }

        /**
         * Show hint for current expected note (PRIO 2)
         * @param {Array} expectedNotes - Array of expected note objects
         */
        showWaitModeHint(expectedNotes) {
            if (!this.waitModeHintsEnabled) return;

            const noteNames = expectedNotes.map(note => {
                const noteClass = note.midi % 12;
                const noteNamesArray = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
                const octave = Math.floor(note.midi / 12) - 1;
                return `${noteNamesArray[noteClass]}${octave}`;
            });

            const hintMessage = expectedNotes.length > 1
                ? `Hint: Play chord [${noteNames.join(', ')}]`
                : `Hint: Play ${noteNames[0]}`;

            this.showFeedbackMessage(hintMessage, 'hint');

            // Highlight expected notes on staff
            if (this.renderer && this.renderer.highlightExpectedNotes) {
                this.renderer.highlightExpectedNotes(expectedNotes);
            }

        }
        
        /**
         * Check note/chord in scroll mode - UPDATED WITH CHORD SUPPORT (PRIO 1 FIX)
         * @param {Array<number>|number} playedChord - Array of MIDI notes (chord) or single MIDI note
         */
        checkNoteInScrollMode(playedChord) {
            // Normalize input to array
            const playedNotes = Array.isArray(playedChord) ? playedChord : [playedChord];

            // FIXED: Account for visual playhead position (dynamic)
            // Visual playhead is at dynamic screen position based on key signature
            // Notes scroll with canvas translate, so a note is "at playhead" when:
            // notePosition (world) - playheadPosition (scroll offset) = visualPlayheadX (screen)
            // Rearranging: notePosition = playheadPosition + visualPlayheadX
            const visualPlayheadX = this.getVisualPlayheadX(); // Dynamic position
            const playheadRange = 50; // pixels tolerance

            // FIX: When scroll is paused, use larger tolerance to allow "rescuing" notes
            // This handles both:
            // 1. Notes that were missed (passed playhead without being played)
            // 2. Notes where wrong note was played (still at playhead)
            const currentRange = this.scrollPaused ? 150 : playheadRange; // Larger tolerance when paused

            let notesInRange = this.notes.filter(note => {
                if (note.played) return false; // Already played, skip
                if (note.isRest || note.midi === null) return false; // Skip rests

                const notePosition = this.getNotePosition(note); // World position
                const playheadWorldPosition = this.playheadPosition + visualPlayheadX; // Playhead in world space

                // When scroll is paused, use extended range in both directions
                if (this.scrollPaused) {
                    // Check if note is within extended range (allows rescuing missed notes)
                    return notePosition > playheadWorldPosition - currentRange &&
                           notePosition < playheadWorldPosition + currentRange;
                }

                // Normal detection: note is near playhead
                return Math.abs(notePosition - playheadWorldPosition) < playheadRange;
            });

            if (notesInRange.length === 0) return;

            // Group notes by beat position (to detect expected chords)
            const chordGroups = this.groupNotesByBeat(notesInRange);

            //     playedNotes,
            //     playedIsChord: playedNotes.length > 1,
            //     chordsInRange: chordGroups.length
            // });

            // Try to match played chord/note with expected chord(s)
            let matchFound = false;
            for (const expectedGroup of chordGroups) {
                const expectedMidi = expectedGroup.map(n => n.midi);

                // Check if this chord matches
                if (this.isCorrectChord(playedNotes, expectedGroup)) {
                    // Mark all notes in the chord as played
                    expectedGroup.forEach(note => {
                        this.handleCorrectNote(note);
                        note.played = true;
                    });
                    matchFound = true;

                    // Timing feedback: compare note position to playhead
                    // distance > 0 = note is ahead (early), < 0 = note is behind (late)
                    const notePos = this.getNotePosition(expectedGroup[0]);
                    const phWorld = this.playheadPosition + this.getVisualPlayheadX();
                    const distance = notePos - phWorld; // positive = early
                    const absDistance = Math.abs(distance);

                    if (absDistance < 10) {
                        // Perfect timing — green + explosion
                        this._scrollTimingFeedback = 'perfect';
                        if (this.renderer) {
                            expectedGroup.forEach(n => {
                                const worldX = this.renderer.getNoteX(n);
                                const worldY = this.renderer.getNoteY(n);
                                this.renderer.spawnPerfectExplosion(worldX, worldY);
                            });
                        }
                    } else if (absDistance < 25) {
                        // Close — orange
                        this._scrollTimingFeedback = 'early';
                    } else if (absDistance < 45) {
                        // Early/late — red
                        this._scrollTimingFeedback = 'wrong';
                    } else {
                        // Way too early — no visual reaction
                        this._scrollTimingFeedback = null;
                    }
                    // Clear feedback after 400ms
                    clearTimeout(this._scrollFeedbackTimer);
                    this._scrollFeedbackTimer = setTimeout(() => {
                        this._scrollTimingFeedback = null;
                    }, 400);

                    // Resume scrolling if it was paused
                    this.scrollPaused = false;

                    // FIXED: Check if all playable notes have been played (exercise complete)
                    const totalPlayableNotes = this.notes.filter(n => !n.isRest && n.duration !== 'rest' && n.midi !== null).length;
                    const playedNotes = this.notes.filter(n => n.played && !n.isRest && n.duration !== 'rest' && n.midi !== null).length;

                    if (playedNotes >= totalPlayableNotes) {
                        // All notes played! Complete the exercise
                        setTimeout(() => {
                            this.handleExerciseComplete();
                        }, 500); // Small delay for final note to sound
                    }
                    break;
                }
            }

            if (!matchFound && chordGroups.length > 0) {
                this.handleIncorrectNote(playedNotes, chordGroups[0][0]);
                // Set wrong feedback for validation band color
                this._scrollTimingFeedback = 'wrong'; // Red
                clearTimeout(this._scrollFeedbackTimer);
                this._scrollFeedbackTimer = setTimeout(() => {
                    this._scrollTimingFeedback = null;
                }, 600);
                // PAUSE SCROLLING on wrong note
                this.scrollPaused = true;
                // Show visual indicator
                this.showScrollPausedIndicator();
            }
        }

        /**
         * Group notes by beat position (for chord detection)
         * @param {Array} notes - Array of note objects
         * @returns {Array<Array>} Array of note groups (each group = 1 chord or 1 note)
         */
        groupNotesByBeat(notes) {
            const groups = [];
            const processed = new Set();

            for (let i = 0; i < notes.length; i++) {
                if (processed.has(i)) continue;

                const note = notes[i];
                const group = [note];
                processed.add(i);

                // Find all notes at the same beat position
                for (let j = i + 1; j < notes.length; j++) {
                    if (processed.has(j)) continue;

                    const otherNote = notes[j];
                    if (otherNote.measure === note.measure && snapBeat(otherNote.beat) === snapBeat(note.beat)) {
                        group.push(otherNote);
                        processed.add(j);
                    }
                }

                groups.push(group);
            }

            return groups;
        }

        /**
         * Show visual indicator that scroll is paused
         */
        showScrollPausedIndicator() {
            // Flash the playhead red or show warning message
            if (this.renderer && this.renderer.ctx) {
                // Add temporary visual feedback
                const canvasWidth = this.canvas.width / (window.devicePixelRatio || 1);
                const x = canvasWidth / 3;

                this.renderer.ctx.save();
                this.renderer.ctx.fillStyle = 'rgba(244, 67, 54, 0.3)';
                this.renderer.ctx.fillRect(x - 20, 0, 40, this.canvas.height);
                this.renderer.ctx.restore();
            }
        }
        
        /**
         * Check if played note matches expected note (LEGACY - kept for compatibility)
         */
        isCorrectNote(playedNote, expectedNote) {
            // Simple MIDI number comparison
            // Can be extended to handle enharmonic equivalents
            return playedNote === expectedNote.midi;
        }

        /**
         * Check if played chord matches expected chord - IMPROVED (PRIO 1 + PRIO 2)
         * Compares arrays of MIDI notes intelligently with optional octave tolerance
         * @param {Array<number>} playedNotes - Array of played MIDI numbers
         * @param {Array<Object>} expectedNotes - Array of expected note objects
         * @param {boolean} octaveTolerance - Allow octave differences (default: false)
         * @returns {boolean} True if chords match
         */
        isCorrectChord(playedNotes, expectedNotes, octaveTolerance = null) {
            // Use instance setting if not explicitly provided
            const useTolerance = octaveTolerance !== null ? octaveTolerance : this.waitModeOctaveTolerance;

            // Extract MIDI numbers from expected notes
            const expectedMidi = expectedNotes.map(note => note.midi);

            // Check if lengths match
            if (playedNotes.length !== expectedMidi.length) {
                //     played: playedNotes.length,
                //     expected: expectedMidi.length
                // });
                return false;
            }

            if (useTolerance) {
                // With octave tolerance: compare note classes regardless of octave
                const playedClasses = playedNotes.map(m => m % 12).sort((a, b) => a - b);
                const expectedClasses = expectedMidi.map(m => m % 12).sort((a, b) => a - b);

                for (let i = 0; i < playedClasses.length; i++) {
                    if (playedClasses[i] !== expectedClasses[i]) {
                        //     playedClass: playedClasses[i],
                        //     expectedClass: expectedClasses[i],
                        //     position: i
                        // });
                        return false;
                    }
                }

                //     playedClasses,
                //     expectedClasses
                // });
                return true;

            } else {
                // Without tolerance: exact MIDI number match
                const playedSorted = [...playedNotes].sort((a, b) => a - b);
                const expectedSorted = [...expectedMidi].sort((a, b) => a - b);

                for (let i = 0; i < playedSorted.length; i++) {
                    if (playedSorted[i] !== expectedSorted[i]) {
                        //     playedNote: playedSorted[i],
                        //     expectedNote: expectedSorted[i],
                        //     position: i
                        // });
                        return false;
                    }
                }

                //     notes: playedSorted,
                //     isChord: playedSorted.length > 1
                // });
                return true;
            }
        }
        
        /**
         * Handle correct note
         */
        handleCorrectNote(note) {
            this.correctNotes++;
            this.streak++;
            this.score += this.calculateScore(note);
            
            if (this.streak > this.bestStreak) {
                this.bestStreak = this.streak;
            }
            
            // Visual feedback
            this.renderer.showCorrectFeedback(note);
            this.showFeedbackMessage('Correct!', 'success');

            // Spawn particle explosion for every correct note
            if (this.renderer) {
                const nx = this.renderer.getNoteX(note);
                const ny = this.renderer.getNoteY(note);
                this.renderer.spawnPerfectExplosion(nx, ny);
            }
            
            // Audio feedback
            this.audio.playSound('correct');
            
            // Update displays
            this.updateScoreDisplay();
            this.updateStreakDisplay();
            this.updateAccuracyDisplay();
            
            // Check for streak achievements
            this.checkStreakAchievements();
        }
        
        /**
         * Handle incorrect note
         */
        handleIncorrectNote(playedNote, expectedNote) {
            this.incorrectNotes++;
            this.streak = 0;

            // USER REQUEST: Show visual feedback of played note in Wait/Scroll modes
            if ((this.mode === 'wait' || this.mode === 'scroll') && Array.isArray(playedNote)) {
                // Add each played note as a ghost note + RED piano key highlight
                playedNote.forEach(midi => {
                    this.addGhostNote(midi, expectedNote);
                    if (this.piano) this.piano.highlightKeyWrong(midi);
                });
            } else if ((this.mode === 'wait' || this.mode === 'scroll') && typeof playedNote === 'number') {
                this.addGhostNote(playedNote, expectedNote);
                if (this.piano) this.piano.highlightKeyWrong(playedNote);
            }

            // Force re-mark exercise notes after wrong input (to refresh blue keys)
            this._lastExerciseIdx = -1;

            // Visual feedback
            if (this.userSettings.highlight_errors) {
                this.renderer.showIncorrectFeedback(expectedNote, playedNote);
                this.showFeedbackMessage('Try again', 'error');
            }

            // Audio feedback
            this.audio.playSound('incorrect');

            // Update displays
            this.updateStreakDisplay();
            this.updateAccuracyDisplay();
        }

        /**
         * USER REQUEST: Add ghost note visual feedback
         * Shows the played note with transparency at the expected note's horizontal position
         */
        addGhostNote(playedMidi, expectedNote) {
            // USER FIX: Get expected note's position - ALIGNED with expected note in BOTH modes
            // In scroll mode, use the visual playhead position (where notes pass through)
            let expectedX;
            if (this.mode === 'scroll') {
                // In scroll mode, ghost note appears at playhead position (fixed on screen)
                // The playhead is where notes are supposed to be played
                const firstNoteScreenX = this.renderer && this.renderer.calculatedNoteStartX ?
                    (this.renderer.calculatedNoteStartX + 20) : 200;
                expectedX = firstNoteScreenX + 7; // Center of playhead band
            } else {
                // In wait mode, use the expected note's actual position
                expectedX = this.renderer.getNoteX(expectedNote);
            }

            // Create ghost note object
            const ghostNote = {
                midi: playedMidi,
                x: expectedX,
                timestamp: Date.now(),
                vibration: 0 // For animation
            };

            // Add to ghost notes array
            this.ghostNotes.push(ghostNote);

        }

        /**
         * USER REQUEST: Remove ghost notes for a specific MIDI note when key is released
         */
        removeGhostNotesForMidi(midi) {
            // Trigger vibration animation before removing (USER REQUEST: vibration on release)
            this.ghostNotes.forEach(ghost => {
                if (ghost.midi === midi) {
                    ghost.removing = true;
                    ghost.removeTimestamp = Date.now();
                }
            });

            // Remove after animation (150ms - matches animation duration)
            setTimeout(() => {
                this.ghostNotes = this.ghostNotes.filter(ghost => ghost.midi !== midi);
            }, 150);
        }
        
        /**
         * Calculate score for correct note
         */
        calculateScore(note) {
            let baseScore = 10;
            
            // Bonus for difficulty
            const difficultyMultiplier = {
                'beginner': 1,
                'elementary': 1.5,
                'intermediate': 2,
                'advanced': 3,
                'expert': 5
            };
            
            baseScore *= difficultyMultiplier[this.userSettings.difficulty] || 1;
            
            // Bonus for streak
            if (this.streak > 10) {
                baseScore *= 1.5;
            } else if (this.streak > 5) {
                baseScore *= 1.25;
            }
            
            // Bonus for chord
            if (note.chord && note.chord.length > 1) {
                baseScore *= note.chord.length;
            }
            
            // Bonus for accidentals
            if (note.accidental) {
                baseScore *= 1.2;
            }
            
            return Math.round(baseScore);
        }
        
        /**
         * Handle exercise complete
         */
        handleExerciseComplete() {
            this.stop();
            
            // Show completion modal
            this.showCompletionModal();
            
            // Check for completion achievements
            this.checkCompletionAchievements();
            
            // Generate new exercise
            setTimeout(() => {
                this.generateInitialNotes();
                this.currentNoteIndex = 0;
            }, 2000);
        }
        
        /**
         * Show completion modal
         * REFAIT COMPLÈTEMENT - modal qui se ferme correctement
         */
        showCompletionModal() {
            const accuracy = this.getAccuracy();
            let message = '';
            let emoji = '';

            if (accuracy >= 95) {
                message = 'Perfect! Outstanding performance!';
                emoji = '🏆';
            } else if (accuracy >= 85) {
                message = 'Excellent! Great job!';
                emoji = '⭐';
            } else if (accuracy >= 75) {
                message = 'Good work! Keep practicing!';
                emoji = '👍';
            } else {
                message = 'Keep trying! Practice makes perfect!';
                emoji = '💪';
            }

            // Remove any existing completion modal
            $('.srt-completion-modal').remove();

            // Create and show modal with PROPER event handling
            const modal = $(`
                <div class="srt-completion-modal">
                    <div class="srt-completion-overlay"></div>
                    <div class="srt-completion-content">
                        <div class="srt-completion-emoji">${emoji}</div>
                        <h2 class="srt-completion-title">Exercise Complete!</h2>
                        <div class="srt-completion-stats">
                            <div class="srt-stat-item">
                                <span class="srt-stat-label">Score</span>
                                <span class="srt-stat-value">${this.score}</span>
                            </div>
                            <div class="srt-stat-item">
                                <span class="srt-stat-label">Accuracy</span>
                                <span class="srt-stat-value">${accuracy.toFixed(1)}%</span>
                            </div>
                            <div class="srt-stat-item">
                                <span class="srt-stat-label">Best Streak</span>
                                <span class="srt-stat-value">${this.bestStreak}</span>
                            </div>
                        </div>
                        <p class="srt-completion-message">${message}</p>
                        <button class="srt-btn srt-btn-primary srt-completion-continue" id="srtCompletionContinue">
                            Continue
                        </button>
                    </div>
                </div>
            `);

            // Add to the game container (NOT body) so it appears in fullscreen mode
            const $container = $('.srt-container');
            if ($container.length) {
                $container.append(modal);
            } else {
                $('body').append(modal);
            }

            // Show with animation (ensure flex layout for centering)
            modal.css('display', 'flex').hide().fadeIn(300);

            // CRITICAL: Add event listener for Continue button
            modal.find('#srtCompletionContinue').on('click', () => {
                modal.fadeOut(300, () => {
                    modal.remove();
                });
            });

            // Also close on overlay click
            modal.find('.srt-completion-overlay').on('click', () => {
                modal.fadeOut(300, () => {
                    modal.remove();
                });
            });

            // Save session stats
            this.saveSession();
        }
        
        /**
         * Get current accuracy percentage
         * Accuracy = correct notes / total expected notes attempted
         * A note attempted multiple times still counts as 1 attempted note
         */
        getAccuracy() {
            // Total attempted = correct (first try) + imprecise (correct after mistakes) + still-incorrect (missed)
            // But we use the simpler formula: correct / (correct + incorrect) where incorrect = wrong key presses
            const totalAttempts = this.correctNotes + this.incorrectNotes;
            if (totalAttempts === 0) {
                return 0;
            }
            return (this.correctNotes / totalAttempts) * 100;
        }
        
        /**
         * Update all displays (Top Bar + Stats Panel)
         */
        // PERFORMANCE FIX: Cache jQuery selectors once (avoids 19 DOM lookups every 15 frames)
        _initDisplayCache() {
            if (this._displayCached) return;
            this._displayCached = true;
            this._$els = {
                score: document.getElementById('srtScore'),
                sessionScore: document.getElementById('srtSessionScore'),
                streak: document.getElementById('srtStreak'),
                bestStreak: document.getElementById('srtBestStreak'),
                headerStreak: document.getElementById('srtHeaderStreak'),
                statStreak: document.getElementById('srtStatStreak'),
                statBestStreak: document.getElementById('srtStatBestStreak'),
                accuracy: document.getElementById('srtAccuracy'),
                sessionAccuracy: document.getElementById('srtSessionAccuracy'),
                headerAccuracy: document.getElementById('srtHeaderAccuracy'),
                statAccuracy: document.getElementById('srtStatAccuracy'),
                duration: document.getElementById('srtDuration'),
                statDuration: document.getElementById('srtStatDuration'),
                notesPlayed: document.getElementById('srtNotesPlayed'),
                statNotesPlayed: document.getElementById('srtStatNotesPlayed'),
                correctNotes: document.getElementById('srtCorrectNotes'),
                headerHits: document.getElementById('srtHeaderHits'),
                statCorrect: document.getElementById('srtStatCorrect'),
                incorrectNotes: document.getElementById('srtIncorrectNotes'),
                headerMisses: document.getElementById('srtHeaderMisses'),
                statIncorrect: document.getElementById('srtStatIncorrect')
            };
        }

        // Helper: set text on a cached DOM element (no jQuery overhead)
        _setText(el, text) {
            if (el) el.textContent = text;
        }

        updateAllDisplays() {
            this._initDisplayCache();
            const e = this._$els;

            // Score
            this._setText(e.score, this.score);
            this._setText(e.sessionScore, this.score);

            // Streak
            this._setText(e.streak, this.streak);
            this._setText(e.bestStreak, this.bestStreak);
            this._setText(e.headerStreak, this.streak);
            this._setText(e.statStreak, this.streak);
            this._setText(e.statBestStreak, this.bestStreak);

            // Accuracy
            const accuracy = this.getAccuracy();
            const displayAccuracy = accuracy.toFixed(1) + '%';
            this._setText(e.accuracy, displayAccuracy);
            this._setText(e.sessionAccuracy, displayAccuracy);
            this._setText(e.headerAccuracy, displayAccuracy);
            this._setText(e.statAccuracy, displayAccuracy);

            // Duration
            const minutes = Math.floor(this.sessionDuration / 60);
            const seconds = Math.floor(this.sessionDuration % 60);
            const display = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            this._setText(e.duration, display);
            this._setText(e.statDuration, display);

            // Notes played
            const totalNotes = this.correctNotes + this.incorrectNotes;
            this._setText(e.notesPlayed, totalNotes);
            this._setText(e.statNotesPlayed, totalNotes);

            // Correct
            this._setText(e.correctNotes, this.correctNotes);
            this._setText(e.headerHits, this.correctNotes);
            this._setText(e.statCorrect, this.correctNotes);

            // Incorrect
            this._setText(e.incorrectNotes, this.incorrectNotes);
            this._setText(e.headerMisses, this.incorrectNotes);
            this._setText(e.statIncorrect, this.incorrectNotes);
        }

        // Keep individual methods as thin wrappers for direct calls
        updateScoreDisplay() { this._initDisplayCache(); const e = this._$els; this._setText(e.score, this.score); this._setText(e.sessionScore, this.score); }
        updateStreakDisplay() { this._initDisplayCache(); const e = this._$els; this._setText(e.streak, this.streak); this._setText(e.bestStreak, this.bestStreak); this._setText(e.headerStreak, this.streak); this._setText(e.statStreak, this.streak); this._setText(e.statBestStreak, this.bestStreak); }
        updateAccuracyDisplay() { this._initDisplayCache(); const e = this._$els; const d = this.getAccuracy().toFixed(1) + '%'; this._setText(e.accuracy, d); this._setText(e.sessionAccuracy, d); this._setText(e.headerAccuracy, d); this._setText(e.statAccuracy, d); }
        updateDurationDisplay() { this._initDisplayCache(); const e = this._$els; const m = Math.floor(this.sessionDuration / 60); const s = Math.floor(this.sessionDuration % 60); const d = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`; this._setText(e.duration, d); this._setText(e.statDuration, d); }
        updateNotesPlayedDisplay() { this._initDisplayCache(); const e = this._$els; const t = this.correctNotes + this.incorrectNotes; this._setText(e.notesPlayed, t); this._setText(e.statNotesPlayed, t); }
        updateCorrectNotesDisplay() { this._initDisplayCache(); const e = this._$els; this._setText(e.correctNotes, this.correctNotes); this._setText(e.headerHits, this.correctNotes); this._setText(e.statCorrect, this.correctNotes); }
        updateIncorrectNotesDisplay() { this._initDisplayCache(); const e = this._$els; this._setText(e.incorrectNotes, this.incorrectNotes); this._setText(e.headerMisses, this.incorrectNotes); this._setText(e.statIncorrect, this.incorrectNotes); }

        /**
         * Load and display overall stats from server
         */
        loadOverallStats() {

            // If not logged in or AJAX not ready, use config defaults
            if (!this.config.isLoggedIn || !this.config.ajaxUrl || !this.config.nonce) {
                this.displayOverallStats(this.config.userStats || {});
                this.displayAchievements(this.config.userStats?.achievements || []);
                return;
            }

            // Load from server via AJAX
            $.ajax({
                url: this.config.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'srt_get_stats',
                    nonce: this.config.nonce
                },
                success: (response) => {
                    if (response.success) {
                        this.displayOverallStats(response.data);
                        this.displayAchievements(response.data.achievements || []);
                    } else {
                        console.warn('SRT: Failed to load stats, using defaults');
                        this.displayOverallStats(this.config.userStats || {});
                        this.displayAchievements(this.config.userStats?.achievements || []);
                    }
                },
                error: () => {
                    // Silently fall back to defaults — don't spam console
                    this._ajaxEnabled = false;
                    this.displayOverallStats(this.config.userStats || {});
                    this.displayAchievements(this.config.userStats?.achievements || []);
                }
            });
        }

        /**
         * Display overall stats in panel
         */
        displayOverallStats(stats) {
            // Default values if stats is empty
            const totalSessions = stats.total_sessions || 0;
            const avgAccuracy = stats.average_accuracy || 0;
            const level = stats.level || 1;
            const xp = stats.experience_points || 0;

            // Practice time: use server value if logged in, localStorage otherwise
            let totalTime = stats.total_practice_time || 0;

            // Sanitize: if value is absurdly large (> 10 years in seconds), it's corrupted
            if (totalTime > 315360000) {
                totalTime = 0;
            }

            // Add locally tracked time for non-logged-in users
            if (!this.config.isLoggedIn) {
                try {
                    totalTime = parseFloat(localStorage.getItem('srt_total_practice_seconds')) || 0;
                } catch(e) { totalTime = 0; }
            }

            // Format total time (seconds to hours + minutes)
            let timeDisplay;
            if (totalTime <= 0) {
                timeDisplay = 'N/A';
            } else {
                const hours = Math.floor(totalTime / 3600);
                const minutes = Math.floor((totalTime % 3600) / 60);
                timeDisplay = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
            }

            // Update panel IDs
            $('#srtStatTotalSessions').text(totalSessions);
            $('#srtStatTotalTime').text(timeDisplay);
            $('#srtStatAvgAccuracy').text(avgAccuracy.toFixed(1) + '%');
            $('#srtStatLevel').text(level);
            $('#srtStatXP').text(xp);

            // Update progress chart with session history
            this.updateProgressChart(stats.session_history || []);

        }

        /**
         * Update progress chart with weekly practice hours
         */
        updateProgressChart(sessionHistory) {
            const canvas = document.getElementById('srtProgressChart');
            if (!canvas) {
                console.warn('⚠️ Progress chart canvas not found');
                return;
            }

            // Check if Chart.js is loaded
            if (typeof Chart === 'undefined') {
                console.warn('⚠️ Chart.js not loaded, skipping chart update');
                return;
            }

            // Calculate daily practice time for last 7 days
            const today = new Date();
            const dailyData = {};
            const labels = [];

            // Initialize last 7 days with 0 hours
            for (let i = 6; i >= 0; i--) {
                const date = new Date(today);
                date.setDate(date.getDate() - i);
                const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
                const dayName = date.toLocaleDateString('en-US', { weekday: 'short' }); // Mon, Tue, etc.
                dailyData[dateKey] = 0;
                labels.push(dayName);
            }

            // Sum up practice time for each day from session history
            sessionHistory.forEach(session => {
                if (!session.date || !session.duration) return;

                const sessionDate = session.date.split(' ')[0]; // Extract date part (YYYY-MM-DD)
                if (dailyData.hasOwnProperty(sessionDate)) {
                    dailyData[sessionDate] += session.duration;
                }
            });

            // Convert seconds to hours
            const data = Object.values(dailyData).map(seconds => (seconds / 3600).toFixed(2));

            // Create or update chart
            // ✅ FIX: Check if chart exists AND has valid data object
            if (window.srtProgressChart && window.srtProgressChart.data && window.srtProgressChart.data.datasets) {
                // Update existing chart
                window.srtProgressChart.data.labels = labels;
                window.srtProgressChart.data.datasets[0].data = data;
                window.srtProgressChart.update();
            } else {
                // Create new chart
                const ctx = canvas.getContext('2d');
                window.srtProgressChart = new Chart(ctx, {
                    type: 'bar', // Can be 'bar' or 'line'
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Practice Hours',
                            data: data,
                            backgroundColor: 'rgba(197, 157, 58, 0.6)', // Gold with transparency
                            borderColor: '#C59D3A', // Gold border
                            borderWidth: 2,
                            borderRadius: 8,
                            hoverBackgroundColor: 'rgba(197, 157, 58, 0.8)'
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        aspectRatio: 2,
                        plugins: {
                            legend: {
                                display: false
                            },
                            tooltip: {
                                backgroundColor: '#0B0B0B',
                                titleColor: '#C59D3A',
                                bodyColor: '#FFFFFF',
                                borderColor: '#C59D3A',
                                borderWidth: 1,
                                callbacks: {
                                    label: function(context) {
                                        const hours = parseFloat(context.parsed.y);
                                        const minutes = Math.round((hours % 1) * 60);
                                        return `${Math.floor(hours)}h ${minutes}m`;
                                    }
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    color: '#FFFFFF',
                                    callback: function(value) {
                                        return value + 'h';
                                    }
                                },
                                grid: {
                                    color: 'rgba(197, 157, 58, 0.1)'
                                }
                            },
                            x: {
                                ticks: {
                                    color: '#FFFFFF'
                                },
                                grid: {
                                    color: 'rgba(197, 157, 58, 0.1)'
                                }
                            }
                        }
                    }
                });
            }

        }

        /**
         * Display achievements in panel
         */
        displayAchievements(unlockedAchievements = []) {
            const achievementsContainer = $('#srtAchievements');
            achievementsContainer.empty();

            // Get all achievements from config
            const allAchievements = this.config.achievements || {};

            if (Object.keys(allAchievements).length === 0) {
                achievementsContainer.html('<p class="srt-no-achievements">No achievements configured.</p>');
                return;
            }

            // Convert unlocked to array if needed
            const unlocked = Array.isArray(unlockedAchievements) ? unlockedAchievements : [];

            // Display each achievement
            let achievementsHTML = '<div class="srt-achievements-grid">';

            for (const [id, achievement] of Object.entries(allAchievements)) {
                const isUnlocked = unlocked.includes(id);
                const lockedClass = isUnlocked ? '' : 'srt-achievement-locked';

                achievementsHTML += `
                    <div class="srt-achievement-item ${lockedClass}" data-achievement-id="${id}">
                        <div class="srt-achievement-icon">${achievement.icon || '🏆'}</div>
                        <div class="srt-achievement-name">${achievement.name}</div>
                        <div class="srt-achievement-desc">${achievement.description || ''}</div>
                        <div class="srt-achievement-xp">+${achievement.points || 0} XP</div>
                    </div>
                `;
            }

            achievementsHTML += '</div>';
            achievementsContainer.html(achievementsHTML);

        }

        /**
         * Show feedback message
         */
        showFeedbackMessage(message, type) {
            const feedbackLayer = $('#srtFeedbackLayer');
            const feedback = $(`<div class="srt-feedback srt-feedback-${type}">${message}</div>`);
            
            feedbackLayer.append(feedback);
            
            setTimeout(() => {
                feedback.fadeOut(300, () => feedback.remove());
            }, 1000);
        }
        
        /**
         * Check achievements
         */
        checkAchievements() {
            // First note achievement
            if (this.correctNotes === 1 && !this.hasAchievement('first_note')) {
                this.unlockAchievement('first_note');
            }
            
            // Perfect 10 achievement
            if (this.streak === 10 && !this.hasAchievement('perfect_10')) {
                this.unlockAchievement('perfect_10');
            }
            
            // Speed demon achievement
            if (this.tempo >= 150 && this.correctNotes >= 20 && !this.hasAchievement('speed_demon')) {
                this.unlockAchievement('speed_demon');
            }
            
            // Accuracy master achievement
            if (this.getAccuracy() >= 95 && this.correctNotes >= 50 && !this.hasAchievement('accuracy_master')) {
                this.unlockAchievement('accuracy_master');
            }
        }
        
        /**
         * Check if user has achievement
         */
        hasAchievement(achievementId) {
            return this.achievements.includes(achievementId);
        }
        
        /**
         * Unlock achievement
         */
        unlockAchievement(achievementId) {
            if (this.hasAchievement(achievementId)) {
                return;
            }

            this.achievements.push(achievementId);

            // Get achievement details
            const achievement = this.config.achievements[achievementId];
            if (!achievement) {
                return;
            }

            // Show achievement notification (toast - not modal)
            this.showAchievementToast(achievement);

            // CRITICAL: Update achievements display in stats panel
            this.displayAchievements(this.achievements);

            // Save to server if logged in
            if (this.config.isLoggedIn) {
                this.saveAchievement(achievementId);
            }

            // Play achievement sound
            this.audio.playSound('achievement');
        }

        /**
         * Show achievement toast notification (replaces modal)
         * Non-blocking notification on the side of screen
         */
        showAchievementToast(achievement) {
            // Create toast element
            const toast = $(`
                <div class="srt-achievement-toast">
                    <div class="srt-toast-icon">${achievement.icon}</div>
                    <div class="srt-toast-content">
                        <div class="srt-toast-title">Achievement Unlocked!</div>
                        <div class="srt-toast-name">${achievement.name}</div>
                        <div class="srt-toast-xp">+${achievement.xp} XP</div>
                    </div>
                </div>
            `);

            // Add to game container for fullscreen support
            const $toastContainer = $('.srt-container');
            if ($toastContainer.length) {
                $toastContainer.append(toast);
            } else {
                $('body').append(toast);
            }

            // Animate in
            setTimeout(() => {
                toast.addClass('srt-toast-show');
            }, 100);

            // Auto-remove after 4 seconds
            setTimeout(() => {
                toast.removeClass('srt-toast-show');
                setTimeout(() => {
                    toast.remove();
                }, 300);
            }, 4000);
        }
        
        /**
         * Save achievement to server
         */
        saveAchievement(achievementId) {
            if (!this._ajaxEnabled) return;
            $.ajax({
                url: this.config.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'srt_unlock_achievement',
                    nonce: this.config.nonce,
                    achievement_id: achievementId
                },
                error: () => { this._ajaxEnabled = false; }
            });
        }
        
        /**
         * Save session data
         */
        saveSession() {
            // Sanity check: cap session duration to 4 hours max (14400 seconds)
            // Prevents corrupt values when sessionStartTime is 0/undefined
            const MAX_SESSION_DURATION = 14400;
            let safeDuration = this.sessionDuration;
            if (!this.sessionStartTime || safeDuration <= 0 || safeDuration > MAX_SESSION_DURATION) {
                safeDuration = Math.min(Math.max(safeDuration, 0), MAX_SESSION_DURATION);
                if (!this.sessionStartTime) safeDuration = 0;
            }

            // Always track practice time locally (works for all users)
            if (safeDuration > 0) {
                try {
                    const prev = parseFloat(localStorage.getItem('srt_total_practice_seconds')) || 0;
                    localStorage.setItem('srt_total_practice_seconds', (prev + safeDuration).toString());
                } catch(e) { /* localStorage unavailable */ }
            }

            if (!this._ajaxEnabled) return;

            const sessionData = {
                duration: safeDuration,
                total_notes: this.correctNotes + this.incorrectNotes,
                correct_notes: this.correctNotes,
                incorrect_notes: this.incorrectNotes,
                accuracy: this.getAccuracy(),
                high_score: this.score,
                best_streak: this.bestStreak,
                difficulty: this.userSettings.difficulty,
                mode: this.mode
            };


            $.ajax({
                url: this.config.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'srt_save_session',
                    nonce: this.config.nonce,
                    session_data: JSON.stringify(sessionData)
                },
                error: () => { this._ajaxEnabled = false; }
            });
        }

        /**
         * Update statistics
         */
        updateStatistics() {
            // Update session stats
            this.updateAllDisplays();
        }
        
        /**
         * Log event for analytics
         */
        logEvent(eventName, eventData = {}) {
            if (typeof gtag !== 'undefined') {
                gtag('event', eventName, {
                    event_category: 'sight_reading',
                    ...eventData
                });
            }
        }
        
        // Settings methods
        
        setMode(mode, fromFileLoad = false) {
            this.mode = mode;
            $('.srt-mode-btn').removeClass('active');
            $(`.srt-mode-btn[data-mode="${mode}"]`).addClass('active');

            // Hide "Show Counting" checkbox in Free mode
            if (mode === 'free') {
                $('#srtShowCounting').parent('.srt-checkbox-label-bottom').hide();
            } else {
                // Show in Wait and Scroll modes
                $('#srtShowCounting').parent('.srt-checkbox-label-bottom').show();
            }

            // Grey out unavailable options based on mode
            if (mode === 'free') {
                // In free mode: no sheet music, so disable all generation settings
                const disableEls = [
                    '#srtDifficultySelect', '.srt-generator-btn',
                    '#srtNotesSlider', '#srtHandsSlider',
                    '#srtRangeMin', '#srtRangeMax',
                    '#srtListenBtn', '#srtPlayBtn',
                    '.srt-key-btn', '#srtScaleType', '#srtScalePattern'
                ];
                disableEls.forEach(sel => $(sel).prop('disabled', true).css('opacity', '0.4'));
                // Show free mode save/export buttons
                $('#srtFreeModeActions').show();
            } else {
                // Re-enable all settings
                const enableEls = [
                    '#srtDifficultySelect', '.srt-generator-btn',
                    '#srtNotesSlider', '#srtHandsSlider',
                    '#srtRangeMin', '#srtRangeMax',
                    '#srtListenBtn', '#srtPlayBtn',
                    '.srt-key-btn', '#srtScaleType', '#srtScalePattern'
                ];
                enableEls.forEach(sel => $(sel).prop('disabled', false).css('opacity', '1'));
                // Hide free mode save/export buttons
                $('#srtFreeModeActions').hide();
            }

            // FIXED: Stop current session when changing modes
            if (this.isPlaying) {
                this.stop();
            }

            // Stop listen mode if active
            if (this.isListening) {
                this.stopListening();
            }

            // Only do full reset when user clicks a mode button (not from file loading)
            if (!fromFileLoad) {
                // Clear ALL state from loaded songs/files
                this.notes = [];
                this.midiFileLoaded = false;
                this._enableGeneratorSettings();
                this._xmlDynamics = [];
                this._xmlWedges = [];
                this._xmlMeasures = [];
                this.ghostNotes = [];
                this.currentNoteIndex = 0;
                this.score = 0;
                this.streak = 0;
                this.correctNotes = 0;
                this.incorrectNotes = 0;

                // Reset measure width to default
                if (this.renderer) {
                    this.renderer.measureWidth = 250;
                }
            }

            // Reset scroll offsets
            this.scrollOffset = 0;
            this.waitModeScrollOffset = 0;
            this.playheadPosition = 0;

            // Clear renderer feedback
            if (this.renderer) {
                this.renderer.clearFeedback();
            }

            // Handle mode-specific setup
            if (mode === 'free') {
                this.freeMode_playedNotes = [];
                this.isPlaying = false;
                $('#srtPlayBtn').show();
                $('#srtPauseBtn').hide();
                $('#srtStopBtn').show();
                $('#srtResetBtn').show();
                this.requestRender();
            } else {
                $('#srtPlayBtn').show();
                $('#srtPauseBtn').hide();
                $('#srtStopBtn').show();
                $('#srtResetBtn').show();
                // Generate fresh notes only if NOT from file load (file already has notes)
                if (!fromFileLoad) {
                    this.generateInitialNotes();
                }
            }
        }
        
        /**
         * FREE MODE: Save played notes as a composition to localStorage
         */
        _saveFreeModeComposition() {
            if (!this.freeMode_playedNotes || this.freeMode_playedNotes.length === 0) {
                return;
            }
            const composition = {
                notes: this.freeMode_playedNotes.map(n => ({
                    midi: n.midi, duration: n.duration || 'quarter',
                    time: n.time, velocity: n.velocity || 90
                })),
                tempo: this.tempo,
                savedAt: new Date().toISOString()
            };
            try {
                localStorage.setItem('srt_saved_composition', JSON.stringify(composition));
                $('#srtReplayComposition').show();
            } catch (e) { console.warn('Save failed:', e); }
        }

        /**
         * FREE MODE: Export played notes as MusicXML file
         */
        _exportFreeModeXML() {
            if (!this.freeMode_playedNotes || this.freeMode_playedNotes.length === 0) return;

            const notes = this.freeMode_playedNotes;
            const tempo = this.tempo;
            const beatDur = 60000 / tempo; // ms per beat

            // Convert free-played notes to measure/beat format
            const firstTime = notes[0].time || 0;
            const xmlNotes = notes.map(n => {
                const t = (n.time || 0) - firstTime;
                const beat = t / beatDur;
                const measure = Math.floor(beat / 4);
                const beatInMeasure = beat % 4;
                return { midi: n.midi, measure, beat: beatInMeasure, duration: n.duration || 'quarter' };
            });

            // Build MusicXML
            const noteNames = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
            const alters =    [0,    1,   0,   1,   0,   0,   1,   0,   1,   0,   1,   0];
            const durMap = { 'whole': 4, 'half': 2, 'quarter': 1, 'eighth': 0.5, 'sixteenth': 0.25 };
            const typeMap = { 'whole': 'whole', 'half': 'half', 'quarter': 'quarter', 'eighth': 'eighth', 'sixteenth': '16th' };

            let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
            xml += '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n';
            xml += '<score-partwise version="4.0">\n';
            xml += '  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>\n';
            xml += '  <part id="P1">\n';

            const maxMeasure = xmlNotes.length > 0 ? Math.max(...xmlNotes.map(n => n.measure)) : 0;
            for (let m = 0; m <= maxMeasure; m++) {
                xml += `    <measure number="${m + 1}">\n`;
                if (m === 0) {
                    xml += '      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>';
                    xml += '<clef><sign>G</sign><line>2</line></clef></attributes>\n';
                    xml += `      <direction><sound tempo="${tempo}"/></direction>\n`;
                }
                const measNotes = xmlNotes.filter(n => n.measure === m).sort((a, b) => snapBeat(a.beat) - snapBeat(b.beat));
                measNotes.forEach(n => {
                    const pc = n.midi % 12;
                    const oct = Math.floor(n.midi / 12) - 1;
                    const dur = durMap[n.duration] || 1;
                    const type = typeMap[n.duration] || 'quarter';
                    xml += '      <note>\n';
                    xml += `        <pitch><step>${noteNames[pc]}</step>`;
                    if (alters[pc]) xml += `<alter>${alters[pc]}</alter>`;
                    xml += `<octave>${oct}</octave></pitch>\n`;
                    xml += `        <duration>${dur}</duration><type>${type}</type>\n`;
                    xml += '      </note>\n';
                });
                if (measNotes.length === 0) {
                    xml += '      <note><rest/><duration>4</duration><type>whole</type></note>\n';
                }
                xml += '    </measure>\n';
            }
            xml += '  </part>\n</score-partwise>';

            // Download
            const blob = new Blob([xml], { type: 'application/xml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'composition.musicxml';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        /**
         * FREE MODE: Replay a saved composition
         */
        _replayFreeModeComposition() {
            try {
                const data = JSON.parse(localStorage.getItem('srt_saved_composition'));
                if (!data || !data.notes || data.notes.length === 0) return;

                // Switch to scroll mode with the saved notes
                this.setMode('scroll');
                this.tempo = data.tempo || 60;
                $('#srtTempoSlider').val(this.tempo);
                $('#srtTempoValue').text(this.tempo);

                // Convert saved notes to standard note format
                const beatDur = 60000 / this.tempo;
                const firstTime = data.notes[0].time || 0;
                this.notes = data.notes.map(n => {
                    const t = (n.time || 0) - firstTime;
                    const beat = t / beatDur;
                    const measure = Math.floor(beat / 4);
                    const beatInMeasure = beat % 4;
                    return {
                        midi: n.midi, duration: n.duration || 'quarter',
                        measure, beat: beatInMeasure,
                        staff: n.midi >= 60 ? 'treble' : 'bass'
                    };
                });

                this.midiFileLoaded = true;
                this.calculateOptimalMeasureWidth();
                if (this.renderer) this.render();
            } catch (e) { console.warn('Replay failed:', e); }
        }

        setTempo(tempo) {
            this.tempo = tempo;
            $('#srtTempoValue').text(tempo);
            this.scrollSpeed = tempo / 100; // Adjust scroll speed based on tempo

            // USER FIX: Update metronome tempo if it's running
            if (this.metronomeEnabled) {
                this.audio.startMetronomeIndependent(tempo);
            }
        }
        
        toggleMetronome() {
            this.metronomeEnabled = !this.metronomeEnabled;
            $('#srtMetronomeBtn').toggleClass('active', this.metronomeEnabled);

            // USER FIX: Metronome works independently of play button
            // When enabled, start playing immediately regardless of game mode
            if (this.metronomeEnabled) {
                // Start metronome with current tempo
                this.audio.startMetronomeIndependent(this.tempo);
                this.lastMetronomeBeat = Date.now();
                this.metronomeBeat = 0;
            } else {
                // Stop metronome
                this.audio.stopMetronome();
            }
        }
        
        toggleSettingsPanel() {
            const $panel = $('#srtSettingsPanel');
            const isOpen = $panel.hasClass('open');

            if (isOpen) {
                $panel.removeClass('open');
            } else {
                // Close stats panel if open
                this.closeStatsPanel();
                $panel.addClass('open');
            }
        }

        closeSettingsPanel() {
            $('#srtSettingsPanel').removeClass('open');
        }

        toggleStatsPanel() {
            const $panel = $('#srtStatsPanel');
            const isOpen = $panel.hasClass('open');

            if (isOpen) {
                $panel.removeClass('open');
            } else {
                // Close settings panel if open
                this.closeSettingsPanel();
                $panel.addClass('open');
            }
        }

        closeStatsPanel() {
            $('#srtStatsPanel').removeClass('open');
        }

        /**
         * Reset all user statistics
         */
        resetAllStats() {
            // Show custom confirmation modal instead of alert()
            $('#srtResetModal').css('display', 'flex').hide().fadeIn(300);
        }

        /**
         * Confirm and execute reset stats
         */
        confirmResetStats() {

            // Hide modal
            $('#srtResetModal').fadeOut(300);

            if (!this._ajaxEnabled) return;

            $.ajax({
                url: this.config.ajaxUrl || srtData.ajaxurl,
                type: 'POST',
                data: {
                    action: 'srt_reset_stats',
                    nonce: this.config.nonce || srtData.nonce
                },
                success: (response) => {
                    if (response.success) {

                        // Reset current session stats
                        this.score = 0;
                        this.streak = 0;
                        this.correctNotes = 0;
                        this.incorrectNotes = 0;
                        this.sessionDuration = 0;
                        this.sessionStartTime = null;

                        // Update current session display (top bar)
                        $('#srtScore').text('0');
                        $('#srtStreak').text('0');
                        $('#srtCorrectNotes').text('0');
                        $('#srtIncorrectNotes').text('0');

                        // Update session stats (if they exist in panel)
                        $('#srtTotalSessions').text('0');
                        $('#srtTotalNotes').text('0');
                        $('#srtOverallAccuracy').text('0%');
                        $('#srtBestStreak').text('0');
                        $('#srtTotalPracticeTime').text('0h 0m');
                        $('#srtCurrentLevel').text('1');
                        $('#srtCurrentXP').text('0');
                        $('#srtNextLevelXP').text('1000');

                        // CRITICAL FIX: Reload stats from server to ensure persistence
                        // This prevents stats from reappearing after page events
                        this.loadOverallStats();

                        // Clear achievements display
                        $('#srtAchievements').empty().html('<p class="srt-no-achievements">No achievements unlocked yet.</p>');

                        // Clear progress chart if it exists
                        if (window.srtProgressChart) {
                            window.srtProgressChart.data.labels = [];
                            window.srtProgressChart.data.datasets[0].data = [];
                            window.srtProgressChart.update();
                        }

                        // Show success message
                        this.showMessage('All statistics have been successfully reset.', 'success');
                    } else {
                        console.error('❌ Failed to reset statistics:', response.data);
                        this.showMessage('Failed to reset statistics. Please try again.', 'error');
                    }
                },
                error: (xhr, status, error) => {
                    console.error('❌ AJAX error:', error);
                    this.showMessage('An error occurred while resetting statistics. Please try again.', 'error');
                }
            });
        }

        toggleFullscreen() {
            const container = document.querySelector('.srt-container');

            if (!document.fullscreenElement) {
                // Enter fullscreen
                if (container.requestFullscreen) {
                    container.requestFullscreen();
                } else if (container.webkitRequestFullscreen) { // Safari
                    container.webkitRequestFullscreen();
                } else if (container.msRequestFullscreen) { // IE11
                    container.msRequestFullscreen();
                }
            } else {
                // Exit fullscreen
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                } else if (document.webkitExitFullscreen) { // Safari
                    document.webkitExitFullscreen();
                } else if (document.msExitFullscreen) { // IE11
                    document.msExitFullscreen();
                }
            }
        }

        /**
         * Handle fullscreen change - CRITICAL FIX
         * Shift app UP by 80px and hide black band when entering fullscreen
         */
        handleFullscreenChange() {
            const container = document.querySelector('.srt-container');
            const header = document.querySelector('.srt-header');

            const isFullscreen = !!(
                document.fullscreenElement ||
                document.webkitFullscreenElement ||
                document.mozFullScreenElement ||
                document.msFullscreenElement
            );

            if (isFullscreen) {
                if (container) {
                    container.classList.add('srt-fullscreen-mode');
                }
                if (header) {
                    header.style.padding = '5px 20px';
                }
            } else {
                if (container) {
                    container.classList.remove('srt-fullscreen-mode');
                }
                if (header) {
                    header.style.padding = '';
                }
            }

            // Resize canvas and recalculate staff after fullscreen transition
            setTimeout(() => {
                this.resizeCanvas();
                if (this.renderer) {
                    this.renderer.staffY = null; // Force recalculation
                    this.renderer.resize();
                }
                this.requestRender();
            }, 200);
        }

        setDifficulty(difficulty) {
            // Custom is set automatically — user cannot select it
            if (difficulty === 'custom') return;

            this.userSettings.difficulty = difficulty;

            // Hide custom option when a standard difficulty is selected
            $('#srtDifficultySelect option[value="custom"]').prop('disabled', true).hide();
            $('#srtDifficultySelect').val(difficulty);

            // Difficulty controls MUSICAL COMPLEXITY + staff/hands configuration
            // Beginner = 1 staff (treble only), Elementary+ = 2 staves (grand staff)

            if (difficulty === 'beginner') {
                // BEGINNER: 2 staves (grand staff), 2 hands, 1 note, key of C
                // Sometimes random between 1 and 2 staves, but first load always 2
                const useGrandStaff = this._beginnerFirstLoad !== false ? true : Math.random() < 0.6;
                this._beginnerFirstLoad = false;
                this.userSettings.hands_count = useGrandStaff ? 2 : 1;
                this.userSettings.notes_count = 1;
                this.userSettings.key_signature = 'C';
                this.staffSettings.keySignature = 'C';
                $('#srtHandsSlider').val(this.userSettings.hands_count);
                $('#srtHandsValue').text(this.userSettings.hands_count);
                $('#srtNotesSlider').val(1);
                $('#srtNotesValue').text(1);
                // Grand staff or treble only
                this.setClef(useGrandStaff ? 'grand' : 'treble');
                // Update key UI
                $('.srt-key-btn').removeClass('active');
                $(`.srt-key-btn[data-key="C"]`).addClass('active');
                if (this.renderer) this.renderer.setKeySignature('C');
            } else if (difficulty === 'elementary') {
                // ELEMENTARY: 2 staves (grand staff), 2 hands, 1 note, easy keys
                this.userSettings.hands_count = 2;
                this.userSettings.notes_count = 1;
                $('#srtHandsSlider').val(2);
                $('#srtHandsValue').text(2);
                $('#srtNotesSlider').val(1);
                $('#srtNotesValue').text(1);
                // Grand staff for elementary
                this.setClef('grand');
                // Only C and G for elementary (easiest keys)
                const easyKeys = ['C', 'C', 'G'];
                const key = easyKeys[Math.floor(Math.random() * easyKeys.length)];
                this.userSettings.key_signature = key;
                this.staffSettings.keySignature = key;
                $('.srt-key-btn').removeClass('active');
                $(`.srt-key-btn[data-key="${key}"]`).addClass('active');
                if (this.renderer) this.renderer.setKeySignature(key);
            } else if (difficulty === 'intermediate') {
                // INTERMEDIATE: 2 staves, 2 hands, up to 2 notes per chord
                this.userSettings.hands_count = 2;
                this.userSettings.notes_count = 2;
                $('#srtHandsSlider').val(2);
                $('#srtHandsValue').text(2);
                $('#srtNotesSlider').val(2);
                $('#srtNotesValue').text(2);
                this.setClef('grand');
                this.randomizeDifficultySettings(difficulty);
            } else if (difficulty === 'advanced') {
                // ADVANCED: 2 staves, 2 hands, 4 notes per chord
                this.userSettings.hands_count = 2;
                this.userSettings.notes_count = 4;
                $('#srtHandsSlider').val(2);
                $('#srtHandsValue').text(2);
                $('#srtNotesSlider').val(4);
                $('#srtNotesValue').text(4);
                this.setClef('grand');
                this.randomizeDifficultySettings(difficulty);
            } else if (difficulty === 'expert') {
                // EXPERT: 2 staves, 2 hands, 5 notes per chord (max density)
                this.userSettings.hands_count = 2;
                this.userSettings.notes_count = 5;
                $('#srtHandsSlider').val(2);
                $('#srtHandsValue').text(2);
                $('#srtNotesSlider').val(5);
                $('#srtNotesValue').text(5);
                this.setClef('grand');
                this.randomizeDifficultySettings(difficulty);
            }

            // Set BPM per difficulty level
            const difficultyBPM = {
                'beginner': 60,
                'elementary': 80,
                'intermediate': 100,
                'advanced': 100,
                'expert': 100
            };
            const bpm = difficultyBPM[difficulty] || 80;
            this.setTempo(bpm);
            $('#srtTempoSlider').val(bpm);

            // Show/hide exercise mode based on difficulty (only for beginner/elementary/intermediate)
            const exerciseAllowed = ['beginner', 'elementary', 'intermediate'].includes(difficulty);
            if (exerciseAllowed) {
                $('#srtExerciseModeGroup').show();
            } else {
                $('#srtExerciseModeGroup').hide();
                this.exerciseMode = false;
                $('#srtExerciseMode').prop('checked', false);
            }

            this.saveSettings();

            // USER FIX: Difficulty change ALWAYS resets, even with loaded songs
            // Clear any loaded MIDI/MusicXML file so fresh notes are generated
            this.midiFileLoaded = false;

            // Stop and reset current session before generating new notes
            if (this.isPlaying) {
                this.stop();
            }

            // Reset scroll position for clean start
            this.initialPlayheadPosition = 0;
            this.playheadPosition = 0;
            this.waitModeScrollOffset = 0;
            this.scrollOffset = 0;

            this.generateInitialNotes();
        }

        /**
         * Mark difficulty as "Custom" when user manually changes generation settings
         * (notes per chord, hands, note range, or non-random generator type)
         * Key signature changes do NOT trigger custom (same difficulty, different key)
         */
        _markCustomDifficulty() {
            if (this.userSettings.difficulty === 'custom') return; // Already custom
            this.userSettings.difficulty = 'custom';
            // Show and select the hidden Custom option
            const $custom = $('#srtDifficultySelect option[value="custom"]');
            $custom.prop('disabled', false).show();
            $('#srtDifficultySelect').val('custom');
        }

        /**
         * Randomize settings based on difficulty level
         * Called for elementary+ difficulties to create variety
         */
        randomizeDifficultySettings(difficulty) {
            // ONLY randomize key signature - hands and notes are user-controlled via sliders
            const keyPools = {
                'elementary': ['C', 'G', 'F', 'D'],
                'intermediate': ['C', 'G', 'F', 'D', 'Bb', 'A', 'Eb'],
                'advanced': ['C', 'G', 'F', 'D', 'Bb', 'A', 'Eb', 'E', 'Ab', 'B'],
                'expert': ['C', 'G', 'F', 'D', 'Bb', 'A', 'Eb', 'E', 'Ab', 'B', 'Db', 'F#']
            };

            const keys = keyPools[difficulty] || keyPools['elementary'];
            const randomKey = keys[Math.floor(Math.random() * keys.length)];
            this.userSettings.key_signature = randomKey;
            this.staffSettings.keySignature = randomKey;

            // Update key UI
            $('.srt-key-btn').removeClass('active');
            $(`.srt-key-btn[data-key="${randomKey}"]`).addClass('active');
            if (this.renderer) {
                this.renderer.setKeySignature(randomKey);
            }

            //     key: randomKey,
            //     hands: randomHands,
            //     notes: randomNotes
            // });
        }
        
        setClef(clef) {
            this.staffSettings.clef = clef;
            $('.srt-btn-option[data-clef]').removeClass('active');
            $(`.srt-btn-option[data-clef="${clef}"]`).addClass('active');

            // Re-render staff
            if (this.renderer) {
                this.renderer.setClef(clef);
                this.requestRender(); // Trigger re-render to show new clef
            }
            this.saveSettings();
        }
        
        setGeneratorType(type) {
            // If settings were disabled (file/song loaded), re-enable them
            // when user actively clicks a generator button — they want to switch back
            if (this._settingsDisabled) {
                this.midiFileLoaded = false;
                this._enableGeneratorSettings();
            }

            this.userSettings.generator_type = type;
            $('.srt-generator-btn').removeClass('active');
            $(`.srt-generator-btn[data-generator="${type}"]`).addClass('active');

            // Show/hide song selector based on generator type
            if (type === 'song') {
                $('#srtSongSelectorGroup').slideDown(200);
            } else {
                $('#srtSongSelectorGroup').slideUp(200);
            }

            // Show/hide scale selector based on generator type
            if (type === 'scales') {
                $('#srtScaleSelectorGroup').slideDown(200);
            } else {
                $('#srtScaleSelectorGroup').slideUp(200);
            }

            // Only regenerate in Wait/Scroll mode (NOT in Free mode)
            if (this.mode !== 'free' && type !== 'song') {
                this.generateInitialNotes();
            }

            this.saveSettings();
        }

        /**
         * Disable generator-related settings when a file/song is loaded
         * Key signature, generator type, hands, notes per chord become read-only
         */
        _disableGeneratorSettings() {
            this._settingsDisabled = true;
            $('.srt-generator-btn').addClass('disabled').css({ opacity: 0.4, pointerEvents: 'none' });
            $('.srt-key-btn').addClass('disabled').css({ opacity: 0.4, pointerEvents: 'none' });
            $('#srtHandsSlider').prop('disabled', true).css('opacity', 0.4);
            $('#srtNotesSlider').prop('disabled', true).css('opacity', 0.4);
        }

        /**
         * Re-enable generator settings when user resets or changes to generated content
         */
        _enableGeneratorSettings() {
            this._settingsDisabled = false;
            $('.srt-generator-btn').removeClass('disabled').css({ opacity: 1, pointerEvents: '' });
            $('.srt-key-btn').removeClass('disabled').css({ opacity: 1, pointerEvents: '' });
            $('#srtHandsSlider').prop('disabled', false).css('opacity', 1);
            $('#srtNotesSlider').prop('disabled', false).css('opacity', 1);
        }

        /**
         * Adjust chord density on existing notes - adds/removes harmony notes
         * When slider goes up: add chord tones above/below existing melody notes
         * When slider goes down: remove extra chord notes, keep melody
         */
        _adjustChordDensity(targetNotesPerChord) {
            if (!this.notes || this.notes.length === 0) return;

            // HARD LIMIT: max 5 notes per staff per chord position
            const MAX_PER_STAFF = 5;
            const cappedTarget = Math.min(Math.max(1, targetNotesPerChord), MAX_PER_STAFF);

            const keySignature = this.userSettings.key_signature || 'C';
            const scale = this.noteGenerator.getScaleForKey(keySignature);

            // Group notes by position (measure + beat), but NOT by staff
            // so we can enforce the per-staff limit across both staves
            const groupMap = new Map();
            this.notes.forEach(n => {
                const key = `${n.measure}-${snapBeat(n.beat)}`;
                if (!groupMap.has(key)) groupMap.set(key, []);
                groupMap.get(key).push(n);
            });

            const newNotes = [];

            groupMap.forEach((group, key) => {
                // Separate rests and melodic notes
                const melodicNotes = group.filter(n => !n.isRest && n.midi);
                const restNotes = group.filter(n => n.isRest || !n.midi);

                // Always keep rests
                newNotes.push(...restNotes);

                if (melodicNotes.length === 0) return;

                // Split existing notes by staff
                const trebleNotes = melodicNotes.filter(n => (n.staff || 'treble') === 'treble');
                const bassNotes = melodicNotes.filter(n => n.staff === 'bass');

                if (cappedTarget <= 1) {
                    // Solo mode: keep only one note per staff
                    if (trebleNotes.length > 0) {
                        trebleNotes.sort((a, b) => a.midi - b.midi);
                        newNotes.push(trebleNotes[Math.floor(trebleNotes.length / 2)]);
                    }
                    if (bassNotes.length > 0) {
                        bassNotes.sort((a, b) => a.midi - b.midi);
                        newNotes.push(bassNotes[Math.floor(bassNotes.length / 2)]);
                    }
                } else {
                    // Chord mode: build diatonic chord from scale notes PER STAFF
                    const scaleInRange = (min, max) => scale.filter(m => m >= min && m <= max);
                    const processStaff = (existingNotes, staffName, minMidi, maxMidi) => {
                        if (existingNotes.length === 0) return;
                        existingNotes.sort((a, b) => a.midi - b.midi);
                        const anchor = existingNotes[Math.floor(existingNotes.length / 2)];
                        const staffScale = scaleInRange(minMidi, maxMidi);
                        if (staffScale.length === 0) { newNotes.push(anchor); return; }

                        // Find anchor position in scale
                        let rootIdx = 0;
                        let minDist = 999;
                        staffScale.forEach((m, i) => {
                            const d = Math.abs(m - anchor.midi);
                            if (d < minDist) { minDist = d; rootIdx = i; }
                        });

                        // Build diatonic chord: stack thirds (every 2 scale degrees)
                        const chordNotes = [];
                        for (let i = 0; i < cappedTarget; i++) {
                            const scaleIdx = rootIdx + (i * 2);
                            if (scaleIdx >= staffScale.length) break;
                            const midi = staffScale[scaleIdx];
                            if (i === 0) {
                                const note = { ...anchor, midi };
                                chordNotes.push(note);
                            } else {
                                chordNotes.push({
                                    midi, duration: anchor.duration,
                                    measure: anchor.measure, beat: anchor.beat,
                                    staff: staffName,
                                    accidental: this.noteGenerator.getAccidental(midi, keySignature),
                                    isChord: true, chordIndex: i
                                });
                            }
                        }
                        newNotes.push(...chordNotes.slice(0, MAX_PER_STAFF));
                    };

                    processStaff(trebleNotes, 'treble', 60, 84);
                    processStaff(bassNotes, 'bass', 36, 59);
                }
            });

            this.notes = newNotes;
            this.notes.sort((a, b) => {
                const posA = (a.measure || 0) * 4 + (a.beat || 0);
                const posB = (b.measure || 0) * 4 + (b.beat || 0);
                return posA - posB;
            });
            this.calculateOptimalMeasureWidth();
            this.requestRender();
        }

        /**
         * Adjust hands count on existing notes
         * When 2: add bass clef notes on beats that have treble notes
         * When 1: remove bass clef notes added by this function
         */
        _adjustHands(handsCount) {
            if (!this.notes || this.notes.length === 0) return;

            if (handsCount >= 2) {
                // 2 hands: ensure EVERY treble beat position also has a bass note
                const keySignature = this.userSettings.key_signature || 'C';
                const scale = this.noteGenerator.getScaleForKey(keySignature);
                const bassScale = scale.filter(m => m >= 43 && m < 60);
                if (bassScale.length === 0) return;

                // First, move any treble notes below C4 up to treble range
                this.notes.forEach(n => {
                    if (!n.isRest && n.midi && n.midi < 60 && n.staff === 'treble') {
                        n.midi = n.midi + 12;
                        while (n.midi < 60) n.midi += 12;
                        n.staff = 'treble';
                    }
                });

                const bassBeats = new Set();
                this.notes.forEach(n => {
                    if (n.staff === 'bass' && !n.isRest) {
                        bassBeats.add(`${n.measure}-${Math.floor(n.beat)}`);
                    }
                });

                const newBassNotes = [];
                const treblePositions = new Map();
                this.notes.forEach(n => {
                    if (!n.isRest && n.midi && n.staff === 'treble') {
                        const key = `${n.measure}-${Math.floor(n.beat)}`;
                        if (!treblePositions.has(key)) {
                            treblePositions.set(key, n);
                        }
                    }
                });

                // Map treble notes to harmonically related bass notes
                treblePositions.forEach((trebleNote, key) => {
                    if (!bassBeats.has(key)) {
                        // Find a bass note harmonically related to the treble note
                        // Use root of closest scale degree (octave down from treble)
                        let bassMidi = trebleNote.midi - 12;
                        while (bassMidi >= 60) bassMidi -= 12;
                        while (bassMidi < 36) bassMidi += 12;
                        // Snap to nearest note in bass scale
                        const closest = bassScale.reduce((prev, curr) =>
                            Math.abs(curr - bassMidi) < Math.abs(prev - bassMidi) ? curr : prev, bassScale[0]);
                        newBassNotes.push({
                            midi: closest,
                            duration: trebleNote.duration,
                            measure: trebleNote.measure,
                            beat: Math.floor(trebleNote.beat),
                            staff: 'bass',
                            accidental: this.noteGenerator.getAccidental(closest, keySignature),
                            twoHands: true
                        });
                    }
                });

                this.notes.push(...newBassNotes);

                // Switch to grand staff
                this.setClef('grand');
            } else {
                // 1 hand: remove ALL bass staff notes (not just twoHands tagged ones)
                this.notes = this.notes.filter(n => n.staff !== 'bass');

                // Also ensure no treble notes are below C4
                this.notes.forEach(n => {
                    if (!n.isRest && n.midi && n.midi < 60) {
                        n.midi = n.midi + 12;
                        while (n.midi < 60) n.midi += 12;
                        n.staff = 'treble';
                    }
                });

                // Switch to treble only
                this.setClef('treble');
            }

            this.notes.sort((a, b) => {
                const posA = (a.measure || 0) * 4 + (a.beat || 0);
                const posB = (b.measure || 0) * 4 + (b.beat || 0);
                return posA - posB;
            });
            this.calculateOptimalMeasureWidth();
            this.requestRender();
        }

        setKeySignature(key) {
            // Ignore if settings are disabled (file/song loaded)
            if (this._settingsDisabled) return;

            // Store in both staffSettings (for rendering) and userSettings (for generator)
            this.staffSettings.keySignature = key;
            this.userSettings.key_signature = key;

            // Update the key signature button UI (buttons with data-key attribute)
            $('.srt-key-btn').removeClass('active');
            $(`.srt-key-btn[data-key="${key}"]`).addClass('active');

            if (this.renderer) {
                this.renderer.setKeySignature(key);
                this.requestRender();
            }
            // Only regenerate if NOT in free mode
            if (this.mode !== 'free') {
                this.generateInitialNotes();
            }
            this.saveSettings();
        }
        
        setTimeSignature(time) {
            this.staffSettings.timeSignature = time;
            if (this.renderer) {
                this.renderer.setTimeSignature(time);
            }
        }
        
        updateNoteRange() {
            const min = $('#srtRangeMin').val();
            const max = $('#srtRangeMax').val();
            this.userSettings.note_range_min = min;
            this.userSettings.note_range_max = max;
            this.saveSettings();
            // Regenerate notes with new range
            if (this.mode !== 'free' && !this.midiFileLoaded) {
                this.generateInitialNotes();
            }
        }
        
        setHands(hands) {
            this.userSettings.hands = hands;
            this.userSettings.hands_count = parseInt(hands) || 1;
            $('.srt-btn-option[data-hands]').removeClass('active');
            $(`.srt-btn-option[data-hands="${hands}"]`).addClass('active');
            this.saveSettings();
            // Regenerate with new hand count
            if (this.mode !== 'free' && !this.midiFileLoaded) {
                this.generateInitialNotes();
            }
        }
        
        setAccidentals(enabled) {
            this.userSettings.use_accidentals = enabled;
            this.saveSettings();
        }
        
        setChordDensity(density) {
            this.userSettings.chord_density = density;
            $('#srtChordDensityValue').text(density + ' notes');
            this.saveSettings();
        }
        
        setNoteNames(system) {
            this.userSettings.note_names = system;
            if (this.renderer) {
                this.renderer.setNoteNameSystem(system);
            }
            this.saveSettings();
        }
        
        toggleKeyboard(show) {
            if (show) {
                $('#srtPianoContainer').show();
            } else {
                $('#srtPianoContainer').hide();
            }
            this.userSettings.show_keyboard = show;
            this.saveSettings();
        }
        
        toggleStats(show) {
            if (show) {
                $('#srtStatsPanel').show();
            } else {
                $('#srtStatsPanel').hide();
            }
            this.userSettings.show_stats = show;
            this.saveSettings();
        }
        
        setHighlightErrors(enabled) {
            this.userSettings.highlight_errors = enabled;
            this.saveSettings();
        }
        
        setPianoSound(sound) {
            this.userSettings.piano_sound = sound;
            this.audio.setPianoSound(sound);
            this.saveSettings();
        }
        
        setVolume(volume) {
            this.userSettings.volume = volume;
            $('#srtVolumeValue').text(volume); // % already in HTML
            this.audio.setVolume(volume / 100);
            this.saveSettings();
        }
        
        setMetronomeVolume(volume) {
            this.userSettings.metronome_volume = volume;
            $('#srtMetronomeVolumeValue').text(volume + '%');
            this.audio.setMetronomeVolume(volume / 100);
            this.saveSettings();
        }
        
        updateMIDISettings() {
            const input = $('#srtMidiInput').val();
            const output = $('#srtMidiOutput').val();
            const channel = parseInt($('#srtMidiChannel').val());
            
            this.userSettings.midi_input = input;
            this.userSettings.midi_output = output;
            this.userSettings.midi_channel = channel;
            
            if (this.midi) {
                this.midi.updateSettings(input, output, channel);
            }
            
            this.saveSettings();
        }
        
        uploadCustomSound() {
            const fileInput = document.getElementById('srtSoundUpload');
            if (!fileInput.files || fileInput.files.length === 0) {
                this.showMessage('Please select a sound file', 'warning');
                return;
            }
            
            const formData = new FormData();
            formData.append('action', 'srt_upload_sound');
            formData.append('nonce', this.config.nonce);
            formData.append('sound_file', fileInput.files[0]);
            
            $.ajax({
                url: this.config.ajaxUrl,
                type: 'POST',
                data: formData,
                processData: false,
                contentType: false,
                success: (response) => {
                    if (response.success) {
                        this.audio.loadCustomSound(response.data.url);
                        this.showToast('Custom sound uploaded successfully');
                    } else {
                        this.showMessage('Upload failed: ' + response.data, 'error');
                    }
                }
            });
        }
        
        saveSettings() {
            // Save to localStorage immediately (always works)
            this.saveLocalSettings();

            // Debounce AJAX save — coalesce rapid toggles into one request
            if (this._saveSettingsTimer) {
                clearTimeout(this._saveSettingsTimer);
            }
            this._saveSettingsTimer = setTimeout(() => {
                this._saveSettingsTimer = null;
                this._saveSettingsToServer();
            }, 800);
        }

        /**
         * Actually send settings to server (called by debounced saveSettings)
         */
        _saveSettingsToServer() {
            // Only attempt AJAX if auth is confirmed valid
            if (!this._ajaxEnabled) return;

            $.ajax({
                url: this.config.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'srt_update_settings',
                    nonce: this.config.nonce,
                    settings: this.userSettings
                },
                success: (response) => {
                    if (!response.success) {
                        // Nonce expired or auth failed — disable further AJAX attempts
                        this._ajaxEnabled = false;
                    }
                },
                error: () => {
                    // Server error — disable AJAX to stop flooding
                    this._ajaxEnabled = false;
                }
            });
        }
        
        showToast(message, type = 'success') {
            $('#srtToastMessage').text(message);
            $('#srtToast').removeClass('error success').addClass(type).fadeIn(300);
            
            setTimeout(() => {
                $('#srtToast').fadeOut(300);
            }, 3000);
        }
        
        handleKeyboardShortcut(e) {
            // Space bar - play/pause
            if (e.keyCode === 32) {
                e.preventDefault();
                if (this.isPlaying) {
                    this.pause();
                } else {
                    this.start();
                }
            }
            
            // Escape - stop
            if (e.keyCode === 27) {
                this.stop();
            }
            
            // R - reset
            if (e.keyCode === 82 && e.ctrlKey) {
                e.preventDefault();
                this.reset();
            }
            
            // M - toggle metronome
            if (e.keyCode === 77) {
                this.toggleMetronome();
            }
            
            // S - toggle settings
            if (e.keyCode === 83 && e.ctrlKey) {
                e.preventDefault();
                this.toggleSettingsPanel();
            }

            // ALT key sustain is handled by jQuery keydown/keyup in setupEventListeners()
            // Do NOT toggle here - the hold behavior (keydown=ON, keyup=OFF) is correct
            if (e.keyCode === 18) { // ALT key
                e.preventDefault();
                // Handled by jQuery event listeners for proper hold behavior
            }
        }

        /**
         * Toggle sustain pedal on/off (for click/tap UI only)
         * ALT key uses hold behavior (keydown=ON, keyup=OFF) via jQuery handlers
         */
        toggleSustainPedal() {
            this.setSustainState(!this.sustainPedalActive);
        }

        /**
         * Set sustain pedal to a specific state
         * Centralized method to avoid conflicts between ALT hold and click toggle
         */
        setSustainState(isActive) {
            this.sustainPedalActive = isActive;

            // Update visual indicator
            const indicator = document.getElementById('srtSustainIndicator');
            if (indicator) {
                if (isActive) {
                    indicator.classList.add('active');
                } else {
                    indicator.classList.remove('active');
                }
            }

            // Update checkbox if exists
            const checkbox = document.getElementById('srtSustainPedal');
            if (checkbox) {
                checkbox.checked = isActive;
            }

            // Update audio engine
            if (this.audio) {
                this.audio.setSustainPedal(isActive);
                // If pedal released, release all sustained notes
                if (!isActive) {
                    this.audio.releaseAllNotes();
                }
            }

            // Update piano sustain state
            if (this.piano) {
                this.piano.sustain = isActive;
            }
        }
        
        // Additional helper methods
        
        shouldGenerateMoreNotes() {
            // CRITICAL: Don't generate more notes if MIDI file is loaded
            // MIDI files should play through completely without random additions
            if (this.midiFileLoaded) {
                return false;
            }

            // Check if we need to generate more notes for continuous play
            const lastNote = this.notes[this.notes.length - 1];
            if (!lastNote) {
                return true;
            }

            const lastNotePosition = this.getNotePosition(lastNote);
            const canvasWidth = this.canvas.width / (window.devicePixelRatio || 1);

            return lastNotePosition < this.playheadPosition + canvasWidth;
        }
        
        generateMoreNotes() {
            const newNotes = this.noteGenerator.generate();

            // Offset the new notes to continue from the last note
            const lastNote = this.notes[this.notes.length - 1];
            const offset = lastNote ? lastNote.measure + 1 : 0;

            newNotes.forEach(note => {
                note.measure += offset;
            });

            this.notes = this.notes.concat(newNotes);

            // Sanitize newly added notes
            this._sanitizeGeneratedNotes();

            // Recalculate measure width and cached max measure
            this.calculateOptimalMeasureWidth();
        }

        /**
         * Get the visual playhead X position on screen
         * This is where the golden bar is rendered and where first note should appear
         * Dynamic based on key signature width
         */
        getVisualPlayheadX() {
            if (this.renderer && this.renderer.calculatedNoteStartX) {
                // First note position = calculatedNoteStartX + barLineMargin (15px)
                return this.renderer.calculatedNoteStartX + 20;
            }
            // Fallback: default position
            return 200;
        }

        getNotePosition(note) {
            // FIXED: Use renderer's getNoteX() for consistent positioning
            // This ensures playhead detection matches visual note positions
            // Previously used hardcoded 200px, but renderer uses 250px + professional spacing
            if (this.renderer) {
                return this.renderer.getNoteX(note);
            }

            // Fallback (should never happen in normal operation)
            const measureWidth = 250; // Match renderer's measureWidth
            const beatWidth = measureWidth / 4; // assuming 4/4 time
            return (note.measure * measureWidth) + (note.beat * beatWidth);
        }
        
        checkNotesInScrollMode() {
            const visualPlayheadX = this.getVisualPlayheadX();
            const playheadWorldPosition = this.playheadPosition + visualPlayheadX;
            const tolerance = 5;

            // Start scanning from first unprocessed note (skip already played/missed/off-screen)
            const startIdx = this._scrollScanIdx || 0;
            const missedNotes = [];
            let firstActiveIdx = -1;

            for (let i = startIdx; i < this.notes.length; i++) {
                const note = this.notes[i];
                if (note.played || note.missed || note.isRest) continue;

                const notePosition = this.getNotePosition(note);
                const screenX = notePosition - this.playheadPosition;

                if (screenX > 500) break; // Notes sorted — nothing further is relevant

                if (firstActiveIdx < 0) firstActiveIdx = i;

                if (notePosition < playheadWorldPosition - tolerance) {
                    missedNotes.push(note);
                }
            }

            // Advance scan index to skip already-settled notes
            if (firstActiveIdx >= 0) this._scrollScanIdx = firstActiveIdx;

            if (missedNotes.length > 0) {
                this.scrollPaused = true;
                this._scrollTimingFeedback = 'wrong';
                clearTimeout(this._scrollFeedbackTimer);
            }

            for (let i = 0; i < missedNotes.length; i++) {
                missedNotes[i].missed = true;
                this.handleMissedNote(missedNotes[i]);
            }
        }
        
        handleMissedNote(note) {
            this.incorrectNotes++;
            this.streak = 0;
            
            // Visual feedback
            this.renderer.showMissedFeedback(note);
            
            // Update displays
            this.updateStreakDisplay();
            this.updateAccuracyDisplay();
            this.updateIncorrectNotesDisplay();
        }
        
        highlightCurrentNote(note) {
            this.renderer.highlightNote(note);
        }
        
        updatePlayheadVisual() {
            // Playhead position only changes on resize — cache it
            if (!this._playheadEl) {
                this._playheadEl = document.getElementById('srtPlayhead');
            }
            if (!this._playheadEl) return;

            // Use cached canvas width (updated on resize), avoid getBoundingClientRect every frame
            if (!this._cachedCanvasWidth) {
                this._cachedCanvasWidth = this.canvas.width / (window.devicePixelRatio || 1);
            }
            const x = this._cachedCanvasWidth / 3;
            this._playheadEl.style.left = x + 'px';
        }
        
        showMetronomeBeat() {
            // Visual metronome indicator - pulse the button icon
            const btn = $('#srtMetronomeBtn');
            const icon = btn.find('.srt-metronome-icon');

            // Add pulsing class
            icon.addClass('srt-metronome-pulse');

            // Remove after animation completes
            setTimeout(() => {
                icon.removeClass('srt-metronome-pulse');
            }, 150);

            // Also flash the button background briefly for stronger feedback
            btn.addClass('srt-metronome-flash');
            setTimeout(() => {
                btn.removeClass('srt-metronome-flash');
            }, 100);
        }
        
        checkStreakAchievements() {
            // Check various streak milestones
            const streakMilestones = [10, 25, 50, 100];
            
            streakMilestones.forEach(milestone => {
                if (this.streak === milestone) {
                    const achievementId = `streak_${milestone}`;
                    if (!this.hasAchievement(achievementId)) {
                        // Dynamic achievement creation
                        this.config.achievements[achievementId] = {
                            name: `${milestone} Note Streak`,
                            description: `Get ${milestone} notes correct in a row`,
                            icon: '🔥',
                            xp: milestone * 10
                        };
                        this.unlockAchievement(achievementId);
                    }
                }
            });
        }
        
        checkCompletionAchievements() {
            // Check for perfect completion
            if (this.getAccuracy() === 100) {
                if (!this.hasAchievement('perfect_exercise')) {
                    this.unlockAchievement('perfect_exercise');
                }
            }
        }
    }
    
    /**
     * Virtual Piano Class
     */
    class VirtualPiano {
        constructor(engine) {
            this.engine = engine;
            this.container = null;
            this.keys = [];
            this.octave = 4;
            this.transpose = 0;
            this.sustain = false;
            this.activeNotes = new Set();
            this.octaveCount = 5; // Default to 61 keys (5 octaves) as requested by user
        }

        init() {
            this.container = document.getElementById('srtPianoKeyboard');
            if (!this.container) {
                console.error('Piano container not found');
                return;
            }

            this.createKeys(this.octaveCount);
            this.setupEventListeners();
            this.mapComputerKeyboard();

            // Listen for octave select changes
            const octaveSelect = document.getElementById('srtOctaveSelect');
            if (octaveSelect) {
                octaveSelect.addEventListener('change', (e) => {
                    this.setOctaveRange(parseInt(e.target.value));
                });
            }

            // Initialize piano note names visibility based on settings
            // NOTE: The checkbox handler is now in main engine (lines 885-902)
            // to support independent staff/piano checkboxes
            const noteNamesCheckbox = document.getElementById('srtPianoNoteNames');
            if (noteNamesCheckbox && noteNamesCheckbox.checked) {
                this.container.parentElement.classList.add('srt-show-key-names');
            }

            // USER FIX: Add resize listener for responsive keyboard
            // Debounced to prevent excessive recalculations
            let resizeTimeout;
            window.addEventListener('resize', () => {
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => {
                    this.adjustKeySize(this.octaveCount);
                }, 150);
            });

            // Also handle orientation change on mobile
            window.addEventListener('orientationchange', () => {
                setTimeout(() => {
                    this.adjustKeySize(this.octaveCount);
                }, 300); // Wait for orientation to settle
            });

            // Initial size adjustment
            this.adjustKeySize(this.octaveCount);
        }

        setOctaveRange(octaveCount) {
            this.octaveCount = octaveCount;
            this.createKeys(octaveCount);
            this.setupEventListeners();

            // Adjust piano key sizes based on octave count
            this.adjustKeySize(octaveCount);
        }

        adjustKeySize(octaveCount) {
            // Piano keyboard must always match staff container width EXACTLY
            const staffContainer = document.querySelector('.srt-staff-container');
            const pianoContainer = document.querySelector('.srt-piano-container');

            if (!staffContainer || !pianoContainer) return;

            const doResize = () => {
                const staffWidth = staffContainer.clientWidth;
                if (staffWidth === 0) return;

                // Force piano container to match staff width
                pianoContainer.style.width = staffWidth + 'px';
                pianoContainer.style.maxWidth = staffWidth + 'px';

                // Count white keys based on octave range
                const whiteKeyCounts = { 2: 15, 3: 22, 4: 29, 5: 36, 6: 43, 7: 52 };
                const whiteKeyCount = whiteKeyCounts[octaveCount] || 52;

                // Calculate key width to FILL entire container width
                // Container has ~16px padding total (8px each side)
                const availableWidth = staffWidth - 16;
                const whiteKeyWidth = availableWidth / whiteKeyCount;
                const blackKeyWidth = whiteKeyWidth * 0.62;

                // Height: responsive based on key width, with reasonable min/max
                const whiteKeyHeight = Math.min(160, Math.max(100, whiteKeyWidth * 4.5));
                const blackKeyHeight = whiteKeyHeight * 0.65;

                this.container.style.setProperty('--white-key-width', whiteKeyWidth.toFixed(2) + 'px');
                this.container.style.setProperty('--black-key-width', blackKeyWidth.toFixed(2) + 'px');
                this.container.style.setProperty('--white-key-height', whiteKeyHeight.toFixed(0) + 'px');
                this.container.style.setProperty('--black-key-height', blackKeyHeight.toFixed(0) + 'px');

                this.container.style.width = '100%';
                this.container.style.maxWidth = '100%';
                pianoContainer.style.overflowX = 'hidden';
            };

            // Run now and also on next frame (for layout)
            requestAnimationFrame(doResize);
            // Also re-run on window resize for responsiveness
            if (!this._resizeListenerAdded) {
                this._resizeListenerAdded = true;
                window.addEventListener('resize', () => {
                    requestAnimationFrame(doResize);
                });
            }
        }

        createKeys(octaveCount = 7) {
            // Clear existing keys
            this.container.innerHTML = '';
            this.keys = [];

            let startPitch, endPitch;

            if (octaveCount === 5) {
                // 5 octaves: C2 to C7 (61 keys)
                startPitch = this.parseNote('C2');
                endPitch = this.parseNote('C7');
            } else {
                // 7 octaves: A0 to C8 (88 keys - full piano)
                startPitch = this.parseNote('A0');
                endPitch = this.parseNote('C8');
            }

            // Create all keys sequentially
            for (let pitch = startPitch; pitch <= endPitch; pitch++) {
                const isBlack = this.isBlackKey(pitch);
                const noteName = this.midiToNoteName(pitch);

                // Create key wrapper (for proper positioning)
                // USER FIX: Add specific class for black key wrappers (for mobile CSS)
                const wrapper = document.createElement('div');
                wrapper.className = isBlack
                    ? 'srt-key-wrapper srt-key-wrapper-black'
                    : 'srt-key-wrapper srt-key-wrapper-white';

                // Create key element
                const key = document.createElement('div');
                key.className = `srt-piano-key ${isBlack ? 'srt-piano-key-black' : 'srt-piano-key-white'}`;
                key.dataset.note = noteName;
                key.dataset.midi = pitch;

                // Add note label for C notes (white keys only)
                if (!isBlack && noteName.startsWith('C')) {
                    const label = document.createElement('span');
                    label.className = 'srt-key-label';
                    label.textContent = noteName;
                    key.appendChild(label);
                }

                // Add note name (hidden by default, shown when enabled)
                const noteNameElem = document.createElement('span');
                noteNameElem.className = 'srt-key-note-name';
                // Remove octave number for cleaner display
                noteNameElem.textContent = noteName.replace(/\d+$/, '');
                key.appendChild(noteNameElem);

                // Add computer keyboard shortcut label (hidden by default, desktop only)
                const kbLabel = document.createElement('span');
                kbLabel.className = 'srt-key-kb-shortcut';
                kbLabel.style.display = 'none';
                key.appendChild(kbLabel);

                wrapper.appendChild(key);
                this.container.appendChild(wrapper);

                this.keys.push({
                    element: key,
                    note: noteName,
                    midi: pitch,
                    type: isBlack ? 'black' : 'white'
                });
            }
        }

        isBlackKey(pitch) {
            // Black keys are at positions 1, 3, 6, 8, 10 in the 12-note octave
            const pitchClass = pitch % 12;
            return [1, 3, 6, 8, 10].includes(pitchClass);
        }

        parseNote(noteName) {
            // Simple note parser: e.g., "C4" → 60
            const noteMatch = noteName.match(/^([A-G])(#|b)?(\d+)$/);
            if (!noteMatch) return 60;

            const [_, letter, accidental, octave] = noteMatch;
            const noteOffsets = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

            let pitch = (parseInt(octave) + 1) * 12 + noteOffsets[letter];
            if (accidental === '#') pitch++;
            if (accidental === 'b') pitch--;

            return pitch;
        }

        midiToNoteName(pitch) {
            const octave = Math.floor(pitch / 12) - 1;
            const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
            const noteName = noteNames[pitch % 12];
            return `${noteName}${octave}`;
        }
        
        setupEventListeners() {
            // Mouse events
            this.keys.forEach(key => {
                key.element.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    this.playKey(key.midi);
                });

                key.element.addEventListener('mouseup', () => {
                    // USER FIX: ALWAYS release key visually (remove gold)
                    // Audio release is handled inside releaseKey based on sustain state
                    this.releaseKey(key.midi);
                });

                key.element.addEventListener('mouseenter', (e) => {
                    if (e.buttons === 1) {
                        this.playKey(key.midi);
                    }
                });

                key.element.addEventListener('mouseleave', () => {
                    // USER FIX: ALWAYS release key visually
                    this.releaseKey(key.midi);
                });
            });

            // Touch events for mobile
            this.keys.forEach(key => {
                key.element.addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    this.playKey(key.midi);
                });

                key.element.addEventListener('touchend', (e) => {
                    e.preventDefault();
                    // USER FIX: ALWAYS release key visually
                    this.releaseKey(key.midi);
                });
            });
        }
        
        mapComputerKeyboard() {
            // Full QWERTY keyboard mapping covering MIDI 36-96 (C2-C7)
            //
            // === WHITE KEYS ===
            // Bottom row (Z../) : C2 D2 E2 F2 G2 A2 B2 C3 D3 E3
            // Home row   (A..') : F3 G3 A3 B3 C4 D4 E4 F4 G4 A4 B4
            // QWERTY row (Q..]) : C5 D5 E5 F5 G5 A5 B5 C6 D6 E6 F6 G6
            //
            // === BLACK KEYS ===
            // Number row (1..=) : sharps for bottom+home rows
            // Shift+QWERTY      : sharps for QWERTY row (upper octaves)
            //
            // Space = sustain pedal

            // White key mapping (lowercase)
            const keyToMidi = {
                // --- Bottom row: C2(36) to E3(52) ---
                'z': 36, 'x': 38, 'c': 40, 'v': 41, 'b': 43, 'n': 45, 'm': 47,
                ',': 48, '.': 50, '/': 52,
                // --- Home row: F3(53) to B4(71) ---
                'a': 53, 's': 55, 'd': 57, 'f': 59, 'g': 60, 'h': 62, 'j': 64,
                'k': 65, 'l': 67, ';': 69, "'": 71,
                // --- QWERTY row: C5(72) to G6(91) ---
                'q': 72, 'w': 74, 'e': 76, 'r': 77, 't': 79, 'y': 81, 'u': 83,
                'i': 84, 'o': 86, 'p': 88, '[': 89, ']': 91,
                // --- Number row: black keys for octaves 2-4 ---
                '1': 37,  // C#2
                '2': 39,  // D#2
                '3': 42,  // F#2
                '4': 44,  // G#2
                '5': 46,  // A#2
                '6': 49,  // C#3
                '7': 51,  // D#3
                '8': 54,  // F#3
                '9': 56,  // G#3
                '0': 58,  // A#3
                '-': 61,  // C#4
                '=': 63,  // D#4
                '`': 66,  // F#4
                '\\': 70, // A#4
            };

            // Shift+key mapping for black keys in octaves 4-6
            const shiftKeyToMidi = {
                'G': 68,  // G#4  (Shift+G)
                'H': 70,  // A#4  (Shift+H)
                'Q': 73,  // C#5  (Shift+Q)
                'W': 75,  // D#5  (Shift+W)
                'R': 78,  // F#5  (Shift+R)
                'T': 80,  // G#5  (Shift+T)
                'Y': 82,  // A#5  (Shift+Y)
                'I': 85,  // C#6  (Shift+I)
                'O': 87,  // D#6  (Shift+O)
                '[': 90,  // F#6  (Shift+[)
                ']': 92,  // G#6  (Shift+])
                'A': 93,  // A6   (Shift+A)
                'S': 95,  // B6   (Shift+S)
                'D': 96,  // C7   (Shift+D)
            };

            const SUSTAIN_KEY = ' ';

            // Track which MIDI notes are active per physical key to avoid stuck notes
            const physicalKeyToMidi = {};

            document.addEventListener('keydown', (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                if (e.key === SUSTAIN_KEY) {
                    e.preventDefault();
                    this.toggleSustain();
                    return;
                }

                let midi;
                // Check Shift+key first for upper black keys
                if (e.shiftKey && shiftKeyToMidi[e.key]) {
                    midi = shiftKeyToMidi[e.key];
                } else {
                    const lookupKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
                    midi = keyToMidi[lookupKey];
                }

                if (midi !== undefined) {
                    e.preventDefault();
                    const transposedMidi = midi + this.transpose;
                    // Track which physical key maps to which MIDI
                    physicalKeyToMidi[e.code] = transposedMidi;
                    if (!this.activeNotes.has(transposedMidi)) {
                        this.playKey(transposedMidi);
                    }
                }
            });

            document.addEventListener('keyup', (e) => {
                if (e.key === SUSTAIN_KEY) return;
                // Use the tracked MIDI value for this physical key
                const trackedMidi = physicalKeyToMidi[e.code];
                if (trackedMidi !== undefined) {
                    this.releaseKey(trackedMidi);
                    delete physicalKeyToMidi[e.code];
                    return;
                }
                // Fallback: try direct lookup
                let midi;
                if (e.shiftKey && shiftKeyToMidi[e.key]) {
                    midi = shiftKeyToMidi[e.key];
                } else {
                    const lookupKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
                    midi = keyToMidi[lookupKey];
                }
                if (midi !== undefined) {
                    this.releaseKey(midi + this.transpose);
                }
            });

            // Store mappings for label display
            this._keyToMidi = keyToMidi;
            this._shiftKeyToMidi = shiftKeyToMidi;
        }
        
        playKey(midi) {
            this.activeNotes.add(midi);
            this.highlightKey(midi);

            // FEATURE: Auto-start game when clicking expected piano key
            // User requirement: "en mode scroll ou wait, le jeu démarre soit en cliquant sur
            // PLAY soit en cliquant sur la touche du piano qui correspond à la note qui doit
            // être jouée (entouré en mode wait notamment)"
            if (!this.engine.isPlaying && (this.engine.mode === 'wait' || this.engine.mode === 'scroll')) {
                // Check if clicked key matches the expected note
                const expectedNote = this.engine.getCurrentExpectedNote();

                if (expectedNote) {
                    const expectedMidi = Array.isArray(expectedNote)
                        ? expectedNote.map(n => n.midi)
                        : [expectedNote.midi];

                    // If clicked note matches expected note (or is part of expected chord)
                    if (expectedMidi.includes(midi)) {
                        this.engine.start(); // Start the game automatically
                    }
                }
            }

            this.engine.handleNoteInput(midi, 127, 'piano');
        }
        
        releaseKey(midi) {
            this.activeNotes.delete(midi);
            this.unhighlightKey(midi);

            // USER FIX: Only release audio if sustain pedal is NOT active
            // This mirrors the fix in MIDIHandler.handleNoteOff()
            if (this.engine.audio && !this.engine.sustainPedalActive) {
                this.engine.audio.releaseNote(midi);
            }

            // USER REQUEST: Remove ghost notes when key is released
            if (this.engine && this.engine.removeGhostNotesForMidi) {
                this.engine.removeGhostNotesForMidi(midi);
            }
        }
        
        highlightKey(midi) {
            const key = this.keys.find(k => k.midi === midi);
            if (key) {
                key.element.classList.add('active');
            }
        }

        unhighlightKey(midi) {
            const key = this.keys.find(k => k.midi === midi);
            if (key) {
                key.element.classList.remove('active');
                key.element.classList.remove('srt-key-exercise-next');
                key.element.classList.remove('srt-key-wrong');
            }
        }

        /**
         * EXERCISE MODE: Highlight piano key in blue for next notes to play
         */
        highlightKeyExercise(midi) {
            const key = this.keys.find(k => k.midi === midi);
            if (key) {
                key.element.classList.add('srt-key-exercise-next');
            }
        }

        /**
         * Clear all exercise highlights from piano keys
         */
        clearExerciseHighlights() {
            this.keys.forEach(k => {
                k.element.classList.remove('srt-key-exercise-next');
                k.element.classList.remove('srt-key-wrong');
            });
        }

        /**
         * Highlight piano key in red for wrong note
         */
        highlightKeyWrong(midi) {
            const key = this.keys.find(k => k.midi === midi);
            if (key) {
                key.element.classList.add('srt-key-wrong');
                // Auto-remove after 600ms
                setTimeout(() => {
                    key.element.classList.remove('srt-key-wrong');
                }, 600);
            }
        }
        
        changeOctave(direction) {
            const newOctave = this.octave + direction;
            if (newOctave >= 1 && newOctave <= 7) {
                this.octave = newOctave;
                $('#srtOctaveValue').text(this.octave);
                // Refresh keyboard mapping labels if visible
                if (this.keyboardMappingVisible) {
                    this.updateKeyboardLabels();
                }
            }
        }
        
        setTranspose(semitones) {
            this.transpose = semitones;
        }
        
        toggleSustain() {
            // Use engine's centralized sustain state management
            this.engine.toggleSustainPedal();
        }

        releaseAllKeys() {
            // Release all active keys (visual and audio)
            // CRITICAL FIX: Reset must clear all highlighted keys
            this.activeNotes.forEach(midi => {
                this.unhighlightKey(midi);
                if (this.engine.audio) {
                    this.engine.audio.releaseNote(midi);
                }
            });
            this.activeNotes.clear();
        }

        noteToMidi(note) {
            const noteMap = {
                'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
                'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
                'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
            };

            const matches = note.match(/([A-G]#?b?)(\d+)/);
            if (!matches) {
                return 60; // Default to middle C
            }

            const noteName = matches[1];
            const octave = parseInt(matches[2]);

            return (octave + 1) * 12 + (noteMap[noteName] || 0);
        }

        /**
         * Update piano note name labels with new notation system (Latin vs International)
         */
        updateNoteNameSystem(system) {
            // Conversion maps
            const latinToInternational = {
                'Do': 'C', 'Ré': 'D', 'Mi': 'E', 'Fa': 'F',
                'Sol': 'G', 'La': 'A', 'Si': 'B'
            };

            const internationalToLatin = {
                'C': 'Do', 'D': 'Ré', 'E': 'Mi', 'F': 'Fa',
                'G': 'Sol', 'A': 'La', 'B': 'Si'
            };

            // Update all key labels
            this.keys.forEach(key => {
                const noteNameElem = key.element.querySelector('.srt-key-note-name');
                if (noteNameElem) {
                    const currentNote = key.note.replace(/\d+$/, ''); // Remove octave: "C4" → "C"

                    let displayName = currentNote;

                    if (system === 'latin' && internationalToLatin[currentNote.charAt(0)]) {
                        // Convert C → Do, D → Ré, etc.
                        const baseName = internationalToLatin[currentNote.charAt(0)];
                        const accidental = currentNote.slice(1); // # or b
                        displayName = baseName + accidental;
                    } else {
                        // International (default) - keep as is
                        displayName = currentNote;
                    }

                    noteNameElem.textContent = displayName;
                }

                // Also update C labels (e.g., "C4" → "Do4" in Latin)
                const labelElem = key.element.querySelector('.srt-key-label');
                if (labelElem && key.note.startsWith('C')) {
                    if (system === 'latin') {
                        const octave = key.note.match(/\d+$/)[0];
                        labelElem.textContent = 'Do' + octave;
                    } else {
                        labelElem.textContent = key.note; // C4, C3, etc.
                    }
                }
            });

        }

        /**
         * Show or hide computer keyboard shortcut labels on piano keys.
         * Full QWERTY mapping: every key maps to a specific MIDI note.
         */
        showKeyboardMapping(show) {
            this.keyboardMappingVisible = show;
            if (show) {
                this.updateKeyboardLabels();
            }
            this.keys.forEach(key => {
                const label = key.element.querySelector('.srt-key-kb-shortcut');
                if (label) {
                    label.style.display = show ? 'block' : 'none';
                }
            });
        }

        /**
         * Update keyboard shortcut labels on piano keys using absolute MIDI mapping.
         */
        updateKeyboardLabels() {
            // Build reverse mapping: MIDI → keyboard key label
            const midiToKeyLabel = {};
            if (this._keyToMidi) {
                for (const [kbKey, midi] of Object.entries(this._keyToMidi)) {
                    const label = kbKey.length === 1 && kbKey.match(/[a-z]/) ? kbKey.toUpperCase() : kbKey;
                    if (!midiToKeyLabel[midi]) {
                        midiToKeyLabel[midi] = label;
                    }
                }
            }
            // Also include Shift+key mappings (shown as ⇧+K)
            if (this._shiftKeyToMidi) {
                for (const [kbKey, midi] of Object.entries(this._shiftKeyToMidi)) {
                    if (!midiToKeyLabel[midi]) {
                        midiToKeyLabel[midi] = '⇧' + kbKey;
                    }
                }
            }

            this.keys.forEach(key => {
                const label = key.element.querySelector('.srt-key-kb-shortcut');
                if (!label) return;

                const kbKey = midiToKeyLabel[key.midi] || '';
                label.textContent = kbKey;
                label.style.display = (this.keyboardMappingVisible && kbKey) ? 'block' : 'none';
            });
        }
    }

    /**
     * MIDI Manager Class
     */
    class MIDIManager {
        constructor(engine) {
            this.engine = engine;
            this.midiAccess = null;
            this.activeInput = null;
            this.activeOutput = null;
            this.channel = 1;
        }
        
        async init() {
            if (!navigator.requestMIDIAccess) {
                this.updateStatus('unsupported');
                return;
            }
            
            try {
                this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
                this.setupMIDI();
                this.updateStatus('connected');
            } catch (error) {
                console.error('Failed to access MIDI:', error);
                this.updateStatus('error');
            }
        }
        
        setupMIDI() {
            // Populate device lists
            this.populateDevices();
            
            // Listen for device changes
            this.midiAccess.onstatechange = () => {
                this.populateDevices();
            };
            
            // Auto-connect first available device
            const inputs = Array.from(this.midiAccess.inputs.values());
            if (inputs.length > 0) {
                this.setInput(inputs[0]);
            }
        }
        
        populateDevices() {
            // Populate input devices
            const inputSelect = document.getElementById('srtMidiInput');
            if (!inputSelect) {
                return;
            }

            inputSelect.innerHTML = '<option value="none">No MIDI Device</option>';

            this.midiAccess.inputs.forEach((input) => {
                const option = document.createElement('option');
                option.value = input.id;
                option.textContent = input.name;
                inputSelect.appendChild(option);
            });
            
            // Populate output devices (if output select exists)
            const outputSelect = document.getElementById('srtMidiOutput');
            if (outputSelect) {
                outputSelect.innerHTML = '<option value="none">Built-in Piano</option>';

                this.midiAccess.outputs.forEach((output) => {
                    const option = document.createElement('option');
                    option.value = output.id;
                    option.textContent = output.name;
                    outputSelect.appendChild(option);
                });
            }
        }
        
        setInput(input) {
            // Remove previous listener
            if (this.activeInput) {
                this.activeInput.onmidimessage = null;
            }
            
            if (typeof input === 'string') {
                input = this.midiAccess.inputs.get(input);
            }
            
            if (!input) {
                return;
            }
            
            this.activeInput = input;
            
            // Set up message handler
            this.activeInput.onmidimessage = (message) => {
                this.handleMIDIMessage(message);
            };
            
            // Update UI
            document.getElementById('srtMidiInput').value = input.id;
            this.updateStatus('connected');
        }
        
        setOutput(output) {
            if (typeof output === 'string') {
                if (output === 'none') {
                    this.activeOutput = null;
                } else {
                    this.activeOutput = this.midiAccess.outputs.get(output);
                }
            } else {
                this.activeOutput = output;
            }
            
            // Update UI
            if (this.activeOutput) {
                document.getElementById('srtMidiOutput').value = this.activeOutput.id;
            }
        }
        
        handleMIDIMessage(message) {
            const [status, data1, data2] = message.data;
            const command = status >> 4;
            const channel = (status & 0x0F) + 1;
            
            // Check if message is on our channel
            if (this.channel !== 0 && channel !== this.channel) {
                return;
            }
            
            switch (command) {
                case 9: // Note On
                    if (data2 > 0) {
                        this.handleNoteOn(data1, data2);
                    } else {
                        this.handleNoteOff(data1);
                    }
                    break;
                    
                case 8: // Note Off
                    this.handleNoteOff(data1);
                    break;
                    
                case 11: // Control Change
                    this.handleControlChange(data1, data2);
                    break;
                    
                case 14: // Pitch Bend
                    this.handlePitchBend(data1, data2);
                    break;
            }
        }
        
        handleNoteOn(note, velocity) {
            this.engine.handleNoteInput(note, velocity, 'midi');
            
            // Forward to output if configured
            if (this.activeOutput) {
                const statusByte = 0x90 | (this.channel - 1);
                this.activeOutput.send([statusByte, note, velocity]);
            }
        }
        
        handleNoteOff(note) {
            // Relâcher touche piano visuel
            if (this.engine.piano) {
                this.engine.piano.releaseKey(note);
            }

            // USER FIX: Only release audio if sustain pedal is NOT active
            // When sustain is active, notes should ring until pedal is released
            if (this.engine.audio && !this.engine.sustainPedalActive) {
                this.engine.audio.releaseNote(note);
            }

            // USER REQUEST: Remove ghost notes when key is released
            if (this.engine && this.engine.removeGhostNotesForMidi) {
                this.engine.removeGhostNotesForMidi(note);
            }

            // Forward to output
            if (this.activeOutput) {
                const statusByte = 0x80 | (this.channel - 1);
                this.activeOutput.send([statusByte, note, 0]);
            }
        }
        
        handleControlChange(controller, value) {
            // Handle sustain pedal (CC64) via centralized state management
            if (controller === 64) {
                const isDown = value >= 64;
                this.engine.setSustainState(isDown);
            }
        }
        
        handlePitchBend(lsb, msb) {
            const bend = (msb << 7) | lsb;
            // Map to -2 to +2 semitones (standard pitch bend range)
            const semitones = ((bend - 8192) / 8192) * 2;
            if (this.engine.audio && this.engine.audio.setPitchBend) {
                this.engine.audio.setPitchBend(semitones);
            }
        }
        
        updateSettings(input, output, channel) {
            this.channel = channel;
            
            if (input !== 'none') {
                this.setInput(input);
            }
            
            if (output !== 'none') {
                this.setOutput(output);
            } else {
                this.activeOutput = null;
            }
        }
        
        refreshDevices() {
            this.populateDevices();
        }
        
        updateStatus(status) {
            const statusElement = document.getElementById('srtMidiStatus');
            const statusText = document.getElementById('srtMidiStatusText');

            if (!statusElement || !statusText) {
                return;
            }

            statusElement.className = 'srt-status-indicator';

            switch (status) {
                case 'connected':
                    statusElement.classList.add('connected');
                    statusText.textContent = 'MIDI Connected';
                    break;
                case 'disconnected':
                    statusElement.classList.add('disconnected');
                    statusText.textContent = 'MIDI Disconnected';
                    break;
                case 'error':
                    statusElement.classList.add('error');
                    statusText.textContent = 'MIDI Error';
                    break;
                case 'unsupported':
                    statusText.textContent = 'MIDI Not Supported';
                    break;
            }
        }
    }
    
    /**
     * Audio Manager Class - SIMPLIFIÉ comme code qui fonctionne
     */
    class AudioManager {
        constructor(engine) {
            this.engine = engine;
            this.pianoSampler = null;
            this.isReady = false;
            this.currentVolume = 0.75;
            this.sustainPedal = false; // MIDI Sustain Pedal (CC64)
            this.activeNotes = new Map(); // Track sustained notes

            // MIDI to Note mapping (21-108 = A0-C8) - COMPLET
            this.MIDI_NOTES = {
                21: 'A0', 22: 'A#0', 23: 'B0', 24: 'C1', 25: 'C#1', 26: 'D1', 27: 'D#1', 28: 'E1', 29: 'F1', 30: 'F#1', 31: 'G1', 32: 'G#1', 33: 'A1', 34: 'A#1', 35: 'B1',
                36: 'C2', 37: 'C#2', 38: 'D2', 39: 'D#2', 40: 'E2', 41: 'F2', 42: 'F#2', 43: 'G2', 44: 'G#2', 45: 'A2', 46: 'A#2', 47: 'B2',
                48: 'C3', 49: 'C#3', 50: 'D3', 51: 'D#3', 52: 'E3', 53: 'F3', 54: 'F#3', 55: 'G3', 56: 'G#3', 57: 'A3', 58: 'A#3', 59: 'B3',
                60: 'C4', 61: 'C#4', 62: 'D4', 63: 'D#4', 64: 'E4', 65: 'F4', 66: 'F#4', 67: 'G4', 68: 'G#4', 69: 'A4', 70: 'A#4', 71: 'B4',
                72: 'C5', 73: 'C#5', 74: 'D5', 75: 'D#5', 76: 'E5', 77: 'F5', 78: 'F#5', 79: 'G5', 80: 'G#5', 81: 'A5', 82: 'A#5', 83: 'B5',
                84: 'C6', 85: 'C#6', 86: 'D6', 87: 'D#6', 88: 'E6', 89: 'F6', 90: 'F#6', 91: 'G6', 92: 'G#6', 93: 'A6', 94: 'A#6', 95: 'B6',
                96: 'C7', 97: 'C#7', 98: 'D7', 99: 'D#7', 100: 'E7', 101: 'F7', 102: 'F#7', 103: 'G7', 104: 'G#7', 105: 'A7', 106: 'A#7', 107: 'B7',
                108: 'C8'
            };
        }

        init() {
            // Check if Tone.js is available
            if (typeof Tone === 'undefined') {
                console.error('❌ Tone.js not loaded!');
                return;
            }

            // Listen for sound changes
            const soundSelect = document.getElementById('srtSoundSelect');
            if (soundSelect) {
                soundSelect.addEventListener('change', (e) => {
                    const soundType = e.target.value;
                    this.loadSound(soundType);
                });
            }

        }

        /**
         * Start audio after user gesture (called when user clicks "Let's Play")
         */
        async startAudio() {
            if (this.isReady) return;

            try {

                // Start Tone.js audio context (AFTER user gesture)
                await Tone.start();

                // Load piano sound by default
                this.loadSound('piano');

            } catch (error) {
                console.error('❌ Erreur audio:', error);
            }
        }

        loadSound(soundType) {
            // Dispose old instruments and effects
            if (this.pianoSampler && typeof this.pianoSampler.dispose === 'function') {
                this.pianoSampler.dispose();
                this.pianoSampler = null;
            }
            if (this._reverb && typeof this._reverb.dispose === 'function') {
                this._reverb.dispose();
                this._reverb = null;
            }
            if (this._chorus && typeof this._chorus.dispose === 'function') {
                this._chorus.dispose();
                this._chorus = null;
            }

            this.isReady = false;

            // Shared Salamander sample URLs (same as concert-hall.js)
            const SALAMANDER_URLS = {
                'A0': 'A0.mp3', 'C1': 'C1.mp3', 'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3',
                'A1': 'A1.mp3', 'C2': 'C2.mp3', 'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3',
                'A2': 'A2.mp3', 'C3': 'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3',
                'A3': 'A3.mp3', 'C4': 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3',
                'A4': 'A4.mp3', 'C5': 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3',
                'A5': 'A5.mp3', 'C6': 'C6.mp3', 'D#6': 'Ds6.mp3', 'F#6': 'Fs6.mp3',
                'A6': 'A6.mp3', 'C7': 'C7.mp3', 'D#7': 'Ds7.mp3', 'F#7': 'Fs7.mp3',
                'A7': 'A7.mp3', 'C8': 'C8.mp3'
            };
            const SALAMANDER_BASE = 'https://tonejs.github.io/audio/salamander/';

            switch(soundType) {
                case 'piano':
                    // Concert grand piano (Salamander) with reverb - matches concert-hall.js
                    this._reverb = new Tone.Freeverb({
                        roomSize: 0.3,
                        wet: 0.2
                    }).toDestination();

                    this.pianoSampler = new Tone.Sampler({
                        urls: SALAMANDER_URLS,
                        baseUrl: SALAMANDER_BASE,
                        release: 0.8,
                        onload: () => {
                            this.isReady = true;
                            this.pianoSampler.volume.value = this.volumeToDb(this.currentVolume);
                        }
                    }).connect(this._reverb);
                    break;

                case 'harpsichord':
                case 'clavecin':
                    // Harpsichord: Salamander samples with bright EQ and short release
                    this.pianoSampler = new Tone.Sampler({
                        urls: SALAMANDER_URLS,
                        baseUrl: SALAMANDER_BASE,
                        release: 0.3,
                        attack: 0,
                        onload: () => {
                            this.isReady = true;
                            this.pianoSampler.volume.value = this.volumeToDb(this.currentVolume) + 3;
                        }
                    }).toDestination();
                    break;

                case 'organ':
                case 'orgue':
                    // Organ: fat additive synthesis with chorus
                    this._chorus = new Tone.Chorus({
                        frequency: 2.5,
                        delayTime: 3.5,
                        depth: 0.5,
                        wet: 0.4
                    }).toDestination();
                    this._chorus.start();

                    this.pianoSampler = new Tone.PolySynth(Tone.Synth, {
                        maxPolyphony: 16,
                        oscillator: {
                            type: 'fatcustom',
                            partials: [1, 0.5, 0.33, 0.25],
                            spread: 20,
                            count: 3
                        },
                        envelope: {
                            attack: 0.005,
                            decay: 0.3,
                            sustain: 0.8,
                            release: 0.3
                        }
                    }).connect(this._chorus);
                    this.isReady = true;
                    this.pianoSampler.volume.value = this.volumeToDb(this.currentVolume) - 6;
                    break;

                case 'electric':
                    // Electric piano (Rhodes-style FM synthesis)
                    this._reverb = new Tone.Freeverb({
                        roomSize: 0.2,
                        wet: 0.15
                    }).toDestination();

                    this.pianoSampler = new Tone.PolySynth(Tone.FMSynth, {
                        maxPolyphony: 32,
                        harmonicity: 3.01,
                        modulationIndex: 10,
                        envelope: {
                            attack: 0.001,
                            decay: 0.8,
                            sustain: 0,
                            release: 0.3
                        },
                        modulation: { type: 'sine' },
                        modulationEnvelope: {
                            attack: 0.01,
                            decay: 0.5,
                            sustain: 0.1,
                            release: 0.3
                        }
                    }).connect(this._reverb);
                    this.isReady = true;
                    this.pianoSampler.volume.value = this.volumeToDb(this.currentVolume) - 8;
                    break;

                case 'synth':
                    // Synth pad sound
                    this.pianoSampler = new Tone.PolySynth(Tone.Synth, {
                        maxPolyphony: 32,
                        oscillator: { type: 'sawtooth' },
                        envelope: {
                            attack: 0.01,
                            decay: 0.15,
                            sustain: 0,
                            release: 0.05
                        },
                        filterEnvelope: {
                            attack: 0.01,
                            decay: 0.15,
                            sustain: 0,
                            release: 0.1,
                            baseFrequency: 2500,
                            octaves: -2
                        }
                    }).toDestination();
                    this.isReady = true;
                    this.pianoSampler.volume.value = this.volumeToDb(this.currentVolume) - 8;
                    break;

                default:
                    this.loadSound('piano');
            }
        }

        // Conversion volume (0-1) vers dB
        volumeToDb(volume) {
            return volume === 0 ? -Infinity : 20 * Math.log10(volume);
        }

        // Set master volume (0-1)
        setVolume(volume) {
            this.currentVolume = volume;
            const dbValue = this.volumeToDb(volume);

            //     percent: Math.round(volume * 100) + '%',
            //     raw: volume,
            //     dB: dbValue,
            //     samplerExists: !!this.pianoSampler
            // });

            if (this.pianoSampler && this.pianoSampler.volume) {
                this.pianoSampler.volume.value = dbValue;
            } else {
                console.warn('⚠️ Impossible de changer le volume - sampler non prêt');
            }

            // USER FIX: Also adjust master volume which affects metronome
            // Scale metronome proportionally with main volume
            this.setMasterVolume(volume * 100);
        }

        // MIDI Sustain Pedal Control (CC64)
        setSustainPedal(isDown) {
            this.sustainPedal = isDown;

            // Si pédale relâchée, arrêter toutes les notes sustain
            if (!isDown && this.activeNotes.size > 0) {
                this.activeNotes.forEach((noteData, midi) => {
                    this.releaseNote(midi);
                });
                this.activeNotes.clear();
            }
        }

        // Fonction pour sons UI (feedback correct/incorrect/achievement)
        playSound(type) {
            // Sons UI désactivés pour version actuelle
            return;
        }

        // Play note by MIDI number (21-108) - SONS TRÈS COURTS
        playNote(midi, duration = 0.15) { // OPTIMISÉ: 0.15s (150ms) pour son piano naturel et réaliste
            if (!this.pianoSampler || !this.isReady) {
                return;
            }

            // Reprendre contexte si nécessaire
            if (Tone.context.state !== 'running') {
                Tone.context.resume();
            }

            const note = this.MIDI_NOTES[midi];
            if (!note) {
                console.warn('Note MIDI inconnue:', midi);
                return;
            }

            try {
                // TOUJOURS utiliser triggerAttackRelease pour sons courts
                // La pédale sustain est gérée séparément par MIDI
                this.pianoSampler.triggerAttackRelease(note, duration);

            } catch (error) {
                console.error('❌ Erreur lecture note:', error);
            }
        }

        releaseNote(midi) {
            // Relâcher note sustain (si pédale enfoncée)
            const noteData = this.activeNotes.get(midi);
            if (noteData && this.pianoSampler) {
                try {
                    // USER FIX: Check if the sampler supports triggerRelease
                    // PluckSynth doesn't support triggerRelease in the same way
                    if (typeof this.pianoSampler.triggerRelease === 'function') {
                        // Only call triggerRelease for Sampler and PolySynth
                        // Skip for PluckSynth which throws errors
                        if (this.pianoSampler.name !== 'PluckSynth') {
                            this.pianoSampler.triggerRelease(noteData.note, Tone.now());
                        }
                    }
                    this.activeNotes.delete(midi);
                } catch (error) {
                    // Silently ignore release errors - not critical
                    this.activeNotes.delete(midi);
                }
            }
        }

        /**
         * USER FIX: Play note with attack only (no auto-release)
         * Note will be released when releaseNote() is called (on key release)
         * This is the default behavior when sustain pedal is OFF
         */
        playNoteAttack(midi, velocity = 127) {
            if (!this.pianoSampler || !this.isReady) return;

            if (Tone.context.state !== 'running') {
                Tone.context.resume();
            }

            const note = this.MIDI_NOTES[midi];
            if (!note) return;

            try {
                const normalizedVelocity = Math.min(1, velocity / 127);
                this.pianoSampler.triggerAttack(note, Tone.now(), normalizedVelocity);
                // Store active note for later release
                this.activeNotes.set(midi, { note: note, timestamp: Date.now() });

                // Safety: auto-release after 10 seconds to prevent stuck notes
                setTimeout(() => {
                    if (this.activeNotes.has(midi)) {
                        this.releaseNote(midi);
                    }
                }, 10000);
            } catch (error) {
                // Fallback: use triggerAttackRelease with fixed duration
                try {
                    this.pianoSampler.triggerAttackRelease(note, 0.3);
                } catch (e) { /* ignore */ }
            }
        }

        /**
         * USER FIX: Play note with sustain (will ring until pedal is released)
         * Used when sustain pedal is ON
         */
        playNoteWithSustain(midi, velocity = 127) {
            // Same as playNoteAttack - the difference is in how releaseNote handles it
            this.playNoteAttack(midi, velocity);
        }

        /**
         * USER FIX: Release ALL sustained notes
         * Called when sustain pedal is released
         */
        releaseAllNotes() {
            if (!this.pianoSampler) return;

            try {
                // For PolySynth: releaseAll() releases everything at once
                if (typeof this.pianoSampler.releaseAll === 'function') {
                    this.pianoSampler.releaseAll(Tone.now());
                } else {
                    // For Sampler: release each note individually
                    this.activeNotes.forEach((noteData, midi) => {
                        try {
                            this.pianoSampler.triggerRelease(noteData.note, Tone.now());
                        } catch (e) { /* ignore individual release errors */ }
                    });
                }
            } catch (error) {
                // Safety: if all else fails, try to silence output
                try {
                    if (this.pianoSampler.volume) {
                        this.pianoSampler.volume.value = -Infinity;
                        setTimeout(() => {
                            if (this.pianoSampler && this.pianoSampler.volume) {
                                this.pianoSampler.volume.value = this.volumeToDb(this.currentVolume);
                            }
                        }, 50);
                    }
                } catch (e) { /* last resort failed */ }
            }
            this.activeNotes.clear();
        }

        playMetronomeTick(isDownbeat) {
            // USER FIX: Louder metronome with deep, clear click sound
            if (!this.metronomeSynth) {
                // Use simple Synth with triangle wave for clear, percussive click
                this.metronomeSynth = new Tone.Synth({
                    oscillator: {
                        type: 'triangle'  // Clear, percussive triangle wave
                    },
                    envelope: {
                        attack: 0.001,
                        decay: 0.1,
                        sustain: 0,
                        release: 0.08
                    }
                }).toDestination();

                // USER FIX: Increased volume - louder than piano (-5dB vs -15dB)
                this.metronomeVolume = -5;
                this.metronomeSynth.volume.value = this.metronomeVolume;
            }

            // Apply current volume
            if (this.metronomeVolume !== undefined) {
                this.metronomeSynth.volume.value = this.metronomeVolume;
            }

            // USER FIX: Clear, audible tones - higher notes for better distinction
            // Downbeat: louder and higher pitch for clear beat 1
            const note = isDownbeat ? 'G4' : 'C4';  // Higher, clearer notes
            const velocityBoost = isDownbeat ? 6 : 0;  // More boost for downbeat

            // Temporarily boost for downbeat
            const originalVol = this.metronomeSynth.volume.value;
            this.metronomeSynth.volume.value = originalVol + velocityBoost;
            this.metronomeSynth.triggerAttackRelease(note, '32n', Tone.now());

            // Reset volume
            setTimeout(() => {
                if (this.metronomeSynth) {
                    this.metronomeSynth.volume.value = originalVol;
                }
            }, 50);
        }

        stopMetronome() {
            // Stop the metronome timer if running (uses setTimeout now, not setInterval)
            if (this.metronomeInterval) {
                clearTimeout(this.metronomeInterval);
                this.metronomeInterval = null;
            }
        }

        // Drift-correcting metronome — perfectly regular ticking
        // Uses self-adjusting setTimeout instead of setInterval to prevent cumulative drift
        startMetronomeIndependent(tempo) {
            this.stopMetronome();  // Clear any existing

            const beatDuration = 60000 / tempo;  // ms per beat
            let beat = 0;
            let expectedTime = performance.now();

            // Play first tick immediately
            this.playMetronomeTick(true);
            expectedTime += beatDuration;

            const tick = () => {
                if (!this.metronomeInterval) return;  // Stopped
                beat = (beat + 1) % 4;
                this.playMetronomeTick(beat === 0);

                // Calculate drift and correct next tick timing
                expectedTime += beatDuration;
                const now = performance.now();
                const drift = now - expectedTime;
                const nextDelay = Math.max(1, beatDuration - drift);

                this.metronomeInterval = setTimeout(tick, nextDelay);
            };

            this.metronomeInterval = setTimeout(tick, beatDuration);
        }

        setMetronomeVolume(value) {
            // USER FIX: value is 0-1, convert to dB
            // Range from -20dB to +5dB for loud, audible metronome
            this.metronomeVolume = (value * 25) - 20;
            if (this.metronomeSynth) {
                this.metronomeSynth.volume.value = this.metronomeVolume;
            }
        }

        // USER FIX: Link metronome to main volume control
        setMasterVolume(value) {
            // value is 0-100
            if (Tone.Destination) {
                // Convert to dB: 0 = -60dB, 100 = 0dB
                const db = (value / 100) * 60 - 60;
                Tone.Destination.volume.value = Math.max(-60, db);
            }
        }

        setPianoSound(sound) {
            // Switch between different instrument sounds
            this.loadSound(sound);
        }

        loadCustomSound(url) {
            // Not implemented yet
        }

        pauseAll() {
            // Pause is handled by the engine stopping updates
        }

        stopAll() {
            // Stop all notes - with triggerAttackRelease, notes auto-release
        }
    }
    
    /**
     * Note Generator Class
     */
    class NoteGenerator {
        constructor(engine) {
            this.engine = engine;

            // CRITICAL: Validate all rhythm patterns add up to 4 beats (4/4 time)
            this.validateRhythmPatterns();
        }
        
        generate() {
            const settings = this.engine.userSettings;
            const difficulty = this.engine.config.difficulties[settings.difficulty];
            const genType = settings.generator_type || 'random';

            // Built-in generators — unified dispatch
            let notes;
            switch (genType) {
                case 'triads':
                    notes = this.generateTriads();
                    break;
                case 'scales':
                    notes = this.generateScales();
                    break;
                case 'progression':
                    notes = this.generateProgression();
                    break;
                case 'chords':
                    notes = this.generateChordExercise();
                    break;
                case 'arpeggios':
                    notes = this.generateArpeggios();
                    break;
                case 'random':
                default:
                    // UNIFIED: randomly pick between all exercise types + built-in songs
                    notes = this._generateUnifiedRandom();
                    break;
            }

            // POST-PROCESS: snap all beats to sixteenth-note grid to eliminate floating-point drift
            notes.forEach(n => { if (n.beat !== undefined) n.beat = snapBeat(n.beat); });

            // POST-PROCESS: enforce no-repeat rule (max 3 consecutive same notes)
            notes = this._enforceNoRepeatRule(notes, 3);

            // Normalize chord durations: notes on same staff+measure+beat must have same duration
            notes = this._normalizeChordDurations(notes);

            return notes;
        }

        /**
         * UNIFIED RANDOM GENERATOR
         * Randomly selects from ALL exercise types AND built-in songs,
         * weighted by difficulty level. This merges songs + chord generators.
         */
        _generateUnifiedRandom() {
            const difficulty = this.engine.userSettings.difficulty || 'beginner';

            // Exercise type weights by difficulty (higher = more likely)
            const typeWeights = {
                'beginner': {
                    melody: 30, scales: 15, triads: 10, chords: 10,
                    arpeggios: 5, progression: 10, song: 20
                },
                'elementary': {
                    melody: 25, scales: 15, triads: 10, chords: 10,
                    arpeggios: 10, progression: 10, song: 20
                },
                'intermediate': {
                    melody: 15, scales: 15, triads: 10, chords: 15,
                    arpeggios: 15, progression: 10, song: 20
                },
                'advanced': {
                    melody: 10, scales: 10, triads: 10, chords: 15,
                    arpeggios: 15, progression: 15, song: 25
                },
                'expert': {
                    melody: 10, scales: 10, triads: 5, chords: 15,
                    arpeggios: 15, progression: 15, song: 30
                }
            };

            const weights = typeWeights[difficulty] || typeWeights['beginner'];
            const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
            let r = Math.random() * totalWeight;

            let selectedType = 'melody';
            for (const [type, weight] of Object.entries(weights)) {
                r -= weight;
                if (r <= 0) { selectedType = type; break; }
            }

            switch (selectedType) {
                case 'scales': return this.generateScales();
                case 'triads': return this.generateTriads();
                case 'chords': return this.generateChordExercise();
                case 'arpeggios': return this.generateArpeggios();
                case 'progression': return this.generateProgression();
                case 'song': return this.generateBuiltInSong();
                case 'melody':
                default: return this.generateRandom();
            }
        }

        /**
         * BUILT-IN SONGS — hand-crafted musical pieces adapted to difficulty.
         * Each song is a template of scale-degree + rhythm, transposed to the current key.
         */
        generateBuiltInSong() {
            const settings = this.engine.userSettings;
            const keySignature = settings.key_signature || 'C';
            const difficulty = settings.difficulty || 'beginner';
            const range = this.getEffectiveRange();
            const handsCount = range.handsCount;
            const scale = this.getScaleForKey(keySignature);
            const trebleScale = scale.filter(m => m >= range.trebleMin && m <= range.trebleMax);
            if (trebleScale.length === 0) return this.generateRandom();

            // Songs defined as arrays of { deg, dur, rest? }
            // deg = scale degree index (0=root, 1=2nd, etc.), dur = duration string
            const songTemplates = {
                'beginner': [
                    // "Twinkle" rhythm pattern
                    { name: 'Starlight', pattern: [
                        {d:0,dur:'quarter'},{d:0,dur:'quarter'},{d:4,dur:'quarter'},{d:4,dur:'quarter'},
                        {d:5,dur:'quarter'},{d:5,dur:'quarter'},{d:4,dur:'half'},
                        {d:3,dur:'quarter'},{d:3,dur:'quarter'},{d:2,dur:'quarter'},{d:2,dur:'quarter'},
                        {d:1,dur:'quarter'},{d:1,dur:'quarter'},{d:0,dur:'half'},
                    ]},
                    // Simple ascending/descending melody
                    { name: 'Steps', pattern: [
                        {d:0,dur:'quarter'},{d:1,dur:'quarter'},{d:2,dur:'quarter'},{d:3,dur:'quarter'},
                        {d:4,dur:'half'},{d:3,dur:'half'},
                        {d:2,dur:'quarter'},{d:1,dur:'quarter'},{d:0,dur:'half'},{rest:true,dur:'half'},
                    ]},
                    // Repeated note + step pattern
                    { name: 'March', pattern: [
                        {d:0,dur:'quarter'},{d:0,dur:'quarter'},{d:2,dur:'quarter'},{d:0,dur:'quarter'},
                        {d:4,dur:'half'},{d:2,dur:'half'},
                        {d:0,dur:'quarter'},{d:4,dur:'quarter'},{d:2,dur:'quarter'},{d:0,dur:'quarter'},
                        {d:1,dur:'whole'},
                    ]},
                ],
                'elementary': [
                    // Waltz-like melody
                    { name: 'Waltz', pattern: [
                        {d:0,dur:'half'},{d:2,dur:'quarter'},
                        {d:4,dur:'half'},{d:2,dur:'quarter'},
                        {d:3,dur:'quarter'},{d:4,dur:'quarter'},{d:5,dur:'quarter'},
                        {d:4,dur:'dotted-half'},
                        {d:6,dur:'half'},{d:4,dur:'quarter'},
                        {d:2,dur:'half'},{d:0,dur:'quarter'},
                        {d:1,dur:'quarter'},{d:2,dur:'quarter'},{d:0,dur:'quarter'},
                        {d:0,dur:'dotted-half'},
                    ]},
                    // Melodic jump pattern
                    { name: 'Leaps', pattern: [
                        {d:0,dur:'quarter'},{d:4,dur:'quarter'},{d:2,dur:'quarter'},{d:6,dur:'quarter'},
                        {d:4,dur:'half'},{rest:true,dur:'quarter'},{d:3,dur:'quarter'},
                        {d:5,dur:'quarter'},{d:3,dur:'quarter'},{d:1,dur:'quarter'},{d:4,dur:'quarter'},
                        {d:2,dur:'half'},{d:0,dur:'half'},
                    ]},
                ],
                'intermediate': [
                    // Syncopated rhythm
                    { name: 'Swing', pattern: [
                        {d:0,dur:'eighth'},{d:2,dur:'eighth'},{d:4,dur:'quarter'},{d:6,dur:'quarter'},{rest:true,dur:'quarter'},
                        {d:5,dur:'eighth'},{d:4,dur:'eighth'},{d:2,dur:'quarter'},{d:0,dur:'half'},
                        {d:7,dur:'quarter'},{d:6,dur:'eighth'},{d:5,dur:'eighth'},{d:4,dur:'quarter'},{d:2,dur:'quarter'},
                        {d:0,dur:'half'},{rest:true,dur:'half'},
                    ]},
                    // Running eighths
                    { name: 'Stream', pattern: [
                        {d:0,dur:'eighth'},{d:1,dur:'eighth'},{d:2,dur:'eighth'},{d:3,dur:'eighth'},
                        {d:4,dur:'eighth'},{d:5,dur:'eighth'},{d:6,dur:'eighth'},{d:7,dur:'eighth'},
                        {d:7,dur:'eighth'},{d:6,dur:'eighth'},{d:5,dur:'eighth'},{d:4,dur:'eighth'},
                        {d:3,dur:'quarter'},{d:2,dur:'quarter'},
                        {d:1,dur:'eighth'},{d:0,dur:'eighth'},{d:2,dur:'eighth'},{d:4,dur:'eighth'},
                        {d:0,dur:'half'},{rest:true,dur:'half'},
                    ]},
                ],
                'advanced': [
                    // Compound melody with wide intervals
                    { name: 'Nocturne', pattern: [
                        {d:0,dur:'eighth'},{d:4,dur:'eighth'},{d:7,dur:'eighth'},{d:4,dur:'eighth'},
                        {d:0,dur:'eighth'},{d:5,dur:'eighth'},{d:7,dur:'eighth'},{d:5,dur:'eighth'},
                        {d:1,dur:'eighth'},{d:4,dur:'eighth'},{d:6,dur:'eighth'},{d:4,dur:'eighth'},
                        {d:0,dur:'quarter'},{rest:true,dur:'quarter'},{d:7,dur:'half'},
                        {d:6,dur:'eighth'},{d:5,dur:'eighth'},{d:4,dur:'eighth'},{d:2,dur:'eighth'},
                        {d:0,dur:'whole'},
                    ]},
                    // Dotted rhythm pattern
                    { name: 'Fanfare', pattern: [
                        {d:0,dur:'dotted-quarter'},{d:2,dur:'eighth'},{d:4,dur:'dotted-quarter'},{d:6,dur:'eighth'},
                        {d:7,dur:'half'},{d:4,dur:'half'},
                        {d:5,dur:'dotted-quarter'},{d:4,dur:'eighth'},{d:2,dur:'dotted-quarter'},{d:0,dur:'eighth'},
                        {d:0,dur:'whole'},
                    ]},
                ],
                'expert': [
                    // Fast chromatic-adjacent run
                    { name: 'Etude', pattern: [
                        {d:0,dur:'sixteenth'},{d:1,dur:'sixteenth'},{d:2,dur:'sixteenth'},{d:3,dur:'sixteenth'},
                        {d:4,dur:'sixteenth'},{d:5,dur:'sixteenth'},{d:6,dur:'sixteenth'},{d:7,dur:'sixteenth'},
                        {d:7,dur:'eighth'},{d:6,dur:'eighth'},{d:4,dur:'eighth'},{d:2,dur:'eighth'},
                        {d:0,dur:'eighth'},{d:4,dur:'eighth'},{d:7,dur:'quarter'},
                        {d:7,dur:'sixteenth'},{d:6,dur:'sixteenth'},{d:5,dur:'sixteenth'},{d:4,dur:'sixteenth'},
                        {d:3,dur:'sixteenth'},{d:2,dur:'sixteenth'},{d:1,dur:'sixteenth'},{d:0,dur:'sixteenth'},
                        {d:0,dur:'half'},{rest:true,dur:'half'},
                    ]},
                ]
            };

            // Pick songs from current difficulty AND adjacent easier difficulty
            const allDiffs = ['beginner', 'elementary', 'intermediate', 'advanced', 'expert'];
            const diffIdx = allDiffs.indexOf(difficulty);
            const candidates = [];
            for (let i = Math.max(0, diffIdx - 1); i <= diffIdx; i++) {
                const songs = songTemplates[allDiffs[i]];
                if (songs) candidates.push(...songs);
            }
            if (candidates.length === 0) return this.generateRandom();

            const song = candidates[Math.floor(Math.random() * candidates.length)];
            const notes = [];
            const baseOctave = trebleScale[Math.floor(trebleScale.length / 3)]; // Start low-ish

            let measure = 0;
            let beat = 0;
            const beatsPerMeasure = 4;

            song.pattern.forEach(item => {
                const durBeats = this.getDurationBeats(item.dur);

                if (item.rest) {
                    notes.push({
                        midi: null, duration: item.dur, measure, beat,
                        staff: 'treble', isRest: true
                    });
                } else {
                    // Map scale degree to MIDI note
                    const degIdx = item.d % trebleScale.length;
                    const octaveShift = Math.floor(item.d / trebleScale.length) * 12;
                    let midi = trebleScale[degIdx] + octaveShift;

                    // Clamp to range
                    while (midi > range.trebleMax) midi -= 12;
                    while (midi < range.trebleMin) midi += 12;

                    notes.push({
                        midi, duration: item.dur, measure, beat,
                        staff: midi >= 60 ? 'treble' : 'bass',
                        accidental: this.getAccidental(midi, keySignature)
                    });
                }

                beat += durBeats;
                while (beat >= beatsPerMeasure) {
                    beat -= beatsPerMeasure;
                    measure++;
                }
            });

            // Add simple bass for 2 hands
            if (handsCount === 2) {
                const bassScale = scale.filter(m => m >= range.bassMin && m <= range.bassMax);
                if (bassScale.length > 0) {
                    const totalMeasures = measure + (beat > 0 ? 1 : 0);
                    for (let m = 0; m < totalMeasures; m++) {
                        const bassRoot = bassScale[Math.floor(Math.random() * bassScale.length)];
                        notes.push({
                            midi: bassRoot, duration: 'half', measure: m, beat: 0,
                            staff: 'bass', twoHands: true,
                            accidental: this.getAccidental(bassRoot, keySignature)
                        });
                        const bassFifth = bassScale[Math.min(bassScale.indexOf(bassRoot) + 4, bassScale.length - 1)];
                        notes.push({
                            midi: bassFifth, duration: 'half', measure: m, beat: 2,
                            staff: 'bass', twoHands: true,
                            accidental: this.getAccidental(bassFifth, keySignature)
                        });
                    }
                }
            }

            return notes;
        }

        /**
         * Enforce no-repeat rule: no note should repeat more than maxRepeat times consecutively.
         * Shifts repeated notes by a scale step to create melodic interest.
         */
        _enforceNoRepeatRule(notes, maxRepeat) {
            if (!notes || notes.length < 2) return notes;

            // Build scale for key-aware shifting
            const keySignature = this.engine.userSettings.key_signature || 'C';
            const scale = this.getScaleForKey(keySignature);

            let consecutiveCount = 1;
            let lastMidi = null;

            for (let i = 0; i < notes.length; i++) {
                const note = notes[i];
                if (note.isRest || !note.midi) {
                    lastMidi = null;
                    consecutiveCount = 1;
                    continue;
                }

                if (note.midi === lastMidi) {
                    consecutiveCount++;
                    if (consecutiveCount > maxRepeat) {
                        // Shift by scale degree (not semitones) to stay in key
                        const dir = Math.random() < 0.5 ? 1 : -1;
                        // Find nearest scale note above or below
                        const nearestUp = scale.find(m => m > note.midi);
                        const nearestDown = scale.slice().reverse().find(m => m < note.midi);
                        if (dir > 0 && nearestUp) {
                            note.midi = nearestUp;
                        } else if (dir < 0 && nearestDown) {
                            note.midi = nearestDown;
                        } else if (nearestUp) {
                            note.midi = nearestUp;
                        } else if (nearestDown) {
                            note.midi = nearestDown;
                        }
                        note.staff = note.midi >= 60 ? 'treble' : 'bass';
                        note.accidental = this.getAccidental(note.midi, keySignature);
                        consecutiveCount = 1;
                    }
                } else {
                    consecutiveCount = 1;
                }
                lastMidi = note.midi;
            }

            return notes;
        }

        /**
         * Normalize chord durations: notes on same staff+measure+beat must have same duration.
         * Uses longest duration in each group — chord notes sustain together.
         */
        _normalizeChordDurations(notes) {
            if (!notes || notes.length < 2) return notes;

            const durOrder = ['thirty-second', 'sixteenth', 'eighth', 'dotted-eighth', 'quarter', 'dotted-quarter', 'half', 'dotted-half', 'whole'];

            // Group by staff+measure+beat (snapped to sixteenth grid)
            const groups = new Map();
            notes.forEach((note, idx) => {
                if (note.isRest || note.midi === null) return;
                const staff = note.staff || (note.midi >= 60 ? 'treble' : 'bass');
                const key = `${note.measure}-${snapBeat(note.beat)}-${staff}`;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(idx);
            });

            // For each group with >1 note, normalize to LONGEST duration
            // (chord notes should sustain together, not be cut short)
            groups.forEach(indices => {
                if (indices.length <= 1) return;
                let longestIdx = -1;
                indices.forEach(i => {
                    const idx = durOrder.indexOf(notes[i].duration);
                    if (idx > longestIdx) longestIdx = idx;
                });
                if (longestIdx >= 0) {
                    const uniformDur = durOrder[longestIdx];
                    indices.forEach(i => { notes[i].duration = uniformDur; });
                }
            });

            return notes;
        }

        _getMeasureCount(difficulty) {
            const diffConfig = this.engine.config.difficulties?.[difficulty];
            return diffConfig?.measures || 4;
        }

        generateRandom() {
            // MIXED CONTENT: Generate a piece with varied musical content
            // All in the same key for harmonic coherence
            const difficulty = this.engine.userSettings.difficulty || 'elementary';
            const diffConfig = this.engine.config.difficulties?.[difficulty] || {};
            const settings = this.engine.userSettings;
            const range = this.getEffectiveRange();
            const keySignature = settings.key_signature || 'C';
            const scale = this.getScaleForKey(keySignature);
            const measureCount = diffConfig.measures || 4;
            const notesPerChord = Math.min(parseInt(settings.notes_count) || 1, 5);
            const allowedNoteTypes = diffConfig.note_types || ['whole', 'half', 'quarter'];
            const handsCount = range.handsCount;

            const trebleScale = scale.filter(m => m >= range.trebleMin && m <= range.trebleMax);
            if (trebleScale.length === 0) return this.generateRandomNotes();
            const bassScale = scale.filter(m => m >= range.bassMin && m <= range.bassMax);

            // Use section types from difficulty config (if defined), else fallback
            const available = diffConfig.section_types || ['melody', 'melody', 'stepwise'];
            const notes = [];
            let currentMeasure = 0;
            // Start melody index at a comfortable middle position
            let melodyIdx = Math.floor(trebleScale.length * 0.4);

            // Use rotation to guarantee variety instead of pure random
            let sectionRotation = 0;

            while (currentMeasure < measureCount) {
                // Rotate through section types to ensure variety
                const sectionType = available[sectionRotation % available.length];
                sectionRotation++;

                // Each section is exactly 1 measure for beginner/elementary, 1-2 for others
                const sectionLen = Math.min(
                    (difficulty === 'beginner' || difficulty === 'elementary') ? 1 : Math.floor(Math.random() * 2) + 1,
                    measureCount - currentMeasure
                );

                for (let m = 0; m < sectionLen; m++) {
                    const measure = currentMeasure + m;
                    const result = this._generateSection(sectionType, measure, trebleScale, bassScale, melodyIdx, {
                        allowedNoteTypes, notesPerChord, handsCount, keySignature, difficulty, range, diffConfig
                    });
                    notes.push(...result.notes);
                    melodyIdx = result.endIdx;
                }
                currentMeasure += sectionLen;
            }

            return notes;
        }

        /**
         * Generate a single measure of a specific section type
         * Returns { notes: [], endIdx: number }
         *
         * ENHANCED: Musically coherent generation with proper bass accompaniment patterns,
         * difficulty-aware content, and harmonic consistency.
         */
        _generateSection(type, measure, trebleScale, bassScale, startIdx, opts) {
            const notes = [];
            const { allowedNoteTypes, notesPerChord, handsCount, keySignature, difficulty, range, diffConfig } = opts;
            let idx = Math.max(0, Math.min(trebleScale.length - 1, startIdx));
            const maxInterval = (diffConfig && diffConfig.max_interval) || 7;

            // Clamp step size based on difficulty max_interval (in scale degrees)
            const maxStep = Math.min(Math.ceil(maxInterval / 2), 6);

            // MUSICAL BASS ACCOMPANIMENT PATTERNS
            // Different patterns for different section types, all diatonic to the key
            const addBassPattern = (patternType) => {
                if (handsCount < 2 || bassScale.length === 0) return;
                // Map treble position to a corresponding bass position (root of implied harmony)
                const harmonyRoot = Math.max(0, Math.min(bassScale.length - 1,
                    Math.floor((idx / trebleScale.length) * bassScale.length)));

                switch (patternType) {
                    case 'whole': {
                        // Simple whole note bass — for beginner/elementary
                        notes.push({
                            midi: bassScale[harmonyRoot], duration: 'whole', measure, beat: 0,
                            staff: 'bass', accidental: this.getAccidental(bassScale[harmonyRoot], keySignature), twoHands: true
                        });
                        break;
                    }
                    case 'half': {
                        // Two half notes: root + 5th (or root + root)
                        const fifth = Math.min(harmonyRoot + 4, bassScale.length - 1);
                        notes.push({
                            midi: bassScale[harmonyRoot], duration: 'half', measure, beat: 0,
                            staff: 'bass', accidental: this.getAccidental(bassScale[harmonyRoot], keySignature), twoHands: true
                        });
                        notes.push({
                            midi: bassScale[fifth], duration: 'half', measure, beat: 2,
                            staff: 'bass', accidental: this.getAccidental(bassScale[fifth], keySignature), twoHands: true
                        });
                        break;
                    }
                    case 'alberti': {
                        // Alberti bass: root-5th-3rd-5th pattern (quarter notes)
                        const root = harmonyRoot;
                        const third = Math.min(root + 2, bassScale.length - 1);
                        const fifth = Math.min(root + 4, bassScale.length - 1);
                        const pattern = [root, fifth, third, fifth];
                        const dur = allowedNoteTypes.includes('quarter') ? 'quarter' : 'half';
                        const count = dur === 'quarter' ? 4 : 2;
                        for (let i = 0; i < count; i++) {
                            const bIdx = pattern[i % pattern.length];
                            notes.push({
                                midi: bassScale[bIdx], duration: dur, measure, beat: i * this.getDurationBeats(dur),
                                staff: 'bass', accidental: this.getAccidental(bassScale[bIdx], keySignature), twoHands: true
                            });
                        }
                        break;
                    }
                    case 'walking': {
                        // Walking bass: stepwise motion in quarter notes
                        const dur = 'quarter';
                        let bIdx = harmonyRoot;
                        const dir = Math.random() < 0.5 ? 1 : -1;
                        for (let i = 0; i < 4; i++) {
                            bIdx = Math.max(0, Math.min(bassScale.length - 1, bIdx + dir));
                            notes.push({
                                midi: bassScale[bIdx], duration: dur, measure, beat: i,
                                staff: 'bass', accidental: this.getAccidental(bassScale[bIdx], keySignature), twoHands: true
                            });
                        }
                        break;
                    }
                    case 'chord': {
                        // Bass chord (root + 3rd or root + 5th)
                        const bRoot = harmonyRoot;
                        const bThird = Math.min(bRoot + 2, bassScale.length - 1);
                        const dur = 'half';
                        [0, 2].forEach(beat => {
                            notes.push({
                                midi: bassScale[bRoot], duration: dur, measure, beat,
                                staff: 'bass', accidental: this.getAccidental(bassScale[bRoot], keySignature), twoHands: true, isChord: true
                            });
                            notes.push({
                                midi: bassScale[bThird], duration: dur, measure, beat,
                                staff: 'bass', accidental: this.getAccidental(bassScale[bThird], keySignature), twoHands: true, isChord: true
                            });
                        });
                        break;
                    }
                    case 'beginner_alternating': {
                        // BEGINNER: Bass notes on COMPLETELY DIFFERENT beats than treble notes
                        // Collect ALL treble beat ranges in this measure (including duration spans)
                        const trebleBeatRanges = [];
                        notes.forEach(n => {
                            if (n.measure === measure && n.staff === 'treble' && !n.isRest) {
                                const beat = snapBeat(n.beat);
                                // Calculate how many beats this note occupies
                                const durBeats = { 'whole': 4, 'dotted-half': 3, 'half': 2, 'dotted-quarter': 1.5, 'quarter': 1, 'eighth': 0.5, 'sixteenth': 0.25 };
                                const span = durBeats[n.duration] || 1;
                                trebleBeatRanges.push({ start: beat, end: beat + span });
                            }
                        });

                        // Check if a beat overlaps with any treble note range
                        const overlaps = (b, dur) => {
                            const bEnd = b + dur;
                            return trebleBeatRanges.some(r => b < r.end && bEnd > r.start);
                        };

                        // Try to place a single whole note on beat 0 if treble is silent there
                        if (!overlaps(0, 4) && trebleBeatRanges.length === 0) {
                            notes.push({
                                midi: bassScale[harmonyRoot], duration: 'whole', measure, beat: 0,
                                staff: 'bass', accidental: this.getAccidental(bassScale[harmonyRoot], keySignature), twoHands: true
                            });
                        } else {
                            // Try half notes on beats 0 and 2
                            [0, 2].forEach(beat => {
                                if (!overlaps(beat, 2)) {
                                    notes.push({
                                        midi: bassScale[harmonyRoot], duration: 'half', measure, beat,
                                        staff: 'bass', accidental: this.getAccidental(bassScale[harmonyRoot], keySignature), twoHands: true
                                    });
                                }
                            });
                        }
                        // If all beats overlap with treble, skip bass entirely for this measure
                        break;
                    }
                    default: {
                        // Simple whole note
                        notes.push({
                            midi: bassScale[harmonyRoot], duration: 'whole', measure, beat: 0,
                            staff: 'bass', accidental: this.getAccidental(bassScale[harmonyRoot], keySignature), twoHands: true
                        });
                    }
                }
            };

            // Choose appropriate bass pattern based on difficulty and section type
            const getBassPattern = (sectionType) => {
                if (difficulty === 'beginner') return 'beginner_alternating';
                if (difficulty === 'elementary') return sectionType === 'stepwise' ? 'whole' : 'half';
                if (difficulty === 'intermediate') {
                    if (sectionType === 'chord_passage') return 'half';
                    if (sectionType === 'arpeggio_melody') return 'alberti';
                    return Math.random() < 0.5 ? 'half' : 'whole';
                }
                // Advanced/Expert: more complex patterns
                const patterns = ['half', 'alberti', 'walking', 'chord'];
                return patterns[Math.floor(Math.random() * patterns.length)];
            };

            switch (type) {
                case 'melody': {
                    // Simple melody with controlled step sizes based on difficulty
                    const durations = this._pickMeasureDurations(allowedNoteTypes);
                    let beat = 0;
                    durations.forEach(dur => {
                        // Step size limited by difficulty's max_interval
                        const range = Math.min(maxStep, 2);
                        const step = Math.floor(Math.random() * (range * 2 + 1)) - range;
                        idx = Math.max(0, Math.min(trebleScale.length - 1, idx + step));
                        notes.push({
                            midi: trebleScale[idx], duration: dur, measure, beat,
                            staff: 'treble', accidental: this.getAccidental(trebleScale[idx], keySignature)
                        });
                        beat += this.getDurationBeats(dur);
                    });
                    addBassPattern(getBassPattern('melody'));
                    break;
                }
                case 'stepwise': {
                    // Stepwise motion: notes move up or down by one scale step
                    const dir = Math.random() < 0.5 ? 1 : -1;
                    // Use quarter notes for elementary+, half for beginner
                    const dur = allowedNoteTypes.includes('quarter') ? 'quarter' :
                                allowedNoteTypes.includes('half') ? 'half' : 'whole';
                    const beatVal = this.getDurationBeats(dur);
                    const count = Math.floor(4 / beatVal);
                    for (let i = 0; i < count; i++) {
                        // Reverse direction at scale boundaries to stay in range
                        if (idx + dir < 0 || idx + dir >= trebleScale.length) {
                            // Reverse direction
                            idx = Math.max(0, Math.min(trebleScale.length - 1, idx - dir));
                        } else {
                            idx = idx + dir;
                        }
                        notes.push({
                            midi: trebleScale[idx], duration: dur, measure, beat: i * beatVal,
                            staff: 'treble', accidental: this.getAccidental(trebleScale[idx], keySignature)
                        });
                    }
                    addBassPattern(getBassPattern('stepwise'));
                    break;
                }
                case 'arpeggio_melody': {
                    // Broken chord pattern: root-3rd-5th-octave (or root-3rd-5th-3rd)
                    const chordRoot = Math.max(0, Math.min(trebleScale.length - 5, idx));
                    const arpPattern = Math.random() < 0.5
                        ? [0, 2, 4, 2]     // root-3rd-5th-3rd
                        : [0, 2, 4, 7];    // root-3rd-5th-octave
                    const dur = allowedNoteTypes.includes('quarter') ? 'quarter' :
                                allowedNoteTypes.includes('half') ? 'half' : 'whole';
                    const beatVal = this.getDurationBeats(dur);
                    const beatsAvail = Math.floor(4 / beatVal);
                    let beat = 0;
                    for (let i = 0; i < beatsAvail && beat < 4; i++) {
                        const noteIdx = Math.min(chordRoot + arpPattern[i % arpPattern.length], trebleScale.length - 1);
                        notes.push({
                            midi: trebleScale[noteIdx], duration: dur, measure, beat,
                            staff: 'treble', accidental: this.getAccidental(trebleScale[noteIdx], keySignature)
                        });
                        beat += beatVal;
                    }
                    idx = Math.min(chordRoot + 4, trebleScale.length - 1);
                    addBassPattern(getBassPattern('arpeggio_melody'));
                    break;
                }
                case 'chord_passage': {
                    // Diatonic chords with rhythm
                    const cappedChord = Math.min(notesPerChord, 5);
                    if (cappedChord <= 1) {
                        return this._generateSection('melody', measure, trebleScale, bassScale, startIdx, opts);
                    }
                    const dur = allowedNoteTypes.includes('half') ? 'half' : 'quarter';
                    const chordsPerMeasure = Math.floor(4 / this.getDurationBeats(dur));
                    for (let c = 0; c < chordsPerMeasure; c++) {
                        const beat = c * this.getDurationBeats(dur);
                        // Move chord root by small steps (1-2 scale degrees)
                        const step = Math.floor(Math.random() * 3) - 1;
                        idx = Math.max(0, Math.min(trebleScale.length - cappedChord * 2 - 1, idx + step));
                        const chord = this._buildDiatonicChord(trebleScale, idx, cappedChord);
                        chord.forEach((midi, ci) => {
                            notes.push({
                                midi, duration: dur, measure, beat,
                                staff: 'treble', isChord: true, chordIndex: ci,
                                accidental: this.getAccidental(midi, keySignature)
                            });
                        });
                    }
                    addBassPattern(getBassPattern('chord_passage'));
                    break;
                }
                case 'scale_run': {
                    // Scale run up then down (or vice versa) to fill measure
                    let dir = Math.random() < 0.5 ? 1 : -1;
                    const dur = allowedNoteTypes.includes('eighth') ? 'eighth' : 'quarter';
                    const beatVal = this.getDurationBeats(dur);
                    const count = Math.floor(4 / beatVal);
                    for (let i = 0; i < count; i++) {
                        // Bounce at boundaries
                        if (idx + dir < 0 || idx + dir >= trebleScale.length) dir *= -1;
                        idx = Math.max(0, Math.min(trebleScale.length - 1, idx + dir));
                        notes.push({
                            midi: trebleScale[idx], duration: dur, measure, beat: i * beatVal,
                            staff: 'treble', accidental: this.getAccidental(trebleScale[idx], keySignature)
                        });
                    }
                    addBassPattern(getBassPattern('scale_run'));
                    break;
                }
                case 'interval_passage': {
                    // Melodic intervals — leaps bounded by difficulty
                    const dur = 'quarter';
                    for (let i = 0; i < 4; i++) {
                        const jump = Math.floor(Math.random() * Math.min(maxStep, 4)) + 2;
                        const dir = Math.random() < 0.5 ? 1 : -1;
                        idx = Math.max(0, Math.min(trebleScale.length - 1, idx + dir * jump));
                        notes.push({
                            midi: trebleScale[idx], duration: dur, measure, beat: i,
                            staff: 'treble', accidental: this.getAccidental(trebleScale[idx], keySignature)
                        });
                    }
                    addBassPattern(getBassPattern('interval_passage'));
                    break;
                }
                case 'triplet': {
                    // Triplet groupings: 3 notes in the time of 2
                    // Each triplet beat = 2/3 of a quarter note
                    const tripletGroups = Math.random() < 0.5 ? 2 : 4; // 2 or 4 triplet groups per measure
                    const tripletBeatSpan = 4 / tripletGroups; // beats per triplet group
                    const tripletNoteBeat = tripletBeatSpan / 3;
                    let beat = 0;
                    for (let g = 0; g < tripletGroups; g++) {
                        for (let t = 0; t < 3; t++) {
                            const step = Math.floor(Math.random() * 3) - 1;
                            idx = Math.max(0, Math.min(trebleScale.length - 1, idx + step));
                            notes.push({
                                midi: trebleScale[idx], duration: 'eighth', measure, beat,
                                staff: 'treble', _triplet: true,
                                accidental: this.getAccidental(trebleScale[idx], keySignature)
                            });
                            beat += tripletNoteBeat;
                        }
                    }
                    addBassPattern(getBassPattern('melody'));
                    break;
                }
                case 'trill': {
                    // Trill: rapid alternation between two adjacent notes
                    // 2 beats of trill + 2 beats of resolution
                    const trillBase = idx;
                    const trillUpper = Math.min(trebleScale.length - 1, idx + 1);
                    const dur = 'sixteenth';
                    const beatVal = this.getDurationBeats(dur);
                    let beat = 0;
                    // First 2 beats: trill
                    let isFirstTrillNote = true;
                    while (beat < 2) {
                        const isUpper = Math.round(beat / beatVal) % 2 === 1;
                        const noteIdx = isUpper ? trillUpper : trillBase;
                        const trillNote = {
                            midi: trebleScale[noteIdx], duration: dur, measure, beat,
                            staff: 'treble', _trill: true,
                            accidental: this.getAccidental(trebleScale[noteIdx], keySignature)
                        };
                        // Add trill symbol on the first note
                        if (isFirstTrillNote) {
                            trillNote.ornaments = ['trill'];
                            isFirstTrillNote = false;
                        }
                        notes.push(trillNote);
                        beat += beatVal;
                    }
                    // Last 2 beats: resolution (quarter notes stepping down)
                    notes.push({
                        midi: trebleScale[trillUpper], duration: 'quarter', measure, beat: 2,
                        staff: 'treble', accidental: this.getAccidental(trebleScale[trillUpper], keySignature)
                    });
                    idx = Math.max(0, trillBase - 1);
                    notes.push({
                        midi: trebleScale[Math.max(0, idx)], duration: 'quarter', measure, beat: 3,
                        staff: 'treble', accidental: this.getAccidental(trebleScale[Math.max(0, idx)], keySignature)
                    });
                    addBassPattern(getBassPattern('melody'));
                    break;
                }
                case 'octave_passage': {
                    // Octave jumps - great for building hand independence
                    const dur = allowedNoteTypes.includes('eighth') ? 'eighth' : 'quarter';
                    const beatVal = this.getDurationBeats(dur);
                    const count = Math.floor(4 / beatVal);
                    let beat = 0;
                    for (let i = 0; i < count; i++) {
                        const isOctave = i % 2 === 1;
                        const noteIdx = Math.max(0, Math.min(trebleScale.length - 1, idx));
                        const midi = trebleScale[noteIdx];
                        const octaveMidi = isOctave ? midi + 12 : midi;
                        // Only use octave if it's in range
                        const finalMidi = octaveMidi <= 84 ? octaveMidi : midi;
                        notes.push({
                            midi: finalMidi, duration: dur, measure, beat,
                            staff: 'treble', accidental: this.getAccidental(finalMidi, keySignature)
                        });
                        if (i % 4 === 3) {
                            // Move to next scale degree every 4 notes
                            const step = Math.random() < 0.5 ? 1 : -1;
                            idx = Math.max(0, Math.min(trebleScale.length - 1, idx + step));
                        }
                        beat += beatVal;
                    }
                    addBassPattern(getBassPattern('melody'));
                    break;
                }
                case 'dense_chords': {
                    // Thick chords with 3-5 notes, moving by step
                    const chordSize = Math.min(Math.max(3, notesPerChord), 5);
                    const dur = allowedNoteTypes.includes('quarter') ? 'quarter' : 'half';
                    const chordsPerMeasure = Math.floor(4 / this.getDurationBeats(dur));
                    for (let c = 0; c < chordsPerMeasure; c++) {
                        const beat = c * this.getDurationBeats(dur);
                        const step = Math.floor(Math.random() * 3) - 1;
                        idx = Math.max(0, Math.min(trebleScale.length - chordSize * 2 - 1, idx + step));
                        const chord = this._buildDiatonicChord(trebleScale, idx, chordSize);
                        chord.forEach((midi, ci) => {
                            notes.push({
                                midi, duration: dur, measure, beat,
                                staff: 'treble', isChord: true, chordIndex: ci,
                                accidental: this.getAccidental(midi, keySignature)
                            });
                        });
                    }
                    // Also add bass chords for expert
                    if (bassScale.length >= 3 && notesPerChord >= 3) {
                        const bassRoot = Math.floor(bassScale.length * 0.3);
                        const bassChord = this._buildDiatonicChord(bassScale, bassRoot, Math.min(3, chordSize));
                        bassChord.forEach((midi, ci) => {
                            notes.push({
                                midi, duration: dur, measure, beat: 0,
                                staff: 'bass', isChord: true, chordIndex: ci,
                                accidental: this.getAccidental(midi, keySignature), twoHands: true
                            });
                        });
                    } else {
                        addBassPattern(getBassPattern('chord_passage'));
                    }
                    break;
                }
                case 'scale_fragment': {
                    // Scale ascending or descending fragment (3-4 notes, simple)
                    // Suitable for all levels - uses slow durations for beginners
                    const dir = Math.random() < 0.5 ? 1 : -1;
                    const dur = allowedNoteTypes.includes('quarter') ? 'quarter' :
                                allowedNoteTypes.includes('half') ? 'half' : 'whole';
                    const beatVal = this.getDurationBeats(dur);
                    const count = Math.min(Math.floor(4 / beatVal), 4);
                    for (let i = 0; i < count; i++) {
                        if (idx + dir < 0 || idx + dir >= trebleScale.length) {
                            // Stay in place at boundary instead of reversing
                            // This gives a clearer scale-like feel
                        } else {
                            idx += dir;
                        }
                        notes.push({
                            midi: trebleScale[idx], duration: dur, measure, beat: i * beatVal,
                            staff: 'treble', accidental: this.getAccidental(trebleScale[idx], keySignature)
                        });
                    }
                    addBassPattern(getBassPattern('stepwise'));
                    break;
                }
                case 'simple_arpeggio': {
                    // Broken chord arpeggio: root-3rd-5th (ascending/descending)
                    // Adapted for beginners with slow note values
                    const chordRoot = Math.max(0, Math.min(trebleScale.length - 5, idx));
                    const ascending = Math.random() < 0.6;
                    const pattern = ascending ? [0, 2, 4] : [4, 2, 0];
                    const dur = allowedNoteTypes.includes('quarter') ? 'quarter' :
                                allowedNoteTypes.includes('half') ? 'half' : 'whole';
                    const beatVal = this.getDurationBeats(dur);
                    let beat = 0;
                    // Fill measure with arpeggio pattern repeating
                    let patIdx = 0;
                    while (beat + beatVal <= 4.01) {
                        const noteIdx = Math.min(chordRoot + pattern[patIdx % pattern.length], trebleScale.length - 1);
                        notes.push({
                            midi: trebleScale[noteIdx], duration: dur, measure, beat,
                            staff: 'treble', accidental: this.getAccidental(trebleScale[noteIdx], keySignature)
                        });
                        beat += beatVal;
                        patIdx++;
                    }
                    idx = Math.min(chordRoot + 4, trebleScale.length - 1);
                    addBassPattern(getBassPattern('arpeggio_melody'));
                    break;
                }
                case 'broken_triad': {
                    // Triad exercise: play root-3rd-5th as block chord or broken
                    // Beginner/elementary: always broken (individual notes)
                    // Intermediate+: mix of solid and broken
                    const chordRoot = Math.max(0, Math.min(trebleScale.length - 5, idx));
                    const triadIndices = [chordRoot, Math.min(chordRoot + 2, trebleScale.length - 1), Math.min(chordRoot + 4, trebleScale.length - 1)];
                    const isSolid = (difficulty === 'intermediate' || difficulty === 'advanced' || difficulty === 'expert') && Math.random() < 0.4;

                    if (isSolid && notesPerChord >= 3) {
                        // Solid triad chord (half notes, 2 per measure)
                        const dur = allowedNoteTypes.includes('half') ? 'half' : 'whole';
                        const chordsPerMeasure = Math.floor(4 / this.getDurationBeats(dur));
                        for (let c = 0; c < chordsPerMeasure; c++) {
                            const beat = c * this.getDurationBeats(dur);
                            triadIndices.forEach((tIdx, ci) => {
                                notes.push({
                                    midi: trebleScale[tIdx], duration: dur, measure, beat,
                                    staff: 'treble', isChord: true, chordIndex: ci,
                                    accidental: this.getAccidental(trebleScale[tIdx], keySignature)
                                });
                            });
                            // Move triad root for next chord
                            const step = Math.floor(Math.random() * 3) - 1;
                            idx = Math.max(0, Math.min(trebleScale.length - 5, chordRoot + step));
                        }
                    } else {
                        // Broken triad (individual notes)
                        const dur = allowedNoteTypes.includes('quarter') ? 'quarter' :
                                    allowedNoteTypes.includes('half') ? 'half' : 'whole';
                        const beatVal = this.getDurationBeats(dur);
                        let beat = 0;
                        let patIdx = 0;
                        // Alternate between ascending and descending triad
                        const pattern = Math.random() < 0.5 ? [0, 1, 2, 1] : [2, 1, 0, 1];
                        while (beat + beatVal <= 4.01) {
                            const tIdx = triadIndices[pattern[patIdx % pattern.length]];
                            notes.push({
                                midi: trebleScale[tIdx], duration: dur, measure, beat,
                                staff: 'treble', accidental: this.getAccidental(trebleScale[tIdx], keySignature)
                            });
                            beat += beatVal;
                            patIdx++;
                        }
                    }
                    idx = Math.min(chordRoot + 2, trebleScale.length - 1);
                    addBassPattern(getBassPattern('melody'));
                    break;
                }
                case 'simple_progression': {
                    // Chord progression: I-IV-V-I or I-V-vi-IV style
                    // Each chord is 1-2 beats depending on difficulty
                    // Beginner/elementary: melody notes from chord tones (no actual chords)
                    // Intermediate+: actual chords
                    const progressions = [
                        [0, 3, 4, 0],  // I-IV-V-I
                        [0, 4, 5, 3],  // I-V-vi-IV
                        [0, 5, 3, 4],  // I-vi-IV-V
                    ];
                    const prog = progressions[Math.floor(Math.random() * progressions.length)];

                    if (notesPerChord <= 1 || difficulty === 'beginner' || difficulty === 'elementary') {
                        // Melodic: play the root of each chord as a melody
                        const dur = allowedNoteTypes.includes('half') ? 'half' : 'whole';
                        const beatVal = this.getDurationBeats(dur);
                        const count = Math.min(prog.length, Math.floor(4 / beatVal));
                        let beat = 0;
                        for (let i = 0; i < count; i++) {
                            const rootIdx = Math.min(Math.max(0, idx + prog[i]), trebleScale.length - 1);
                            notes.push({
                                midi: trebleScale[rootIdx], duration: dur, measure, beat,
                                staff: 'treble', accidental: this.getAccidental(trebleScale[rootIdx], keySignature)
                            });
                            beat += beatVal;
                        }
                    } else {
                        // Harmonic: actual chord voicings
                        const dur = allowedNoteTypes.includes('quarter') ? 'quarter' : 'half';
                        const beatVal = this.getDurationBeats(dur);
                        const count = Math.min(prog.length, Math.floor(4 / beatVal));
                        let beat = 0;
                        for (let i = 0; i < count; i++) {
                            const rootIdx = Math.max(0, Math.min(trebleScale.length - 5, idx + prog[i]));
                            const chordNotes = this._buildDiatonicChord(trebleScale, rootIdx, Math.min(notesPerChord, 3));
                            chordNotes.forEach((midi, ci) => {
                                notes.push({
                                    midi, duration: dur, measure, beat,
                                    staff: 'treble', isChord: true, chordIndex: ci,
                                    accidental: this.getAccidental(midi, keySignature)
                                });
                            });
                            beat += beatVal;
                        }
                    }
                    addBassPattern(getBassPattern('chord_passage'));
                    break;
                }
                default:
                    return this._generateSection('melody', measure, trebleScale, bassScale, startIdx, opts);
            }

            return { notes, endIdx: idx };
        }

        /**
         * Pick durations that fill exactly one measure (4 beats in 4/4)
         */
        _pickMeasureDurations(allowedNoteTypes) {
            const beatValues = {
                'whole': 4, 'dotted-half': 3, 'half': 2, 'dotted-quarter': 1.5,
                'quarter': 1, 'dotted-eighth': 0.75, 'eighth': 0.5, 'sixteenth': 0.25
            };
            const available = allowedNoteTypes.filter(t => beatValues[t]);
            if (available.length === 0) return ['whole'];

            // Get total beats for current time signature
            const ts = this.engine.staffSettings?.timeSignature || '4/4';
            const [tsTop, tsBottom] = ts.split('/').map(Number);
            const totalBeats = (tsTop * 4) / tsBottom;

            const result = [];
            let remaining = totalBeats;
            let attempts = 0;
            while (remaining > 0.01 && attempts < 20) {
                // Pick a random duration that fits
                const fits = available.filter(t => beatValues[t] <= remaining + 0.01);
                if (fits.length === 0) break;
                const dur = fits[Math.floor(Math.random() * fits.length)];
                result.push(dur);
                remaining -= beatValues[dur];
                attempts++;
            }
            return result.length > 0 ? result : ['whole'];
        }

        /**
         * USER FIX: Generate mixed content - DRAMATICALLY different for advanced vs expert
         * Advanced: Mixed content with moderate complexity
         * Expert: Long passages, VERY dense chords, fast rhythms, wide range, HIGH DIVERSITY
         */
        generateMixedContent(difficulty) {
            const notes = [];
            const settings = this.engine.userSettings;

            // DRAMATIC DIFFERENCE: Expert has much longer staves
            const measureCount = difficulty === 'expert' ? 24 : 10;

            // Get key signature scale
            const keySignature = settings.key_signature || 'C';
            const scale = this.getScaleForKey(keySignature);

            // EXPERT: Always use 2 hands, larger chord sizes
            // HARD LIMIT: max 5 notes per staff
            const isExpert = difficulty === 'expert';
            const forcedHands = isExpert ? 2 : parseInt(settings.hands_count) || 1;
            const chordSize = Math.min(isExpert ? Math.floor(Math.random() * 2) + 4 : 2, 5);

            // Define segment types - expert has MANY more complex types with HEAVY CHORD emphasis
            // and FORCED diversity by using a rotation system
            const expertSegmentTypes = [
                'complexChord',     // 7ths, 9ths, 11ths, 13ths
                'denseChords',      // Dense progressions
                'complexChord',     // Again - double weight on chords
                'polyrhythm',       // Two hand independence
                'octaveJumps',      // Wide interval jumps
                'denseChords',      // Again
                'chromaticRun',     // Chromatic passages
                'complexChord',     // Triple weight on complex chords
                'arpeggio16th',     // Fast arpeggios
                'syncopated',       // Off-beat rhythms
                'denseChords',      // Again
                'mixedRhythms'      // Multiple durations in same measure
            ];

            const advancedSegmentTypes = ['melody', 'scale', 'triad', 'arpeggio', 'denseChords'];

            const segmentTypes = isExpert ? expertSegmentTypes : advancedSegmentTypes;

            let currentMeasure = 0;
            let segmentIndex = 0;  // Use index for guaranteed rotation instead of random

            while (currentMeasure < measureCount) {
                // EXPERT: Use rotation for guaranteed variety instead of random
                const segmentType = isExpert
                    ? segmentTypes[segmentIndex % segmentTypes.length]
                    : segmentTypes[Math.floor(Math.random() * segmentTypes.length)];
                segmentIndex++;

                // Expert has shorter segments for more variety
                const segmentLength = Math.min(
                    isExpert ? 1 : Math.floor(Math.random() * 3) + 2, // Expert: 1 measure per segment for MAX variety
                    measureCount - currentMeasure
                );

                const segmentNotes = this.generateAdvancedSegment(
                    segmentType,
                    currentMeasure,
                    segmentLength,
                    scale,
                    keySignature,
                    { ...settings, hands_count: forcedHands, notes_count: chordSize },
                    isExpert
                );

                notes.push(...segmentNotes);
                currentMeasure += segmentLength;
            }

            return notes;
        }

        /**
         * Generate advanced segment - more complex patterns for advanced/expert
         */
        generateAdvancedSegment(type, startMeasure, measureCount, scale, keySignature, settings, isExpert) {
            const notes = [];
            const handsCount = settings.hands_count || 2;
            const minMidi = 48;  // Wider range for advanced
            const maxMidi = 84;  // C6
            const chordSize = settings.notes_count || 3;

            switch (type) {
                case 'fastScale':
                case 'chromaticRun':
                    // Fast scale run with 8th or 16th notes
                    let scaleMidi = scale[Math.floor(Math.random() * scale.length)];
                    let scaleDir = Math.random() < 0.5 ? 1 : -1;
                    const rhythm = isExpert ? 'eighth' : 'quarter';
                    const notesPerMeasure = isExpert ? 8 : 4;

                    for (let m = 0; m < measureCount; m++) {
                        for (let i = 0; i < notesPerMeasure; i++) {
                            const beat = i * (4 / notesPerMeasure);
                            const midi = Math.max(minMidi, Math.min(maxMidi, scaleMidi));
                            notes.push({
                                midi: midi,
                                duration: rhythm,
                                measure: startMeasure + m,
                                beat: beat,
                                staff: midi >= 60 ? 'treble' : 'bass',
                                accidental: this.getAccidental(midi, keySignature)
                            });
                            // Chromatic or scale movement
                            scaleMidi += type === 'chromaticRun' ? scaleDir : scaleDir * 2;
                            if (scaleMidi > maxMidi || scaleMidi < minMidi) scaleDir *= -1;
                        }
                    }
                    break;

                case 'denseChords':
                    // Dense chord progressions - multiple notes per beat
                    const chordTypes = [
                        [0, 4, 7],           // Major
                        [0, 3, 7],           // Minor
                        [0, 4, 7, 11],       // Major 7
                        [0, 3, 7, 10],       // Minor 7
                        [0, 4, 7, 10],       // Dominant 7
                        [0, 4, 7, 11, 14]    // Major 9 (for expert)
                    ];

                    for (let m = 0; m < measureCount; m++) {
                        // 2 chords per measure for expert, 1 for advanced
                        const chordsPerMeasure = isExpert ? 2 : 1;
                        for (let c = 0; c < chordsPerMeasure; c++) {
                            const beat = c * 2;
                            const root = scale[Math.floor(Math.random() * scale.length)];
                            const chordType = chordTypes[Math.floor(Math.random() * (isExpert ? chordTypes.length : 4))];

                            chordType.slice(0, chordSize).forEach((interval, idx) => {
                                const midi = Math.max(minMidi, Math.min(maxMidi, root + interval));
                                notes.push({
                                    midi: midi,
                                    duration: isExpert ? 'half' : 'whole',
                                    measure: startMeasure + m,
                                    beat: beat,
                                    staff: midi >= 60 ? 'treble' : 'bass',
                                    accidental: this.getAccidental(midi, keySignature),
                                    isChord: true,
                                    chordIndex: idx
                                });
                            });
                        }
                    }
                    break;

                case 'arpeggio16th':
                    // Fast arpeggios with 16th notes (expert only)
                    const arpPatterns = [[0, 4, 7, 12], [0, 3, 7, 10], [0, 4, 7, 11]];
                    for (let m = 0; m < measureCount; m++) {
                        const root = scale[Math.floor(Math.random() * scale.length)];
                        const pattern = arpPatterns[Math.floor(Math.random() * arpPatterns.length)];
                        // 16 notes per measure (16th notes)
                        for (let i = 0; i < 16; i++) {
                            const interval = pattern[i % pattern.length];
                            const octaveShift = Math.floor(i / pattern.length) * 12;
                            const midi = Math.max(minMidi, Math.min(maxMidi, root + interval + octaveShift));
                            notes.push({
                                midi: midi,
                                duration: 'sixteenth',
                                measure: startMeasure + m,
                                beat: i * 0.25,
                                staff: midi >= 60 ? 'treble' : 'bass',
                                accidental: this.getAccidental(midi, keySignature)
                            });
                        }
                    }
                    break;

                case 'polyrhythm':
                    // Polyrhythmic patterns - different rhythms in each hand
                    for (let m = 0; m < measureCount; m++) {
                        // Right hand: triplets or 8ths
                        for (let i = 0; i < 6; i++) {
                            const beat = i * (4 / 6); // Triplet feel
                            const midi = 60 + Math.floor(Math.random() * 12);
                            notes.push({
                                midi: midi,
                                duration: 'eighth',
                                measure: startMeasure + m,
                                beat: beat,
                                staff: 'treble',
                                accidental: this.getAccidental(midi, keySignature)
                            });
                        }
                        // Left hand: quarter notes
                        for (let i = 0; i < 4; i++) {
                            const midi = 48 + Math.floor(Math.random() * 12);
                            notes.push({
                                midi: midi,
                                duration: 'quarter',
                                measure: startMeasure + m,
                                beat: i,
                                staff: 'bass',
                                accidental: this.getAccidental(midi, keySignature),
                                twoHands: true
                            });
                        }
                    }
                    break;

                case 'complexChord':
                    // EXPERT: Complex chord voicings - 7ths, 9ths, 11ths, 13ths
                    const complexChordTypes = [
                        [0, 4, 7, 10, 14],       // Dominant 9
                        [0, 4, 7, 11, 14],       // Major 9
                        [0, 3, 7, 10, 14],       // Minor 9
                        [0, 4, 7, 10, 14, 17],   // Dominant 11
                        [0, 4, 7, 11, 14, 21],   // Major 13
                        [0, 3, 7, 10, 14, 17],   // Minor 11
                        [0, 4, 7, 10, 13],       // 7#9 (Hendrix chord)
                        [0, 4, 6, 10],           // 7b5
                        [0, 4, 8, 10]            // 7#5 (augmented 7)
                    ];
                    for (let m = 0; m < measureCount; m++) {
                        // 2 complex chords per measure
                        for (let c = 0; c < 2; c++) {
                            const beat = c * 2;
                            const root = scale[Math.floor(Math.random() * scale.length)];
                            const chordVoicing = complexChordTypes[Math.floor(Math.random() * complexChordTypes.length)];
                            const useChordSize = Math.min(chordVoicing.length, chordSize, 5); // Max 5 notes per staff

                            chordVoicing.slice(0, useChordSize).forEach((interval, idx) => {
                                const midi = Math.max(36, Math.min(84, root + interval));
                                notes.push({
                                    midi: midi,
                                    duration: 'half',
                                    measure: startMeasure + m,
                                    beat: beat,
                                    staff: midi >= 60 ? 'treble' : 'bass',
                                    accidental: this.getAccidental(midi, keySignature),
                                    isChord: true,
                                    chordIndex: idx
                                });
                            });
                        }
                    }
                    break;

                case 'octaveJumps':
                    // EXPERT: Wide octave jumps - challenging reading
                    for (let m = 0; m < measureCount; m++) {
                        const baseNote = scale[Math.floor(Math.random() * scale.length)];
                        const jumpPattern = [0, 12, 0, -12, 7, 19, 0, 12]; // Octave jump pattern
                        for (let i = 0; i < 8; i++) {
                            const midi = Math.max(36, Math.min(84, baseNote + jumpPattern[i % jumpPattern.length]));
                            notes.push({
                                midi: midi,
                                duration: 'eighth',
                                measure: startMeasure + m,
                                beat: i * 0.5,
                                staff: midi >= 60 ? 'treble' : 'bass',
                                accidental: this.getAccidental(midi, keySignature)
                            });
                        }
                    }
                    break;

                case 'syncopated':
                    // EXPERT: Syncopated rhythms - off-beat emphasis
                    for (let m = 0; m < measureCount; m++) {
                        // Off-beat pattern: rest, eighth, quarter, eighth, rest, quarter tied
                        const syncopatedBeats = [0.5, 1, 1.5, 2.5, 3, 3.5];
                        syncopatedBeats.forEach(beat => {
                            const midi = scale[Math.floor(Math.random() * scale.length)];
                            const finalMidi = Math.max(48, Math.min(84, midi));
                            notes.push({
                                midi: finalMidi,
                                duration: 'eighth',
                                measure: startMeasure + m,
                                beat: beat,
                                staff: finalMidi >= 60 ? 'treble' : 'bass',
                                accidental: this.getAccidental(finalMidi, keySignature)
                            });
                        });
                    }
                    break;

                case 'mixedRhythms':
                    // EXPERT: Multiple different durations in same measure
                    for (let m = 0; m < measureCount; m++) {
                        // Mix of durations: half, quarter, two eighths
                        const rhythmPatterns = [
                            [{ dur: 'half', beat: 0 }, { dur: 'quarter', beat: 2 }, { dur: 'eighth', beat: 3 }, { dur: 'eighth', beat: 3.5 }],
                            [{ dur: 'quarter', beat: 0 }, { dur: 'eighth', beat: 1 }, { dur: 'eighth', beat: 1.5 }, { dur: 'half', beat: 2 }],
                            [{ dur: 'eighth', beat: 0 }, { dur: 'eighth', beat: 0.5 }, { dur: 'quarter', beat: 1 }, { dur: 'quarter', beat: 2 }, { dur: 'quarter', beat: 3 }]
                        ];
                        const pattern = rhythmPatterns[Math.floor(Math.random() * rhythmPatterns.length)];
                        let lastMidi = scale[Math.floor(Math.random() * scale.length)];

                        pattern.forEach(({ dur, beat }) => {
                            // 60% chance of chord on each note
                            const makeChord = Math.random() < 0.6;
                            const numNotes = makeChord ? Math.min(chordSize, 5) : 1;

                            for (let c = 0; c < numNotes; c++) {
                                const interval = [0, 4, 7, 11][c % 4];
                                const midi = Math.max(48, Math.min(84, lastMidi + interval));
                                notes.push({
                                    midi: midi,
                                    duration: dur,
                                    measure: startMeasure + m,
                                    beat: beat,
                                    staff: midi >= 60 ? 'treble' : 'bass',
                                    accidental: this.getAccidental(midi, keySignature),
                                    isChord: numNotes > 1,
                                    chordIndex: c
                                });
                            }
                            lastMidi = this.getNextMelodicNote(lastMidi, scale, 48, 84);
                        });
                    }
                    break;

                case 'scale':
                case 'arpeggio':
                case 'triad':
                case 'melody':
                default:
                    // Standard patterns (from before)
                    let currentMidi = scale[Math.floor(scale.length / 2)];
                    for (let m = 0; m < measureCount; m++) {
                        const patterns = [
                            ['quarter', 'quarter', 'quarter', 'quarter'],
                            ['half', 'quarter', 'quarter'],
                            ['quarter', 'quarter', 'half']
                        ];
                        const pattern = patterns[Math.floor(Math.random() * patterns.length)];
                        let beat = 0;
                        pattern.forEach(duration => {
                            const midi = Math.max(minMidi, Math.min(maxMidi, currentMidi));

                            // Random chance to make chord
                            const makeChord = Math.random() < (isExpert ? 0.5 : 0.3);
                            if (makeChord && chordSize > 1) {
                                const cappedChordSize = Math.min(chordSize, 5);
                                for (let c = 0; c < cappedChordSize; c++) {
                                    const chordMidi = midi + [0, 4, 7, 11, 14][c % 5];
                                    if (chordMidi <= maxMidi) {
                                        notes.push({
                                            midi: chordMidi,
                                            duration: duration,
                                            measure: startMeasure + m,
                                            beat: beat,
                                            staff: chordMidi >= 60 ? 'treble' : 'bass',
                                            accidental: this.getAccidental(chordMidi, keySignature),
                                            isChord: true,
                                            chordIndex: c
                                        });
                                    }
                                }
                            } else {
                                notes.push({
                                    midi: midi,
                                    duration: duration,
                                    measure: startMeasure + m,
                                    beat: beat,
                                    staff: midi >= 60 ? 'treble' : 'bass',
                                    accidental: this.getAccidental(midi, keySignature)
                                });
                            }

                            beat += this.getDurationBeats(duration);
                            currentMidi = this.getNextMelodicNote(currentMidi, scale, minMidi, maxMidi);
                        });
                    }
                    break;
            }

            // Add bass notes for 2 hands mode (if not already added)
            if (handsCount === 2 && !['polyrhythm'].includes(type)) {
                const bassNotes = [];
                const addedBeats = new Set();

                notes.forEach(note => {
                    if (note.staff === 'treble') {
                        const beatKey = `${note.measure}-${Math.floor(note.beat)}`;
                        if (!addedBeats.has(beatKey) && Math.random() < 0.8) {
                            addedBeats.add(beatKey);
                            const bassScale = scale.filter(m => m >= 43 && m < 60);
                            if (bassScale.length > 0) {
                                const bassMidi = bassScale[Math.floor(Math.random() * bassScale.length)];
                                bassNotes.push({
                                    midi: bassMidi,
                                    duration: 'quarter',
                                    measure: note.measure,
                                    beat: Math.floor(note.beat),
                                    staff: 'bass',
                                    accidental: this.getAccidental(bassMidi, keySignature),
                                    twoHands: true
                                });
                            }
                        }
                    }
                });

                notes.push(...bassNotes);
            }

            return notes;
        }

        /**
         * Update UI sliders/buttons to reflect randomized settings
         */
        updateUIForRandomSettings(notesCount, handsCount) {
            // Update Notes Per Chord slider
            $('#srtNotesCount').val(notesCount);
            $('#srtNotesCountValue').text(notesCount);

            // Update Hands buttons
            $('.srt-btn-option[data-hands]').removeClass('active');
            $(`.srt-btn-option[data-hands="${handsCount}"]`).addClass('active');
        }

        /**
         * Randomize scale-specific settings for variety
         */
        randomizeScaleSettings() {
            const settings = this.engine.userSettings;

            // Random scale root
            const roots = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'Bb', 'Eb', 'Ab'];
            settings.scale_root = roots[Math.floor(Math.random() * roots.length)];

            // Random scale type
            const types = ['major', 'minor', 'harmonic-minor', 'melodic-minor'];
            settings.scale_type = types[Math.floor(Math.random() * types.length)];

            // Random pattern
            const patterns = ['ascending', 'descending', 'ascending-descending', 'thirds', 'broken-chords'];
            settings.scale_pattern = patterns[Math.floor(Math.random() * patterns.length)];

            // Update UI if elements exist
            if ($('#srtScaleRoot').length) $('#srtScaleRoot').val(settings.scale_root);
            if ($('#srtScaleType').length) $('#srtScaleType').val(settings.scale_type);
            if ($('#srtScalePattern').length) $('#srtScalePattern').val(settings.scale_pattern);
        }

        /**
         * Generate random notes - USER REQUEST: Respects ALL user settings
         * - notes_count: When > 1, ALL notes become chords of that size
         * - hands_count: 1 = treble only, 2 = both clefs with SIMULTANEOUS notes
         * - note_range: Uses configured min/max range
         * - difficulty: Affects complexity and measure count
         * - key_signature: Notes stay in key
         */
        generateRandomNotes() {
            const notes = [];
            const settings = this.engine.userSettings;
            const diffConfig = this.engine.config.difficulties?.[settings.difficulty] || {};

            const range = this.getEffectiveRange();
            const handsCount = range.handsCount;
            const notesPerChord = Math.min(parseInt(settings.notes_count) || 1, 5);
            const keySignature = settings.key_signature || 'C';
            const scale = this.getScaleForKey(keySignature);
            const measureCount = diffConfig.measures || 4;
            const allowedNoteTypes = diffConfig.note_types || ['whole', 'half', 'quarter'];
            const complexityFactor = diffConfig.complexity_factor || 1;
            const maxInterval = diffConfig.max_interval || 7;
            const chordProb = notesPerChord > 1 ? 0.5 : (diffConfig.chord_prob || 0);
            const restProb = diffConfig.rest_prob || 0.10;

            // Time signature
            const timeSignature = settings.time_signature || this.engine.staffSettings.timeSignature || '4/4';
            const tsTop = parseInt(timeSignature.split('/')[0]) || 4;
            const tsBottom = parseInt(timeSignature.split('/')[1]) || 4;

            // Get scale notes ONLY in treble range
            const trebleScale = scale.filter(m => m >= range.trebleMin && m <= range.trebleMax);
            if (trebleScale.length === 0) trebleScale.push(range.trebleMin);

            const bassScale = scale.filter(m => m >= range.bassMin && m <= range.bassMax);

            const rhythmPatterns = this.getRhythmPatternsForComplexity(complexityFactor, allowedNoteTypes, timeSignature);
            const shuffledPatterns = this.shuffleArray([...rhythmPatterns]);

            // Start on a scale tone in the middle of the treble range
            let currentIdx = Math.floor(trebleScale.length / 2);
            let patternIndex = 0;

            for (let measure = 0; measure < measureCount; measure++) {
                const pattern = shuffledPatterns[patternIndex % shuffledPatterns.length];
                patternIndex++;
                let beatPosition = 0;

                pattern.forEach((duration, idx) => {
                    const durationBeats = this.getDurationBeats(duration);

                    // Rest probability (never first beat of first measure, never consecutive)
                    const prevWasRest = notes.length > 0 && notes[notes.length - 1].isRest;
                    const isFirst = (measure === 0 && idx === 0);
                    if (!isFirst && !prevWasRest && Math.random() < restProb) {
                        notes.push({ midi: null, duration, measure, beat: beatPosition, staff: 'treble', isRest: true });
                        if (handsCount === 2) {
                            notes.push({ midi: null, duration, measure, beat: beatPosition, staff: 'bass', isRest: true });
                        }
                        beatPosition += durationBeats;
                        return;
                    }

                    // MELODIC MOTION: Move by small diatonic steps (controlled by maxInterval)
                    const maxStep = Math.min(Math.ceil(maxInterval / 2), trebleScale.length - 1);
                    const step = Math.floor(Math.random() * (maxStep * 2 + 1)) - maxStep;
                    currentIdx = Math.max(0, Math.min(trebleScale.length - 1, currentIdx + step));
                    const trebleMidi = trebleScale[currentIdx];

                    // Chord or single note
                    const isLongEnough = ['whole', 'dotted-half', 'half', 'dotted-quarter', 'quarter'].includes(duration);
                    const makeChord = isLongEnough && notesPerChord > 1 && Math.random() < chordProb;

                    if (makeChord) {
                        // Build diatonic chord (in key) from current position
                        const chordMidis = this._buildDiatonicChord(trebleScale, currentIdx, notesPerChord);
                        chordMidis.forEach((midi, ci) => {
                            notes.push({
                                midi, duration, measure, beat: beatPosition,
                                staff: 'treble',
                                accidental: this.getAccidental(midi, keySignature),
                                isChord: true, chordIndex: ci
                            });
                        });
                    } else {
                        const singleNote = {
                            midi: trebleMidi, duration, measure, beat: beatPosition,
                            staff: 'treble',
                            accidental: this.getAccidental(trebleMidi, keySignature)
                        };
                        // Add trill ornament occasionally on long treble notes (baroque style)
                        const trillableDurations = ['whole', 'dotted-half', 'half'];
                        if (trillableDurations.includes(duration) && Math.random() < 0.12) {
                            singleNote.ornaments = ['trill'];
                        }
                        notes.push(singleNote);
                    }

                    // Bass notes for 2 hands
                    if (handsCount === 2 && bassScale.length > 0) {
                        // Bass follows harmony — use root-fifth pattern
                        const bassRoot = bassScale[currentIdx % bassScale.length];
                        const bassFifth = bassScale[Math.min((currentIdx + 4) % bassScale.length, bassScale.length - 1)];
                        const bassMidi = (beatPosition === 0) ? bassRoot : bassFifth;
                        notes.push({
                            midi: bassMidi, duration, measure, beat: beatPosition,
                            staff: 'bass',
                            accidental: this.getAccidental(bassMidi, keySignature),
                            twoHands: true
                        });
                    }

                    beatPosition += durationBeats;
                });
            }

            return notes;
        }

        /**
         * Build a diatonic chord from a scale position
         * Returns array of MIDI values, max count notes, all in the scale
         */
        _buildDiatonicChord(scaleNotes, rootIdx, count) {
            const MAX_PER_STAFF = 5;
            const cappedCount = Math.min(count, MAX_PER_STAFF);
            const result = [];
            // Diatonic chord = stack thirds from root position
            // In a scale array, every 2 positions = a third
            for (let i = 0; i < cappedCount; i++) {
                const idx = rootIdx + (i * 2); // Skip one scale degree per note = third
                if (idx < scaleNotes.length) {
                    result.push(scaleNotes[idx]);
                } else {
                    // Wrap to next octave
                    const wrapIdx = idx % scaleNotes.length;
                    const octaveUp = scaleNotes[wrapIdx] + 12;
                    if (octaveUp <= 84) result.push(octaveUp);
                }
            }
            return [...new Set(result)].sort((a, b) => a - b).slice(0, cappedCount);
        }

        getScaleForKey(key) {
            // Major scale pattern: W-W-H-W-W-W-H (whole-whole-half-whole-whole-whole-half)
            const majorPattern = [0, 2, 4, 5, 7, 9, 11]; // 7 notes (sans la 8ème qui est l'octave)

            // CORRIGÉ: Mapping correct MIDI pour chaque tonalité (C4 = 60)
            const keyToRoot = {
                'C': 60,   // C4 (Do)
                'D': 62,   // D4 (Ré)
                'E': 64,   // E4 (Mi)
                'F': 65,   // F4 (Fa)
                'G': 67,   // G4 (Sol)
                'A': 69,   // A4 (La)
                'B': 71,   // B4 (Si)
                'C#': 61,  // C#4 (Do#)
                'Db': 61,  // Db4 (Réb)
                'D#': 63,  // D#4 (Ré#)
                'Eb': 63,  // Eb4 (Mib)
                'F#': 66,  // F#4 (Fa#)
                'Gb': 66,  // Gb4 (Solb)
                'G#': 68,  // G#4 (Sol#)
                'Ab': 68,  // Ab4 (Lab)
                'A#': 70,  // A#4 (La#)
                'Bb': 70   // Bb4 (Sib)
            };

            const root = keyToRoot[key] || 60;

            // Build scale across multiple octaves (2 octaves below to 2 au-dessus)
            const scale = [];
            for (let octave = -2; octave <= 2; octave++) {
                majorPattern.forEach(interval => {
                    const midi = root + (octave * 12) + interval;
                    if (midi >= 36 && midi <= 84) { // Piano range C2-C6
                        scale.push(midi);
                    }
                });
            }

            return scale.sort((a, b) => a - b);
        }

        // Convertir nom de note (ex: "C4") en MIDI number
        noteToMidi(noteName) {
            const noteMap = {
                'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11
            };

            const match = noteName.match(/^([A-G])(#|b)?(\d+)$/);
            if (!match) return 60; // Default C4

            const note = match[1];
            const accidental = match[2];
            const octave = parseInt(match[3]);

            let midi = (octave + 1) * 12 + noteMap[note];
            if (accidental === '#') midi += 1;
            if (accidental === 'b') midi -= 1;

            return midi;
        }

        /**
         * Get the effective MIDI range based on user settings, difficulty, and hands
         * All generators should use this for consistent range enforcement
         */
        getEffectiveRange() {
            const settings = this.engine.userSettings;
            const difficulty = this.engine.config.difficulties?.[settings.difficulty];
            const handsCount = parseInt(settings.hands_count) || 1;

            // Note range: user setting overrides difficulty config
            const rangeMinNote = settings.note_range_min || (difficulty?.range?.[0]) || 'C4';
            const rangeMaxNote = settings.note_range_max || (difficulty?.range?.[1]) || 'C6';

            let minMidi = this.noteToMidi(rangeMinNote);
            let maxMidi = this.noteToMidi(rangeMaxNote);

            if (minMidi >= maxMidi) maxMidi = minMidi + 12;

            if (handsCount === 1) {
                // 1 hand: respect user range fully, place on appropriate staff
                const trebleMin = Math.max(minMidi, 36);  // Allow bass clef notes too
                const trebleMax = Math.min(maxMidi, 96);   // Cap at C7
                return {
                    minMidi: trebleMin,
                    maxMidi: trebleMax,
                    trebleMin, trebleMax,
                    bassMin: trebleMin, bassMax: trebleMin, // No separate bass range
                    handsCount
                };
            }

            // 2 hands: split into treble (C4+) and bass (below C4) ranges
            const trebleMin = Math.max(minMidi, 60); // Treble starts at middle C
            const trebleMax = Math.min(Math.max(maxMidi, trebleMin + 12), 96);
            const bassMin = Math.max(36, Math.min(minMidi, 48));
            const bassMax = 59; // Always up to B3

            return {
                minMidi: bassMin,
                maxMidi: trebleMax,
                trebleMin, trebleMax,
                bassMin, bassMax,
                handsCount
            };
        }

        // Obtenir MIDI aléatoire dans un range et limité à la gamme
        getRandomMidiInRange(scale, minMidi, maxMidi) {
            const validNotes = scale.filter(midi => midi >= minMidi && midi <= maxMidi);
            if (validNotes.length === 0) {
                // Fallback si aucune note valide
                return Math.floor((minMidi + maxMidi) / 2);
            }
            return validNotes[Math.floor(Math.random() * validNotes.length)];
        }

        // CRITICAL: Patterns rythmiques par time signature et complexité
        // USER FIX: Simplified patterns - NO eighth notes for any complexity
        // Each measure must add up to exactly 4 beats for 4/4
        getRhythmPatternsForComplexity(complexity, allowedTypes, timeSignature = '4/4') {
            // Patterns 4/4 (4 beats per measure) — complexity 1-5
            // Each pattern MUST sum to exactly 4 quarter-note beats
            const patterns_4_4 = {
                1: [['whole'], ['half', 'half'], ['quarter', 'quarter', 'quarter', 'quarter'], ['half', 'quarter', 'quarter'], ['dotted-half', 'quarter']],
                2: [['whole'], ['half', 'half'], ['quarter', 'quarter', 'quarter', 'quarter'], ['half', 'quarter', 'quarter'], ['quarter', 'quarter', 'half'], ['dotted-half', 'quarter'], ['quarter', 'half', 'quarter']],
                3: [['half', 'half'], ['quarter', 'quarter', 'quarter', 'quarter'], ['half', 'quarter', 'quarter'], ['dotted-half', 'quarter'],
                    ['quarter', 'eighth', 'eighth', 'quarter', 'quarter'], ['half', 'eighth', 'eighth', 'quarter'],
                    ['quarter', 'quarter', 'eighth', 'eighth', 'quarter'], ['dotted-quarter', 'eighth', 'half']],
                4: [['quarter', 'quarter', 'quarter', 'quarter'], ['half', 'quarter', 'quarter'], ['dotted-half', 'quarter'],
                    ['quarter', 'eighth', 'eighth', 'quarter', 'quarter'], ['eighth', 'eighth', 'quarter', 'half'],
                    ['quarter', 'quarter', 'eighth', 'eighth', 'eighth', 'eighth'],
                    ['dotted-quarter', 'eighth', 'quarter', 'quarter'], ['eighth', 'eighth', 'eighth', 'eighth', 'half'],
                    ['half', 'eighth', 'eighth', 'eighth', 'eighth']],
                5: [['quarter', 'eighth', 'eighth', 'quarter', 'quarter'], ['eighth', 'eighth', 'quarter', 'half'],
                    ['eighth', 'eighth', 'eighth', 'eighth', 'quarter', 'quarter'],
                    ['quarter', 'quarter', 'eighth', 'eighth', 'eighth', 'eighth'],
                    ['dotted-quarter', 'eighth', 'dotted-quarter', 'eighth'],
                    ['eighth', 'eighth', 'eighth', 'eighth', 'eighth', 'eighth', 'quarter'],
                    ['eighth', 'quarter', 'eighth', 'eighth', 'quarter', 'eighth']]
            };

            // Patterns 3/4 (3 beats per measure)
            const patterns_3_4 = {
                1: [['dotted-half'], ['half', 'quarter'], ['quarter', 'quarter', 'quarter']],
                2: [['quarter', 'quarter', 'quarter'], ['half', 'quarter'], ['dotted-half']],
                3: [['quarter', 'quarter', 'quarter'], ['half', 'quarter'], ['quarter', 'half'],
                    ['quarter', 'eighth', 'eighth', 'quarter'], ['eighth', 'eighth', 'quarter', 'quarter']],
                4: [['quarter', 'eighth', 'eighth', 'quarter'], ['eighth', 'eighth', 'quarter', 'quarter'],
                    ['quarter', 'quarter', 'eighth', 'eighth'], ['dotted-quarter', 'eighth', 'quarter']],
                5: [['eighth', 'eighth', 'eighth', 'eighth', 'quarter'], ['quarter', 'eighth', 'eighth', 'eighth', 'eighth'],
                    ['eighth', 'eighth', 'quarter', 'eighth', 'eighth'], ['dotted-quarter', 'eighth', 'eighth', 'eighth']]
            };

            // Patterns 6/8 (6 eighth notes = 3 quarter beats in compound time)
            const patterns_6_8 = {
                1: [['dotted-half'], ['dotted-quarter', 'dotted-quarter']],
                2: [['dotted-quarter', 'dotted-quarter'], ['dotted-half']],
                3: [['dotted-quarter', 'dotted-quarter'], ['dotted-half'],
                    ['quarter', 'eighth', 'dotted-quarter']],
                4: [['dotted-quarter', 'quarter', 'eighth'], ['quarter', 'eighth', 'quarter', 'eighth'],
                    ['eighth', 'eighth', 'eighth', 'dotted-quarter']],
                5: [['eighth', 'eighth', 'eighth', 'eighth', 'eighth', 'eighth'],
                    ['quarter', 'eighth', 'eighth', 'eighth', 'eighth'],
                    ['eighth', 'eighth', 'eighth', 'quarter', 'eighth']]
            };

            // Patterns 2/4 (2 beats per measure)
            const patterns_2_4 = {
                1: [['half'], ['quarter', 'quarter']],
                2: [['quarter', 'quarter'], ['half']],
                3: [['quarter', 'eighth', 'eighth'], ['eighth', 'eighth', 'quarter']],
                4: [['eighth', 'eighth', 'eighth', 'eighth'], ['dotted-quarter', 'eighth']],
                5: [['eighth', 'eighth', 'eighth', 'eighth'], ['dotted-quarter', 'eighth'],
                    ['eighth', 'quarter', 'eighth']]
            };

            // Select pattern collection based on time signature
            let patternCollection;
            switch (timeSignature) {
                case '3/4':
                    patternCollection = patterns_3_4;
                    break;
                case '6/8':
                    patternCollection = patterns_6_8;
                    break;
                case '2/4':
                    patternCollection = patterns_2_4;
                    break;
                case '4/4':
                default:
                    patternCollection = patterns_4_4;
                    break;
            }

            // Retourner patterns selon complexité
            let availablePatterns = patternCollection[complexity] || patternCollection[1];

            // Filtrer patterns qui n'utilisent que les types de notes autorisés
            availablePatterns = availablePatterns.filter(pattern => {
                return pattern.every(duration => {
                    const baseType = duration.replace('dotted-', '');
                    return allowedTypes.includes(duration) ||
                           (duration.startsWith('dotted-') && allowedTypes.includes('dotted'));
                });
            });

            // Si aucun pattern valide, retourner le plus simple pour cette time signature
            if (availablePatterns.length === 0) {
                switch (timeSignature) {
                    case '3/4':
                        availablePatterns = [['quarter', 'quarter', 'quarter']];
                        break;
                    case '6/8':
                        availablePatterns = [['dotted-quarter', 'dotted-quarter']];
                        break;
                    case '2/4':
                        availablePatterns = [['quarter', 'quarter']];
                        break;
                    default:
                        availablePatterns = [['quarter', 'quarter', 'quarter', 'quarter']];
                }
            }

            return availablePatterns;
        }

        /**
         * Validate that all rhythm patterns add up to correct beats for each time signature
         * This ensures measures are properly filled and not overflow
         * Called during engine initialization for sanity check
         */
        validateRhythmPatterns() {
            // Define time signatures with their expected total beats
            const timeSignatures = {
                '4/4': 4,  // 4 quarter-note beats
                '3/4': 3,  // 3 quarter-note beats
                '6/8': 3,  // 6 eighth notes = 3 quarter beats (2 dotted-quarter pulses)
                '2/4': 2   // 2 quarter-note beats
            };

            let allValid = true;
            let totalPatterns = 0;
            let validPatterns = 0;

            Object.keys(timeSignatures).forEach(timeSignature => {
                const expectedBeats = timeSignatures[timeSignature];

                // Test all complexity levels for this time signature
                for (let complexity = 1; complexity <= 5; complexity++) {
                    const patterns = this.getRhythmPatternsForComplexity(
                        complexity,
                        ['whole', 'dotted-half', 'half', 'dotted-quarter', 'quarter', 'eighth', 'sixteenth', 'dotted'],
                        timeSignature
                    );

                    patterns.forEach((pattern, index) => {
                        totalPatterns++;
                        const totalBeats = pattern.reduce((sum, duration) => sum + this.getDurationBeats(duration), 0);
                        if (totalBeats !== expectedBeats) {
                            console.error(
                                `❌ RHYTHM VALIDATION ERROR: ${timeSignature}, Complexity ${complexity}, Pattern ${index} = ${totalBeats} beats (expected ${expectedBeats})`,
                                pattern
                            );
                            allValid = false;
                        } else {
                            validPatterns++;
                        }
                    });
                }
            });

            if (allValid) {
            } else {
                console.error(`❌ Validation failed: ${validPatterns}/${totalPatterns} patterns valid`);
            }

            return allValid;
        }

        getRandomMidiFromScale(scale) {
            return scale[Math.floor(Math.random() * scale.length)];
        }

        getNextMelodicNote(currentMidi, scale, minMidi, maxMidi) {
            const currentIndex = scale.indexOf(currentMidi);
            if (currentIndex === -1) return currentMidi;

            // USER FIX: Get difficulty for diversity adjustment
            const difficulty = this.engine?.userSettings?.difficulty || 'beginner';

            // USER FIX: More diverse melodic patterns based on difficulty
            // Beginner: Mostly stepwise motion (80%)
            // Intermediate: Mix of steps and leaps (65% steps)
            // Advanced/Expert: More variety with sequences and arpeggios (50% steps)
            const stepProbability = {
                'beginner': 0.85,
                'elementary': 0.75,
                'intermediate': 0.65,
                'advanced': 0.50,
                'expert': 0.45
            };

            const isStep = Math.random() < (stepProbability[difficulty] || 0.7);

            // USER FIX: Direction tendency - avoid constant zig-zag motion
            // Maintain direction for 2-4 notes before potentially changing
            if (!this._melodicDirection) this._melodicDirection = 1;
            if (!this._directionCounter) this._directionCounter = 0;

            this._directionCounter++;
            const dirChangeProb = difficulty === 'beginner' ? 0.3 : 0.4;
            if (this._directionCounter >= 2 && Math.random() < dirChangeProb) {
                this._melodicDirection = -this._melodicDirection;
                this._directionCounter = 0;
            }

            const direction = this._melodicDirection;

            let interval;
            if (isStep) {
                // USER FIX: Varied step sizes based on difficulty
                if (difficulty === 'beginner' || difficulty === 'elementary') {
                    interval = direction * 1; // Only steps of 1 for beginners
                } else {
                    interval = direction * (Math.floor(Math.random() * 2) + 1); // 1 or 2 steps
                }
            } else {
                // USER FIX: Leaps - more variety for advanced
                if (difficulty === 'advanced' || difficulty === 'expert') {
                    // Include 3rds, 4ths, 5ths, 6ths for musical variety
                    const leapSizes = [2, 3, 4, 5, 6, 7]; // 3rd, 4th, 5th, 6th, 7th, octave
                    interval = direction * leapSizes[Math.floor(Math.random() * leapSizes.length)];
                } else {
                    interval = direction * (Math.floor(Math.random() * 3) + 3); // 3-5 steps
                }
            }

            // USER FIX: Occasional skip to a completely different area for variety
            // Only for intermediate+ difficulties
            if (['intermediate', 'advanced', 'expert'].includes(difficulty)) {
                if (Math.random() < 0.08) { // 8% chance of jump to new area
                    const validNotes = scale.filter(midi => midi >= minMidi && midi <= maxMidi);
                    if (validNotes.length > 4) {
                        // Jump to a random note at least 4 scale degrees away
                        const farNotes = validNotes.filter(midi => Math.abs(midi - currentMidi) > 4);
                        if (farNotes.length > 0) {
                            return farNotes[Math.floor(Math.random() * farNotes.length)];
                        }
                    }
                }
            }

            let newIndex = currentIndex + interval;

            // Keep within scale bounds
            newIndex = Math.max(0, Math.min(scale.length - 1, newIndex));

            let newMidi = scale[newIndex];

            // Vérifier que c'est dans le range autorisé
            if (minMidi !== undefined && maxMidi !== undefined) {
                // Si hors range, trouver la note la plus proche dans le range
                if (newMidi < minMidi || newMidi > maxMidi) {
                    const validNotes = scale.filter(midi => midi >= minMidi && midi <= maxMidi);
                    if (validNotes.length > 0) {
                        // Trouver la note la plus proche
                        newMidi = validNotes.reduce((closest, note) => {
                            return Math.abs(note - currentMidi) < Math.abs(closest - currentMidi) ? note : closest;
                        });

                        // USER FIX: If we hit boundary, reverse direction
                        this._melodicDirection = -this._melodicDirection;
                        this._directionCounter = 0;
                    }
                }
            }

            return newMidi;
        }

        /**
         * ✅ USER REQUEST: Generate intelligent harmonic chords that respect key signature
         * Distributes notes intelligently across treble and bass staves
         * Creates proper harmonic progressions (I, IV, V, ii, iii, vi, vii°)
         * CRITICAL: Max 5 notes per staff, no duplicate notes, real playable chords
         */
        generateChordNotes(rootMidi, scale, count, minMidi, maxMidi) {
            // USER FIX: Limit chord size to maximum 5 notes per staff
            const maxNotesPerStaff = 5;
            const requestedCount = Math.min(count, maxNotesPerStaff);

            const notes = new Set(); // Use Set to prevent duplicates automatically

            // ✅ SMART CHORD BUILDING: Use diatonic harmony
            // Find root position in scale (0-6 represents scale degrees I-VII)
            const rootInScale = scale.indexOf(rootMidi) % 7;

            // Determine chord quality based on scale degree (major scale harmony)
            const chordIntervals = this.getChordIntervalsForScaleDegree(rootInScale, requestedCount);

            // Build chord from root
            let currentIndex = scale.indexOf(rootMidi);
            if (currentIndex === -1) {
                // Root not in scale, find closest
                for (let i = 0; i < scale.length; i++) {
                    if (Math.abs(scale[i] - rootMidi) <= 1) {
                        currentIndex = i;
                        break;
                    }
                }
                if (currentIndex === -1) currentIndex = 0;
            }

            // Add root note
            const rootNote = scale[currentIndex];
            if (rootNote >= minMidi && rootNote <= maxMidi) {
                notes.add(rootNote);
            }

            // Add remaining notes based on intervals
            for (let i = 1; i < requestedCount && i < chordIntervals.length; i++) {
                const interval = chordIntervals[i];
                let nextIndex = currentIndex;

                // Move by the interval (in scale degrees)
                for (let step = 0; step < interval; step++) {
                    nextIndex++;
                    if (nextIndex >= scale.length) {
                        nextIndex = nextIndex % scale.length;
                    }
                }

                if (nextIndex < scale.length) {
                    let note = scale[nextIndex];

                    // ✅ INTELLIGENT RANGE CHECK with octave transposition
                    if (note < minMidi) {
                        note = note + 12;
                    } else if (note > maxMidi) {
                        note = note - 12;
                    }

                    // Only add if in range and not duplicate
                    if (note >= minMidi && note <= maxMidi) {
                        notes.add(note);
                    }
                }
            }

            // Convert Set to sorted array
            let result = Array.from(notes).sort((a, b) => a - b);

            // USER FIX: Ensure maximum 5 notes per staff
            // Split by staff and limit each
            const trebleNotes = result.filter(n => n >= 60).slice(0, maxNotesPerStaff);
            const bassNotes = result.filter(n => n < 60).slice(0, maxNotesPerStaff);

            // Combine limited notes
            result = [...bassNotes, ...trebleNotes].sort((a, b) => a - b);

            // ✅ FINAL CHECK: Ensure no duplicates (redundant but safe)
            result = [...new Set(result)];

            // ✅ USER REQUEST: For chords with 3+ notes, apply professional voicing
            if (result.length >= 3) {
                return this.voiceChordAcrossStaves(result, minMidi, maxMidi);
            }

            return result;
        }

        /**
         * ✅ NEW: Get chord intervals based on scale degree
         * Returns intervals for building triads and 7th chords
         */
        getChordIntervalsForScaleDegree(degree, count) {
            // Intervals in scale degrees (not semitones!)
            // For major scale harmony:
            // I, IV, V = major (root, M3, P5, M7)
            // ii, iii, vi = minor (root, m3, P5, m7)
            // vii° = diminished (root, m3, d5)

            const baseIntervals = [0]; // Root

            // Add third (always 2 scale degrees up = third)
            if (count >= 2) {
                baseIntervals.push(2); // Third (M3 or m3 depending on scale)
            }

            // Add fifth (always 4 scale degrees up = fifth)
            if (count >= 3) {
                baseIntervals.push(4); // Fifth
            }

            // Add seventh (6 scale degrees up = seventh)
            if (count >= 4) {
                baseIntervals.push(6); // Seventh
            }

            // Add ninth (8 scale degrees up, wraps to next octave)
            if (count >= 5) {
                baseIntervals.push(8); // Ninth
            }

            return baseIntervals;
        }

        /**
         * ✅ NEW: Voice chord across treble and bass staves
         * Creates professional-sounding chord voicings
         * CRITICAL: Max 5 notes per staff, no duplicates
         */
        voiceChordAcrossStaves(notes, minMidi, maxMidi) {
            if (notes.length < 3) return [...new Set(notes)]; // Remove any duplicates

            const voicedNotes = new Set(); // Use Set to prevent duplicates
            const middleC = 60; // C4
            const maxNotesPerStaff = 5;

            // ✅ STRATEGY: Put bass note(s) below middle C, melody notes above
            // This creates a full, professional sound

            // Lowest note goes to bass (left hand)
            const bassNote = notes[0];
            if (bassNote < middleC) {
                voicedNotes.add(bassNote);
            } else {
                // Transpose down an octave for bass
                const transposedBass = bassNote - 12;
                if (transposedBass >= minMidi) {
                    voicedNotes.add(transposedBass);
                } else {
                    voicedNotes.add(bassNote); // Keep original if can't transpose
                }
            }

            // Middle and upper notes go to treble (right hand)
            for (let i = 1; i < notes.length; i++) {
                let note = notes[i];

                // Prefer notes above middle C for treble
                if (note < middleC && i < notes.length - 1) {
                    const transposed = note + 12; // Up one octave
                    if (transposed <= maxMidi && !voicedNotes.has(transposed)) {
                        note = transposed;
                    }
                }

                voicedNotes.add(note);
            }

            // Convert to array and sort
            let result = Array.from(voicedNotes).sort((a, b) => a - b);

            // USER FIX: Limit to max 5 notes per staff
            const trebleNotes = result.filter(n => n >= 60).slice(0, maxNotesPerStaff);
            const bassNotes = result.filter(n => n < 60).slice(0, maxNotesPerStaff);

            return [...bassNotes, ...trebleNotes].sort((a, b) => a - b);
        }

        getAccidental(midi, key) {
            // USER FIX: Smart accidental handling based on key signature
            // In standard notation:
            // - Notes IN the key signature DON'T need individual accidental symbols
            // - Only chromatic notes (outside the key) need accidental symbols
            const noteInOctave = midi % 12;
            const blackKeys = [1, 3, 6, 8, 10]; // C#, D#, F#, G#, A#

            // Key signature sharps/flats (notes that are part of the key and don't need symbols)
            const keySignatureSharps = {
                'C': [],           // No sharps/flats
                'G': [6],          // F#
                'D': [6, 1],       // F#, C#
                'A': [6, 1, 8],    // F#, C#, G#
                'E': [6, 1, 8, 3], // F#, C#, G#, D#
                'B': [6, 1, 8, 3, 10], // F#, C#, G#, D#, A#
                'F#': [6, 1, 8, 3, 10, 5] // All sharps (F# major)
            };

            const keySignatureFlats = {
                'C': [],
                'F': [10],         // Bb
                'Bb': [10, 3],     // Bb, Eb
                'Eb': [10, 3, 8],  // Bb, Eb, Ab
                'Ab': [10, 3, 8, 1], // Bb, Eb, Ab, Db
                'Db': [10, 3, 8, 1, 6], // All flats
                'Gb': [10, 3, 8, 1, 6, 11] // Gb major
            };

            // Build the set of all notes IN the key signature (all 7 scale degrees)
            // Major scale pattern: W W H W W W H (0,2,4,5,7,9,11)
            const rootMap = { 'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
                'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8,
                'A': 9, 'A#': 10, 'Bb': 10, 'B': 11 };
            const keyRoot = rootMap[key] || 0;
            const majorScale = [0, 2, 4, 5, 7, 9, 11];
            const notesInKey = new Set(majorScale.map(i => (keyRoot + i) % 12));

            // Get sharps/flats for this key
            const sharpsInKey = keySignatureSharps[key] || [];
            const flatsInKey = keySignatureFlats[key] || [];

            // Check if note is IN the key
            if (notesInKey.has(noteInOctave)) {
                // Note is diatonic to the key — no accidental needed
                return null;
            }

            // Note is NOT in the key — it needs an accidental
            if (blackKeys.includes(noteInOctave)) {
                // Black key not in key signature: show sharp or flat
                return flatsInKey.length > 0 ? 'flat' : 'sharp';
            } else {
                // White key not in key signature (e.g., C natural in C# major,
                // F natural in Gb major, B natural in Cb major)
                // This note needs a 'natural' accidental to cancel the key signature
                return 'natural';
            }
        }

        getDurationBeats(duration) {
            const beatMap = {
                'whole': 4,
                'dotted-half': 3,
                'half': 2,
                'dotted-quarter': 1.5,
                'quarter': 1,
                'dotted-eighth': 0.75,
                'eighth': 0.5,
                'dotted-sixteenth': 0.375,
                'sixteenth': 0.25,
                'thirty-second': 0.125
            };

            return beatMap[duration] || 1;
        }

        /**
         * Shuffle array using Fisher-Yates algorithm for better variety
         * CRITIQUE: Mélange aléatoire pour éviter patterns répétitifs
         */
        shuffleArray(array) {
            const shuffled = [...array]; // Copy array
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; // Swap
            }
            return shuffled;
        }
        
        generateTriads() {
            const notes = [];
            const settings = this.engine.userSettings;
            const range = this.getEffectiveRange();
            const keySignature = settings.key_signature || 'C';
            const scale = this.getScaleForKey(keySignature);
            const difficulty = settings.difficulty || 'beginner';
            const notesPerChord = Math.max(2, parseInt(settings.notes_count) || 3);
            const measureCount = this._getMeasureCount(difficulty);
            const diffConfig = this.engine.config.difficulties?.[difficulty];

            // Build DIATONIC triads from the scale (musically correct for the key)
            // Scale degree triads: I=maj, ii=min, iii=min, IV=maj, V=maj, vi=min, vii°=dim
            const scalePattern = [0, 2, 4, 5, 7, 9, 11]; // Major scale intervals
            const rootMap = { 'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
                'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8,
                'A': 9, 'A#': 10, 'Bb': 10, 'B': 11 };
            const keyRoot = rootMap[keySignature] || 0;

            // Build all 7 diatonic triads for this key (in MIDI relative to C4=60)
            const diatonicTriads = [];
            for (let degree = 0; degree < 7; degree++) {
                const root = 60 + keyRoot + scalePattern[degree];
                const third = 60 + keyRoot + scalePattern[(degree + 2) % 7] + (degree + 2 >= 7 ? 12 : 0);
                const fifth = 60 + keyRoot + scalePattern[(degree + 4) % 7] + (degree + 4 >= 7 ? 12 : 0);
                diatonicTriads.push([root, third, fifth]);
            }

            // Filter by difficulty: beginner = I, IV, V; intermediate adds ii, vi; advanced/expert all
            const allowedDegrees = {
                'beginner': [0, 3, 4],           // I, IV, V
                'elementary': [0, 3, 4, 5],      // I, IV, V, vi
                'intermediate': [0, 1, 3, 4, 5], // I, ii, IV, V, vi
                'advanced': [0, 1, 2, 3, 4, 5, 6],
                'expert': [0, 1, 2, 3, 4, 5, 6]
            };
            const degrees = allowedDegrees[difficulty] || allowedDegrees['beginner'];

            // Inversions for voice leading (advanced+)
            const useInversions = difficulty === 'advanced' || difficulty === 'expert';

            // Rhythm patterns vary by difficulty
            const rhythmPatterns = {
                'beginner': [['whole'], ['half', 'half']],
                'elementary': [['half', 'half'], ['dotted-half', 'quarter']],
                'intermediate': [['half', 'half'], ['quarter', 'quarter', 'half']],
                'advanced': [['quarter', 'quarter', 'quarter', 'quarter'], ['half', 'quarter', 'quarter']],
                'expert': [['quarter', 'quarter', 'quarter', 'quarter'], ['dotted-quarter', 'eighth', 'half']]
            };
            const rhythms = rhythmPatterns[difficulty] || rhythmPatterns['beginner'];

            let prevMidis = [];
            let lastDegree = -1;

            for (let measure = 0; measure < measureCount; measure++) {
                // Pick a diatonic triad, avoid repeating same degree twice
                let degree;
                do {
                    degree = degrees[Math.floor(Math.random() * degrees.length)];
                } while (degree === lastDegree && degrees.length > 1);
                lastDegree = degree;

                const baseTriad = diatonicTriads[degree];
                let triadMidis = baseTriad.slice(0, notesPerChord);

                // Voice leading: pick inversion closest to previous chord
                if (useInversions && prevMidis.length > 0) {
                    const prevAvg = prevMidis.reduce((a, b) => a + b, 0) / prevMidis.length;
                    const inversions = [
                        triadMidis, // Root position
                        triadMidis.map((m, i) => i === 0 ? m + 12 : m), // 1st inversion
                        triadMidis.map((m, i) => i <= 1 ? m + 12 : m)  // 2nd inversion
                    ];
                    let bestInv = triadMidis;
                    let bestDist = Infinity;
                    for (const inv of inversions) {
                        const avg = inv.reduce((a, b) => a + b, 0) / inv.length;
                        const dist = Math.abs(avg - prevAvg);
                        if (dist < bestDist) { bestDist = dist; bestInv = inv; }
                    }
                    triadMidis = bestInv;
                }

                // Clamp to range
                triadMidis = triadMidis.map(m => {
                    while (m < range.trebleMin) m += 12;
                    while (m > range.trebleMax) m -= 12;
                    return m;
                });

                const rhythm = rhythms[measure % rhythms.length];
                let beat = 0;
                rhythm.forEach(dur => {
                    triadMidis.forEach((midi, idx) => {
                        notes.push({
                            midi, duration: dur, measure, beat,
                            staff: midi >= 60 ? 'treble' : 'bass',
                            accidental: this.getAccidental(midi, keySignature),
                            isChord: triadMidis.length > 1, chordIndex: idx
                        });
                    });
                    beat += this.getDurationBeats(dur);
                });
                prevMidis = triadMidis;

                // Bass for 2 hands: root of the triad, octave below
                if (range.handsCount >= 2) {
                    const bassRoot = baseTriad[0] - 12;
                    const bassMidi = Math.max(range.bassMin, Math.min(range.bassMax, bassRoot));
                    notes.push({
                        midi: bassMidi, duration: 'whole', measure, beat: 0,
                        staff: 'bass', accidental: this.getAccidental(bassMidi, keySignature),
                        twoHands: true
                    });
                }
            }

            return notes;
        }

        generateChordExercise() {
            const notes = [];
            const settings = this.engine.userSettings;
            const keySignature = settings.key_signature || 'C';
            const scale = this.getScaleForKey(keySignature);
            const difficulty = settings.difficulty || 'beginner';
            const range = this.getEffectiveRange();
            const handsCount = range.handsCount;
            const notesPerChord = Math.max(2, parseInt(settings.notes_count) || 3);
            const measureCount = this._getMeasureCount(difficulty);

            // Chord interval patterns by type
            const chordPatterns = {
                'major': [0, 4, 7],
                'minor': [0, 3, 7],
                'dim': [0, 3, 6],
                'aug': [0, 4, 8],
                'maj7': [0, 4, 7, 11],
                'min7': [0, 3, 7, 10],
                'dom7': [0, 4, 7, 10],
                'dim7': [0, 3, 6, 9]
            };

            const availableTypes = difficulty === 'beginner' || difficulty === 'elementary'
                ? ['major', 'minor']
                : difficulty === 'intermediate'
                    ? ['major', 'minor', 'dim', 'aug']
                    : Object.keys(chordPatterns);

            // Rhythm patterns: vary by difficulty for more musical interest
            const rhythmPatterns = {
                'beginner': [['whole'], ['half', 'half']],
                'elementary': [['half', 'half'], ['dotted-half', 'quarter']],
                'intermediate': [['half', 'half'], ['quarter', 'quarter', 'half']],
                'advanced': [['quarter', 'quarter', 'half'], ['half', 'quarter', 'quarter']],
                'expert': [['quarter', 'quarter', 'quarter', 'quarter'], ['dotted-quarter', 'eighth', 'half']]
            };
            const rhythms = rhythmPatterns[difficulty] || rhythmPatterns['beginner'];

            let prevMidis = [];
            let lastChordType = '';

            for (let m = 0; m < measureCount; m++) {
                // Pick chord type, avoid repeating same type twice
                let chordType;
                do {
                    chordType = availableTypes[Math.floor(Math.random() * availableTypes.length)];
                } while (chordType === lastChordType && availableTypes.length > 1);
                lastChordType = chordType;

                const intervals = chordPatterns[chordType];
                const scaleTones = scale.filter(midi => midi >= range.trebleMin && midi <= range.trebleMax - 12);
                let root = scaleTones[Math.floor(Math.random() * scaleTones.length)] || range.trebleMin;

                // Voice leading: if we have previous chord, pick root that minimizes movement
                if (prevMidis.length > 0 && scaleTones.length > 2) {
                    const prevAvg = prevMidis.reduce((a, b) => a + b, 0) / prevMidis.length;
                    let bestRoot = root;
                    let bestDist = Infinity;
                    for (const candidate of scaleTones) {
                        const chordMidis = intervals.slice(0, notesPerChord).map(i => candidate + i);
                        const avg = chordMidis.reduce((a, b) => a + b, 0) / chordMidis.length;
                        const dist = Math.abs(avg - prevAvg);
                        if (dist < bestDist && dist > 0) { bestDist = dist; bestRoot = candidate; }
                    }
                    root = bestRoot;
                }

                const rhythm = rhythms[m % rhythms.length];
                let beat = 0;

                rhythm.forEach((dur) => {
                    const chordMidis = intervals.slice(0, notesPerChord).map(i =>
                        Math.max(range.trebleMin, Math.min(range.trebleMax, root + i))
                    );
                    chordMidis.forEach((midi, idx) => {
                        notes.push({
                            midi, duration: dur, measure: m, beat,
                            staff: midi >= 60 ? 'treble' : 'bass',
                            accidental: this.getAccidental(midi, keySignature),
                            isChord: chordMidis.length > 1, chordIndex: idx
                        });
                    });
                    prevMidis = chordMidis;
                    beat += this.getDurationBeats(dur);
                });

                // Bass notes for 2 hands: root of chord
                if (handsCount === 2) {
                    const bassRoot = Math.max(range.bassMin, Math.min(range.bassMax, root - 12));
                    notes.push({
                        midi: bassRoot, duration: 'whole', measure: m, beat: 0,
                        staff: 'bass', accidental: this.getAccidental(bassRoot, keySignature),
                        twoHands: true
                    });
                }

                // Musical phrasing: add rest every 4th measure (intermediate+)
                if (m > 0 && m % 4 === 3 && difficulty !== 'beginner') {
                    const lastBeat = notes.filter(n => n.measure === m).reduce((max, n) => Math.max(max, n.beat), 0);
                    const lastNotes = notes.filter(n => n.measure === m && snapBeat(n.beat) === snapBeat(lastBeat));
                    lastNotes.forEach(n => { n.isRest = true; n.midi = null; });
                }
            }

            return notes;
        }

        generateIntervals() {
            const notes = [];
            const settings = this.engine.userSettings;
            const range = this.getEffectiveRange();
            const keySignature = settings.key_signature || 'C';
            const scale = this.getScaleForKey(keySignature);
            const trebleScale = scale.filter(m => m >= range.trebleMin && m <= range.trebleMax);
            const minMidi = range.trebleMin;
            const maxMidi = range.trebleMax;

            // Interval ranges by difficulty — named intervals for educational value
            const intervalsByDifficulty = {
                'beginner': [
                    { semi: 2, name: 'M2' }, { semi: 4, name: 'M3' },
                    { semi: 5, name: 'P4' }, { semi: 7, name: 'P5' }
                ],
                'elementary': [
                    { semi: 2, name: 'M2' }, { semi: 3, name: 'm3' }, { semi: 4, name: 'M3' },
                    { semi: 5, name: 'P4' }, { semi: 7, name: 'P5' }, { semi: 9, name: 'M6' }
                ],
                'intermediate': [
                    { semi: 1, name: 'm2' }, { semi: 2, name: 'M2' }, { semi: 3, name: 'm3' },
                    { semi: 4, name: 'M3' }, { semi: 5, name: 'P4' }, { semi: 6, name: 'TT' },
                    { semi: 7, name: 'P5' }, { semi: 8, name: 'm6' }, { semi: 9, name: 'M6' },
                    { semi: 10, name: 'm7' }, { semi: 11, name: 'M7' }, { semi: 12, name: 'P8' }
                ],
                'advanced': [
                    { semi: 1, name: 'm2' }, { semi: 2, name: 'M2' }, { semi: 3, name: 'm3' },
                    { semi: 4, name: 'M3' }, { semi: 5, name: 'P4' }, { semi: 6, name: 'TT' },
                    { semi: 7, name: 'P5' }, { semi: 8, name: 'm6' }, { semi: 9, name: 'M6' },
                    { semi: 10, name: 'm7' }, { semi: 11, name: 'M7' }, { semi: 12, name: 'P8' },
                    { semi: 14, name: 'M9' }, { semi: 16, name: 'M10' }
                ],
                'expert': [
                    { semi: 1, name: 'm2' }, { semi: 3, name: 'm3' }, { semi: 5, name: 'P4' },
                    { semi: 6, name: 'TT' }, { semi: 8, name: 'm6' }, { semi: 10, name: 'm7' },
                    { semi: 12, name: 'P8' }, { semi: 14, name: 'M9' }, { semi: 16, name: 'M10' },
                    { semi: 19, name: 'P12' }, { semi: 24, name: 'P15' }
                ]
            };
            const difficulty = settings.difficulty || 'beginner';
            const intervals = intervalsByDifficulty[difficulty] || intervalsByDifficulty.beginner;
            const measureCount = this._getMeasureCount(difficulty);

            // Exercise patterns: harmonic, melodic ascending, melodic descending, call-response
            const patterns = difficulty === 'beginner'
                ? ['melodic_asc', 'melodic_desc', 'harmonic']
                : ['melodic_asc', 'melodic_desc', 'harmonic', 'call_response'];

            let lastRoot = -1;

            for (let measure = 0; measure < measureCount; measure++) {
                const { semi: interval } = intervals[Math.floor(Math.random() * intervals.length)];
                const pattern = patterns[measure % patterns.length];

                // Pick root from scale, avoid repeating same root
                let root;
                const safeMax = maxMidi - interval;
                do {
                    root = trebleScale.length > 0
                        ? trebleScale[Math.floor(Math.random() * trebleScale.length)]
                        : minMidi + Math.floor(Math.random() * (safeMax - minMidi));
                } while (root === lastRoot && trebleScale.length > 1);
                lastRoot = root;

                // Clamp so root + interval stays in range
                if (root + interval > maxMidi) root = maxMidi - interval;
                if (root < minMidi) root = minMidi;

                const dir = Math.random() < 0.5 ? 1 : -1; // up or down

                switch (pattern) {
                    case 'harmonic': {
                        // Both notes simultaneously, then resolve to root
                        [root, root + interval].forEach(midi => {
                            notes.push({
                                midi, duration: 'half', measure, beat: 0,
                                staff: midi >= 60 ? 'treble' : 'bass',
                                accidental: this.getAccidental(midi, keySignature),
                                isChord: true
                            });
                        });
                        // Resolution: root alone
                        notes.push({
                            midi: root, duration: 'half', measure, beat: 2,
                            staff: root >= 60 ? 'treble' : 'bass',
                            accidental: this.getAccidental(root, keySignature)
                        });
                        break;
                    }
                    case 'melodic_asc': {
                        // Ascending: low note → high note, with approach note
                        notes.push({
                            midi: root, duration: 'quarter', measure, beat: 0,
                            staff: root >= 60 ? 'treble' : 'bass',
                            accidental: this.getAccidental(root, keySignature)
                        });
                        notes.push({
                            midi: root + interval, duration: 'half', measure, beat: 1,
                            staff: (root + interval) >= 60 ? 'treble' : 'bass',
                            accidental: this.getAccidental(root + interval, keySignature)
                        });
                        // Resolution back to root
                        notes.push({
                            midi: root, duration: 'quarter', measure, beat: 3,
                            staff: root >= 60 ? 'treble' : 'bass',
                            accidental: this.getAccidental(root, keySignature)
                        });
                        break;
                    }
                    case 'melodic_desc': {
                        const high = root + interval;
                        notes.push({
                            midi: high, duration: 'quarter', measure, beat: 0,
                            staff: high >= 60 ? 'treble' : 'bass',
                            accidental: this.getAccidental(high, keySignature)
                        });
                        notes.push({
                            midi: root, duration: 'half', measure, beat: 1,
                            staff: root >= 60 ? 'treble' : 'bass',
                            accidental: this.getAccidental(root, keySignature)
                        });
                        notes.push({
                            midi: high, duration: 'quarter', measure, beat: 3,
                            staff: high >= 60 ? 'treble' : 'bass',
                            accidental: this.getAccidental(high, keySignature)
                        });
                        break;
                    }
                    case 'call_response': {
                        // Call: play interval ascending. Response: descending
                        const high = root + interval;
                        notes.push({ midi: root, duration: 'eighth', measure, beat: 0, staff: root >= 60 ? 'treble' : 'bass', accidental: this.getAccidental(root, keySignature) });
                        notes.push({ midi: high, duration: 'quarter', measure, beat: 0.5, staff: high >= 60 ? 'treble' : 'bass', accidental: this.getAccidental(high, keySignature) });
                        notes.push({ midi: high, duration: 'eighth', measure, beat: 2, staff: high >= 60 ? 'treble' : 'bass', accidental: this.getAccidental(high, keySignature) });
                        notes.push({ midi: root, duration: 'quarter', measure, beat: 2.5, staff: root >= 60 ? 'treble' : 'bass', accidental: this.getAccidental(root, keySignature) });
                        break;
                    }
                }

                // Add bass for 2 hands
                if (range.handsCount >= 2) {
                    const bassRoot = Math.max(range.bassMin, Math.min(range.bassMax, root - 12));
                    notes.push({
                        midi: bassRoot, duration: 'whole', measure, beat: 0,
                        staff: 'bass', accidental: this.getAccidental(bassRoot, keySignature),
                        twoHands: true
                    });
                }
            }
            return notes;
        }

        generateArpeggios() {
            const notes = [];
            const settings = this.engine.userSettings;
            const range = this.getEffectiveRange();
            const keySignature = settings.key_signature || 'C';
            const difficulty = settings.difficulty || 'beginner';
            const handsCount = range.handsCount;
            const scale = this.getScaleForKey(keySignature);

            // Chord types by difficulty
            const chordsByDifficulty = {
                'beginner': [
                    { name: 'Major', intervals: [0, 4, 7] },
                    { name: 'Minor', intervals: [0, 3, 7] }
                ],
                'elementary': [
                    { name: 'Major', intervals: [0, 4, 7] },
                    { name: 'Minor', intervals: [0, 3, 7] },
                    { name: 'Sus4', intervals: [0, 5, 7] }
                ],
                'intermediate': [
                    { name: 'Major', intervals: [0, 4, 7] },
                    { name: 'Minor', intervals: [0, 3, 7] },
                    { name: 'Dim', intervals: [0, 3, 6] },
                    { name: 'Aug', intervals: [0, 4, 8] },
                    { name: 'Maj7', intervals: [0, 4, 7, 11] }
                ],
                'advanced': [
                    { name: 'Maj7', intervals: [0, 4, 7, 11] },
                    { name: 'Min7', intervals: [0, 3, 7, 10] },
                    { name: 'Dom7', intervals: [0, 4, 7, 10] },
                    { name: 'Dim7', intervals: [0, 3, 6, 9] }
                ],
                'expert': [
                    { name: 'Maj9', intervals: [0, 4, 7, 11, 14] },
                    { name: 'Min9', intervals: [0, 3, 7, 10, 14] },
                    { name: 'Dom7', intervals: [0, 4, 7, 10] },
                    { name: 'Dim7', intervals: [0, 3, 6, 9] },
                    { name: 'Min7b5', intervals: [0, 3, 6, 10] }
                ]
            };

            // Arpeggio patterns by difficulty
            const patternsByDifficulty = {
                'beginner': ['up'],
                'elementary': ['up', 'down'],
                'intermediate': ['up-down', 'down-up'],
                'advanced': ['up-down', 'up-2oct', 'broken'],
                'expert': ['up-down-2oct', 'broken', 'alberti']
            };

            const availableChords = chordsByDifficulty[difficulty] || chordsByDifficulty['beginner'];
            const availablePatterns = patternsByDifficulty[difficulty] || ['up'];
            const measureCount = this._getMeasureCount(difficulty);
            const noteDuration = (difficulty === 'advanced' || difficulty === 'expert') ? 'eighth' : 'quarter';
            const beatsPerNote = noteDuration === 'eighth' ? 0.5 : 1;

            // Pick roots from the scale in the key
            const validRoots = scale.filter(m => m >= range.trebleMin && m <= range.trebleMax - 12);
            let lastRoot = -1;

            for (let measure = 0; measure < measureCount; measure++) {
                const chordType = availableChords[Math.floor(Math.random() * availableChords.length)];
                const patternType = availablePatterns[Math.floor(Math.random() * availablePatterns.length)];

                // Pick root, avoid repeating the same root
                let root;
                do {
                    root = validRoots.length > 0
                        ? validRoots[Math.floor(Math.random() * validRoots.length)]
                        : range.trebleMin;
                } while (root === lastRoot && validRoots.length > 1);
                lastRoot = root;

                const intervals = chordType.intervals;

                // Build the arpeggio pattern
                let sequence = [];
                switch (patternType) {
                    case 'up':
                        sequence = [...intervals, intervals[0] + 12]; // up to octave
                        break;
                    case 'down':
                        sequence = [intervals[0] + 12, ...intervals.slice().reverse()];
                        break;
                    case 'up-down':
                        sequence = [...intervals, intervals[0] + 12, ...intervals.slice().reverse()];
                        break;
                    case 'down-up':
                        sequence = [...intervals.slice().reverse(), ...intervals.slice(1), intervals[0] + 12];
                        break;
                    case 'up-2oct':
                        sequence = [...intervals, ...intervals.map(i => i + 12)];
                        break;
                    case 'up-down-2oct':
                        sequence = [...intervals, ...intervals.map(i => i + 12),
                            ...intervals.slice().reverse().map(i => i + 12),
                            ...intervals.slice().reverse()];
                        break;
                    case 'broken':
                        // 1-3-2-4-3-5 pattern
                        for (let i = 0; i < intervals.length - 1; i++) {
                            sequence.push(intervals[i], intervals[i + 1]);
                        }
                        sequence.push(intervals[0] + 12);
                        break;
                    case 'alberti':
                        // Low-high-mid-high pattern (like Alberti bass)
                        if (intervals.length >= 3) {
                            sequence = [intervals[0], intervals[2], intervals[1], intervals[2],
                                        intervals[0], intervals[2], intervals[1], intervals[2]];
                        } else {
                            sequence = [...intervals, ...intervals.slice().reverse()];
                        }
                        break;
                    default:
                        sequence = [...intervals];
                }

                // Fill the measure with the pattern, trimming to fit
                const maxBeats = 4;
                let beat = 0;
                for (let i = 0; i < sequence.length && beat < maxBeats; i++) {
                    const midi = root + sequence[i];
                    if (midi >= range.trebleMin && midi <= range.trebleMax) {
                        notes.push({
                            midi, duration: noteDuration, measure, beat,
                            staff: midi >= 60 ? 'treble' : 'bass',
                            accidental: this.getAccidental(midi, keySignature)
                        });
                    }
                    beat += beatsPerNote;
                }

                // Add bass accompaniment for 2 hands
                if (handsCount === 2) {
                    const bassRoot = root - 12;
                    if (bassRoot >= range.bassMin) {
                        notes.push({
                            midi: bassRoot, duration: 'half', measure, beat: 0,
                            staff: 'bass', accidental: this.getAccidental(bassRoot, keySignature)
                        });
                        notes.push({
                            midi: bassRoot + intervals[intervals.length > 2 ? 2 : 1],
                            duration: 'half', measure, beat: 2,
                            staff: 'bass',
                            accidental: this.getAccidental(bassRoot + intervals[intervals.length > 2 ? 2 : 1], keySignature)
                        });
                    }
                }
            }
            return notes;
        }

        generateScales() {
            const notes = [];
            const settings = this.engine.userSettings;

            // USER REQUEST: Complete scale library with all 24 scales (12 major + 12 minor)
            // Use key_signature (from Key Signature buttons) instead of deprecated scale_root
            const scaleRoot = settings.key_signature || settings.scale_root || 'C'; // Default C
            const scaleType = settings.scale_type || 'major'; // Default major
            const scalePattern = settings.scale_pattern || 'ascending-descending'; // Default pattern

            // All 12 scale roots (chromatic)
            const rootMap = {
                'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
                'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
                'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
            };

            // Scale patterns (intervals in semitones from root)
            const scalePatterns = {
                'major': [0, 2, 4, 5, 7, 9, 11, 12], // W-W-H-W-W-W-H
                'minor': [0, 2, 3, 5, 7, 8, 10, 12], // Natural minor W-H-W-W-H-W-W
                'harmonic-minor': [0, 2, 3, 5, 7, 8, 11, 12],
                'melodic-minor': [0, 2, 3, 5, 7, 9, 11, 12]
            };

            const scale = scalePatterns[scaleType] || scalePatterns.major;
            const rootOffset = rootMap[scaleRoot] || 0;

            // Apply range and hands configuration
            const range = this.getEffectiveRange();
            const handsCount = range.handsCount;
            let startMidi;
            if (handsCount === 1) {
                startMidi = 48 + rootOffset;
                while (startMidi < range.trebleMin) startMidi += 12;
                while (startMidi > range.trebleMax - 12) startMidi -= 12;
            } else {
                startMidi = 36 + rootOffset;
                while (startMidi < range.bassMin) startMidi += 12;
                while (startMidi > 60) startMidi -= 12;
            }

            // Generate scale exercise based on pattern
            switch (scalePattern) {
                case 'ascending':
                    this.generateScaleAscending(notes, scale, startMidi, handsCount);
                    break;
                case 'descending':
                    this.generateScaleDescending(notes, scale, startMidi, handsCount);
                    break;
                case 'ascending-descending':
                    this.generateScaleAscendingDescending(notes, scale, startMidi, handsCount);
                    break;
                case 'thirds':
                    this.generateScaleThirds(notes, scale, startMidi, handsCount);
                    break;
                case 'fourths':
                    this.generateScaleFourths(notes, scale, startMidi, handsCount);
                    break;
                case 'broken-chords':
                    this.generateScaleBrokenChords(notes, scale, startMidi, handsCount);
                    break;
                case 'pattern-1-2-3':
                    this.generateScalePattern123(notes, scale, startMidi, handsCount);
                    break;
                case 'random':
                    this.generateScaleRandom(notes, scale, startMidi, handsCount);
                    break;
                default:
                    this.generateScaleAscendingDescending(notes, scale, startMidi, handsCount);
            }

            return notes;
        }

        // Helper: add a note to scale, handles 1 or 2 hands
        _addScaleNote(notes, midi, noteIndex, handsCount, startMidi, duration = 'eighth') {
            const beatsPerNote = this.getDurationBeats(duration);
            const notesPerMeasure = Math.round(4 / beatsPerNote);
            const measure = Math.floor(noteIndex / notesPerMeasure);
            const beat = (noteIndex % notesPerMeasure) * beatsPerNote;

            if (handsCount === 2) {
                // Bass is 1 octave below treble
                const trebleMidi = Math.max(60, midi);
                const bassMidi = trebleMidi - 12;
                notes.push({ midi: trebleMidi, duration, measure, beat, staff: 'treble' });
                notes.push({ midi: bassMidi, duration, measure, beat, staff: 'bass' });
            } else {
                notes.push({ midi, duration, measure, beat, staff: midi >= 60 ? 'treble' : 'bass' });
            }
        }

        // Generate ascending scale — 3 octaves for a proper exercise
        generateScaleAscending(notes, scale, startMidi, handsCount) {
            const octaves = 3;
            let noteIndex = 0;
            for (let octave = 0; octave < octaves; octave++) {
                for (const interval of scale) {
                    const midi = startMidi + interval + (octave * 12);
                    this._addScaleNote(notes, midi, noteIndex, handsCount, startMidi);
                    noteIndex++;
                }
            }
            // End on the root an octave higher (resolution)
            this._addScaleNote(notes, startMidi + (octaves * 12), noteIndex, handsCount, startMidi, 'quarter');
        }

        // Generate descending scale — 3 octaves
        generateScaleDescending(notes, scale, startMidi, handsCount) {
            const octaves = 3;
            let noteIndex = 0;
            // Start from highest octave and descend
            for (let octave = octaves - 1; octave >= 0; octave--) {
                const reversed = scale.slice().reverse();
                for (const interval of reversed) {
                    const midi = startMidi + interval + (octave * 12);
                    this._addScaleNote(notes, midi, noteIndex, handsCount, startMidi);
                    noteIndex++;
                }
            }
            // End on root (resolution)
            this._addScaleNote(notes, startMidi, noteIndex, handsCount, startMidi, 'quarter');
        }

        // Generate ascending then descending scale
        generateScaleAscendingDescending(notes, scale, startMidi, handsCount) {
            // Ascending part
            this.generateScaleAscending(notes, scale, startMidi, handsCount);

            // Calculate how many "slots" the ascending part used
            // Each slot = 1 eighth note position. With 2 hands, each slot has 2 notes (treble+bass)
            const notesPerSlot = handsCount === 2 ? 2 : 1;
            const ascSlots = notes.length / notesPerSlot;

            // Descending part — build into temp array then merge with correct timing
            const descNotes = [];
            this.generateScaleDescending(descNotes, scale, startMidi, handsCount);

            // Re-time descending notes to continue after ascending
            descNotes.forEach((note, idx) => {
                const slotIdx = Math.floor(idx / notesPerSlot);
                const globalSlot = ascSlots + slotIdx;
                note.measure = Math.floor(globalSlot / 8);
                note.beat = (globalSlot % 8) * 0.5;
            });
            notes.push(...descNotes);
        }

        // Generate scale in thirds (C-E, D-F, E-G, etc.) — 2 octaves
        generateScaleThirds(notes, scale, startMidi, handsCount) {
            let noteIndex = 0;
            for (let oct = 0; oct < 2; oct++) {
                const ext = [...scale, scale[0] + 12, scale[1] + 12, scale[2] + 12];
                for (let i = 0; i < scale.length; i++) {
                    this._addScaleNote(notes, startMidi + scale[i] + oct * 12, noteIndex, handsCount, startMidi);
                    noteIndex++;
                    this._addScaleNote(notes, startMidi + ext[i + 2] + oct * 12, noteIndex, handsCount, startMidi);
                    noteIndex++;
                }
            }
            // Resolution
            this._addScaleNote(notes, startMidi, noteIndex, handsCount, startMidi, 'quarter');
        }

        // Generate scale in fourths — 2 octaves
        generateScaleFourths(notes, scale, startMidi, handsCount) {
            let noteIndex = 0;
            for (let oct = 0; oct < 2; oct++) {
                const ext = [...scale, scale[0] + 12, scale[1] + 12, scale[2] + 12, scale[3] + 12];
                for (let i = 0; i < scale.length; i++) {
                    this._addScaleNote(notes, startMidi + scale[i] + oct * 12, noteIndex, handsCount, startMidi);
                    noteIndex++;
                    this._addScaleNote(notes, startMidi + ext[i + 3] + oct * 12, noteIndex, handsCount, startMidi);
                    noteIndex++;
                }
            }
            this._addScaleNote(notes, startMidi, noteIndex, handsCount, startMidi, 'quarter');
        }

        // Generate broken chord pattern (arpeggios from scale degrees) — 2 octaves
        generateScaleBrokenChords(notes, scale, startMidi, handsCount) {
            let noteIndex = 0;
            for (let oct = 0; oct < 2; oct++) {
                // Triads: 1-3-5, 2-4-6, 3-5-7, etc. then back down
                for (let i = 0; i < scale.length - 4; i++) {
                    const triad = [scale[i], scale[i + 2], scale[i + 4], scale[i + 2]];
                    for (const interval of triad) {
                        this._addScaleNote(notes, startMidi + interval + oct * 12, noteIndex, handsCount, startMidi);
                        noteIndex++;
                    }
                }
            }
            // Resolution chord
            this._addScaleNote(notes, startMidi, noteIndex, handsCount, startMidi, 'quarter');
        }

        // Generate 1-2-3 pattern (C-D-E, D-E-F, E-F-G, etc.) — 2 octaves
        generateScalePattern123(notes, scale, startMidi, handsCount) {
            let noteIndex = 0;
            for (let oct = 0; oct < 2; oct++) {
                for (let i = 0; i < scale.length - 2; i++) {
                    for (let j = 0; j < 3; j++) {
                        this._addScaleNote(notes, startMidi + scale[i + j] + oct * 12, noteIndex, handsCount, startMidi);
                        noteIndex++;
                    }
                }
            }
            this._addScaleNote(notes, startMidi, noteIndex, handsCount, startMidi, 'quarter');
        }

        // Generate random scale exercise — longer (8 measures)
        generateScaleRandom(notes, scale, startMidi, handsCount) {
            const numNotes = 64; // 8 measures of 8 eighth notes
            let prevIdx = Math.floor(scale.length / 2);
            for (let i = 0; i < numNotes; i++) {
                // Melodic motion: step within scale, occasionally leap
                const leap = Math.random() < 0.15;
                const step = leap ? (Math.floor(Math.random() * 5) - 2) : (Math.floor(Math.random() * 3) - 1);
                prevIdx = Math.max(0, Math.min(scale.length - 1, prevIdx + step));
                const octaveOffset = Math.floor(Math.random() * 2) * 12;
                const midi = startMidi + scale[prevIdx] + octaveOffset;
                this._addScaleNote(notes, midi, i, handsCount, startMidi);
            }
            // End on root
            this._addScaleNote(notes, startMidi, numNotes, handsCount, startMidi, 'quarter');
        }
        
        generateProgression() {
            const notes = [];
            const settings = this.engine.userSettings;
            const range = this.getEffectiveRange();
            const difficulty = settings.difficulty || 'beginner';
            const keySignature = settings.key_signature || 'C';
            const notesPerChord = Math.max(2, parseInt(settings.notes_count) || 3);
            const measureCount = this._getMeasureCount(difficulty);

            // Get the root MIDI for the key signature
            const rootMap = {
                'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
                'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
                'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
            };
            const keyRoot = (rootMap[keySignature] || 0);

            // Chord voicings with inversions for voice leading
            const chordVoicings = {
                'I':   { root: [0, 4, 7],    inv1: [4, 7, 12],   inv2: [7, 12, 16] },
                'ii':  { root: [2, 5, 9],    inv1: [5, 9, 14],   inv2: [9, 14, 17] },
                'iii': { root: [4, 7, 11],   inv1: [7, 11, 16],  inv2: [11, 16, 19] },
                'IV':  { root: [5, 9, 12],   inv1: [9, 12, 17],  inv2: [12, 17, 21] },
                'V':   { root: [7, 11, 14],  inv1: [11, 14, 19], inv2: [14, 19, 23] },
                'V7':  { root: [7, 11, 14, 17], inv1: [11, 14, 17, 19], inv2: [14, 17, 19, 23] },
                'vi':  { root: [9, 12, 16],  inv1: [12, 16, 21], inv2: [16, 21, 24] },
                'vii': { root: [11, 14, 17], inv1: [14, 17, 23], inv2: [17, 23, 26] },
            };

            // Rich progression library
            const progressions = {
                'beginner':     [['I', 'IV', 'V', 'I'], ['I', 'V', 'I', 'V']],
                'elementary':   [['I', 'vi', 'IV', 'V'], ['I', 'IV', 'V', 'I'], ['I', 'V', 'vi', 'IV']],
                'intermediate': [['I', 'vi', 'IV', 'V'], ['I', 'IV', 'vi', 'V'], ['I', 'V', 'vi', 'IV'],
                                 ['I', 'ii', 'V', 'I'], ['vi', 'IV', 'I', 'V']],
                'advanced':     [['I', 'vi', 'ii', 'V7'], ['I', 'iii', 'IV', 'V7'], ['vi', 'IV', 'I', 'V'],
                                 ['I', 'IV', 'ii', 'V7', 'I', 'vi', 'IV', 'V7']],
                'expert':       [['I', 'vi', 'ii', 'V7'], ['I', 'iii', 'vi', 'ii', 'V7', 'I'],
                                 ['I', 'IV', 'vii', 'iii', 'vi', 'ii', 'V7', 'I']]
            };

            const availableProgs = progressions[difficulty] || progressions['beginner'];
            const selectedProg = availableProgs[Math.floor(Math.random() * availableProgs.length)];

            // Voice leading: pick inversion that minimizes movement
            const pickBestVoicing = (chord, prevMidis) => {
                const voicing = chordVoicings[chord] || chordVoicings['I'];
                if (!prevMidis || prevMidis.length === 0) return voicing.root;
                const prevAvg = prevMidis.reduce((a, b) => a + b, 0) / prevMidis.length;
                let bestInv = voicing.root;
                let bestDist = Infinity;
                for (const inv of [voicing.root, voicing.inv1, voicing.inv2]) {
                    const midis = inv.map(i => 60 + keyRoot + i);
                    const avg = midis.reduce((a, b) => a + b, 0) / midis.length;
                    const dist = Math.abs(avg - prevAvg);
                    if (dist < bestDist) { bestDist = dist; bestInv = inv; }
                }
                return bestInv;
            };

            // Rhythm patterns by difficulty
            const rhythmSets = {
                'beginner':     [['whole'], ['half', 'half']],
                'elementary':   [['half', 'half'], ['whole'], ['dotted-half', 'quarter']],
                'intermediate': [['half', 'half'], ['quarter', 'quarter', 'half'], ['dotted-half', 'quarter']],
                'advanced':     [['half', 'quarter', 'quarter'], ['quarter', 'quarter', 'half'], ['dotted-half', 'quarter']],
                'expert':       [['quarter', 'quarter', 'quarter', 'quarter'], ['half', 'quarter', 'quarter'], ['dotted-quarter', 'eighth', 'half']]
            };
            const rhythms = rhythmSets[difficulty] || rhythmSets['beginner'];

            let prevMidis = [];

            for (let m = 0; m < measureCount; m++) {
                const chordNumeral = selectedProg[m % selectedProg.length];
                const intervals = pickBestVoicing(chordNumeral, prevMidis);
                const selectedIntervals = intervals.slice(0, notesPerChord);
                const rhythm = rhythms[m % rhythms.length];

                let beat = 0;
                rhythm.forEach((dur) => {
                    const midis = selectedIntervals.map(i => {
                        const raw = 60 + keyRoot + i;
                        return Math.max(range.trebleMin, Math.min(range.trebleMax, raw));
                    });
                    midis.forEach((midi, idx) => {
                        notes.push({
                            midi, duration: dur, measure: m, beat,
                            staff: midi >= 60 ? 'treble' : 'bass',
                            accidental: this.getAccidental(midi, keySignature),
                            isChord: true, chordIndex: idx
                        });
                    });
                    prevMidis = midis;
                    beat += this.getDurationBeats(dur);
                });

                // Bass for 2 hands
                if (range.handsCount >= 2) {
                    const bassBase = 60 + keyRoot + intervals[0] - 24;
                    const bassMidi = Math.max(range.bassMin, Math.min(range.bassMax, bassBase));
                    const bassFifth = Math.max(range.bassMin, Math.min(range.bassMax, bassBase + 7));
                    if (rhythm[0] === 'whole') {
                        notes.push({
                            midi: bassMidi, duration: 'whole', measure: m, beat: 0,
                            staff: 'bass', accidental: this.getAccidental(bassMidi, keySignature), twoHands: true
                        });
                    } else {
                        notes.push({
                            midi: bassMidi, duration: 'half', measure: m, beat: 0,
                            staff: 'bass', accidental: this.getAccidental(bassMidi, keySignature), twoHands: true
                        });
                        notes.push({
                            midi: bassFifth, duration: 'half', measure: m, beat: 2,
                            staff: 'bass', accidental: this.getAccidental(bassFifth, keySignature), twoHands: true
                        });
                    }
                }
            }

            return notes;
        }
        
        getRandomMidi() {
            const min = this.midiFromNote(this.engine.userSettings.note_range_min || 'C3');
            const max = this.midiFromNote(this.engine.userSettings.note_range_max || 'C5');
            return Math.floor(Math.random() * (max - min + 1)) + min;
        }
        
        midiFromNote(note) {
            const noteMap = {
                'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11
            };
            
            const matches = note.match(/([A-G])(\d+)/);
            if (!matches) {
                return 60;
            }
            
            const noteName = matches[1];
            const octave = parseInt(matches[2]);
            
            return (octave + 1) * 12 + (noteMap[noteName] || 0);
        }
    }

    /**
     * MusicGlyphs — Path2D glyph library for professional music notation rendering.
     * All SVG paths sourced from noteworthy-master (public domain / MIT).
     * Treble & bass clef paths from Wikimedia Commons (public domain).
     */
    class MusicGlyphs {
        constructor(staffSpacing = 12) {
            this.staffSpacing = staffSpacing;
            // Base scale for rendering — adjusts SVG coordinate space to screen pixels
            this.baseScale = staffSpacing / 15;
            this.glyphs = {};

            // ── Noteheads (Contemporary engraving — tilted ellipses) ──────
            // Filled notehead — slightly tilted, proportions matching Bravura/Leland fonts
            // Wider and shorter than a circle, with natural leftward tilt
            this._register('noteheadFilled',
                'M 8.5 0 C 12.8 -1.2 16.0 -3.8 16.0 -6.0 C 16.0 -8.4 12.2 -10.2 7.5 -10.0 C 3.2 -9.8 0 -7.2 0 -5.0 C 0 -2.6 3.8 -0.8 8.5 0 Z',
                8.0, -5.0);

            // Half notehead — same outer shape with inner cutout (evenodd fill)
            this._register('noteheadHalf',
                'M 8.5 0 C 12.8 -1.2 16.0 -3.8 16.0 -6.0 C 16.0 -8.4 12.2 -10.2 7.5 -10.0 C 3.2 -9.8 0 -7.2 0 -5.0 C 0 -2.6 3.8 -0.8 8.5 0 Z M 7.0 -1.8 C 4.5 -2.0 2.2 -3.5 2.2 -5.2 C 2.2 -7.0 4.8 -8.2 7.8 -8.0 C 10.5 -7.8 12.8 -6.5 12.8 -4.8 C 12.8 -3.0 10.0 -1.8 7.0 -1.8 Z',
                8.0, -5.0);

            // Whole notehead — wider oval with large hole (evenodd fill)
            this._register('noteheadWhole',
                'M 10.0 0 C 15.5 -0.5 20.0 -3.2 20.0 -6.0 C 20.0 -8.8 15.5 -11.5 10.0 -12.0 C 4.5 -11.5 0 -8.8 0 -6.0 C 0 -3.2 4.5 -0.5 10.0 0 Z M 9.5 -2.5 C 6.5 -3.0 4.5 -4.5 5.0 -6.5 C 5.5 -8.5 8.0 -9.5 11.0 -9.0 C 14.0 -8.5 15.5 -7.0 15.0 -5.0 C 14.5 -3.0 12.0 -2.0 9.5 -2.5 Z',
                10.0, -6.0);

            // ── Accidentals ────────────────────────────────────────────
            this._register('sharp',
                'M 4.261 6.113 L 4.261 -5.081 L 8.899 -6.394 L 8.899 4.742 L 4.261 6.113 Z M 13.394 3.405 L 10.205 4.342 L 10.205 -6.794 L 13.394 -7.708 L 13.394 -12.333 L 10.205 -11.42 L 10.205 -22.799 L 8.899 -22.799 L 8.899 -11.075 L 4.261 -9.706 L 4.261 -20.771 L 3.029 -20.771 L 3.029 -9.285 L -0.16 -8.369 L -0.16 -3.734 L 3.029 -4.648 L 3.029 6.467 L -0.16 7.378 L -0.16 11.995 L 3.029 11.081 L 3.029 22.396 L 4.261 22.396 L 4.261 10.676 L 8.899 9.368 L 8.899 20.375 L 10.205 20.375 L 10.205 8.954 L 13.394 8.038 L 13.394 3.405 Z',
                6.617, 0.0);

            this._register('flat',
                'M 9.003 -0.087 C 6.793 2.673 4.935 4.255 2.486 6.113 L 2.486 -3.034 C 3.042 -4.44 3.864 -5.579 4.953 -6.453 C 6.038 -7.323 7.138 -7.76 8.252 -7.76 C 13.455 -7.006 11.632 -2.583 9.003 -0.087 Z M 2.486 -7.542 L 2.486 -33.174 L 0.501 -33.174 L 0.501 7.777 C 0.501 9.017 0.839 9.638 1.516 9.638 C 1.907 9.638 2.394 9.31 3.12 8.876 C 8.062 5.831 11.234 3.367 14.406 -0.979 C 15.386 -2.322 16.077 -5.371 14.66 -7.5 C 13.775 -8.825 12.09 -10.221 9.93 -10.633 C 7.131 -11.165 4.72 -9.773 2.486 -7.542 Z',
                7.453, -11.768);

            this._register('natural',
                'M 0.037 -18.087 C 0.438 -18.287 0.89 -18.438 1.341 -18.438 C 1.793 -18.438 2.194 -18.287 2.596 -18.087 L 2.445 -8.905 L 7.764 -9.909 L 7.914 -9.909 C 8.416 -9.909 8.818 -9.557 8.818 -9.056 L 9.168 19.543 C 8.767 19.743 8.366 19.894 7.914 19.894 C 7.463 19.894 7.061 19.743 6.66 19.543 L 6.811 10.361 L 1.492 11.365 L 1.341 11.365 C 0.84 11.365 0.438 11.013 0.438 10.512 Z M 7.011 -4.891 L 2.396 -4.039 L 2.245 6.347 L 6.86 5.494 Z',
                4.603, 0.728);

            // ── Rests ──────────────────────────────────────────────────
            this._register('quarterRest',
                'M 4.234 33.744 L 18.85 51.233 C 18.85 51.233 12.668 58.834 12.539 63.401 C 12.366 69.554 20.106 80.247 20.106 80.247 C 20.106 80.247 11.737 78.877 9.575 81.56 C 7.412 84.243 11.018 91.525 11.018 91.525 C 11.018 91.525 -1.969 84.394 0.059 77.949 C 1.577 73.124 12.317 72.838 12.317 72.838 C 12.317 72.838 2.833 64.533 2.828 60.435 C 2.824 57.127 8.879 52.026 9.058 46.639 C 9.161 43.545 6.46 39.885 5.214 37.322 C 4.452 35.753 4.234 33.744 4.234 33.744 Z',
                10.17, 62.635);

            this._register('eighthRest',
                'M 16.469 49.33 C 19.283 47.799 21.766 46.176 22.04 46.169 L 13.285 79.482 L 9.914 79.496 L 18.262 51.648 C 18.262 51.648 15.304 53.623 13.424 54.389 C 10.551 55.56 13.168 54.503 10.374 55.621 C 9.153 56.063 8.151 56.179 6.862 56.179 C 3.156 56.179 0.152 53.227 0.152 49.585 C 0.152 45.943 3.156 42.991 6.862 42.991 C 10.568 42.991 13.57 45.84 12.996 49.037 C 12.855 49.819 12.548 50.712 12.469 51.118 C 13.213 50.783 15.216 50.011 16.469 49.33 Z',
                11.096, 62.833);

            this._register('sixteenthRest',
                'M 11.345 66.917 C 12.597 66.236 13.783 65.537 14.738 64.97 L 18.262 51.648 C 18.262 51.648 15.304 53.623 13.424 54.389 C 10.551 55.56 13.168 54.503 10.374 55.621 C 9.153 56.063 8.151 56.179 6.862 56.179 C 3.156 56.179 0.152 53.227 0.152 49.585 C 0.152 45.943 3.156 42.991 6.862 42.991 C 10.568 42.991 13.57 45.84 12.996 49.037 C 12.855 49.819 12.548 50.712 12.469 51.118 C 13.213 50.783 15.216 50.011 16.469 49.33 C 19.283 47.799 21.766 46.176 22.04 46.169 L 7.868 99.537 L 5.548 99.713 L 13.723 68.806 C 12.657 69.512 9.809 71.361 8.3 71.976 C 5.427 73.147 8.044 72.09 5.25 73.208 C 4.029 73.65 3.027 73.766 1.738 73.766 C -1.968 73.766 -4.972 70.814 -4.972 67.172 C -4.972 63.53 -1.968 60.578 1.738 60.578 C 5.444 60.578 8.446 63.427 7.872 66.624 C 7.731 67.406 7.424 68.299 7.345 68.705 C 8.089 68.37 10.092 67.598 11.345 66.917 Z',
                8.534, 72.941);

            // Whole rest & half rest — simple rectangles (from noteworthy)
            this._register('wholeRest',
                'M -10 0 L 10 0 L 10 6 L -10 6 Z',
                0.0, 3.0);

            this._register('halfRest',
                'M -10 -6 L 10 -6 L 10 0 L -10 0 Z',
                0.0, -3.0);

            // ── Clefs ──────────────────────────────────────────────────
            // Treble clef (G clef) — from noteworthy/Wikimedia (public domain)
            this._register('trebleClef',
                'm12.049 3.5296c0.305 3.1263-2.019 5.6563-4.0772 7.7014-0.9349 0.897-0.155 0.148-0.6437 0.594-0.1022-0.479-0.2986-1.731-0.2802-2.11 0.1304-2.6939 2.3198-6.5875 4.2381-8.0236 0.309 0.5767 0.563 0.6231 0.763 1.8382zm0.651 16.142c-1.232-0.906-2.85-1.144-4.3336-0.885-0.1913-1.255-0.3827-2.51-0.574-3.764 2.3506-2.329 4.9066-5.0322 5.0406-8.5394 0.059-2.232-0.276-4.6714-1.678-6.4836-1.7004 0.12823-2.8995 2.156-3.8019 3.4165-1.4889 2.6705-1.1414 5.9169-0.57 8.7965-0.8094 0.952-1.9296 1.743-2.7274 2.734-2.3561 2.308-4.4085 5.43-4.0046 8.878 0.18332 3.334 2.5894 6.434 5.8702 7.227 1.2457 0.315 2.5639 0.346 3.8241 0.099 0.2199 2.25 1.0266 4.629 0.0925 6.813-0.7007 1.598-2.7875 3.004-4.3325 2.192-0.5994-0.316-0.1137-0.051-0.478-0.252 1.0698-0.257 1.9996-1.036 2.26-1.565 0.8378-1.464-0.3998-3.639-2.1554-3.358-2.262 0.046-3.1904 3.14-1.7356 4.685 1.3468 1.52 3.833 1.312 5.4301 0.318 1.8125-1.18 2.0395-3.544 1.8325-5.562-0.07-0.678-0.403-2.67-0.444-3.387 0.697-0.249 0.209-0.059 1.193-0.449 2.66-1.053 4.357-4.259 3.594-7.122-0.318-1.469-1.044-2.914-2.302-3.792zm0.561 5.757c0.214 1.991-1.053 4.321-3.079 4.96-0.136-0.795-0.172-1.011-0.2626-1.475-0.4822-2.46-0.744-4.987-1.116-7.481 1.6246-0.168 3.4576 0.543 4.0226 2.184 0.244 0.577 0.343 1.197 0.435 1.812zm-5.1486 5.196c-2.5441 0.141-4.9995-1.595-5.6343-4.081-0.749-2.153-0.5283-4.63 0.8207-6.504 1.1151-1.702 2.6065-3.105 4.0286-4.543 0.183 1.127 0.366 2.254 0.549 3.382-2.9906 0.782-5.0046 4.725-3.215 7.451 0.5324 0.764 1.9765 2.223 2.7655 1.634-1.102-0.683-2.0033-1.859-1.8095-3.227-0.0821-1.282 1.3699-2.911 2.6513-3.198 0.4384 2.869 0.9413 6.073 1.3797 8.943-0.5054 0.1-1.0211 0.143-1.536 0.143z',
                8.0, 20.0);

            // Bass clef (F clef) — professional Path2D matching treble clef style
            // Proportional to treble clef, designed for same baseScale rendering
            // Body: large curved comma-shape, tail curves down then hooks up
            this._register('bassClef',
                'M 2.5 0 C 2.5 -3.5 5 -6.5 8.5 -8 C 12.5 -9.8 17 -8.8 19.5 -5.5 C 21.5 -3 21 0 18.5 2 C 16 4 12.5 5 9 5.5 C 6 6 3.5 7.5 2.5 10 C 1.5 12.5 2.5 15 5 16 C 7 16.8 9.5 16 10.5 14 C 11.2 12.5 10.5 10.8 9 10.2 C 7.5 9.6 6 10.5 5.8 12 M 22 -3.5 C 22.8 -3.5 23.5 -2.8 23.5 -2 C 23.5 -1.2 22.8 -0.5 22 -0.5 C 21.2 -0.5 20.5 -1.2 20.5 -2 C 20.5 -2.8 21.2 -3.5 22 -3.5 Z M 22 2.5 C 22.8 2.5 23.5 3.2 23.5 4 C 23.5 4.8 22.8 5.5 22 5.5 C 21.2 5.5 20.5 4.8 20.5 4 C 20.5 3.2 21.2 2.5 22 2.5 Z',
                12.0, 4.0);

            // ── Flags (Contemporary engraving — flowing curves) ──────
            // Flag down (for stem-up notes) — elegant S-curve downward
            this._register('flagDown',
                'M 0 0 C 1.5 1.5 6.0 4.0 9.0 8.0 C 11.5 11.5 12.0 16.0 10.0 20.0 C 9.0 22.0 7.0 23.0 5.0 22.5 C 8.0 19.0 9.0 15.0 7.5 11.5 C 6.0 8.5 3.0 5.5 0 3.5 Z',
                0.0, 0.0);

            // Flag up (for stem-down notes) — elegant S-curve upward
            this._register('flagUp',
                'M 0 0 C 1.5 -1.5 6.0 -4.0 9.0 -8.0 C 11.5 -11.5 12.0 -16.0 10.0 -20.0 C 9.0 -22.0 7.0 -23.0 5.0 -22.5 C 8.0 -19.0 9.0 -15.0 7.5 -11.5 C 6.0 -8.5 3.0 -5.5 0 -3.5 Z',
                0.0, 0.0);
        }

        /**
         * Register a glyph from an SVG path string.
         * @param {string} name - Glyph identifier
         * @param {string} svgPath - SVG path d attribute
         * @param {number} originX - X coordinate of the visual center/anchor point
         * @param {number} originY - Y coordinate of the visual center/anchor point
         */
        _register(name, svgPath, originX, originY) {
            this.glyphs[name] = {
                path: new Path2D(svgPath),
                originX: originX,
                originY: originY
            };
        }

        /**
         * Draw a filled glyph at (x, y) with optional extra scaling and color.
         * Uses standard 'nonzero' winding fill rule (for solid shapes).
         */
        draw(ctx, name, x, y, extraScale = 1.0, color = null) {
            const g = this.glyphs[name];
            if (!g) return;
            const s = this.baseScale * extraScale;
            ctx.save();
            if (color) ctx.fillStyle = color;
            ctx.translate(x, y);
            ctx.scale(s, s);
            ctx.translate(-g.originX, -g.originY);
            ctx.fill(g.path);
            ctx.restore();
        }

        /**
         * Draw a glyph using 'evenodd' fill rule (for shapes with holes: whole & half noteheads).
         */
        drawEvenOdd(ctx, name, x, y, extraScale = 1.0, color = null) {
            const g = this.glyphs[name];
            if (!g) return;
            const s = this.baseScale * extraScale;
            ctx.save();
            if (color) ctx.fillStyle = color;
            ctx.translate(x, y);
            ctx.scale(s, s);
            ctx.translate(-g.originX, -g.originY);
            ctx.fill(g.path, 'evenodd');
            ctx.restore();
        }

        /**
         * Draw a glyph as a stroked outline (alternative for open noteheads).
         */
        drawStroke(ctx, name, x, y, extraScale = 1.0, color = null, lineWidth = 1.5) {
            const g = this.glyphs[name];
            if (!g) return;
            const s = this.baseScale * extraScale;
            ctx.save();
            if (color) ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth / s; // Compensate for scale
            ctx.translate(x, y);
            ctx.scale(s, s);
            ctx.translate(-g.originX, -g.originY);
            ctx.stroke(g.path);
            ctx.restore();
        }
    }

    /**
     * Staff Renderer Class
     */
    class StaffRenderer {
        constructor(engine) {
            this.engine = engine;
            this.ctx = engine.ctx;
            this.canvas = engine.canvas;
            this.staffY = null; // Will be calculated dynamically to center staff
            this.staffSpacing = 12; // Standard music spacing
            this.measureWidth = 250; // Wider measures for better readability
            this.clef = 'grand'; // DEFAULT TO GRAND STAFF (treble + bass)
            this.keySignature = 'C';
            this.timeSignature = '4/4';
            this.noteNameSystem = 'none';
            this.showCounting = false; // FEATURE: Show beat counting under notes
            this.feedback = [];
            this.glyphs = new MusicGlyphs(this.staffSpacing);
        }

        /**
         * Calculate centered staff Y position based on canvas height
         */
        calculateStaffY() {
            const height = this.canvas.height / (window.devicePixelRatio || 1);
            if (this.clef === 'grand') {
                const trebleHeight = 4 * this.staffSpacing;
                const gapBetween = 100;
                const bassHeight = 4 * this.staffSpacing;
                const totalSystem = trebleHeight + gapBetween + bassHeight;
                // Position staff LOWER — leave generous space above for high notes
                const topMargin = Math.max(85, (height - totalSystem) * 0.42);
                return topMargin;
            } else {
                const singleStaffHeight = 5 * this.staffSpacing;
                return (height - singleStaffHeight) / 2 + 5;
            }
        }
        
        resize() {
            // Recalculate staff Y on canvas resize (fullscreen, window resize, etc.)
            this.staffY = null; // Force recalculation
        }

        /**
         * Draw warm parchment background on canvas - elegant classical music sheet look
         */
        drawParchmentBackground() {
            const ctx = this.ctx;
            const w = this.canvas.width / (window.devicePixelRatio || 1);
            const h = this.canvas.height / (window.devicePixelRatio || 1);

            ctx.save();

            // Warm parchment gradient - cream/ivory classical feel
            const gradient = ctx.createLinearGradient(0, 0, w, h);
            gradient.addColorStop(0, '#FDF8F0');
            gradient.addColorStop(0.3, '#FAF3E8');
            gradient.addColorStop(0.7, '#F8F0E3');
            gradient.addColorStop(1, '#FDF8F0');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, w, h);

            // Subtle gold accent line at top
            const topGrad = ctx.createLinearGradient(0, 0, w, 0);
            topGrad.addColorStop(0, 'rgba(197, 157, 58, 0)');
            topGrad.addColorStop(0.2, 'rgba(197, 157, 58, 0.3)');
            topGrad.addColorStop(0.5, 'rgba(197, 157, 58, 0.5)');
            topGrad.addColorStop(0.8, 'rgba(197, 157, 58, 0.3)');
            topGrad.addColorStop(1, 'rgba(197, 157, 58, 0)');
            ctx.fillStyle = topGrad;
            ctx.fillRect(0, 0, w, 2);

            // Version watermark (bottom-right, very subtle)
            ctx.font = '10px Montserrat, Arial, sans-serif';
            ctx.fillStyle = 'rgba(197, 157, 58, 0.25)';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';
            ctx.fillText('PianoMode v23', w - 10, h - 5);

            ctx.restore();
        }

        renderStaff() {
            if (!this.staffRenderLogged) {
                this.staffRenderLogged = true;
            }

            // Calculate centered staff position if not already calculated
            if (this.staffY === null) {
                this.staffY = this.calculateStaffY();
            }

            const ctx = this.ctx;
            const width = this.canvas.width / (window.devicePixelRatio || 1);
            const height = this.canvas.height / (window.devicePixelRatio || 1);

            ctx.save();

            // Set styles for professional staff rendering - WARM ENGRAVED LINES
            ctx.strokeStyle = '#5C4E3C'; // Warm sepia brown - visible on parchment
            ctx.lineWidth = 1.0; // Crisp thin lines for classical engraving
            ctx.font = '20px "Times New Roman", serif';

            // Render based on clef setting
            if (this.clef === 'grand') {
                this.renderGrandStaff();
            } else if (this.clef === 'bass') {
                this.renderBassStaff();
            } else {
                this.renderTrebleStaff();
            }

            ctx.restore();
        }

        /**
         * Render measure lines (barres de mesure)
         * Appelé APRÈS ctx.translate() en mode scroll pour que les barres bougent avec les notes!
         * USER REQUEST: NO measure bars in FREE mode
         */
        renderMeasureLines() {
            // CRITICAL FIX: Don't draw measure bars in FREE mode
            if (this.engine.mode === 'free') {
                // Still render counting time in FREE mode (wait, actually no - counting time also skips FREE)
                this.renderCountingTime();
                return;
            }

            const ctx = this.ctx;
            const width = this.canvas.width / (window.devicePixelRatio || 1);

            ctx.save();
            ctx.strokeStyle = '#5C4E3C'; // Warm sepia bar lines
            ctx.lineWidth = 1.5;

            if (this.clef === 'grand') {
                const trebleY = this.staffY;
                const bassY = this.staffY + 100; // Gap between treble and bass staves
                this.drawGrandStaffBarLines(trebleY, bassY);
            } else {
                this.drawBarLines();
            }

            ctx.restore();

            // USER REQUEST: Afficher counting time (1,2,3,4) - Beautiful design
            // CRITICAL FIX: Must be called here to actually display!
            this.renderCountingTime();
        }

        /**
         * Render counting timeline — the backbone of note placement.
         * A horizontal ruler below the staff with beat numbers that illuminate
         * with the current note. Adapts to any time signature.
         */
        renderCountingTime() {
            if (!this.showCounting) return;
            if (this.engine.mode === 'free') return;
            if (!this.engine.notes || this.engine.notes.length === 0) return;

            const ctx = this.ctx;
            ctx.save();

            // Position: well below the bass staff to never interfere with notes
            let timelineY;
            if (this.clef === 'grand') {
                timelineY = this.staffY + 100 + (4 * this.staffSpacing) + 55;
            } else {
                timelineY = this.staffY + (4 * this.staffSpacing) + 40;
            }

            const noteStartX = this.calculatedNoteStartX || 200;
            const barLineMargin = 25;
            // PERFORMANCE FIX: Use cached max measure
            const maxMeasure = this.engine._cachedMaxMeasure || 4;

            // PERF: Use cached time signature (already parsed in getNoteX cache)
            if (this._tsCache_sig !== this.timeSignature) {
                const parts = this.timeSignature.split('/');
                this._tsCache_sig = this.timeSignature;
                this._tsCache_top = parseInt(parts[0]) || 4;
                this._tsCache_bot = parseInt(parts[1]) || 4;
                this._tsCache_qbeats = (this._tsCache_top * 4) / this._tsCache_bot;
            }
            const tsNumerator = this._tsCache_top;
            const tsDenominator = this._tsCache_bot;

            // CRITICAL FIX: Use quarter-note beats (same as getNoteX and note generation)
            // 4/4 = 4 beats, 3/4 = 3 beats, 6/8 = 3 beats, 2/4 = 2 beats
            const quarterBeatsPerMeasure = (tsNumerator * 4) / tsDenominator;
            const beatsPerMeasure = quarterBeatsPerMeasure;
            const beatWidth = this.measureWidth / beatsPerMeasure;

            // Build a set of active beats from notes for highlighting
            const activeBeats = new Set();
            const playedBeats = new Set();
            if (this.engine.currentNoteIndex < this.engine.notes.length) {
                const currentNotes = this.engine.getExpectedNotesAtIndex(this.engine.currentNoteIndex);
                currentNotes.forEach(n => {
                    if (!n.isRest) activeBeats.add(`${n.measure}-${Math.floor(n.beat)}`);
                });
            }
            // PERF: Only scan notes up to current index + small buffer (already-played are behind)
            const scanLimit = Math.min(this.engine.notes.length, (this.engine.currentNoteIndex || 0) + 10);
            for (let i = 0; i < scanLimit; i++) {
                const n = this.engine.notes[i];
                if (n.played && !n.isRest) playedBeats.add(`${n.measure}-${Math.floor(n.beat)}`);
            }

            // --- Draw timeline line ---
            // Line extends from noteStartX to the final bar line position
            const lineStartX = noteStartX;
            const lineEndX = noteStartX + (maxMeasure * (this.measureWidth + barLineMargin));

            ctx.strokeStyle = 'rgba(92, 78, 60, 0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(lineStartX, timelineY);
            ctx.lineTo(lineEndX, timelineY);
            ctx.stroke();

            // --- Draw measures ---
            // CRITICAL ALIGNMENT FIX: Use EXACT same formula as drawBarLines/drawGrandStaffBarLines
            // Bar lines are at: noteStartX + i * (measureWidth + barLineMargin) for i=1,2,3...
            // getNoteX beat 0: noteStartX + m * (measureWidth + barLineMargin) + barLineMargin
            // So: separator ticks = bar line positions, beat ticks = getNoteX positions
            for (let m = 0; m < maxMeasure; m++) {
                // Bar line position for this measure boundary (same formula as drawBarLines)
                const barLineX = noteStartX + m * (this.measureWidth + barLineMargin);

                // Draw measure separator tick at bar line position (skip m=0 — no bar line before first measure)
                if (m > 0) {
                    ctx.strokeStyle = 'rgba(92, 78, 60, 0.5)';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(barLineX, timelineY - 8);
                    ctx.lineTo(barLineX, timelineY + 8);
                    ctx.stroke();
                }

                // --- Beat ticks and numbers within measure ---
                // Beat positions use EXACT same formula as getNoteX:
                // noteStartX + m*(measureWidth + barLineMargin) + barLineMargin + beat*beatWidth
                for (let beat = 0; beat < beatsPerMeasure; beat++) {
                    const beatX = barLineX + barLineMargin + (beat * beatWidth);
                    const beatKey = `${m}-${beat}`;
                    const isActive = activeBeats.has(beatKey);
                    const isPlayed = playedBeats.has(beatKey);

                    // Beat tick mark
                    if (beat > 0) {
                        // Compound meter grouping: stronger ticks on group boundaries
                        // 6/8 → groups of 3, 12/8 → groups of 3, 9/8 → groups of 3
                        const isGroupBoundary = (tsDenominator === 8 && beat % 3 === 0);
                        ctx.strokeStyle = isGroupBoundary ? 'rgba(92, 78, 60, 0.45)' : 'rgba(92, 78, 60, 0.2)';
                        ctx.lineWidth = isGroupBoundary ? 1.2 : 0.7;
                        ctx.beginPath();
                        ctx.moveTo(beatX, timelineY - (isGroupBoundary ? 5 : 3));
                        ctx.lineTo(beatX, timelineY + (isGroupBoundary ? 5 : 3));
                        ctx.stroke();
                    }

                    // Beat number — priority: played (green) > active note (gold+glow) > metronome current (gold) > inactive (gray)
                    const label = (beat + 1).toString();
                    // Check if this beat is the current metronome position
                    const tlMeasure = this.engine._timelineMeasure;
                    const tlBeat = this.engine._timelineBeat;
                    const isMetronomeCurrent = (tlMeasure !== undefined && tlBeat !== undefined &&
                        m === tlMeasure && beat === Math.floor(tlBeat));
                    const isMetronomePassed = (tlMeasure !== undefined &&
                        (m < tlMeasure || (m === tlMeasure && beat < Math.floor(tlBeat))));

                    if (isPlayed) {
                        // Played beat: green
                        ctx.font = 'bold 11px Montserrat, sans-serif';
                        ctx.fillStyle = '#4CAF50';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'top';
                        ctx.fillText(label, beatX, timelineY + 8);
                    } else if (isActive) {
                        // Active note beat: gold, bold, with subtle glow circle
                        ctx.font = 'bold 12px Montserrat, sans-serif';
                        ctx.fillStyle = '#C59D3A';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'top';
                        ctx.save();
                        ctx.globalAlpha = 0.25;
                        ctx.fillStyle = '#C59D3A';
                        ctx.beginPath();
                        ctx.arc(beatX, timelineY + 14, 9, 0, 2 * Math.PI);
                        ctx.fill();
                        ctx.restore();
                        ctx.fillStyle = '#C59D3A';
                        ctx.fillText(label, beatX, timelineY + 8);
                    } else if (isMetronomeCurrent) {
                        // Current metronome beat: gold highlight (no glow)
                        ctx.font = 'bold 11px Montserrat, sans-serif';
                        ctx.fillStyle = '#C59D3A';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'top';
                        ctx.fillText(label, beatX, timelineY + 8);
                    } else if (isMetronomePassed) {
                        // Metronome has passed this beat in current measure: dimmed gold
                        ctx.font = '10px Montserrat, sans-serif';
                        ctx.fillStyle = 'rgba(197, 157, 58, 0.45)';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'top';
                        ctx.fillText(label, beatX, timelineY + 8);
                    } else {
                        // Inactive beat: subtle gray
                        ctx.font = '10px Montserrat, sans-serif';
                        ctx.fillStyle = 'rgba(92, 78, 60, 0.35)';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'top';
                        ctx.fillText(label, beatX, timelineY + 8);
                    }
                }
            }

            // Draw final bar line separator tick (at the end of last measure)
            const finalBarLineX = noteStartX + maxMeasure * (this.measureWidth + barLineMargin);
            ctx.strokeStyle = 'rgba(92, 78, 60, 0.5)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(finalBarLineX, timelineY - 8);
            ctx.lineTo(finalBarLineX, timelineY + 8);
            ctx.stroke();

            ctx.restore();
        }

        renderTrebleStaff() {
            const ctx = this.ctx;
            const width = this.canvas.width / (window.devicePixelRatio || 1);
            const staffLeftMargin = 60;

            // Clean, crisp staff lines
            ctx.save();
            ctx.strokeStyle = 'rgba(92, 78, 60, 0.55)';
            ctx.lineWidth = 1.0;
            ctx.lineCap = 'butt';
            for (let i = 0; i < 5; i++) {
                const y = this.staffY + (i * this.staffSpacing);
                ctx.beginPath();
                ctx.moveTo(staffLeftMargin, y + 0.5);
                ctx.lineTo(width - 50, y + 0.5);
                ctx.stroke();
            }
            ctx.restore();

            // Dynamic layout: clef → key signature → time signature → notes
            const CLEF_X = 75;
            const KEY_SIG_X = 115;

            // Calculate key signature width
            const keySignatures = {
                'C': 0, 'G': 1, 'D': 2, 'A': 3, 'E': 4, 'B': 5,
                'F': 1, 'Bb': 2, 'Eb': 3, 'Ab': 4, 'Db': 5,
                'F#': 6, 'Gb': 6, 'C#': 7, 'Cb': 7
            };
            const numAccidentals = keySignatures[this.keySignature] || 0;
            const keySigWidth = numAccidentals * 11;
            const TIME_SIG_X = KEY_SIG_X + keySigWidth + 8;
            this.calculatedNoteStartX = TIME_SIG_X + 40;

            // Draw clef
            this.drawTrebleClef(CLEF_X, this.staffY);

            // Draw key signature
            this.drawKeySignature(KEY_SIG_X, this.staffY, 'treble');

            // Draw time signature
            this.drawTimeSignature(TIME_SIG_X, this.staffY);

            // Draw bar lines
            this.drawBarLines();
        }

        renderBassStaff() {
            const ctx = this.ctx;
            const width = this.canvas.width / (window.devicePixelRatio || 1);
            const staffLeftMargin = 60;

            // Clean, crisp staff lines
            ctx.save();
            ctx.strokeStyle = 'rgba(92, 78, 60, 0.55)';
            ctx.lineWidth = 1.0;
            ctx.lineCap = 'butt';
            for (let i = 0; i < 5; i++) {
                const y = this.staffY + (i * this.staffSpacing);
                ctx.beginPath();
                ctx.moveTo(staffLeftMargin, y + 0.5);
                ctx.lineTo(width - 50, y + 0.5);
                ctx.stroke();
            }
            ctx.restore();

            // Dynamic layout: clef → key signature → time signature → notes
            const CLEF_X = 75;
            const KEY_SIG_X = 115;

            const keySignatures = {
                'C': 0, 'G': 1, 'D': 2, 'A': 3, 'E': 4, 'B': 5,
                'F': 1, 'Bb': 2, 'Eb': 3, 'Ab': 4, 'Db': 5,
                'F#': 6, 'Gb': 6, 'C#': 7, 'Cb': 7
            };
            const numAccidentals = keySignatures[this.keySignature] || 0;
            const keySigWidth = numAccidentals * 11;
            const TIME_SIG_X = KEY_SIG_X + keySigWidth + 8;
            this.calculatedNoteStartX = TIME_SIG_X + 40;

            // Draw clef
            this.drawBassClef(CLEF_X, this.staffY);

            // Draw key signature
            this.drawKeySignature(KEY_SIG_X, this.staffY, 'bass');

            // Draw time signature
            this.drawTimeSignature(TIME_SIG_X, this.staffY);

            // Draw bar lines
            this.drawBarLines();
        }
        
        renderGrandStaff() {
            const ctx = this.ctx;
            const width = this.canvas.width / (window.devicePixelRatio || 1);
            const trebleY = this.staffY;
            const bassY = this.staffY + 100; // Gap between treble and bass staves

            const staffLeftMargin = 60; // Margin on the left for clefs

            // Draw treble staff lines - clean, precise rendering
            ctx.save();
            ctx.strokeStyle = 'rgba(92, 78, 60, 0.55)'; // Subtle warm sepia
            ctx.lineWidth = 1.0; // Thin, crisp lines
            ctx.lineCap = 'butt';

            for (let i = 0; i < 5; i++) {
                const y = trebleY + (i * this.staffSpacing);
                ctx.beginPath();
                ctx.moveTo(staffLeftMargin, y + 0.5); // Half-pixel offset for crisp rendering
                ctx.lineTo(width, y + 0.5);
                ctx.stroke();
            }

            // Draw bass staff lines
            for (let i = 0; i < 5; i++) {
                const y = bassY + (i * this.staffSpacing);
                ctx.beginPath();
                ctx.moveTo(staffLeftMargin, y + 0.5);
                ctx.lineTo(width, y + 0.5);
                ctx.stroke();
            }
            ctx.restore();

            // Draw vertical bar at the beginning of staves (left side) - clean thick bar
            ctx.save();
            ctx.strokeStyle = '#5C4E3C';
            ctx.lineWidth = 2.5;
            ctx.lineCap = 'butt';
            ctx.beginPath();
            ctx.moveTo(staffLeftMargin, trebleY);
            ctx.lineTo(staffLeftMargin, bassY + (4 * this.staffSpacing));
            ctx.stroke();
            ctx.restore();

            // USER FIX: Dynamic layout - calculate TIME_SIG_X based on key signature width
            // Prevents 4/4 from overlapping with accidentals
            const BRACE_X = 40;           // Brace position (far left)
            const CLEF_X = 75;            // Clefs position (compact)
            const KEY_SIG_X = 115;        // Key signatures start position

            // Calculate key signature width based on number of accidentals
            const keySignatures = {
                'C': 0, 'G': 1, 'D': 2, 'A': 3, 'E': 4, 'B': 5,
                'F': 1, 'Bb': 2, 'Eb': 3, 'Ab': 4, 'Db': 5,
                'F#': 6, 'Gb': 6, 'C#': 7, 'Cb': 7
            };
            const numAccidentals = keySignatures[this.keySignature] || 0;
            const accidentalSpacing = 11;
            const keySigWidth = numAccidentals * accidentalSpacing;

            // TIME_SIG_X is after key signature with 8px gap
            const TIME_SIG_X = KEY_SIG_X + keySigWidth + 8;

            // Notes start after time signature (see getNoteX)
            // USER FIX: Add margin for note labels that may appear to the left of notes
            // 40px margin ensures space for note labels without overlapping the key/time signature
            this.calculatedNoteStartX = TIME_SIG_X + 40;

            // Draw brace (accolade) connecting both staves
            this.drawBrace(BRACE_X, trebleY, bassY + this.staffSpacing * 4);

            // Draw clefs (clé de sol, clé de fa)
            this.drawTrebleClef(CLEF_X, trebleY);
            this.drawBassClef(CLEF_X, bassY);

            // Draw key signatures (armatures - sharps/flats)
            this.drawKeySignature(KEY_SIG_X, trebleY, 'treble');
            this.drawKeySignature(KEY_SIG_X, bassY, 'bass');

            // Draw time signatures (chiffres de mesure - 4/4, 3/4, etc.)
            this.drawTimeSignature(TIME_SIG_X, trebleY);
            this.drawTimeSignature(TIME_SIG_X, bassY);

            // NE PLUS dessiner les barres ici - elles sont dans renderMeasureLines()
            // pour bouger avec les notes en mode scroll!
        }
        
        drawTrebleClef(x, y) {
            const ctx = this.ctx;
            // Treble clef wraps around G line (line index 3)
            const gLineY = y + (3 * this.staffSpacing) - 7;

            // Warm glow pass
            ctx.save();
            ctx.shadowColor = 'rgba(197, 157, 58, 0.3)';
            ctx.shadowBlur = 4;
            this.glyphs.draw(ctx, 'trebleClef', x + 10, gLineY, 1.65, '#5C4E3C');
            ctx.restore();

            // Subtle gold highlight pass
            this.glyphs.draw(ctx, 'trebleClef', x + 10, gLineY, 1.65, 'rgba(176, 138, 46, 0.25)');
        }

        drawBassClef(x, y) {
            const ctx = this.ctx;
            const S = this.staffSpacing;
            // Bass clef: F line is line index 1 (2nd from top), y + S
            const fLineY = y + S;

            // Use Unicode bass clef character for professional rendering
            // Same dual-pass visual treatment as treble clef (shadow + gold highlight)
            const fontSize = Math.round(S * 4.5);
            const clefX = x + 1; // Shifted left per user request
            const clefY = fLineY + Math.round(S * 2.15);

            // Use a lighter font-weight via CSS font string for thinner strokes
            const fontStr = `${fontSize}px "Times New Roman", Georgia, serif`;

            // Pass 1: warm glow shadow
            ctx.save();
            ctx.fillStyle = '#5C4E3C';
            ctx.textBaseline = 'alphabetic';
            ctx.textAlign = 'left';
            ctx.font = fontStr;
            ctx.shadowColor = 'rgba(197, 157, 58, 0.3)';
            ctx.shadowBlur = 3;
            ctx.fillText('\u{1D122}', clefX, clefY);
            ctx.restore();

            // Pass 2: subtle gold highlight overlay
            ctx.save();
            ctx.fillStyle = 'rgba(176, 138, 46, 0.25)';
            ctx.textBaseline = 'alphabetic';
            ctx.textAlign = 'left';
            ctx.font = fontStr;
            ctx.fillText('\u{1D122}', clefX, clefY);
            ctx.restore();
        }

        /**
         * Draw an elegant brace (accolade) connecting treble and bass staves
         * USER FIX: Improved design with professional curved shape
         */
        drawBrace(x, topY, bottomY) {
            const ctx = this.ctx;
            ctx.save();

            const height = bottomY - topY;
            const midY = topY + height / 2;

            // Professional brace with double curve design - warm brown with gold accent
            ctx.fillStyle = '#5C4E3C';
            ctx.strokeStyle = '#5C4E3C';
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            // Draw elegant curved brace with bulge in the middle
            ctx.beginPath();

            // Outer curve (right side of brace)
            ctx.moveTo(x + 2, topY);
            // Top curve - sweeping inward
            ctx.bezierCurveTo(
                x - 8, topY + height * 0.15,
                x - 12, topY + height * 0.35,
                x - 14, midY - 5
            );
            // Middle point (the bulge/tip of the brace)
            ctx.quadraticCurveTo(x - 18, midY, x - 14, midY + 5);
            // Bottom curve - sweeping outward
            ctx.bezierCurveTo(
                x - 12, bottomY - height * 0.35,
                x - 8, bottomY - height * 0.15,
                x + 2, bottomY
            );

            // Inner curve (left side going back up)
            ctx.bezierCurveTo(
                x - 4, bottomY - height * 0.12,
                x - 6, bottomY - height * 0.30,
                x - 8, midY + 3
            );
            ctx.quadraticCurveTo(x - 10, midY, x - 8, midY - 3);
            ctx.bezierCurveTo(
                x - 6, topY + height * 0.30,
                x - 4, topY + height * 0.12,
                x + 2, topY
            );

            ctx.closePath();
            ctx.fill();

            ctx.restore();
        }
        
        drawKeySignature(x, y, clef) {
            // Draw sharps or flats based on key signature
            // Complete key signature table including enharmonic keys
            const signatures = {
                'C': [],
                'G': ['F#'],
                'D': ['F#', 'C#'],
                'A': ['F#', 'C#', 'G#'],
                'E': ['F#', 'C#', 'G#', 'D#'],
                'B': ['F#', 'C#', 'G#', 'D#', 'A#'],
                'F#': ['F#', 'C#', 'G#', 'D#', 'A#', 'E#'],
                'C#': ['F#', 'C#', 'G#', 'D#', 'A#', 'E#', 'B#'],
                'F': ['Bb'],
                'Bb': ['Bb', 'Eb'],
                'Eb': ['Bb', 'Eb', 'Ab'],
                'Ab': ['Bb', 'Eb', 'Ab', 'Db'],
                'Db': ['Bb', 'Eb', 'Ab', 'Db', 'Gb'],
                'Gb': ['Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'],
                'Cb': ['Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb', 'Fb']
            };

            const accidentals = signatures[this.keySignature] || [];
            const accidentalSpacing = 12; // Slightly more spacing for better readability

            accidentals.forEach((accidental, index) => {
                const accX = x + (index * accidentalSpacing);
                const accY = this.getAccidentalY(accidental, y, clef);

                // Key signature accidentals use a distinct warm brown color, slightly bolder
                const keySigColor = '#5C4E3C';
                if (accidental.includes('#')) {
                    this.drawKeySignatureSharp(accX, accY, keySigColor);
                } else if (accidental.includes('b')) {
                    this.drawKeySignatureFlat(accX, accY, keySigColor);
                }
            });
        }

        /**
         * Draw a key signature sharp - larger and bolder than note accidentals
         */
        drawKeySignatureSharp(x, y, color = '#5C4E3C') {
            this.glyphs.draw(this.ctx, 'sharp', x, y, 0.86, color);
        }

        /**
         * Draw a key signature flat - larger and bolder than note accidentals
         */
        drawKeySignatureFlat(x, y, color = '#5C4E3C') {
            this.glyphs.draw(this.ctx, 'flat', x, y, 0.86, color);
        }
        
        drawTimeSignature(x, y) {
            const ctx = this.ctx;
            const [top, bottom] = this.timeSignature.split('/');

            ctx.save();
            // Use a larger bold font for professional time signature rendering
            const fontSize = Math.round(this.staffSpacing * 2.2);
            ctx.font = `bold ${fontSize}px "Times New Roman", Georgia, serif`;
            ctx.fillStyle = '#5C4E3C';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // PRECISE CENTERING using staffSpacing:
            // Staff has 5 lines (indices 0-4), creating 4 spaces
            // Top number: centered in upper half (between lines 0 and 2)
            //   = y + 1 * staffSpacing  (center of space between line 0 and line 2)
            // Bottom number: centered in lower half (between lines 2 and 4)
            //   = y + 3 * staffSpacing  (center of space between line 2 and line 4)
            const topY = y + 1 * this.staffSpacing;
            const bottomY = y + 3 * this.staffSpacing;

            ctx.fillText(top, x, topY);
            ctx.fillText(bottom, x, bottomY);

            ctx.restore();
        }
        
        drawBarLines() {
            const ctx = this.ctx;

            const clefAndSignatureWidth = this.calculatedNoteStartX || 200;
            const barLineMargin = 25;

            // PERFORMANCE FIX: Use cached max measure instead of expensive spread+map on every frame
            const maxMeasure = (this.engine._cachedMaxMeasure || 4) + 1;

            for (let i = 1; i <= maxMeasure; i++) {
                const x = clefAndSignatureWidth + (i * this.measureWidth) + (i * barLineMargin);
                ctx.beginPath();
                ctx.moveTo(x, this.staffY);
                ctx.lineTo(x, this.staffY + (4 * this.staffSpacing));
                ctx.stroke();
            }

            // Measure numbers above staff
            ctx.save();
            ctx.font = '10px "Times New Roman", Georgia, serif';
            ctx.fillStyle = 'rgba(92, 78, 60, 0.5)';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            for (let i = 0; i <= maxMeasure; i++) {
                const mx = clefAndSignatureWidth + (i * this.measureWidth) + (i * barLineMargin) + 4;
                ctx.fillText(String(i + 1), mx, this.staffY - 4);
            }
            ctx.restore();
        }

        drawGrandStaffBarLines(trebleY, bassY) {
            const ctx = this.ctx;

            const clefAndSignatureWidth = this.calculatedNoteStartX || 200;
            const barLineMargin = 25;

            // PERFORMANCE FIX: Use cached max measure instead of expensive spread+map on every frame
            const maxMeasure = (this.engine._cachedMaxMeasure || 4) + 1;

            for (let i = 1; i <= maxMeasure; i++) {
                const x = clefAndSignatureWidth + (i * this.measureWidth) + (i * barLineMargin);
                ctx.beginPath();
                ctx.moveTo(x, trebleY);
                ctx.lineTo(x, bassY + (4 * this.staffSpacing));
                ctx.stroke();
            }

            // Measure numbers above treble staff
            ctx.save();
            ctx.font = '10px "Times New Roman", Georgia, serif';
            ctx.fillStyle = 'rgba(92, 78, 60, 0.5)';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            for (let i = 0; i <= maxMeasure; i++) {
                const mx = clefAndSignatureWidth + (i * this.measureWidth) + (i * barLineMargin) + 4;
                ctx.fillText(String(i + 1), mx, trebleY - 4);
            }
            ctx.restore();
        }
        
        /**
         * Render mid-piece time/key signature changes from MusicXML per-measure metadata.
         * Shows new time signatures and key signatures at the start of measures where they change.
         */
        renderSignatureChanges() {
            const measures = this.engine?._xmlMeasures;
            if (!measures || measures.length < 2) return;

            const ctx = this.ctx;
            ctx.save();

            const clefAndSignatureWidth = this.calculatedNoteStartX || 200;
            const barLineMargin = 25;
            const staffTop = this.clef === 'grand' ? this.staffY : this.staffY;

            let prevTimeSig = measures[0]?.timeSignature;
            let prevKeySig = measures[0]?.keySignature;

            for (let i = 1; i < measures.length; i++) {
                const m = measures[i];
                const barX = clefAndSignatureWidth + (i * this.measureWidth) + (i * barLineMargin) + 5;

                // Time signature change
                if (m.timeSignature && m.timeSignature !== prevTimeSig) {
                    const parts = m.timeSignature.split('/');
                    ctx.font = 'bold 16px "Times New Roman", Georgia, serif';
                    ctx.fillStyle = '#3D2B1F';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    // Numerator above middle line, denominator below
                    ctx.fillText(parts[0], barX + 8, staffTop + this.staffSpacing * 1);
                    ctx.fillText(parts[1], barX + 8, staffTop + this.staffSpacing * 3);
                    prevTimeSig = m.timeSignature;
                }

                // Key signature change
                if (m.keySignature && m.keySignature !== prevKeySig) {
                    // Draw small key indicator text above staff
                    ctx.font = 'italic 10px "Times New Roman", Georgia, serif';
                    ctx.fillStyle = '#5C4E3C';
                    ctx.textAlign = 'left';
                    ctx.fillText(m.keySignature, barX + 18, staffTop - 5);
                    prevKeySig = m.keySignature;
                }
            }

            ctx.restore();
        }

        renderNotes(notes) {
            // PERF: O(n) chord grouping using measure+beat+staff key instead of O(n²) position comparison
            // IMPORTANT: Group by staff so that treble and bass notes at the same beat
            // are rendered independently (not as a cross-staff chord)
            const chordMap = new Map();
            const noteGroups = [];

            for (let i = 0; i < notes.length; i++) {
                const note = notes[i];
                const staff = note.staff || (note.midi >= 60 ? 'treble' : 'bass');
                const key = `${note.measure}-${snapBeat(note.beat)}-${staff}`;
                let group = chordMap.get(key);
                if (!group) {
                    group = [];
                    chordMap.set(key, group);
                    noteGroups.push(group);
                }
                group.push(note);
            }

            // BEAM NOTATION: Group consecutive eighth/sixteenth notes for beaming
            const beamGroups = this.identifyBeamGroups(notes);

            // Mark all beamed notes so renderNote skips drawing individual flags
            for (let g = 0; g < beamGroups.length; g++) {
                const bgNotes = beamGroups[g].notes;
                for (let n = 0; n < bgNotes.length; n++) {
                    bgNotes[n]._isBeamed = true;
                }
            }

            // Render each group (single notes or chords)
            for (let i = 0; i < noteGroups.length; i++) {
                const group = noteGroups[i];
                if (group.length === 1) {
                    const note = group[0];
                    // Render single notes (including orphan sixteenth notes with flags)
                    if (!note._isBeamed) this.renderNote(note);
                } else {
                    this.renderChord(group);
                }
            }

            // Render beamed groups separately with horizontal beams
            for (let i = 0; i < beamGroups.length; i++) {
                this.renderBeamedNotes(beamGroups[i].notes, beamGroups[i].beamCount);
            }
        }

        /**
         * Render tie curves between connected notes
         * Professional curved lines connecting notes that are tied together
         * Also renders slurs for smooth phrasing indications
         */
        renderTies(notes) {
            if (!notes || notes.length < 2) return;

            const ctx = this.ctx;
            ctx.save();

            for (let i = 0; i < notes.length; i++) {
                const note = notes[i];
                if (!note.tieStart || note.isRest || !note.midi) continue;

                // Find the tied-to note (same MIDI pitch, next occurrence)
                let tiedNote = null;
                for (let j = i + 1; j < notes.length; j++) {
                    if (notes[j].midi === note.midi && !notes[j].isRest) {
                        tiedNote = notes[j];
                        break;
                    }
                }

                if (!tiedNote) continue;

                const x1 = this.getNoteX(note);
                const y1 = this.getNoteY(note);
                const x2 = this.getNoteX(tiedNote);
                const y2 = this.getNoteY(tiedNote);

                // Skip if notes are too far apart (likely a parsing error)
                if (Math.abs(x2 - x1) > 800) continue;

                // Stem direction based on correct staff middle line
                // For grand staff: treble middle = staffY + 2*spacing, bass middle = staffY + 100 + 2*spacing
                let staffMiddle;
                if (this.clef === 'grand') {
                    staffMiddle = note.midi >= 60
                        ? this.staffY + 2 * this.staffSpacing
                        : this.staffY + 100 + 2 * this.staffSpacing;
                } else {
                    staffMiddle = this.staffY + 2 * this.staffSpacing;
                }
                const stemDir = y1 < staffMiddle ? 1 : -1;
                // Ties curve AWAY from the stem (standard engraving convention)
                const curveDir = -stemDir;

                const dist = Math.abs(x2 - x1);
                const curveHeight = Math.max(6, Math.min(18, dist * 0.12));
                const startOffset = 8;
                const endOffset = 8;

                // Base Y for tie (offset from note head in curve direction)
                const baseY1 = y1 + (curveDir * 7);
                const baseY2 = y2 + (curveDir * 7);
                const peakY = ((baseY1 + baseY2) / 2) + (curveHeight * curveDir);

                // Color based on note state
                const noteColor = note.played ? '#4CAF50' :
                                  note.highlighted ? '#C59D3A' :
                                  note.missed ? '#F44336' : '#3D2B1F';

                // Draw filled tie arc (professional engraving style)
                ctx.fillStyle = noteColor;
                ctx.beginPath();
                // Outer curve
                ctx.moveTo(x1 + startOffset, baseY1);
                ctx.bezierCurveTo(
                    x1 + dist * 0.3, peakY,
                    x1 + dist * 0.7, peakY,
                    x2 - endOffset, baseY2
                );
                // Inner curve (slightly less peaked)
                ctx.bezierCurveTo(
                    x1 + dist * 0.7, peakY - curveDir * 3,
                    x1 + dist * 0.3, peakY - curveDir * 3,
                    x1 + startOffset, baseY1
                );
                ctx.closePath();
                ctx.fill();
            }

            ctx.restore();
        }

        /**
         * Render slurs (legato arcs) between notes marked with slur start/stop.
         * Slurs look like ties but connect different pitches, typically rendered
         * as thinner arcs above or below the note group.
         */
        renderSlurs(notes) {
            if (!notes || notes.length < 2) return;

            const ctx = this.ctx;
            ctx.save();

            // Build slur pairs: match slur start with slur stop by number
            const slurStarts = new Map(); // slur number → note index

            for (let i = 0; i < notes.length; i++) {
                const note = notes[i];
                if (!note.slur) continue;

                if (note.slur.type === 'start') {
                    slurStarts.set(note.slur.number || 1, i);
                } else if (note.slur.type === 'stop') {
                    const startIdx = slurStarts.get(note.slur.number || 1);
                    if (startIdx === undefined) continue;

                    const startNote = notes[startIdx];
                    const endNote = note;

                    const x1 = this.getNoteX(startNote);
                    const y1 = this.getNoteY(startNote);
                    const x2 = this.getNoteX(endNote);
                    const y2 = this.getNoteY(endNote);

                    if (Math.abs(x2 - x1) > 1200 || Math.abs(x2 - x1) < 5) continue;

                    // Determine curve direction (away from stems)
                    let staffMiddle;
                    if (this.clef === 'grand') {
                        staffMiddle = (startNote.midi >= 60)
                            ? this.staffY + 2 * this.staffSpacing
                            : this.staffY + 100 + 2 * this.staffSpacing;
                    } else {
                        staffMiddle = this.staffY + 2 * this.staffSpacing;
                    }
                    const stemDir = y1 < staffMiddle ? 1 : -1;
                    const curveDir = -stemDir;

                    const dist = Math.abs(x2 - x1);
                    const curveHeight = Math.max(8, Math.min(25, dist * 0.15));

                    const baseY1 = y1 + (curveDir * 10);
                    const baseY2 = y2 + (curveDir * 10);
                    const peakY = ((baseY1 + baseY2) / 2) + (curveHeight * curveDir);

                    // Draw as a thin arc (not filled like ties)
                    ctx.strokeStyle = '#5C4E3C';
                    ctx.lineWidth = 1.5;
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    ctx.moveTo(x1 + 8, baseY1);
                    ctx.bezierCurveTo(
                        x1 + dist * 0.3, peakY,
                        x1 + dist * 0.7, peakY,
                        x2 - 8, baseY2
                    );
                    ctx.stroke();

                    slurStarts.delete(note.slur.number || 1);
                }
            }

            ctx.restore();
        }

        /**
         * Render articulation marks (staccato, accent, tenuto, fermata, etc.)
         * on notes that have them (parsed from MusicXML).
         */
        renderArticulations(notes) {
            if (!notes) return;

            const ctx = this.ctx;
            ctx.save();

            for (let i = 0; i < notes.length; i++) {
                const note = notes[i];
                if (!note.articulations || note.isRest) continue;

                const x = this.getNoteX(note);
                const y = this.getNoteY(note);

                // Determine if marks go above or below the notehead
                let staffMiddle;
                if (this.clef === 'grand') {
                    staffMiddle = note.midi >= 60
                        ? this.staffY + 2 * this.staffSpacing
                        : this.staffY + 100 + 2 * this.staffSpacing;
                } else {
                    staffMiddle = this.staffY + 2 * this.staffSpacing;
                }
                const stemDir = y < staffMiddle ? 1 : -1;
                // Articulations go on the opposite side of the stem
                const markDir = -stemDir;
                const markY = y + (markDir * 14);

                ctx.fillStyle = '#3D2B1F';
                ctx.strokeStyle = '#3D2B1F';

                for (const art of note.articulations) {
                    switch (art) {
                        case 'staccato':
                            // Small dot above/below note
                            ctx.beginPath();
                            ctx.arc(x, markY, 2, 0, Math.PI * 2);
                            ctx.fill();
                            break;

                        case 'accent':
                            // ">" shaped accent mark
                            ctx.lineWidth = 1.8;
                            ctx.lineCap = 'round';
                            ctx.lineJoin = 'round';
                            ctx.beginPath();
                            ctx.moveTo(x - 5, markY - 3);
                            ctx.lineTo(x + 3, markY);
                            ctx.lineTo(x - 5, markY + 3);
                            ctx.stroke();
                            break;

                        case 'tenuto':
                            // Short horizontal line
                            ctx.lineWidth = 2;
                            ctx.lineCap = 'round';
                            ctx.beginPath();
                            ctx.moveTo(x - 5, markY);
                            ctx.lineTo(x + 5, markY);
                            ctx.stroke();
                            break;

                        case 'staccatissimo':
                            // Wedge/triangle above note
                            ctx.beginPath();
                            ctx.moveTo(x, markY - 4);
                            ctx.lineTo(x - 2, markY + 2);
                            ctx.lineTo(x + 2, markY + 2);
                            ctx.closePath();
                            ctx.fill();
                            break;
                    }
                }

                // Fermata rendered separately (it goes above the staff)
                if (note.fermata) {
                    const fermataY = this.staffY - 10;
                    ctx.lineWidth = 1.5;
                    ctx.lineCap = 'round';
                    // Dot
                    ctx.beginPath();
                    ctx.arc(x, fermataY - 3, 1.5, 0, Math.PI * 2);
                    ctx.fill();
                    // Arc
                    ctx.beginPath();
                    ctx.arc(x, fermataY, 8, Math.PI, 0);
                    ctx.stroke();
                }

                // Ornaments (trill, turn, mordent) — rendered above the note
                if (note.ornaments && note.ornaments.length > 0) {
                    const ornY = y + (markDir * 20); // Further from notehead than articulations
                    ctx.font = 'italic 12px "Times New Roman", Georgia, serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = '#3D2B1F';

                    for (const ornRaw of note.ornaments) {
                        // Support both string ('trill-mark') and object ({ type: 'trill-mark' })
                        const orn = typeof ornRaw === 'string' ? ornRaw : (ornRaw.type || '');
                        switch (orn) {
                            case 'trill-mark':
                            case 'trill':
                                ctx.font = 'italic bold 13px "Times New Roman", Georgia, serif';
                                ctx.fillText('tr', x, ornY);
                                // Wavy line after trill
                                ctx.lineWidth = 1;
                                ctx.beginPath();
                                for (let wx = x + 8; wx < x + 22; wx += 4) {
                                    ctx.moveTo(wx, ornY - 2);
                                    ctx.lineTo(wx + 2, ornY + 2);
                                    ctx.lineTo(wx + 4, ornY - 2);
                                }
                                ctx.stroke();
                                break;

                            case 'turn':
                                // S-shaped turn symbol
                                ctx.font = '16px serif';
                                ctx.fillText('\u223D', x, ornY); // ∽ (tilde)
                                break;

                            case 'mordent':
                            case 'inverted-mordent':
                                // Zigzag mordent symbol
                                ctx.lineWidth = 1.5;
                                ctx.beginPath();
                                ctx.moveTo(x - 6, ornY);
                                ctx.lineTo(x - 2, ornY - 4);
                                ctx.lineTo(x + 2, ornY + 4);
                                ctx.lineTo(x + 6, ornY);
                                ctx.stroke();
                                if (orn === 'mordent') {
                                    // Regular mordent has vertical line through center
                                    ctx.beginPath();
                                    ctx.moveTo(x, ornY - 5);
                                    ctx.lineTo(x, ornY + 5);
                                    ctx.stroke();
                                }
                                break;
                        }
                    }
                }

                // Tuplet indicator ("3" for triplets, etc.)
                if (note.isTuplet && note.tupletActual) {
                    const tupletY = y + (markDir * 25);
                    ctx.font = 'italic 10px "Times New Roman", Georgia, serif';
                    ctx.textAlign = 'center';
                    ctx.fillStyle = '#5C4E3C';
                    ctx.fillText(String(note.tupletActual), x, tupletY);
                }
            }

            ctx.restore();
        }

        /**
         * Identify groups of consecutive eighth/sixteenth notes that should be beamed together
         * USER REQUEST: Consecutive eighths/sixteenths should use beams, not flags
         * CRITICAL: ALL consecutive eighths within a beat group MUST be beamed together
         * IMPROVED: More aggressive grouping - beam all eighths within same measure beat-group
         */
        identifyBeamGroups(notes) {
            const beamGroups = [];
            // PERF: Build beamable array without .filter() — avoid allocating new array each frame
            const beamableNotes = [];
            for (let i = 0; i < notes.length; i++) {
                const n = notes[i];
                if ((n.duration === 'eighth' || n.duration === 'sixteenth' || n.duration === 'thirty-second') && !n.isRest && n.midi) {
                    beamableNotes.push(n);
                }
            }

            if (beamableNotes.length < 2) return beamGroups;

            // Sort by staff FIRST (so treble and bass are grouped separately),
            // then by measure, then by beat — ensures beaming works in grand staff
            beamableNotes.sort((a, b) => {
                const aStaff = a.midi >= 60 ? 1 : 0;
                const bStaff = b.midi >= 60 ? 1 : 0;
                if (aStaff !== bStaff) return aStaff - bStaff;
                if (a.measure !== b.measure) return a.measure - b.measure;
                return snapBeat(a.beat) - snapBeat(b.beat);
            });

            // IMPROVED STRATEGY: Group all eighth notes within same beat-group
            // Beat groups in 4/4: [0-1], [1-2], [2-3], [3-4]
            // This ensures consecutive eighths are always beamed even with inexact beat values
            const getBeatGroup = (beat) => Math.floor(snapBeat(beat));

            let currentGroup = [];
            let lastNote = null;

            beamableNotes.forEach(note => {
                if (!lastNote) {
                    currentGroup = [note];
                } else {
                    const sameMeasure = note.measure === lastNote.measure;
                    const sameStaff = this.clef !== 'grand' ||
                        (note.midi >= 60) === (lastNote.midi >= 60);

                    const snappedNote = snapBeat(note.beat);
                    const snappedLast = snapBeat(lastNote.beat);

                    // STRATEGY 1: Check if notes are in same or adjacent beat groups within measure
                    const lastBeatGroup = getBeatGroup(lastNote.beat);
                    const currentBeatGroup = getBeatGroup(note.beat);
                    const adjacentBeatGroup = sameMeasure &&
                        (currentBeatGroup === lastBeatGroup || currentBeatGroup === lastBeatGroup + 1);

                    // STRATEGY 2: Check actual beat difference (more precise, using snapped beats)
                    const lastNoteBeatDiff = lastNote.duration === 'eighth' ? 0.5 : lastNote.duration === 'sixteenth' ? 0.25 : 0.125;
                    const expectedBeat = snappedLast + lastNoteBeatDiff;
                    const beatDiff = Math.abs(snappedNote - expectedBeat);
                    const isExactlyConsecutive = sameMeasure && beatDiff < 0.15;

                    // STRATEGY 3: Notes within 1 beat of each other should be grouped
                    const withinOneBeat = sameMeasure && Math.abs(snappedNote - snappedLast) <= 1.0;

                    // Cross-measure beaming: last beat of measure -> first beat of next
                    const crossMeasure = note.measure === lastNote.measure + 1 &&
                        snappedNote < 0.5 && snappedLast >= 3.0;

                    // Combine strategies: be aggressive about grouping
                    const shouldGroup = sameStaff && (
                        isExactlyConsecutive ||
                        (adjacentBeatGroup && withinOneBeat) ||
                        crossMeasure
                    );

                    // Duration compatibility (all beamable durations can mix)
                    const beamableDurations = ['eighth', 'sixteenth', 'thirty-second'];
                    const compatibleDuration = beamableDurations.includes(note.duration) &&
                        beamableDurations.includes(lastNote.duration);

                    if (shouldGroup && compatibleDuration) {
                        currentGroup.push(note);
                    } else {
                        // Save current group if it has 2+ notes
                        if (currentGroup.length >= 2) {
                            // Use highest beam count needed for the group
                            const has32nd = currentGroup.some(n => n.duration === 'thirty-second');
                            const hasSixteenth = currentGroup.some(n => n.duration === 'sixteenth');
                            const beamCount = has32nd ? 3 : hasSixteenth ? 2 : 1;
                            beamGroups.push({ notes: [...currentGroup], beamCount });
                        }
                        currentGroup = [note];
                    }
                }
                lastNote = note;
            });

            // Don't forget the last group
            if (currentGroup.length >= 2) {
                const has32nd = currentGroup.some(n => n.duration === 'thirty-second');
                const hasSixteenth = currentGroup.some(n => n.duration === 'sixteenth');
                const beamCount = has32nd ? 3 : hasSixteenth ? 2 : 1;
                beamGroups.push({ notes: [...currentGroup], beamCount });
            }

            return beamGroups;
        }

        /**
         * Render beamed notes with horizontal beam(s) connecting stems
         * USER REQUEST: Use beams instead of individual flags for consecutive eighth/sixteenth notes
         * PROFESSIONAL FIX: Each stem must connect perfectly to the horizontal beam
         */
        renderBeamedNotes(notes, beamCount = 1) {
            if (notes.length < 2) return;

            const ctx = this.ctx;
            ctx.save();

            // Determine stem direction based on average pitch relative to staff middle
            const avgY = notes.reduce((sum, n) => sum + this._clampNoteY(this.getNoteY(n), n), 0) / notes.length;
            // For grand staff, use the correct middle line for the staff these notes are on
            let staffMiddleY = this.staffY + 2 * this.staffSpacing; // treble middle
            if (this.clef === 'grand' && notes[0].midi < 60) {
                staffMiddleY = this.staffY + 100 + 2 * this.staffSpacing; // bass middle
            }
            const stemDirection = avgY < staffMiddleY ? 1 : -1; // 1 = down, -1 = up

            const minStemLength = 28; // Minimum stem length for readability
            const beamThickness = 5; // Slightly thicker beam for visibility
            const beamSpacing = 7; // Space between beams for sixteenth notes

            // PROFESSIONAL FIX: Calculate beam line position FIRST
            // Find the extreme note positions to determine beam angle
            const firstX = this.getNoteX(notes[0]);
            const lastX = this.getNoteX(notes[notes.length - 1]);
            const firstY = this.getNoteY(notes[0]);
            const lastY = this.getNoteY(notes[notes.length - 1]);

            // Find min/max Y to determine beam position
            let beamBaseY;
            if (stemDirection === -1) {
                // Stems up - beam at top, find the HIGHEST note (lowest Y)
                const minY = Math.min(...notes.map(n => this._clampNoteY(this.getNoteY(n), n)));
                beamBaseY = minY - minStemLength;
            } else {
                // Stems down - beam at bottom, find the LOWEST note (highest Y)
                const maxY = Math.max(...notes.map(n => this._clampNoteY(this.getNoteY(n), n)));
                beamBaseY = maxY + minStemLength;
            }

            // PROFESSIONAL: Calculate sloped beam line (optional: make it horizontal for cleaner look)
            // For professional notation, beams are often horizontal or slightly sloped
            // Using horizontal beam for cleaner appearance
            const useHorizontalBeam = true;

            // Calculate beam Y position for each note
            const getBeamY = (noteX) => {
                if (useHorizontalBeam) {
                    return beamBaseY;
                }
                // Sloped beam (interpolate between first and last)
                const t = (noteX - firstX) / (lastX - firstX || 1);
                const beamFirstY = firstY + (stemDirection === -1 ? -minStemLength : minStemLength);
                const beamLastY = lastY + (stemDirection === -1 ? -minStemLength : minStemLength);
                return beamFirstY + t * (beamLastY - beamFirstY);
            };

            // USER FIX: Determine beam color based on note states
            // If any note is highlighted = gold, if any is played = green, if any is missed/imprecise = red
            const isFreeMode = this.engine.mode === 'free';
            const isWaitMode = this.engine.mode === 'wait';
            const isScrollMode = this.engine.mode === 'scroll';

            // Check group state for beam color
            const anyHighlighted = notes.some(n => n.highlighted);
            const anyMissed = notes.some(n => n.missed);
            const anyImprecise = notes.some(n => n.imprecise);
            const allPlayed = notes.every(n => n.played);

            let beamColor = '#3D2B1F'; // Warm dark ink
            if (anyMissed) {
                beamColor = '#F44336'; // Red
            } else if (anyImprecise) {
                beamColor = '#C59D3A'; // Yellow
            } else if (allPlayed && !isFreeMode) {
                beamColor = '#4CAF50'; // Green
            } else if (anyHighlighted && (isWaitMode || isScrollMode)) {
                beamColor = '#C59D3A'; // Gold
            }

            // Draw each note head and stem that CONNECTS to the beam
            notes.forEach((note, idx) => {
                const x = this.getNoteX(note);
                const y = this._clampNoteY(this.getNoteY(note), note);

                // Set color based on note state (same priority as single-note rendering)
                let noteColor;
                if (note.missed) {
                    noteColor = '#F44336'; // Red - wrong/missed
                } else if (note.played && !isFreeMode) {
                    noteColor = '#4CAF50'; // Green - correct first try
                } else if (note.imprecise) {
                    noteColor = '#FF9800'; // Orange - correct after mistakes
                } else if (note.highlighted && (isWaitMode || isScrollMode)) {
                    noteColor = '#C59D3A'; // Gold - current note to play
                } else {
                    noteColor = '#3D2B1F'; // Dark brown
                }
                ctx.fillStyle = noteColor;
                ctx.strokeStyle = noteColor;

                // Draw note head (filled) - Path2D professional glyph
                this.glyphs.draw(ctx, 'noteheadFilled', x, y, 1.3, noteColor);

                // Draw ledger lines if needed (use note color)
                this.drawLedgerLines(x, y, note, noteColor);

                // Draw dot for dotted beamed notes (e.g., dotted eighth)
                if (note.duration && note.duration.includes('dotted')) {
                    ctx.fillStyle = noteColor;
                    ctx.beginPath();
                    ctx.arc(x + 13, y, 2.5, 0, 2 * Math.PI);
                    ctx.fill();
                }

                // MANDATORY - Draw accidentals (sharps/flats) for beamed notes
                // Accidentals must ALWAYS be shown, not just for non-beamed notes
                let accidental = note.accidental;
                if (!accidental && note.midi) {
                    accidental = this.getAccidentalForMIDI(note.midi);
                }
                if (accidental) {
                    this.drawAccidental(x - 15, y, accidental, noteColor);
                }

                // Draw stem that connects exactly to beam position
                const beamY = getBeamY(x);
                ctx.lineWidth = 1.8;
                ctx.lineCap = 'butt';

                if (stemDirection === -1) {
                    // Stem up (right edge of notehead) - connects to beam above
                    ctx.beginPath();
                    ctx.moveTo(x + 7, y);
                    ctx.lineTo(x + 7, beamY);
                    ctx.stroke();
                } else {
                    // Stem down (left edge of notehead) - connects to beam below
                    ctx.beginPath();
                    ctx.moveTo(x - 7, y);
                    ctx.lineTo(x - 7, beamY);
                    ctx.stroke();
                }
            });

            // Draw horizontal beam(s) connecting all stems
            // USER FIX: Use beam color (matches notes state - gold/green/red)
            ctx.fillStyle = beamColor;
            ctx.strokeStyle = beamColor;

            // Calculate beam endpoints
            const stemOffset = stemDirection === -1 ? 7 : -7;
            const beamStartX = firstX + stemOffset;
            const beamEndX = lastX + stemOffset;
            const beamStartY = getBeamY(firstX);
            const beamEndY = getBeamY(lastX);

            // Draw beam(s) as filled rectangles for proper thickness
            for (let beam = 0; beam < beamCount; beam++) {
                const beamOffset = stemDirection === -1 ? beam * beamSpacing : -beam * beamSpacing;

                ctx.beginPath();
                ctx.moveTo(beamStartX, beamStartY + beamOffset);
                ctx.lineTo(beamEndX, beamEndY + beamOffset);
                ctx.lineTo(beamEndX, beamEndY + beamOffset + (stemDirection === -1 ? beamThickness : -beamThickness));
                ctx.lineTo(beamStartX, beamStartY + beamOffset + (stemDirection === -1 ? beamThickness : -beamThickness));
                ctx.closePath();
                ctx.fill();
            }

            // USER FIX: Draw note labels for beamed notes if enabled
            // This was missing - eighth notes weren't getting labels!
            if (this.noteNameSystem !== 'none') {
                notes.forEach((note, idx) => {
                    if (!note.isRest && note.midi !== null) {
                        const x = this.getNoteX(note);
                        const y = this.getNoteY(note);
                        this.drawNoteName(x, y, note, stemDirection, false, idx);
                    }
                });
            }

            ctx.restore();
        }

        /**
         * Render a chord (multiple notes played simultaneously)
         * USER FIX CRITICAL: Notes on DIFFERENT staves (treble vs bass) MUST NOT be connected
         * Only notes on the SAME staff should share a vertical stem
         */
        renderChord(notes) {
            if (notes.length === 0) return;

            // Sort notes by pitch (lowest to highest)
            const sortedNotes = [...notes].sort((a, b) => a.midi - b.midi);

            // CRITICAL FIX: Separate notes by staff (treble vs bass)
            // In grand staff: MIDI >= 60 = treble, MIDI < 60 = bass
            const trebleNotes = [];
            const bassNotes = [];

            if (this.clef === 'grand') {
                sortedNotes.forEach(note => {
                    if (note.midi >= 60) {
                        trebleNotes.push(note);
                    } else {
                        bassNotes.push(note);
                    }
                });

                // USER RULE: Notes on different staves → render separately (NO connecting stem)
                if (trebleNotes.length > 0) {
                    this.renderChordOnSingleStaff(trebleNotes, 'treble');
                }
                if (bassNotes.length > 0) {
                    this.renderChordOnSingleStaff(bassNotes, 'bass');
                }
            } else {
                // Single staff (treble or bass only) → render all together
                this.renderChordOnSingleStaff(sortedNotes, this.clef);
            }
        }

        /**
         * Render a chord on a single staff (treble OR bass, not both)
         * USER REQUEST: Vertical stem connects notes on SAME staff only
         * PROFESSIONAL: Proper note spacing, stem placement, no overlapping
         */
        renderChordOnSingleStaff(notes, staff) {
            if (notes.length === 0) return;

            // Remove duplicate MIDI notes before rendering
            const uniqueMidiMap = new Map();
            notes.forEach(note => {
                if (!uniqueMidiMap.has(note.midi)) {
                    uniqueMidiMap.set(note.midi, note);
                }
            });
            let sortedNotes = Array.from(uniqueMidiMap.values()).sort((a, b) => a.midi - b.midi);

            // CRITICAL: Normalize durations within a chord on same staff
            // All notes in a chord MUST have the same duration (use the shortest)
            const durOrder = ['thirty-second', 'sixteenth', 'eighth', 'dotted-eighth', 'quarter', 'dotted-quarter', 'half', 'dotted-half', 'whole'];
            if (sortedNotes.length > 1) {
                let shortestIdx = durOrder.length;
                sortedNotes.forEach(n => {
                    const idx = durOrder.indexOf(n.duration);
                    if (idx >= 0 && idx < shortestIdx) shortestIdx = idx;
                });
                if (shortestIdx < durOrder.length) {
                    const uniformDur = durOrder[shortestIdx];
                    sortedNotes.forEach(n => { n.duration = uniformDur; });
                }
            }

            if (sortedNotes.length === 0) return;

            // If dedup reduced to single note, render as normal note instead of chord
            if (sortedNotes.length === 1) {
                this.renderNote(sortedNotes[0]);
                return;
            }

            // Use the position of the first note
            const x = this.getNoteX(sortedNotes[0]);
            const ctx = this.ctx;
            ctx.save();

            // Determine color based on first note's state
            const firstNote = sortedNotes[0];
            const isFreeMode = this.engine.mode === 'free';
            const isWaitMode = this.engine.mode === 'wait';
            const isScrollMode = this.engine.mode === 'scroll';

            // Determine color from ALL chord notes (any missed/highlighted/played applies to whole chord)
            const anyMissed = sortedNotes.some(n => n.missed);
            const anyImprecise = sortedNotes.some(n => n.imprecise);
            const anyPlayed = sortedNotes.some(n => n.played);
            const anyHighlighted = sortedNotes.some(n => n.highlighted);

            const noteColor = anyMissed ? '#F44336' :
                             anyImprecise ? '#C59D3A' :
                             (anyPlayed && !isFreeMode) ? '#4CAF50' :
                             (anyHighlighted && (isWaitMode || isScrollMode)) ? '#C59D3A' :
                             '#3D2B1F';

            ctx.fillStyle = noteColor;
            ctx.strokeStyle = noteColor;

            // Calculate Y positions for all notes (clamped to visible staff area)
            const notePositions = sortedNotes.map(note => ({
                note: note,
                y: this._clampNoteY(this.getNoteY(note), note)
            }));

            // Determine stem direction based on average position relative to staff middle
            const avgY = notePositions.reduce((sum, np) => sum + np.y, 0) / notePositions.length;
            let chordStaffMiddle = this.staffY + 2 * this.staffSpacing;
            if (this.clef === 'grand' && staff === 'bass') {
                chordStaffMiddle = this.staffY + 100 + 2 * this.staffSpacing;
            }
            const stemDirection = avgY < chordStaffMiddle ? 1 : -1;

            // ✅ PROFESSIONAL CHORD SPACING
            // Standard music notation rules for close notes (seconds):
            // - When two notes are a second apart, one note goes on the opposite side of the stem
            // - The lower note goes on the left when stem is up, right when stem is down
            const processedPositions = [];
            // Notehead offset: use slightly less than full width for tighter chord appearance
            const noteHeadWidth = Math.round(this.glyphs.baseScale * 1.3 * 13);
            const S = this.staffSpacing;

            notePositions.forEach((currentPos, index) => {
                let offsetX = 0;

                if (index > 0) {
                    // Check collision with ALL previously placed notes (not just prev)
                    let needsOffset = false;
                    for (let j = 0; j < processedPositions.length; j++) {
                        const otherY = processedPositions[j].y;
                        const otherOffsetX = processedPositions[j].offsetX;
                        const verticalGap = Math.abs(currentPos.y - otherY);

                        // Notes are a "second" apart if less than one staff space + small margin
                        if (verticalGap < S + 2 && otherOffsetX === 0) {
                            needsOffset = true;
                            break;
                        }
                    }

                    if (needsOffset) {
                        // Check if putting it at the offset position would collide with another offset note
                        const candidateOffset = stemDirection === -1 ? noteHeadWidth : -noteHeadWidth;
                        let offsetCollides = false;
                        for (let j = 0; j < processedPositions.length; j++) {
                            const otherY = processedPositions[j].y;
                            const otherOffsetX = processedPositions[j].offsetX;
                            const verticalGap = Math.abs(currentPos.y - otherY);
                            if (verticalGap < S + 2 && otherOffsetX === candidateOffset) {
                                offsetCollides = true;
                                break;
                            }
                        }
                        // If no collision at offset position, use it; otherwise stay at 0
                        // (two notes at 0 that are far apart vertically won't collide)
                        if (!offsetCollides) {
                            offsetX = candidateOffset;
                        }
                    }
                }

                processedPositions.push({ ...currentPos, offsetX });
            });

            // Draw all note heads with proper horizontal offset
            const isMultiNoteChord = processedPositions.length >= 2;
            processedPositions.forEach(({ note, y, offsetX }) => {
                const noteX = x + offsetX; // Apply horizontal offset
                const isOpenNote = note.duration === 'whole' || note.duration === 'half' || note.duration === 'dotted-half';

                // Draw note head - Path2D professional glyph
                if (isOpenNote) {
                    const glyphName = (note.duration === 'whole') ? 'noteheadWhole' : 'noteheadHalf';
                    this.glyphs.drawEvenOdd(ctx, glyphName, noteX, y, 1.3, noteColor);
                } else {
                    this.glyphs.draw(ctx, 'noteheadFilled', noteX, y, 1.3, noteColor);
                }

                // Draw ledger lines if needed (use chord color)
                this.drawLedgerLines(noteX, y, note, noteColor);

                // Draw dot for dotted notes in chords
                if (note.duration && note.duration.includes('dotted')) {
                    ctx.fillStyle = noteColor;
                    ctx.beginPath();
                    ctx.arc(noteX + 13, y, 2.5, 0, 2 * Math.PI);
                    ctx.fill();
                }

                // Store note info for accidental collision detection
                const accidental = note.accidental || this.getAccidentalForMIDI(note.midi);
                if (accidental) {
                    processedPositions[processedPositions.indexOf(processedPositions.find(p => p.note === note))].accidental = accidental;
                }
            });

            // USER FIX: Draw accidentals with collision detection
            // Collect all accidentals first, then position them to avoid overlapping notes
            const accidentalHeight = 20; // Height of accidental symbol
            const accidentalColumns = []; // Track used Y positions in each column

            processedPositions.forEach(({ note, y, offsetX, accidental }) => {
                if (!accidental) return;

                const noteX = x + offsetX;
                let accidentalX = noteX - 15; // Base position
                let accidentalY = y;

                // Check for collisions with other notes in this chord
                // Look for any note that would be overlapped by the accidental
                let collisionFound = true;
                let columnIndex = 0;
                const maxColumns = 4; // Maximum columns for accidentals

                while (collisionFound && columnIndex < maxColumns) {
                    collisionFound = false;

                    // Check if this accidental would overlap with any note head
                    for (const otherPos of processedPositions) {
                        if (otherPos.note === note) continue;

                        const otherNoteX = x + otherPos.offsetX;
                        const otherNoteY = otherPos.y;

                        // Check horizontal overlap (accidental is at accidentalX, note head is noteHeadWidth wide)
                        const horizontalOverlap = accidentalX > otherNoteX - noteHeadWidth && accidentalX < otherNoteX + noteHeadWidth;

                        // Check vertical overlap
                        const verticalOverlap = Math.abs(accidentalY - otherNoteY) < accidentalHeight / 2;

                        if (horizontalOverlap && verticalOverlap) {
                            collisionFound = true;
                            break;
                        }
                    }

                    // Check column usage for staggered accidentals
                    if (!collisionFound) {
                        const columnY = accidentalColumns[columnIndex] || [];
                        for (const usedY of columnY) {
                            if (Math.abs(usedY - accidentalY) < accidentalHeight) {
                                collisionFound = true;
                                break;
                            }
                        }
                    }

                    if (collisionFound) {
                        // Move to next column (further left)
                        columnIndex++;
                        accidentalX = noteX - 15 - (columnIndex * 12);
                    }
                }

                // Record this accidental's position
                if (!accidentalColumns[columnIndex]) accidentalColumns[columnIndex] = [];
                accidentalColumns[columnIndex].push(accidentalY);

                // Draw the accidental at the safe position
                this.drawAccidental(accidentalX, accidentalY, accidental, noteColor);
            });

            // PROFESSIONAL CHORD STEM RENDERING
            // One single stem that connects all notes and extends for rhythm indication
            // CRITICAL: Skip stem drawing if notes are beamed (stems handled by renderBeamedNotes)
            const isWholeChord = sortedNotes.every(n => n.duration === 'whole');
            const isBeamedChord = sortedNotes.some(n => n._isBeamed);

            if (!isWholeChord && !isBeamedChord && notePositions.length >= 1) {
                const stemLength = 35;
                const lowestY = notePositions[notePositions.length - 1].y;
                const highestY = notePositions[0].y;

                // PROFESSIONAL: Stem placement follows standard notation rules
                // Stem UP (stemDirection = -1): stem on RIGHT side of non-offset notes
                // Stem DOWN (stemDirection = 1): stem on LEFT side of non-offset notes
                // When notes have offsetX, the stem stays connected to non-offset noteheads
                // and offset noteheads attach on the opposite side
                const stemX = stemDirection === -1 ? x + 7 : x - 7;

                // Calculate stem endpoints
                let stemTopY, stemBottomY;
                if (stemDirection === -1) {
                    // Stem goes UP from the highest note
                    stemTopY = highestY - stemLength;
                    stemBottomY = lowestY;
                } else {
                    // Stem goes DOWN from the lowest note
                    stemTopY = highestY;
                    stemBottomY = lowestY + stemLength;
                }

                // Draw single continuous stem
                ctx.beginPath();
                ctx.moveTo(stemX, stemTopY);
                ctx.lineTo(stemX, stemBottomY);
                ctx.lineWidth = 1.8;
                ctx.lineCap = 'butt';
                ctx.stroke();

                // Draw flags for eighth/sixteenth notes (if not beamed)
                const duration = sortedNotes[0].duration;
                const isBeamed = sortedNotes[0]._isBeamed;
                if ((duration === 'eighth' || duration === 'sixteenth') && !isBeamed) {
                    const flagY = stemDirection === -1 ? stemTopY : stemBottomY;
                    this.drawFlags(stemX, flagY, stemDirection, duration, noteColor);
                }
            }

            // USER FIX: Add counting and note labels to chords (was missing, causing broken feature)
            // Draw these for the first (lowest) note of the chord
            // NOTE: firstNote already declared above at start of function
            const firstY = this.getNoteY(firstNote);

            // Draw note name if enabled
            // For chords: draw all labels as a single stacked column to avoid overlap
            if (this.noteNameSystem !== 'none') {
                this.drawChordNoteNames(x, sortedNotes, stemDirection, processedPositions);
            }

            // USER REQUEST: Draw arpeggio symbol for chords with 5+ notes
            // Wavy vertical line on the left of the chord
            if (sortedNotes.length >= 5) {
                this.drawArpeggioSymbol(x, notePositions);
            }

            ctx.restore();
        }

        /**
         * Draw arpeggio symbol (wavy vertical line) for large chords
         * USER REQUEST: Chords with 5+ notes should have arpeggio symbol
         */
        drawArpeggioSymbol(x, notePositions) {
            if (notePositions.length < 2) return;

            const ctx = this.ctx;
            ctx.save();

            const topY = notePositions[0].y - 4;
            const bottomY = notePositions[notePositions.length - 1].y + 4;
            const height = bottomY - topY;

            // Position to the left of the chord
            const ax = x - 18;

            // Professional arpeggio: smooth bezier S-curves (like Bravura/SMuFL)
            const waveSize = 5;
            const numWaves = Math.max(2, Math.round(height / waveSize));
            const actualWave = height / numWaves;
            const amp = 3;

            ctx.strokeStyle = '#3D2B1F';
            ctx.lineWidth = 1.6;
            ctx.lineCap = 'round';

            ctx.beginPath();
            ctx.moveTo(ax, bottomY);
            for (let i = 0; i < numWaves; i++) {
                const y0 = bottomY - i * actualWave;
                const y1 = y0 - actualWave;
                const mid = (y0 + y1) / 2;
                // Each wave is two quarter-circle bezier curves
                ctx.bezierCurveTo(ax + amp, y0, ax + amp, mid, ax, mid);
                ctx.bezierCurveTo(ax - amp, mid, ax - amp, y1, ax, y1);
            }
            ctx.stroke();

            // Small arrowhead at top
            ctx.beginPath();
            ctx.moveTo(ax - 3, topY + 4);
            ctx.lineTo(ax, topY - 1);
            ctx.lineTo(ax + 3, topY + 4);
            ctx.strokeStyle = '#3D2B1F';
            ctx.lineWidth = 1.4;
            ctx.stroke();

            ctx.restore();
        }

        renderNote(note) {
            const x = this.getNoteX(note);

            const ctx = this.ctx;
            ctx.save();

            // Color based on note state
            // USER REQUEST: Wait AND Scroll mode - colored notes
            // - GOLD (#C59D3A) = notes to play (highlighted) in wait/scroll mode
            // - GREEN (#4CAF50) = played correctly on first try
            // - ORANGE (#FF9800) = played correctly after mistakes (imprecise)
            // - RED (#F44336) = missed
            // - BLACK = default (not yet active)
            const isFreeMode = this.engine.mode === 'free';
            const isWaitMode = this.engine.mode === 'wait';
            const isScrollMode = this.engine.mode === 'scroll';

            // NOTE COLORING STATE MACHINE (strict priority order):
            // 1. missed = RED (wrong note, never override)
            // 2. played = GREEN (correct on first try)
            // 3. imprecise = ORANGE (correct after mistakes - distinct from gold)
            // 4. highlighted = GOLD (current note to play)
            // 5. default = DARK BROWN (unplayed future notes)
            let noteColor;
            if (note.missed) {
                noteColor = '#F44336'; // Red - wrong/missed
            } else if (note.played && !isFreeMode) {
                noteColor = '#4CAF50'; // Green - correct on first try
            } else if (note.imprecise) {
                noteColor = '#FF9800'; // Orange - correct but after mistakes
            } else if (note.highlighted && (isWaitMode || isScrollMode)) {
                noteColor = '#C59D3A'; // Gold - current note to play
            } else {
                noteColor = '#3D2B1F'; // Rich dark brown ink
            }

            ctx.fillStyle = noteColor;
            ctx.strokeStyle = noteColor;

            // ======= SILENCES (RESTS) =======
            // If this is a rest, draw rest symbol instead of note
            if (note.isRest || note.midi === null || note.midi === undefined) {
                // Calculate Y position for rest (middle of staff)
                // Use staff property for rests (midi is null), fallback to treble
                const isTrebleRest = note.staff === 'treble' || note.staff === undefined || (note.midi !== null && note.midi >= 60);
                const staffMiddleY = this.clef === 'grand' ?
                    (isTrebleRest ? this.staffY + 2 * this.staffSpacing : this.staffY + 100 + 2 * this.staffSpacing) :
                    this.staffY + 2 * this.staffSpacing;

                switch(note.duration) {
                    case 'whole':
                        this.drawWholeRest(x, staffMiddleY - this.staffSpacing);
                        break;
                    case 'half':
                    case 'dotted-half':
                        this.drawHalfRest(x, staffMiddleY);
                        break;
                    case 'quarter':
                        this.drawQuarterRest(x, staffMiddleY);
                        break;
                    case 'eighth':
                        this.drawEighthRest(x, staffMiddleY);
                        break;
                    case 'sixteenth':
                    case 'thirty-second':
                        this.drawSixteenthRest(x, staffMiddleY);
                        break;
                    default:
                        this.drawQuarterRest(x, staffMiddleY);
                }

                ctx.restore();
                return; // Don't draw note, just the rest
            }

            // ======= NOTES NORMALES =======
            const y = this._clampNoteY(this.getNoteY(note), note);

            // Stem direction: up if below middle line, down if above
            // For grand staff, use correct middle for treble vs bass
            let staffMiddleY = this.staffY + 2 * this.staffSpacing;
            if (this.clef === 'grand' && note.midi < 60) {
                staffMiddleY = this.staffY + 100 + 2 * this.staffSpacing;
            }
            const stemDirection = y < staffMiddleY ? 1 : -1;

            // Draw note head based on duration
            const isOpenNote = note.duration === 'whole' || note.duration === 'half' || note.duration === 'dotted-half';

            // PROFESSIONAL NOTE HEAD - Path2D glyph
            if (isOpenNote) {
                const glyphName = (note.duration === 'whole') ? 'noteheadWhole' : 'noteheadHalf';
                this.glyphs.drawEvenOdd(ctx, glyphName, x, y, 1.3, noteColor);
            } else {
                this.glyphs.draw(ctx, 'noteheadFilled', x, y, 1.3, noteColor);
            }

            // Draw stem if needed (all notes except whole notes and beamed notes)
            // Beamed notes get their stems drawn in renderBeamedNotes to avoid double stems
            if (note.duration !== 'whole' && !note._isBeamed) {
                const stemHeight = 38;

                // Stem UP: right edge of notehead, Stem DOWN: left edge
                // Offset = half notehead width (8 * 0.6 = 4.8) to connect seamlessly
                const stemX = x + (stemDirection > 0 ? -7 : 7);
                const stemEndY = y + (stemHeight * stemDirection);

                ctx.beginPath();
                ctx.moveTo(stemX, y);
                ctx.lineTo(stemX, stemEndY);
                ctx.lineWidth = 1.8;
                ctx.lineCap = 'butt';
                ctx.stroke();

                // Draw flags for eighth and sixteenth notes
                if (note.duration === 'eighth' || note.duration === 'sixteenth') {
                    this.drawFlags(stemX, stemEndY, stemDirection, note.duration, noteColor);
                }
            }

            // Draw dot for dotted notes - enhanced for better visibility
            if (note.duration && note.duration.includes('dotted')) {
                ctx.beginPath();
                ctx.arc(x + 13, y, 2.5, 0, 2 * Math.PI); // Larger dot, better positioned
                ctx.fill();
                // Add subtle outline for definition
                ctx.lineWidth = 0.5;
                ctx.stroke();
            }

            // Draw ledger lines if needed (use same color as note for highlighted/played/missed)
            this.drawLedgerLines(x, y, note, noteColor);

            // Draw accidentals
            // CRITICAL FIX: Auto-detect accidental if not specified
            let accidental = note.accidental;
            if (!accidental && note.midi) {
                // Detect if note is a sharp/flat based on MIDI
                const noteName = this.getMIDINoteName(note.midi);
                if (noteName.includes('#')) {
                    accidental = 'sharp';
                } else if (noteName.includes('b')) {
                    accidental = 'flat';
                }
            }

            // CRITICAL: Draw accidental with same color as note (gold if highlighted)
            if (accidental) {
                this.drawAccidental(x - 15, y, accidental, noteColor);
            }

            // Notes are colored: gold = to play, green = correct, yellow = imprecise
            // No more frames, circles, or squares around notes per user request

            // Note names — only draw if not beamed (beamed notes get labels in renderBeamedNotes)
            if (this.noteNameSystem !== 'none' && !note._isBeamed) {
                this.drawNoteName(x, y, note, stemDirection, false);
            }

            // EXERCISE MODE: Draw fingering number above/below note
            if (this.engine.exerciseMode && this.engine.exerciseShowFingering && note._fingering) {
                const fingerY = stemDirection > 0 ? y + 18 : y - 18;
                ctx.save();
                ctx.font = 'bold 11px serif';
                ctx.fillStyle = '#1565C0';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(note._fingering), x, fingerY);
                ctx.restore();
            }

            // EXERCISE MODE: Draw colored circle behind next notes to play
            if (this.engine.exerciseMode && this.engine.exerciseHighlightNext && note._exerciseNext) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(x, y, 12, 0, 2 * Math.PI);
                ctx.fillStyle = note.staff === 'treble' ? 'rgba(33, 150, 243, 0.2)' : 'rgba(76, 175, 80, 0.2)';
                ctx.fill();
                ctx.strokeStyle = note.staff === 'treble' ? '#2196F3' : '#4CAF50';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.restore();
            }

            ctx.restore();
        }

        getNoteX(note) {
            // STANDARDIZED NOTE POSITIONING SYSTEM
            // Notes are placed at precise, predetermined grid positions within measures.
            // Grid: each quarter-note beat gets equal width. Sub-beats (eighth, sixteenth)
            // are placed at exact fractional positions within that grid.

            const clefAndSignatureWidth = this.calculatedNoteStartX || 200;
            const barLineMargin = 25; // Must match drawGrandStaffBarLines and renderCountingTime

            let baseX = clefAndSignatureWidth;

            // Calculate measure position
            if (note.measure !== undefined) {
                baseX += note.measure * (this.measureWidth + barLineMargin);
            }

            // Add initial bar line margin
            baseX += barLineMargin;

            // Calculate beat position within measure (GRID-SNAPPED SPACING)
            if (note.beat !== undefined) {
                // Use per-measure time signature if available (MXL with mid-piece changes)
                let quarterBeatsPerMeasure;
                const measureMeta = this.engine?._xmlMeasures?.[note.measure];
                if (measureMeta && measureMeta.beatsPerMeasure && measureMeta.beatType) {
                    quarterBeatsPerMeasure = (measureMeta.beatsPerMeasure * 4) / measureMeta.beatType;
                } else {
                    // PERF: Cache parsed time signature for generated exercises
                    if (this._tsCache_sig !== this.timeSignature) {
                        this._tsCache_sig = this.timeSignature;
                        const parts = this.timeSignature.split('/');
                        this._tsCache_top = parseInt(parts[0]) || 4;
                        this._tsCache_bot = parseInt(parts[1]) || 4;
                        this._tsCache_qbeats = (this._tsCache_top * 4) / this._tsCache_bot;
                    }
                    quarterBeatsPerMeasure = this._tsCache_qbeats;
                }
                const beatWidth = this.measureWidth / quarterBeatsPerMeasure;

                let effectiveBeat = note.beat;
                let measureOverflow = 0;

                // Normalize beat overflow
                if (effectiveBeat >= quarterBeatsPerMeasure) {
                    measureOverflow = Math.floor(effectiveBeat / quarterBeatsPerMeasure);
                    effectiveBeat = effectiveBeat % quarterBeatsPerMeasure;
                    baseX += measureOverflow * (this.measureWidth + barLineMargin);
                }

                // SNAP to sixteenth-note grid (1/4 of a beat = finest resolution)
                // This ensures all notes land on clean, predetermined positions
                const GRID = 0.25; // sixteenth-note resolution
                const snappedBeat = Math.round(effectiveBeat / GRID) * GRID;

                // Clamp to prevent notes landing on or past the bar line
                const maxBeat = quarterBeatsPerMeasure - GRID;
                const clampedBeat = Math.min(snappedBeat, maxBeat);
                baseX += clampedBeat * beatWidth;
            }

            // Handle subdivision for smaller note values (eighth, sixteenth, etc.)
            if (note.subdivision !== undefined && this._tsCache_qbeats) {
                const subdivisionWidth = (this.measureWidth / this._tsCache_qbeats) / 4;
                baseX += note.subdivision * subdivisionWidth;
            }

            return baseX;
        }
        
        getNoteY(note) {
            // PLACEMENT NOTES SIMPLIFIÉ ET CORRECT
            const midi = note.midi;
            const halfSpace = this.staffSpacing / 2; // 6px

            if (this.clef === 'grand') {
                const trebleY = this.staffY;
                const bassY = this.staffY + 100; // Gap between treble and bass staves

                // Grand staff: notes >= C4 (MIDI 60) sur treble, sinon bass
                if (midi >= 60) {
                    // TREBLE STAFF: E4 (MIDI 64) sur ligne du bas (5ème ligne)
                    const e4Position = trebleY + (4 * this.staffSpacing); // 5ème ligne
                    const e4Midi = 64;

                    // USER FIX: Start GENTLE compression from A6 (MIDI 81) to fit high notes
                    // Notes below A6: normal spacing (halfSpace = 6px)
                    // Notes at A6 and above: slightly compressed spacing (75%)
                    const a6Midi = 81;

                    if (midi < a6Midi) {
                        // Normal spacing for notes below A6
                        const distance = this.calculateDiatonicDistance(e4Midi, midi);
                        return e4Position - (distance * halfSpace);
                    } else {
                        // Calculate position of A6 with normal spacing (reference point)
                        const a6Distance = this.calculateDiatonicDistance(e4Midi, a6Midi);
                        const a6Y = e4Position - (a6Distance * halfSpace);

                        // For notes at A6 and above, use GENTLY compressed spacing
                        // Compression factor: 0.7 (70% of normal = 4.2px instead of 6px)
                        const extraDistance = this.calculateDiatonicDistance(a6Midi, midi);
                        const compressedHalfSpace = halfSpace * 0.7;

                        // Notes continue going UP (smaller y) but with slightly smaller steps
                        const y = a6Y - (extraDistance * compressedHalfSpace);
                        return y;
                    }
                } else {
                    // BASS STAFF: FA3 (F3, MIDI 53) sur 4ème ligne (ligne de référence clé de fa)
                    // CORRECTION CRITIQUE: L'utilisateur a signalé que C2 était placé où devrait être C3
                    // Solution: utiliser F3 (MIDI 53) au lieu de F2 (MIDI 41) comme référence
                    // Cela descend toutes les notes d'une octave sur la portée basse
                    const f3Position = bassY + (1 * this.staffSpacing); // 4ème ligne (index 1)
                    const f3Midi = 53; // FA3 (F3) on 4th line - CORRECTED bass clef reference
                    const distance = this.calculateDiatonicDistance(f3Midi, midi);
                    return f3Position - (distance * halfSpace);
                }
            } else if (this.clef === 'bass') {
                // BASS CLEF seul: FA3 (F3, MIDI 53) sur 4ème ligne
                const f3Position = this.staffY + (1 * this.staffSpacing); // 4ème ligne
                const f3Midi = 53; // FA3 (F3) on 4th line - CORRECTED
                const distance = this.calculateDiatonicDistance(f3Midi, midi);
                return f3Position - (distance * halfSpace);
            } else {
                // TREBLE CLEF seul: E4 (MIDI 64) sur ligne du bas
                const e4Position = this.staffY + (4 * this.staffSpacing);
                const e4Midi = 64;
                const distance = this.calculateDiatonicDistance(e4Midi, midi);
                return e4Position - (distance * halfSpace);
            }
        }

        /**
         * Clamp Y position so notes never appear outside visible staff area.
         * Called by renderNote before drawing.
         * Allows up to 4 ledger lines above/below each staff.
         */
        _clampNoteY(y, note) {
            const S = this.staffSpacing;
            const maxLedger = 4; // allow 4 ledger lines

            if (this.clef === 'grand') {
                const trebleTop = this.staffY - maxLedger * S;
                const bassBottom = this.staffY + 100 + 4 * S + maxLedger * S;
                return Math.max(trebleTop, Math.min(bassBottom, y));
            } else {
                const staffTop = this.staffY - maxLedger * S;
                const staffBottom = this.staffY + 4 * S + maxLedger * S;
                return Math.max(staffTop, Math.min(staffBottom, y));
            }
        }

        // Calculate diatonic distance between two MIDI notes
        calculateDiatonicDistance(fromMidi, toMidi) {
            const noteOrder = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

            const fromNote = this.getMIDINoteName(fromMidi).charAt(0);
            const fromOctave = Math.floor(fromMidi / 12) - 1;
            const fromIndex = noteOrder.indexOf(fromNote);

            const toNote = this.getMIDINoteName(toMidi).charAt(0);
            const toOctave = Math.floor(toMidi / 12) - 1;
            const toIndex = noteOrder.indexOf(toNote);

            const octaveDiff = toOctave - fromOctave;
            const noteDiff = toIndex - fromIndex;

            return (octaveDiff * 7) + noteDiff;
        }

        // Get note name from MIDI number
        getMIDINoteName(midi) {
            const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
            const octave = Math.floor(midi / 12) - 1;
            const noteName = noteNames[midi % 12];
            return noteName + octave;
        }

        /**
         * CRITICAL: Automatically detect accidental for a MIDI note
         * Returns 'sharp', 'flat', or null based on the key signature and note
         */
        getAccidentalForMIDI(midi) {
            // USER FIX: Smart accidental based on key signature
            // Only show accidentals for chromatic notes NOT in the key signature
            const pitchClass = midi % 12;
            const blackKeyPitchClasses = [1, 3, 6, 8, 10]; // C#, D#, F#, G#, A#

            if (!blackKeyPitchClasses.includes(pitchClass)) {
                // White key - no accidental needed
                return null;
            }

            // Get current key signature from engine
            const key = this.engine?.userSettings?.key_signature || 'C';

            // Key signature sharps (notes that are IN the key and don't need symbols)
            const keySignatureSharps = {
                'C': [],           // No sharps
                'G': [6],          // F#
                'D': [6, 1],       // F#, C#
                'A': [6, 1, 8],    // F#, C#, G#
                'E': [6, 1, 8, 3], // F#, C#, G#, D#
                'B': [6, 1, 8, 3, 10], // F#, C#, G#, D#, A#
                'F#': [6, 1, 8, 3, 10, 5]
            };

            const keySignatureFlats = {
                'F': [10],         // Bb
                'Bb': [10, 3],     // Bb, Eb
                'Eb': [10, 3, 8],  // Bb, Eb, Ab
                'Ab': [10, 3, 8, 1],
                'Db': [10, 3, 8, 1, 6],
                'Gb': [10, 3, 8, 1, 6, 11]
            };

            const sharpsInKey = keySignatureSharps[key] || [];
            const flatsInKey = keySignatureFlats[key] || [];

            // If this black key is in the key signature, no accidental needed
            if (sharpsInKey.includes(pitchClass) || flatsInKey.includes(pitchClass)) {
                return null;
            }

            // In flat keys, show flat for chromatic notes; in sharp keys, show sharp
            if (flatsInKey.length > 0) {
                return 'flat';
            }
            return 'sharp';
        }

        drawLedgerLines(x, y, note, color) {
            const ctx = this.ctx;
            ctx.strokeStyle = color || '#5C4E3C';
            ctx.lineWidth = 1.2;

            if (!note || note.midi === null || note.midi === undefined) return;

            const midi = note.midi;

            // Helper: draw a single ledger line at a given Y
            const drawLine = (ly) => {
                ctx.beginPath();
                ctx.moveTo(x - 14, ly);
                ctx.lineTo(x + 14, ly);
                ctx.stroke();
            };

            // Helper: get diatonic note names on lines (every other diatonic step = a line)
            // Ledger lines occur on diatonic positions that continue the staff pattern
            // Staff lines are on specific diatonic positions; ledger lines extend that pattern

            if (this.clef === 'grand' || this.clef === 'treble') {
                if (this.clef === 'grand' && midi < 60) {
                    // Bass note — handled below
                } else if (midi >= 60) {
                    // TREBLE CLEF
                    // Staff bottom line = E4(64), top line = F5(77)
                    // Ledger lines ABOVE: A5(81), C6(84), E6(88), G6(91), B6(95), D7(98), F7(101), A7(105)
                    const trebleLedgerAbove = [81, 84, 88, 91, 95, 98, 101, 105, 108];
                    for (const ledgerMidi of trebleLedgerAbove) {
                        if (midi >= ledgerMidi) {
                            drawLine(this.getNoteY({ midi: ledgerMidi, staff: 'treble' }));
                        }
                    }

                    // MIDDLE C (C4, MIDI 60) — ledger line below treble staff
                    // Only C4(60) and C#4/Db4(61) sit ON the ledger line
                    // D4(62) is in the space ABOVE the ledger line — no ledger line needed
                    if (midi <= 61) {
                        drawLine(this.getNoteY({ midi: 60, staff: 'treble' }));
                    }
                    // A3(57) ledger line below middle C for treble staff
                    if (midi <= 58 && this.clef === 'treble') {
                        drawLine(this.getNoteY({ midi: 57, staff: 'treble' }));
                    }
                }
            }

            if (this.clef === 'grand' || this.clef === 'bass') {
                if (this.clef === 'grand' && midi >= 60) {
                    // Treble note — already handled above
                } else if (midi < 60) {
                    // BASS CLEF
                    // Staff lines: G2(43) bottom, B2(47), D3(50), F3(53), A3(57) top
                    // Ledger lines BELOW staff: every line position below G2
                    // E2(40), C2(36), A1(33), F1(29), D1(26), B0(23), G0(19)
                    // Ledger lines ABOVE staff (for notes above A3):
                    // C4(60) = middle C above bass staff
                    const bassLedgerBelow = [40, 36, 33, 29, 26, 23, 19];
                    for (const ledgerMidi of bassLedgerBelow) {
                        if (midi <= ledgerMidi) {
                            drawLine(this.getNoteY({ midi: ledgerMidi, staff: 'bass' }));
                        }
                    }

                    // Middle C above bass staff — needed for B3(59) and above on bass staff
                    if (midi >= 59 && this.clef === 'bass') {
                        drawLine(this.getNoteY({ midi: 60, staff: 'bass' }));
                    }
                }
            }
        }
        
        /**
         * ALTÉRATIONS PROFESSIONNELLES (ACCIDENTALS)
         * Rendu Canvas professionnel des dièses, bémols et bécarres
         */

        drawAccidental(x, y, type, color = '#3D2B1F') {
            if (type === 'sharp') {
                this.drawSharp(x, y, color);
            } else if (type === 'flat') {
                this.drawFlat(x, y, color);
            } else if (type === 'natural') {
                this.drawNatural(x, y, color);
            }
        }

        /**
         * Draw sharp symbol (♯) - Path2D professional glyph
         */
        drawSharp(x, y, color = '#3D2B1F') {
            this.glyphs.draw(this.ctx, 'sharp', x, y, 0.75, color);
        }

        /**
         * Draw flat symbol (♭) - Path2D professional glyph
         */
        drawFlat(x, y, color = '#3D2B1F') {
            this.glyphs.draw(this.ctx, 'flat', x, y, 0.75, color);
        }

        /**
         * Draw natural symbol (♮) - Path2D professional glyph
         */
        drawNatural(x, y, color = '#3D2B1F') {
            this.glyphs.draw(this.ctx, 'natural', x, y, 0.75, color);
        }

        /**
         * SYMBOLES DE PÉDALE (PEDAL MARKINGS)
         * Pour niveau avancé - Indications sustain pedal
         */

        /**
         * Draw pedal down symbol - "Ped." with decorative tail
         * Shows when to press sustain pedal
         */
        drawPedalDown(x, y) {
            const ctx = this.ctx;
            ctx.save();
            ctx.fillStyle = '#3D2B1F';
            ctx.strokeStyle = '#3D2B1F';
            ctx.font = 'italic bold 14px serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';

            // Draw "Ped." text
            ctx.fillText('Ped.', x, y);

            // Decorative underline with curl
            ctx.lineWidth = 1.5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x, y + 8);
            ctx.lineTo(x + 30, y + 8);
            // Small curl at end
            ctx.quadraticCurveTo(x + 32, y + 8, x + 32, y + 10);
            ctx.stroke();

            ctx.restore();
        }

        /**
         * Draw pedal up symbol - Asterisk (*)
         * Shows when to release sustain pedal
         */
        drawPedalUp(x, y) {
            const ctx = this.ctx;
            ctx.save();
            ctx.strokeStyle = '#3D2B1F';
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';

            const size = 6;

            // Draw asterisk with 6 lines radiating from center
            for (let i = 0; i < 6; i++) {
                const angle = (i * Math.PI) / 3; // 60 degrees apart
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(
                    x + size * Math.cos(angle),
                    y + size * Math.sin(angle)
                );
                ctx.stroke();
            }

            ctx.restore();
        }

        /**
         * Draw pedal line - Horizontal line showing pedal held
         * Drawn between pedal down and pedal up
         */
        drawPedalLine(x1, x2, y) {
            const ctx = this.ctx;
            ctx.save();
            ctx.strokeStyle = '#3D2B1F';
            ctx.lineWidth = 2;
            ctx.lineCap = 'square';

            // Horizontal line
            ctx.beginPath();
            ctx.moveTo(x1, y);
            ctx.lineTo(x2, y);
            ctx.stroke();

            // Vertical ticks at ends
            ctx.beginPath();
            ctx.moveTo(x1, y - 4);
            ctx.lineTo(x1, y + 4);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(x2, y - 4);
            ctx.lineTo(x2, y + 4);
            ctx.stroke();

            ctx.restore();
        }

        /**
         * Draw bracket-style pedal marking (alternative to Ped.*)
         * Modern style used in contemporary scores
         */
        drawPedalBracket(x1, x2, y) {
            const ctx = this.ctx;
            ctx.save();
            ctx.strokeStyle = '#3D2B1F';
            ctx.lineWidth = 2;
            ctx.lineCap = 'square';
            ctx.lineJoin = 'miter';

            const bracketHeight = 8;

            // Draw bracket shape: down, across, up
            ctx.beginPath();
            ctx.moveTo(x1, y - bracketHeight);
            ctx.lineTo(x1, y);
            ctx.lineTo(x2, y);
            ctx.lineTo(x2, y - bracketHeight);
            ctx.stroke();

            ctx.restore();
        }

        /**
         * PROFESSIONAL FLAGS — Path2D glyphs
         * Flags always curve to the RIGHT in professional music notation.
         * direction: +1 = stem down (flag up), -1 = stem up (flag down)
         */
        drawFlags(x, y, direction, duration, color = '#3D2B1F') {
            const flagCount = duration === 'eighth' ? 1 : duration === 'sixteenth' ? 2 : duration === 'thirty-second' ? 3 : 0;
            if (flagCount === 0) return;

            const flagSpacing = 7;
            const glyphName = direction > 0 ? 'flagUp' : 'flagDown';

            for (let i = 0; i < flagCount; i++) {
                const startY = y + (i * flagSpacing * direction);
                this.glyphs.draw(this.ctx, glyphName, x, startY, 0.9, color);
            }
        }

        /**
         * REST SYMBOLS — Path2D professional glyphs from noteworthy
         */

        drawWholeRest(x, y) {
            const color = (this.ctx.fillStyle && this.ctx.fillStyle !== '#000000') ? this.ctx.fillStyle : '#3D2B1F';
            this.glyphs.draw(this.ctx, 'wholeRest', x, y, 0.83, color);
        }

        drawHalfRest(x, y) {
            const color = (this.ctx.fillStyle && this.ctx.fillStyle !== '#000000') ? this.ctx.fillStyle : '#3D2B1F';
            this.glyphs.draw(this.ctx, 'halfRest', x, y, 0.83, color);
        }

        drawQuarterRest(x, y) {
            const color = (this.ctx.fillStyle && this.ctx.fillStyle !== '#000000') ? this.ctx.fillStyle : '#3D2B1F';
            this.glyphs.draw(this.ctx, 'quarterRest', x, y, 0.34, color);
        }

        drawEighthRest(x, y) {
            const color = (this.ctx.fillStyle && this.ctx.fillStyle !== '#000000') ? this.ctx.fillStyle : '#3D2B1F';
            this.glyphs.draw(this.ctx, 'eighthRest', x, y, 0.41, color);
        }

        drawSixteenthRest(x, y) {
            const color = (this.ctx.fillStyle && this.ctx.fillStyle !== '#000000') ? this.ctx.fillStyle : '#3D2B1F';
            this.glyphs.draw(this.ctx, 'sixteenthRest', x, y, 0.34, color);
        }
        
        /**
         * Draw all note names for a chord as a stacked column
         * Notes are ordered HIGH to LOW (top to bottom), never overlapping
         */
        drawChordNoteNames(x, sortedNotes, stemDirection, processedPositions) {
            const ctx = this.ctx;
            const dir = stemDirection || 1;
            const noteHeadW = Math.round(this.glyphs.baseScale * 1.3 * 16);

            // Build labels with each note's actual rendered position
            const labelData = [];
            for (let i = 0; i < sortedNotes.length; i++) {
                const note = sortedNotes[i];
                if (!note.isRest && note.midi !== null) {
                    // Find this note's actual offset from processedPositions
                    let noteOffsetX = 0;
                    if (processedPositions) {
                        const pp = processedPositions.find(p => p.note === note);
                        if (pp) noteOffsetX = pp.offsetX || 0;
                    }
                    labelData.push({
                        name: this.getNoteNameFromMidi(note.midi),
                        noteY: this.getNoteY(note),
                        noteX: x + noteOffsetX
                    });
                }
            }
            if (labelData.length === 0) return;

            ctx.save();
            ctx.font = '600 8px Montserrat, Arial, sans-serif';
            ctx.textBaseline = 'middle';

            // Place labels on the side opposite to stem (away from stem)
            // Stem up (dir=1): labels go left; Stem down (dir=-1): labels go right
            const labelSide = dir === 1 ? -1 : 1;
            const labelOffset = labelSide === 1 ? noteHeadW + 3 : -(noteHeadW * 0.4 + 8);
            ctx.textAlign = labelSide === 1 ? 'left' : 'right';

            // Resolve vertical collisions between labels
            const usedYPositions = [];
            const minGap = 9;

            // Also collect all notehead Y positions to avoid overlapping noteheads
            const noteheadYPositions = (processedPositions || []).map(p => p.y);

            labelData.forEach((data) => {
                let labelY = data.noteY;
                let labelX = data.noteX + labelOffset;

                // Check collision with noteheads — if label overlaps a notehead, shift it
                let maxIter = 10;
                let collision = true;
                while (collision && maxIter-- > 0) {
                    collision = false;
                    // Check against other labels
                    for (const usedY of usedYPositions) {
                        if (Math.abs(labelY - usedY) < minGap) {
                            labelY = usedY + (labelY > usedY ? minGap : -minGap);
                            collision = true;
                        }
                    }
                }
                usedYPositions.push(labelY);

                ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
                ctx.shadowBlur = 2;
                ctx.fillStyle = '#C59D3A';
                ctx.fillText(data.name, labelX, labelY);
                ctx.shadowBlur = 0;
                ctx.fillText(data.name, labelX, labelY);
            });

            ctx.restore();
        }

        /**
         * Draw single note name label - positioned opposite to stem direction
         */
        drawNoteName(x, y, note, stemDirection = null) {
            const ctx = this.ctx;
            const noteName = this.getNoteNameFromMidi(note.midi);

            ctx.save();
            ctx.font = '600 9px Montserrat, Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const dir = stemDirection || 1;
            // Place label closer to the note - on the OPPOSITE side from the stem
            let nameY;
            if (dir > 0) {
                // Stem DOWN → label ABOVE note (closer: 11px instead of 14px)
                nameY = y - 11;
            } else {
                // Stem UP → label BELOW note (closer: 11px instead of 14px)
                nameY = y + 11;
            }

            // Nudge away from staff lines if overlapping
            const sp = this.staffSpacing;
            const staffTop = this.staffY;
            const staffBottom = this.staffY + 4 * sp;
            // Only check if label is within staff area
            if (nameY >= staffTop - 5 && nameY <= staffBottom + 5) {
                for (let i = 0; i < 5; i++) {
                    const lineY = this.staffY + i * sp;
                    if (Math.abs(nameY - lineY) < 3) {
                        nameY += (dir > 0) ? -3 : 3;
                        break;
                    }
                }
            }
            if (this.clef === 'grand') {
                const bassTop = this.staffY + 100;
                const bassBottom = bassTop + 4 * sp;
                if (nameY >= bassTop - 5 && nameY <= bassBottom + 5) {
                    for (let i = 0; i < 5; i++) {
                        const bassLineY = bassTop + i * sp;
                        if (Math.abs(nameY - bassLineY) < 3) {
                            nameY += (dir > 0) ? -3 : 3;
                            break;
                        }
                    }
                }
            }

            // Final safety: never overlap note head
            if (Math.abs(nameY - y) < 7) {
                nameY = (dir > 0) ? y - 11 : y + 11;
            }

            // Draw with slight dark outline for readability on any background
            ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
            ctx.shadowBlur = 2;
            ctx.fillStyle = '#C59D3A';
            ctx.fillText(noteName, x, nameY);
            ctx.shadowBlur = 0;
            ctx.fillText(noteName, x, nameY);

            ctx.restore();
        }

        /**
         * FEATURE: Draw beat counting under notes
         * User requirement: Show beat counts like "1 2 3 4" for whole note,
         * "1 2" for half note, "1" for quarter, "&" for eighth, "e" or "a" for sixteenth
         */
        drawCounting(x, y, note) {
            const ctx = this.ctx;
            const countingText = this.getCountingText(note);

            if (!countingText) return;

            ctx.save();
            ctx.font = '10px Montserrat, Arial, sans-serif'; // Small font size as requested
            ctx.textAlign = 'center'; // Center under note
            ctx.textBaseline = 'top'; // Align from top for consistent positioning

            // Golden color as requested (#C59D3A)
            ctx.fillStyle = '#C59D3A';

            // Position below note - adjust based on staff
            const staffOffset = this.clef === 'grand' ? (note.midi >= 60 ? 0 : 90) : 0;
            const countingY = this.staffY + staffOffset + (4 * this.staffSpacing) + 15; // Below bottom staff line

            ctx.fillText(countingText, x, countingY);

            // Draw dot at end of measure if this is the last beat
            if (note.beat !== undefined && note.measure !== undefined) {
                const _tsT = parseInt(this.timeSignature.split('/')[0]) || 4;
                const _tsB = parseInt(this.timeSignature.split('/')[1]) || 4;
                const _qBeats = (_tsT * 4) / _tsB;
                const isLastBeat = (note.beat + this.getDurationBeats(note.duration)) >= _qBeats;

                if (isLastBeat) {
                    // Draw small dot after counting text
                    ctx.beginPath();
                    ctx.arc(x + 15, countingY + 2, 1.5, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            ctx.restore();
        }

        /**
         * Get counting text for a note based on its duration and beat position
         */
        getCountingText(note) {
            if (!note || !note.duration) return '';

            const beat = note.beat !== undefined ? note.beat : 0;
            const beatsPerMeasure = parseInt(this.timeSignature.split('/')[0]) || 4;

            // Map duration to counting text
            switch (note.duration) {
                case 'whole':
                    // Whole note: all 4 beats "1 2 3 4"
                    return '1 2 3 4';

                case 'half':
                case 'dotted-half':
                    // Half note: 2 beats depending on position
                    // If on beat 0 or 1: "1 2"
                    // If on beat 2 or 3: "3 4"
                    if (beat < 2) return '1 2';
                    return '3 4';

                case 'quarter':
                    // Quarter note: 1 beat - show beat number (1, 2, 3, or 4)
                    const beatNumber = Math.floor(beat) + 1;
                    return String(beatNumber);

                case 'eighth':
                    // Eighth note: half beat - show "&" (and)
                    // Or beat number if on the beat
                    const eighthBeat = Math.floor(beat);
                    const isOnBeat = (beat % 1) === 0;
                    if (isOnBeat) {
                        return String(eighthBeat + 1);
                    }
                    return '&';

                case 'sixteenth':
                    // Sixteenth note: quarter beat
                    // Positions: "1", "e", "&", "a", "2", "e", "&", "a", etc.
                    const sixteenthBeat = Math.floor(beat);
                    const subdivision = Math.round((beat % 1) * 4);

                    switch (subdivision) {
                        case 0: return String(sixteenthBeat + 1); // On the beat
                        case 1: return 'e'; // First sixteenth after beat
                        case 2: return '&'; // Second sixteenth (and)
                        case 3: return 'a'; // Third sixteenth
                        default: return String(sixteenthBeat + 1);
                    }

                default:
                    return '';
            }
        }

        /**
         * Get duration in beats for calculating measure ends
         */
        getDurationBeats(duration) {
            const durationMap = {
                'whole': 4,
                'dotted-half': 3,
                'half': 2,
                'dotted-quarter': 1.5,
                'quarter': 1,
                'dotted-eighth': 0.75,
                'eighth': 0.5,
                'dotted-sixteenth': 0.375,
                'sixteenth': 0.25,
                'thirty-second': 0.125
            };
            return durationMap[duration] || 1;
        }

        getNoteNameFromMidi(midi) {
            const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
            const systems = this.engine.config.notationSystems;
            const system = systems[this.noteNameSystem] || systems.international;
            
            const noteName = noteNames[midi % 12];
            return system[noteName] || noteName;
        }
        
        getAccidentalY(accidental, staffY, clef) {
            // CORRECTED: Standard music engraving positions for key signature accidentals
            // Staff coordinate system: staffY = top line (line 1)
            // halfSpace = staffSpacing / 2 = 6px
            // Position N means staffY + N * halfSpace
            //
            // Treble clef lines (top to bottom): F5(0), D5(2), B4(4), G4(6), E4(8)
            // Treble clef spaces: E5(1), C5(3), A4(5), F4(7)
            // Above staff: G5(-1)
            //
            // Bass clef lines (top to bottom): A3(0), F3(2), D3(4), B2(6), G2(8)
            // Bass clef spaces: G3(1), E3(3), C3(5), A2(7)
            const halfSpace = this.staffSpacing / 2;

            const positions = {
                'treble': {
                    // Sharps: F C G D A E B (circle of fifths)
                    'F#': staffY + (0 * halfSpace),      // F5 - top line
                    'C#': staffY + (3 * halfSpace),      // C5 - space between lines 2-3
                    'G#': staffY - (1 * halfSpace),      // G5 - above staff
                    'D#': staffY + (2 * halfSpace),      // D5 - line 2
                    'A#': staffY + (5 * halfSpace),      // A4 - space between lines 3-4
                    'E#': staffY + (1 * halfSpace),      // E5 - space between lines 1-2
                    'B#': staffY + (4 * halfSpace),      // B4 - line 3 (middle)
                    // Flats: B E A D G C F (reverse circle of fifths)
                    'Bb': staffY + (4 * halfSpace),      // B4 - line 3 (middle line)
                    'Eb': staffY + (1 * halfSpace),      // E5 - space between lines 1-2
                    'Ab': staffY + (5 * halfSpace),      // A4 - space between lines 3-4
                    'Db': staffY + (2 * halfSpace),      // D5 - line 2
                    'Gb': staffY + (6 * halfSpace),      // G4 - line 4
                    'Cb': staffY + (3 * halfSpace),      // C5 - space between lines 2-3
                    'Fb': staffY + (7 * halfSpace)       // F4 - space between lines 4-5
                },
                'bass': {
                    // Bass clef: positions shifted +2 halfSpaces from treble
                    // Sharps: F C G D A E B
                    'F#': staffY + (2 * halfSpace),      // F3 - line 2
                    'C#': staffY + (5 * halfSpace),      // C3 - space between lines 3-4
                    'G#': staffY + (1 * halfSpace),      // G3 - space between lines 1-2
                    'D#': staffY + (4 * halfSpace),      // D3 - line 3
                    'A#': staffY + (7 * halfSpace),      // A2 - space between lines 4-5
                    'E#': staffY + (3 * halfSpace),      // E3 - space between lines 2-3
                    'B#': staffY + (6 * halfSpace),      // B2 - line 4
                    // Flats: B E A D G C F
                    'Bb': staffY + (6 * halfSpace),      // B2 - line 4
                    'Eb': staffY + (3 * halfSpace),      // E3 - space between lines 2-3
                    'Ab': staffY + (7 * halfSpace),      // A2 - space between lines 4-5
                    'Db': staffY + (4 * halfSpace),      // D3 - line 3
                    'Gb': staffY + (8 * halfSpace),      // G2 - line 5 (bottom)
                    'Cb': staffY + (5 * halfSpace),      // C3 - space between lines 3-4
                    'Fb': staffY + (2 * halfSpace)       // F3 - line 2
                }
            };

            return positions[clef]?.[accidental] ?? staffY;
        }
        
        /**
         * Render the playhead validation band (wide, transparent band in scroll mode)
         * Notes scroll towards and stop in this band until played.
         * Color feedback: green=correct timing, orange=slightly early, red=too early/wrong
         */
        renderPlayheadBand(position) {
            const ctx = this.ctx;

            // Dynamic playhead position — wider band (40px) centered on the note arrival point
            const firstNoteScreenX = this.calculatedNoteStartX ?
                (this.calculatedNoteStartX + 20) : 200;
            const bandWidth = 44;
            const playheadX = firstNoteScreenX - bandWidth / 2 + 3;

            const bandY = this.clef === 'grand' ? this.staffY - 40 : this.staffY - 30;
            const bandHeight = this.clef === 'grand' ? 250 : 120;

            ctx.save();

            // MASK: Cover area to the LEFT of the band to hide passed notes
            const maskEndX = playheadX;
            const gradient = ctx.createLinearGradient(0, 0, maskEndX, 0);
            gradient.addColorStop(0, 'rgba(253, 248, 240, 1)');
            gradient.addColorStop(0.80, 'rgba(253, 248, 240, 1)');
            gradient.addColorStop(1, 'rgba(253, 248, 240, 0.5)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, bandY, maskEndX, bandHeight);

            // VALIDATION BAND: Wide transparent overlay — notes visible through it
            // Determine band color based on current note state
            let bandColor = 'rgba(197, 157, 58, 0.12)'; // Default: subtle gold
            let borderColor = 'rgba(197, 157, 58, 0.5)';
            let glowColor = 'rgba(197, 157, 58, 0.3)';

            // Check timing feedback from engine
            if (this.engine && this.engine._scrollTimingFeedback) {
                const feedback = this.engine._scrollTimingFeedback;
                if (feedback === 'perfect') {
                    bandColor = 'rgba(76, 175, 80, 0.18)';    // Green
                    borderColor = 'rgba(76, 175, 80, 0.6)';
                    glowColor = 'rgba(76, 175, 80, 0.4)';
                } else if (feedback === 'early') {
                    bandColor = 'rgba(255, 152, 0, 0.18)';    // Orange
                    borderColor = 'rgba(255, 152, 0, 0.6)';
                    glowColor = 'rgba(255, 152, 0, 0.4)';
                } else if (feedback === 'wrong') {
                    bandColor = 'rgba(244, 67, 54, 0.18)';    // Red
                    borderColor = 'rgba(244, 67, 54, 0.6)';
                    glowColor = 'rgba(244, 67, 54, 0.4)';
                }
            }

            // Draw the band background
            ctx.fillStyle = bandColor;
            ctx.fillRect(playheadX, bandY, bandWidth, bandHeight);

            // Soft glow behind band edges
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = 8;

            // Left border (entry edge)
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(playheadX, bandY);
            ctx.lineTo(playheadX, bandY + bandHeight);
            ctx.stroke();

            // Right border
            ctx.beginPath();
            ctx.moveTo(playheadX + bandWidth, bandY);
            ctx.lineTo(playheadX + bandWidth, bandY + bandHeight);
            ctx.stroke();

            ctx.shadowBlur = 0;

            // Center line (exact beat position) — thin gold line
            const centerX = playheadX + bandWidth / 2;
            ctx.strokeStyle = '#C59D3A';
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.7;
            ctx.beginPath();
            ctx.moveTo(centerX, bandY);
            ctx.lineTo(centerX, bandY + bandHeight);
            ctx.stroke();
            ctx.globalAlpha = 1.0;

            // Small gold triangles at top and bottom pointing to center
            ctx.fillStyle = '#C59D3A';
            // Top triangle
            ctx.beginPath();
            ctx.moveTo(centerX, bandY - 5);
            ctx.lineTo(centerX - 5, bandY + 3);
            ctx.lineTo(centerX + 5, bandY + 3);
            ctx.closePath();
            ctx.fill();
            // Bottom triangle
            ctx.beginPath();
            ctx.moveTo(centerX, bandY + bandHeight + 5);
            ctx.lineTo(centerX - 5, bandY + bandHeight - 3);
            ctx.lineTo(centerX + 5, bandY + bandHeight - 3);
            ctx.closePath();
            ctx.fill();

            ctx.restore();
        }

        /**
         * USER FIX: Render "Start here" blinking indicator in wait mode
         * Shows a blinking label above the first note to indicate where to start
         */
        renderStartHereIndicator(firstNote) {
            if (!firstNote) return;

            const ctx = this.ctx;
            const x = this.getNoteX(firstNote);

            // USER FIX: Play indicator ALWAYS above ALL notes — never on notes
            // Find the highest (lowest Y) note in the first chord/group
            const notes = this.engine.notes;
            let highestY = Infinity;
            if (firstNote.isChord && firstNote.chordNotes) {
                for (const cn of firstNote.chordNotes) {
                    const ny = this.getNoteY(cn);
                    if (ny < highestY) highestY = ny;
                }
            }
            const firstNoteY = this.getNoteY(firstNote);
            if (firstNoteY < highestY) highestY = firstNoteY;

            // Always position well above the staff top and above any note
            const staffTop = this.staffY - 20;
            const indicatorY = Math.min(highestY - 40, staffTop - 15);

            // Smooth pulsing effect (not harsh blink)
            const pulse = (Math.sin(Date.now() / 400) + 1) / 2; // 0..1 smooth
            const alpha = 0.6 + pulse * 0.4; // 0.6..1.0

            ctx.save();
            ctx.globalAlpha = alpha;

            // Minimal elegant design: small gold play triangle + "Play" text
            const triSize = 8;
            const triX = x - 18;
            const textX = x + 2;

            // Play triangle
            ctx.beginPath();
            ctx.moveTo(triX, indicatorY - triSize);
            ctx.lineTo(triX + triSize * 1.2, indicatorY);
            ctx.lineTo(triX, indicatorY + triSize);
            ctx.closePath();
            ctx.fillStyle = '#C59D3A';
            ctx.fill();

            // "Play" text
            ctx.font = 'bold 11px Montserrat, Arial, sans-serif';
            ctx.fillStyle = '#C59D3A';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('Play', textX, indicatorY);

            // Small downward arrow
            const arrowY = indicatorY + 14;
            ctx.beginPath();
            ctx.moveTo(x - 4, arrowY);
            ctx.lineTo(x, arrowY + 6);
            ctx.lineTo(x + 4, arrowY);
            ctx.closePath();
            ctx.fillStyle = '#C59D3A';
            ctx.fill();

            ctx.restore();
        }

        /**
         * Render end-of-piece bar for scroll and wait modes
         * Contemporary double barline with elegant styling
         */
        renderEndBar() {
            if (this.engine.mode === 'free') return;
            if (this.engine.notes.length === 0) return;

            const ctx = this.ctx;
            ctx.save();

            // Find the FURTHEST note by position (highest measure + beat + duration)
            // Don't rely on array order - scan ALL notes to find the true last position
            let maxMeasure = 0;
            let maxBeatEnd = 0;
            let furthestNoteX = 0;

            for (const note of this.engine.notes) {
                const m = note.measure || 0;
                const b = (note.beat || 0) + (this.getDurationBeats(note.duration) || 1);
                const pos = m * 1000 + b;
                const mEnd = m * 1000 + (note.beat || 0) + (this.getDurationBeats(note.duration) || 1);
                if (m > maxMeasure || (m === maxMeasure && b > maxBeatEnd)) {
                    maxMeasure = m;
                    maxBeatEnd = b;
                }
                // Also track the furthest X coordinate
                const noteX = this.getNoteX(note);
                if (noteX > furthestNoteX) furthestNoteX = noteX;
            }

            const barLineMargin = 25;
            const clefWidth = this.calculatedNoteStartX || 200;

            // Position: whichever is further right - the formula-based end or the actual furthest note + padding
            const formulaEndX = clefWidth + (maxMeasure + 1) * (this.measureWidth + barLineMargin) + barLineMargin - 10;
            // Ensure end bar is ALWAYS at least 40px after the furthest note
            const endX = Math.max(formulaEndX, furthestNoteX + 40);

            const staffTop = this.staffY;
            const staffBot = this.clef === 'grand'
                ? this.staffY + 100 + 4 * this.staffSpacing  // Bottom of bass staff (100px gap)
                : this.staffY + 4 * this.staffSpacing;

            const topY = staffTop - 2;
            const botY = staffBot + 2;

            // Contemporary end barline: thin + thick + gold glow
            // Thin barline
            ctx.strokeStyle = 'rgba(92, 78, 60, 0.7)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(endX - 8, topY);
            ctx.lineTo(endX - 8, botY);
            ctx.stroke();

            // Thick final barline
            ctx.lineWidth = 5;
            ctx.strokeStyle = '#5C4E3C';
            ctx.beginPath();
            ctx.moveTo(endX, topY);
            ctx.lineTo(endX, botY);
            ctx.stroke();

            // Gold glow effect behind thick line
            ctx.shadowColor = 'rgba(197, 157, 58, 0.5)';
            ctx.shadowBlur = 10;
            ctx.strokeStyle = 'rgba(197, 157, 58, 0.3)';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(endX, topY);
            ctx.lineTo(endX, botY);
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Top ornament: small gold circle
            ctx.fillStyle = '#C59D3A';
            ctx.beginPath();
            ctx.arc(endX - 4, topY - 8, 3.5, 0, Math.PI * 2);
            ctx.fill();

            // Bottom ornament: small gold circle
            ctx.beginPath();
            ctx.arc(endX - 4, botY + 8, 3.5, 0, Math.PI * 2);
            ctx.fill();

            // "Fine" text label above end bar
            ctx.fillStyle = 'rgba(197, 157, 58, 0.6)';
            ctx.font = 'italic 11px Georgia, serif';
            ctx.textAlign = 'center';
            ctx.fillText('Fine', endX - 4, topY - 16);

            ctx.restore();

            // Store end bar X for clipping notes
            this._endBarX = endX - 12;
        }
        
        /**
         * Render indicator for notes that must be played
         * USER FIX: Now accepts array of notes to highlight ALL notes at same beat position
         */
        renderCurrentNoteIndicator(notesOrNote) {
            const ctx = this.ctx;
            ctx.save();

            ctx.strokeStyle = '#C59D3A';
            ctx.lineWidth = 2.5;
            ctx.shadowColor = '#C59D3A';
            ctx.shadowBlur = 12;

            // Handle both single note and array of notes
            const notes = Array.isArray(notesOrNote) ? notesOrNote : [notesOrNote];

            if (notes.length === 0) {
                ctx.restore();
                return;
            }

            // Draw golden circle around EACH note that must be played
            notes.forEach(note => {
                if (!note || note.isRest) return;

                const x = this.getNoteX(note);
                const y = this.getNoteY(note);

                ctx.beginPath();
                ctx.arc(x, y, 13, 0, 2 * Math.PI);
                ctx.stroke();
            });

            // If multiple notes, draw a connecting bracket or box to show they're together
            if (notes.length > 1) {
                const positions = notes
                    .filter(n => n && !n.isRest)
                    .map(n => ({ x: this.getNoteX(n), y: this.getNoteY(n) }));

                if (positions.length > 1) {
                    const minY = Math.min(...positions.map(p => p.y)) - 18;
                    const maxY = Math.max(...positions.map(p => p.y)) + 18;
                    const x = positions[0].x;

                    // Draw vertical bracket on the left to show grouped notes
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.moveTo(x - 20, minY);
                    ctx.lineTo(x - 25, minY);
                    ctx.lineTo(x - 25, maxY);
                    ctx.lineTo(x - 20, maxY);
                    ctx.stroke();
                }
            }

            ctx.restore();
        }
        
        /**
         * Render dynamic markings (pp, p, mp, mf, f, ff, etc.)
         * Placed below the staff in italic
         */
        renderDynamics() {
            const dynamics = this.engine?._xmlDynamics;
            if (!dynamics || dynamics.length === 0) return;

            const ctx = this.ctx;
            ctx.save();

            ctx.font = 'italic bold 14px "Times New Roman", Georgia, serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            const staffBottom = this.clef === 'grand'
                ? this.staffY + 100 + 4 * this.staffSpacing + 12
                : this.staffY + 4 * this.staffSpacing + 12;

            dynamics.forEach(dyn => {
                const clefAndSignatureWidth = this.calculatedNoteStartX || 200;
                const barLineMargin = 25;
                const x = clefAndSignatureWidth + (dyn.measure * (this.measureWidth + barLineMargin)) + barLineMargin + 10;

                // Dynamic marking text
                ctx.fillStyle = '#5C4E3C';
                ctx.fillText(dyn.type, x, staffBottom);
            });

            ctx.restore();
        }

        /**
         * Render crescendo/diminuendo wedges (hairpins) from parsed MusicXML data.
         * Wedges are opening or closing angle brackets below the staff.
         */
        renderWedges() {
            const wedges = this.engine?._xmlWedges;
            if (!wedges || wedges.length === 0) return;

            const ctx = this.ctx;
            ctx.save();

            const staffBottom = this.clef === 'grand'
                ? this.staffY + 100 + 4 * this.staffSpacing + 8
                : this.staffY + 4 * this.staffSpacing + 8;

            const clefAndSignatureWidth = this.calculatedNoteStartX || 200;
            const barLineMargin = 25;

            // Pair up wedge start/stop
            let activeWedge = null;
            for (const w of wedges) {
                if (w.type === 'crescendo' || w.type === 'diminuendo') {
                    activeWedge = w;
                } else if (w.type === 'stop' && activeWedge) {
                    const x1 = clefAndSignatureWidth + (activeWedge.measure * (this.measureWidth + barLineMargin)) + barLineMargin + 5;
                    const x2 = clefAndSignatureWidth + (w.measure * (this.measureWidth + barLineMargin)) + barLineMargin + this.measureWidth - 5;
                    const midY = staffBottom + 10;
                    const halfHeight = 5;

                    ctx.strokeStyle = '#5C4E3C';
                    ctx.lineWidth = 1.5;
                    ctx.lineCap = 'round';
                    ctx.beginPath();

                    if (activeWedge.type === 'crescendo') {
                        // Opening hairpin: < shape
                        ctx.moveTo(x1, midY);
                        ctx.lineTo(x2, midY - halfHeight);
                        ctx.moveTo(x1, midY);
                        ctx.lineTo(x2, midY + halfHeight);
                    } else {
                        // Closing hairpin: > shape
                        ctx.moveTo(x1, midY - halfHeight);
                        ctx.lineTo(x2, midY);
                        ctx.moveTo(x1, midY + halfHeight);
                        ctx.lineTo(x2, midY);
                    }

                    ctx.stroke();
                    activeWedge = null;
                }
            }

            ctx.restore();
        }

        renderFeedback() {
            // FIX: Never mutate array during iteration - use filter first
            const now = Date.now();
            this.feedback = this.feedback.filter(item => now - item.timestamp <= 2000);
            this.feedback.forEach(item => this.renderFeedbackItem(item));
            // Render particle explosions
            this.renderParticles();
        }

        renderFeedbackItem(item) {
            const ctx = this.ctx;
            const opacity = 1 - ((Date.now() - item.timestamp) / 2000);

            ctx.save();
            ctx.globalAlpha = opacity;

            if (item.type === 'correct') {
                ctx.fillStyle = '#4CAF50';
                ctx.font = 'bold 24px Arial';
                ctx.fillText('✓', item.x, item.y);
            } else if (item.type === 'incorrect') {
                ctx.fillStyle = '#F44336';
                ctx.font = 'bold 24px Arial';
                ctx.fillText('✗', item.x, item.y);
            }

            ctx.restore();
        }

        /**
         * Particle explosion system for perfectly timed notes
         */
        spawnPerfectExplosion(x, y) {
            if (!this._particles) this._particles = [];
            const now = Date.now();
            const count = 12;
            for (let i = 0; i < count; i++) {
                const angle = (Math.PI * 2 * i) / count + (Math.random() * 0.3);
                const speed = 1.5 + Math.random() * 2.5;
                this._particles.push({
                    x, y,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    life: 1.0,
                    size: 2 + Math.random() * 3,
                    color: Math.random() > 0.5 ? '#4CAF50' : '#C59D3A',
                    born: now
                });
            }
        }

        /**
         * Update particle physics — called from update(), NOT render()
         */
        updateParticles() {
            if (!this._particles || this._particles.length === 0) return;
            const now = Date.now();
            // Single pass: update physics + remove expired
            let writeIdx = 0;
            for (let i = 0; i < this._particles.length; i++) {
                const p = this._particles[i];
                const age = (now - p.born) / 500;
                if (age >= 1) continue; // expired — skip
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.08; // gravity
                p._age = age; // cache for render
                this._particles[writeIdx++] = p;
            }
            this._particles.length = writeIdx; // truncate expired
        }

        /**
         * Update ghost notes — called from update(), NOT render()
         */
        updateGhostNotes() {
            if (!this.engine || !this.engine.ghostNotes || this.engine.ghostNotes.length === 0) return;
            const now = Date.now();
            const maxAge = 700;
            let writeIdx = 0;
            const ghosts = this.engine.ghostNotes;
            for (let i = 0; i < ghosts.length; i++) {
                if ((now - ghosts[i].timestamp) < maxAge) {
                    ghosts[writeIdx++] = ghosts[i];
                }
            }
            ghosts.length = writeIdx;
        }

        renderParticles() {
            if (!this._particles || this._particles.length === 0) return;
            const ctx = this.ctx;
            ctx.save();
            for (let i = 0; i < this._particles.length; i++) {
                const p = this._particles[i];
                const alpha = 1 - p._age;
                const size = p.size * (1 - p._age * 0.5);
                ctx.globalAlpha = alpha;
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, size, 0, 2 * Math.PI);
                ctx.fill();
            }
            ctx.restore();
        }

        showCorrectFeedback(note) {
            const x = this.getNoteX(note);
            const y = this.getNoteY(note) - 30;

            this.feedback.push({
                type: 'correct',
                x: x,
                y: y,
                timestamp: Date.now()
            });
        }
        
        showIncorrectFeedback(expectedNote, playedNote) {
            const x = this.getNoteX(expectedNote);
            const y = this.getNoteY(expectedNote) - 30;
            
            this.feedback.push({
                type: 'incorrect',
                x: x,
                y: y,
                timestamp: Date.now()
            });
        }
        
        showMissedFeedback(note) {
            note.missed = true;
        }

        /**
         * USER REQUEST: Render ghost notes (visual feedback for incorrect notes played)
         * Shows the played note with transparency and vibration at the expected note's position
         * CRITICAL FIX: Ghost notes MUST disappear within 1 second automatically
         */
        renderGhostNotes(ghostNotes) {
            if (!ghostNotes || ghostNotes.length === 0) return;

            const ctx = this.ctx;
            const now = Date.now();
            const maxGhostAge = 700;

            // Ghost note expiry is now handled by updateGhostNotes() in the update phase.
            // Here we just render whatever is in the array (already cleaned).
            for (let gi = 0; gi < ghostNotes.length; gi++) {
                const ghost = ghostNotes[gi];
                const age = now - ghost.timestamp;

                // Calculate opacity - start fully visible, fade over time
                const fadeProgress = age / maxGhostAge;
                const opacity = 0.8 * (1 - fadeProgress * fadeProgress);

                if (opacity < 0.05) return;

                // Stronger vibration - visible shaking for wrong note feedback
                const vibrationDuration = 400;
                const vibrationProgress = Math.min(age / vibrationDuration, 1);
                const vibrationIntensity = 1 - vibrationProgress;
                const vibrationX = Math.sin(age * 0.08) * 7 * vibrationIntensity;
                const vibrationY = Math.cos(age * 0.06) * 2 * vibrationIntensity;

                const y = this.getNoteY({ midi: ghost.midi });

                ctx.save();
                ctx.globalAlpha = opacity;

                // RED glow behind the note for emphasis
                const glowRadius = 14;
                const glow = ctx.createRadialGradient(
                    ghost.x + vibrationX, y + vibrationY, 0,
                    ghost.x + vibrationX, y + vibrationY, glowRadius
                );
                glow.addColorStop(0, 'rgba(244, 67, 54, 0.5)');
                glow.addColorStop(1, 'rgba(244, 67, 54, 0)');
                ctx.fillStyle = glow;
                ctx.beginPath();
                ctx.arc(ghost.x + vibrationX, y + vibrationY, glowRadius, 0, 2 * Math.PI);
                ctx.fill();

                // Draw note head in RED (not gray - must be clearly wrong)
                const noteHeadRadius = 7.5;
                ctx.fillStyle = '#F44336';
                ctx.strokeStyle = '#D32F2F';
                ctx.lineWidth = 1.5;

                ctx.beginPath();
                ctx.ellipse(
                    ghost.x + vibrationX,
                    y + vibrationY,
                    noteHeadRadius,
                    noteHeadRadius * 0.75,
                    -18 * Math.PI / 180,
                    0,
                    2 * Math.PI
                );
                ctx.fill();
                ctx.stroke();

                // Draw an X through the note for clarity
                ctx.strokeStyle = '#FFFFFF';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(ghost.x + vibrationX - 5, y + vibrationY - 5);
                ctx.lineTo(ghost.x + vibrationX + 5, y + vibrationY + 5);
                ctx.moveTo(ghost.x + vibrationX + 5, y + vibrationY - 5);
                ctx.lineTo(ghost.x + vibrationX - 5, y + vibrationY + 5);
                ctx.stroke();

                ctx.restore();
            }
        }

        highlightNote(note) {
            note.highlighted = true;
        }

        clearFeedback() {
            this.feedback = [];
        }
        
        setClef(clef) {
            this.clef = clef;
        }
        
        setKeySignature(key) {
            this.keySignature = key;
        }
        
        setTimeSignature(time) {
            this.timeSignature = time;
        }
        
        setNoteNameSystem(system) {
            this.noteNameSystem = system;
        }
    }

    /* =====================================================
       LOADING SCREEN CREATION - Always creates in JavaScript
       ===================================================== */

    function ensureLoadingScreen(container) {
        // DO NOT remove existing loading screen - use it if present (PRIO 1 Bis FIX)
        const existing = container.querySelector('.srt-loading-screen');
        if (existing) {
            return existing;
        }

        // Create loading screen with logo (same as PHP)
        const loadingHTML = `
            <div class="srt-loading-screen" id="srtLoadingScreen">
                <div class="srt-loading-particles" aria-hidden="true">
                    <span></span><span></span><span></span><span></span><span></span>
                    <span></span><span></span><span></span><span></span><span></span>
                </div>
                <div class="srt-loader">
                    <div class="srt-loader-accent"></div>
                    <div class="srt-loader-logo">
                        <img src="https://pianomode.com/wp-content/uploads/2025/12/PianoMode_Logo_2026.png" alt="PianoMode">
                    </div>
                    <div class="srt-loader-ring-wrapper">
                        <svg class="srt-loader-ring" viewBox="0 0 120 120">
                            <circle class="srt-loader-ring-bg" cx="60" cy="60" r="52" />
                            <circle class="srt-loader-ring-fill" id="srtLoadingRing" cx="60" cy="60" r="52" />
                        </svg>
                        <div class="srt-loader-percentage" id="srtLoadingPercentage">0%</div>
                    </div>
                    <div class="srt-loader-progress">
                        <div class="srt-loader-bar" id="srtLoadingBar"></div>
                    </div>
                    <div class="srt-loader-tips" id="srtLoadingTips">
                        <p>Connect a MIDI keyboard or use computer keys (A-L)</p>
                    </div>
                    <button class="srt-lets-play-btn" id="srtLetsPlayBtn">
                        <span class="srt-lets-play-text">Let's Play</span>
                        <svg class="srt-lets-play-icon" viewBox="0 0 24 24" width="20" height="20">
                            <path fill="currentColor" d="M8 5v14l11-7z"/>
                        </svg>
                    </button>
                    <div class="srt-loader-accent srt-loader-accent-bottom"></div>
                </div>
            </div>
        `;

        // Insert at the beginning of container
        container.insertAdjacentHTML('afterbegin', loadingHTML);

        const loadingScreen = document.getElementById('srtLoadingScreen');
        if (loadingScreen) {
            return loadingScreen;
        } else {
            console.error('❌ Failed to create loading screen!');
            return null;
        }
    }

    /* =====================================================
       INITIALIZATION - Document Ready
       ===================================================== */

    $(document).ready(function() {

        // Get container
        const container = document.getElementById('sightReadingGame');

        if (!container) {
            console.error('❌ CRITICAL: Container #sightReadingGame NOT FOUND!');
            console.error('❌ Make sure the shortcode [sightreading_game] is on the WordPress page!');
            // Critical error shown in console - no UI container available for toast
            return;
        }


        // Try to find loading screen from PHP, create if not found
        let loadingScreen = document.getElementById('srtLoadingScreen');

        if (!loadingScreen) {
            console.warn('⚠️ Loading screen not found in HTML, creating one...');
            loadingScreen = ensureLoadingScreen(container);
        }

        // Initialize engine
        window.sightReadingEngine = new SightReadingEngine(container);
    });

})(jQuery);