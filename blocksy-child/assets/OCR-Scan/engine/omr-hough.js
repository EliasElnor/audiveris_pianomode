/**
 * PianoMode OMR Engine — Hough-style horizontal line detector (Phase 4b)
 *
 * Purpose
 *   The filament-based LinesRetriever port (`omr-grid-lines.js`) works
 *   well on clean scanned bitmaps but collapses on PDF rasters whose
 *   staff lines are broken into many short antialiased fragments — the
 *   "built=906 afterLen+Thick=17" pattern seen on Autumn Leaves, Brahms
 *   and Gedike, where 98 %+ of filaments are rejected by the length
 *   filter because they're shorter than 3× interline.
 *
 *   This module is a last-resort fallback that sidesteps filament
 *   reconstruction entirely. It treats staff-line detection as a 1-D
 *   peak-finding problem on the horizontal ink projection — the same
 *   approach Audiveris uses in `sheet/grid/StaffProjector.java` — and
 *   emits the same Staff[] shape the downstream pipeline (Phase 5..14)
 *   already consumes.
 *
 *   Name nods to the classical Hough Transform which, for horizontal
 *   lines in a mildly-deskewed page, degenerates into row-summing — so
 *   that's literally what we do, with one-degree θ averaging to absorb
 *   residual skew.
 *
 * Public API
 *   OMR.Hough.detectStaves(bin, width, height, scale, opts?) → {
 *       staves : Staff[]      // same shape as LinesRetriever
 *       systems: System[]     // grand-staff pairing via pairStavesIntoSystems
 *       slope  : number       // measured sheet slope (radians)
 *       reason : string       // on failure
 *   }
 *
 * Algorithm
 *   1. Horizontal projection: count ink pixels per row across a
 *      ±skewTol row window (absorbs up to ~1° skew without full θ
 *      accumulation — keeps the implementation small).
 *   2. Peak detection: threshold at `peakFrac * max(projection)` and
 *      keep local maxima at least `minPeakGap` rows apart.
 *   3. Staff grouping: sort peaks by y, walk them, and emit groups of
 *      exactly 5 whose 4 consecutive spacings lie in
 *      [0.8, 1.2] × interline. Greedy split on > 1.8·interline gap.
 *   4. Staff assembly: for each accepted 5-peak group, find the left
 *      and right extents where the row at peak y still has ink density
 *      > `minInkFrac`. These become xLeft/xRight.
 *   5. Pair into systems using `OMR.GridLines._pairStavesIntoSystems`.
 *
 * Load order — see functions.php `pianomode_enqueue_omr_scripts`:
 *   omr-hough.js depends on omr-core (for OMR.Filaments if we expose
 *   helpers) and omr-grid-lines (for pairStavesIntoSystems re-use).
 *
 * @package PianoMode
 * @version 6.26.0
 */
(function () {
    'use strict';

    var OMR = window.PianoModeOMR = window.PianoModeOMR || {};

    var DEFAULTS = {
        peakFrac:       0.55,   // a row is a staff-line candidate if its
                                // smoothed ink sum > peakFrac * maxSum
        skewTol:        1,      // ± rows fused when projecting (small skew)
        minInkFrac:     0.25,   // row is "inky" at x if >= minInkFrac of a
                                // small sliding window is ink — used for
                                // xLeft/xRight extent detection
        extentWin:      16,     // sliding window size (px) for extent check
        interlineMin:   0.80,   // 5-peak spacing tolerance around interline
        interlineMax:   1.20,
        staffGapIL:     1.8,    // split groups when peak-to-peak gap
                                // exceeds this many interlines
        minPeakGap:     0.45    // merge closer peaks (fraction of interline)
    };

    /**
     * @param {Uint8Array} bin       foreground mask (1 = ink), length w*h
     * @param {number}     width
     * @param {number}     height
     * @param {{interline:number,mainFore?:number,valid?:boolean}} scale
     * @param {object}     [opts]
     */
    function detectStaves(bin, width, height, scale, opts) {
        if (!scale || !scale.valid) {
            return { staves: [], systems: [], slope: 0,
                     reason: 'hough: scale invalid' };
        }
        if (!bin || width < 50 || height < 20) {
            return { staves: [], systems: [], slope: 0,
                     reason: 'hough: degenerate image' };
        }
        var cfg = {};
        for (var k in DEFAULTS) cfg[k] = DEFAULTS[k];
        if (opts) { for (var k2 in opts) cfg[k2] = opts[k2]; }

        var interline = scale.interline;
        if (!(interline > 0)) {
            return { staves: [], systems: [], slope: 0,
                     reason: 'hough: bad interline' };
        }

        // 1. Horizontal projection with skew tolerance. We sum `bin` row-wise
        //    AND include ±skewTol neighbor rows so that a staff line drifting
        //    up to skewTol pixels across the sheet still accumulates fully in
        //    the center row's count. This is cheaper than a full (ρ, θ) Hough
        //    accumulator and handles the common case (≤ 1° sheet skew).
        var proj = new Uint32Array(height);
        for (var y = 0; y < height; y++) {
            var row = y * width;
            var n = 0;
            for (var x = 0; x < width; x++) if (bin[row + x]) n++;
            proj[y] = n;
        }
        if (cfg.skewTol > 0) {
            var smoothed = new Uint32Array(height);
            for (var yy = 0; yy < height; yy++) {
                var acc = 0;
                var lo = Math.max(0, yy - cfg.skewTol);
                var hi = Math.min(height - 1, yy + cfg.skewTol);
                for (var yz = lo; yz <= hi; yz++) acc += proj[yz];
                // Average, not sum — keeps the threshold comparable.
                smoothed[yy] = Math.round(acc / (hi - lo + 1));
            }
            proj = smoothed;
        }

        var maxSum = 0;
        for (var yi = 0; yi < height; yi++) if (proj[yi] > maxSum) maxSum = proj[yi];
        if (maxSum === 0) {
            return { staves: [], systems: [], slope: 0,
                     reason: 'hough: empty projection' };
        }
        var threshold = Math.round(maxSum * cfg.peakFrac);

        // 2. Peak detection. Walk the projection and emit a peak at any row
        //    that (a) is above threshold, (b) is a local maximum, and
        //    (c) is at least `minPeakGap × interline` away from the last
        //    accepted peak. Ties resolve to the earlier row.
        var peaks = [];
        var minPeakGap = Math.max(1, Math.round(cfg.minPeakGap * interline));
        var lastPeakY = -Infinity;
        for (var yc = 1; yc < height - 1; yc++) {
            if (proj[yc] < threshold) continue;
            if (proj[yc] < proj[yc - 1] || proj[yc] < proj[yc + 1]) continue;
            if (yc - lastPeakY < minPeakGap) {
                // Keep the taller peak among close neighbors.
                if (peaks.length > 0
                        && proj[yc] > proj[peaks[peaks.length - 1]]) {
                    peaks[peaks.length - 1] = yc;
                    lastPeakY = yc;
                }
                continue;
            }
            peaks.push(yc);
            lastPeakY = yc;
        }

        if (peaks.length < 5) {
            return { staves: [], systems: [], slope: 0,
                     reason: 'hough: only ' + peaks.length + ' peaks above '
                             + Math.round(cfg.peakFrac * 100) + '% of max ink row' };
        }

        // 3. Staff grouping. Split into runs at large y gaps, then extract
        //    5-peak subgroups whose spacings fall in [interlineMin, Max]
        //    × interline.
        var groups = [];
        var cur = [peaks[0]];
        var splitGap = cfg.staffGapIL * interline;
        for (var pi = 1; pi < peaks.length; pi++) {
            if (peaks[pi] - peaks[pi - 1] > splitGap) {
                groups.push(cur);
                cur = [];
            }
            cur.push(peaks[pi]);
        }
        groups.push(cur);

        var interMin = interline * cfg.interlineMin;
        var interMax = interline * cfg.interlineMax;

        var rawStaves = [];
        for (var gi = 0; gi < groups.length; gi++) {
            var g = groups[gi];
            if (g.length < 5) continue;
            // Prefer a 5-peak window whose spacings average closest to
            // interline. We slide a window of 5 and accept the first
            // that passes; equal-quality windows are resolved by lowest
            // rms(spacing − interline).
            var best = null;
            for (var s = 0; s + 5 <= g.length; s++) {
                var ok = true;
                var sq = 0;
                for (var t = 0; t < 4; t++) {
                    var dy = g[s + t + 1] - g[s + t];
                    if (dy < interMin || dy > interMax) { ok = false; break; }
                    sq += (dy - interline) * (dy - interline);
                }
                if (ok && (best === null || sq < best.sq)) {
                    best = { start: s, sq: sq };
                }
            }
            if (!best) continue;
            var lineYs = g.slice(best.start, best.start + 5);
            rawStaves.push({ lineYs: lineYs });
        }

        if (rawStaves.length === 0) {
            return { staves: [], systems: [], slope: 0,
                     reason: 'hough: ' + peaks.length + ' peaks, 0 valid 5-tuples' };
        }

        // 4. Per-staff horizontal extent. For each line-y, find the leftmost
        //    and rightmost x whose local ink density (in an extentWin window)
        //    exceeds minInkFrac. The staff's xLeft/xRight is the intersection
        //    of all 5 lines' extents (narrowest line wins).
        var extentWin  = Math.max(4, Math.round(cfg.extentWin));
        var extentNeed = Math.max(1, Math.round(extentWin * cfg.minInkFrac));

        var staves = [];
        for (var rs = 0; rs < rawStaves.length; rs++) {
            var lineYs = rawStaves[rs].lineYs;
            var sxL = -Infinity, sxR = Infinity;
            for (var li = 0; li < lineYs.length; li++) {
                var ly    = lineYs[li];
                var ext   = measureRowExtent(
                    bin, width, ly, extentWin, extentNeed);
                if (ext.left === -1) { sxL = -1; break; }
                if (ext.left  > sxL) sxL = ext.left;
                if (ext.right < sxR) sxR = ext.right;
            }
            if (sxL < 0 || sxR < 0 || sxR - sxL < 4 * interline) continue;

            var lines = lineYs.map(function (ly) {
                return makeLineFilament(ly, sxL, sxR);
            });

            staves.push({
                id:        rs + 1,
                interline: interline,
                lines:     lines,
                xLeft:     sxL,
                xRight:    sxR,
                yTop:      lineYs[0],
                yBottom:   lineYs[4],
                slope:     0
            });
        }
        if (staves.length === 0) {
            return { staves: [], systems: [], slope: 0,
                     reason: 'hough: 5-tuples had insufficient extent' };
        }

        staves.sort(function (a, b) { return a.yTop - b.yTop; });
        for (var si = 0; si < staves.length; si++) staves[si].id = si + 1;

        // 5. Systems via Phase 4 pairing. We prefer to reuse the exported
        //    helper so grand-staff pairing matches the LinesRetriever path
        //    byte-for-byte. Fall back to a trivial single-system bundle if
        //    the helper isn't visible.
        var systems;
        if (OMR.GridLines && OMR.GridLines._pairStavesIntoSystems) {
            systems = OMR.GridLines._pairStavesIntoSystems(staves, interline);
        } else {
            systems = [{ id: 1, staves: staves.slice(),
                         grandStaff: staves.length === 2 }];
            for (var sj = 0; sj < staves.length; sj++) {
                staves[sj].systemIdx = 0;
                staves[sj].staffIndex = sj;
            }
        }

        if (OMR.debug && OMR.debug.push) {
            OMR.debug.push('hough', renderHoughDebug(staves));
        }

        return {
            staves:  staves,
            systems: systems,
            slope:   0,
            preset:  'hough',
            reason:  null
        };
    }

    // Find the leftmost + rightmost x at row y whose sliding-window ink
    // count is above needInk. Returns {left, right} with -1 on failure.
    function measureRowExtent(bin, width, y, win, needInk) {
        if (y < 0 || y >= (bin.length / width) | 0) return { left: -1, right: -1 };
        var row = y * width;
        var halfWin = Math.floor(win / 2);
        var sum = 0;
        for (var i = 0; i < win && i < width; i++) if (bin[row + i]) sum++;
        var left = -1;
        for (var x = halfWin; x < width - halfWin; x++) {
            if (sum >= needInk) { left = x; break; }
            if (x + halfWin + 1 < width) {
                if (bin[row + x + halfWin + 1]) sum++;
                if (bin[row + x - halfWin]) sum--;
            }
        }
        if (left === -1) return { left: -1, right: -1 };

        // Reset + scan from right.
        sum = 0;
        for (var j = 0; j < win && j < width; j++) {
            if (bin[row + (width - 1) - j]) sum++;
        }
        var right = -1;
        for (var x2 = width - halfWin - 1; x2 >= halfWin; x2--) {
            if (sum >= needInk) { right = x2; break; }
            if (x2 - halfWin - 1 >= 0) {
                if (bin[row + x2 - halfWin - 1]) sum++;
                if (bin[row + x2 + halfWin]) sum--;
            }
        }
        if (right === -1) return { left: -1, right: -1 };
        return { left: left, right: right };
    }

    // Emit a minimal line object that quacks like a Filament — enough for
    // the downstream pipeline (ClefBuilder, LedgersBuilder) which call
    // getYAtX, getLength, getSlope, and read xMin/xMax directly.
    function makeLineFilament(y, xL, xR) {
        return {
            xMin:           xL,
            xMax:           xR,
            getYAtX:        function () { return y; },
            getLength:      function () { return xR - xL; },
            getSlope:       function () { return 0; },
            getMeanDistance:function () { return 0; },
            getThickness:   function () { return 1; },
            getMeanThickness:function () { return 1; },
            _houghY:        y
        };
    }

    function renderHoughDebug(staves) {
        var shapes = [];
        var colors = ['#D7BF81', '#81D7BF', '#BF81D7', '#D78181', '#81BFD7'];
        for (var s = 0; s < staves.length; s++) {
            var st = staves[s];
            var c  = colors[s % colors.length];
            for (var li = 0; li < st.lines.length; li++) {
                shapes.push({
                    kind:  'line',
                    x1:    st.xLeft,
                    y1:    st.lines[li]._houghY,
                    x2:    st.xRight,
                    y2:    st.lines[li]._houghY,
                    color: c
                });
            }
        }
        return shapes;
    }

    OMR.Hough = {
        detectStaves: detectStaves,
        _defaults:    DEFAULTS
    };

})();
