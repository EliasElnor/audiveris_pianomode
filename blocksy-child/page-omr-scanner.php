<?php
/**
 * Template Name: OCR Scanner - Partition vers MIDI
 * Description: Upload a sheet music photo or PDF, process it through Audiveris OMR,
 *              and play the result with AlphaTab (interactive piano player).
 *
 * @package Blocksy-child
 * @version 1.0.0
 */

get_header();

$theme_uri = get_stylesheet_directory_uri();
?>

<div class="pm-omr-page">

    <!-- ===== HERO ===== -->
    <section class="pm-omr-hero">
        <div class="pm-omr-hero-content">
            <div class="pm-omr-hero-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 18V5l12-2v13"/>
                    <circle cx="6" cy="18" r="3"/>
                    <circle cx="18" cy="16" r="3"/>
                </svg>
            </div>
            <h1>Sheet Music <span>OCR Scanner</span></h1>
            <p>Transform any photo or PDF of sheet music into an interactive, playable score.
               Upload your partition and listen to it instantly with real piano sounds.</p>
        </div>
    </section>

    <!-- ===== MAIN CONTENT ===== -->
    <div class="pm-omr-container">

        <!-- Upload Zone -->
        <div class="pm-omr-upload-zone" id="omr-dropzone">
            <input type="file" id="omr-file-input" accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif">

            <svg class="pm-omr-upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>

            <h3>Drag & drop your score here or <span>browse</span></h3>
            <p class="pm-omr-upload-hint">PDF, PNG, JPG or TIFF — Max 20 MB</p>

            <!-- File preview -->
            <div class="pm-omr-file-preview" id="omr-file-preview">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                </svg>
                <span class="pm-omr-file-name" id="omr-file-name"></span>
                <span class="pm-omr-file-size" id="omr-file-size"></span>
                <button type="button" class="pm-omr-file-remove" id="omr-file-remove" title="Remove file">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
        </div>

        <!-- Scan Button -->
        <button type="button" class="pm-omr-scan-btn" id="omr-scan-btn" disabled>
            Analyse &amp; Convert to Playable Score
        </button>

        <!-- Error -->
        <div class="pm-omr-error" id="omr-error">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span id="omr-error-text"></span>
            <button type="button" class="pm-omr-error-close" id="omr-error-close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        </div>

        <!-- Progress Stepper -->
        <div class="pm-omr-progress" id="omr-progress">
            <ul class="pm-omr-steps">
                <li class="pm-omr-step" data-step="1">
                    <div class="pm-omr-step-circle">1</div>
                    <span class="pm-omr-step-label">Upload</span>
                </li>
                <li class="pm-omr-step" data-step="2">
                    <div class="pm-omr-step-circle">2</div>
                    <span class="pm-omr-step-label">OCR Analysis</span>
                </li>
                <li class="pm-omr-step" data-step="3">
                    <div class="pm-omr-step-circle">3</div>
                    <span class="pm-omr-step-label">Conversion</span>
                </li>
                <li class="pm-omr-step" data-step="4">
                    <div class="pm-omr-step-circle">4</div>
                    <span class="pm-omr-step-label">Ready</span>
                </li>
            </ul>
            <div class="pm-omr-progress-status" id="omr-progress-status"></div>
        </div>

        <!-- Result Panel -->
        <div class="pm-omr-result" id="omr-result">

            <!-- AlphaTab Player -->
            <div class="pm-omr-alphatab-container" role="application" aria-label="Interactive sheet music player">
                <div class="pm-omr-alphatab-header">
                    <div>
                        <div class="pm-omr-alphatab-title">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                                <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                            </svg>
                            Interactive Sheet Music
                        </div>
                        <div class="pm-omr-alphatab-subtitle">Press play to listen — notes highlight in real-time</div>
                    </div>
                    <span class="pm-omr-alphatab-progress" id="omr-at-progress">Loading...</span>
                </div>

                <div class="pm-omr-alphatab-wrap">
                    <div class="pm-omr-alphatab-viewport" id="omr-at-viewport">
                        <div class="pm-omr-at-main" id="omr-at-main" aria-label="Sheet music notation display"></div>
                    </div>

                    <div class="pm-omr-alphatab-controls">
                        <div class="pm-omr-controls-left">
                            <button class="pm-omr-btn" id="omr-at-stop" disabled title="Stop" aria-label="Stop playback">
                                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><rect x="6" y="6" width="12" height="12"/></svg>
                            </button>
                            <button class="pm-omr-btn pm-omr-btn-play" id="omr-at-play" disabled title="Play / Pause" aria-label="Play or pause">
                                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" id="omr-at-play-icon"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            </button>
                            <span class="pm-omr-time" id="omr-at-time" aria-live="polite">00:00 / 00:00</span>
                        </div>

                        <div class="pm-omr-controls-center">
                            <div class="pm-omr-control-group">
                                <label>Tempo</label>
                                <button class="pm-omr-btn-small" id="omr-at-tempo-down" aria-label="Decrease tempo">&minus;</button>
                                <span id="omr-at-tempo-value">100%</span>
                                <button class="pm-omr-btn-small" id="omr-at-tempo-up" aria-label="Increase tempo">+</button>
                            </div>
                        </div>

                        <div class="pm-omr-controls-right">
                            <button class="pm-omr-btn-toggle" id="omr-at-metronome" title="Metronome" aria-label="Toggle metronome">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                                    <path d="M12 2v8"/><path d="M5 22h14l-3-18H8L5 22z"/><circle cx="12" cy="8" r="2" fill="currentColor"/>
                                </svg>
                            </button>
                            <button class="pm-omr-btn-toggle" id="omr-at-loop" title="Loop" aria-label="Toggle loop">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                                    <path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/>
                                    <path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>
                                </svg>
                            </button>
                            <button class="pm-omr-btn-toggle" id="omr-at-countin" title="Count-In" aria-label="Toggle count-in">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                                    <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                                </svg>
                            </button>
                            <div class="pm-omr-volume">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                                </svg>
                                <input type="range" id="omr-at-volume" min="0" max="100" value="50" aria-label="Volume control">
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Download / New scan actions -->
            <div class="pm-omr-actions" id="omr-actions">
                <a class="pm-omr-action-btn pm-omr-action-btn--download" id="omr-download-btn" href="#" download>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Download MusicXML
                </a>
                <button type="button" class="pm-omr-action-btn pm-omr-action-btn--new" id="omr-new-scan-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    New Scan
                </button>
            </div>
        </div>

        <!-- How It Works -->
        <section class="pm-omr-how">
            <h2>How It Works</h2>
            <div class="pm-omr-how-grid">
                <div class="pm-omr-how-card">
                    <div class="pm-omr-how-card-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                    </div>
                    <h3>Upload</h3>
                    <p>Take a photo of sheet music or upload a PDF. We support most printed scores.</p>
                </div>
                <div class="pm-omr-how-card">
                    <div class="pm-omr-how-card-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
                            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                    </div>
                    <h3>OCR Analysis</h3>
                    <p>Our engine detects staves, notes, rests, dynamics and all musical symbols.</p>
                </div>
                <div class="pm-omr-how-card">
                    <div class="pm-omr-how-card-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                        </svg>
                    </div>
                    <h3>MusicXML</h3>
                    <p>The score is converted to standard MusicXML, a universal digital music format.</p>
                </div>
                <div class="pm-omr-how-card">
                    <div class="pm-omr-how-card-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
                            <polygon points="5 3 19 12 5 21 5 3"/>
                        </svg>
                    </div>
                    <h3>Listen & Play</h3>
                    <p>The interactive player renders the score and plays it with realistic piano sounds.</p>
                </div>
            </div>

            <div class="pm-omr-formats">
                <span class="pm-omr-format-badge">PDF</span>
                <span class="pm-omr-format-badge">PNG</span>
                <span class="pm-omr-format-badge">JPG</span>
                <span class="pm-omr-format-badge">TIFF</span>
                <span class="pm-omr-format-badge">→ MusicXML</span>
            </div>
        </section>

    </div><!-- .pm-omr-container -->
</div><!-- .pm-omr-page -->

<!-- ===== AlphaTab Library ===== -->
<script src="https://cdn.jsdelivr.net/npm/@coderline/alphatab@latest/dist/alphaTab.js"></script>

<!-- ===== Inline JavaScript ===== -->
<script>
(function() {
    'use strict';

    // -------------------------------------------------------
    // DOM references
    // -------------------------------------------------------
    const dropzone      = document.getElementById('omr-dropzone');
    const fileInput      = document.getElementById('omr-file-input');
    const filePreview    = document.getElementById('omr-file-preview');
    const fileName       = document.getElementById('omr-file-name');
    const fileSize       = document.getElementById('omr-file-size');
    const fileRemove     = document.getElementById('omr-file-remove');
    const scanBtn        = document.getElementById('omr-scan-btn');
    const progressPanel  = document.getElementById('omr-progress');
    const progressStatus = document.getElementById('omr-progress-status');
    const errorPanel     = document.getElementById('omr-error');
    const errorText      = document.getElementById('omr-error-text');
    const errorClose     = document.getElementById('omr-error-close');
    const resultPanel    = document.getElementById('omr-result');
    const downloadBtn    = document.getElementById('omr-download-btn');
    const newScanBtn     = document.getElementById('omr-new-scan-btn');

    // AlphaTab elements
    const atMain         = document.getElementById('omr-at-main');
    const atProgress     = document.getElementById('omr-at-progress');
    const atPlay         = document.getElementById('omr-at-play');
    const atStop         = document.getElementById('omr-at-stop');
    const atPlayIcon     = document.getElementById('omr-at-play-icon');
    const atTime         = document.getElementById('omr-at-time');
    const atTempoValue   = document.getElementById('omr-at-tempo-value');
    const atVolume       = document.getElementById('omr-at-volume');

    let selectedFile = null;
    let atApi = null;

    // REST endpoint
    const API_URL = '<?php echo esc_url( rest_url( 'pianomode/v1/omr-scan' ) ); ?>';

    // -------------------------------------------------------
    // Utilities
    // -------------------------------------------------------
    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    function show(el) { el.classList.add('visible'); }
    function hide(el) { el.classList.remove('visible'); }

    // -------------------------------------------------------
    // Dropzone / File selection
    // -------------------------------------------------------
    function initDropzone() {
        // Click to browse
        dropzone.addEventListener('click', function(e) {
            if (e.target.closest('.pm-omr-file-remove')) return;
            fileInput.click();
        });

        fileInput.addEventListener('change', function() {
            if (this.files.length) handleFile(this.files[0]);
        });

        // Drag events
        ['dragenter', 'dragover'].forEach(function(evt) {
            dropzone.addEventListener(evt, function(e) {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.add('dragover');
            });
        });

        ['dragleave', 'drop'].forEach(function(evt) {
            dropzone.addEventListener(evt, function(e) {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.remove('dragover');
            });
        });

        dropzone.addEventListener('drop', function(e) {
            var files = e.dataTransfer.files;
            if (files.length) handleFile(files[0]);
        });

        // Remove file
        fileRemove.addEventListener('click', function(e) {
            e.stopPropagation();
            clearFile();
        });
    }

    function handleFile(file) {
        // Validate extension
        var allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/tiff'];
        if (allowed.indexOf(file.type) === -1) {
            showError('Please select a PDF, PNG, JPG, or TIFF file.');
            return;
        }
        // Validate size (20 MB)
        if (file.size > 20 * 1024 * 1024) {
            showError('File is too large. Maximum size is 20 MB.');
            return;
        }

        selectedFile = file;
        fileName.textContent = file.name;
        fileSize.textContent = formatBytes(file.size);
        show(filePreview);
        show(scanBtn);
        scanBtn.disabled = false;
        hideError();
    }

    function clearFile() {
        selectedFile = null;
        fileInput.value = '';
        hide(filePreview);
        hide(scanBtn);
        scanBtn.disabled = true;
    }

    // -------------------------------------------------------
    // Error display
    // -------------------------------------------------------
    function showError(msg) {
        errorText.textContent = msg;
        show(errorPanel);
    }

    function hideError() {
        hide(errorPanel);
    }

    errorClose.addEventListener('click', hideError);

    // -------------------------------------------------------
    // Progress stepper
    // -------------------------------------------------------
    var steps = document.querySelectorAll('.pm-omr-step');

    function updateProgress(activeStep, statusText) {
        show(progressPanel);
        steps.forEach(function(s) {
            var n = parseInt(s.getAttribute('data-step'), 10);
            s.classList.remove('active', 'done', 'error');
            if (n < activeStep) s.classList.add('done');
            else if (n === activeStep) s.classList.add('active');
        });
        progressStatus.textContent = statusText || '';
    }

    function markStepError(step, statusText) {
        steps.forEach(function(s) {
            var n = parseInt(s.getAttribute('data-step'), 10);
            s.classList.remove('active');
            if (n === step) s.classList.add('error');
        });
        progressStatus.textContent = statusText || '';
    }

    function resetProgress() {
        hide(progressPanel);
        steps.forEach(function(s) { s.classList.remove('active', 'done', 'error'); });
        progressStatus.textContent = '';
    }

    // -------------------------------------------------------
    // Upload & Process
    // -------------------------------------------------------
    scanBtn.addEventListener('click', function() {
        if (!selectedFile) return;
        uploadAndProcess(selectedFile);
    });

    function uploadAndProcess(file) {
        // Reset UI
        hideError();
        hide(resultPanel);
        scanBtn.disabled = true;
        scanBtn.textContent = 'Processing...';

        // Step 1: Upload
        updateProgress(1, 'Uploading your score...');

        var formData = new FormData();
        formData.append('score_file', file);

        fetch(API_URL, {
            method: 'POST',
            body: formData,
            credentials: 'same-origin'
        })
        .then(function(response) {
            // Step 2: OCR
            updateProgress(2, 'Analysing musical notation (this may take a minute)...');
            return response.json().then(function(data) {
                return { ok: response.ok, status: response.status, data: data };
            });
        })
        .then(function(result) {
            if (!result.ok) {
                var errMsg = (result.data && result.data.message) ? result.data.message : 'An error occurred during processing.';
                throw new Error(errMsg);
            }

            // Step 3: Conversion complete
            updateProgress(3, 'MusicXML generated, loading player...');

            var musicxmlUrl = result.data.musicxml_url;
            var filename    = result.data.filename;

            // Setup download
            downloadBtn.href = musicxmlUrl;
            downloadBtn.setAttribute('download', filename);

            // Step 4: Load in AlphaTab
            setTimeout(function() {
                updateProgress(4, 'Score ready!');
                initAlphaTab(musicxmlUrl);
                show(resultPanel);

                // Reset button
                scanBtn.textContent = 'Analyse & Convert to Playable Score';
                scanBtn.disabled = false;
            }, 500);
        })
        .catch(function(err) {
            markStepError(2, err.message);
            showError(err.message);
            scanBtn.textContent = 'Analyse & Convert to Playable Score';
            scanBtn.disabled = false;
        });
    }

    // -------------------------------------------------------
    // AlphaTab Initialization
    // -------------------------------------------------------
    function initAlphaTab(musicxmlUrl) {
        // Destroy previous instance if any
        if (atApi) {
            try { atApi.destroy(); } catch(e) {}
            atApi = null;
            atMain.innerHTML = '';
        }

        atProgress.textContent = 'Loading...';
        atProgress.style.opacity = '1';
        atPlay.disabled = true;
        atStop.disabled = true;
        atTime.textContent = '00:00 / 00:00';
        atPlayIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';

        var currentTempo = 1.0;

        var settings = {
            file: musicxmlUrl,
            player: {
                enablePlayer: true,
                enableCursor: true,
                enableUserInteraction: true,
                scrollMode: 1,
                soundFont: 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@latest/dist/soundfont/sonivox.sf2',
                scrollElement: document.getElementById('omr-at-viewport')
            },
            display: {
                layoutMode: 0,
                staveProfile: 0,
                stretchForce: 0.8,
                scale: 1.0,
                barsPerRow: -1
            },
            notation: {
                notationMode: 1,
                elements: {
                    scoreTitle: false,
                    scoreSubTitle: false,
                    scoreArtist: false,
                    scoreAlbum: false,
                    scoreWords: false,
                    scoreMusic: false,
                    trackNames: false
                },
                rhythmMode: 0,
                rhythmHeight: 0,
                smallGraceTabNotes: false,
                fingeringMode: 0,
                extendBendArrows: false,
                extendLineEffects: false
            }
        };

        atApi = new alphaTab.AlphaTabApi(atMain, settings);

        // Error handling
        atApi.error.on(function(e) {
            atProgress.textContent = 'Error loading score';
            atProgress.style.color = '#ff4444';
            console.error('[AlphaTab] Error:', e.message || e);
        });

        // Score loaded — find piano track
        atApi.scoreLoaded.on(function(score) {
            if (!score.tracks || score.tracks.length === 0) return;

            var pianoTrack = null;
            var maxNotes = 0;

            for (var i = 0; i < score.tracks.length; i++) {
                var track = score.tracks[i];

                // Priority: track named "Piano"
                if (track.name && track.name.toLowerCase().indexOf('piano') !== -1) {
                    pianoTrack = track;
                    break;
                }

                // Fallback: track with most notes
                var noteCount = 0;
                if (track.staves && track.staves.length > 0) {
                    track.staves.forEach(function(staff) {
                        if (staff.bars && staff.bars.length > 0) {
                            staff.bars.forEach(function(bar) {
                                if (bar.voices && bar.voices.length > 0) {
                                    bar.voices.forEach(function(voice) {
                                        if (voice.beats && voice.beats.length > 0) {
                                            voice.beats.forEach(function(beat) {
                                                if (!beat.isRest && beat.notes) {
                                                    noteCount += beat.notes.length;
                                                }
                                            });
                                        }
                                    });
                                }
                            });
                        }
                    });
                }

                if (noteCount > maxNotes) {
                    maxNotes = noteCount;
                    pianoTrack = track;
                }
            }

            if (pianoTrack) {
                atApi.renderTracks([pianoTrack]);
            } else {
                atApi.renderTracks([score.tracks[0]]);
            }
        });

        // Loading events
        atApi.soundFontLoad.on(function(e) {
            var pct = Math.floor((e.loaded / e.total) * 100);
            atProgress.textContent = 'Loading sounds... ' + pct + '%';
        });

        atApi.renderStarted.on(function() {
            atProgress.textContent = 'Rendering...';
        });

        atApi.renderFinished.on(function() {
            atProgress.textContent = 'Ready';
            setTimeout(function() { atProgress.style.opacity = '0'; }, 1500);
        });

        atApi.playerReady.on(function() {
            atProgress.style.display = 'none';
            atPlay.disabled = false;
            atStop.disabled = false;
            atApi.masterVolume = atVolume.value / 100;
        });

        // Play / Pause
        atPlay.onclick = function() { atApi.playPause(); };
        atStop.onclick = function() { atApi.stop(); };

        atApi.playerStateChanged.on(function(e) {
            if (e.state === alphaTab.synth.PlayerState.Playing) {
                atPlayIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
            } else {
                atPlayIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
            }
        });

        // Time display
        atApi.playerPositionChanged.on(function(e) {
            function fmt(ms) {
                var s = Math.floor(ms / 1000);
                var m = Math.floor(s / 60);
                var sec = s % 60;
                return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
            }
            atTime.textContent = fmt(e.currentTime) + ' / ' + fmt(e.endTime);
        });

        // Tempo controls
        document.getElementById('omr-at-tempo-down').onclick = function() {
            currentTempo = Math.max(0.25, currentTempo - 0.1);
            atApi.playbackSpeed = currentTempo;
            atTempoValue.textContent = Math.round(currentTempo * 100) + '%';
        };
        document.getElementById('omr-at-tempo-up').onclick = function() {
            currentTempo = Math.min(2, currentTempo + 0.1);
            atApi.playbackSpeed = currentTempo;
            atTempoValue.textContent = Math.round(currentTempo * 100) + '%';
        };

        // Toggle buttons
        var metronomeBtn = document.getElementById('omr-at-metronome');
        metronomeBtn.onclick = function() {
            metronomeBtn.classList.toggle('active');
            atApi.metronomeVolume = metronomeBtn.classList.contains('active') ? 1 : 0;
        };

        var loopBtn = document.getElementById('omr-at-loop');
        loopBtn.onclick = function() {
            loopBtn.classList.toggle('active');
            atApi.isLooping = loopBtn.classList.contains('active');
        };

        var countinBtn = document.getElementById('omr-at-countin');
        countinBtn.onclick = function() {
            countinBtn.classList.toggle('active');
            atApi.countInVolume = countinBtn.classList.contains('active') ? 1 : 0;
        };

        // Volume
        atVolume.oninput = function() {
            atApi.masterVolume = this.value / 100;
        };
    }

    // -------------------------------------------------------
    // New Scan
    // -------------------------------------------------------
    newScanBtn.addEventListener('click', function() {
        hide(resultPanel);
        resetProgress();
        clearFile();

        if (atApi) {
            try { atApi.destroy(); } catch(e) {}
            atApi = null;
            atMain.innerHTML = '';
        }

        // Scroll to top of upload zone
        dropzone.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    // -------------------------------------------------------
    // Initialize
    // -------------------------------------------------------
    initDropzone();

})();
</script>

<?php get_footer(); ?>
