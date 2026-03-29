<?php
/**
 * Template Name: Privacy & Cookie Policy
 * Template for Privacy & Cookie Policy page - PianoMode
 * Path: blocksy-child/assets/Other Page/Pianomode/page-privacy-policy.php
 */

if (!defined('ABSPATH')) {
    exit;
}

get_header();
?>

<!-- Enqueue Privacy Policy styles -->
<link rel="stylesheet" href="<?php echo get_stylesheet_directory_uri(); ?>/assets/Other Page/Pianomode/privacy-policy.css">

<!-- HERO PRIVACY POLICY -->
<section class="pianomode-hero-privacy" id="hero-privacy">
    <!-- Background avec image -->
    <div class="pianomode-hero-background">
        <img src="https://pianomode.com/wp-content/uploads/2025/07/gros-plan-des-touches-du-piano-sur-fond-flou-avec-bokeh-scaled.jpg"
             alt="Privacy & Cookie Policy"
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
            Legal Information
        </div>

        <h1 class="pianomode-hero-title">
            <span class="pianomode-hero-title-main">Privacy &</span>
            <span class="pianomode-hero-title-accent">Cookie Policy</span>
        </h1>

        <p class="pianomode-hero-subtitle">
            Your privacy matters to us. Learn how we protect and respect your personal data.
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
            <span class="breadcrumb-current">Privacy & Cookie Policy</span>
        </nav>
    </div>
</section>

<!-- CONTAINER PRINCIPAL - FOND BLANC -->
<div class="pianomode-privacy-page-wrapper">

    <!-- Notes musicales sur la page -->
    <div class="pianomode-page-notes">
        <div class="pianomode-page-note">&#9834;</div>
        <div class="pianomode-page-note">&#9835;</div>
        <div class="pianomode-page-note">&#9836;</div>
        <div class="pianomode-page-note">&#9833;</div>
    </div>

    <!-- Container beige pour le texte -->
    <div class="pianomode-privacy-text-container">

        <!-- Contenu éditable dans WordPress -->
        <div class="pianomode-privacy-text-content">
            <?php
            // Afficher le contenu de la page éditable dans WordPress
            while (have_posts()) :
                the_post();
                the_content();
            endwhile;
            ?>
        </div>

        <!-- Section Cookie Preferences -->
        <div class="pianomode-cookie-preferences-section">
            <div class="pianomode-cookie-preferences-box">
                <div class="pianomode-cookie-preferences-icon">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/>
                        <circle cx="8" cy="9" r="1.5" fill="currentColor"/>
                        <circle cx="15" cy="8" r="1" fill="currentColor"/>
                        <circle cx="10" cy="14" r="1" fill="currentColor"/>
                        <circle cx="16" cy="13" r="1.5" fill="currentColor"/>
                        <circle cx="13" cy="17" r="1" fill="currentColor"/>
                    </svg>
                </div>
                <div class="pianomode-cookie-preferences-content">
                    <h3>Manage Your Cookie Preferences</h3>
                    <p>You can change your cookie settings at any time. Click the button below to customize which cookies you allow.</p>
                </div>
                <button type="button" class="pianomode-cookie-preferences-btn" onclick="pmCookieSettings()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                    Manage Cookie Preferences
                </button>
            </div>
        </div>

    </div>

</div>

<!-- Styles pour la section Cookie Preferences -->
<style>
.pianomode-cookie-preferences-section {
    margin-top: 50px;
    padding-top: 40px;
    border-top: 2px solid var(--pm-gold-alpha-25, rgba(215, 191, 129, 0.25));
}

.pianomode-cookie-preferences-box {
    display: flex;
    align-items: center;
    gap: 25px;
    padding: 30px;
    background: linear-gradient(135deg,
        rgba(215, 191, 129, 0.08) 0%,
        rgba(215, 191, 129, 0.03) 100%);
    border: 1px solid rgba(215, 191, 129, 0.2);
    border-radius: 16px;
    flex-wrap: wrap;
}

.pianomode-cookie-preferences-icon {
    flex-shrink: 0;
    width: 60px;
    height: 60px;
    color: var(--pm-gold, #D7BF81);
}

.pianomode-cookie-preferences-icon svg {
    width: 100%;
    height: 100%;
}

.pianomode-cookie-preferences-content {
    flex: 1;
    min-width: 200px;
}

.pianomode-cookie-preferences-content h3 {
    font-size: 18px;
    font-weight: 700;
    color: var(--pm-black, #1a1a1a);
    margin: 0 0 8px 0;
}

.pianomode-cookie-preferences-content p {
    font-size: 14px;
    color: #666;
    margin: 0;
    line-height: 1.6;
}

.pianomode-cookie-preferences-btn {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 14px 28px;
    background: linear-gradient(135deg, #D7BF81 0%, #BEA86E 100%);
    color: #1a1a1a;
    font-size: 14px;
    font-weight: 600;
    font-family: 'Montserrat', sans-serif;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.3s ease;
    white-space: nowrap;
}

.pianomode-cookie-preferences-btn:hover {
    background: linear-gradient(135deg, #E6D4A8 0%, #D7BF81 100%);
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(215, 191, 129, 0.35);
}

.pianomode-cookie-preferences-btn svg {
    width: 18px;
    height: 18px;
}

@media (max-width: 768px) {
    .pianomode-cookie-preferences-box {
        flex-direction: column;
        text-align: center;
        padding: 25px 20px;
    }

    .pianomode-cookie-preferences-icon {
        width: 50px;
        height: 50px;
    }

    .pianomode-cookie-preferences-content h3 {
        font-size: 16px;
    }

    .pianomode-cookie-preferences-btn {
        width: 100%;
        justify-content: center;
    }
}
</style>

<?php get_footer(); ?>