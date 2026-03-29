<?php
/**
 * PianoMode LMS Access Control System v1.0
 *
 * Centralized lock/unlock logic for modules and lessons.
 * - Admin (manage_options) sees everything unlocked
 * - Beginner level / 1st module always open for all
 * - Other modules: locked with type 'account' or 'paid'
 * - noindex for non-admin users (pre-launch)
 * - Rate limiting for AJAX endpoints
 * - Security hardening
 */

if (!defined('ABSPATH')) exit;

class PianoMode_Access_Control {

    private static $instance = null;

    public static function get_instance() {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        // Admin UI: lock type meta boxes for modules
        add_action('pm_module_add_form_fields', [$this, 'module_add_lock_fields']);
        add_action('pm_module_edit_form_fields', [$this, 'module_edit_lock_fields']);
        add_action('created_pm_module', [$this, 'save_module_lock_fields']);
        add_action('edited_pm_module', [$this, 'save_module_lock_fields']);

        // Admin columns for modules
        add_filter('manage_edit-pm_module_columns', [$this, 'module_admin_columns']);
        add_filter('manage_pm_module_custom_column', [$this, 'module_admin_column_content'], 10, 3);

        // Admin columns for lessons
        add_filter('manage_pm_lesson_posts_columns', [$this, 'lesson_admin_columns']);
        add_action('manage_pm_lesson_posts_custom_column', [$this, 'lesson_admin_column_content'], 10, 2);

        // Quick edit for lesson lock type
        add_action('add_meta_boxes', [$this, 'add_lesson_lock_metabox']);
        add_action('save_post_pm_lesson', [$this, 'save_lesson_lock_meta'], 15);

        // SEO: noindex for non-admin
        add_action('wp_head', [$this, 'noindex_for_non_admin'], 0);

        // Security: rate limiting
        add_action('wp_ajax_pm_submit_challenge', [$this, 'rate_limit_check'], 1);
        add_action('wp_ajax_pm_refill_hearts', [$this, 'rate_limit_check'], 1);
        add_action('wp_ajax_pm_complete_lesson', [$this, 'rate_limit_check'], 1);

        // Security: nonce refresh endpoint
        add_action('wp_ajax_pm_refresh_nonce', [$this, 'ajax_refresh_nonce']);
        add_action('wp_ajax_nopriv_pm_refresh_nonce', [$this, 'ajax_refresh_nonce']);

        // Admin CSS
        add_action('admin_head', [$this, 'admin_css']);
    }

    // ==========================================
    // ACCESS CHECK FUNCTIONS
    // ==========================================

    /**
     * Check if current user is admin (manage_options capability)
     */
    public static function is_admin_user() {
        return current_user_can('manage_options');
    }

    /**
     * Check if a module is accessible to the current user
     *
     * @param int    $module_term_id Module term ID
     * @param string $level_slug     Level slug context
     * @return array ['accessible' => bool, 'lock_type' => string, 'reason' => string]
     */
    public static function check_module_access($module_term_id, $level_slug = 'beginner') {
        // Admin always has access
        if (self::is_admin_user()) {
            return ['accessible' => true, 'lock_type' => 'none', 'reason' => 'admin'];
        }

        // Beginner level, first module: always open
        if ($level_slug === 'beginner') {
            $first_module = self::get_first_module_for_level('beginner');
            if ($first_module && $first_module->term_id === $module_term_id) {
                return ['accessible' => true, 'lock_type' => 'none', 'reason' => 'first_module'];
            }
        }

        // Check module-specific lock type (from term meta)
        $lock_type = get_term_meta($module_term_id, '_pm_lock_type', true);

        // If no lock type set, default based on position
        if (!$lock_type || $lock_type === 'none') {
            // Check if this is the first module of its level
            $first_module = self::get_first_module_for_level($level_slug);
            if ($first_module && $first_module->term_id === $module_term_id) {
                // First module of beginner: free. First module of other levels: account lock
                if ($level_slug === 'beginner') {
                    return ['accessible' => true, 'lock_type' => 'none', 'reason' => 'first_module'];
                }
                $lock_type = 'account';
            } else {
                // Not the first module: default to account lock
                $lock_type = 'account';
            }
        }

        // If lock_type is explicitly 'none', module is open
        if ($lock_type === 'none') {
            return ['accessible' => true, 'lock_type' => 'none', 'reason' => 'unlocked'];
        }

        // Account lock: user must be logged in
        if ($lock_type === 'account') {
            if (is_user_logged_in()) {
                return ['accessible' => true, 'lock_type' => 'account', 'reason' => 'logged_in'];
            }
            return ['accessible' => false, 'lock_type' => 'account', 'reason' => 'not_logged_in'];
        }

        // Paid lock: user must have subscription (placeholder for future)
        if ($lock_type === 'paid') {
            // For now, only admin can access paid content
            return ['accessible' => false, 'lock_type' => 'paid', 'reason' => 'no_subscription'];
        }

        return ['accessible' => false, 'lock_type' => 'account', 'reason' => 'default_locked'];
    }

    /**
     * Check if a lesson is accessible
     */
    public static function check_lesson_access($lesson_id) {
        // Admin always has access
        if (self::is_admin_user()) {
            return ['accessible' => true, 'lock_type' => 'none', 'reason' => 'admin'];
        }

        // Check lesson-specific lock override
        $lesson_lock = get_post_meta($lesson_id, '_pm_lock_type', true);
        if ($lesson_lock && $lesson_lock !== 'inherit') {
            if ($lesson_lock === 'none') {
                return ['accessible' => true, 'lock_type' => 'none', 'reason' => 'lesson_unlocked'];
            }
            if ($lesson_lock === 'account') {
                if (is_user_logged_in()) {
                    return ['accessible' => true, 'lock_type' => 'account', 'reason' => 'logged_in'];
                }
                return ['accessible' => false, 'lock_type' => 'account', 'reason' => 'not_logged_in'];
            }
            if ($lesson_lock === 'paid') {
                return ['accessible' => false, 'lock_type' => 'paid', 'reason' => 'no_subscription'];
            }
        }

        // Inherit from module
        $modules = get_the_terms($lesson_id, 'pm_module');
        $levels = get_the_terms($lesson_id, 'pm_level');
        $module = ($modules && !is_wp_error($modules)) ? $modules[0] : null;
        $level = ($levels && !is_wp_error($levels)) ? $levels[0] : null;
        $level_slug = $level ? $level->slug : 'beginner';

        if ($module) {
            return self::check_module_access($module->term_id, $level_slug);
        }

        return ['accessible' => false, 'lock_type' => 'account', 'reason' => 'no_module'];
    }

    /**
     * Get the first module for a level (by order)
     */
    public static function get_first_module_for_level($level_slug) {
        static $cache = [];
        if (isset($cache[$level_slug])) return $cache[$level_slug];

        $modules = get_terms(['taxonomy' => 'pm_module', 'hide_empty' => false, 'orderby' => 'name', 'order' => 'ASC']);
        if (empty($modules) || is_wp_error($modules)) {
            $cache[$level_slug] = null;
            return null;
        }

        foreach ($modules as $mod) {
            $q = new WP_Query([
                'post_type' => 'pm_lesson',
                'tax_query' => ['relation' => 'AND',
                    ['taxonomy' => 'pm_module', 'field' => 'term_id', 'terms' => $mod->term_id],
                    ['taxonomy' => 'pm_level', 'field' => 'slug', 'terms' => $level_slug]
                ],
                'posts_per_page' => 1,
                'fields' => 'ids'
            ]);
            if ($q->found_posts > 0) {
                wp_reset_postdata();
                $cache[$level_slug] = $mod;
                return $mod;
            }
            wp_reset_postdata();
        }

        $cache[$level_slug] = null;
        return null;
    }

    /**
     * Get lock message HTML based on lock type
     */
    public static function get_lock_message($lock_type, $context = 'module') {
        if ($lock_type === 'account') {
            return [
                'title' => 'Create an Account to Unlock',
                'subtitle' => 'Sign up for free to access this ' . $context . ' and start learning.',
                'cta_text' => 'Create Free Account',
                'cta_url' => home_url('/account/?action=register'),
                'icon' => 'account',
            ];
        }

        if ($lock_type === 'paid') {
            return [
                'title' => 'Subscribe & Learn',
                'subtitle' => 'Upgrade to Premium to unlock this ' . $context . ' and all advanced content.',
                'cta_text' => 'Subscribe & Learn',
                'cta_url' => home_url('/account/?action=subscribe'),
                'icon' => 'premium',
            ];
        }

        return null;
    }

    /**
     * Render the lock overlay HTML (reusable across templates)
     */
    public static function render_lock_overlay($lock_type, $context = 'module') {
        $msg = self::get_lock_message($lock_type, $context);
        if (!$msg) return '';

        $is_paid = ($lock_type === 'paid');
        $accent = $is_paid ? '#D7BF81' : '#4CAF50';
        $gradient = $is_paid
            ? 'linear-gradient(135deg, #D7BF81, #C4A94F)'
            : 'linear-gradient(135deg, #4CAF50, #388E3C)';

        $icon_svg = $is_paid
            ? '<svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="23" stroke="' . $accent . '" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.3"/><polygon points="24,10 28,18 37,19 30,26 32,35 24,30 16,35 18,26 11,19 20,18" stroke="' . $accent . '" stroke-width="1.5" fill="' . $accent . '15"/></svg>'
            : '<svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="23" stroke="' . $accent . '" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.3"/><rect x="15" y="23" width="18" height="14" rx="3" stroke="' . $accent . '" stroke-width="1.8" fill="' . $accent . '10"/><path d="M19 23v-4a5 5 0 0 1 10 0v4" stroke="' . $accent . '" stroke-width="1.8" stroke-linecap="round"/><circle cx="24" cy="30" r="1.5" fill="' . $accent . '"/><path d="M24 31.5v2" stroke="' . $accent . '" stroke-width="1.5" stroke-linecap="round"/></svg>';

        ob_start();
        ?>
        <div class="pm-lock-overlay" data-lock-type="<?php echo esc_attr($lock_type); ?>">
            <div class="pm-lock-overlay-inner">
                <div class="pm-lock-icon"><?php echo $icon_svg; ?></div>
                <h3 class="pm-lock-title" style="color:<?php echo $accent; ?>;"><?php echo esc_html($msg['title']); ?></h3>
                <p class="pm-lock-subtitle"><?php echo esc_html($msg['subtitle']); ?></p>
                <button type="button" class="pm-lock-cta" style="background:<?php echo $gradient; ?>;border:none;cursor:pointer;" onclick="if(typeof pmOpenAuthModal==='function'){pmOpenAuthModal('register')}else{window.location.href='<?php echo esc_url($msg['cta_url']); ?>'}">
                    <?php echo esc_html($msg['cta_text']); ?>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </button>
                <?php if ($lock_type === 'account'): ?>
                <p class="pm-lock-login-link" style="margin-top:14px;font-size:0.85rem;color:#808080;">
                    Already have an account?
                    <a href="#" style="color:<?php echo $accent; ?>;font-weight:600;text-decoration:none;" onclick="event.preventDefault();if(typeof pmOpenAuthModal==='function'){pmOpenAuthModal('login')}else{window.location.href='<?php echo esc_url(home_url('/account/?action=login')); ?>'}">Log In</a>
                </p>
                <?php endif; ?>
            </div>
        </div>
        <?php
        return ob_get_clean();
    }

    // ==========================================
    // ADMIN UI: MODULE LOCK TYPE
    // ==========================================

    public function module_add_lock_fields($taxonomy) {
        ?>
        <div class="form-field">
            <label>Lock Type</label>
            <fieldset style="margin-top:6px;">
                <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;">
                    <input type="radio" name="pm_lock_type" value="none" checked>
                    <span style="display:flex;align-items:center;gap:6px;">
                        <span style="width:10px;height:10px;border-radius:50%;background:#4CAF50;display:inline-block;"></span>
                        <strong>Open</strong> &mdash; Accessible to everyone
                    </span>
                </label>
                <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;">
                    <input type="radio" name="pm_lock_type" value="account">
                    <span style="display:flex;align-items:center;gap:6px;">
                        <span style="width:10px;height:10px;border-radius:50%;background:#2196F3;display:inline-block;"></span>
                        <strong>Account Lock</strong> &mdash; "Create an Account to Unlock"
                    </span>
                </label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                    <input type="radio" name="pm_lock_type" value="paid">
                    <span style="display:flex;align-items:center;gap:6px;">
                        <span style="width:10px;height:10px;border-radius:50%;background:#D7BF81;display:inline-block;"></span>
                        <strong>Paid Lock</strong> &mdash; "Subscribe & Learn"
                    </span>
                </label>
            </fieldset>
            <p class="description">Controls the lock message displayed when this module is restricted.</p>
        </div>
        <?php
    }

    public function module_edit_lock_fields($term) {
        $lock_type = get_term_meta($term->term_id, '_pm_lock_type', true) ?: 'account';
        ?>
        <tr class="form-field">
            <th scope="row"><label>Lock Type</label></th>
            <td>
                <fieldset>
                    <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px;cursor:pointer;">
                        <input type="radio" name="pm_lock_type" value="none" <?php checked($lock_type, 'none'); ?>>
                        <span class="pm-lock-badge pm-lock-badge-open">Open</span>
                        <span style="color:#666;">Accessible to everyone</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px;cursor:pointer;">
                        <input type="radio" name="pm_lock_type" value="account" <?php checked($lock_type, 'account'); ?>>
                        <span class="pm-lock-badge pm-lock-badge-account">Account</span>
                        <span style="color:#666;">"Create an Account to Unlock"</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                        <input type="radio" name="pm_lock_type" value="paid" <?php checked($lock_type, 'paid'); ?>>
                        <span class="pm-lock-badge pm-lock-badge-paid">Paid</span>
                        <span style="color:#666;">"Subscribe & Learn"</span>
                    </label>
                </fieldset>
                <p class="description">Controls the lock message displayed when this module is restricted.</p>
            </td>
        </tr>
        <?php
    }

    public function save_module_lock_fields($term_id) {
        if (isset($_POST['pm_lock_type'])) {
            $lock_type = sanitize_text_field($_POST['pm_lock_type']);
            if (in_array($lock_type, ['none', 'account', 'paid'])) {
                update_term_meta($term_id, '_pm_lock_type', $lock_type);
            }
        }
    }

    // ==========================================
    // ADMIN COLUMNS: MODULE
    // ==========================================

    public function module_admin_columns($columns) {
        $new_columns = [];
        foreach ($columns as $key => $val) {
            $new_columns[$key] = $val;
            if ($key === 'name') {
                $new_columns['pm_lock_type'] = 'Lock';
            }
        }
        return $new_columns;
    }

    public function module_admin_column_content($content, $column_name, $term_id) {
        if ($column_name === 'pm_lock_type') {
            $lock = get_term_meta($term_id, '_pm_lock_type', true) ?: 'account';
            $badges = [
                'none' => '<span class="pm-lock-badge pm-lock-badge-open">Open</span>',
                'account' => '<span class="pm-lock-badge pm-lock-badge-account">Account</span>',
                'paid' => '<span class="pm-lock-badge pm-lock-badge-paid">Paid</span>',
            ];
            $content = $badges[$lock] ?? $badges['account'];
        }
        return $content;
    }

    // ==========================================
    // ADMIN COLUMNS & META: LESSON
    // ==========================================

    public function lesson_admin_columns($columns) {
        $new_columns = [];
        foreach ($columns as $key => $val) {
            $new_columns[$key] = $val;
            if ($key === 'title') {
                $new_columns['pm_lock_type'] = 'Lock';
            }
        }
        return $new_columns;
    }

    public function lesson_admin_column_content($column_name, $post_id) {
        if ($column_name === 'pm_lock_type') {
            $lock = get_post_meta($post_id, '_pm_lock_type', true) ?: 'inherit';
            $badges = [
                'inherit' => '<span class="pm-lock-badge pm-lock-badge-inherit">Inherit</span>',
                'none' => '<span class="pm-lock-badge pm-lock-badge-open">Open</span>',
                'account' => '<span class="pm-lock-badge pm-lock-badge-account">Account</span>',
                'paid' => '<span class="pm-lock-badge pm-lock-badge-paid">Paid</span>',
            ];
            echo $badges[$lock] ?? $badges['inherit'];
        }
    }

    public function add_lesson_lock_metabox() {
        add_meta_box(
            'pm_lesson_lock',
            'Access Lock',
            [$this, 'lesson_lock_metabox_callback'],
            'pm_lesson',
            'side',
            'high'
        );
    }

    public function lesson_lock_metabox_callback($post) {
        wp_nonce_field('pm_lesson_lock_save', 'pm_lesson_lock_nonce');
        $lock = get_post_meta($post->ID, '_pm_lock_type', true) ?: 'inherit';
        ?>
        <style>
            .pm-lock-radio-group label {
                display: flex; align-items: center; gap: 8px;
                padding: 8px 10px; margin-bottom: 4px;
                border-radius: 8px; cursor: pointer;
                transition: background 0.15s;
            }
            .pm-lock-radio-group label:hover { background: #f0f0f1; }
            .pm-lock-radio-group input:checked + .pm-lock-opt {
                font-weight: 600;
            }
        </style>
        <div class="pm-lock-radio-group">
            <label>
                <input type="radio" name="pm_lesson_lock_type" value="inherit" <?php checked($lock, 'inherit'); ?>>
                <span class="pm-lock-opt">
                    <span class="pm-lock-badge pm-lock-badge-inherit">Inherit</span>
                    from module
                </span>
            </label>
            <label>
                <input type="radio" name="pm_lesson_lock_type" value="none" <?php checked($lock, 'none'); ?>>
                <span class="pm-lock-opt">
                    <span class="pm-lock-badge pm-lock-badge-open">Open</span>
                    for everyone
                </span>
            </label>
            <label>
                <input type="radio" name="pm_lesson_lock_type" value="account" <?php checked($lock, 'account'); ?>>
                <span class="pm-lock-opt">
                    <span class="pm-lock-badge pm-lock-badge-account">Account</span>
                    lock
                </span>
            </label>
            <label>
                <input type="radio" name="pm_lesson_lock_type" value="paid" <?php checked($lock, 'paid'); ?>>
                <span class="pm-lock-opt">
                    <span class="pm-lock-badge pm-lock-badge-paid">Paid</span>
                    lock
                </span>
            </label>
        </div>
        <?php
    }

    public function save_lesson_lock_meta($post_id) {
        if (!isset($_POST['pm_lesson_lock_nonce'])) return;
        if (!wp_verify_nonce($_POST['pm_lesson_lock_nonce'], 'pm_lesson_lock_save')) return;
        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) return;
        if (!current_user_can('edit_post', $post_id)) return;

        if (isset($_POST['pm_lesson_lock_type'])) {
            $lock = sanitize_text_field($_POST['pm_lesson_lock_type']);
            if (in_array($lock, ['inherit', 'none', 'account', 'paid'])) {
                update_post_meta($post_id, '_pm_lock_type', $lock);
            }
        }
    }

    // ==========================================
    // SEO: NOINDEX FOR NON-ADMIN (PRE-LAUNCH)
    // ==========================================

    public function noindex_for_non_admin() {
        // Admin users see normal indexing directives
        if (self::is_admin_user()) return;

        // For all LMS pages: noindex for non-admin (pre-launch)
        if (is_singular('pm_lesson') || is_tax('pm_level') || is_tax('pm_module') || is_page('learn')) {
            // Remove existing robots meta to avoid duplicates
            remove_action('wp_head', 'pianomode_robots_meta', 1);
            echo '<meta name="robots" content="noindex, nofollow"/>' . "\n";
        }
    }

    // ==========================================
    // SECURITY: RATE LIMITING
    // ==========================================

    public function rate_limit_check() {
        $user_id = get_current_user_id();
        if (!$user_id) return; // Will fail auth check later anyway

        $action = $_REQUEST['action'] ?? '';
        $key = 'pm_rate_' . $action . '_' . $user_id;
        $window = 60; // seconds
        $max_requests = 30; // max per window

        $count = get_transient($key);
        if ($count === false) {
            set_transient($key, 1, $window);
        } elseif ($count >= $max_requests) {
            wp_send_json_error('Rate limit exceeded. Please wait a moment.', 429);
        } else {
            set_transient($key, $count + 1, $window);
        }
    }

    // ==========================================
    // SECURITY: NONCE REFRESH
    // ==========================================

    public function ajax_refresh_nonce() {
        wp_send_json_success(['nonce' => wp_create_nonce('pm_lms_nonce')]);
    }

    // ==========================================
    // ADMIN CSS
    // ==========================================

    public function admin_css() {
        $screen = get_current_screen();
        if (!$screen) return;
        if ($screen->post_type !== 'pm_lesson' && $screen->taxonomy !== 'pm_module') return;
        ?>
        <style>
            .pm-lock-badge {
                display: inline-flex; align-items: center; gap: 4px;
                padding: 3px 10px; border-radius: 6px;
                font-size: 11px; font-weight: 600;
                text-transform: uppercase; letter-spacing: 0.3px;
                line-height: 1.4;
            }
            .pm-lock-badge-open {
                background: #E8F5E9; color: #2E7D32; border: 1px solid #A5D6A7;
            }
            .pm-lock-badge-account {
                background: #E3F2FD; color: #1565C0; border: 1px solid #90CAF9;
            }
            .pm-lock-badge-paid {
                background: #FFF8E1; color: #F57F17; border: 1px solid #FFE082;
            }
            .pm-lock-badge-inherit {
                background: #F5F5F5; color: #757575; border: 1px solid #E0E0E0;
            }
            .column-pm_lock_type { width: 90px; }
        </style>
        <?php
    }
}

// Initialize
PianoMode_Access_Control::get_instance();

// ==========================================
// FRONT-END CSS FOR LOCK OVERLAYS
// ==========================================

add_action('wp_head', function() {
    if (!is_singular('pm_lesson') && !is_tax('pm_level') && !is_tax('pm_module') && !is_page('learn')) return;
    ?>
    <style>
    /* =============================================
       PIANOMODE LOCK OVERLAY SYSTEM
    ============================================= */
    .pm-lock-overlay {
        position: relative;
        text-align: center;
        padding: 48px 32px;
        background: linear-gradient(135deg, rgba(17,17,17,0.97), rgba(14,14,14,0.99));
        border: 2px solid rgba(215,191,129,0.15);
        border-radius: 24px;
        backdrop-filter: blur(20px);
        max-width: 480px;
        margin: 40px auto;
    }
    .pm-lock-overlay-inner {
        position: relative; z-index: 2;
    }
    .pm-lock-icon {
        margin-bottom: 20px;
    }
    .pm-lock-title {
        font-size: 1.4rem;
        font-weight: 800;
        margin: 0 0 10px;
        font-family: 'Montserrat', sans-serif;
    }
    .pm-lock-subtitle {
        font-size: 0.92rem;
        color: #808080;
        line-height: 1.6;
        margin: 0 0 28px;
    }
    .pm-lock-cta {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 14px 32px;
        border-radius: 14px;
        font-weight: 700;
        font-size: 0.95rem;
        color: #0B0B0B;
        text-decoration: none;
        transition: all 0.25s;
        font-family: 'Montserrat', sans-serif;
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    }
    .pm-lock-cta:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }

    /* Blurred content behind lock */
    .pm-content-locked {
        position: relative;
        overflow: hidden;
    }
    .pm-content-locked > .pm-content-blur {
        filter: blur(8px);
        opacity: 0.4;
        pointer-events: none;
        user-select: none;
    }
    .pm-content-locked > .pm-lock-overlay {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 10;
        width: 90%;
        max-width: 480px;
    }

    /* Module card lock state */
    .pm-mod-row.pm-mod-locked {
        position: relative;
        overflow: hidden;
    }
    .pm-mod-row.pm-mod-locked .pm-mod-info {
        filter: blur(4px);
        opacity: 0.5;
        pointer-events: none;
    }
    .pm-mod-row.pm-mod-locked .pm-mod-lock-badge {
        position: absolute;
        right: 16px; top: 50%;
        transform: translateY(-50%);
        display: flex; align-items: center; gap: 6px;
        padding: 6px 14px;
        border-radius: 10px;
        font-size: 0.78rem;
        font-weight: 700;
        z-index: 3;
    }
    .pm-lock-badge-account-front {
        background: rgba(33,150,243,0.1);
        border: 1px solid rgba(33,150,243,0.25);
        color: #64B5F6;
    }
    .pm-lock-badge-paid-front {
        background: rgba(215,191,129,0.1);
        border: 1px solid rgba(215,191,129,0.25);
        color: #D7BF81;
    }

    /* Lesson card locked state with lock info */
    .pm-lcard.pm-lcard-access-locked,
    .pm-lesson-card.pm-lesson-access-locked {
        position: relative;
    }
    .pm-lcard.pm-lcard-access-locked .pm-lcard-body,
    .pm-lesson-card.pm-lesson-access-locked .pm-lesson-card-body {
        filter: blur(3px);
        opacity: 0.4;
    }
    .pm-lesson-lock-tag {
        display: inline-flex; align-items: center; gap: 5px;
        padding: 4px 12px; border-radius: 8px;
        font-size: 0.72rem; font-weight: 700;
        white-space: nowrap;
    }
    .pm-lesson-lock-tag-account {
        background: rgba(33,150,243,0.08);
        border: 1px solid rgba(33,150,243,0.2);
        color: #64B5F6;
    }
    .pm-lesson-lock-tag-paid {
        background: rgba(215,191,129,0.08);
        border: 1px solid rgba(215,191,129,0.2);
        color: #D7BF81;
    }

    /* Light mode */
    @media (prefers-color-scheme: light) {
        .pm-lock-overlay {
            background: linear-gradient(135deg, rgba(255,255,255,0.97), rgba(248,248,248,0.99));
            border-color: rgba(0,0,0,0.1);
        }
        .pm-lock-subtitle { color: #666; }
        .pm-lock-cta { box-shadow: 0 4px 16px rgba(0,0,0,0.12); }
        .pm-lock-cta:hover { box-shadow: 0 8px 24px rgba(0,0,0,0.18); }
    }
    </style>
    <?php
}, 2);