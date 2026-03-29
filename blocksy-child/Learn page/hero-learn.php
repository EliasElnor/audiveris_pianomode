<?php
/**
 * Hero Learn - PianoMode
 * Hero section styled like Listen & Play hero
 *
 * @package PianoMode
 * @version 4.0.0
 */

if (!defined('ABSPATH')) exit;

/**
 * Fonction locale : Récupérer images background
 */
if (!function_exists('pianomode_hero_learn_get_images')) {
    function pianomode_hero_learn_get_images() {
        $cache_key = 'pianomode_learn_hero_images_v4';
        $cached = get_transient($cache_key);

        if (false !== $cached) {
            return $cached;
        }

        $images = array();

        // Récupérer images depuis scores
        $score_query = new WP_Query(array(
            'post_type' => 'score',
            'posts_per_page' => 8,
            'orderby' => 'rand',
            'post_status' => 'publish',
            'meta_query' => array(
                array(
                    'key' => '_thumbnail_id',
                    'compare' => 'EXISTS'
                )
            )
        ));

        if ($score_query->have_posts()) {
            while ($score_query->have_posts()) {
                $score_query->the_post();
                $image_url = get_the_post_thumbnail_url(get_the_ID(), 'large');
                if ($image_url && !empty($image_url)) {
                    $images[] = esc_url($image_url);
                }
            }
            wp_reset_postdata();
        }

        // Fallback images
        $fallback_images = array(
            'https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?w=800&q=90&fm=webp&auto=format&fit=crop',
            'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&q=90&fm=webp&auto=format&fit=crop',
            'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=90&fm=webp&auto=format&fit=crop',
            'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=800&q=90&fm=webp&auto=format&fit=crop',
            'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=800&q=90&fm=webp&auto=format&fit=crop',
            'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&q=90&fm=webp&auto=format&fit=crop'
        );

        while (count($images) < 6) {
            $images[] = $fallback_images[count($images) % count($fallback_images)];
        }

        set_transient($cache_key, $images, 12 * HOUR_IN_SECONDS);
        return $images;
    }
}

// Récupérer les images
$background_images = pianomode_hero_learn_get_images();
$unique_id = 'hero-learn-' . substr(md5(uniqid()), 0, 8);
?>

<section class="pianomode-hero-learn" id="<?php echo esc_attr($unique_id); ?>">
    <!-- Background avec images de partitions aléatoires -->
    <div class="pianomode-hero-background">
        <div class="pianomode-score-images">
            <?php foreach ($background_images as $index => $image_url) : ?>
                <div class="pianomode-score-image"
                     style="background-image: url('<?php echo esc_url($image_url); ?>')"
                     data-index="<?php echo esc_attr($index); ?>">
                </div>
            <?php endforeach; ?>
        </div>
    </div>

    <!-- Overlay sombre -->
    <div class="pianomode-hero-overlay"></div>

    <!-- Notes musicales flottantes -->
    <div class="pianomode-floating-notes">
        <div class="pianomode-note">&#119070;</div>
        <div class="pianomode-note">&#9835;</div>
        <div class="pianomode-note">&#119074;</div>
        <div class="pianomode-note">&#9834;</div>
        <div class="pianomode-note">&#9833;</div>
        <div class="pianomode-note">&#9839;</div>
        <div class="pianomode-note">&#9836;</div>
        <div class="pianomode-note">&#119073;</div>
        <div class="pianomode-note">&#9837;</div>
        <div class="pianomode-note">&#119070;</div>
    </div>

    <!-- Contenu principal -->
    <div class="pianomode-hero-content">
        <div class="pianomode-hero-badge">
            Piano Learning Platform
        </div>

        <h1 class="pianomode-hero-title">
            <span class="pianomode-hero-title-main">Master the Piano</span>
            <span class="pianomode-hero-title-accent">Your Way</span>
        </h1>

        <p class="pianomode-hero-subtitle">
            Discover personalized learning paths, practice resources, and track your progress.
            Build your skills step by step with a platform designed for pianists of all levels.
        </p>

        <!-- Navigation Buttons - Scrolling to sections -->
        <div class="pianomode-hero-buttons">
            <button type="button"
                    class="pianomode-hero-btn pianomode-hero-btn-primary"
                    onclick="scrollToSection('pmPianoSec')"
                    aria-label="Start Learning">
                <span class="btn-icon-left">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
                        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
                        <path d="M2 2l7.586 7.586"></path>
                        <circle cx="11" cy="11" r="2"></circle>
                    </svg>
                </span>
                <span>Start Learning</span>
                <span class="btn-icon-right">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 18l6-6-6-6"></path>
                    </svg>
                </span>
            </button>

            <button type="button"
                    class="pianomode-hero-btn pianomode-hero-btn-secondary"
                    onclick="scrollToSection('pmResourcesSec')"
                    aria-label="View Resources">
                <span class="btn-icon-left">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                    </svg>
                </span>
                <span>Resources</span>
                <span class="btn-icon-right">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 18l6-6-6-6"></path>
                    </svg>
                </span>
            </button>

            <a href="<?php echo home_url('/level-assessment/'); ?>"
                    class="pianomode-hero-btn pianomode-hero-btn-tertiary"
                    aria-label="Find your piano level">
                <span class="btn-icon-left">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 11l3 3L22 4"></path>
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                    </svg>
                </span>
                <span>What's My Level?</span>
                <span class="btn-icon-right">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 18l6-6-6-6"></path>
                    </svg>
                </span>
            </a>
        </div>
    </div>
</section>

<script>
(function() {
    'use strict';

    // Global scroll function
    window.scrollToSection = function(sectionId) {
        const section = document.getElementById(sectionId);
        if (section) {
            // Also activate the corresponding tab
            const tabBtn = document.querySelector(`[data-tab="${sectionId.replace('tab', '').toLowerCase()}"]`);
            if (tabBtn) {
                tabBtn.click();
            }

            setTimeout(() => {
                section.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }
    };
})();
</script>