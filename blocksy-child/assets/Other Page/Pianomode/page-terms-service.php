<?php
/**
 * Template Name: Terms of Service & Disclaimers
 * Template for Terms of Service page - PianoMode
 * Path: blocksy-child/assets/Other Page/Pianomode/page-terms-service.php
 */

if (!defined('ABSPATH')) {
    exit;
}

get_header();
?>

<!-- Enqueue Terms of Service styles -->
<link rel="stylesheet" href="<?php echo get_stylesheet_directory_uri(); ?>/assets/Other Page/Pianomode/terms-service.css">

<!-- HERO TERMS OF SERVICE -->
<section class="pianomode-hero-terms" id="hero-terms">
    <!-- Background avec image -->
    <div class="pianomode-hero-background">
        <img src="https://pianomode.com/wp-content/uploads/2025/05/Piano-Lesson-Posture.webp"
             alt="Terms of Service"
             class="pianomode-hero-bg-img">
    </div>

    <!-- Overlay sombre -->
    <div class="pianomode-hero-overlay"></div>

    <!-- Notes musicales flottantes -->
    <div class="pianomode-floating-notes">
        <div class="pianomode-note">&#9834;</div>
        <div class="pianomode-note">&#9835;</div>
        <div class="pianomode-note">&#9836;</div>
        <div class="pianomode-note">&#9833;</div>
        <div class="pianomode-note">&#9834;</div>
        <div class="pianomode-note">&#9835;</div>
    </div>

    <!-- Contenu principal -->
    <div class="pianomode-hero-content">
        <div class="pianomode-hero-badge">
            Legal Terms
        </div>

        <h1 class="pianomode-hero-title">
            <span class="pianomode-hero-title-main">Terms of Service &</span>
            <span class="pianomode-hero-title-accent">Disclaimers</span>
        </h1>

        <p class="pianomode-hero-subtitle">
            Please read these terms carefully before using PianoMode services.
        </p>
    </div>

    <!-- Breadcrumbs en bas du hero -->
    <div class="pianomode-hero-breadcrumbs">
        <nav class="breadcrumb-container">
            <a href="<?php echo home_url('/'); ?>" class="breadcrumb-link">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                </svg>
                <span>Home</span>
            </a>
            <span class="breadcrumb-separator">→</span>
            <span class="breadcrumb-current">Terms of Service & Disclaimers</span>
        </nav>
    </div>
</section>

<!-- CONTAINER PRINCIPAL - FOND BLANC -->
<div class="pianomode-terms-page-wrapper">

    <!-- Notes musicales sur la page -->
    <div class="pianomode-page-notes">
        <div class="pianomode-page-note">&#9834;</div>
        <div class="pianomode-page-note">&#9835;</div>
        <div class="pianomode-page-note">&#9836;</div>
        <div class="pianomode-page-note">&#9833;</div>
    </div>

    <!-- Container beige pour le texte -->
    <div class="pianomode-terms-text-container">

        <!-- Contenu éditable dans WordPress -->
        <div class="pianomode-terms-text-content">
            <?php
            // Afficher le contenu de la page éditable dans WordPress
            while (have_posts()) :
                the_post();
                the_content();
            endwhile;
            ?>
        </div>

    </div>

</div>

<?php get_footer(); ?>