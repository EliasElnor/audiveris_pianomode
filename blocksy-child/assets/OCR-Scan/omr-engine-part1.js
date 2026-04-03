/**
 * PianoMode OMR Engine - Part 1: Image Processing & Staff Detection
 * 100% client-side music recognition engine (no server dependencies)
 *
 * @package PianoMode
 * @version 1.0.0
 */

window.PianoModeOMR = window.PianoModeOMR || {};

// =====================================================
// IMAGE PROCESSOR
// =====================================================
PianoModeOMR.ImageProcessor = {

    /**
     * Load an image from a File/Blob and return ImageData
     */
    loadImage: function(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                var img = new Image();
                img.onload = function() {
                    var canvas = document.createElement('canvas');
                    // Limit max dimension to 3000px for performance
                    var scale = 1;
                    if (img.width > 3000 || img.height > 3000) {
                        scale = 3000 / Math.max(img.width, img.height);
                    }
                    canvas.width = Math.round(img.width * scale);
                    canvas.height = Math.round(img.height * scale);
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    resolve({
                        imageData: imageData,
                        width: canvas.width,
                        height: canvas.height,
                        canvas: canvas
                    });
                };
                img.onerror = function() { reject(new Error('Failed to load image')); };
                img.src = e.target.result;
            };
            reader.onerror = function() { reject(new Error('Failed to read file')); };
            reader.readAsDataURL(file);
        });
    },

    /**
     * Load a PDF first page as image using pdf.js (loaded externally)
     */
    loadPDF: function(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                var typedArray = new Uint8Array(e.target.result);
                if (typeof pdfjsLib === 'undefined') {
                    reject(new Error('PDF.js library not loaded'));
                    return;
                }
                pdfjsLib.getDocument({ data: typedArray }).promise.then(function(pdf) {
                    pdf.getPage(1).then(function(page) {
                        var scale = 2.0; // High res for OCR
                        var viewport = page.getViewport({ scale: scale });
                        var canvas = document.createElement('canvas');
                        canvas.width = viewport.width;
                        canvas.height = viewport.height;
                        var ctx = canvas.getContext('2d');
                        page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function() {
                            var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                            resolve({
                                imageData: imageData,
                                width: canvas.width,
                                height: canvas.height,
                                canvas: canvas,
                                totalPages: pdf.numPages
                            });
                        });
                    });
                }).catch(reject);
            };
            reader.onerror = function() { reject(new Error('Failed to read PDF')); };
            reader.readAsArrayBuffer(file);
        });
    },

    /**
     * Convert ImageData to grayscale (in-place modifies a copy)
     */
    toGrayscale: function(imageData) {
        var data = imageData.data;
        var gray = new Uint8Array(imageData.width * imageData.height);
        for (var i = 0; i < gray.length; i++) {
            var r = data[i * 4];
            var g = data[i * 4 + 1];
            var b = data[i * 4 + 2];
            gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        }
        return gray;
    },

    /**
     * Otsu's threshold — find optimal binary threshold
     */
    otsuThreshold: function(gray) {
        var hist = new Array(256).fill(0);
        for (var i = 0; i < gray.length; i++) {
            hist[gray[i]]++;
        }
        var total = gray.length;
        var sumAll = 0;
        for (var t = 0; t < 256; t++) sumAll += t * hist[t];

        var sumBg = 0, wBg = 0, best = 0, bestT = 0;
        for (var t = 0; t < 256; t++) {
            wBg += hist[t];
            if (wBg === 0) continue;
            var wFg = total - wBg;
            if (wFg === 0) break;
            sumBg += t * hist[t];
            var meanBg = sumBg / wBg;
            var meanFg = (sumAll - sumBg) / wFg;
            var between = wBg * wFg * (meanBg - meanFg) * (meanBg - meanFg);
            if (between > best) {
                best = between;
                bestT = t;
            }
        }
        return bestT;
    },

    /**
     * Binarize grayscale array: 1 = black (ink), 0 = white (paper)
     */
    binarize: function(gray, threshold) {
        var binary = new Uint8Array(gray.length);
        for (var i = 0; i < gray.length; i++) {
            binary[i] = gray[i] < threshold ? 1 : 0;
        }
        return binary;
    },

    /**
     * Clean small noise blobs (morphological opening approximation)
     */
    cleanNoise: function(binary, width, height, minSize) {
        minSize = minSize || 3;
        var cleaned = new Uint8Array(binary);
        // Simple 3x3 erosion then dilation
        var eroded = new Uint8Array(binary.length);
        for (var y = 1; y < height - 1; y++) {
            for (var x = 1; x < width - 1; x++) {
                var idx = y * width + x;
                if (binary[idx] === 1 &&
                    binary[idx - 1] === 1 && binary[idx + 1] === 1 &&
                    binary[idx - width] === 1 && binary[idx + width] === 1) {
                    eroded[idx] = 1;
                }
            }
        }
        // Dilation
        for (var y = 1; y < height - 1; y++) {
            for (var x = 1; x < width - 1; x++) {
                var idx = y * width + x;
                if (eroded[idx] === 1) {
                    cleaned[idx] = 1;
                    cleaned[idx - 1] = 1;
                    cleaned[idx + 1] = 1;
                    cleaned[idx - width] = 1;
                    cleaned[idx + width] = 1;
                }
            }
        }
        return cleaned;
    }
};

// =====================================================
// STAFF DETECTOR
// =====================================================
PianoModeOMR.StaffDetector = {

    /**
     * Detect staff lines using horizontal projection profile.
     * Returns array of staff groups, each with 5 line y-positions.
     */
    detect: function(binary, width, height) {
        // Step 1: Horizontal projection — count black pixels per row
        var projection = new Uint32Array(height);
        for (var y = 0; y < height; y++) {
            var count = 0;
            var offset = y * width;
            for (var x = 0; x < width; x++) {
                if (binary[offset + x] === 1) count++;
            }
            projection[y] = count;
        }

        // Step 2: Find threshold for "staff line" rows
        // Staff lines have significantly more black pixels than average
        var mean = 0;
        for (var y = 0; y < height; y++) mean += projection[y];
        mean /= height;

        // Staff line threshold: rows with > 40% of width filled
        var lineThreshold = Math.max(mean * 2, width * 0.3);

        // Step 3: Find candidate line rows (peaks)
        var candidateRows = [];
        for (var y = 0; y < height; y++) {
            if (projection[y] >= lineThreshold) {
                candidateRows.push(y);
            }
        }

        // Step 4: Merge adjacent rows into single lines
        var lines = [];
        if (candidateRows.length === 0) return [];

        var start = candidateRows[0];
        var end = candidateRows[0];
        for (var i = 1; i < candidateRows.length; i++) {
            if (candidateRows[i] - end <= 2) {
                end = candidateRows[i];
            } else {
                lines.push(Math.round((start + end) / 2));
                start = candidateRows[i];
                end = candidateRows[i];
            }
        }
        lines.push(Math.round((start + end) / 2));

        // Step 5: Group into staves (5 lines with consistent spacing)
        var staves = this._groupIntoStaves(lines);
        return staves;
    },

    /**
     * Group detected lines into staves of 5 lines each
     */
    _groupIntoStaves: function(lines) {
        if (lines.length < 5) return [];

        var staves = [];
        var used = new Array(lines.length).fill(false);

        for (var i = 0; i <= lines.length - 5; i++) {
            if (used[i]) continue;

            // Check if next 5 lines have consistent spacing
            var spacing = [];
            var valid = true;
            for (var j = 0; j < 4; j++) {
                var gap = lines[i + j + 1] - lines[i + j];
                spacing.push(gap);
            }

            // Check spacing consistency (all within 40% of median)
            spacing.sort(function(a, b) { return a - b; });
            var median = spacing[1]; // median of 4 values
            var allConsistent = true;
            for (var j = 0; j < 4; j++) {
                if (Math.abs(spacing[j] - median) > median * 0.4) {
                    allConsistent = false;
                    break;
                }
            }

            if (allConsistent && median > 3) {
                var staffLines = [];
                for (var j = 0; j < 5; j++) {
                    staffLines.push(lines[i + j]);
                    used[i + j] = true;
                }
                var avgSpacing = (staffLines[4] - staffLines[0]) / 4;
                staves.push({
                    lines: staffLines,
                    top: staffLines[0],
                    bottom: staffLines[4],
                    spacing: avgSpacing,
                    center: Math.round((staffLines[0] + staffLines[4]) / 2)
                });
            }
        }

        return staves;
    },

    /**
     * Remove staff lines from binary image (for note detection)
     * Only removes pixels that are part of horizontal runs
     */
    removeStaffLines: function(binary, width, height, staves) {
        var cleaned = new Uint8Array(binary);
        var lineThickness = 2;

        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            lineThickness = Math.max(2, Math.round(staff.spacing * 0.15));

            for (var l = 0; l < staff.lines.length; l++) {
                var lineY = staff.lines[l];
                for (var dy = -lineThickness; dy <= lineThickness; dy++) {
                    var y = lineY + dy;
                    if (y < 0 || y >= height) continue;

                    for (var x = 0; x < width; x++) {
                        var idx = y * width + x;
                        if (cleaned[idx] === 1) {
                            // Check if this pixel is part of a staff line
                            // (horizontal context: neighbors are also black)
                            // Only remove if there's no significant vertical content
                            var above = (y > 0) ? binary[(y - lineThickness - 1) * width + x] : 0;
                            var below = (y < height - 1) ? binary[(y + lineThickness + 1) * width + x] : 0;
                            if (above === 0 && below === 0) {
                                // Pure staff line pixel — remove it
                                cleaned[idx] = 0;
                            }
                            // If above OR below has ink, keep it (part of a note/symbol)
                        }
                    }
                }
            }
        }

        return cleaned;
    },

    /**
     * Detect clef type for each staff based on ink density patterns
     * Simple heuristic: treble clef is in upper half, bass clef lower
     */
    detectClefs: function(binary, width, staves) {
        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            // Default: if staves come in pairs, top = treble, bottom = bass
            if (staves.length >= 2 && s % 2 === 0) {
                staff.clef = 'treble';
            } else if (staves.length >= 2 && s % 2 === 1) {
                staff.clef = 'bass';
            } else {
                // Single staff — check ink pattern in left region
                // Treble clefs have more ink in the upper portion
                var leftRegion = Math.min(width, Math.round(staff.spacing * 6));
                var upperInk = 0, lowerInk = 0;
                var midY = staff.center;

                for (var y = staff.top - staff.spacing; y < midY; y++) {
                    if (y < 0) continue;
                    for (var x = 0; x < leftRegion; x++) {
                        if (binary[y * width + x] === 1) upperInk++;
                    }
                }
                for (var y = midY; y <= staff.bottom + staff.spacing; y++) {
                    for (var x = 0; x < leftRegion; x++) {
                        if (binary[y * width + x] === 1) lowerInk++;
                    }
                }
                staff.clef = (upperInk >= lowerInk) ? 'treble' : 'bass';
            }
        }
        return staves;
    }
};

console.log('[PianoModeOMR] Image processing & staff detection loaded');
