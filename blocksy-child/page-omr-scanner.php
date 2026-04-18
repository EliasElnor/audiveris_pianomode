<?php
/**
 * Template Name: Sheet to Sound
 * Description: Upload a sheet music photo or PDF, process it 100% in the browser
 *              using the PianoMode OMR engine, and play/download as MusicXML + MIDI.
 *              No server dependencies — everything runs client-side.
 *
 * @package Blocksy-child
 * @version 3.0.0
 */

// Safety net: ensure OMR scripts are enqueued even when is_page_template()
// misses (Blocksy / child-theme quirk). This runs BEFORE get_header() so
// the add_action callback fires during wp_head → wp_enqueue_scripts.
if ( function_exists( 'pianomode_enqueue_omr_scripts' ) ) {
    add_action( 'wp_enqueue_scripts', 'pianomode_enqueue_omr_scripts', 30 );
}

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
            <h1>Play <span>My Sheet</span></h1>
            <p>Upload any photo or PDF of sheet music and hear it played back instantly with real piano sounds.
               Our AI-powered scanner detects notes, rhythms, and dynamics automatically.<br>
               <strong>100% browser-based</strong> — no installation, no signup, completely free.</p>
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
            <p class="pm-omr-upload-hint">PDF, PNG, JPG or TIFF — Max 20 MB — Processed locally in your browser</p>

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

        <!-- Progress Stepper (Audiveris-style detailed pipeline) -->
        <div class="pm-omr-progress" id="omr-progress">
            <ul class="pm-omr-steps">
                <li class="pm-omr-step" data-step="1">
                    <div class="pm-omr-step-circle">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    </div>
                    <span class="pm-omr-step-label">Load</span>
                </li>
                <li class="pm-omr-step" data-step="2">
                    <div class="pm-omr-step-circle">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    </div>
                    <span class="pm-omr-step-label">Image</span>
                </li>
                <li class="pm-omr-step" data-step="3">
                    <div class="pm-omr-step-circle">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                    </div>
                    <span class="pm-omr-step-label">Detect</span>
                </li>
                <li class="pm-omr-step" data-step="4">
                    <div class="pm-omr-step-circle">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                    <span class="pm-omr-step-label">Export</span>
                </li>
            </ul>

            <!-- Live log panel (Audiveris-style) -->
            <div class="pm-omr-log-panel" id="omr-log-panel">
                <div class="pm-omr-log-scroll" id="omr-log-scroll"></div>
            </div>

            <div class="pm-omr-progress-status" id="omr-progress-status"></div>
            <div class="pm-omr-progress-bar-container">
                <div class="pm-omr-progress-bar" id="omr-progress-bar">
                    <div class="pm-omr-progress-bar-fill" id="omr-progress-bar-fill"></div>
                </div>
                <span class="pm-omr-progress-percent" id="omr-progress-percent">0%</span>
            </div>
        </div>

        <!-- Detection Preview Canvas (shows detected notes overlay) -->
        <div class="pm-omr-preview" id="omr-preview" style="display:none;">
            <div class="pm-omr-preview-header">
                <span>Detection Preview</span>
                <div class="pm-omr-preview-nav" id="omr-preview-nav" style="display:none;">
                    <button type="button" class="pm-omr-btn-small" id="omr-preview-prev" aria-label="Previous page">&#10094;</button>
                    <span class="pm-omr-preview-page" id="omr-preview-page">Page 1 / 1</span>
                    <button type="button" class="pm-omr-btn-small" id="omr-preview-next" aria-label="Next page">&#10095;</button>
                </div>
                <button type="button" class="pm-omr-preview-toggle" id="omr-preview-toggle">Hide</button>
            </div>
            <canvas id="omr-preview-canvas" style="width:100%; border-radius:8px;"></canvas>
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

                <!-- Piano options: octave range, labels, note naming -->
                <div class="pm-omr-piano-options" id="omr-piano-options">
                    <div class="pm-omr-piano-option">
                        <label for="omr-piano-octaves">Octaves</label>
                        <select id="omr-piano-octaves" aria-label="Piano octave range">
                            <option value="5">5 (C2–C7)</option>
                            <option value="7">7 (A0–C8)</option>
                            <option value="full" selected>Full 88</option>
                        </select>
                    </div>
                    <div class="pm-omr-piano-option">
                        <label for="omr-piano-labels">Labels</label>
                        <select id="omr-piano-labels" aria-label="Note label display">
                            <option value="c">C only</option>
                            <option value="all">All notes</option>
                            <option value="white">White keys</option>
                        </select>
                    </div>
                    <div class="pm-omr-piano-option">
                        <label for="omr-piano-naming">Naming</label>
                        <select id="omr-piano-naming" aria-label="Note naming convention">
                            <option value="international">C D E F G A B</option>
                            <option value="latin">Do Ré Mi Fa Sol La Si</option>
                        </select>
                    </div>
                </div>

                <!-- Piano Keyboard — Premium sightreading-quality -->
                <div class="pm-omr-piano-wrap" id="omr-piano-wrap">
                    <div class="pm-omr-piano-inner">
                        <div class="pm-omr-piano" id="omr-piano"></div>
                    </div>
                </div>
            </div>

            <!-- Download actions: MusicXML + MIDI + New Scan -->
            <div class="pm-omr-actions" id="omr-actions">
                <a class="pm-omr-action-btn pm-omr-action-btn--download" id="omr-download-xml" href="#" download>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Download MusicXML
                </a>
                <a class="pm-omr-action-btn pm-omr-action-btn--midi" id="omr-download-midi" href="#" download>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                        <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                    </svg>
                    Download MIDI
                </a>
                <button type="button" class="pm-omr-action-btn pm-omr-action-btn--new" id="omr-new-scan-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    New Scan
                </button>
            </div>

            <!-- Stats -->
            <div class="pm-omr-stats" id="omr-stats"></div>
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
                    <p>Our browser-based engine detects staves, notes, rests and musical symbols — no server needed.</p>
                </div>
                <div class="pm-omr-how-card">
                    <div class="pm-omr-how-card-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                        </svg>
                    </div>
                    <h3>MusicXML &amp; MIDI</h3>
                    <p>The score is converted to MusicXML and MIDI — download both formats instantly.</p>
                </div>
                <div class="pm-omr-how-card">
                    <div class="pm-omr-how-card-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
                            <polygon points="5 3 19 12 5 21 5 3"/>
                        </svg>
                    </div>
                    <h3>Listen &amp; Play</h3>
                    <p>The interactive player renders the score and plays it with realistic piano sounds. Use the MIDI in Piano Hero!</p>
                </div>
            </div>

            <div class="pm-omr-formats">
                <span class="pm-omr-format-badge">PDF</span>
                <span class="pm-omr-format-badge">PNG</span>
                <span class="pm-omr-format-badge">JPG</span>
                <span class="pm-omr-format-badge">TIFF</span>
                <span class="pm-omr-format-badge">&rarr; MusicXML</span>
                <span class="pm-omr-format-badge">&rarr; MIDI</span>
            </div>
        </section>

    </div><!-- .pm-omr-container -->
</div><!-- .pm-omr-page -->

<!-- ===== External Libraries ===== -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
</script>

<!--
    OMR Engine (client-side) — now enqueued via functions.php
    pianomode_omr_scanner_assets() under the 'pm-omr-core' and
    'pm-omr-engine' handles, so there is no inline <script> tag here.
    Cache busting is controlled by the PIANOMODE_OMR_VER constant.
-->

<!-- AlphaTab (pinned version - @latest is unreliable) -->
<script src="https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.3.1/dist/alphaTab.js"></script>

<!-- ===== Inline JavaScript ===== -->
<script>
(function() {
    'use strict';

    // -------------------------------------------------------
    // DOM references
    // -------------------------------------------------------
    var dropzone       = document.getElementById('omr-dropzone');
    var fileInput      = document.getElementById('omr-file-input');
    var filePreview    = document.getElementById('omr-file-preview');
    var fileName       = document.getElementById('omr-file-name');
    var fileSize       = document.getElementById('omr-file-size');
    var fileRemove     = document.getElementById('omr-file-remove');
    var scanBtn        = document.getElementById('omr-scan-btn');
    var progressPanel  = document.getElementById('omr-progress');
    var progressStatus = document.getElementById('omr-progress-status');
    var progressBarFill = document.getElementById('omr-progress-bar-fill');
    var progressPercent = document.getElementById('omr-progress-percent');
    var errorPanel     = document.getElementById('omr-error');
    var errorText      = document.getElementById('omr-error-text');
    var errorClose     = document.getElementById('omr-error-close');
    var resultPanel    = document.getElementById('omr-result');
    var downloadXml    = document.getElementById('omr-download-xml');
    var downloadMidi   = document.getElementById('omr-download-midi');
    var newScanBtn     = document.getElementById('omr-new-scan-btn');
    var statsPanel     = document.getElementById('omr-stats');
    var previewPanel   = document.getElementById('omr-preview');
    var previewCanvas  = document.getElementById('omr-preview-canvas');
    var previewToggle  = document.getElementById('omr-preview-toggle');

    // AlphaTab elements
    var atMain       = document.getElementById('omr-at-main');
    var atProgress   = document.getElementById('omr-at-progress');
    var atPlay       = document.getElementById('omr-at-play');
    var atStop       = document.getElementById('omr-at-stop');
    var atPlayIcon   = document.getElementById('omr-at-play-icon');
    var atTime       = document.getElementById('omr-at-time');
    var atTempoValue = document.getElementById('omr-at-tempo-value');
    var atVolume     = document.getElementById('omr-at-volume');

    // Log panel (Audiveris-style live output)
    var logPanel       = document.getElementById('omr-log-panel');
    var logScroll      = document.getElementById('omr-log-scroll');

    var selectedFile = null;
    var atApi = null;
    var lastResult = null;

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

    // Audiveris-style log: append a timestamped line to the log panel.
    var _logStart = 0;
    function logLine(msg) {
        if (!logScroll) return;
        if (!_logStart) _logStart = Date.now();
        var elapsed = ((Date.now() - _logStart) / 1000).toFixed(1);
        var line = document.createElement('div');
        line.className = 'pm-omr-log-line';
        line.textContent = '[' + elapsed + 's] ' + msg;
        logScroll.appendChild(line);
        logScroll.scrollTop = logScroll.scrollHeight;
        if (logPanel) logPanel.style.display = 'block';
    }

    // -------------------------------------------------------
    // Dropzone
    // -------------------------------------------------------
    dropzone.addEventListener('click', function(e) {
        if (e.target.closest('.pm-omr-file-remove')) return;
        fileInput.click();
    });

    fileInput.addEventListener('change', function() {
        if (this.files.length) handleFile(this.files[0]);
    });

    ['dragenter', 'dragover'].forEach(function(evt) {
        dropzone.addEventListener(evt, function(e) {
            e.preventDefault(); e.stopPropagation();
            dropzone.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(function(evt) {
        dropzone.addEventListener(evt, function(e) {
            e.preventDefault(); e.stopPropagation();
            dropzone.classList.remove('dragover');
        });
    });

    dropzone.addEventListener('drop', function(e) {
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });

    fileRemove.addEventListener('click', function(e) {
        e.stopPropagation();
        clearFile();
    });

    function handleFile(file) {
        var allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/tiff'];
        if (allowed.indexOf(file.type) === -1 && !file.name.match(/\.(pdf|png|jpe?g|tiff?)$/i)) {
            showError('Please select a PDF, PNG, JPG, or TIFF file.');
            return;
        }
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
    function hideError() { hide(errorPanel); }
    errorClose.addEventListener('click', hideError);

    // -------------------------------------------------------
    // Progress stepper
    // -------------------------------------------------------
    var steps = document.querySelectorAll('.pm-omr-step');

    function updateProgress(activeStep, statusText, percent) {
        show(progressPanel);
        for (var i = 0; i < steps.length; i++) {
            var n = parseInt(steps[i].getAttribute('data-step'), 10);
            steps[i].classList.remove('active', 'done', 'error');
            if (n < activeStep) steps[i].classList.add('done');
            else if (n === activeStep) steps[i].classList.add('active');
        }
        progressStatus.textContent = statusText || '';
        if (typeof percent === 'number') {
            var pct = Math.min(100, Math.max(0, percent));
            progressBarFill.style.width = pct + '%';
            progressPercent.textContent = Math.round(pct) + '%';
        }
        // Log every progress update to the Audiveris-style panel
        if (statusText) logLine(statusText);
    }

    function markStepError(step, statusText) {
        for (var i = 0; i < steps.length; i++) {
            var n = parseInt(steps[i].getAttribute('data-step'), 10);
            steps[i].classList.remove('active');
            if (n === step) steps[i].classList.add('error');
        }
        progressStatus.textContent = statusText || '';
        if (statusText) logLine('ERROR: ' + statusText);
    }

    function resetProgress() {
        hide(progressPanel);
        for (var i = 0; i < steps.length; i++) {
            steps[i].classList.remove('active', 'done', 'error');
        }
        progressStatus.textContent = '';
        progressBarFill.style.width = '0%';
        progressPercent.textContent = '0%';
        if (logScroll) logScroll.innerHTML = '';
        if (logPanel) logPanel.style.display = 'none';
        _logStart = 0;
    }

    // -------------------------------------------------------
    // Scan: run OMR engine client-side
    // -------------------------------------------------------
    scanBtn.addEventListener('click', function() {
        if (!selectedFile) return;
        processFile(selectedFile);
    });

    function processFile(file) {
        hideError();
        hide(resultPanel);
        previewPanel.style.display = 'none';
        scanBtn.disabled = true;
        scanBtn.textContent = 'Processing...';

        // Safety check: ensure the OMR engine loaded
        if (typeof PianoModeOMR === 'undefined' || !PianoModeOMR.Engine) {
            showError('OMR engine failed to load. Please refresh the page and try again.');
            scanBtn.textContent = 'Analyse & Convert to Playable Score';
            scanBtn.disabled = false;
            console.error('[PianoMode] PianoModeOMR is not defined — engine scripts did not load. Check page template assignment.');
            return;
        }

        logLine('Starting OMR analysis of ' + file.name + ' (' + formatBytes(file.size) + ')');

        // Use the client-side OMR engine
        PianoModeOMR.Engine.process(file, function(step, message, percent) {
            updateProgress(step, message, percent);
        }).then(function(result) {
            lastResult = result;

            // Show detection preview
            drawPreview(result);

            // Setup downloads
            var baseName = file.name.replace(/\.[^.]+$/, '');
            downloadXml.href = result.musicxmlUrl;
            downloadXml.setAttribute('download', baseName + '.musicxml');
            downloadMidi.href = result.midiUrl;
            downloadMidi.setAttribute('download', baseName + '.mid');

            // Stats
            statsPanel.innerHTML =
                '<strong>' + result.noteCount + '</strong> notes detected in ' +
                '<strong>' + result.staves.length + '</strong> staff(s) — ' +
                result.events.length + ' musical events';

            // Load in AlphaTab
            updateProgress(4, 'Score ready — loading player...', 100);
            show(resultPanel);

            // Build the piano keyboard now that the result panel is visible
            if (!pianoBuilt && pianoEl) buildPiano();
            syncPianoControls();

            // Defer AlphaTab init by one frame so the flex layout
            // inside .pm-omr-alphatab-wrap is fully resolved and
            // atMain has a non-zero offsetWidth. Avoids the
            // "AlphaTab container was invisible while autosizing"
            // warning that would otherwise fire on first scan.
            var mxlUrl = result.musicxmlUrl;
            requestAnimationFrame(function () {
                if (atMain.offsetWidth > 0) {
                    initAlphaTab(mxlUrl);
                } else {
                    requestAnimationFrame(function () { initAlphaTab(mxlUrl); });
                }
            });

            scanBtn.textContent = 'Analyse & Convert to Playable Score';
            scanBtn.disabled = false;

        }).catch(function(err) {
            markStepError(2, err.message);
            showError(err.message);
            scanBtn.textContent = 'Analyse & Convert to Playable Score';
            scanBtn.disabled = false;
        });
    }

    // -------------------------------------------------------
    // Detection preview canvas
    // -------------------------------------------------------
    function drawPreview(result) {
        if (!result || !result.staves || result.staves.length === 0) return;

        previewPanel.style.display = 'block';

        // We re-process to get the canvas — use the stored data
        var isPDF = selectedFile.type === 'application/pdf' || selectedFile.name.toLowerCase().endsWith('.pdf');
        var loadFn = isPDF ? PianoModeOMR.ImageProcessor.loadPDF : PianoModeOMR.ImageProcessor.loadImage;

        loadFn(selectedFile).then(function(loaded) {
            previewCanvas.width = loaded.width;
            previewCanvas.height = loaded.height;
            var ctx = previewCanvas.getContext('2d');
            ctx.drawImage(loaded.canvas, 0, 0);

            // Draw staff lines in blue
            ctx.strokeStyle = 'rgba(0, 120, 255, 0.5)';
            ctx.lineWidth = 2;
            for (var s = 0; s < result.staves.length; s++) {
                var staff = result.staves[s];
                for (var l = 0; l < staff.lines.length; l++) {
                    var y = staff.lines[l];
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(loaded.width, y);
                    ctx.stroke();
                }
            }

            // Draw detected noteheads in red/green
            for (var i = 0; i < result.noteHeads.length; i++) {
                var nh = result.noteHeads[i];
                ctx.strokeStyle = nh.isFilled ? 'rgba(255, 60, 60, 0.8)' : 'rgba(60, 200, 60, 0.8)';
                ctx.lineWidth = 2;
                ctx.strokeRect(nh.minX, nh.minY, nh.width, nh.height);

                // Label with pitch
                ctx.fillStyle = '#FFD700';
                ctx.font = 'bold 12px monospace';
                ctx.fillText(nh.pitchName || '', nh.minX, nh.minY - 4);
            }
        });
    }

    previewToggle.addEventListener('click', function() {
        var canvas = previewCanvas;
        if (canvas.style.display === 'none') {
            canvas.style.display = 'block';
            previewToggle.textContent = 'Hide';
        } else {
            canvas.style.display = 'none';
            previewToggle.textContent = 'Show';
        }
    });

    // -------------------------------------------------------
    // Salamander Grand Piano sampler (Tone.js)
    //
    // AlphaTab's built-in Sonivox SF2 sounds cheap and plasticky. The
    // rest of the site uses the Tone.js Salamander samples (see
    // concert-hall.js, sightreading-engine.js, virtual-piano/*.js) so
    // the scanner playback should match: real piano, real dynamics.
    //
    // Wiring strategy: we keep AlphaTab running for tempo / cursor /
    // scrolling, mute its internal synth (masterVolume = 0), and on
    // every midiEventsPlayed tick we route NoteOn / NoteOff to a
    // Tone.Sampler. The UI volume slider drives a Tone.Volume node
    // instead of AlphaTab's master.
    // -------------------------------------------------------
    var pmSampler = null;          // Tone.Sampler
    var pmSamplerVol = null;       // Tone.Volume (user-controlled)
    var pmSamplerLoaded = false;
    var pmActiveNotes = {};        // midi -> release callback (for cleanup)

    function midiToNoteName(midi) {
        var names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        return names[midi % 12] + (Math.floor(midi / 12) - 1);
    }

    var pmSamplerLoadCallbacks = [];
    function onSamplerLoaded(cb) {
        if (pmSamplerLoaded) { cb(); return; }
        pmSamplerLoadCallbacks.push(cb);
    }

    function ensureSalamander() {
        if (pmSampler || typeof Tone === 'undefined') return pmSampler;
        try {
            pmSamplerVol = new Tone.Volume(linearToDb(0.5)).toDestination();
            pmSampler = new Tone.Sampler({
                urls: {
                    'A0':  'A0.mp3',  'C1':  'C1.mp3',
                    'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3', 'A1':  'A1.mp3',
                    'C2':  'C2.mp3', 'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3', 'A2':  'A2.mp3',
                    'C3':  'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3', 'A3':  'A3.mp3',
                    'C4':  'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3', 'A4':  'A4.mp3',
                    'C5':  'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3', 'A5':  'A5.mp3',
                    'C6':  'C6.mp3', 'D#6': 'Ds6.mp3', 'F#6': 'Fs6.mp3', 'A6':  'A6.mp3',
                    'C7':  'C7.mp3', 'D#7': 'Ds7.mp3', 'F#7': 'Fs7.mp3', 'A7':  'A7.mp3',
                    'C8':  'C8.mp3'
                },
                baseUrl: 'https://tonejs.github.io/audio/salamander/',
                release: 1,
                onload: function () {
                    pmSamplerLoaded = true;
                    var cbs = pmSamplerLoadCallbacks;
                    pmSamplerLoadCallbacks = [];
                    for (var k = 0; k < cbs.length; k++) {
                        try { cbs[k](); } catch (e) {}
                    }
                },
                onerror: function () { pmSamplerLoaded = false; }
            }).connect(pmSamplerVol);
        } catch (e) {
            pmSampler = null;
        }
        return pmSampler;
    }

    function linearToDb(v) {
        if (v <= 0) return -Infinity;
        return 20 * Math.log10(v);
    }

    function pmSamplerStopAll() {
        if (!pmSampler) return;
        try { pmSampler.releaseAll(); } catch (e) {}
        pmActiveNotes = {};
    }

    // Counts every NoteOn we route to the Salamander sampler. Used by
    // the audio watchdog below: if we mute AlphaTab's internal synth
    // but never reach a NoteOn in N seconds of playback the user would
    // hear total silence — detect that and unmute AlphaTab as a
    // fallback.
    var pmSampledNoteOnCount = 0;

    // Route an AlphaTab midi event (command + data1 + data2) to the
    // Salamander sampler. Accepts both the raw MIDI status-byte form
    // and AlphaTab's richer event object with {type, noteKey, velocity}.
    //
    // Resolved NoteOn/NoteOff enum values — populated from
    // alphaTab.midi.MidiEventType at init time so ev.type comparisons
    // work against the actual numeric enum (1.3.x NoteOn is NOT 0x90).
    var pmMidiTypeNoteOn = null;
    var pmMidiTypeNoteOff = null;
    function pmResolveMidiEnum() {
        if (typeof alphaTab === 'undefined') return;
        var enumSrc = (alphaTab.midi && alphaTab.midi.MidiEventType)
                   || (alphaTab.synth && alphaTab.synth.MidiEventType);
        if (!enumSrc) return;
        if (enumSrc.NoteOn !== undefined)  pmMidiTypeNoteOn  = enumSrc.NoteOn;
        if (enumSrc.NoteOff !== undefined) pmMidiTypeNoteOff = enumSrc.NoteOff;
    }

    function pmHandleMidiEvent(ev) {
        if (!pmSampler || !pmSamplerLoaded) return;
        if (pmMidiTypeNoteOn === null) pmResolveMidiEnum();

        // AlphaTab 1.3.x MidiEvent fields vary by subclass — common
        // ones: type (MidiEventType enum, small integer), command
        // (raw MIDI byte 0x80..0xFF on NoteOn/Off/CC/PC), data1, data2,
        // noteKey, velocity, channel. We read defensively.
        var note     = (ev.noteKey   !== undefined) ? ev.noteKey
                     : (ev.noteNumber!== undefined) ? ev.noteNumber
                     : (ev.data1     !== undefined) ? ev.data1
                     : (ev.note      !== undefined) ? ev.note
                     : undefined;
        var velocity = (ev.velocity  !== undefined) ? ev.velocity
                     : (ev.data2     !== undefined) ? ev.data2
                     : undefined;
        var cmd      = (ev.command   !== undefined) ? ev.command : undefined;
        if (note === undefined || note < 0 || note > 127) return;

        // Channel 10 (index 9) = drums in GM — skip.
        var channel = (ev.channel !== undefined) ? ev.channel
                    : (typeof cmd === 'number' ? (cmd & 0x0F) : 0);
        if (channel === 9) return;

        var high = (typeof cmd === 'number') ? (cmd & 0xF0) : 0;
        // Detection order:
        //  1. AlphaTab flags `isNoteOn`/`isNoteOff` (older builds).
        //  2. Numeric ev.type === resolved enum value (1.3.x path).
        //  3. Raw MIDI status byte (command field set by some events).
        //  4. String fallback (very old / alt builds).
        var isNoteOn  = (ev.isNoteOn === true)
                     || (pmMidiTypeNoteOn !== null && ev.type === pmMidiTypeNoteOn
                         && (velocity === undefined || velocity > 0))
                     || (high === 0x90 && (velocity === undefined || velocity > 0))
                     || (ev.type === 'NoteOn');
        var isNoteOff = (ev.isNoteOff === true)
                     || (pmMidiTypeNoteOff !== null && ev.type === pmMidiTypeNoteOff)
                     || (pmMidiTypeNoteOn !== null && ev.type === pmMidiTypeNoteOn
                         && velocity === 0)
                     || (high === 0x80)
                     || (high === 0x90 && velocity === 0)
                     || (ev.type === 'NoteOff');

        if (isNoteOn) {
            var name = midiToNoteName(note);
            var vel = Math.max(0, Math.min(1, (velocity || 100) / 127));
            try { pmSampler.triggerAttack(name, Tone.now(), vel); } catch (e) {}
            pmActiveNotes[note] = true;
            pmSampledNoteOnCount++;
        } else if (isNoteOff) {
            if (pmActiveNotes[note]) {
                try { pmSampler.triggerRelease(midiToNoteName(note), Tone.now()); } catch (e) {}
                delete pmActiveNotes[note];
            }
        }
    }

    // -------------------------------------------------------
    // AlphaTab Initialization
    // -------------------------------------------------------
    var atLoadTimeoutId = null;
    function clearAtLoadTimeout() {
        if (atLoadTimeoutId) {
            clearTimeout(atLoadTimeoutId);
            atLoadTimeoutId = null;
        }
    }

    function initAlphaTab(musicxmlUrl) {
        if (typeof alphaTab === 'undefined') {
            atProgress.textContent = 'Error: player library unavailable';
            atProgress.style.color = '#ff4444';
            return;
        }

        if (atApi) {
            try { atApi.destroy(); } catch(e) {}
            atApi = null;
            atMain.innerHTML = '';
        }

        clearAtLoadTimeout();
        atProgress.textContent = 'Loading player...';
        atProgress.style.color = '';
        atProgress.style.opacity = '1';
        atProgress.style.display = '';
        atPlay.disabled = true;
        atStop.disabled = true;
        atTime.textContent = '00:00 / 00:00';
        atPlayIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';

        var currentTempo = 1.0;

        // Watchdog: if after 45s we still have no playerReady, surface the problem
        atLoadTimeoutId = setTimeout(function() {
            atProgress.textContent = 'Player timeout';
            atProgress.style.color = '#ff4444';
        }, 45000);

        // AlphaTab 1.3.x only emits midiEventsPlayed for types present
        // in this filter — default is empty so the Tone.js bridge would
        // never fire. The enum values in alphaTab.midi.MidiEventType are
        // NOT the raw MIDI status bytes (NoteOn != 0x90 in 1.3.x); we
        // must read them dynamically. Previous waves guessed 0x90/0x80
        // which silently dropped every event.
        //
        // To stay robust across AlphaTab minor versions we spray ALL
        // numeric values exposed by the enum into the filter (plus the
        // raw MIDI bytes as a safety net). pmHandleMidiEvent already
        // filters internally on NoteOn / NoteOff, so extra event types
        // passing through is harmless.
        var midiEventFilter = [];
        var midiEventTypeEnum = null;
        if (typeof alphaTab !== 'undefined') {
            if (alphaTab.midi && alphaTab.midi.MidiEventType) {
                midiEventTypeEnum = alphaTab.midi.MidiEventType;
            } else if (alphaTab.synth && alphaTab.synth.MidiEventType) {
                midiEventTypeEnum = alphaTab.synth.MidiEventType;
            }
        }
        if (midiEventTypeEnum) {
            for (var mk in midiEventTypeEnum) {
                var mv = midiEventTypeEnum[mk];
                if (typeof mv === 'number' && midiEventFilter.indexOf(mv) === -1) {
                    midiEventFilter.push(mv);
                }
            }
        }
        // Safety net: raw MIDI status bytes + a broad numeric range.
        // Some builds key the filter by raw byte; others use a compact
        // enum index (0..31). Push both to avoid guessing wrong.
        for (var mi = 0; mi < 32; mi++) {
            if (midiEventFilter.indexOf(mi) === -1) midiEventFilter.push(mi);
        }
        if (midiEventFilter.indexOf(0x80) === -1) midiEventFilter.push(0x80);
        if (midiEventFilter.indexOf(0x90) === -1) midiEventFilter.push(0x90);

        var settings = {
            file: musicxmlUrl,
            core: {
                engine: 'svg',
                enableLazyLoading: true
            },
            player: {
                enablePlayer: true,
                enableCursor: true,
                enableUserInteraction: true,
                scrollMode: 1,
                soundFont: 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.3.1/dist/soundfont/sonivox.sf2',
                scrollElement: document.getElementById('omr-at-viewport'),
                midiEventsPlayedFilter: midiEventFilter
            },
            display: {
                layoutMode: 0,
                staveProfile: 2,
                stretchForce: 1.2,
                scale: 1.2,
                barsPerRow: -1,
                padding: [15, 40, 15, 40],
                systemsLayout: 0,
                resources: {
                    staffLineColor:      '#1a0e03',
                    barSeparatorColor:   '#1a0e03',
                    mainGlyphColor:      '#0c0604',
                    secondaryGlyphColor: '#3a2106',
                    scoreInfoColor:      '#1a0e03'
                }
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

        try {
            atApi = new alphaTab.AlphaTabApi(atMain, settings);
        } catch (initErr) {
            clearAtLoadTimeout();
            atProgress.textContent = 'Player init failed';
            atProgress.style.color = '#ff4444';
            return;
        }

        atApi.error.on(function(e) {
            clearAtLoadTimeout();
            var msg = 'Error loading score';
            if (e && e.message) msg += ': ' + e.message;
            atProgress.textContent = msg;
            atProgress.style.color = '#ff4444';
        });

        atApi.scoreLoaded.on(function(score) {
            if (!score.tracks || score.tracks.length === 0) return;

            // Render ALL tracks: piano scores emitted by the engine use
            // either (a) a single piano part with 2 staves (treble+bass)
            // or (b) two single-staff parts when grand-staff pairing
            // missed. Rendering every track guarantees both clefs show,
            // and the AlphaTab layout groups them automatically.
            atApi.renderTracks(score.tracks);
        });

        atApi.soundFontLoad.on(function(e) {
            var pct = Math.floor((e.loaded / e.total) * 100);
            atProgress.textContent = 'Loading sounds... ' + pct + '%';
        });

        atApi.renderStarted.on(function() { atProgress.textContent = 'Rendering...'; });

        atApi.renderFinished.on(function() {
            atProgress.textContent = 'Ready';
            setTimeout(function() { atProgress.style.opacity = '0'; }, 1500);
        });

        atApi.playerReady.on(function() {
            clearAtLoadTimeout();
            atProgress.style.display = 'none';
            atPlay.disabled = false;
            atStop.disabled = false;
            // Kick off sample fetching early so the first Play is fast.
            // Keep AlphaTab's Sonivox synth AUDIBLE until the Salamander
            // samples finish loading — otherwise the user hears silence
            // during the 2–5 s download window. Once onload fires we
            // swap to the Salamander output.
            ensureSalamander();
            try { atApi.masterVolume = atVolume.value / 100; } catch (e) {}
            if (pmSampler) {
                onSamplerLoaded(function () {
                    try { atApi.masterVolume = 0; } catch (e) {}
                    applyPmVolume(atVolume.value / 100);
                });
                // Safety net: if samples haven't loaded in 20 s, keep
                // AlphaTab audible so playback isn't broken.
                setTimeout(function () {
                    if (!pmSamplerLoaded) {
                        console.warn('[OMR] Salamander samples still loading after 20s — sticking with Sonivox.');
                    }
                }, 20000);
            }
        });

        // Every AlphaTab time tick emits the midi events that would have
        // been played by the internal synth. We re-route them to the
        // Salamander sampler instead (internal synth is muted above).
        if (atApi.midiEventsPlayed && atApi.midiEventsPlayed.on) {
            atApi.midiEventsPlayed.on(function (args) {
                if (!args || !args.events) return;
                for (var i = 0; i < args.events.length; i++) {
                    pmHandleMidiEvent(args.events[i]);
                }
            });
        }

        atPlay.onclick = function() {
            // Tone requires a user gesture to unlock AudioContext.
            if (typeof Tone !== 'undefined' && Tone.context
                && Tone.context.state !== 'running') {
                try { Tone.start(); } catch (e) {}
            }
            ensureSalamander();
            atApi.playPause();
        };
        atStop.onclick = function() {
            atApi.stop();
            pmSamplerStopAll();
        };

        atApi.playerStateChanged.on(function(e) {
            if (e.state === alphaTab.synth.PlayerState.Playing) {
                atPlayIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
                // Audio watchdog: if AlphaTab was muted (because we
                // bridged audio to Tone.js Salamander) but no NoteOn
                // reaches the sampler within 3 s of playback starting,
                // assume the midi-events bridge is broken (filter enum
                // mismatch, event shape change, etc.) and unmute
                // AlphaTab so the user doesn't hear total silence. The
                // user will hear Sonivox instead of Salamander — not
                // ideal, but better than nothing.
                var startCount = pmSampledNoteOnCount;
                setTimeout(function () {
                    if (pmSampledNoteOnCount === startCount
                            && pmSamplerLoaded
                            && atApi && typeof atApi.masterVolume !== 'undefined') {
                        try {
                            atApi.masterVolume = atVolume.value / 100;
                        } catch (err) {}
                        console.warn('[OMR] No NoteOn reached Salamander after 3 s — '
                                     + 'falling back to AlphaTab Sonivox.');
                    }
                }, 3000);
            } else {
                atPlayIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
                // Clear piano + preview highlights when stopped/paused
                clearPianoKeys();
                clearPreviewHighlights();
                // Stop any sustaining Salamander voices so pause/stop
                // don't leave a note ringing.
                pmSamplerStopAll();
            }
        });

        atApi.playerPositionChanged.on(function(e) {
            function fmt(ms) {
                var s = Math.floor(ms / 1000), m = Math.floor(s / 60), sec = s % 60;
                return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
            }
            atTime.textContent = fmt(e.currentTime) + ' / ' + fmt(e.endTime);
        });

        // ── Piano + Preview note highlighting via activeBeatsChanged ──
        atApi.activeBeatsChanged.on(function(e) {
            clearPianoKeys();
            clearPreviewHighlights();

            if (!e.activeBeats || e.activeBeats.length === 0) return;

            var activeMidiNotes = [];
            for (var b = 0; b < e.activeBeats.length; b++) {
                var beat = e.activeBeats[b];
                if (!beat.notes) continue;
                for (var n = 0; n < beat.notes.length; n++) {
                    var note = beat.notes[n];
                    if (note.realValue >= 0) {
                        activeMidiNotes.push(note.realValue);
                        highlightPianoKey(note.realValue, true);
                    }
                }
            }

            // Highlight corresponding noteheads on the preview canvas
            if (activeMidiNotes.length > 0 && lastResult && lastResult.noteHeads) {
                highlightPreviewNotes(activeMidiNotes);
            }
        });

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

        atVolume.oninput = function() {
            var v = this.value / 100;
            // Always apply to Salamander (if present) so it's ready when
            // samples finish loading. Also keep AlphaTab's own volume in
            // sync until the sampler takes over — this way the slider
            // controls something audible through the whole loading window.
            if (pmSampler) applyPmVolume(v);
            if (!pmSamplerLoaded) {
                try { atApi.masterVolume = v; } catch (e) {}
            }
        };
    }

    // Map the 0..1 UI slider to the Tone.Volume node in dB. 0 -> -Infinity
    // (silent), 1 -> 0 dB (sampler nominal), mapped with a mild taper so
    // low slider positions stay audible.
    function applyPmVolume(v) {
        if (!pmSamplerVol) return;
        if (v <= 0) {
            pmSamplerVol.volume.value = -Infinity;
        } else {
            // Cube-root taper: more resolution at low volumes.
            var taper = Math.pow(v, 1 / 1.7);
            pmSamplerVol.volume.value = 20 * Math.log10(taper);
        }
    }

    // -------------------------------------------------------
    // New Scan
    // -------------------------------------------------------
    newScanBtn.addEventListener('click', function() {
        hide(resultPanel);
        resetProgress();
        clearFile();
        previewPanel.style.display = 'none';
        statsPanel.innerHTML = '';

        if (atApi) {
            try { atApi.destroy(); } catch(e) {}
            atApi = null;
            atMain.innerHTML = '';
        }
        // Release any Salamander voices still ringing from the
        // previous scan so a new load starts from silence.
        pmSamplerStopAll();

        // Revoke object URLs to free memory
        if (lastResult) {
            try { URL.revokeObjectURL(lastResult.musicxmlUrl); } catch(e) {}
            try { URL.revokeObjectURL(lastResult.midiUrl); } catch(e) {}
            lastResult = null;
        }

        dropzone.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    // -------------------------------------------------------
    // Premium Piano Keyboard — sightreading-quality, 88 keys (A0–C8)
    // Responsive sizing, geo-located labels, AlphaTab integration
    // -------------------------------------------------------
    var pianoWrap = document.getElementById('omr-piano-wrap');
    var pianoEl = document.getElementById('omr-piano');
    var activeKeys = {};
    var pianoBuilt = false;
    var pianoKeys = []; // Store key references for fast lookup

    // Note label systems
    var labelsInternational = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    var labelsLatin = ['Do', 'Ré', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
    var pianoLabels = labelsInternational;

    // Piano display options — driven by the select controls above the
    // keyboard. Persisted in localStorage so user preferences survive
    // page reloads.
    var pianoOpts = {
        range:  'full',            // '5', '7' or 'full'
        labels: 'c',               // 'c', 'all' or 'white'
        naming: 'international'    // 'international' or 'latin'
    };
    try {
        var stored = localStorage.getItem('pmOmrPianoOpts');
        if (stored) {
            var p = JSON.parse(stored);
            if (p && typeof p === 'object') {
                if (p.range)  pianoOpts.range  = p.range;
                if (p.labels) pianoOpts.labels = p.labels;
                if (p.naming) pianoOpts.naming = p.naming;
            }
        }
    } catch(e) {}

    function persistPianoOpts() {
        try { localStorage.setItem('pmOmrPianoOpts', JSON.stringify(pianoOpts)); } catch(e) {}
    }

    // Detect locale for solfege labels — only applies when the user
    // hasn't explicitly chosen a naming convention (first-visit default).
    (function detectNoteLocale() {
        var hasStored = false;
        try { hasStored = !!localStorage.getItem('pmOmrPianoOpts'); } catch(e) {}
        if (hasStored) {
            pianoLabels = (pianoOpts.naming === 'latin') ? labelsLatin : labelsInternational;
            return;
        }
        var lang = (navigator.language || navigator.userLanguage || '').toLowerCase().slice(0, 2);
        if (['fr', 'it', 'es', 'pt'].indexOf(lang) !== -1) {
            pianoOpts.naming = 'latin';
            pianoLabels = labelsLatin;
            return;
        }
        try {
            fetch('https://ipapi.co/json/', { mode: 'cors' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var cc = (data.country_code || '').toUpperCase();
                    var latinCountries = [
                        'FR','IT','ES','PT','BR','MX','AR','CO','CL','PE','VE','EC','BO',
                        'PY','UY','CR','PA','DO','GT','HN','SV','NI','CU','AO','MZ','GW',
                        'CV','ST','TL','BE','LU','CH','MC','SN','CI','ML','BF','NE','TD',
                        'CF','CG','CD','GA','CM','DJ','KM','MG','HT','GQ'
                    ];
                    if (latinCountries.indexOf(cc) !== -1) {
                        pianoOpts.naming = 'latin';
                        pianoLabels = labelsLatin;
                        syncPianoControls();
                        if (pianoBuilt) buildPiano();
                    }
                })
                .catch(function() {});
        } catch(e) {}
    })();

    function syncPianoControls() {
        var octSel = document.getElementById('omr-piano-octaves');
        var labSel = document.getElementById('omr-piano-labels');
        var namSel = document.getElementById('omr-piano-naming');
        if (octSel) octSel.value = pianoOpts.range;
        if (labSel) labSel.value = pianoOpts.labels;
        if (namSel) namSel.value = pianoOpts.naming;
    }

    function isBlackKey(midi) {
        return [1, 3, 6, 8, 10].indexOf(midi % 12) !== -1;
    }

    function midiToNoteName(midi) {
        var octave = Math.floor(midi / 12) - 1;
        var noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        return noteNames[midi % 12] + octave;
    }

    function buildPiano() {
        pianoKeys = [];
        pianoEl.innerHTML = '';
        pianoLabels = (pianoOpts.naming === 'latin') ? labelsLatin : labelsInternational;

        // Range selection: '5' = C2..C7 (61 keys), '7' = A0..C8 (88 keys,
        // same as full), 'full' = A0..C8. We keep the default as full so
        // the historic 88-key behaviour is preserved unless the user picks
        // 5 explicitly.
        var startPitch, endPitch;
        if (pianoOpts.range === '5') {
            startPitch = 36;  // C2
            endPitch   = 96;  // C7
        } else {
            startPitch = 21;  // A0
            endPitch   = 108; // C8
        }

        var whitePitchClasses = { 0:0, 2:1, 4:2, 5:3, 7:4, 9:5, 11:6 };

        for (var pitch = startPitch; pitch <= endPitch; pitch++) {
            var black = isBlackKey(pitch);
            var noteName = midiToNoteName(pitch);

            var wrapper = document.createElement('div');
            wrapper.className = black
                ? 'pm-piano-key-wrapper pm-piano-key-wrapper-black'
                : 'pm-piano-key-wrapper pm-piano-key-wrapper-white';

            var key = document.createElement('div');
            key.className = 'pm-piano-key ' + (black ? 'pm-piano-black' : 'pm-piano-white');
            key.setAttribute('data-midi', pitch);
            key.setAttribute('data-note', noteName);

            // Labels: 'c' (default — only C notes), 'white' (every white
            // key), 'all' (every key including sharps). Sharp keys get
            // the accidental glyph so Latin and International users both
            // see "C#" / "Do#" without extra lookups.
            var shouldLabel = false;
            if (pianoOpts.labels === 'all') {
                shouldLabel = true;
            } else if (pianoOpts.labels === 'white') {
                shouldLabel = !black;
            } else {
                shouldLabel = !black && noteName.indexOf('C') === 0
                              && noteName.indexOf('#') === -1;
            }
            if (shouldLabel) {
                var pc = pitch % 12;
                var octave = Math.floor(pitch / 12) - 1;
                var labelText;
                if (black) {
                    // Name sharps after the white below (C#, D#, ...)
                    var base = whitePitchClasses[(pitch - 1) % 12];
                    labelText = (base !== undefined)
                              ? (pianoLabels[base] + '#' + octave)
                              : noteName;
                } else {
                    var idx = whitePitchClasses[pc];
                    labelText = pianoLabels[idx] + octave;
                }
                var label = document.createElement('span');
                label.className = 'pm-piano-label';
                label.textContent = labelText;
                key.appendChild(label);
            }

            wrapper.appendChild(key);
            pianoEl.appendChild(wrapper);

            pianoKeys.push({
                element: key,
                midi: pitch,
                type: black ? 'black' : 'white'
            });
        }

        pianoBuilt = true;

        // Prevent the visible height jump reported by the user:
        //   1. Hide the piano until it has been sized against the real
        //      container width (avoids the 140px CSS default flashing
        //      before the JS-computed height kicks in).
        //   2. Try sizing synchronously (common case: container laid out).
        //   3. Fall back to requestAnimationFrame when the wrap has zero
        //      width because display:none -> block just happened.
        //   4. Use ResizeObserver so future resizes update the keys
        //      without the previous setTimeout(50/300) double-reflow jump.
        pianoEl.style.visibility = 'hidden';
        if (!adjustPianoSize()) {
            requestAnimationFrame(function () {
                if (!adjustPianoSize()) {
                    requestAnimationFrame(adjustPianoSize);
                }
            });
        }

        if (!pianoEl._resizeListenerAdded) {
            pianoEl._resizeListenerAdded = true;
            if (typeof ResizeObserver === 'function') {
                var ro = new ResizeObserver(function () { adjustPianoSize(); });
                ro.observe(pianoWrap);
            } else {
                var resizeTimeout;
                window.addEventListener('resize', function () {
                    clearTimeout(resizeTimeout);
                    resizeTimeout = setTimeout(adjustPianoSize, 150);
                });
            }
        }
    }

    // Returns true when sizing was applied, false when the container
    // wasn't laid out yet (caller should retry on the next frame).
    function adjustPianoSize() {
        if (!pianoWrap || !pianoEl) return false;
        var containerWidth = pianoWrap.clientWidth;
        if (containerWidth === 0) return false;

        // Count white keys in the current range.
        //   full / 7 (A0..C8) → 52 white
        //   5       (C2..C7) → 36 white
        var whiteKeyCount = (pianoOpts.range === '5') ? 36 : 52;
        var availableWidth = containerWidth - 16; // padding
        var whiteKeyWidth = availableWidth / whiteKeyCount;
        var blackKeyWidth = whiteKeyWidth * 0.62;
        var whiteKeyHeight = Math.min(160, Math.max(100, whiteKeyWidth * 4.5));
        var blackKeyHeight = whiteKeyHeight * 0.65;

        pianoEl.style.setProperty('--omr-white-key-width', whiteKeyWidth.toFixed(2) + 'px');
        pianoEl.style.setProperty('--omr-black-key-width', blackKeyWidth.toFixed(2) + 'px');
        pianoEl.style.setProperty('--omr-white-key-height', whiteKeyHeight.toFixed(0) + 'px');
        pianoEl.style.setProperty('--omr-black-key-height', blackKeyHeight.toFixed(0) + 'px');

        pianoEl.style.width = '100%';
        pianoEl.style.height = whiteKeyHeight + 'px';
        pianoEl.style.visibility = 'visible';
        return true;
    }

    function highlightPianoKey(midiNote, on) {
        if (!pianoEl) return;
        var key = pianoEl.querySelector('[data-midi="' + midiNote + '"]');
        if (key) {
            if (on) {
                key.classList.add('pm-piano-active');
                activeKeys[midiNote] = true;
            } else {
                key.classList.remove('pm-piano-active');
                delete activeKeys[midiNote];
            }
        }
    }

    function clearPianoKeys() {
        var keys = Object.keys(activeKeys);
        for (var i = 0; i < keys.length; i++) highlightPianoKey(parseInt(keys[i]), false);
    }

    // -------------------------------------------------------
    // Preview canvas note highlighting during playback
    // -------------------------------------------------------
    var previewHighlightCtx = null;
    var previewBaseImage = null;
    var highlightedNoteIndices = [];

    var _origDrawPreview = drawPreview;
    drawPreview = function(result) {
        _origDrawPreview(result);
        setTimeout(function() {
            if (previewCanvas.width > 0 && previewCanvas.height > 0) {
                var ctx = previewCanvas.getContext('2d');
                previewBaseImage = ctx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
                previewHighlightCtx = ctx;
            }
        }, 500);
    };

    function highlightPreviewNotes(midiNotes) {
        if (!lastResult || !lastResult.noteHeads || !previewHighlightCtx || !previewBaseImage) return;
        previewHighlightCtx.putImageData(previewBaseImage, 0, 0);

        var noteHeads = lastResult.noteHeads;
        var usedIndices = {};

        for (var m = 0; m < midiNotes.length; m++) {
            var targetMidi = midiNotes[m];
            var bestIdx = -1;
            for (var i = 0; i < noteHeads.length; i++) {
                if (noteHeads[i].midiNote === targetMidi && !usedIndices[i]) {
                    if (bestIdx === -1 || noteHeads[i].centerX < noteHeads[bestIdx].centerX) {
                        bestIdx = i;
                    }
                }
            }
            if (bestIdx !== -1) {
                usedIndices[bestIdx] = true;
                var nh = noteHeads[bestIdx];
                previewHighlightCtx.save();
                previewHighlightCtx.shadowColor = '#D7BF81';
                previewHighlightCtx.shadowBlur = 18;
                previewHighlightCtx.strokeStyle = '#D7BF81';
                previewHighlightCtx.lineWidth = 3;
                previewHighlightCtx.beginPath();
                previewHighlightCtx.arc(nh.centerX, nh.centerY, Math.max(nh.width, nh.height) * 0.8, 0, Math.PI * 2);
                previewHighlightCtx.stroke();
                previewHighlightCtx.fillStyle = 'rgba(215, 191, 129, 0.25)';
                previewHighlightCtx.fill();
                previewHighlightCtx.restore();
            }
        }
        highlightedNoteIndices = Object.keys(usedIndices).map(Number);
    }

    function clearPreviewHighlights() {
        if (previewHighlightCtx && previewBaseImage) {
            previewHighlightCtx.putImageData(previewBaseImage, 0, 0);
        }
        highlightedNoteIndices = [];
    }

    // -------------------------------------------------------
    // Piano option select listeners — rebuild the keyboard when the
    // range / labels / naming change. Changes are persisted so the
    // user's picks survive page reloads.
    // -------------------------------------------------------
    (function wirePianoOptions() {
        var octSel = document.getElementById('omr-piano-octaves');
        var labSel = document.getElementById('omr-piano-labels');
        var namSel = document.getElementById('omr-piano-naming');
        syncPianoControls();
        function onChange() {
            if (octSel) pianoOpts.range  = octSel.value;
            if (labSel) pianoOpts.labels = labSel.value;
            if (namSel) pianoOpts.naming = namSel.value;
            pianoLabels = (pianoOpts.naming === 'latin') ? labelsLatin : labelsInternational;
            persistPianoOpts();
            if (pianoBuilt) buildPiano();
        }
        if (octSel) octSel.addEventListener('change', onChange);
        if (labSel) labSel.addEventListener('change', onChange);
        if (namSel) namSel.addEventListener('change', onChange);
    })();

    // -------------------------------------------------------
    // Detection preview — multi-page navigation. Populated by
    // drawPreview when lastResult.pages is present (stitched PDF
    // scans produce one canvas per page of the original PDF).
    // -------------------------------------------------------
    (function wirePreviewNav() {
        var navWrap = document.getElementById('omr-preview-nav');
        var prev    = document.getElementById('omr-preview-prev');
        var next    = document.getElementById('omr-preview-next');
        var label   = document.getElementById('omr-preview-page');
        if (!navWrap || !prev || !next || !label) return;
        var previewPageIdx = 0;

        function currentPages() {
            if (!lastResult) return null;
            if (lastResult.pagePreviews && lastResult.pagePreviews.length > 1) {
                return lastResult.pagePreviews;
            }
            return null;
        }
        function renderPreviewPage() {
            var pages = currentPages();
            if (!pages) { navWrap.style.display = 'none'; return; }
            navWrap.style.display = '';
            if (previewPageIdx < 0) previewPageIdx = 0;
            if (previewPageIdx >= pages.length) previewPageIdx = pages.length - 1;
            label.textContent = 'Page ' + (previewPageIdx + 1) + ' / ' + pages.length;

            var ctx = previewCanvas.getContext('2d');
            var page = pages[previewPageIdx];
            previewCanvas.width  = page.canvas.width;
            previewCanvas.height = page.canvas.height;
            ctx.drawImage(page.canvas, 0, 0);
            previewBaseImage = ctx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
            previewHighlightCtx = ctx;
        }
        prev.addEventListener('click', function () {
            previewPageIdx--;
            renderPreviewPage();
        });
        next.addEventListener('click', function () {
            previewPageIdx++;
            renderPreviewPage();
        });
        // Hook drawPreview so page nav appears when relevant.
        var origDraw = drawPreview;
        drawPreview = function (result) {
            previewPageIdx = 0;
            origDraw(result);
            if (result && result.pagePreviews && result.pagePreviews.length > 1) {
                navWrap.style.display = '';
                label.textContent = 'Page 1 / ' + result.pagePreviews.length;
            } else {
                navWrap.style.display = 'none';
            }
        };
    })();

})();
</script>

<?php get_footer(); ?>
