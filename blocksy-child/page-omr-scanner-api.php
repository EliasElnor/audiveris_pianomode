<?php
/**
 * PianoMode OCR Scanner - REST API Endpoint
 *
 * Integrates the Audiveris OMR (Optical Music Recognition) engine to convert
 * sheet music photos and PDFs into MusicXML playable with AlphaTab.
 *
 * Required constant in wp-config.php:
 *   define('AUDIVERIS_JAR_PATH', '/absolute/path/to/Audiveris.jar');
 *
 * Optional constants:
 *   define('AUDIVERIS_JAVA_BIN', '/usr/bin/java');  // default: 'java'
 *   define('AUDIVERIS_TIMEOUT', 180);               // seconds, default: 180
 *
 * @package PianoMode
 * @version 1.0.0
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

// =====================================================
// REGISTER REST ROUTE
// =====================================================

add_action( 'rest_api_init', function () {
    register_rest_route( 'pianomode/v1', '/omr-scan', [
        'methods'             => 'POST',
        'callback'            => 'pianomode_omr_scan_handler',
        'permission_callback' => '__return_true',
    ] );
} );

// =====================================================
// MAIN HANDLER
// =====================================================

/**
 * Handle an OCR scan request.
 *
 * @param  WP_REST_Request $request
 * @return WP_REST_Response|WP_Error
 */
function pianomode_omr_scan_handler( WP_REST_Request $request ) {

    // ---- Rate limiting: max 3 conversions per IP per hour ----
    $ip       = sanitize_text_field( $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0' );
    $rate_key = 'omr_rate_' . md5( $ip );
    $count    = (int) get_transient( $rate_key );

    if ( $count >= 3 ) {
        return new WP_Error(
            'rate_limit',
            __( 'Too many requests. Please wait before trying again (limit: 3 per hour).', 'pianomode' ),
            [ 'status' => 429 ]
        );
    }

    set_transient( $rate_key, $count + 1, HOUR_IN_SECONDS );

    // ---- Check Audiveris is configured ----
    $jar_path = defined( 'AUDIVERIS_JAR_PATH' ) ? AUDIVERIS_JAR_PATH : '';

    if ( empty( $jar_path ) || ! file_exists( $jar_path ) ) {
        return new WP_Error(
            'not_configured',
            __( 'Audiveris is not configured on this server. Please define AUDIVERIS_JAR_PATH in wp-config.php and ensure the JAR exists.', 'pianomode' ),
            [ 'status' => 503 ]
        );
    }

    // ---- Validate uploaded file ----
    $files = $request->get_file_params();

    if ( empty( $files['score_file'] ) || $files['score_file']['error'] !== UPLOAD_ERR_OK ) {
        $upload_err = $files['score_file']['error'] ?? UPLOAD_ERR_NO_FILE;
        return new WP_Error(
            'no_file',
            pianomode_omr_upload_error_message( $upload_err ),
            [ 'status' => 400 ]
        );
    }

    $file = $files['score_file'];

    // Size check: max 20 MB
    if ( $file['size'] > 20 * 1024 * 1024 ) {
        return new WP_Error(
            'file_too_large',
            __( 'The file must be smaller than 20 MB.', 'pianomode' ),
            [ 'status' => 400 ]
        );
    }

    // MIME type validation (using finfo for security, not user-supplied type)
    if ( ! function_exists( 'finfo_open' ) ) {
        return new WP_Error(
            'no_finfo',
            __( 'Server configuration error: fileinfo extension is required.', 'pianomode' ),
            [ 'status' => 500 ]
        );
    }

    $finfo = new finfo( FILEINFO_MIME_TYPE );
    $mime  = $finfo->file( $file['tmp_name'] );

    $allowed_mimes = [
        'application/pdf' => 'pdf',
        'image/png'       => 'png',
        'image/jpeg'      => 'jpg',
        'image/tiff'      => 'tiff',
    ];

    if ( ! array_key_exists( $mime, $allowed_mimes ) ) {
        return new WP_Error(
            'invalid_type',
            __( 'Only PDF, PNG, JPG, or TIFF files are accepted.', 'pianomode' ),
            [ 'status' => 400 ]
        );
    }

    $ext = $allowed_mimes[ $mime ];

    // ---- Create working directories ----
    $job_id     = uniqid( 'omr_', true );
    $upload_dir = wp_upload_dir();
    $base_dir   = $upload_dir['basedir'];

    $temp_dir   = $base_dir . '/omr-temp/' . $job_id;
    $output_dir = $base_dir . '/omr-output/' . $job_id;

    if ( ! wp_mkdir_p( $temp_dir ) || ! wp_mkdir_p( $output_dir ) ) {
        return new WP_Error(
            'mkdir_failed',
            __( 'Server error: could not create processing directories.', 'pianomode' ),
            [ 'status' => 500 ]
        );
    }

    // Protect temp input dir from direct web access
    file_put_contents( $temp_dir . '/.htaccess', 'Deny from all' . PHP_EOL );

    // ---- Save uploaded file ----
    $input_file = $temp_dir . '/input.' . $ext;

    if ( ! move_uploaded_file( $file['tmp_name'], $input_file ) ) {
        pianomode_omr_cleanup_dir( $temp_dir );
        return new WP_Error(
            'move_failed',
            __( 'Failed to save the uploaded file.', 'pianomode' ),
            [ 'status' => 500 ]
        );
    }

    // ---- Run Audiveris ----
    $result = pianomode_run_audiveris( $jar_path, $input_file, $output_dir );

    // Clean up temp input regardless of success
    pianomode_omr_cleanup_dir( $temp_dir );

    if ( is_wp_error( $result ) ) {
        pianomode_omr_cleanup_dir( $output_dir );
        return $result;
    }

    // ---- Find generated MusicXML ----
    $mxl_files    = glob( $output_dir . '/*.mxl' ) ?: [];
    $xml_files    = glob( $output_dir . '/*.xml' ) ?: [];
    $output_files = array_merge( $mxl_files, $xml_files );

    // Also search subdirectories (Audiveris sometimes creates nested output)
    if ( empty( $output_files ) ) {
        $mxl_files    = glob( $output_dir . '/**/*.mxl' ) ?: [];
        $xml_files    = glob( $output_dir . '/**/*.xml' ) ?: [];
        $output_files = array_merge( $mxl_files, $xml_files );
    }

    if ( empty( $output_files ) ) {
        pianomode_omr_cleanup_dir( $output_dir );
        return new WP_Error(
            'no_output',
            __( 'Audiveris could not recognise music in this file. Please use a clear, high-resolution image or a digital PDF of sheet music.', 'pianomode' ),
            [ 'status' => 422 ]
        );
    }

    // Prefer .mxl over plain .xml
    $musicxml_path     = ! empty( $mxl_files ) ? $mxl_files[0] : $xml_files[0];
    $musicxml_filename = basename( $musicxml_path );

    // If file is in a subdirectory, move it to output root for clean URL
    if ( dirname( $musicxml_path ) !== $output_dir ) {
        $new_path = $output_dir . '/' . $musicxml_filename;
        rename( $musicxml_path, $new_path );
        $musicxml_path = $new_path;
    }

    $musicxml_url = $upload_dir['baseurl'] . '/omr-output/' . $job_id . '/' . $musicxml_filename;

    // Add .htaccess to allow web access to output dir
    file_put_contents( $output_dir . '/.htaccess', "Allow from all\n" );

    return rest_ensure_response( [
        'success'      => true,
        'job_id'       => $job_id,
        'musicxml_url' => $musicxml_url,
        'filename'     => $musicxml_filename,
    ] );
}

// =====================================================
// AUDIVERIS EXECUTION
// =====================================================

/**
 * Run the Audiveris CLI and wait for completion.
 *
 * @param  string $jar_path   Absolute path to the Audiveris JAR
 * @param  string $input_file Absolute path to the input PDF/image
 * @param  string $output_dir Absolute path to the output directory
 * @return true|WP_Error
 */
function pianomode_run_audiveris( string $jar_path, string $input_file, string $output_dir ) {

    // Check Java
    $java_bin = defined( 'AUDIVERIS_JAVA_BIN' ) ? AUDIVERIS_JAVA_BIN : 'java';

    exec( escapeshellcmd( $java_bin ) . ' -version 2>&1', $java_out, $java_code );
    if ( $java_code !== 0 ) {
        return new WP_Error(
            'no_java',
            __( 'Java is not installed on this server. Please install Java 17+ (OpenJDK) to use the OCR scanner.', 'pianomode' ),
            [ 'status' => 503 ]
        );
    }

    // Build command
    // -batch       : headless mode (no GUI)
    // -transcribe  : run all recognition steps
    // -export      : export to MusicXML
    // -output <dir>: output directory
    $cmd = sprintf(
        '%s -Xmx512m -jar %s -batch -transcribe -export -output %s %s 2>&1',
        escapeshellcmd( $java_bin ),
        escapeshellarg( $jar_path ),
        escapeshellarg( $output_dir ),
        escapeshellarg( $input_file )
    );

    $descriptors = [
        0 => [ 'pipe', 'r' ],  // stdin
        1 => [ 'pipe', 'w' ],  // stdout + stderr (merged via 2>&1)
        2 => [ 'pipe', 'w' ],  // stderr pipe
    ];

    $process = proc_open( $cmd, $descriptors, $pipes );

    if ( ! is_resource( $process ) ) {
        return new WP_Error(
            'process_failed',
            __( 'Failed to start the Audiveris process.', 'pianomode' ),
            [ 'status' => 500 ]
        );
    }

    fclose( $pipes[0] ); // close stdin
    stream_set_blocking( $pipes[1], false );
    stream_set_blocking( $pipes[2], false );

    $timeout = defined( 'AUDIVERIS_TIMEOUT' ) ? (int) AUDIVERIS_TIMEOUT : 180;
    $start   = time();
    $output  = '';

    while ( ( time() - $start ) < $timeout ) {
        $status = proc_get_status( $process );
        if ( ! $status['running'] ) {
            break;
        }
        // Drain output to prevent pipe buffer deadlock
        $chunk = fread( $pipes[1], 8192 );
        if ( $chunk ) {
            $output .= $chunk;
        }
        usleep( 500000 ); // poll every 0.5s
    }

    $timed_out = ( time() - $start ) >= $timeout;

    // Drain remaining output
    $output .= stream_get_contents( $pipes[1] );
    stream_get_contents( $pipes[2] );
    fclose( $pipes[1] );
    fclose( $pipes[2] );

    if ( $timed_out ) {
        proc_terminate( $process );
        proc_close( $process );
        return new WP_Error(
            'timeout',
            __( 'Processing timed out. Please try with a shorter or simpler score.', 'pianomode' ),
            [ 'status' => 504 ]
        );
    }

    $exit_code = proc_close( $process );

    if ( $exit_code !== 0 ) {
        // Log the error for debugging (visible in wp-content/debug.log if WP_DEBUG_LOG is enabled)
        if ( defined( 'WP_DEBUG_LOG' ) && WP_DEBUG_LOG ) {
            error_log( '[PianoMode OMR] Audiveris exit code: ' . $exit_code );
            error_log( '[PianoMode OMR] Output: ' . substr( $output, -500 ) );
        }
        return new WP_Error(
            'audiveris_error',
            __( 'Audiveris could not process this file. Please ensure it contains clear, printed (not handwritten) sheet music.', 'pianomode' ),
            [ 'status' => 422 ]
        );
    }

    return true;
}

// =====================================================
// HELPERS
// =====================================================

/**
 * Recursively delete a directory.
 */
function pianomode_omr_cleanup_dir( string $dir ): void {
    if ( ! is_dir( $dir ) ) {
        return;
    }
    $items = array_diff( (array) scandir( $dir ), [ '.', '..' ] );
    foreach ( $items as $item ) {
        $path = $dir . '/' . $item;
        is_dir( $path ) ? pianomode_omr_cleanup_dir( $path ) : unlink( $path );
    }
    rmdir( $dir );
}

/**
 * Human-readable upload error message.
 */
function pianomode_omr_upload_error_message( int $code ): string {
    $messages = [
        UPLOAD_ERR_NO_FILE    => __( 'No file was uploaded.', 'pianomode' ),
        UPLOAD_ERR_INI_SIZE   => __( 'The file exceeds the server upload limit.', 'pianomode' ),
        UPLOAD_ERR_FORM_SIZE  => __( 'The file is too large.', 'pianomode' ),
        UPLOAD_ERR_PARTIAL    => __( 'The file was only partially uploaded. Please try again.', 'pianomode' ),
        UPLOAD_ERR_NO_TMP_DIR => __( 'Server error: missing temporary folder.', 'pianomode' ),
        UPLOAD_ERR_CANT_WRITE => __( 'Server error: failed to write file.', 'pianomode' ),
    ];
    return $messages[ $code ] ?? __( 'An unknown upload error occurred.', 'pianomode' );
}
