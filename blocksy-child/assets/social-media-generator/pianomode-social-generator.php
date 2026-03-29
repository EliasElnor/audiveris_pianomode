<?php
/**
 * PianoMode Social Media Generator
 *
 * Generates social media visuals (Instagram, TikTok, Pinterest)
 * and scripts (voice-over, video) for each post, score and lesson.
 * Includes: auto-generated hashtags, ready-to-post captions, focus point.
 *
 * @package PianoMode
 * @version 1.0.0
 *
 * INSTALLATION: require_once in functions.php
 */

if (!defined('ABSPATH')) {
    exit;
}

class PianoMode_Social_Generator {

    private static $instance = null;
    private $page_hook = '';

    /** Logo URL (hosted on pianomode.com) */
    private $logo_url = 'https://pianomode.com/wp-content/uploads/2025/12/cropped-PianoMode_Logo_2026.png';

    /** Hashtag pools by category */
    private $hashtag_pools = array(
        'piano'    => array('#piano', '#pianomusic', '#pianist', '#pianocover', '#pianoplayer', '#pianoforte', '#pianolove', '#pianokeys'),
        'music'    => array('#music', '#musician', '#musiclife', '#classicalmusic', '#musicislife', '#musically', '#musiclover'),
        'learning' => array('#pianolessons', '#learnpiano', '#musiclesson', '#musiclearning', '#pianopractice', '#pianobeginners', '#pianotutorial'),
        'score'    => array('#sheetmusic', '#pianosheet', '#musicnotes', '#pianoscore', '#musicsheet', '#pianopiece'),
        'brand'    => array('#PianoMode', '#pianomode', '#pianomodecom'),
    );

    public static function get_instance() {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        add_action('admin_menu', array($this, 'add_admin_menu'));
        add_action('admin_enqueue_scripts', array($this, 'enqueue_admin_assets'));

        // AJAX endpoints
        add_action('wp_ajax_pm_get_post_for_social', array($this, 'ajax_get_post_data'));
        add_action('wp_ajax_pm_search_posts_social', array($this, 'ajax_search_posts'));
        add_action('wp_ajax_pm_generate_scripts', array($this, 'ajax_generate_scripts'));
        add_action('wp_ajax_pm_get_video_slides', array($this, 'ajax_get_video_slides'));
        add_action('wp_ajax_pm_save_publish_status', array($this, 'ajax_save_publish_status'));
        add_action('wp_ajax_pm_save_social_settings', array($this, 'ajax_save_social_settings'));
        add_action('wp_ajax_pm_switch_lesson_image', array($this, 'ajax_switch_lesson_image'));
    }

    /**
     * Admin menu - share icon, position 31 (after SEO dashboard at 30)
     */
    public function add_admin_menu() {
        $this->page_hook = add_menu_page(
            'Social Media Generator',
            'Social Media',
            'edit_posts',
            'pm-social-generator',
            array($this, 'render_admin_page'),
            'dashicons-share',
            31
        );
    }

    /**
     * Enqueue JS/CSS only on the Social Media admin page
     */
    public function enqueue_admin_assets($hook) {
        if ($hook !== $this->page_hook) {
            return;
        }

        // Enqueue WordPress media library
        wp_enqueue_media();

        $base_url = get_stylesheet_directory_uri() . '/assets/social-media-generator/';
        $base_dir = get_stylesheet_directory() . '/assets/social-media-generator/';

        wp_enqueue_style(
            'pm-social-generator-css',
            $base_url . 'social-generator.css',
            array(),
            filemtime($base_dir . 'social-generator.css')
        );

        wp_enqueue_script(
            'pm-social-generator-js',
            $base_url . 'social-generator.js',
            array(),
            filemtime($base_dir . 'social-generator.js'),
            true
        );

        // Video generator JS
        $video_js = $base_dir . 'social-video-generator.js';
        if (file_exists($video_js)) {
            wp_enqueue_script(
                'pm-social-video-js',
                $base_url . 'social-video-generator.js',
                array('pm-social-generator-js'),
                filemtime($video_js),
                true
            );
        }

        wp_localize_script('pm-social-generator-js', 'pmSocialGen', array(
            'ajaxurl'  => admin_url('admin-ajax.php'),
            'nonce'    => wp_create_nonce('pm_social_generator'),
            'logo_url' => $this->logo_url,
        ));
    }

    /**
     * Main admin page
     */
    public function render_admin_page() {
        ?>
        <div class="wrap pm-social-generator">
            <h1 class="pm-sg-main-title">
                <span class="dashicons dashicons-share"></span>
                PianoMode Social Media Generator
            </h1>
            <p class="pm-sg-subtitle">Generate HD visuals, scripts & captions for your social media in one click.</p>

            <!-- ═══════════════ SECTION 1: SELECTOR ═══════════════ -->
            <div class="pm-sg-section pm-sg-selector">
                <h2>1. Select Content</h2>
                <div class="pm-sg-selector-row">
                    <div class="pm-sg-field">
                        <label for="pm-sg-post-type">Content Type</label>
                        <select id="pm-sg-post-type">
                            <option value="post">Article (Blog)</option>
                            <option value="score">Score (Sheet Music)</option>
                            <option value="pm_lesson">Lesson (LMS)</option>
                            <option value="custom">Custom</option>
                        </select>
                    </div>
                    <div class="pm-sg-field pm-sg-field-search" id="pm-sg-search-wrap">
                        <label for="pm-sg-search">Search</label>
                        <input type="text" id="pm-sg-search" placeholder="Type to search..." autocomplete="off">
                        <div id="pm-sg-results" class="pm-sg-results-dropdown"></div>
                    </div>
                    <!-- Custom type: manual setup -->
                    <div class="pm-sg-field" id="pm-sg-custom-setup" style="display:none;">
                        <label>Custom Post</label>
                        <button type="button" id="pm-sg-custom-start" class="pm-sg-btn pm-sg-btn-gold">Create Custom Post</button>
                    </div>
                </div>
                <div id="pm-sg-selected-post" class="pm-sg-selected-post" style="display:none;">
                    <span class="pm-sg-selected-label">Selected:</span>
                    <strong id="pm-sg-selected-title"></strong>
                    <button type="button" id="pm-sg-clear-selection" class="pm-sg-btn-small">&times; Change</button>
                </div>

                <!-- Publish status tracker -->
                <div id="pm-sg-publish-status" class="pm-sg-publish-status" style="display:none;">
                    <span class="pm-sg-publish-label">Published on:</span>
                    <div class="pm-sg-publish-checkboxes">
                        <label class="pm-sg-publish-check" data-platform="youtube">
                            <input type="checkbox" name="pm_sg_published_youtube">
                            <span class="pm-sg-publish-icon pm-sg-icon-youtube"></span>
                            YouTube
                        </label>
                        <label class="pm-sg-publish-check" data-platform="tiktok">
                            <input type="checkbox" name="pm_sg_published_tiktok">
                            <span class="pm-sg-publish-icon pm-sg-icon-tiktok"></span>
                            TikTok
                        </label>
                        <label class="pm-sg-publish-check" data-platform="instagram">
                            <input type="checkbox" name="pm_sg_published_instagram">
                            <span class="pm-sg-publish-icon pm-sg-icon-instagram"></span>
                            Instagram
                        </label>
                        <label class="pm-sg-publish-check" data-platform="facebook">
                            <input type="checkbox" name="pm_sg_published_facebook">
                            <span class="pm-sg-publish-icon pm-sg-icon-facebook"></span>
                            Facebook
                        </label>
                        <label class="pm-sg-publish-check" data-platform="pinterest">
                            <input type="checkbox" name="pm_sg_published_pinterest">
                            <span class="pm-sg-publish-icon pm-sg-icon-pinterest"></span>
                            Pinterest
                        </label>
                    </div>
                </div>
            </div>

            <!-- ═══════════════ SECTION 2: FOCUS POINT + OPTIONS ═══════════════ -->
            <div id="pm-sg-editor-panel" class="pm-sg-section" style="display:none;">
                <div class="pm-sg-editor-grid">
                    <!-- Focus Point -->
                    <div class="pm-sg-focus-panel">
                        <h2>2. Image Focus Point</h2>
                        <p class="pm-sg-hint">Click on the image to center the framing for each format.</p>
                        <div class="pm-sg-focus-image-wrapper" id="pm-sg-focus-wrapper">
                            <img id="pm-sg-source-image" src="" alt="Image source">
                            <div id="pm-sg-crosshair"></div>
                        </div>
                        <p class="pm-sg-focus-coords">
                            Focus : <span id="pm-sg-focus-x">50</span>% x <span id="pm-sg-focus-y">50</span>%
                        </p>
                        <div class="pm-sg-focus-actions">
                            <button type="button" id="pm-sg-switch-image" class="pm-sg-btn pm-sg-btn-small-outline" style="display:none;">
                                <span class="dashicons dashicons-randomize"></span> Switch Image
                            </button>
                            <button type="button" id="pm-sg-pick-media" class="pm-sg-btn pm-sg-btn-small-outline" style="display:none;">
                                <span class="dashicons dashicons-admin-media"></span> Choose from Media
                            </button>
                        </div>
                    </div>

                    <!-- Text options -->
                    <div class="pm-sg-text-options">
                        <h2>3. Customize Text</h2>
                        <div class="pm-sg-field">
                            <label for="pm-sg-title">Title (displayed on image)</label>
                            <input type="text" id="pm-sg-title" placeholder="Post title...">
                        </div>
                        <div class="pm-sg-field">
                            <label for="pm-sg-description">Short Description</label>
                            <textarea id="pm-sg-description" rows="3" placeholder="A catchy headline..."></textarea>
                        </div>
                        <div class="pm-sg-field">
                            <label for="pm-sg-description2">Second Description / Quote <span class="pm-sg-hint-inline">(optional — displayed after the first in video)</span></label>
                            <textarea id="pm-sg-description2" rows="2" placeholder="Optional second description or quote for the video..."></textarea>
                        </div>
                        <div class="pm-sg-toggle-row">
                            <label class="pm-sg-toggle">
                                <input type="checkbox" id="pm-sg-with-text" checked>
                                <span class="pm-sg-toggle-slider"></span>
                                Include title + description on images
                            </label>
                        </div>
                        <div class="pm-sg-btn-row">
                            <button type="button" id="pm-sg-refresh-previews" class="pm-sg-btn pm-sg-btn-gold">
                                <span class="dashicons dashicons-update"></span> Refresh Previews
                            </button>
                            <button type="button" id="pm-sg-save-btn" class="pm-sg-btn pm-sg-btn-save">
                                <span class="dashicons dashicons-saved"></span> Save Settings
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Extra Images (lessons/custom) -->
                <div id="pm-sg-extra-images" class="pm-sg-extra-images" style="display:none;">
                    <h3>Extra Images <span class="pm-sg-hint-inline">(up to 4 for custom, 2 for lessons — used in video)</span></h3>
                    <div id="pm-sg-extra-images-grid" class="pm-sg-extra-images-grid"></div>
                    <button type="button" id="pm-sg-add-extra-image" class="pm-sg-btn pm-sg-btn-small-outline">
                        <span class="dashicons dashicons-plus-alt2"></span> Add Image from Media
                    </button>
                </div>

                <!-- Video Upload (custom type) -->
                <div id="pm-sg-video-upload-section" class="pm-sg-video-upload" style="display:none;">
                    <h3>Background Video <span class="pm-sg-hint-inline">(MP4/WebM, max 200MB — plays behind title overlay)</span></h3>
                    <div id="pm-sg-video-upload-preview" class="pm-sg-video-preview-wrap" style="display:none;">
                        <video id="pm-sg-uploaded-video" muted playsinline></video>
                        <div id="pm-sg-video-crosshair" class="pm-sg-content-crosshair" style="left:50%;top:50%;"></div>
                    </div>
                    <div class="pm-sg-video-timeline" id="pm-sg-video-timeline-wrap" style="display:none;">
                        <label>Timeline: <span id="pm-sg-video-start-label">0s</span> — <span id="pm-sg-video-end-label">0s</span></label>
                        <div class="pm-sg-range-row">
                            <label>Start (s)</label>
                            <input type="number" id="pm-sg-video-start" min="0" step="0.5" value="0">
                            <label>End (s)</label>
                            <input type="number" id="pm-sg-video-end" min="0" step="0.5" value="0">
                        </div>
                    </div>
                    <button type="button" id="pm-sg-upload-video-btn" class="pm-sg-btn pm-sg-btn-small-outline">
                        <span class="dashicons dashicons-video-alt3"></span> Choose Video from Media
                    </button>
                    <button type="button" id="pm-sg-remove-video-btn" class="pm-sg-btn pm-sg-btn-small-outline pm-sg-btn-danger" style="display:none;">
                        <span class="dashicons dashicons-trash"></span> Remove Video
                    </button>
                </div>

                <!-- Article Images for Video -->
                <div id="pm-sg-content-images" class="pm-sg-content-images" style="display:none;">
                    <h3>Article Images <span class="pm-sg-hint-inline">(click to set focus, toggle to include in video)</span></h3>
                    <div id="pm-sg-content-images-grid" class="pm-sg-content-images-grid"></div>
                </div>

                <!-- Editable Video Slides -->
                <div id="pm-sg-slide-editor" class="pm-sg-slide-editor" style="display:none;">
                    <h3>Edit Video Slides <span class="pm-sg-hint-inline">(modify text displayed in video)</span></h3>
                    <div id="pm-sg-slide-editor-list" class="pm-sg-slide-editor-list"></div>
                </div>
            </div>

            <!-- ═══════════════ TEMPLATE SWITCHER ═══════════════ -->
            <div id="pm-sg-template-switcher" class="pm-sg-section" style="display:none;">
                <h2>3b. Visual Style</h2>
                <div class="pm-sg-template-tabs">
                    <button type="button" class="pm-sg-template-tab pm-sg-template-tab-active" data-template="classic">
                        <span class="pm-sg-tab-icon"><span class="dashicons dashicons-format-image"></span></span>
                        <span class="pm-sg-tab-label">Classic</span>
                        <span class="pm-sg-tab-desc">Photo + gradient</span>
                    </button>
                    <button type="button" class="pm-sg-template-tab" data-template="quote">
                        <span class="pm-sg-tab-icon"><span class="dashicons dashicons-format-quote"></span></span>
                        <span class="pm-sg-tab-label">Quote</span>
                        <span class="pm-sg-tab-desc">Typographic 2026</span>
                    </button>
                </div>
            </div>

            <!-- ═══════════════ SECTION 3: PREVIEW CANVASES ═══════════════ -->
            <div id="pm-sg-previews-section" class="pm-sg-section" style="display:none;">
                <h2>4. Social Media Visuals</h2>
                <div class="pm-sg-previews">
                    <!-- Instagram -->
                    <div class="pm-sg-preview-card">
                        <div class="pm-sg-preview-header">
                            <span class="pm-sg-format-icon">&#9635;</span>
                            <h3>Instagram</h3>
                            <span class="pm-sg-format-size">1080 &times; 1350</span>
                        </div>
                        <div class="pm-sg-canvas-wrapper">
                            <canvas id="pm-sg-canvas-instagram" width="1080" height="1350"></canvas>
                        </div>
                        <div class="pm-sg-preview-actions">
                            <button class="pm-sg-btn pm-sg-btn-download pm-sg-download" data-format="instagram">
                                <span class="dashicons dashicons-download"></span> With Text
                            </button>
                            <button class="pm-sg-btn pm-sg-btn-outline pm-sg-download-clean" data-format="instagram">
                                <span class="dashicons dashicons-download"></span> Without Text
                            </button>
                        </div>
                    </div>

                    <!-- TikTok -->
                    <div class="pm-sg-preview-card">
                        <div class="pm-sg-preview-header">
                            <span class="pm-sg-format-icon">&#9654;</span>
                            <h3>TikTok</h3>
                            <span class="pm-sg-format-size">1080 &times; 1920</span>
                        </div>
                        <div class="pm-sg-canvas-wrapper">
                            <canvas id="pm-sg-canvas-tiktok" width="1080" height="1920"></canvas>
                        </div>
                        <div class="pm-sg-preview-actions">
                            <button class="pm-sg-btn pm-sg-btn-download pm-sg-download" data-format="tiktok">
                                <span class="dashicons dashicons-download"></span> With Text
                            </button>
                            <button class="pm-sg-btn pm-sg-btn-outline pm-sg-download-clean" data-format="tiktok">
                                <span class="dashicons dashicons-download"></span> Without Text
                            </button>
                        </div>
                    </div>

                    <!-- Pinterest -->
                    <div class="pm-sg-preview-card">
                        <div class="pm-sg-preview-header">
                            <span class="pm-sg-format-icon">&#128204;</span>
                            <h3>Pinterest</h3>
                            <span class="pm-sg-format-size">1000 &times; 1500</span>
                        </div>
                        <div class="pm-sg-canvas-wrapper">
                            <canvas id="pm-sg-canvas-pinterest" width="1000" height="1500"></canvas>
                        </div>
                        <div class="pm-sg-preview-actions">
                            <button class="pm-sg-btn pm-sg-btn-download pm-sg-download" data-format="pinterest">
                                <span class="dashicons dashicons-download"></span> With Text
                            </button>
                            <button class="pm-sg-btn pm-sg-btn-outline pm-sg-download-clean" data-format="pinterest">
                                <span class="dashicons dashicons-download"></span> Without Text
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ═══════════════ SECTION 4: SCRIPTS ═══════════════ -->
            <div id="pm-sg-scripts-section" class="pm-sg-section" style="display:none;">
                <h2>5. Scripts & Captions</h2>
                <div class="pm-sg-scripts-grid">
                    <!-- Voice-over -->
                    <div class="pm-sg-script-card">
                        <div class="pm-sg-script-header">
                            <span class="dashicons dashicons-microphone"></span>
                            <h3>Voice-Over Script</h3>
                            <span class="pm-sg-script-tag">Reels / TikTok</span>
                        </div>
                        <textarea id="pm-sg-voiceover" readonly rows="6"></textarea>
                        <button class="pm-sg-btn pm-sg-btn-copy pm-sg-copy" data-target="pm-sg-voiceover">
                            <span class="dashicons dashicons-clipboard"></span> Copy
                        </button>
                    </div>

                    <!-- Video script -->
                    <div class="pm-sg-script-card">
                        <div class="pm-sg-script-header">
                            <span class="dashicons dashicons-video-alt3"></span>
                            <h3>Video Script</h3>
                            <span class="pm-sg-script-tag">YouTube / Reels</span>
                        </div>
                        <textarea id="pm-sg-video-script" readonly rows="6"></textarea>
                        <button class="pm-sg-btn pm-sg-btn-copy pm-sg-copy" data-target="pm-sg-video-script">
                            <span class="dashicons dashicons-clipboard"></span> Copy
                        </button>
                    </div>

                    <!-- Hashtags -->
                    <div class="pm-sg-script-card">
                        <div class="pm-sg-script-header">
                            <span class="dashicons dashicons-tag"></span>
                            <h3>Hashtags</h3>
                            <span class="pm-sg-script-tag">Auto-generated</span>
                        </div>
                        <textarea id="pm-sg-hashtags" readonly rows="4"></textarea>
                        <button class="pm-sg-btn pm-sg-btn-copy pm-sg-copy" data-target="pm-sg-hashtags">
                            <span class="dashicons dashicons-clipboard"></span> Copy
                        </button>
                    </div>
                </div>

                <!-- Captions per network -->
                <h3 class="pm-sg-captions-title">Ready-to-Post Captions</h3>
                <div class="pm-sg-scripts-grid">
                    <div class="pm-sg-script-card">
                        <div class="pm-sg-script-header">
                            <span class="pm-sg-format-icon">&#9635;</span>
                            <h3>Caption Instagram</h3>
                        </div>
                        <textarea id="pm-sg-caption-instagram" readonly rows="5"></textarea>
                        <button class="pm-sg-btn pm-sg-btn-copy pm-sg-copy" data-target="pm-sg-caption-instagram">
                            <span class="dashicons dashicons-clipboard"></span> Copy
                        </button>
                    </div>
                    <div class="pm-sg-script-card">
                        <div class="pm-sg-script-header">
                            <span class="pm-sg-format-icon">&#9654;</span>
                            <h3>Caption TikTok</h3>
                        </div>
                        <textarea id="pm-sg-caption-tiktok" readonly rows="5"></textarea>
                        <button class="pm-sg-btn pm-sg-btn-copy pm-sg-copy" data-target="pm-sg-caption-tiktok">
                            <span class="dashicons dashicons-clipboard"></span> Copy
                        </button>
                    </div>
                    <div class="pm-sg-script-card">
                        <div class="pm-sg-script-header">
                            <span class="pm-sg-format-icon">&#128204;</span>
                            <h3>Caption Pinterest</h3>
                        </div>
                        <textarea id="pm-sg-caption-pinterest" readonly rows="5"></textarea>
                        <button class="pm-sg-btn pm-sg-btn-copy pm-sg-copy" data-target="pm-sg-caption-pinterest">
                            <span class="dashicons dashicons-clipboard"></span> Copy
                        </button>
                    </div>
                </div>
            </div>

            <!-- ═══════════════ SECTION 6: SOCIAL MEDIA VIDEOS ═══════════════ -->
            <div id="pm-sg-video-section" class="pm-sg-section" style="display:none;">
                <h2>6. Social Media Videos</h2>
                <p class="pm-sg-hint">Auto-generated animated multi-slide videos. Preview then download as WebM.</p>

                <div class="pm-sg-video-layout">
                    <!-- Video preview -->
                    <div class="pm-sg-video-preview">
                        <div class="pm-sg-video-canvas-wrapper">
                            <canvas id="pm-sg-video-canvas" width="1080" height="1920"></canvas>
                        </div>
                        <div class="pm-sg-video-progress-bar">
                            <div id="pm-sg-video-progress" class="pm-sg-video-progress-fill"></div>
                        </div>
                        <div class="pm-sg-video-time">
                            <span id="pm-sg-video-current-time">0:00</span> / <span id="pm-sg-video-total-time">0:00</span>
                        </div>
                    </div>

                    <!-- Video controls -->
                    <div class="pm-sg-video-controls">
                        <h3>Controls</h3>

                        <div class="pm-sg-video-slides-info">
                            <span class="pm-sg-video-slides-count">
                                <span id="pm-sg-video-slide-count">0</span> slides
                            </span>
                            <span class="pm-sg-video-duration-info">
                                Duration: <strong id="pm-sg-video-duration-display">0s</strong>
                            </span>
                        </div>

                        <!-- Background mode selector -->
                        <div class="pm-sg-video-option" id="pm-sg-video-bg-mode-wrap" style="display:none;">
                            <label for="pm-sg-video-bg-mode">Background</label>
                            <select id="pm-sg-video-bg-mode">
                                <option value="image">Image Only</option>
                                <option value="video">Video Only</option>
                                <option value="both">Image + Video</option>
                            </select>
                        </div>

                        <div class="pm-sg-video-btns">
                            <button type="button" id="pm-sg-video-preview-btn" class="pm-sg-btn pm-sg-btn-gold" disabled>
                                <span class="dashicons dashicons-controls-play"></span> Preview
                            </button>
                            <button type="button" id="pm-sg-video-stop-btn" class="pm-sg-btn pm-sg-btn-outline" style="display:none;">
                                <span class="dashicons dashicons-controls-pause"></span> Stop
                            </button>
                        </div>

                        <hr class="pm-sg-video-sep">

                        <div class="pm-sg-video-btns">
                            <button type="button" id="pm-sg-video-download-tiktok" class="pm-sg-btn pm-sg-btn-download" disabled>
                                <span class="dashicons dashicons-download"></span> TikTok (WebM)
                            </button>
                            <button type="button" id="pm-sg-video-download-reels" class="pm-sg-btn pm-sg-btn-download" disabled>
                                <span class="dashicons dashicons-download"></span> Reels (WebM)
                            </button>
                        </div>

                        <div id="pm-sg-video-recording-status" class="pm-sg-video-status" style="display:none;">
                            <span class="pm-sg-video-rec-dot"></span>
                            Recording in progress...
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <?php
    }

    // ═══════════════════════════════════════════════════════════
    //  AJAX: Search posts
    // ═══════════════════════════════════════════════════════════

    public function ajax_search_posts() {
        check_ajax_referer('pm_social_generator', 'nonce');

        $post_type = sanitize_text_field($_POST['post_type'] ?? 'post');
        $search    = sanitize_text_field($_POST['search'] ?? '');

        if (strlen($search) < 2) {
            wp_send_json_success(array());
        }

        $args = array(
            'post_type'      => $post_type,
            'post_status'    => 'publish',
            's'              => $search,
            'posts_per_page' => 10,
            'orderby'        => 'date',
            'order'          => 'DESC',
        );

        $query = new WP_Query($args);
        $results = array();

        foreach ($query->posts as $p) {
            $thumb = get_the_post_thumbnail_url($p->ID, 'thumbnail');
            $results[] = array(
                'id'        => $p->ID,
                'title'     => $p->post_title,
                'date'      => get_the_date('d/m/Y', $p->ID),
                'thumbnail' => $thumb ? $thumb : '',
            );
        }

        wp_send_json_success($results);
    }

    // ═══════════════════════════════════════════════════════════
    //  AJAX: Full post data
    // ═══════════════════════════════════════════════════════════

    public function ajax_get_post_data() {
        check_ajax_referer('pm_social_generator', 'nonce');

        $post_id   = intval($_POST['post_id'] ?? 0);
        $post_type = sanitize_text_field($_POST['post_type'] ?? 'post');

        if (!$post_id) {
            wp_send_json_error('Missing ID');
        }

        $post = get_post($post_id);
        if (!$post || $post->post_type !== $post_type) {
            wp_send_json_error('Post not found');
        }

        // Saved social generator settings
        $saved_settings = get_post_meta($post_id, '_pm_sg_settings', true);
        if (!is_array($saved_settings)) {
            $saved_settings = array();
        }

        // Source image (full size for HD)
        $featured_url = get_the_post_thumbnail_url($post_id, 'full');
        if (!$featured_url && $post_type === 'pm_lesson') {
            // Check saved settings first, then fallback
            if (!empty($saved_settings['image_url'])) {
                $featured_url = $saved_settings['image_url'];
            } else {
                $featured_url = $this->get_fallback_image_for_lesson();
            }
        }
        if (!$featured_url) {
            $featured_url = '';
        }

        // Clean excerpt
        $excerpt = $post->post_excerpt;
        if (empty($excerpt)) {
            $excerpt = wp_trim_words(strip_tags($post->post_content), 30, '...');
        }

        // Plain text content (for scripts)
        $content_text = wp_trim_words(strip_tags($post->post_content), 150, '...');

        // Categories and tags
        $categories = array();
        $tags = array();

        if ($post_type === 'post') {
            $cats = get_the_category($post_id);
            foreach ($cats as $cat) {
                $categories[] = html_entity_decode($cat->name, ENT_QUOTES, 'UTF-8');
            }
            $post_tags = get_the_tags($post_id);
            if ($post_tags) {
                foreach ($post_tags as $tag) {
                    $tags[] = html_entity_decode($tag->name, ENT_QUOTES, 'UTF-8');
                }
            }
        } elseif ($post_type === 'score') {
            $score_levels = wp_get_post_terms($post_id, 'score_level');
            $score_styles = wp_get_post_terms($post_id, 'score_style');
            $score_composers = wp_get_post_terms($post_id, 'score_composer');
            foreach ($score_levels as $t) $tags[] = html_entity_decode($t->name, ENT_QUOTES, 'UTF-8');
            foreach ($score_styles as $t) $categories[] = html_entity_decode($t->name, ENT_QUOTES, 'UTF-8');
            foreach ($score_composers as $t) $tags[] = html_entity_decode($t->name, ENT_QUOTES, 'UTF-8');
        } elseif ($post_type === 'pm_lesson') {
            $lesson_levels = wp_get_post_terms($post_id, 'pm_level');
            $lesson_modules = wp_get_post_terms($post_id, 'pm_module');
            $lesson_tags = wp_get_post_terms($post_id, 'pm_lesson_tag');
            foreach ($lesson_levels as $t) $categories[] = html_entity_decode($t->name, ENT_QUOTES, 'UTF-8');
            foreach ($lesson_modules as $t) $categories[] = html_entity_decode($t->name, ENT_QUOTES, 'UTF-8');
            foreach ($lesson_tags as $t) $tags[] = html_entity_decode($t->name, ENT_QUOTES, 'UTF-8');
        }

        // Slug for the downloaded file name
        $slug = $post->post_name;

        // Smart description (replaces bland excerpt)
        $smart_desc = $this->generate_smart_description($post_id, $post_type, $post);

        // H2 headings for video slides
        $h2_headings = $this->extract_h2_headings($post->post_content);

        // Extract content images
        $content_images_ctx = $this->extract_images_with_context($post->post_content, $featured_url);

        // Publish status
        $publish_status = get_post_meta($post_id, '_pm_sg_publish_status', true);
        if (!is_array($publish_status)) {
            $publish_status = array();
        }

        wp_send_json_success(array(
            'id'                 => $post_id,
            'title'              => html_entity_decode($post->post_title, ENT_QUOTES, 'UTF-8'),
            'slug'               => $slug,
            'excerpt'            => html_entity_decode($excerpt, ENT_QUOTES, 'UTF-8'),
            'smart_description'  => html_entity_decode($smart_desc, ENT_QUOTES, 'UTF-8'),
            'h2_headings'        => $h2_headings,
            'content_text'       => html_entity_decode($content_text, ENT_QUOTES, 'UTF-8'),
            'featured_image_url' => $featured_url,
            'categories'         => $categories,
            'tags'               => $tags,
            'post_type'          => $post_type,
            'content_images'     => array_column(array_slice($content_images_ctx, 0, 6), 'url'),
            'content_images_ctx' => array_slice($content_images_ctx, 0, 6),
            'publish_status'     => $publish_status,
            'saved_settings'     => $saved_settings,
        ));
    }

    // ═══════════════════════════════════════════════════════════
    //  AJAX: Save publish status
    // ═══════════════════════════════════════════════════════════

    public function ajax_save_publish_status() {
        check_ajax_referer('pm_social_generator', 'nonce');

        $post_id  = intval($_POST['post_id'] ?? 0);
        $platform = sanitize_text_field($_POST['platform'] ?? '');
        $checked  = ($_POST['checked'] ?? '0') === '1';

        $allowed = array('youtube', 'tiktok', 'instagram', 'facebook', 'pinterest');
        if (!$post_id || !in_array($platform, $allowed, true)) {
            wp_send_json_error('Invalid data');
        }

        $status = get_post_meta($post_id, '_pm_sg_publish_status', true);
        if (!is_array($status)) {
            $status = array();
        }

        if ($checked) {
            $status[$platform] = current_time('mysql');
        } else {
            unset($status[$platform]);
        }

        update_post_meta($post_id, '_pm_sg_publish_status', $status);
        wp_send_json_success($status);
    }

    // ═══════════════════════════════════════════════════════════
    //  AJAX: Save social generator settings per post
    // ═══════════════════════════════════════════════════════════

    public function ajax_save_social_settings() {
        check_ajax_referer('pm_social_generator', 'nonce');

        $post_id = intval($_POST['post_id'] ?? 0);
        if (!$post_id) {
            wp_send_json_error('Missing ID');
        }

        $settings = array(
            'title'        => sanitize_text_field($_POST['title'] ?? ''),
            'description'  => sanitize_textarea_field($_POST['description'] ?? ''),
            'description2' => sanitize_textarea_field($_POST['description2'] ?? ''),
            'focusX'       => floatval($_POST['focusX'] ?? 0.5),
            'focusY'       => floatval($_POST['focusY'] ?? 0.5),
            'image_url'    => esc_url_raw($_POST['image_url'] ?? ''),
            'template'     => sanitize_text_field($_POST['template'] ?? 'classic'),
        );

        // Save lesson extra images if provided
        if (isset($_POST['lesson_extra_images'])) {
            $extra = json_decode(stripslashes($_POST['lesson_extra_images']), true);
            if (is_array($extra)) {
                $settings['lesson_extra_images'] = array_slice(array_map('esc_url_raw', $extra), 0, 2);
            }
        }

        update_post_meta($post_id, '_pm_sg_settings', $settings);
        wp_send_json_success($settings);
    }

    public function ajax_switch_lesson_image() {
        check_ajax_referer('pm_social_generator', 'nonce');

        $post_id = intval($_POST['post_id'] ?? 0);
        $exclude = sanitize_text_field($_POST['exclude_url'] ?? '');

        $related_args = array(
            'post_type'      => 'post',
            'post_status'    => 'publish',
            'posts_per_page' => 20,
            'orderby'        => 'rand',
            'meta_query'     => array(
                array('key' => '_thumbnail_id', 'compare' => 'EXISTS'),
            ),
            'tax_query'      => array(
                'relation' => 'OR',
                array(
                    'taxonomy' => 'category',
                    'field'    => 'slug',
                    'terms'    => array('piano-inspiration-stories', 'piano-legends-stories'),
                    'include_children' => true,
                ),
                array(
                    'taxonomy' => 'category',
                    'field'    => 'slug',
                    'terms'    => array('piano-learning-tutorial', 'piano-learning-tutorials'),
                    'include_children' => true,
                ),
            ),
        );

        $related = new WP_Query($related_args);
        $images = array();
        foreach ($related->posts as $rp) {
            $rp_img = get_the_post_thumbnail_url($rp->ID, 'full');
            if ($rp_img && $rp_img !== $exclude) {
                $images[] = $rp_img;
            }
        }
        wp_reset_postdata();

        if (empty($images)) {
            wp_send_json_error('No images found');
        }

        wp_send_json_success(array('image_url' => $images[0]));
    }

    // ═══════════════════════════════════════════════════════════
    //  AJAX: Generate scripts + hashtags + captions
    // ═══════════════════════════════════════════════════════════

    public function ajax_generate_scripts() {
        check_ajax_referer('pm_social_generator', 'nonce');

        $post_id   = intval($_POST['post_id'] ?? 0);
        $post_type = sanitize_text_field($_POST['post_type'] ?? 'post');

        if (!$post_id) {
            wp_send_json_error('Missing ID');
        }

        $post = get_post($post_id);
        if (!$post) {
            wp_send_json_error('Post not found');
        }

        $title = $post->post_title;
        $title = html_entity_decode($title, ENT_QUOTES, 'UTF-8');
        $excerpt = $post->post_excerpt;
        if (empty($excerpt)) {
            $excerpt = wp_trim_words(strip_tags($post->post_content), 25, '...');
        }
        $excerpt = html_entity_decode($excerpt, ENT_QUOTES, 'UTF-8');

        // Plain text content, key sentences
        $content_clean = strip_tags($post->post_content);
        $sentences = preg_split('/[.!?]+/', $content_clean, -1, PREG_SPLIT_NO_EMPTY);
        $sentences = array_map('trim', $sentences);
        $sentences = array_filter($sentences, function($s) { return mb_strlen($s) > 15; });
        $sentences = array_values($sentences);
        $key_points = array_slice($sentences, 0, 4);

        // Tags and categories for hashtags
        $all_tags = array();
        $all_cats = array();

        if ($post_type === 'post') {
            $cats = get_the_category($post_id);
            foreach ($cats as $cat) $all_cats[] = strtolower($cat->name);
            $post_tags = get_the_tags($post_id);
            if ($post_tags) {
                foreach ($post_tags as $tag) $all_tags[] = strtolower($tag->name);
            }
        } elseif ($post_type === 'score') {
            $terms = wp_get_post_terms($post_id, 'score_style');
            foreach ($terms as $t) $all_cats[] = strtolower($t->name);
            $terms = wp_get_post_terms($post_id, 'score_composer');
            foreach ($terms as $t) $all_tags[] = strtolower($t->name);
            $terms = wp_get_post_terms($post_id, 'score_level');
            foreach ($terms as $t) $all_tags[] = strtolower($t->name);
        } elseif ($post_type === 'pm_lesson') {
            $terms = wp_get_post_terms($post_id, 'pm_level');
            foreach ($terms as $t) $all_cats[] = strtolower($t->name);
            $terms = wp_get_post_terms($post_id, 'pm_lesson_tag');
            foreach ($terms as $t) $all_tags[] = strtolower($t->name);
        }

        // ─── Voice-over (15-30 sec) ───
        $voiceover = $this->generate_voiceover($title, $excerpt, $post_type, $all_cats, $all_tags);

        // ─── Video script ───
        $video_script = $this->generate_video_script($title, $excerpt, $key_points, $post_type);

        // ─── Auto-generated hashtags ───
        $hashtags = $this->generate_hashtags($post_type, $all_cats, $all_tags);

        // ─── Captions per network ───
        $captions = $this->generate_captions($title, $excerpt, $hashtags, $post_type);

        wp_send_json_success(array(
            'voiceover'         => $voiceover,
            'video_script'      => $video_script,
            'hashtags'          => $hashtags,
            'caption_instagram' => $captions['instagram'],
            'caption_tiktok'    => $captions['tiktok'],
            'caption_pinterest' => $captions['pinterest'],
        ));
    }

    // ─── Voice-over generation ───

    private function generate_voiceover($title, $excerpt, $post_type, $cats, $tags) {
        $lines = array();

        if ($post_type === 'score') {
            $hooks = array(
                "Want to play \"{$title}\"? Here's how to get started.",
                "Looking for the perfect piano piece? Let me introduce you to \"{$title}\".",
                "\"{$title}\" — one of the most beautiful piano pieces you can learn right now.",
            );
            $lines[] = $hooks[array_rand($hooks)];
            if (!empty($excerpt)) {
                $lines[] = wp_trim_words($excerpt, 20, '...');
            }
            $level_str = !empty($cats) ? implode(', ', $cats) : '';
            if ($level_str) {
                $lines[] = "This piece is rated {$level_str} level.";
            }
            $lines[] = "You can download the full sheet music for free on PianoMode.com.";
            $lines[] = "Listen to the piece, explore the composer's story, and start learning today.";
            $lines[] = "Link in bio to get your free copy!";
        } elseif ($post_type === 'pm_lesson') {
            $hooks = array(
                "Ready to take your piano skills to the next level?",
                "Here's a lesson that will transform the way you play.",
                "Stop struggling with piano — this lesson makes it easy.",
            );
            $lines[] = $hooks[array_rand($hooks)];
            if (!empty($excerpt)) {
                $lines[] = wp_trim_words($excerpt, 20, '...');
            }
            $lines[] = "This interactive lesson includes a virtual piano, ear training exercises, and real-time feedback.";
            $lines[] = "Practice at your own pace, track your progress, and earn XP along the way.";
            $lines[] = "It's completely free on PianoMode.com — link in bio!";
        } else {
            $hooks = array(
                "If you love piano, you need to read this.",
                "Here's something every pianist should know about \"{$title}\".",
                "\"{$title}\" — this article changed the way I think about piano.",
            );
            $lines[] = $hooks[array_rand($hooks)];
            if (!empty($excerpt)) {
                $lines[] = wp_trim_words($excerpt, 25, '...');
            }
            $lines[] = "We break it all down for you — from technique to inspiration.";
            $lines[] = "Read the full article on PianoMode.com — link in bio!";
        }

        return implode("\n", $lines);
    }

    // ─── Video script generation ───

    private function generate_video_script($title, $excerpt, $key_points, $post_type) {
        $script = array();

        if ($post_type === 'score') {
            $script[] = "[INTRO - 3s]";
            $script[] = "Visual: Sheet music cover with title reveal";
            $script[] = "Hook: \"" . $title . "\" — free sheet music on PianoMode";
            $script[] = "";
            $script[] = "[CONTEXT - 5s]";
            if (!empty($excerpt)) {
                $script[] = "Narration: " . wp_trim_words($excerpt, 25, '...');
            }
            $script[] = "Visual: Composer portrait or related artwork";
            $script[] = "";
            $script[] = "[DIFFICULTY BREAKDOWN - 7s]";
            $script[] = "Visual: Animated difficulty bars (sight-reading, left hand, rhythm, dynamics)";
            $script[] = "Narration: Walk through the difficulty level and what makes this piece special";
            $script[] = "";
            $script[] = "[WHAT YOU GET - 5s]";
            $script[] = "Visual: Bullet points sliding in";
            $script[] = "• Download the free sheet music";
            $script[] = "• Listen to a performance of the piece";
            $script[] = "• Discover the composer and their musical legacy";
            $script[] = "• Learn step-by-step how to play it";
            $script[] = "";
            $script[] = "[CTA - 5s]";
            $script[] = "Visual: PianoMode logo with gold glow";
            $script[] = "Narration: Get your free sheet music now on pianomode.com — link in bio!";
            $script[] = "";
            $script[] = "[MUSIC]";
            $script[] = "Suggestion: Performance recording of the piece, or soft classical piano";
        } elseif ($post_type === 'pm_lesson') {
            $script[] = "[INTRO - 3s]";
            $script[] = "Visual: Lesson title with level badge and XP reward";
            $script[] = "Hook: Master \"" . $title . "\" — free interactive piano lesson";
            $script[] = "";
            $script[] = "[LESSON OVERVIEW - 5s]";
            if (!empty($excerpt)) {
                $script[] = "Narration: " . wp_trim_words($excerpt, 25, '...');
            }
            $script[] = "Visual: Lesson objective quote with elegant typography";
            $script[] = "";
            $script[] = "[LESSON STRUCTURE - 7s]";
            $script[] = "Visual: Lesson sections sliding in one by one";
            if (!empty($key_points)) {
                foreach ($key_points as $i => $point) {
                    $script[] = "• " . wp_trim_words($point, 18, '...');
                }
            }
            $script[] = "";
            $script[] = "[INTERACTIVE FEATURES - 7s]";
            $script[] = "Visual: Feature cards with icons";
            $script[] = "• Virtual piano keyboard for practice";
            $script[] = "• Ear training exercises";
            $script[] = "• Interactive quizzes";
            $script[] = "• Progress tracking with XP rewards";
            $script[] = "• Sight-reading challenges";
            $script[] = "";
            $script[] = "[CTA - 5s]";
            $script[] = "Visual: PianoMode logo with gold pulse";
            $script[] = "Narration: Start learning now for free on pianomode.com — link in bio!";
            $script[] = "";
            $script[] = "[MUSIC]";
            $script[] = "Suggestion: Upbeat, motivational piano melody";
        } else {
            $script[] = "[INTRO - 3s]";
            $script[] = "Visual: Featured image with Ken Burns zoom, title word-by-word reveal";
            $script[] = "Hook: \"" . $title . "\" — a must-read for piano lovers";
            $script[] = "";
            $script[] = "[CONTEXT - 5s]";
            if (!empty($excerpt)) {
                $script[] = "Narration: " . wp_trim_words($excerpt, 30, '...');
            }
            $script[] = "Visual: Subtle background transition, subtitle fade-in";
            $script[] = "";
            $script[] = "[KEY POINTS - 10s]";
            $script[] = "Visual: Bullet points sliding in from left with gold accents";
            if (!empty($key_points)) {
                foreach ($key_points as $i => $point) {
                    $script[] = "• " . wp_trim_words($point, 20, '...');
                }
            }
            $script[] = "";
            $script[] = "[HIGHLIGHT QUOTE - 5s]";
            $script[] = "Visual: Typewriter effect with elegant serif font";
            $script[] = "Display: A key insight or memorable quote from the article";
            $script[] = "";
            $script[] = "[CTA - 5s]";
            $script[] = "Visual: PianoMode logo scale-in with gold rings";
            $script[] = "Narration: Read the full article on pianomode.com — link in bio!";
            $script[] = "";
            $script[] = "[MUSIC]";
            $script[] = "Suggestion: Atmospheric piano, matching the article mood";
        }

        return implode("\n", $script);
    }

    // ─── Hashtag generation ───

    private function generate_hashtags($post_type, $cats, $tags) {
        $selected = array();

        // Always include branding
        $selected = array_merge($selected, $this->hashtag_pools['brand']);

        // Piano pool (always relevant)
        $piano_pool = $this->hashtag_pools['piano'];
        shuffle($piano_pool);
        $selected = array_merge($selected, array_slice($piano_pool, 0, 4));

        // Music pool
        $music_pool = $this->hashtag_pools['music'];
        shuffle($music_pool);
        $selected = array_merge($selected, array_slice($music_pool, 0, 3));

        // Type-specific pool
        if ($post_type === 'score') {
            $score_pool = $this->hashtag_pools['score'];
            shuffle($score_pool);
            $selected = array_merge($selected, array_slice($score_pool, 0, 3));
        } elseif ($post_type === 'pm_lesson') {
            $learn_pool = $this->hashtag_pools['learning'];
            shuffle($learn_pool);
            $selected = array_merge($selected, array_slice($learn_pool, 0, 3));
        } else {
            // Articles: mix learning + score
            $mix = array_merge($this->hashtag_pools['learning'], $this->hashtag_pools['score']);
            shuffle($mix);
            $selected = array_merge($selected, array_slice($mix, 0, 3));
        }

        // Hashtags from the post's categories/tags
        foreach ($cats as $cat) {
            $h = '#' . preg_replace('/[^a-zA-Z0-9àâäéèêëïîôùûüÿæœ]/u', '', $cat);
            if (!in_array($h, $selected) && mb_strlen($h) > 2) {
                $selected[] = $h;
            }
        }
        foreach ($tags as $tag) {
            $h = '#' . preg_replace('/[^a-zA-Z0-9àâäéèêëïîôùûüÿæœ]/u', '', $tag);
            if (!in_array($h, $selected) && mb_strlen($h) > 2) {
                $selected[] = $h;
            }
        }

        // Max 25 hashtags (Instagram limit)
        $selected = array_unique($selected);
        $selected = array_slice($selected, 0, 25);

        return implode(' ', $selected);
    }

    // ─── Caption generation ───

    private function generate_captions($title, $excerpt, $hashtags, $post_type) {
        $short_excerpt = wp_trim_words($excerpt, 25, '...');

        // ── Instagram ──
        $ig_lines = array();
        if ($post_type === 'score') {
            $ig_hooks = array(
                "This piece deserves a spot in your repertoire.",
                "Looking for your next piano piece? We've got you covered.",
                "Free sheet music that's actually worth playing.",
            );
            $ig_lines[] = $ig_hooks[array_rand($ig_hooks)];
            $ig_lines[] = "";
            $ig_lines[] = "🎵 \"{$title}\"";
            $ig_lines[] = "";
            $ig_lines[] = $short_excerpt;
            $ig_lines[] = "";
            $ig_lines[] = "What you get:";
            $ig_lines[] = "✅ Free downloadable sheet music";
            $ig_lines[] = "✅ Audio preview of the piece";
            $ig_lines[] = "✅ Composer biography & context";
            $ig_lines[] = "✅ Difficulty rating & tips";
            $ig_lines[] = "";
            $ig_lines[] = "📥 Download free on pianomode.com (link in bio)";
        } elseif ($post_type === 'pm_lesson') {
            $ig_hooks = array(
                "Your piano journey starts here.",
                "This lesson will level up your playing — guaranteed.",
                "Stop watching tutorials. Start actually learning.",
            );
            $ig_lines[] = $ig_hooks[array_rand($ig_hooks)];
            $ig_lines[] = "";
            $ig_lines[] = "🎹 \"{$title}\"";
            $ig_lines[] = "";
            $ig_lines[] = $short_excerpt;
            $ig_lines[] = "";
            $ig_lines[] = "What's inside:";
            $ig_lines[] = "🎯 Step-by-step guided practice";
            $ig_lines[] = "🎹 Virtual piano keyboard";
            $ig_lines[] = "👂 Ear training exercises";
            $ig_lines[] = "📊 Progress tracking & XP rewards";
            $ig_lines[] = "✅ Interactive quizzes";
            $ig_lines[] = "";
            $ig_lines[] = "🆓 100% free on pianomode.com (link in bio)";
        } else {
            $ig_hooks = array(
                "Every pianist needs to read this.",
                "Here's something that might change how you practice.",
                "Piano wisdom you won't find anywhere else.",
            );
            $ig_lines[] = $ig_hooks[array_rand($ig_hooks)];
            $ig_lines[] = "";
            $ig_lines[] = "📖 \"{$title}\"";
            $ig_lines[] = "";
            $ig_lines[] = $short_excerpt;
            $ig_lines[] = "";
            $ig_lines[] = "Read the full article — pianomode.com (link in bio)";
        }
        $ig_lines[] = "";
        $ig_lines[] = "─────────────────";
        $ig_lines[] = $hashtags;
        $caption_ig = implode("\n", $ig_lines);

        // ── TikTok (short, punchy) ──
        $tk_lines = array();
        if ($post_type === 'score') {
            $tk_hooks = array(
                "Free sheet music you actually want to play 🎵",
                "POV: you find the perfect piano piece 🎹",
                "This piece hits different 🔥",
            );
            $tk_lines[] = $tk_hooks[array_rand($tk_hooks)];
            $tk_lines[] = "";
            $tk_lines[] = "\"{$title}\"";
            $tk_lines[] = "Free download on pianomode.com 📥";
            $tk_lines[] = "Link in bio!";
        } elseif ($post_type === 'pm_lesson') {
            $tk_hooks = array(
                "Learn this piano technique for free 🎹",
                "Piano lesson that actually works 🎯",
                "Stop doom-scrolling, start playing 🎵",
            );
            $tk_lines[] = $tk_hooks[array_rand($tk_hooks)];
            $tk_lines[] = "";
            $tk_lines[] = "\"{$title}\"";
            $tk_lines[] = "Interactive lesson + virtual piano 🎹";
            $tk_lines[] = "Free on pianomode.com — link in bio!";
        } else {
            $tk_hooks = array(
                "Piano fact you didn't know 🎹",
                "Every pianist needs to see this 👀",
                "This changed my practice routine 🔥",
            );
            $tk_lines[] = $tk_hooks[array_rand($tk_hooks)];
            $tk_lines[] = "";
            $tk_lines[] = "\"{$title}\"";
            $tk_lines[] = "Full article: pianomode.com";
            $tk_lines[] = "Link in bio!";
        }
        $tk_lines[] = "";
        $hashtag_arr = explode(' ', $hashtags);
        $tk_lines[] = implode(' ', array_slice($hashtag_arr, 0, 5));
        $caption_tk = implode("\n", $tk_lines);

        // ── Pinterest (descriptive, SEO-friendly) ──
        $pn_lines = array();
        $pn_lines[] = $title;
        $pn_lines[] = "";
        $pn_lines[] = $short_excerpt;
        $pn_lines[] = "";
        if ($post_type === 'score') {
            $pn_lines[] = "Download this beautiful piano sheet music for free on PianoMode.com. Includes difficulty ratings, composer context, audio preview, and step-by-step learning tips. Sheet music for all levels — from beginner to concert pianist.";
        } elseif ($post_type === 'pm_lesson') {
            $pn_lines[] = "Learn piano online for free with this interactive lesson on PianoMode.com. Features a virtual piano keyboard, ear training exercises, sight-reading challenges, interactive quizzes, and progress tracking with XP rewards. Perfect for all skill levels.";
        } else {
            $pn_lines[] = "Discover this in-depth article on PianoMode.com — your free platform to learn piano, explore classical music, and find inspiration. Expert insights, practical tips, and curated resources for pianists of all levels.";
        }
        $pn_lines[] = "";
        $pn_lines[] = $hashtags;
        $caption_pn = implode("\n", $pn_lines);

        return array(
            'instagram' => $caption_ig,
            'tiktok'    => $caption_tk,
            'pinterest' => $caption_pn,
        );
    }

    // ═══════════════════════════════════════════════════════════
    //  SMART DESCRIPTIONS
    // ═══════════════════════════════════════════════════════════

    /**
     * Get a fallback image from related blog posts for lessons
     */
    private function get_fallback_image_for_lesson() {
        $related_args = array(
            'post_type'      => 'post',
            'post_status'    => 'publish',
            'posts_per_page' => 10,
            'orderby'        => 'rand',
            'meta_query'     => array(
                array(
                    'key'     => '_thumbnail_id',
                    'compare' => 'EXISTS',
                ),
            ),
            'tax_query'      => array(
                'relation' => 'OR',
                array(
                    'taxonomy' => 'category',
                    'field'    => 'slug',
                    'terms'    => array('piano-inspiration-stories', 'piano-legends-stories'),
                    'include_children' => true,
                ),
                array(
                    'taxonomy' => 'category',
                    'field'    => 'slug',
                    'terms'    => array('piano-learning-tutorial', 'piano-learning-tutorials'),
                    'include_children' => true,
                ),
            ),
        );
        $related = new WP_Query($related_args);
        $url = '';
        if ($related->have_posts()) {
            $url = get_the_post_thumbnail_url($related->posts[0]->ID, 'full');
        }
        wp_reset_postdata();
        return $url ?: '';
    }

    /**
     * Extract H2 headings from HTML content
     */
    private function extract_h2_headings($content) {
        $headings = array();
        if (preg_match_all('/<h2[^>]*>(.*?)<\/h2>/si', $content, $matches)) {
            foreach ($matches[1] as $h) {
                $clean = trim(strip_tags($h));
                if (!empty($clean)) {
                    $headings[] = $clean;
                }
            }
        }
        return $headings;
    }

    /**
     * Generates an engaging and relevant description for social media
     */
    private function generate_smart_description($post_id, $post_type, $post) {
        $title = $post->post_title;
        $content = $post->post_content;

        if ($post_type === 'post') {
            return $this->smart_desc_article($post_id, $title, $content);
        } elseif ($post_type === 'score') {
            return $this->smart_desc_score($post_id, $title);
        } elseif ($post_type === 'pm_lesson') {
            return $this->smart_desc_lesson($post_id, $title);
        }

        return wp_trim_words(strip_tags($content), 25, '...');
    }

    /**
     * Smart description for an article
     */
    private function smart_desc_article($post_id, $title, $content) {
        $h2s = $this->extract_h2_headings($content);
        $cats = get_the_category($post_id);
        $cat_name = !empty($cats) ? $cats[0]->name : 'Piano';

        // Detect article type by keywords
        $title_lower = mb_strtolower($title);
        $is_list = preg_match('/\b(top|meilleur|best|guide|liste|comparatif|classement)\b/i', $title_lower);
        $is_howto = preg_match('/\b(comment|how to|apprendre|tutoriel|méthode)\b/i', $title_lower);

        $parts = array();

        if ($is_list && count($h2s) >= 2) {
            $parts[] = "Our picks: " . $h2s[0] . ", " . $h2s[1];
            if (isset($h2s[2])) $parts[] = "and much more";
        } elseif ($is_howto && count($h2s) >= 1) {
            $parts[] = "Learn: " . $h2s[0];
            if (isset($h2s[1])) $parts[] = $h2s[1];
        } elseif (count($h2s) >= 2) {
            $parts[] = $h2s[0] . " — " . $h2s[1];
        } else {
            // Fallback: first punchy sentence from the content
            $clean = strip_tags($content);
            $first_sentence = preg_split('/[.!?]+/', $clean, 2, PREG_SPLIT_NO_EMPTY);
            if (!empty($first_sentence[0])) {
                $parts[] = trim($first_sentence[0]);
            }
        }

        $desc = implode('. ', $parts);
        // Truncate if too long (max 120 chars for readability)
        if (mb_strlen($desc) > 120) {
            $desc = mb_substr($desc, 0, 117) . '...';
        }

        return $desc;
    }

    /**
     * Smart description for a score
     */
    private function smart_desc_score($post_id, $title) {
        $parts = array();

        // Composer
        $composers = wp_get_post_terms($post_id, 'score_composer');
        if (!empty($composers) && !is_wp_error($composers)) {
            $parts[] = $composers[0]->name;
        }

        // Level
        $levels = wp_get_post_terms($post_id, 'score_level');
        if (!empty($levels) && !is_wp_error($levels)) {
            $parts[] = 'Level: ' . $levels[0]->name;
        }

        // Style
        $styles = wp_get_post_terms($post_id, 'score_style');
        if (!empty($styles) && !is_wp_error($styles)) {
            $style_names = array_map(function($s) { return $s->name; }, array_slice($styles, 0, 2));
            $parts[] = implode(' / ', $style_names);
        }

        // Difficulty radar
        $reading = get_post_meta($post_id, '_score_reading_ease', true);
        $left_hand = get_post_meta($post_id, '_score_left_hand', true);
        if ($reading || $left_hand) {
            $diff = array();
            if ($reading) $diff[] = "Sight-reading {$reading}/5";
            if ($left_hand) $diff[] = "Left hand {$left_hand}/5";
            $parts[] = implode(' | ', $diff);
        }

        $parts[] = "Free sheet music";

        return implode(' — ', $parts);
    }

    /**
     * Smart description for a lesson
     */
    private function smart_desc_lesson($post_id, $title) {
        $parts = array();

        // Level
        $levels = wp_get_post_terms($post_id, 'pm_level');
        if (!empty($levels) && !is_wp_error($levels)) {
            $parts[] = 'Level: ' . $levels[0]->name;
        }

        // Module
        $modules = wp_get_post_terms($post_id, 'pm_module');
        if (!empty($modules) && !is_wp_error($modules)) {
            $parts[] = $modules[0]->name;
        }

        // Duration
        $duration = get_post_meta($post_id, '_pm_lesson_duration', true);
        if ($duration) {
            $parts[] = $duration . ' min';
        }

        // XP
        $xp = get_post_meta($post_id, '_pm_lesson_xp', true);
        if ($xp) {
            $parts[] = '+' . $xp . ' XP';
        }

        // Quiz?
        $has_quiz = get_post_meta($post_id, '_pm_lesson_has_quiz', true);
        if ($has_quiz === '1') {
            $parts[] = 'Quiz included';
        }

        $parts[] = 'Free interactive lesson';

        return implode(' — ', $parts);
    }

    // ═══════════════════════════════════════════════════════════
    //  AJAX: Structured video slides
    // ═══════════════════════════════════════════════════════════

    public function ajax_get_video_slides() {
        check_ajax_referer('pm_social_generator', 'nonce');

        $post_id   = intval($_POST['post_id'] ?? 0);
        $post_type = sanitize_text_field($_POST['post_type'] ?? 'post');
        $second_description = sanitize_textarea_field($_POST['second_description'] ?? '');
        $custom_title = sanitize_text_field($_POST['custom_title'] ?? '');
        $custom_description = sanitize_textarea_field($_POST['custom_description'] ?? '');

        // Lesson extra images
        $lesson_extra_images = array();
        if (isset($_POST['lesson_extra_images'])) {
            $extra = json_decode(stripslashes($_POST['lesson_extra_images']), true);
            if (is_array($extra)) {
                $lesson_extra_images = array_map('esc_url_raw', $extra);
            }
        }

        // Slide edits from user
        $slide_edits = array();
        if (isset($_POST['slide_edits'])) {
            $decoded = json_decode(stripslashes($_POST['slide_edits']), true);
            if (is_array($decoded)) {
                $slide_edits = $decoded;
            }
        }

        // Handle custom type (no real post)
        if ($post_type === 'custom') {
            $slides = $this->build_custom_slides($custom_title, $custom_description, $second_description, $lesson_extra_images);

            $total_duration = 0;
            foreach ($slides as $s) {
                $total_duration += $s['duration'];
            }

            // Apply user edits
            foreach ($slide_edits as $idx => $edits) {
                $i = intval($idx);
                if (!isset($slides[$i])) continue;
                if (isset($edits['title']))    $slides[$i]['title'] = sanitize_text_field($edits['title']);
                if (isset($edits['subtitle'])) $slides[$i]['subtitle'] = sanitize_text_field($edits['subtitle']);
                if (isset($edits['text']))     $slides[$i]['text'] = sanitize_textarea_field($edits['text']);
                if (isset($edits['label']))    $slides[$i]['label'] = sanitize_text_field($edits['label']);
                if (isset($edits['items']) && is_array($edits['items'])) {
                    $slides[$i]['items'] = array_map('sanitize_text_field', $edits['items']);
                }
            }

            wp_send_json_success(array(
                'slides'     => $slides,
                'duration'   => $total_duration,
                'post_type'  => 'custom',
                'title'      => $custom_title,
                'image'      => '',
                'content_images'     => array(),
                'content_images_ctx' => array(),
            ));
            return;
        }

        if (!$post_id) {
            wp_send_json_error('Missing ID');
        }

        $post = get_post($post_id);
        if (!$post) {
            wp_send_json_error('Post not found');
        }

        // Override title if custom_title provided
        if ($custom_title) {
            $post->post_title = $custom_title;
        }

        $title = html_entity_decode($post->post_title, ENT_QUOTES, 'UTF-8');
        $featured_url = get_the_post_thumbnail_url($post_id, 'full') ?: '';

        // For lessons, use saved image if no featured
        if ($post_type === 'pm_lesson' && empty($featured_url)) {
            $saved = get_post_meta($post_id, '_pm_sg_settings', true);
            if (is_array($saved) && !empty($saved['image_url'])) {
                $featured_url = $saved['image_url'];
            } else {
                $featured_url = $this->get_fallback_image_for_lesson() ?: '';
            }
        }

        $content_images_ctx = $this->extract_images_with_context($post->post_content, $featured_url);
        $slides = array();

        if ($post_type === 'post') {
            $slides = $this->build_article_slides($post_id, $post, $featured_url, $second_description);
        } elseif ($post_type === 'score') {
            $slides = $this->build_score_slides($post_id, $post, $featured_url, $second_description);
        } elseif ($post_type === 'pm_lesson') {
            $slides = $this->build_lesson_slides($post_id, $post, $featured_url, $second_description, $lesson_extra_images);
        }

        // Apply user edits to slide text
        foreach ($slide_edits as $idx => $edits) {
            $i = intval($idx);
            if (!isset($slides[$i])) continue;
            if (isset($edits['title']))    $slides[$i]['title'] = sanitize_text_field($edits['title']);
            if (isset($edits['subtitle'])) $slides[$i]['subtitle'] = sanitize_text_field($edits['subtitle']);
            if (isset($edits['text']))     $slides[$i]['text'] = sanitize_textarea_field($edits['text']);
            if (isset($edits['label']))    $slides[$i]['label'] = sanitize_text_field($edits['label']);
            if (isset($edits['items']) && is_array($edits['items'])) {
                $slides[$i]['items'] = array_map('sanitize_text_field', $edits['items']);
            }
        }

        // Total duration
        $total_duration = 0;
        foreach ($slides as $s) {
            $total_duration += $s['duration'];
        }

        wp_send_json_success(array(
            'slides'     => $slides,
            'duration'   => $total_duration,
            'post_type'  => $post_type,
            'title'      => $title,
            'image'      => $featured_url,
            'content_images'     => array_column(array_slice($content_images_ctx, 0, 6), 'url'),
            'content_images_ctx' => array_slice($content_images_ctx, 0, 6),
        ));
    }

    /**
     * Slides for a blog article
     */
    private function build_article_slides($post_id, $post, $image, $second_description = '') {
        $title = html_entity_decode($post->post_title, ENT_QUOTES, 'UTF-8');
        $h2s = $this->extract_h2_headings($post->post_content);
        $h2s = array_map(function($h) { return html_entity_decode($h, ENT_QUOTES, 'UTF-8'); }, $h2s);
        $cats = get_the_category($post_id);
        $cat_name = !empty($cats) ? html_entity_decode($cats[0]->name, ENT_QUOTES, 'UTF-8') : 'Piano';

        // Extract a quote from content (longest sentence between 40-150 chars)
        $sentences = preg_split('/[.!?]+/', strip_tags($post->post_content), -1, PREG_SPLIT_NO_EMPTY);
        $sentences = array_map('trim', $sentences);
        $quote = '';
        foreach ($sentences as $s) {
            $len = mb_strlen($s);
            if ($len >= 40 && $len <= 150) {
                $quote = $s;
                break;
            }
        }
        if (empty($quote) && !empty($sentences[0])) {
            $quote = wp_trim_words($sentences[0], 20, '...');
        }
        $quote = html_entity_decode($quote, ENT_QUOTES, 'UTF-8');

        $slides = array();

        // Slide 1: Hook — image + title
        $slides[] = array(
            'type'     => 'hero',
            'duration' => 6,
            'image'    => $image,
            'title'    => $title,
            'subtitle' => $cat_name,
        );

        // Slide 2: Key points (H2)
        if (count($h2s) >= 2) {
            $slides[] = array(
                'type'     => 'bullets',
                'duration' => 7,
                'items'    => array_slice($h2s, 0, 4),
                'label'    => 'In This Article',
            );
        }

        // Image showcase slides with H2 context and captions
        $content_images_ctx = $this->extract_images_with_context($post->post_content, $image);
        if (count($content_images_ctx) >= 1) {
            $slides[] = array(
                'type'     => 'showcase',
                'duration' => 6,
                'images'   => array_slice($content_images_ctx, 0, 4),
                'label'    => 'Inside This Article',
            );
        }

        // Slide 3: Quote/highlight
        if (!empty($quote)) {
            $slides[] = array(
                'type'     => 'quote',
                'duration' => 6,
                'text'     => $quote,
            );
        }

        // Second description/quote slide (if provided by user)
        if (!empty($second_description)) {
            $slides[] = array(
                'type'     => 'quote',
                'duration' => 6,
                'text'     => html_entity_decode($second_description, ENT_QUOTES, 'UTF-8'),
            );
        }

        // Slide 4: CTA
        $slides[] = array(
            'type'     => 'cta',
            'duration' => 5,
            'text'     => 'Read the Full Article',
            'url'      => 'pianomode.com',
        );

        return $slides;
    }

    /**
     * Slides for a score
     */
    private function build_score_slides($post_id, $post, $image, $second_description = '') {
        $title = html_entity_decode($post->post_title, ENT_QUOTES, 'UTF-8');

        $composers = wp_get_post_terms($post_id, 'score_composer');
        $composer = !empty($composers) && !is_wp_error($composers) ? html_entity_decode($composers[0]->name, ENT_QUOTES, 'UTF-8') : '';

        $levels = wp_get_post_terms($post_id, 'score_level');
        $level = !empty($levels) && !is_wp_error($levels) ? html_entity_decode($levels[0]->name, ENT_QUOTES, 'UTF-8') : '';

        $styles = wp_get_post_terms($post_id, 'score_style');
        $style_names = array();
        if (!empty($styles) && !is_wp_error($styles)) {
            foreach (array_slice($styles, 0, 3) as $s) $style_names[] = html_entity_decode($s->name, ENT_QUOTES, 'UTF-8');
        }

        // Difficulties
        $reading   = get_post_meta($post_id, '_score_reading_ease', true) ?: 0;
        $left_hand = get_post_meta($post_id, '_score_left_hand', true) ?: 0;
        $rhythm    = get_post_meta($post_id, '_score_rhythm', true) ?: 0;
        $dynamics  = get_post_meta($post_id, '_score_dynamics', true) ?: 0;

        $slides = array();

        // Slide 1: Cover
        $slides[] = array(
            'type'     => 'hero',
            'duration' => 6,
            'image'    => $image,
            'title'    => $title,
            'subtitle' => $composer,
        );

        // Slide 2: Difficulty radar
        if ($reading || $left_hand || $rhythm || $dynamics) {
            $slides[] = array(
                'type'     => 'difficulty',
                'duration' => 7,
                'bars'     => array(
                    array('label' => 'Sight-reading', 'value' => intval($reading)),
                    array('label' => 'Left Hand', 'value' => intval($left_hand)),
                    array('label' => 'Rhythm', 'value' => intval($rhythm)),
                    array('label' => 'Dynamics', 'value' => intval($dynamics)),
                ),
            );
        }

        // Slide 3: Info
        $info_items = array();
        if ($level) $info_items[] = "Level: {$level}";
        if (!empty($style_names)) $info_items[] = "Style: " . implode(', ', $style_names);
        $info_items[] = "Free Download";

        $slides[] = array(
            'type'     => 'bullets',
            'duration' => 6,
            'items'    => $info_items,
            'label'    => 'Details',
        );

        // Second description/quote (if provided)
        if (!empty($second_description)) {
            $slides[] = array(
                'type'     => 'quote',
                'duration' => 6,
                'text'     => html_entity_decode($second_description, ENT_QUOTES, 'UTF-8'),
            );
        }

        // Gallery slide if article has images
        $content_images_ctx = $this->extract_images_with_context($post->post_content, $image);
        if (count($content_images_ctx) >= 1) {
            $slides[] = array(
                'type'     => 'showcase',
                'duration' => 5,
                'images'   => array_slice($content_images_ctx, 0, 4),
                'label'    => 'Preview',
            );
        }

        // Value proposition slide
        $slides[] = array(
            'type'     => 'bullets',
            'duration' => 6,
            'items'    => array(
                'Download the free sheet music',
                'Listen to the piece',
                'Discover the composer & his work',
                'Learn how to play it step by step',
            ),
            'label'    => 'What You Get',
        );

        // Slide 4: CTA
        $slides[] = array(
            'type'     => 'cta',
            'duration' => 5,
            'text'     => 'Get Your Free Sheet Music',
            'url'      => 'pianomode.com',
        );

        return $slides;
    }

    /**
     * Slides for a lesson
     */
    private function build_lesson_slides($post_id, $post, $image, $second_description = '', $extra_images = array()) {
        $title = html_entity_decode($post->post_title, ENT_QUOTES, 'UTF-8');

        $levels = wp_get_post_terms($post_id, 'pm_level');
        $level = !empty($levels) && !is_wp_error($levels) ? html_entity_decode($levels[0]->name, ENT_QUOTES, 'UTF-8') : '';

        $modules = wp_get_post_terms($post_id, 'pm_module');
        $module = !empty($modules) && !is_wp_error($modules) ? html_entity_decode($modules[0]->name, ENT_QUOTES, 'UTF-8') : '';

        $duration = get_post_meta($post_id, '_pm_lesson_duration', true) ?: '';
        $xp = get_post_meta($post_id, '_pm_lesson_xp', true) ?: '50';
        $difficulty = get_post_meta($post_id, '_pm_lesson_difficulty', true) ?: '';
        $has_quiz = get_post_meta($post_id, '_pm_lesson_has_quiz', true) === '1';
        $video_url = get_post_meta($post_id, '_pm_lesson_video', true) ?: '';

        // Extract lesson H2 sections as parts
        $h2s = $this->extract_h2_headings($post->post_content);
        $h2s = array_map(function($h) { return html_entity_decode($h, ENT_QUOTES, 'UTF-8'); }, $h2s);

        // First paragraph as lesson objective
        $content_clean = strip_tags($post->post_content);
        $first_para = '';
        $paras = preg_split('/\n{2,}/', $content_clean, 3, PREG_SPLIT_NO_EMPTY);
        if (!empty($paras[0])) {
            $first_para = wp_trim_words(trim($paras[0]), 25, '...');
        }

        // If lesson has no featured image, fetch from related blog posts
        $lesson_image = $image;
        $related_images = array();
        if (empty($lesson_image)) {
            $related_cats = array('piano-inspiration-stories', 'piano-learning-tutorial');
            $related_args = array(
                'post_type'      => 'post',
                'post_status'    => 'publish',
                'posts_per_page' => 5,
                'orderby'        => 'rand',
                'tax_query'      => array(
                    array(
                        'taxonomy' => 'category',
                        'field'    => 'slug',
                        'terms'    => $related_cats,
                        'include_children' => true,
                    ),
                ),
            );
            $related = new WP_Query($related_args);
            foreach ($related->posts as $rp) {
                $rp_img = get_the_post_thumbnail_url($rp->ID, 'full');
                if ($rp_img) {
                    if (empty($lesson_image)) {
                        $lesson_image = $rp_img;
                    }
                    $related_images[] = $rp_img;
                }
            }
            wp_reset_postdata();
        }

        // Also get content images
        $content_images_ctx = $this->extract_images_with_context($post->post_content, $lesson_image);

        $slides = array();

        // Slide 1: HERO — Learning-style with level badge
        $subtitle_parts = array();
        if ($level) $subtitle_parts[] = $level;
        if ($module) $subtitle_parts[] = $module;
        if ($duration) $subtitle_parts[] = $duration . ' min';

        $slides[] = array(
            'type'     => 'hero',
            'duration' => 6,
            'image'    => $lesson_image,
            'title'    => $title,
            'subtitle' => implode('  •  ', $subtitle_parts),
        );

        // Slide 2: Lesson objective/quote
        if (!empty($first_para)) {
            $slides[] = array(
                'type'     => 'quote',
                'duration' => 6,
                'text'     => $first_para,
            );
        }

        // Second description/quote (if provided)
        if (!empty($second_description)) {
            $slides[] = array(
                'type'     => 'quote',
                'duration' => 6,
                'text'     => html_entity_decode($second_description, ENT_QUOTES, 'UTF-8'),
            );
        }

        // Slide 3: Lesson structure (H2 sections)
        if (count($h2s) >= 2) {
            $slides[] = array(
                'type'     => 'bullets',
                'duration' => 7,
                'items'    => array_slice($h2s, 0, 5),
                'label'    => 'Lesson Breakdown',
            );
        }

        // Slide 4: Interactive features promotion
        $features = array();
        $features[] = 'Step-by-step guided learning';
        if ($has_quiz) $features[] = 'Interactive quiz to test your skills';
        if ($video_url) $features[] = 'Video demonstration included';
        $features[] = 'Virtual piano keyboard';
        $features[] = 'Ear training exercises';
        if ($difficulty && intval($difficulty) >= 3) {
            $features[] = 'Sight-reading challenges';
        }
        $features[] = 'Track your progress & earn XP';

        $slides[] = array(
            'type'     => 'learning',
            'duration' => 7,
            'items'    => array_slice($features, 0, 5),
            'label'    => 'Interactive Features',
            'level'    => $level,
        );

        // Slide 5: Image showcase if available
        if (count($content_images_ctx) >= 1) {
            $slides[] = array(
                'type'     => 'showcase',
                'duration' => 5,
                'images'   => array_slice($content_images_ctx, 0, 4),
                'label'    => 'Preview',
            );
        } elseif (count($related_images) >= 2) {
            // Use related blog images
            $ri_ctx = array();
            foreach (array_slice($related_images, 0, 4) as $ri) {
                $ri_ctx[] = array(
                    'url'     => $ri,
                    'caption' => '',
                    'section' => 'Piano Inspiration',
                    'enabled' => true,
                    'mode'    => 'background',
                    'focusX'  => 0.5,
                    'focusY'  => 0.5,
                );
            }
            $slides[] = array(
                'type'     => 'showcase',
                'duration' => 5,
                'images'   => $ri_ctx,
                'label'    => 'From Our Blog',
            );
        }

        // Extra lesson images (user-selected)
        if (!empty($extra_images)) {
            foreach (array_slice($extra_images, 0, 2) as $ei_url) {
                $slides[] = array(
                    'type'     => 'showcase',
                    'duration' => 4,
                    'images'   => array(array(
                        'url' => $ei_url, 'caption' => '', 'section' => '',
                        'enabled' => true, 'mode' => 'background', 'focusX' => 0.5, 'focusY' => 0.5,
                    )),
                    'label'    => '',
                );
            }
        }

        // Slide: CTA
        $slides[] = array(
            'type'     => 'cta',
            'duration' => 5,
            'text'     => 'Start Learning Now',
            'url'      => 'pianomode.com',
        );

        return $slides;
    }

    /**
     * Build slides for a custom (non-post) type
     */
    private function build_custom_slides($title, $description, $second_description, $extra_images = array()) {
        $slides = array();

        // Hero slide
        $slides[] = array(
            'type'     => 'hero',
            'duration' => 6,
            'image'    => '',  // JS will use sourceImage
            'title'    => $title ?: 'PianoMode',
            'subtitle' => $description ?: '',
        );

        // Second description/quote
        if (!empty($second_description)) {
            $slides[] = array(
                'type'     => 'quote',
                'duration' => 6,
                'text'     => $second_description,
            );
        }

        // Extra images as showcase slides
        foreach (array_slice($extra_images, 0, 4) as $ei_url) {
            $slides[] = array(
                'type'     => 'showcase',
                'duration' => 4,
                'images'   => array(array(
                    'url' => $ei_url, 'caption' => '', 'section' => '',
                    'enabled' => true, 'mode' => 'background', 'focusX' => 0.5, 'focusY' => 0.5,
                )),
                'label'    => '',
            );
        }

        // CTA
        $slides[] = array(
            'type'     => 'cta',
            'duration' => 5,
            'text'     => 'Discover More',
            'url'      => 'pianomode.com',
        );

        return $slides;
    }

    /**
     * Extract image URLs from post content with H2 context and captions
     */
    private function extract_images_with_context($content, $exclude_featured = '') {
        $images = array();

        // Split content by H2 headings to track which section each image is in
        $sections = preg_split('/(<h2[^>]*>.*?<\/h2>)/si', $content, -1, PREG_SPLIT_DELIM_CAPTURE);
        $current_h2 = '';

        foreach ($sections as $section) {
            // Check if this chunk is an H2 heading
            if (preg_match('/<h2[^>]*>(.*?)<\/h2>/si', $section, $h2match)) {
                $current_h2 = html_entity_decode(trim(strip_tags($h2match[1])), ENT_QUOTES, 'UTF-8');
                continue;
            }

            // Find images in this section
            if (preg_match_all('/<img[^>]+src=["\']([^"\']+)["\'][^>]*>/i', $section, $matches, PREG_SET_ORDER)) {
                foreach ($matches as $m) {
                    $url = $m[0]; // full tag
                    $src = $m[1]; // src value

                    // Skip tiny images, icons, emojis
                    if (preg_match('/\b(icon|emoji|gravatar|avatar|logo)\b/i', $src)) continue;
                    // Skip the featured image if provided
                    if ($exclude_featured && strpos($src, pathinfo($exclude_featured, PATHINFO_FILENAME)) !== false) continue;
                    // Only keep actual content images
                    if (!preg_match('/\.(jpe?g|png|webp)/i', $src)) continue;

                    // Extract alt text as caption
                    $alt = '';
                    if (preg_match('/alt=["\']([^"\']*)["\']/', $url, $alt_match)) {
                        $alt = html_entity_decode(trim($alt_match[1]), ENT_QUOTES, 'UTF-8');
                    }

                    // Extract caption from <figcaption> if image is in a <figure>
                    $caption = $alt;
                    if (preg_match('/<figure[^>]*>.*?' . preg_quote($src, '/') . '.*?<figcaption[^>]*>(.*?)<\/figcaption>/si', $section, $fig_match)) {
                        $caption = html_entity_decode(trim(strip_tags($fig_match[1])), ENT_QUOTES, 'UTF-8');
                    }

                    $images[] = array(
                        'url'     => $src,
                        'caption' => $caption,
                        'section' => $current_h2,
                        'enabled' => true,
                        'mode'    => 'background', // 'background' or 'caption'
                        'focusX'  => 0.5,
                        'focusY'  => 0.5,
                    );
                }
            }
        }

        // Deduplicate by URL
        $seen = array();
        $unique = array();
        foreach ($images as $img) {
            if (!in_array($img['url'], $seen)) {
                $seen[] = $img['url'];
                $unique[] = $img;
            }
        }

        return $unique;
    }

    /**
     * Simple image URL extraction (backward compat)
     */
    private function extract_content_images($content, $exclude_featured = '') {
        $images_ctx = $this->extract_images_with_context($content, $exclude_featured);
        return array_map(function($img) { return $img['url']; }, $images_ctx);
    }
}

// Initialization
PianoMode_Social_Generator::get_instance();