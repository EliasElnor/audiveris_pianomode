<?php
/**
 * PianoMode Dashboard v8.1 - Premium Professional Design
 * Location: /wp-content/themes/blocksy-child/Account/dashboard.php
 *
 * FEATURES:
 * - Ultra-modern professional design
 * - Complete user statistics tracking
 * - Games performance (Note Invaders, Sight Reading)
 * - Articles tracking (read, favorites, time)
 * - Progression system with visual indicators
 * - Day streaks with calendar view
 * - Achievements showcase
 * - Quick access menu
 *
 * FIXES v8.1:
 * - Fixed hero padding for header overlap
 * - Fixed favorites retrieval from user_meta
 * - Fixed all links to correct URLs
 * - Transparent background
 * - Gamepad icon for games
 * - Restructured Quick Access
 */

if (!defined('ABSPATH')) exit;

// Check login
if (!is_user_logged_in()) {
    // Check if this is a password reset request
    $is_password_reset = isset($_GET['pm_reset_key']) && isset($_GET['pm_reset_login']);
    ?>
    <?php if (!$is_password_reset): ?>
    <div class="pm-not-logged-in">
        <div class="pm-login-card">
            <div class="pm-login-logo-wrapper">
                <img src="/wp-content/uploads/2025/12/PianoMode_Logo_2026.png" alt="PianoMode" class="pm-login-logo-img">
            </div>
            <h2>Welcome to PianoMode</h2>
            <p>Sign in to access your personalized piano learning dashboard and track your musical journey</p>
            <div class="pm-welcome-buttons">
                <button onclick="pmOpenAuthModal('login')" class="pm-btn-welcome-signin">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                        <polyline points="10 17 15 12 10 7"/>
                        <line x1="15" y1="12" x2="3" y2="12"/>
                    </svg>
                    Sign In
                </button>
                <button onclick="pmOpenAuthModal('register')" class="pm-btn-welcome-register">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                        <circle cx="8.5" cy="7" r="4"/>
                        <line x1="20" y1="8" x2="20" y2="14"/>
                        <line x1="23" y1="11" x2="17" y2="11"/>
                    </svg>
                    Create Free Account
                </button>
            </div>
        </div>
    </div>
    <?php endif; ?>
    <?php if ($is_password_reset): ?>
    <div class="pm-not-logged-in pm-reset-mode">
        <div class="pm-login-card">
            <div class="pm-login-logo-wrapper">
                <img src="/wp-content/uploads/2025/12/PianoMode_Logo_2026.png" alt="PianoMode" class="pm-login-logo-img">
            </div>
            <p>Loading password reset...</p>
        </div>
    </div>
    <script>
    // Immediately open reset modal when page loads with reset params
    jQuery(document).ready(function($) {
        // Trigger reset modal opening immediately
        if (typeof window.pmOpenAuthModal === 'function') {
            window.pmOpenAuthModal('login');
        } else {
            // If account-system.js hasn't loaded yet, wait for it
            var checkInterval = setInterval(function() {
                if (typeof window.pmOpenAuthModal === 'function') {
                    clearInterval(checkInterval);
                    window.pmOpenAuthModal('login');
                }
            }, 50);
            // Safety timeout
            setTimeout(function() { clearInterval(checkInterval); }, 5000);
        }
    });
    </script>
    <?php endif; ?>
    <?php
    return;
}

// Get current user
$user = wp_get_current_user();
$user_id = $user->ID;

// Get data from MySQL
global $wpdb;
$table_prefix = $wpdb->prefix . 'pm_';

// User data
$user_data = $wpdb->get_row($wpdb->prepare(
    "SELECT * FROM {$table_prefix}user_data WHERE user_id = %d",
    $user_id
), ARRAY_A);

// Sight reading stats - read from user_meta (srt_user_stats) which is the actual source
// The sightreading game saves to user_meta 'srt_user_stats', NOT to pm_sightreading_stats table
$srt_meta = get_user_meta($user_id, 'srt_user_stats', true);
$sr_stats = null;
if (is_array($srt_meta) && !empty($srt_meta)) {
    $sr_stats = array(
        'total_sessions'       => intval($srt_meta['total_sessions'] ?? 0),
        'total_notes_played'   => intval($srt_meta['total_notes_played'] ?? 0),
        'total_correct_notes'  => intval($srt_meta['total_correct_notes'] ?? 0),
        'total_incorrect_notes'=> intval($srt_meta['total_incorrect_notes'] ?? 0),
        'average_accuracy'     => floatval($srt_meta['average_accuracy'] ?? 0),
        'best_streak'          => intval($srt_meta['best_streak'] ?? 0),
        'total_practice_time'  => intval($srt_meta['total_practice_time'] ?? 0),
    );
}
// Fallback: also check the DB table if user_meta is empty
if (empty($sr_stats) || $sr_stats['total_sessions'] === 0) {
    $sr_db = $wpdb->get_row($wpdb->prepare(
        "SELECT * FROM {$table_prefix}sightreading_stats WHERE user_id = %d",
        $user_id
    ), ARRAY_A);
    if ($sr_db && intval($sr_db['total_sessions'] ?? 0) > ($sr_stats['total_sessions'] ?? 0)) {
        $sr_stats = $sr_db;
    }
}

// Recent sessions (last 5) — from srt_user_stats session_history (user_meta)
$recent_sessions = array();
if (is_array($srt_meta) && !empty($srt_meta['session_history'])) {
    $history = array_slice(array_reverse($srt_meta['session_history']), 0, 5);
    foreach ($history as $h) {
        $recent_sessions[] = array(
            'session_date'    => $h['date'] ?? '',
            'notes_played'    => intval($h['correct_notes'] ?? 0) + intval($h['incorrect_notes'] ?? 0),
            'correct_notes'   => intval($h['correct_notes'] ?? 0),
            'incorrect_notes' => intval($h['incorrect_notes'] ?? 0),
            'accuracy'        => floatval($h['accuracy'] ?? 0),
            'best_streak'     => intval($h['best_streak'] ?? 0),
            'duration'        => intval($h['duration'] ?? 0),
            'difficulty'      => $h['difficulty'] ?? 'beginner'
        );
    }
}
// Fallback: try DB table
if (empty($recent_sessions)) {
    $recent_sessions = $wpdb->get_results($wpdb->prepare(
        "SELECT * FROM {$table_prefix}sightreading_sessions
         WHERE user_id = %d
         ORDER BY session_date DESC
         LIMIT 5",
        $user_id
    ), ARRAY_A) ?: array();
}

// Run achievement checks before querying (ensures new badges are created first)
if (function_exists('pianomode_check_user_badges')) {
    delete_user_meta($user_id, 'pm_badge_last_check'); // bypass throttle on dashboard load
    pianomode_check_user_badges($user_id);
}

// Achievements
$achievements = $wpdb->get_results($wpdb->prepare(
    "SELECT * FROM {$table_prefix}achievements
     WHERE user_id = %d
     ORDER BY earned_at DESC",
    $user_id
), ARRAY_A);

// =====================================================
// FAVORITES - Get from user_meta (original system)
// =====================================================
$user_favorites = get_user_meta($user_id, 'pm_favorites', true);
if (!is_array($user_favorites)) {
    $user_favorites = array();
}

// Separate favorites by post type
$favorite_posts = array();
$favorite_scores = array();

foreach ($user_favorites as $fav_id) {
    $post = get_post($fav_id);
    if ($post) {
        if ($post->post_type === 'post') {
            $favorite_posts[] = $post;
        } elseif ($post->post_type === 'score') {
            $favorite_scores[] = $post;
        }
    }
}

// Limit to 4 each
$favorite_posts = array_slice($favorite_posts, 0, 4);
$favorite_scores = array_slice($favorite_scores, 0, 4);
$favorite_posts_count = count(array_filter($user_favorites, function($id) {
    $p = get_post($id);
    return $p && $p->post_type === 'post';
}));
$favorite_scores_count = count(array_filter($user_favorites, function($id) {
    $p = get_post($id);
    return $p && $p->post_type === 'score';
}));
$favorites_count = count($user_favorites);

// Reading history
$reading_history = $wpdb->get_results($wpdb->prepare(
    "SELECT rh.*, p.post_title
     FROM {$table_prefix}reading_history rh
     LEFT JOIN {$wpdb->posts} p ON rh.post_id = p.ID
     WHERE rh.user_id = %d
     ORDER BY rh.last_read_at DESC
     LIMIT 5",
    $user_id
), ARRAY_A);

// Get Note Invaders stats (from user meta)
$ni_high_score = get_user_meta($user_id, 'note_invaders_high_score', true) ?: 0;
$ni_best_wave = get_user_meta($user_id, 'note_invaders_best_wave', true) ?: 0;
$ni_best_accuracy = min(100, floatval(get_user_meta($user_id, 'note_invaders_best_accuracy', true) ?: 0));
$ni_games_played = get_user_meta($user_id, 'note_invaders_games_played', true) ?: 0;

// Total game stats
$total_game_score = get_user_meta($user_id, 'pianomode_total_score', true) ?: 0;
$total_games_played = get_user_meta($user_id, 'pianomode_games_played', true) ?: 0;

// Dual scores: Learning vs Gaming
$total_learning_score = (int) (get_user_meta($user_id, 'pianomode_learning_score', true) ?: 0);
$total_gaming_score = (int) (get_user_meta($user_id, 'pianomode_gaming_score', true) ?: 0);
$ni_best_learning = (int) (get_user_meta($user_id, 'ni_best_learning_score', true) ?: 0);
$ni_best_gaming = (int) (get_user_meta($user_id, 'ni_best_gaming_score', true) ?: 0);

// Ledger Line Legend stats
$ll_high_score = (int) (get_user_meta($user_id, 'ledger_line_high_score', true) ?: 0);
$ll_best_combo = (int) (get_user_meta($user_id, 'ledger_line_best_combo', true) ?: 0);
$ll_best_accuracy = min(100, intval(get_user_meta($user_id, 'ledger_line_best_accuracy', true) ?: 0));
$ll_highest_realm = (int) (get_user_meta($user_id, 'ledger_line_highest_realm', true) ?: 0);
$ll_best_gaming = (int) (get_user_meta($user_id, 'll_best_gaming_score', true) ?: 0);

// Sightreading best learning score
$sr_best_learning = (int) (get_user_meta($user_id, 'sr_best_learning_score', true) ?: 0);

// Ear Trainer stats (from user meta)
$et_stats = get_user_meta($user_id, 'pm_ear_trainer_stats', true);
if (!is_array($et_stats)) {
    $et_stats = array('total_sessions' => 0, 'total_q' => 0, 'total_correct' => 0, 'best_streak' => 0, 'xp' => 0);
}
$et_accuracy = ($et_stats['total_q'] ?? 0) > 0 ? min(100, round(($et_stats['total_correct'] / $et_stats['total_q']) * 100, 1)) : 0;
$et_best_learning = (int) (get_user_meta($user_id, 'et_best_learning_score', true) ?: 0);

// Calculate best session across all games for each score type
$best_learning_session = max($ni_best_learning, $sr_best_learning, $et_best_learning);
$best_gaming_session = max($ni_best_gaming, $ll_best_gaming);

// Calculate GLOBAL ACCURACY = average of all games' accuracy (each capped at 100%)
$accuracy_sources = array();
$sr_acc_val = min(100, floatval($sr_stats['average_accuracy'] ?? 0));
if ($sr_acc_val > 0) $accuracy_sources[] = $sr_acc_val;
if ($ni_best_accuracy > 0) $accuracy_sources[] = $ni_best_accuracy;
if ($ll_best_accuracy > 0) $accuracy_sources[] = $ll_best_accuracy;
if ($et_accuracy > 0) $accuracy_sources[] = $et_accuracy;
$global_accuracy = !empty($accuracy_sources) ? min(100, round(array_sum($accuracy_sources) / count($accuracy_sources), 1)) : 0;

// Calculate TOTAL NOTES PLAYED across ALL games
$total_notes_all_games = 0;
$total_notes_all_games += intval($sr_stats['total_notes_played'] ?? 0); // Sightreading
$total_notes_all_games += intval(get_user_meta($user_id, 'vp_total_notes_played', true) ?: 0); // Virtual Piano
$total_notes_all_games += intval($et_stats['total_q'] ?? 0); // Ear Trainer (questions = notes identified)
$total_notes_all_games += intval(get_user_meta($user_id, 'ni_total_notes_played', true) ?: 0); // Note Invaders
$total_notes_all_games += intval(get_user_meta($user_id, 'll_total_notes_played', true) ?: 0); // Ledger Line
$total_notes_all_games += intval(get_user_meta($user_id, 'ph_total_notes_played', true) ?: 0); // Piano Hero

// Initialize defaults if empty
if (empty($user_data)) {
    $user_data = array(
        'level' => 1,
        'experience_points' => 0,
        'streak_days' => 0,
        'longest_streak' => 0,
        'total_articles_read' => 0,
        'total_scores_downloaded' => 0,
        'total_practice_time' => 0
    );
}

if (empty($sr_stats)) {
    $sr_stats = array(
        'total_sessions' => 0,
        'total_notes_played' => 0,
        'total_correct_notes' => 0,
        'total_incorrect_notes' => 0,
        'average_accuracy' => 0,
        'best_streak' => 0,
        'total_practice_time' => 0
    );
}

// Calculate stats
$level = intval($user_data['level']);
$xp = intval($user_data['experience_points']);
$xp_for_current_level = ($level - 1) * 1000;
$xp_for_next_level = $level * 1000;
$xp_progress = $xp - $xp_for_current_level;
$xp_needed = $xp_for_next_level - $xp_for_current_level;
$xp_percentage = $xp_needed > 0 ? min(($xp_progress / $xp_needed) * 100, 100) : 100;
$streak = intval($user_data['streak_days']);
$longest_streak = intval($user_data['longest_streak']);

// Calculate progression score (overall engagement) — weighted across all categories
// Each category has a max contribution, totaling 1000 for a well-rounded musician
$progression_score = 0;
$progression_score += min($level * 5, 100);                                          // Levels: max 100 (level 20)
$progression_score += min(intval($user_data['total_articles_read']), 100);            // Reading: max 100 (100 articles)
$progression_score += min(intval($user_data['total_scores_downloaded']) * 2, 100);    // Downloads: max 100 (50 scores)
$progression_score += min($streak * 2, 100);                                          // Streak days: max 100 (50 days)
$progression_score += min(intval($sr_stats['total_sessions']), 200);                  // Sightreading: max 200 (200 sessions)
$progression_score += min($ni_games_played, 100);                                     // Note Invaders: max 100 (100 games)
$et_sessions = intval($et_stats['total_sessions'] ?? 0);
$ph_sessions = (int) get_user_meta($user_id, 'ph_sessions_completed', true);
$vp_sessions = (int) get_user_meta($user_id, 'vp_sessions_completed', true);
$total_practice_sessions = intval($sr_stats['total_sessions']) + $et_sessions + $ph_sessions + $vp_sessions;
$progression_score += min($et_sessions, 100);                                         // Ear Trainer: max 100 (100 sessions)
$progression_score += min(count($achievements) * 5, 200);                             // Achievements: max 200 (40 badges)
$max_progression = 1000;
$progression_percentage = min(($progression_score / $max_progression) * 100, 100);

// Time-based greeting with emoji
$hour = date('H');
if ($hour >= 5 && $hour < 12) {
    $greeting = 'Good morning';
    $greeting_emoji = 'sunrise';
} elseif ($hour >= 12 && $hour < 17) {
    $greeting = 'Good afternoon';
    $greeting_emoji = 'sun';
} elseif ($hour >= 17 && $hour < 21) {
    $greeting = 'Good evening';
    $greeting_emoji = 'sunset';
} else {
    $greeting = 'Good night';
    $greeting_emoji = 'moon';
}

$display_name = $user->first_name ?: $user->display_name;

// Level titles
$level_titles = array(
    1 => 'Beginner',
    2 => 'Novice',
    3 => 'Apprentice',
    4 => 'Learner',
    5 => 'Student',
    6 => 'Practitioner',
    7 => 'Adept',
    8 => 'Expert',
    9 => 'Master',
    10 => 'Virtuoso'
);
$level_title = $level_titles[min($level, 10)] ?? 'Virtuoso';

// Build achievement lookup from centralized definitions
$all_ach_defs = function_exists('pianomode_get_all_achievements') ? pianomode_get_all_achievements() : array();
$achievement_lookup = array();
foreach ($all_ach_defs as $adef) {
    $achievement_lookup[$adef['id']] = $adef;
}

// =====================================================
// TOTAL ACTIVE USERS - Only count users who have actually started learning
// (have entries in pm_user_data OR pm_lesson_progress, or have pm_completed_lessons meta)
// =====================================================
$active_users_count = $wpdb->get_var(
    "SELECT COUNT(DISTINCT u.ID) FROM {$wpdb->users} u
     WHERE EXISTS (SELECT 1 FROM {$table_prefix}user_data ud WHERE ud.user_id = u.ID)
        OR EXISTS (SELECT 1 FROM {$wpdb->usermeta} um WHERE um.user_id = u.ID AND um.meta_key = 'pm_completed_lessons' AND um.meta_value != '' AND um.meta_value != 'a:0:{}')
        OR EXISTS (SELECT 1 FROM {$table_prefix}lesson_progress lp WHERE lp.user_id = u.ID)"
);
$active_users_count = intval($active_users_count);

// =====================================================
// LEARNING HOURS - Calculate total time spent learning
// =====================================================
$practice_time_seconds = intval($user_data['total_practice_time'] ?? 0);
$sr_practice_time_seconds = intval($sr_stats['total_practice_time'] ?? 0);
$vp_time_minutes = intval(get_user_meta($user_id, 'vp_total_time', true) ?: 0);
$et_practice_time = intval($et_stats['total_practice_time'] ?? 0);
$ph_practice_time = intval(get_user_meta($user_id, 'ph_total_practice_time', true) ?: 0);

// Sanity check: cap unreasonable values (bug fix for sightreading corrupt data)
$MAX_REASONABLE_SECONDS = 365 * 24 * 3600;
if ($sr_practice_time_seconds > $MAX_REASONABLE_SECONDS) {
    $sr_practice_time_seconds = 0;
    if (is_array($srt_meta) && !empty($srt_meta['session_history'])) {
        foreach ($srt_meta['session_history'] as $h) {
            $dur = intval($h['duration'] ?? 0);
            if ($dur > 0 && $dur <= 14400) $sr_practice_time_seconds += $dur;
        }
    }
    if (is_array($srt_meta)) {
        $srt_meta['total_practice_time'] = $sr_practice_time_seconds;
        update_user_meta($user_id, 'srt_user_stats', $srt_meta);
    }
    $sr_stats['total_practice_time'] = $sr_practice_time_seconds;
}
$practice_time_seconds = min($practice_time_seconds, $MAX_REASONABLE_SECONDS);
$et_practice_time = min($et_practice_time, $MAX_REASONABLE_SECONDS);
$ph_practice_time = min($ph_practice_time, $MAX_REASONABLE_SECONDS);

$total_learning_seconds = $practice_time_seconds + $sr_practice_time_seconds + ($vp_time_minutes * 60) + $et_practice_time + $ph_practice_time;
$learning_hours = floor($total_learning_seconds / 3600);
$learning_minutes = floor(($total_learning_seconds % 3600) / 60);
if ($learning_hours > 0) {
    $learning_time_display = $learning_hours . 'h ' . $learning_minutes . 'm';
} elseif ($learning_minutes > 0) {
    $learning_time_display = $learning_minutes . 'm';
} else {
    $learning_time_display = '0m';
}

// =====================================================
// USER COMMENTS & FEEDBACK
// =====================================================
$user_comments = get_comments(array(
    'user_id' => $user_id,
    'number'  => 10,
    'orderby' => 'comment_date_gmt',
    'order'   => 'DESC',
    'status'  => 'all',
));

// Generate secure logout URL
$logout_url = wp_nonce_url(home_url('?pm_logout=1'), 'pm_logout_action');

// =====================================================
// LMS DATA - for Learning tab
// =====================================================
$lms_stats = array(
    'total_xp' => 0, 'level' => 'Novice', 'level_number' => 1,
    'streak' => 0, 'longest_streak' => 0,
    'completed_count' => 0, 'in_progress_count' => 0,
    'total_hours' => 0, 'hearts' => 5,
    'daily_xp' => 0, 'daily_goal' => 30
);
if (function_exists('pm_get_user_stats')) {
    $lms_stats = pm_get_user_stats($user_id);
}
$assessment_done = get_user_meta($user_id, 'pm_assessment_completed', true) === '1';
$current_level_path = get_user_meta($user_id, 'pm_current_level', true);
$completed_lessons = get_user_meta($user_id, 'pm_completed_lessons', true);
if (!is_array($completed_lessons)) $completed_lessons = array();
$bookmarked_lessons = get_user_meta($user_id, 'pm_bookmarked_lessons', true);
if (!is_array($bookmarked_lessons)) $bookmarked_lessons = array();
$lms_daily_pct = min(100, round(($lms_stats['daily_xp'] / max(1, $lms_stats['daily_goal'])) * 100));

// In-progress lessons
$in_progress_lessons = array();
$progress_table = $wpdb->prefix . 'pm_lesson_progress';
if ($wpdb->get_var($wpdb->prepare("SHOW TABLES LIKE %s", $progress_table)) === $progress_table) {
    $in_progress_lessons = $wpdb->get_results($wpdb->prepare(
        "SELECT lp.*, p.post_title FROM $progress_table lp
         LEFT JOIN {$wpdb->posts} p ON lp.lesson_id = p.ID
         WHERE lp.user_id = %d AND lp.status = 'in_progress'
         ORDER BY lp.last_activity DESC LIMIT 5",
        $user_id
    ), ARRAY_A) ?: array();
}
$last_lesson = !empty($in_progress_lessons) ? $in_progress_lessons[0] : null;

// Total lessons for completion %
$total_lessons_count = wp_count_posts('pm_lesson');
$total_lessons = ($total_lessons_count && isset($total_lessons_count->publish)) ? $total_lessons_count->publish : 0;
$completion_pct = $total_lessons > 0 ? round((count($completed_lessons) / $total_lessons) * 100) : 0;

// Gaming time
$gaming_time_seconds = intval(get_user_meta($user_id, 'ni_total_time', true) ?: 0)
    + intval(get_user_meta($user_id, 'll_total_time', true) ?: 0)
    + $ph_practice_time;
$gaming_hours = floor($gaming_time_seconds / 3600);
$gaming_minutes = floor(($gaming_time_seconds % 3600) / 60);
$gaming_time_display = $gaming_hours > 0 ? $gaming_hours . 'h ' . $gaming_minutes . 'm' : ($gaming_minutes > 0 ? $gaming_minutes . 'm' : '0m');

// Active tab
$active_tab = sanitize_text_field($_GET['tab'] ?? 'profile');
if (!in_array($active_tab, array('profile', 'learning', 'play'))) $active_tab = 'profile';

// Piano Hero & Virtual Piano stats
$ph_best_learn = (int)(get_user_meta($user_id, 'ph_best_learning_score', true) ?: 0);
$ph_best_game = (int)(get_user_meta($user_id, 'ph_best_gaming_score', true) ?: 0);
$vp_notes = (int)(get_user_meta($user_id, 'vp_total_notes_played', true) ?: 0);

// Hero background
$hero_bg_url = '';
if (!empty($favorite_posts)) {
    $rand_fav = $favorite_posts[array_rand($favorite_posts)];
    $hero_bg_url = get_the_post_thumbnail_url($rand_fav->ID, 'large');
}
if (!$hero_bg_url) {
    $random_post = get_posts(array('numberposts' => 1, 'orderby' => 'rand', 'post_status' => 'publish'));
    if (!empty($random_post)) $hero_bg_url = get_the_post_thumbnail_url($random_post[0]->ID, 'large');
}
?>


<div class="pm-dashboard-wrapper pm-loaded" data-active-tab="<?php echo esc_attr($active_tab); ?>">

    <!-- ==================== HERO SECTION ==================== -->
    <section class="pm-hero-section" <?php if ($hero_bg_url): ?>style="--pm-hero-bg-img: url('<?php echo esc_url($hero_bg_url); ?>')"<?php endif; ?>>
        <div class="pm-hero-bg"></div>
        <div class="pm-hero-container">
            <div class="pm-hero-content">
                <div class="pm-profile-card">
                    <div class="pm-avatar-section">
                        <div class="pm-avatar-wrapper" id="pm-avatar-wrapper">
                            <?php echo pianomode_get_avatar($user_id, 100); ?>
                            <button class="pm-avatar-edit-btn" id="pm-avatar-edit-btn" title="Change avatar">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                            </button>
                        </div>
                    </div>

                    <!-- Avatar Picker Modal -->
                    <div class="pm-avatar-modal-overlay" id="pm-avatar-modal" style="display:none;">
                        <div class="pm-avatar-modal">
                            <div class="pm-avatar-modal-header">
                                <h3>Choose your avatar</h3>
                                <button class="pm-avatar-modal-close" id="pm-avatar-modal-close">&times;</button>
                            </div>
                            <div class="pm-avatar-modal-body">
                                <div class="pm-avatar-presets">
                                    <?php
                                    $preset_names = array(
                                        'piano-keys' => 'Piano Keys', 'grand-piano' => 'Grand Piano',
                                        'music-notes' => 'Music Notes', 'treble-clef' => 'Treble Clef',
                                        'bass-clef' => 'Bass Clef', 'metronome' => 'Metronome',
                                        'headphones' => 'Headphones', 'vinyl-record' => 'Vinyl Record',
                                        'guitar' => 'Guitar', 'microphone' => 'Microphone',
                                    );
                                    $current_preset = get_user_meta($user_id, 'pm_avatar_preset', true);
                                    foreach ($preset_names as $key => $label): ?>
                                    <div class="pm-avatar-preset-item<?php echo $current_preset === $key ? ' active' : ''; ?>" data-preset="<?php echo $key; ?>" title="<?php echo $label; ?>">
                                        <?php echo pianomode_preset_avatar_svg($key, 70); ?>
                                    </div>
                                    <?php endforeach; ?>
                                </div>
                                <div class="pm-avatar-upload-section">
                                    <label class="pm-avatar-upload-btn">
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                                        Upload custom photo
                                        <input type="file" id="pm-avatar-upload" accept="image/jpeg,image/png,image/webp" style="display:none;">
                                    </label>
                                    <button class="pm-avatar-remove-btn" id="pm-avatar-remove-btn">Reset to default</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="pm-user-details">
                        <div class="pm-greeting-line">
                            <span class="pm-greeting-icon pm-icon-<?php echo esc_attr($greeting_emoji); ?>"></span>
                            <span class="pm-greeting-text"><?php echo esc_html($greeting); ?>,</span>
                        </div>
                        <h1 class="pm-username"><?php echo esc_html($display_name); ?></h1>
                        <p class="pm-user-title"><?php echo esc_html($level_title); ?> Pianist</p>
                        <div class="pm-user-badges">
                            <span class="pm-badge pm-badge-member">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                                Since <?php echo date('M Y', strtotime($user->user_registered)); ?>
                            </span>
                            <?php if ($streak > 0): ?>
                            <span class="pm-badge pm-badge-streak">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14 0-5.5 3-7.5.5 2.5 2 4.9 2 8 0 2.5-1.5 3.5-1.5 5 .5-1.5 1.5-3 3.5-4.5a9.06 9.06 0 0 1 0 7.5A5 5 0 0 1 12 22a5 5 0 0 1-3.5-7.5Z"/></svg>
                                <?php echo intval($streak); ?> Day Streak
                            </span>
                            <?php endif; ?>
                        </div>
                    </div>

                    <div class="pm-header-actions">
                        <button class="pm-btn-settings" id="pm-settings-btn" title="Settings">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852 1 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                        </button>
                        <a href="<?php echo esc_url($logout_url); ?>" class="pm-btn-logout" title="Sign Out">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                        </a>
                    </div>
                </div>

                <!-- XP Progress -->
                <div class="pm-xp-section">
                    <div class="pm-xp-info">
                        <div class="pm-xp-level-indicator">
                            <span class="pm-xp-level-num"><?php echo $level; ?></span>
                        </div>
                        <div class="pm-xp-details">
                            <div class="pm-xp-label-row">
                                <span class="pm-xp-label">Level <?php echo intval($level); ?> &mdash; <?php echo esc_html($level_title); ?></span>
                                <span class="pm-xp-value"><?php echo number_format($xp_progress); ?> / <?php echo number_format($xp_needed); ?> XP</span>
                            </div>
                            <div class="pm-xp-bar">
                                <div class="pm-xp-fill" data-width="<?php echo esc_attr($xp_percentage); ?>"></div>
                            </div>
                            <div class="pm-xp-footer">
                                <span><?php echo number_format($xp_for_next_level - $xp); ?> XP to Level <?php echo $level + 1; ?></span>
                                <span class="pm-total-xp"><?php echo number_format($xp); ?> Total XP</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <!-- ==================== TAB NAVIGATION ==================== -->
    <nav class="pm-tabs-nav" id="pm-tabs-nav">
        <div class="pm-container">
            <div class="pm-tabs-list" role="tablist">
                <button class="pm-tab-btn <?php echo $active_tab === 'profile' ? 'active' : ''; ?>" data-tab="profile" role="tab">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    <span>My Profile</span>
                </button>
                <button class="pm-tab-btn <?php echo $active_tab === 'learning' ? 'active' : ''; ?>" data-tab="learning" role="tab">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                    <span>Learning</span>
                </button>
                <button class="pm-tab-btn <?php echo $active_tab === 'play' ? 'active' : ''; ?>" data-tab="play" role="tab">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><circle cx="15" cy="13" r="1"/><circle cx="18" cy="11" r="1"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.544-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/></svg>
                    <span>Play</span>
                </button>
                <div class="pm-tab-indicator"></div>
            </div>
        </div>
    </nav>

    <!-- ==================== MAIN LAYOUT ==================== -->
    <div class="pm-container">
        <div class="pm-main-layout">
            <div class="pm-tab-content-area">

<!-- ==================== TAB: MY PROFILE ==================== -->
<div class="pm-tab-panel <?php echo $active_tab === 'profile' ? 'active' : ''; ?>" id="pm-tab-profile" role="tabpanel">

    <!-- Stats Overview Grid -->
    <div class="pm-stats-grid">
        <div class="pm-stat-card pm-stat-streak">
            <div class="pm-stat-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14 0-5.5 3-7.5.5 2.5 2 4.9 2 8 0 2.5-1.5 3.5-1.5 5 .5-1.5 1.5-3 3.5-4.5a9.06 9.06 0 0 1 0 7.5A5 5 0 0 1 12 22a5 5 0 0 1-3.5-7.5Z"/></svg></div>
            <div class="pm-stat-content">
                <div class="pm-stat-value"><?php echo $streak; ?></div>
                <div class="pm-stat-label">Day Streak</div>
                <?php if ($longest_streak > 0): ?><div class="pm-stat-sub">Best: <?php echo $longest_streak; ?> days</div><?php endif; ?>
            </div>
        </div>
        <div class="pm-stat-card pm-stat-games">
            <div class="pm-stat-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><circle cx="15" cy="13" r="1"/><circle cx="18" cy="11" r="1"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.544-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/></svg></div>
            <div class="pm-stat-content">
                <div class="pm-stat-value"><?php echo $total_games_played + intval($sr_stats['total_sessions']); ?></div>
                <div class="pm-stat-label">Sessions Played</div>
                <div class="pm-stat-sub"><?php echo number_format($total_game_score); ?> total score</div>
            </div>
        </div>
        <div class="pm-stat-card pm-stat-accuracy">
            <div class="pm-stat-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></div>
            <div class="pm-stat-content">
                <div class="pm-stat-value"><?php echo $global_accuracy; ?>%</div>
                <div class="pm-stat-label">Avg. Accuracy</div>
                <div class="pm-stat-sub">Across all games</div>
            </div>
        </div>
        <div class="pm-stat-card pm-stat-notes">
            <div class="pm-stat-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
            <div class="pm-stat-content">
                <div class="pm-stat-value"><?php echo number_format($total_notes_all_games); ?></div>
                <div class="pm-stat-label">Notes Played</div>
                <div class="pm-stat-sub">All games combined</div>
            </div>
        </div>
        <div class="pm-stat-card pm-stat-achievements">
            <div class="pm-stat-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg></div>
            <div class="pm-stat-content">
                <div class="pm-stat-value"><?php echo count($achievements); ?></div>
                <div class="pm-stat-label">Achievements</div>
                <div class="pm-stat-sub">Unlocked</div>
            </div>
        </div>
        <div class="pm-stat-card pm-stat-hours">
            <div class="pm-stat-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
            <div class="pm-stat-content">
                <div class="pm-stat-value"><?php echo esc_html($learning_time_display); ?></div>
                <div class="pm-stat-label">Learning Time</div>
                <div class="pm-stat-sub">Total hours practiced</div>
            </div>
        </div>
        <div class="pm-stat-card pm-stat-community">
            <div class="pm-stat-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
            <div class="pm-stat-content">
                <div class="pm-stat-value"><?php echo $active_users_count; ?></div>
                <div class="pm-stat-label">Active Pianists</div>
                <div class="pm-stat-sub">Learning community</div>
            </div>
        </div>
    </div>

    <!-- Daily Challenges -->
    <?php
    $dc_config = get_option('pianomode_daily_challenges_config', array());
    $dc_enabled = isset($dc_config['enabled']) ? $dc_config['enabled'] : true;
    if ($dc_enabled && function_exists('pianomode_get_weekly_challenges')):
        $weekly = pianomode_get_weekly_challenges($user_id);
        $challenges = $weekly['challenges'] ?? array();
        $current_day = (int) date('N', current_time('timestamp'));
        $user_difficulty = get_user_meta($user_id, 'pm_challenge_difficulty', true) ?: 'beginner';
        $completed_count = 0;
        foreach ($challenges as $c) { if (!empty($c['completed'])) $completed_count++; }
        $total_completed = (int) get_user_meta($user_id, 'pm_challenges_completed', true);
        $game_icons = array(
            'ear_trainer' => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v5z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3v5z"/></svg>',
            'piano_hero' => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
            'sightreading' => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="16" r="3"/><path d="M15 16V4"/><path d="M15 4c2 0 4 1 4 3"/></svg>',
            'note_invaders' => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 12h4m4 0h4"/><path d="M12 10v4"/></svg>',
            'read_article' => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
            'read_score' => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
            'accuracy' => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
        );
        $today_challenge = $challenges[$current_day - 1] ?? null;
        $today_icon = $game_icons[$today_challenge['type'] ?? 'sightreading'] ?? $game_icons['sightreading'];
    ?>
    <div class="pm-card pm-challenges-card">
        <div class="pm-card-header">
            <h3><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14 0-5.5 3-7.5.5 2.5 2 4.9 2 8 0 2.5-1.5 3.5-1.5 5 .5-1.5 1.5-3 3.5-4.5a9.06 9.06 0 0 1 0 7.5A5 5 0 0 1 12 22a5 5 0 0 1-3.5-7.5Z"/></svg> Daily Challenges</h3>
            <div class="pm-dc-header-right">
                <span class="pm-dc-progress-label"><?php echo $completed_count; ?>/7 this week</span>
                <select id="pm-challenge-difficulty" class="pm-dc-difficulty-select">
                    <option value="beginner" <?php selected($user_difficulty, 'beginner'); ?>>Beginner</option>
                    <option value="intermediate" <?php selected($user_difficulty, 'intermediate'); ?>>Intermediate</option>
                    <option value="advanced" <?php selected($user_difficulty, 'advanced'); ?>>Advanced</option>
                </select>
            </div>
        </div>
        <div class="pm-card-body">
            <div class="pm-dc-timeline">
                <?php foreach ($challenges as $i => $challenge):
                    $day_num = $i + 1;
                    $is_today = ($day_num === $current_day);
                    $is_completed = !empty($challenge['completed']);
                    $is_past = ($day_num < $current_day);
                    $state = $is_completed ? 'completed' : ($is_today ? 'today' : ($is_past ? 'missed' : 'upcoming'));
                    $icon = $game_icons[$challenge['type']] ?? $game_icons['sightreading'];
                ?>
                <div class="pm-dc-node pm-dc-node-<?php echo $state; ?>" data-day="<?php echo $day_num; ?>">
                    <span class="pm-dc-node-day" data-server-day="<?php echo $day_num; ?>">Day <?php echo $day_num; ?></span>
                    <div class="pm-dc-node-circle">
                        <?php if ($is_completed): ?>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                        <?php elseif ($is_today): ?>
                            <div class="pm-dc-node-pulse"></div><?php echo $icon; ?>
                        <?php else: ?>
                            <?php echo $icon; ?>
                        <?php endif; ?>
                    </div>
                    <span class="pm-dc-node-desc"><?php echo ($is_today || $is_completed || $is_past) ? esc_html($challenge['description']) : 'Locked'; ?></span>
                </div>
                <?php endforeach; ?>
            </div>

            <?php if ($today_challenge && !$today_challenge['completed']): ?>
            <div class="pm-dc-today-card">
                <div class="pm-dc-today-inner">
                    <div class="pm-dc-today-icon-wrap"><?php echo str_replace(array('width="20"', 'height="20"'), array('width="24"', 'height="24"'), $today_icon); ?></div>
                    <div class="pm-dc-today-text">
                        <span class="pm-dc-today-title"><?php echo esc_html($today_challenge['description']); ?></span>
                        <span class="pm-dc-today-type"><?php echo ucfirst(str_replace('_', ' ', $today_challenge['type'])); ?></span>
                    </div>
                    <a href="<?php echo esc_url(home_url($today_challenge['game_url'])); ?>" class="pm-dc-today-btn">Play Now</a>
                </div>
            </div>
            <?php elseif ($today_challenge && $today_challenge['completed']): ?>
            <div class="pm-dc-today-card pm-dc-today-done">
                <div class="pm-dc-today-inner">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4caf50" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    <span style="color:#4caf50;font-weight:600;">Challenge Complete! Come back tomorrow.</span>
                </div>
            </div>
            <?php endif; ?>
        </div>
    </div>
    <?php endif; ?>

    <!-- Progress & Scores -->
    <div class="pm-two-col">
        <div class="pm-card pm-progression-card">
            <div class="pm-card-header"><h3><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> Your Progress</h3></div>
            <div class="pm-card-body">
                <div class="pm-progression-overview">
                    <div class="pm-progression-circle">
                        <svg viewBox="0 0 120 120">
                            <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(0,0,0,0.06)" stroke-width="8"/>
                            <circle cx="60" cy="60" r="54" fill="none" stroke="url(#goldGrad)" stroke-width="8"
                                    stroke-dasharray="339.292" stroke-dashoffset="<?php echo 339.292 - (339.292 * $progression_percentage / 100); ?>"
                                    stroke-linecap="round" transform="rotate(-90 60 60)"/>
                            <defs><linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#D7BF81"/><stop offset="100%" stop-color="#BEA86E"/></linearGradient></defs>
                        </svg>
                        <div class="pm-progression-value"><span class="pm-prog-number"><?php echo round($progression_percentage); ?></span><span class="pm-prog-percent">%</span></div>
                    </div>
                    <div class="pm-progression-stats">
                        <div class="pm-prog-item"><span class="pm-prog-label">Articles Read</span><span class="pm-prog-value"><?php echo intval($user_data['total_articles_read']); ?></span></div>
                        <div class="pm-prog-item"><span class="pm-prog-label">Scores Downloaded</span><span class="pm-prog-value"><?php echo intval($user_data['total_scores_downloaded']); ?></span></div>
                        <div class="pm-prog-item"><span class="pm-prog-label">Practice Sessions</span><span class="pm-prog-value"><?php echo $total_practice_sessions; ?></span></div>
                        <div class="pm-prog-item"><span class="pm-prog-label">Games Played</span><span class="pm-prog-value"><?php echo $ni_games_played; ?></span></div>
                    </div>
                </div>
            </div>
        </div>

        <div class="pm-card pm-scores-card">
            <div class="pm-card-header"><h3><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> Score Overview</h3></div>
            <div class="pm-card-body">
                <div class="pm-dual-scores">
                    <div class="pm-score-block pm-score-learning">
                        <div class="pm-score-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></div>
                        <div class="pm-score-info">
                            <span class="pm-score-type">Learning Score</span>
                            <span class="pm-score-total"><?php echo number_format($total_learning_score); ?></span>
                            <span class="pm-score-detail">Best: <?php echo number_format($best_learning_session); ?></span>
                        </div>
                    </div>
                    <div class="pm-score-divider"></div>
                    <div class="pm-score-block pm-score-gaming">
                        <div class="pm-score-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><circle cx="15" cy="13" r="1"/><circle cx="18" cy="11" r="1"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.544-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/></svg></div>
                        <div class="pm-score-info">
                            <span class="pm-score-type">Gaming Score</span>
                            <span class="pm-score-total"><?php echo number_format($total_gaming_score); ?></span>
                            <span class="pm-score-detail">Best: <?php echo number_format($best_gaming_session); ?></span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Achievements -->
    <div class="pm-card pm-achievements-card">
        <div class="pm-card-header">
            <h3><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg> Achievements</h3>
            <span class="pm-badge-count"><?php echo count($achievements); ?> Unlocked</span>
        </div>
        <div class="pm-card-body">
            <?php if (!empty($achievements)): ?>
            <div class="pm-achievements-grid">
                <?php foreach ($achievements as $ach):
                    $ach_def = $achievement_lookup[$ach['achievement_id']] ?? null;
                    $ach_tier = $ach_def['tier'] ?? 'bronze';
                    $ach_icon = $ach_def['icon'] ?? 'star';
                ?>
                <div class="pm-achievement-item pm-ach-tier-<?php echo esc_attr($ach_tier); ?>">
                    <div class="pm-ach-badge"><?php echo function_exists('pianomode_render_badge_svg') ? pianomode_render_badge_svg($ach['achievement_id'], $ach_tier, $ach_icon, 48) : ''; ?></div>
                    <div class="pm-ach-info">
                        <span class="pm-ach-name"><?php echo esc_html($ach['achievement_name']); ?></span>
                        <span class="pm-ach-date"><?php echo date('M j, Y', strtotime($ach['earned_at'])); ?></span>
                    </div>
                </div>
                <?php endforeach; ?>
            </div>
            <?php else: ?>
            <div class="pm-empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
                <p>Start practicing to unlock achievements!</p>
            </div>
            <?php endif; ?>
        </div>
    </div>

    <!-- Favorite Articles & Scores -->
    <div class="pm-two-col">
        <div class="pm-card pm-favorites-card">
            <div class="pm-card-header">
                <h3><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> Favorite Articles</h3>
                <span class="pm-badge-count"><?php echo intval($favorite_posts_count); ?></span>
            </div>
            <div class="pm-card-body">
                <?php if (!empty($favorite_posts)): ?>
                <div class="pm-favorites-list">
                    <?php foreach ($favorite_posts as $post):
                        $thumb = get_the_post_thumbnail_url($post->ID, 'thumbnail');
                    ?>
                    <a href="<?php echo get_permalink($post->ID); ?>" class="pm-fav-item">
                        <?php if ($thumb): ?><img src="<?php echo esc_url($thumb); ?>" alt="" class="pm-fav-thumb"><?php endif; ?>
                        <span class="pm-fav-title"><?php echo esc_html($post->post_title); ?></span>
                    </a>
                    <?php endforeach; ?>
                </div>
                <?php else: ?>
                <div class="pm-empty-state"><p>No favorite articles yet</p><a href="/explore/" class="pm-btn-small">Explore</a></div>
                <?php endif; ?>
            </div>
        </div>

        <div class="pm-card pm-favorites-card">
            <div class="pm-card-header">
                <h3><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> Favorite Scores</h3>
                <span class="pm-badge-count"><?php echo intval($favorite_scores_count); ?></span>
            </div>
            <div class="pm-card-body">
                <?php if (!empty($favorite_scores)): ?>
                <div class="pm-favorites-list">
                    <?php foreach ($favorite_scores as $score_post):
                        $composers = wp_get_post_terms($score_post->ID, 'score_composer');
                        $comp = !empty($composers) && !is_wp_error($composers) ? $composers[0]->name : '';
                        $thumb = get_the_post_thumbnail_url($score_post->ID, 'thumbnail');
                    ?>
                    <a href="<?php echo get_permalink($score_post->ID); ?>" class="pm-fav-item">
                        <?php if ($thumb): ?><img src="<?php echo esc_url($thumb); ?>" alt="" class="pm-fav-thumb"><?php endif; ?>
                        <span class="pm-fav-title"><?php echo esc_html($score_post->post_title); ?></span>
                        <?php if ($comp): ?><span class="pm-fav-sub"><?php echo esc_html($comp); ?></span><?php endif; ?>
                    </a>
                    <?php endforeach; ?>
                </div>
                <?php else: ?>
                <div class="pm-empty-state"><p>No favorite scores yet</p><a href="/listen-and-play/" class="pm-btn-small">Browse Scores</a></div>
                <?php endif; ?>
            </div>
        </div>
    </div>

</div><!-- end profile tab -->

<!-- ==================== TAB: LEARNING ==================== -->
<div class="pm-tab-panel <?php echo $active_tab === 'learning' ? 'active' : ''; ?>" id="pm-tab-learning" role="tabpanel">

    <!-- LMS Stats Overview -->
    <div class="pm-lms-stats-grid">
        <div class="pm-lms-stat">
            <div class="pm-lms-stat-icon pm-lms-level">
                <span><?php echo $lms_stats['level_number']; ?></span>
            </div>
            <div class="pm-lms-stat-info">
                <span class="pm-lms-stat-label">Level <?php echo $lms_stats['level_number']; ?></span>
                <span class="pm-lms-stat-value"><?php echo esc_html($lms_stats['level']); ?></span>
                <?php if ($current_level_path): ?><span class="pm-lms-stat-sub"><?php echo ucfirst(esc_html($current_level_path)); ?> Path</span><?php endif; ?>
            </div>
        </div>
        <div class="pm-lms-stat">
            <div class="pm-lms-stat-icon pm-lms-hearts">
                <?php for ($i = 0; $i < 5; $i++): ?><span class="pm-heart <?php echo $i >= $lms_stats['hearts'] ? 'pm-heart-empty' : ''; ?>">&#10084;</span><?php endfor; ?>
            </div>
            <div class="pm-lms-stat-info">
                <span class="pm-lms-stat-label">Hearts</span>
                <span class="pm-lms-stat-value"><?php echo $lms_stats['hearts']; ?>/5</span>
            </div>
        </div>
        <div class="pm-lms-stat">
            <div class="pm-lms-stat-icon pm-lms-completed">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4caf50" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div class="pm-lms-stat-info">
                <span class="pm-lms-stat-label">Lessons Completed</span>
                <span class="pm-lms-stat-value"><?php echo count($completed_lessons); ?></span>
                <?php if ($lms_stats['in_progress_count'] > 0): ?><span class="pm-lms-stat-sub"><?php echo $lms_stats['in_progress_count']; ?> in progress</span><?php endif; ?>
            </div>
        </div>
        <div class="pm-lms-stat">
            <div class="pm-lms-stat-icon pm-lms-pct">
                <svg viewBox="0 0 36 36" width="48" height="48">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(0,0,0,0.06)" stroke-width="3"/>
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="#D7BF81" stroke-width="3" stroke-dasharray="<?php echo $completion_pct; ?> <?php echo 100 - $completion_pct; ?>" stroke-dashoffset="25" stroke-linecap="round"/>
                </svg>
                <span class="pm-lms-pct-val"><?php echo $completion_pct; ?>%</span>
            </div>
            <div class="pm-lms-stat-info">
                <span class="pm-lms-stat-label">Completion</span>
                <span class="pm-lms-stat-value"><?php echo count($completed_lessons); ?>/<?php echo $total_lessons; ?></span>
            </div>
        </div>
    </div>

    <!-- Daily Goal -->
    <div class="pm-card pm-daily-goal-card">
        <div class="pm-card-body">
            <div class="pm-daily-goal">
                <div class="pm-daily-goal-icon">&#127919;</div>
                <div class="pm-daily-goal-info">
                    <span class="pm-daily-goal-label">Daily Goal: <?php echo $lms_stats['daily_xp']; ?>/<?php echo $lms_stats['daily_goal']; ?> XP
                        <?php if ($lms_daily_pct >= 100): ?><span class="pm-daily-goal-done">&#10003; Complete!</span><?php endif; ?>
                    </span>
                    <div class="pm-daily-goal-bar">
                        <div class="pm-daily-goal-fill" style="width:<?php echo $lms_daily_pct; ?>%;<?php echo $lms_daily_pct >= 100 ? 'background:#4caf50;' : ''; ?>"></div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Continue Learning CTA -->
    <div class="pm-card pm-continue-card">
        <div class="pm-card-body">
            <div class="pm-continue-learning">
                <?php if ($last_lesson): ?>
                <div class="pm-continue-info">
                    <span class="pm-continue-label">Continue where you left off</span>
                    <h4 class="pm-continue-title"><?php echo esc_html($last_lesson['post_title'] ?? 'Your lesson'); ?></h4>
                </div>
                <a href="<?php echo esc_url(get_permalink($last_lesson['lesson_id'])); ?>" class="pm-btn-primary pm-continue-btn">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    Continue Learning
                </a>
                <?php else: ?>
                <div class="pm-continue-info">
                    <span class="pm-continue-label">Start your learning journey</span>
                    <h4 class="pm-continue-title">Explore our piano lessons</h4>
                </div>
                <a href="<?php echo home_url('/learn/'); ?>" class="pm-btn-primary pm-continue-btn">
                    Start Learning
                </a>
                <?php endif; ?>
            </div>
        </div>
    </div>

    <?php if (!$assessment_done): ?>
    <div class="pm-card pm-assessment-card">
        <div class="pm-card-body">
            <div class="pm-continue-learning">
                <div class="pm-continue-info">
                    <span class="pm-continue-label">Personalize your path</span>
                    <h4 class="pm-continue-title">Take the Level Assessment to get a customized learning path</h4>
                </div>
                <a href="<?php echo home_url('/level-assessment/'); ?>" class="pm-btn-outline">Find My Level</a>
            </div>
        </div>
    </div>
    <?php endif; ?>

    <!-- In-Progress Lessons -->
    <?php if (!empty($in_progress_lessons)): ?>
    <div class="pm-card">
        <div class="pm-card-header"><h3><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> In Progress</h3></div>
        <div class="pm-card-body">
            <div class="pm-lessons-list">
                <?php foreach ($in_progress_lessons as $lp): ?>
                <a href="<?php echo esc_url(get_permalink($lp['lesson_id'])); ?>" class="pm-lesson-item">
                    <div class="pm-lesson-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></div>
                    <div class="pm-lesson-info">
                        <span class="pm-lesson-title"><?php echo esc_html($lp['post_title'] ?? 'Lesson'); ?></span>
                        <span class="pm-lesson-meta"><?php echo human_time_diff(strtotime($lp['last_activity']), current_time('timestamp')); ?> ago</span>
                    </div>
                    <span class="pm-lesson-resume">Resume</span>
                </a>
                <?php endforeach; ?>
            </div>
        </div>
    </div>
    <?php endif; ?>

    <!-- Bookmarked Lessons -->
    <?php if (!empty($bookmarked_lessons)): ?>
    <div class="pm-card">
        <div class="pm-card-header"><h3><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> Bookmarked Lessons</h3></div>
        <div class="pm-card-body">
            <div class="pm-lessons-list">
                <?php foreach (array_slice($bookmarked_lessons, 0, 5) as $bm_id):
                    $bm_post = get_post($bm_id);
                    if (!$bm_post) continue;
                ?>
                <a href="<?php echo get_permalink($bm_id); ?>" class="pm-lesson-item">
                    <div class="pm-lesson-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></div>
                    <div class="pm-lesson-info"><span class="pm-lesson-title"><?php echo esc_html($bm_post->post_title); ?></span></div>
                </a>
                <?php endforeach; ?>
            </div>
        </div>
    </div>
    <?php endif; ?>

    <!-- Learning Achievements / Certificates -->
    <div class="pm-card pm-certificates-card">
        <div class="pm-card-header">
            <h3><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg> Learning Achievements</h3>
            <?php if (!empty($completed_lessons)): ?>
            <span class="pm-badge-count"><?php echo count($completed_lessons); ?> completed</span>
            <?php endif; ?>
        </div>
        <div class="pm-card-body">
            <?php
            // Badges showcase
            $learning_badges = array_filter($achievements, function($a) use ($achievement_lookup) {
                $def = $achievement_lookup[$a['achievement_id']] ?? null;
                return $def && isset($def['category']) && $def['category'] === 'learning';
            });
            if (!empty($learning_badges)): ?>
            <div class="pm-badges-showcase">
                <?php foreach ($learning_badges as $lb):
                    $ld = $achievement_lookup[$lb['achievement_id']] ?? null;
                ?>
                <div class="pm-badge-showcase-item">
                    <div class="pm-ach-badge"><?php echo function_exists('pianomode_render_badge_svg') ? pianomode_render_badge_svg($lb['achievement_id'], $ld['tier'] ?? 'bronze', $ld['icon'] ?? 'book', 48) : ''; ?></div>
                    <span class="pm-badge-name"><?php echo esc_html($lb['achievement_name']); ?></span>
                </div>
                <?php endforeach; ?>
            </div>
            <?php endif; ?>

            <?php
            // Completed lessons grouped by module
            if (!empty($completed_lessons)):
                $completed_by_module = array();
                foreach ($completed_lessons as $cl_id) {
                    $cl_post = get_post($cl_id);
                    if (!$cl_post) continue;
                    $cl_modules = get_the_terms($cl_id, 'pm_module');
                    $module_name = ($cl_modules && !is_wp_error($cl_modules)) ? $cl_modules[0]->name : 'General';
                    $module_slug = ($cl_modules && !is_wp_error($cl_modules)) ? $cl_modules[0]->slug : 'general';
                    if (!isset($completed_by_module[$module_slug])) {
                        $completed_by_module[$module_slug] = array('name' => $module_name, 'lessons' => array());
                    }
                    $completed_by_module[$module_slug]['lessons'][] = $cl_post;
                }
                foreach ($completed_by_module as $mod_slug => $mod_data): ?>
                <div class="pm-completed-module">
                    <h4 class="pm-completed-module-title">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                        <?php echo esc_html($mod_data['name']); ?>
                        <span style="font-weight:400;color:var(--pm-gray);font-size:12px;">(<?php echo count($mod_data['lessons']); ?>)</span>
                    </h4>
                    <div class="pm-lessons-list">
                        <?php foreach ($mod_data['lessons'] as $cl_post): ?>
                        <a href="<?php echo esc_url(get_permalink($cl_post->ID)); ?>" class="pm-completed-lesson-item">
                            <span class="pm-completed-check"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></span>
                            <span class="pm-completed-lesson-name"><?php echo esc_html($cl_post->post_title); ?></span>
                        </a>
                        <?php endforeach; ?>
                    </div>
                </div>
                <?php endforeach;
            else: ?>
            <div class="pm-empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
                <p>Complete lessons to earn learning badges and certificates!</p>
                <a href="<?php echo home_url('/learn/'); ?>" class="pm-btn-small">Start Learning</a>
            </div>
            <?php endif; ?>
        </div>
    </div>

    <!-- Quick Actions -->
    <div class="pm-lms-actions">
        <a href="<?php echo home_url('/learn/'); ?>" class="pm-btn-primary">Continue Learning</a>
        <a href="<?php echo home_url('/learning-path/'); ?>" class="pm-btn-outline">Browse All Paths</a>
    </div>

</div><!-- end learning tab -->

<!-- ==================== TAB: PLAY ==================== -->
<div class="pm-tab-panel <?php echo $active_tab === 'play' ? 'active' : ''; ?>" id="pm-tab-play" role="tabpanel">

    <!-- Gaming Stats Overview -->
    <div class="pm-stats-grid pm-stats-grid-compact">
        <div class="pm-stat-card">
            <div class="pm-stat-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><circle cx="15" cy="13" r="1"/><circle cx="18" cy="11" r="1"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.544-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/></svg></div>
            <div class="pm-stat-content">
                <div class="pm-stat-value"><?php echo $total_games_played + intval($sr_stats['total_sessions']); ?></div>
                <div class="pm-stat-label">Sessions</div>
            </div>
        </div>
        <div class="pm-stat-card">
            <div class="pm-stat-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
            <div class="pm-stat-content">
                <div class="pm-stat-value"><?php echo esc_html($learning_time_display); ?></div>
                <div class="pm-stat-label">Total Time</div>
            </div>
        </div>
        <div class="pm-stat-card">
            <div class="pm-stat-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></div>
            <div class="pm-stat-content">
                <div class="pm-stat-value"><?php echo $global_accuracy; ?>%</div>
                <div class="pm-stat-label">Accuracy</div>
            </div>
        </div>
        <div class="pm-stat-card">
            <div class="pm-stat-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
            <div class="pm-stat-content">
                <div class="pm-stat-value"><?php echo number_format($total_notes_all_games); ?></div>
                <div class="pm-stat-label">Notes</div>
            </div>
        </div>
    </div>

    <!-- Games Grid -->
    <div class="pm-card pm-games-card">
        <div class="pm-card-header">
            <h3><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><circle cx="15" cy="13" r="1"/><circle cx="18" cy="11" r="1"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.544-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/></svg> Games & Activities</h3>
            <a href="/play/" class="pm-btn-small">Play All</a>
        </div>
        <div class="pm-card-body">
            <div class="pm-games-grid">

                <!-- Note Invaders -->
                <div class="pm-game-stat-card">
                    <div class="pm-game-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15l2 5h2l1-3h6l1 3h2l2-5"/><path d="M6 15V8a6 6 0 0 1 12 0v7"/><circle cx="9" cy="11" r="1" fill="currentColor"/><circle cx="15" cy="11" r="1" fill="currentColor"/></svg></div>
                    <div class="pm-game-info">
                        <h4>Note Invaders</h4>
                        <div class="pm-game-stats">
                            <div class="pm-game-stat"><span class="pm-gs-value"><?php echo number_format($ni_high_score); ?></span><span class="pm-gs-label">High Score</span></div>
                            <div class="pm-game-stat"><span class="pm-gs-value"><?php echo $ni_best_wave; ?></span><span class="pm-gs-label">Best Wave</span></div>
                            <div class="pm-game-stat"><span class="pm-gs-value"><?php echo $ni_best_accuracy; ?>%</span><span class="pm-gs-label">Accuracy</span></div>
                        </div>
                    </div>
                    <a href="/note-invaders/" class="pm-game-play-btn">Play</a>
                </div>

                <!-- Sight Reading -->
                <div class="pm-game-stat-card">
                    <div class="pm-game-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></div>
                    <div class="pm-game-info">
                        <h4>Sight Reading</h4>
                        <div class="pm-game-stats">
                            <div class="pm-game-stat"><span class="pm-gs-value"><?php echo number_format($sr_stats['total_notes_played']); ?></span><span class="pm-gs-label">Notes</span></div>
                            <div class="pm-game-stat"><span class="pm-gs-value"><?php echo min(100, round($sr_stats['average_accuracy'], 1)); ?>%</span><span class="pm-gs-label">Accuracy</span></div>
                            <div class="pm-game-stat"><span class="pm-gs-value"><?php echo intval($sr_stats['best_streak']); ?></span><span class="pm-gs-label">Best Streak</span></div>
                        </div>
                    </div>
                    <a href="/sightreading-trainer/" class="pm-game-play-btn">Practice</a>
                </div>

                <!-- Ear Trainer -->
                <div class="pm-game-stat-card">
                    <div class="pm-game-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8.5a6.5 6.5 0 0 1 13 0c0 3-2 5-3 7s-1.5 4-1.5 6"/><path d="M14.5 21.5c0 .8-.7 1.5-1.5 1.5s-1.5-.7-1.5-1.5"/></svg></div>
                    <div class="pm-game-info">
                        <h4>Ear Trainer</h4>
                        <div class="pm-game-stats">
                            <div class="pm-game-stat"><span class="pm-gs-value"><?php echo intval($et_stats['total_sessions'] ?? 0); ?></span><span class="pm-gs-label">Sessions</span></div>
                            <div class="pm-game-stat"><span class="pm-gs-value"><?php echo $et_accuracy; ?>%</span><span class="pm-gs-label">Accuracy</span></div>
                            <div class="pm-game-stat"><span class="pm-gs-value"><?php echo intval($et_stats['best_streak'] ?? 0); ?></span><span class="pm-gs-label">Streak</span></div>
                        </div>
                    </div>
                    <div class="pm-game-actions">
                        <a href="/ear-trainer/" class="pm-game-play-btn">Train</a>
                        <a href="/ear-trainer/?review=all" class="pm-game-secondary-btn" id="pm-et-review-link">Review <span id="pm-et-review-count" class="pm-game-action-badge"></span></a>
                    </div>
                </div>

                <!-- Ledger Line Legend -->
                <div class="pm-game-stat-card">
                    <div class="pm-game-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="3" y1="8" x2="21" y2="8"/><line x1="3" y1="11" x2="21" y2="11"/><line x1="3" y1="14" x2="21" y2="14"/><line x1="3" y1="17" x2="21" y2="17"/><line x1="3" y1="20" x2="21" y2="20"/><ellipse cx="10" cy="5" rx="2.5" ry="2" fill="currentColor" transform="rotate(-15,10,5)"/></svg></div>
                    <div class="pm-game-info">
                        <h4>Ledger Line Legend</h4>
                        <div class="pm-game-stats">
                            <div class="pm-game-stat"><span class="pm-gs-value"><?php echo number_format($ll_high_score); ?></span><span class="pm-gs-label">Score</span></div>
                            <div class="pm-game-stat"><span class="pm-gs-value"><?php echo $ll_best_combo; ?></span><span class="pm-gs-label">Combo</span></div>
                            <div class="pm-game-stat"><span class="pm-gs-value"><?php echo $ll_best_accuracy; ?>%</span><span class="pm-gs-label">Accuracy</span></div>
                        </div>
                    </div>
                    <a href="/ledger-line-legend/" class="pm-game-play-btn">Play</a>
                </div>

                <!-- Piano Hero -->
                <div class="pm-game-stat-card">
                    <div class="pm-game-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><polygon points="20 2 20.8 4 23 4 21.2 5.5 21.8 7.5 20 6.2 18.2 7.5 18.8 5.5 17 4 19.2 4" fill="currentColor" stroke="none"/></svg></div>
                    <div class="pm-game-info">
                        <h4>Piano Hero</h4>
                        <div class="pm-game-stats">
                            <div class="pm-game-stat"><span class="pm-gs-value"><?php echo number_format($ph_best_learn); ?></span><span class="pm-gs-label">Learn</span></div>
                            <div class="pm-game-stat"><span class="pm-gs-value"><?php echo number_format($ph_best_game); ?></span><span class="pm-gs-label">Game</span></div>
                        </div>
                    </div>
                    <a href="/piano-hero/" class="pm-game-play-btn">Play</a>
                </div>

                <!-- Virtual Piano -->
                <div class="pm-game-stat-card">
                    <div class="pm-game-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="6" width="20" height="14" rx="1.5"/><line x1="5.14" y1="6" x2="5.14" y2="20"/><line x1="8.28" y1="6" x2="8.28" y2="20"/><line x1="11.42" y1="6" x2="11.42" y2="20"/><line x1="14.56" y1="6" x2="14.56" y2="20"/><line x1="17.7" y1="6" x2="17.7" y2="20"/><rect x="4" y="6" width="1.6" height="8" rx="0.3" fill="currentColor"/><rect x="7.1" y="6" width="1.6" height="8" rx="0.3" fill="currentColor"/><rect x="13.4" y="6" width="1.6" height="8" rx="0.3" fill="currentColor"/><rect x="16.5" y="6" width="1.6" height="8" rx="0.3" fill="currentColor"/></svg></div>
                    <div class="pm-game-info">
                        <h4>Virtual Piano</h4>
                        <div class="pm-game-stats">
                            <div class="pm-game-stat"><span class="pm-gs-value"><?php echo number_format($vp_notes); ?></span><span class="pm-gs-label">Notes</span></div>
                            <div class="pm-game-stat"><span class="pm-gs-value"><?php echo number_format($vp_time_minutes); ?>m</span><span class="pm-gs-label">Time</span></div>
                        </div>
                    </div>
                    <a href="/virtual-piano/" class="pm-game-play-btn">Play</a>
                </div>

            </div>
        </div>
    </div>

    <!-- Score Overview for Play tab -->
    <div class="pm-card pm-scores-card">
        <div class="pm-card-header"><h3><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> Score Overview</h3></div>
        <div class="pm-card-body">
            <div class="pm-dual-scores">
                <div class="pm-score-block pm-score-learning">
                    <div class="pm-score-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></div>
                    <div class="pm-score-info">
                        <span class="pm-score-type">Learning</span>
                        <span class="pm-score-total"><?php echo number_format($total_learning_score); ?></span>
                    </div>
                </div>
                <div class="pm-score-divider"></div>
                <div class="pm-score-block pm-score-gaming">
                    <div class="pm-score-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
                    <div class="pm-score-info">
                        <span class="pm-score-type">Gaming</span>
                        <span class="pm-score-total"><?php echo number_format($total_gaming_score); ?></span>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Recent Practice Sessions -->
    <?php if (!empty($recent_sessions)): ?>
    <div class="pm-card">
        <div class="pm-card-header"><h3><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Recent Sessions</h3></div>
        <div class="pm-card-body">
            <div class="pm-sessions-list">
                <?php foreach ($recent_sessions as $session): ?>
                <div class="pm-session-item">
                    <div class="pm-session-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
                    <div class="pm-session-info">
                        <span class="pm-session-notes"><?php echo $session['notes_played']; ?> notes</span>
                        <span class="pm-session-accuracy <?php echo floatval($session['accuracy']) >= 80 ? 'good' : ''; ?>"><?php echo min(100, round($session['accuracy'], 1)); ?>%</span>
                    </div>
                    <div class="pm-session-meta"><?php echo human_time_diff(strtotime($session['session_date']), current_time('timestamp')); ?> ago</div>
                </div>
                <?php endforeach; ?>
            </div>
        </div>
    </div>
    <?php endif; ?>

</div><!-- end play tab -->

            </div><!-- end tab-content-area -->

            <!-- ==================== QUICK ACCESS SIDEBAR (persistent) ==================== -->
            <aside class="pm-sidebar">
                <div class="pm-card pm-quick-access-card">
                    <div class="pm-card-header">
                        <h3><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Quick Access</h3>
                    </div>
                    <div class="pm-card-body">
                        <div class="pm-quick-links">
                            <a href="/listen-and-play/" class="pm-quick-link">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                                <span>Sheet Music</span>
                            </a>
                            <a href="/explore/" class="pm-quick-link">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                                <span>Explore Articles</span>
                            </a>
                            <a href="/learn/" class="pm-quick-link">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                                <span>Piano Lessons</span>
                            </a>
                            <a href="/play/" class="pm-quick-link">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><circle cx="15" cy="13" r="1"/><circle cx="18" cy="11" r="1"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.544-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/></svg>
                                <span>Play Games</span>
                            </a>

                            <div class="pm-quick-divider"></div>
                            <p class="pm-quick-section-label">Practice Tools</p>

                            <a href="/virtual-piano/" class="pm-quick-link pm-quick-secondary">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="6" width="20" height="14" rx="1.5"/><rect x="4" y="6" width="1.6" height="8" rx="0.3" fill="currentColor"/><rect x="7.1" y="6" width="1.6" height="8" rx="0.3" fill="currentColor"/><rect x="13.4" y="6" width="1.6" height="8" rx="0.3" fill="currentColor"/><rect x="16.5" y="6" width="1.6" height="8" rx="0.3" fill="currentColor"/></svg>
                                <span>Virtual Piano</span>
                            </a>
                            <a href="/piano-hero/" class="pm-quick-link pm-quick-secondary">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                                <span>Piano Hero</span>
                            </a>
                            <a href="/sightreading-trainer/" class="pm-quick-link pm-quick-secondary">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                <span>Sight Reading</span>
                            </a>
                            <a href="/ear-trainer/" class="pm-quick-link pm-quick-secondary">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8.5a6.5 6.5 0 0 1 13 0c0 3-2 5-3 7s-1.5 4-1.5 6"/></svg>
                                <span>Ear Trainer</span>
                            </a>

                            <div class="pm-quick-divider"></div>

                            <a href="/about-us/" class="pm-quick-link pm-quick-tertiary">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                                <span>About Us</span>
                            </a>
                            <a href="/contact-us/" class="pm-quick-link pm-quick-tertiary">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                                <span>Contact Us</span>
                            </a>
                        </div>
                    </div>
                </div>

                <!-- Stats Summary -->
                <div class="pm-card pm-stats-summary-card">
                    <div class="pm-card-header">
                        <h3><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> Your Stats</h3>
                    </div>
                    <div class="pm-card-body">
                        <div class="pm-stats-summary">
                            <div class="pm-sum-item"><span class="pm-sum-label">Total XP</span><span class="pm-sum-value"><?php echo number_format($xp); ?></span></div>
                            <div class="pm-sum-item"><span class="pm-sum-label">Level</span><span class="pm-sum-value pm-gold"><?php echo $level; ?></span></div>
                            <div class="pm-sum-item"><span class="pm-sum-label">Articles</span><span class="pm-sum-value"><?php echo intval($user_data['total_articles_read']); ?></span></div>
                            <div class="pm-sum-item"><span class="pm-sum-label">Scores</span><span class="pm-sum-value"><?php echo intval($user_data['total_scores_downloaded']); ?></span></div>
                            <div class="pm-sum-item"><span class="pm-sum-label">Notes</span><span class="pm-sum-value"><?php echo number_format($total_notes_all_games); ?></span></div>
                            <div class="pm-sum-item"><span class="pm-sum-label">Learning Time</span><span class="pm-sum-value pm-gold"><?php echo esc_html($learning_time_display); ?></span></div>
                        </div>
                    </div>
                </div>

                <!-- Latest Articles -->
                <div class="pm-card pm-latest-card">
                    <div class="pm-card-header">
                        <h3><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg> Latest Articles</h3>
                        <a href="/explore/" class="pm-link-small">View All</a>
                    </div>
                    <div class="pm-card-body">
                        <?php
                        $latest_posts = new WP_Query(array('post_type' => 'post', 'posts_per_page' => 3, 'post_status' => 'publish'));
                        if ($latest_posts->have_posts()): ?>
                        <div class="pm-latest-list">
                            <?php while ($latest_posts->have_posts()): $latest_posts->the_post(); ?>
                            <a href="<?php the_permalink(); ?>" class="pm-latest-item">
                                <?php if (has_post_thumbnail()): ?><div class="pm-latest-thumb"><?php the_post_thumbnail('thumbnail'); ?></div><?php endif; ?>
                                <div class="pm-latest-info"><h4><?php the_title(); ?></h4><span class="pm-latest-date"><?php echo get_the_date('M j'); ?></span></div>
                            </a>
                            <?php endwhile; wp_reset_postdata(); ?>
                        </div>
                        <?php else: ?>
                        <p class="pm-no-content">No articles yet</p>
                        <?php endif; ?>
                    </div>
                </div>
            </aside>

        </div><!-- end main-layout -->
    </div><!-- end container -->

    <!-- ==================== SETTINGS MODAL ==================== -->
    <div class="pm-settings-overlay" id="pm-settings-modal" style="display:none;">
        <div class="pm-settings-modal">
            <div class="pm-settings-header">
                <h3>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852 1 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                    Settings
                </h3>
                <button class="pm-settings-close" id="pm-settings-close">&times;</button>
            </div>
            <div class="pm-settings-body">

                <!-- Profile Section -->
                <div class="pm-settings-section">
                    <h4 class="pm-settings-section-title">Profile</h4>
                    <div class="pm-settings-item">
                        <div class="pm-settings-item-info">
                            <span class="pm-settings-item-label">Display Name</span>
                            <span class="pm-settings-item-value" id="pm-display-name-text"><?php echo esc_html($display_name); ?></span>
                        </div>
                        <button class="pm-edit-name-btn" id="pm-edit-name-btn" title="Edit display name">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                        </button>
                    </div>
                    <div class="pm-display-name-edit" id="pm-display-name-edit" style="display:none;">
                        <input type="text" class="pm-input" id="pm-display-name-input" value="<?php echo esc_attr($display_name); ?>" maxlength="50" placeholder="Your display name">
                        <button class="pm-btn-save-name" id="pm-save-name-btn">Save</button>
                        <button class="pm-btn-outline pm-btn-sm" id="pm-cancel-name-btn" style="padding:8px 12px;">Cancel</button>
                    </div>
                    <div class="pm-settings-item">
                        <div class="pm-settings-item-info">
                            <span class="pm-settings-item-label">Email</span>
                            <span class="pm-settings-item-value"><?php echo esc_html($user->user_email); ?></span>
                        </div>
                    </div>
                    <div class="pm-settings-item">
                        <div class="pm-settings-item-info">
                            <span class="pm-settings-item-label">Member Since</span>
                            <span class="pm-settings-item-value"><?php echo date('F j, Y', strtotime($user->user_registered)); ?></span>
                        </div>
                    </div>
                </div>

                <!-- Preferences Section -->
                <div class="pm-settings-section">
                    <h4 class="pm-settings-section-title">Preferences</h4>
                    <div class="pm-settings-item pm-settings-toggle">
                        <div class="pm-settings-item-info">
                            <span class="pm-settings-item-label">Challenge Difficulty</span>
                            <span class="pm-settings-item-desc">Set default difficulty for daily challenges</span>
                        </div>
                        <select id="pm-settings-difficulty" class="pm-settings-select">
                            <option value="beginner" <?php selected(get_user_meta($user_id, 'pm_challenge_difficulty', true) ?: 'beginner', 'beginner'); ?>>Beginner</option>
                            <option value="intermediate" <?php selected(get_user_meta($user_id, 'pm_challenge_difficulty', true), 'intermediate'); ?>>Intermediate</option>
                            <option value="advanced" <?php selected(get_user_meta($user_id, 'pm_challenge_difficulty', true), 'advanced'); ?>>Advanced</option>
                        </select>
                    </div>
                    <div class="pm-settings-item pm-settings-toggle">
                        <div class="pm-settings-item-info">
                            <span class="pm-settings-item-label">Daily XP Goal</span>
                            <span class="pm-settings-item-desc">Your daily learning target</span>
                        </div>
                        <select id="pm-settings-daily-goal" class="pm-settings-select">
                            <option value="15" <?php selected(get_user_meta($user_id, 'pm_daily_goal', true) ?: '30', '15'); ?>>15 XP (Casual)</option>
                            <option value="30" <?php selected(get_user_meta($user_id, 'pm_daily_goal', true) ?: '30', '30'); ?>>30 XP (Regular)</option>
                            <option value="50" <?php selected(get_user_meta($user_id, 'pm_daily_goal', true), '50'); ?>>50 XP (Serious)</option>
                            <option value="100" <?php selected(get_user_meta($user_id, 'pm_daily_goal', true), '100'); ?>>100 XP (Intense)</option>
                        </select>
                    </div>
                    <div class="pm-settings-item pm-settings-toggle">
                        <div class="pm-settings-item-info">
                            <span class="pm-settings-item-label">Email Notifications</span>
                            <span class="pm-settings-item-desc">Receive updates about your progress</span>
                        </div>
                        <label class="pm-toggle">
                            <input type="checkbox" id="pm-settings-emails" <?php checked(get_user_meta($user_id, 'pm_email_notifications', true) !== '0'); ?>>
                            <span class="pm-toggle-slider"></span>
                        </label>
                    </div>
                </div>

                <!-- Security Section -->
                <div class="pm-settings-section">
                    <h4 class="pm-settings-section-title">Security</h4>
                    <div class="pm-settings-item">
                        <div class="pm-settings-item-info">
                            <span class="pm-settings-item-label">Change Password</span>
                            <span class="pm-settings-item-desc">Update your account password</span>
                        </div>
                        <button class="pm-btn-outline pm-btn-sm" id="pm-change-password-btn">Change</button>
                    </div>

                    <!-- Change Password Form (hidden by default) -->
                    <div class="pm-change-password-form" id="pm-change-password-form" style="display:none;">
                        <div class="pm-form-group">
                            <label>Current Password</label>
                            <input type="password" id="pm-current-password" class="pm-input" autocomplete="current-password">
                        </div>
                        <div class="pm-form-group">
                            <label>New Password</label>
                            <input type="password" id="pm-new-password" class="pm-input" autocomplete="new-password">
                        </div>
                        <div class="pm-form-group">
                            <label>Confirm New Password</label>
                            <input type="password" id="pm-confirm-password" class="pm-input" autocomplete="new-password">
                        </div>
                        <div class="pm-form-actions">
                            <button class="pm-btn-primary pm-btn-sm" id="pm-save-password-btn">Save Password</button>
                            <button class="pm-btn-outline pm-btn-sm" id="pm-cancel-password-btn">Cancel</button>
                        </div>
                        <div class="pm-form-message" id="pm-password-message"></div>
                    </div>
                </div>

                <!-- Danger Zone -->
                <div class="pm-settings-section pm-settings-danger">
                    <h4 class="pm-settings-section-title">Danger Zone</h4>
                    <div class="pm-settings-item">
                        <div class="pm-settings-item-info">
                            <span class="pm-settings-item-label">Delete Account</span>
                            <span class="pm-settings-item-desc">Permanently delete your account and all associated data. This action cannot be undone.</span>
                        </div>
                        <button class="pm-btn-danger pm-btn-sm" id="pm-delete-account-btn">Delete Account</button>
                    </div>

                    <!-- Delete Confirmation (hidden) -->
                    <div class="pm-delete-confirm" id="pm-delete-confirm" style="display:none;">
                        <div class="pm-delete-warning">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#e53e3e" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                            <p>This will permanently delete:</p>
                            <ul>
                                <li>Your profile and all personal data</li>
                                <li>All game scores and statistics</li>
                                <li>Your learning progress and achievements</li>
                                <li>All favorites and bookmarks</li>
                            </ul>
                        </div>
                        <div class="pm-form-group">
                            <label>Type <strong>DELETE</strong> to confirm:</label>
                            <input type="text" id="pm-delete-confirm-input" class="pm-input" placeholder="Type DELETE">
                        </div>
                        <div class="pm-form-actions">
                            <button class="pm-btn-danger pm-btn-sm" id="pm-confirm-delete-btn" disabled>Delete My Account</button>
                            <button class="pm-btn-outline pm-btn-sm" id="pm-cancel-delete-btn">Cancel</button>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    </div>

</div><!-- end pm-dashboard-wrapper -->

<!-- ==================== DASHBOARD SCRIPTS ==================== -->
<script>
jQuery(document).ready(function($) {
    // === Tab Navigation ===
    var $tabs = $('.pm-tab-btn');
    var $panels = $('.pm-tab-panel');
    var $indicator = $('.pm-tab-indicator');

    function switchTab(tab) {
        $tabs.removeClass('active').attr('aria-selected', 'false');
        $panels.removeClass('active');
        $tabs.filter('[data-tab="' + tab + '"]').addClass('active').attr('aria-selected', 'true');
        $('#pm-tab-' + tab).addClass('active');
        updateIndicator();
        // Update URL without reload
        var url = new URL(window.location);
        url.searchParams.set('tab', tab);
        history.replaceState(null, '', url);
    }

    function updateIndicator() {
        var $active = $tabs.filter('.active');
        if ($active.length && $indicator.length) {
            $indicator.css({
                left: $active.position().left + 'px',
                width: $active.outerWidth() + 'px'
            });
        }
    }

    $tabs.on('click', function() { switchTab($(this).data('tab')); });
    updateIndicator();
    $(window).on('resize', updateIndicator);

    // === XP Bar Animation ===
    setTimeout(function() {
        $('.pm-xp-fill').each(function() {
            $(this).css('width', $(this).data('width') + '%');
        });
    }, 300);

    // === Settings Modal ===
    $('#pm-settings-btn').on('click', function() {
        $('#pm-settings-modal').fadeIn(200);
        $('body').css('overflow', 'hidden');
    });
    $('#pm-settings-close, #pm-settings-modal').on('click', function(e) {
        if (e.target === this) {
            $('#pm-settings-modal').fadeOut(200);
            $('body').css('overflow', '');
        }
    });

    // === Settings: Change Password ===
    $('#pm-change-password-btn').on('click', function() { $('#pm-change-password-form').slideDown(200); $(this).hide(); });
    $('#pm-cancel-password-btn').on('click', function() { $('#pm-change-password-form').slideUp(200); $('#pm-change-password-btn').show(); });
    $('#pm-save-password-btn').on('click', function() {
        var cur = $('#pm-current-password').val(), np = $('#pm-new-password').val(), cp = $('#pm-confirm-password').val();
        var $msg = $('#pm-password-message');
        if (!cur || !np || !cp) { $msg.text('All fields required').addClass('error').show(); return; }
        if (np.length < 8) { $msg.text('Min 8 characters').addClass('error').show(); return; }
        if (np !== cp) { $msg.text('Passwords do not match').addClass('error').show(); return; }
        $.post(pmAccountData.ajax_url, { action: 'pm_change_password', nonce: pmAccountData.nonce, current_password: cur, new_password: np }, function(r) {
            if (r.success) { $msg.text('Password updated!').removeClass('error').addClass('success').show(); setTimeout(function() { $('#pm-change-password-form').slideUp(200); $('#pm-change-password-btn').show(); }, 1500); }
            else { $msg.text(r.data || 'Error').addClass('error').show(); }
        });
    });

    // === Settings: Save Preferences ===
    $('#pm-settings-difficulty, #pm-settings-daily-goal').on('change', function() {
        $.post(pmAccountData.ajax_url, { action: 'pm_save_settings', nonce: pmAccountData.nonce, key: this.id.replace('pm-settings-', ''), value: $(this).val() });
    });
    $('#pm-settings-emails').on('change', function() {
        $.post(pmAccountData.ajax_url, { action: 'pm_save_settings', nonce: pmAccountData.nonce, key: 'email_notifications', value: this.checked ? '1' : '0' });
    });

    // === Settings: Delete Account ===
    $('#pm-delete-account-btn').on('click', function() { $('#pm-delete-confirm').slideDown(200); $(this).hide(); });
    $('#pm-cancel-delete-btn').on('click', function() { $('#pm-delete-confirm').slideUp(200); $('#pm-delete-account-btn').show(); });
    $('#pm-delete-confirm-input').on('input', function() {
        $('#pm-confirm-delete-btn').prop('disabled', $(this).val() !== 'DELETE');
    });
    $('#pm-confirm-delete-btn').on('click', function() {
        $(this).prop('disabled', true).text('Deleting...');
        $.post(pmAccountData.ajax_url, { action: 'pm_delete_account', nonce: pmAccountData.nonce, confirm: $('#pm-delete-confirm-input').val() }, function(r) {
            if (r.success) { window.location.href = '/'; }
            else { alert(r.data || 'Error deleting account'); }
        });
    });

    // === Ear Trainer review count from localStorage ===
    try {
        var store = JSON.parse(localStorage.getItem('pm_ear_trainer_data') || '{}');
        var rc = (store.reviewQueue || []).length;
        var ce = document.getElementById('pm-et-review-count');
        var rl = document.getElementById('pm-et-review-link');
        if (ce) ce.textContent = rc > 0 ? rc : '';
        if (rl && rc === 0) rl.style.display = 'none';
    } catch(e) {}

    // === Auto-refresh from game session ===
    try {
        var cts = parseInt(localStorage.getItem('pm_challenge_updated') || '0');
        var dts = parseInt(sessionStorage.getItem('pm_dashboard_loaded') || '0');
        if (cts > dts && dts > 0) { sessionStorage.setItem('pm_dashboard_loaded', Date.now().toString()); window.location.reload(); return; }
        sessionStorage.setItem('pm_dashboard_loaded', Date.now().toString());
    } catch(e) {}

    // === Timezone day labels for challenges ===
    var now = new Date(), isoDay = now.getDay() === 0 ? 7 : now.getDay();
    var labels = {1:'Mon',2:'Tue',3:'Wed',4:'Thu',5:'Fri',6:'Sat',7:'Sun'};
    $('.pm-dc-node-day').each(function() {
        var d = parseInt($(this).data('server-day'));
        if (labels[d]) $(this).text(d === isoDay ? 'Today' : labels[d]);
    });

    // === Display Name Edit ===
    $('#pm-edit-name-btn').on('click', function() {
        $(this).closest('.pm-settings-item').hide();
        $('#pm-display-name-edit').slideDown(200);
        $('#pm-display-name-input').focus();
    });
    $('#pm-cancel-name-btn').on('click', function() {
        $('#pm-display-name-edit').slideUp(200);
        $('#pm-edit-name-btn').closest('.pm-settings-item').show();
    });
    $('#pm-save-name-btn').on('click', function() {
        var newName = $.trim($('#pm-display-name-input').val());
        if (!newName || newName.length < 2) { alert('Name must be at least 2 characters'); return; }
        var $btn = $(this);
        $btn.prop('disabled', true).text('Saving...');
        $.post(pmAccountData.ajax_url, {
            action: 'pm_save_settings', nonce: pmAccountData.nonce,
            key: 'display_name', value: newName
        }, function(r) {
            $btn.prop('disabled', false).text('Save');
            if (r.success) {
                $('#pm-display-name-text').text(newName);
                $('.pm-username').text(newName);
                $('#pm-display-name-edit').slideUp(200);
                $('#pm-edit-name-btn').closest('.pm-settings-item').show();
            } else {
                alert(r.data || 'Error saving name');
            }
        });
    });
});
</script>

<?php
// Badge notification
$last_badge_check = get_user_meta($user_id, 'pm_last_badge_notif_check', true) ?: '2020-01-01 00:00:00';
$new_badges = $wpdb->get_results($wpdb->prepare(
    "SELECT achievement_id, achievement_name, earned_at FROM {$table_prefix}achievements
     WHERE user_id = %d AND earned_at > %s ORDER BY earned_at DESC LIMIT 5",
    $user_id, $last_badge_check
), ARRAY_A);
update_user_meta($user_id, 'pm_last_badge_notif_check', current_time('mysql'));

if (!empty($new_badges)):
    $all_ach_for_notif = function_exists('pianomode_get_all_achievements') ? pianomode_get_all_achievements() : array();
    $notif_lookup = array();
    foreach ($all_ach_for_notif as $ad) { $notif_lookup[$ad['id']] = $ad; }
?>
<div class="pm-badge-notif-overlay" id="pmBadgeNotif">
    <div class="pm-badge-notif-modal">
        <button class="pm-badge-notif-close" onclick="document.getElementById('pmBadgeNotif').classList.remove('active')">&times;</button>
        <div class="pm-badge-notif-sparkles"><span></span><span></span><span></span><span></span><span></span><span></span></div>
        <div class="pm-badge-notif-title">Congratulations!</div>
        <div class="pm-badge-notif-subtitle">You earned <?php echo count($new_badges) > 1 ? 'new badges' : 'a new badge'; ?>!</div>
        <div class="pm-badge-notif-list">
            <?php foreach ($new_badges as $nb):
                $nd = $notif_lookup[$nb['achievement_id']] ?? null;
                if (!$nd) continue;
            ?>
            <div class="pm-badge-notif-item">
                <div class="pm-badge-notif-badge"><?php echo function_exists('pianomode_render_badge_svg') ? pianomode_render_badge_svg($nb['achievement_id'], $nd['tier'], $nd['icon'], 72) : ''; ?></div>
                <div class="pm-badge-notif-info">
                    <span class="pm-badge-notif-name"><?php echo esc_html($nb['achievement_name']); ?></span>
                    <span class="pm-badge-notif-cond"><?php echo esc_html($nd['condition']); ?></span>
                </div>
            </div>
            <?php endforeach; ?>
        </div>
    </div>
</div>
<script>setTimeout(function(){ var n=document.getElementById('pmBadgeNotif'); if(n){n.classList.add('active'); setTimeout(function(){n.classList.remove('active');},8000);} },800);</script>
<?php endif; ?>

<?php
update_user_meta($user_id, 'pm_last_dashboard_view', current_time('mysql'));
?>