/**
 * PianoMode OMR Engine — StaffProjector (Phase 5b)
 *
 * Pragmatic JavaScript port of
 *   app/src/main/java/org/audiveris/omr/sheet/grid/StaffProjector.java
 *
 * Purpose
 *   Audiveris uses StaffProjector as the per-staff authority for barlines,
 *   "local" vertical strokes, and measure-boundary classification. For a
 *   given staff it:
 *     1. Builds a 1-D projection that counts, for every x in [xLeft, xRight],
 *        how many of the 5 staff lines have ink directly above/below at x.
 *        High values = a real vertical artefact crossing the staff (barline
 *        or stem), low values = staff-line-only noise.
 *     2. Extracts peaks with hysteresis: a run of consecutive x where the
 *        projection stays above `highThreshold` starts a peak; it widens
 *        until the projection drops below `lowThreshold`.
 *     3. Classifies each peak into BARLINE / STEM / OTHER by width and
 *        vertical extent above/below the staff (barlines typically span
 *        the full height + tiny extensions; stems are thinner, extend
 *        upward or downward for head attachment).
 *     4. Uses the barline x-coordinates to cut the staff into measures.
 *
 * This port stops short of the full SIGraph barline inference (that stays
 * in `omr-grid-bars.js`). Its job here is SOLID timing: the downstream
 * SIGraph rhythm code needs reliable "this is a measure boundary at x"
 * markers or it compresses notes into whatever fits before falling back
 * to whole-measure defaults.
 *
 * Public API
 *   OMR.StaffProjector.project(bin, width, height, staff, scale) → {
 *       projection : Uint16Array (length = staff.xRight - staff.xLeft + 1)
 *       peaks      : [{x0, x1, kind, confidence}, ...]   // x relative to staff.xLeft
 *       barlines   : [x, ...]                             // absolute image x
 *       measures   : [{x0, x1}, ...]                      // absolute image x
 *   }
 *
 *   OMR.StaffProjector.detectBarlines(bin, width, height, staves, scale) →
 *       array of measures[] per staff, indexed by staff.id - 1.
 *
 * Algorithm details
 *   Projection at x:  sum over all 5 staff lines of
 *     (bin[y_line-1, x] OR bin[y_line+1, x]) ? 1 : 0
 *   A barline crossing all 5 lines yields 5; a stem crossing 2-3 lines
 *   yields 2-3. Isolated staff lines yield 0.
 *
 *   Peak extraction (hysteresis):
 *     highThreshold = Math.ceil(linesPerStaff * 0.6)   // 3 of 5
 *     lowThreshold  = Math.ceil(linesPerStaff * 0.4)   // 2 of 5
 *     When proj[x] ≥ high → open peak; close when proj[x] < low.
 *
 *   Classification by width in interlines:
 *     width < 0.15 * interline → STEM_THIN (likely quarter stem)
 *     0.15-0.35 × interline    → STEM (normal)
 *     0.35-1.0 × interline     → BARLINE (single)
 *     > 1.0 × interline        → REPEAT_OR_DOUBLE (final barline /
 *                                                   repeat / double-bar)
 *
 * @package PianoMode
 * @version 6.26.0
 */
(function () {
    'use strict';

    var OMR = window.PianoModeOMR = window.PianoModeOMR || {};

    var PEAK_KIND = {
        STEM_THIN: 'stemThin',
        STEM:      'stem',
        BARLINE:   'barline',
        DOUBLE:    'doubleBar'
    };

    var DEFAULTS = {
        linesPerStaff:    5,
        highRatio:        0.60,   // highThreshold = ceil(lines * highRatio)
        lowRatio:         0.40,   // lowThreshold  = ceil(lines * lowRatio)
        verticalTol:      1,      // rows above/below line counted as "on line"
        // Barline classification widths in interlines
        stemThinMax:      0.15,
        stemMax:          0.35,
        barlineMax:       1.00,
        // Minimum "clean" peak for a real barline — reject ties to symbols
        // or accidentals that straddle measure joints.
        minBarExtIL:      3.5,    // barline must extend ≥ 3.5 IL vertically
                                  // (full staff = 4 IL) — filters stems that
                                  // happen to brush top+bottom lines
        // Merge peaks closer than this (noise cleanup)
        mergeDxPx:        2,
        // Accept measures only if between 0.5 × interline and 40 × interline wide
        minMeasureIL:     0.5,
        maxMeasureIL:     40.0
    };

    function project(bin, width, height, staff, scale, opts) {
        if (!staff || !staff.lines || staff.lines.length < 5) {
            return { projection: null, peaks: [], barlines: [], measures: [],
                     reason: 'staff has < 5 lines' };
        }
        var cfg = mergeOpts(opts);
        var xL = Math.max(0, staff.xLeft | 0);
        var xR = Math.min(width - 1, staff.xRight | 0);
        if (xR <= xL) {
            return { projection: null, peaks: [], barlines: [], measures: [],
                     reason: 'empty xRange' };
        }
        var interline = (scale && scale.interline > 0) ? scale.interline
                       : (staff.interline > 0 ? staff.interline : 20);

        // Cache each staff-line's y(x) lookup — we sample at every x.
        var lines = staff.lines;
        var projW = xR - xL + 1;
        var proj = new Uint16Array(projW);
        var tol  = Math.max(0, cfg.verticalTol | 0);

        for (var dx = 0; dx < projW; dx++) {
            var x = xL + dx;
            var vote = 0;
            for (var li = 0; li < lines.length; li++) {
                var ly = lines[li].getYAtX(x) | 0;
                var hit = false;
                for (var dy = -tol; dy <= tol && !hit; dy++) {
                    var yy = ly + dy;
                    if (yy < 0 || yy >= height) continue;
                    // Count ink ABOVE or BELOW the staff line too — barlines
                    // and stems extend past the line itself. We use a ±1
                    // window above and below the line row.
                    for (var ky = -1; ky <= 1 && !hit; ky++) {
                        var ry = yy + ky;
                        if (ry < 0 || ry >= height) continue;
                        if (bin[ry * width + x]) hit = true;
                    }
                }
                if (hit) vote++;
            }
            proj[dx] = vote;
        }

        // Peak extraction via hysteresis.
        var high = Math.ceil(cfg.linesPerStaff * cfg.highRatio);
        var low  = Math.ceil(cfg.linesPerStaff * cfg.lowRatio);
        var rawPeaks = extractHysteresisPeaks(proj, high, low);

        // Merge near-adjacent peaks — antialiased barlines can split into
        // two ~1 px peaks with a 1-2 px valley.
        rawPeaks = mergeClosePeaks(rawPeaks, cfg.mergeDxPx);

        // Classify each peak + measure vertical extent.
        var peaks = [];
        for (var pi = 0; pi < rawPeaks.length; pi++) {
            var p = rawPeaks[pi];
            var widthPx = p.x1 - p.x0 + 1;
            var widthIL = widthPx / interline;
            var kind;
            if (widthIL <= cfg.stemThinMax)     kind = PEAK_KIND.STEM_THIN;
            else if (widthIL <= cfg.stemMax)    kind = PEAK_KIND.STEM;
            else if (widthIL <= cfg.barlineMax) kind = PEAK_KIND.BARLINE;
            else                                kind = PEAK_KIND.DOUBLE;

            // Measure vertical extent at peak center to separate genuine
            // barlines from stems that happen to brush all 5 lines.
            var xc = Math.round((p.x0 + p.x1) / 2);
            var vext = measureVerticalExtent(
                bin, width, height, xL + xc, staff, cfg.verticalTol);
            if ((kind === PEAK_KIND.BARLINE || kind === PEAK_KIND.DOUBLE)
                    && vext < cfg.minBarExtIL * interline) {
                // Looks barline-shaped but doesn't extend far enough —
                // reclassify as a thick stem.
                kind = PEAK_KIND.STEM;
            }

            peaks.push({
                x0:         p.x0,
                x1:         p.x1,
                center:     xc,
                absX:       xL + xc,
                absX0:      xL + p.x0,
                absX1:      xL + p.x1,
                width:      widthPx,
                widthIL:    widthIL,
                kind:       kind,
                verticalExt:vext,
                confidence: Math.min(1, proj[xc] / cfg.linesPerStaff)
            });
        }

        // Assemble measures from BARLINE / DOUBLE peaks.
        var barlines = [];
        for (var bi = 0; bi < peaks.length; bi++) {
            if (peaks[bi].kind === PEAK_KIND.BARLINE
                    || peaks[bi].kind === PEAK_KIND.DOUBLE) {
                barlines.push(peaks[bi].absX);
            }
        }
        var measures = buildMeasures(xL, xR, barlines, interline, cfg);

        return {
            projection: proj,
            peaks:      peaks,
            barlines:   barlines,
            measures:   measures,
            staffId:    staff.id,
            interline:  interline
        };
    }

    function detectBarlines(bin, width, height, staves, scale, opts) {
        if (!staves || !staves.length) return [];
        var out = [];
        for (var i = 0; i < staves.length; i++) {
            out.push(project(bin, width, height, staves[i], scale, opts));
        }
        return out;
    }

    // Hysteresis peak extraction. Returns [{x0, x1}, ...] where each pair
    // represents a contiguous run above `high`, extended leftward/rightward
    // while the value stays ≥ `low`.
    function extractHysteresisPeaks(proj, high, low) {
        var peaks = [];
        var n = proj.length;
        var i = 0;
        while (i < n) {
            if (proj[i] < high) { i++; continue; }
            // Found a crest — walk back while ≥ low
            var x0 = i;
            while (x0 > 0 && proj[x0 - 1] >= low) x0--;
            // Walk forward while ≥ low
            var x1 = i;
            while (x1 + 1 < n && proj[x1 + 1] >= low) x1++;
            peaks.push({ x0: x0, x1: x1 });
            i = x1 + 1;
        }
        return peaks;
    }

    function mergeClosePeaks(peaks, dx) {
        if (peaks.length < 2 || dx <= 0) return peaks;
        var out = [peaks[0]];
        for (var i = 1; i < peaks.length; i++) {
            var prev = out[out.length - 1];
            if (peaks[i].x0 - prev.x1 <= dx) {
                prev.x1 = peaks[i].x1;
            } else {
                out.push(peaks[i]);
            }
        }
        return out;
    }

    function measureVerticalExtent(bin, width, height, xAbs, staff, tol) {
        // Start from staff mid-y, walk up while column xAbs has ink; walk
        // down likewise; return the span.
        var lines = staff.lines;
        var yMid = Math.round(
            0.5 * (lines[0].getYAtX(xAbs) + lines[lines.length - 1].getYAtX(xAbs)));
        if (yMid < 0 || yMid >= height) return 0;
        // Scan up
        var yUp = yMid;
        while (yUp > 0 && columnHasInkAt(bin, width, yUp - 1, xAbs, tol)) yUp--;
        // Scan down
        var yDn = yMid;
        while (yDn < height - 1 && columnHasInkAt(bin, width, yDn + 1, xAbs, tol)) yDn++;
        return yDn - yUp;
    }

    function columnHasInkAt(bin, width, y, xAbs, tol) {
        for (var dx = -tol; dx <= tol; dx++) {
            var xx = xAbs + dx;
            if (xx < 0 || xx >= width) continue;
            if (bin[y * width + xx]) return true;
        }
        return false;
    }

    function buildMeasures(xL, xR, barlines, interline, cfg) {
        if (!barlines.length) return [{ x0: xL, x1: xR }];
        var sorted = barlines.slice().sort(function (a, b) { return a - b; });
        var measures = [];
        var cursor = xL;
        for (var i = 0; i < sorted.length; i++) {
            var bx = sorted[i];
            var widthIL = (bx - cursor) / interline;
            if (widthIL >= cfg.minMeasureIL && widthIL <= cfg.maxMeasureIL) {
                measures.push({ x0: cursor, x1: bx });
            }
            cursor = bx;
        }
        // Tail measure (after last barline → xR)
        var tailIL = (xR - cursor) / interline;
        if (tailIL >= cfg.minMeasureIL && tailIL <= cfg.maxMeasureIL) {
            measures.push({ x0: cursor, x1: xR });
        }
        return measures;
    }

    function mergeOpts(opts) {
        var cfg = {};
        for (var k in DEFAULTS) cfg[k] = DEFAULTS[k];
        if (opts) { for (var k2 in opts) cfg[k2] = opts[k2]; }
        return cfg;
    }

    OMR.StaffProjector = {
        project:        project,
        detectBarlines: detectBarlines,
        PEAK_KIND:      PEAK_KIND,
        _defaults:      DEFAULTS
    };

})();
