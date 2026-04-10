/**
 * PianoMode OMR Engine — BarsRetriever + StaffProjector (Phase 5)
 *
 * Pragmatic JavaScript port of Audiveris's barline detection and system
 * assembly. Mirrors the high-level pipeline of
 *
 *   app/src/main/java/org/audiveris/omr/sheet/grid/BarsRetriever.java
 *   app/src/main/java/org/audiveris/omr/sheet/grid/StaffProjector.java
 *
 * without shipping all 3000+ lines of Java. Responsibilities:
 *
 *   1. StaffProjector
 *      - Build a 1-D vertical-ink projection between the first and last
 *        staff lines for every abscissa x inside each staff.
 *      - Find peaks (columns whose projection exceeds `barThreshold`) and
 *        refine their x-boundaries using the projection derivative.
 *      - Return peaks as {x, left, right, width, top, bottom, strength}.
 *
 *   2. BarsRetriever
 *      - For every adjacent pair of staves, try to align peaks within a
 *        small deskewed x-offset and verify there is concrete ink
 *        connecting them vertically (a BarConnection).
 *      - Group staves into systems with a union-find over connections
 *        (piano grand staff = two staves connected by a full-height
 *        barline).
 *      - Classify peak widths into THIN / THICK barlines using the median
 *        width of the set.
 *      - Emit Barline objects per staff and System objects per connected
 *        component.
 *
 * Deferred to later phases (full Audiveris fidelity):
 *   - Brace + bracket detection
 *   - C-clef removal
 *   - Repeat dot detection
 *   - Part groups (square, brace, bracket hierarchies)
 *   - Custom connector line rendering
 *
 * Feature-flagged behind OMR.flags.useNewBars — while false the module
 * still runs so we can render its output in the debug overlay.
 *
 * @package PianoMode
 * @version 6.4.0
 */
(function () {
    'use strict';

    var OMR = window.PianoModeOMR;
    if (!OMR) {
        console.error('[PianoModeOMR] omr-grid-bars.js loaded before omr-core.js');
        return;
    }

    // Audiveris BarsRetriever + StaffProjector constants, converted to
    // interline fractions where the Java code expresses them so.
    var C = {
        // Projection thresholds
        barThresholdInterlines:     2.5,   // min cumulative ink per column
        gapThresholdInterlines:     0.6,   // max interior white gap
        minDerivativeRatio:         0.3,   // min derivative vs top elite

        // Peak width classification
        maxBarWidthInterlines:      1.5,   // peaks wider than this are not bars

        // Cross-staff alignment
        maxAlignmentDxInterlines:   0.75,  // max deskewed x offset
        minConnectionFillRatio:     0.60,  // fraction of gap rows that must be ink

        // Staff x-margin for projection
        xMarginInterlines:          0.5
    };

    // -------------------------------------------------------------------
    // StaffProjector — compute per-staff projection + peaks.
    // -------------------------------------------------------------------
    function buildStaffProjection(bin, width, height, staff) {
        var interline = staff.interline || 20;
        var xMargin   = Math.round(C.xMarginInterlines * interline);
        var xStart    = Math.max(0, Math.round(staff.xLeft  - xMargin));
        var xEnd      = Math.min(width - 1, Math.round(staff.xRight + xMargin));

        // Line getters. Top line is lines[0], bottom is lines[last].
        var topLine = staff.lines[0];
        var botLine = staff.lines[staff.lines.length - 1];

        var projLen = xEnd - xStart + 1;
        var proj    = new Int32Array(projLen);

        for (var xi = 0; xi < projLen; xi++) {
            var x  = xStart + xi;
            var yTop = Math.max(0, Math.round(topLine.getYAtX(x)));
            var yBot = Math.min(height - 1, Math.round(botLine.getYAtX(x)));
            if (yBot <= yTop) continue;
            var count = 0;
            var row = yTop * width + x;
            for (var y = yTop; y <= yBot; y++) {
                if (bin[row]) count++;
                row += width;
            }
            proj[xi] = count;
        }

        return {
            xStart: xStart,
            xEnd:   xEnd,
            proj:   proj,
            staff:  staff
        };
    }

    function findProjectionPeaks(projection, interline) {
        var proj   = projection.proj;
        var xStart = projection.xStart;
        var len    = proj.length;

        // Threshold in ink rows per column: barThreshold * interline
        // (Audiveris multiplies by line count; 4 interlines approximately).
        var threshold = Math.round(C.barThresholdInterlines * interline);
        var maxWidth  = Math.max(1, Math.round(C.maxBarWidthInterlines * interline));

        // Derivative elite normalizer: top N absolute derivatives median.
        var deriv = new Int32Array(len);
        for (var i = 1; i < len; i++) deriv[i] = proj[i] - proj[i - 1];

        // Walk projection and carve out peaks above `threshold`.
        var peaks = [];
        var i0 = 0;
        while (i0 < len) {
            if (proj[i0] < threshold) { i0++; continue; }
            var i1 = i0;
            while (i1 + 1 < len && proj[i1 + 1] >= threshold) i1++;

            // Reject peaks wider than maxBarWidth — those are usually ink
            // blobs like a clef or beam group, not a barline.
            var width = (i1 - i0 + 1);
            if (width <= maxWidth) {
                // Strength = max projection value inside the peak.
                var pmax = 0;
                var pxAtMax = i0;
                for (var p = i0; p <= i1; p++) {
                    if (proj[p] > pmax) { pmax = proj[p]; pxAtMax = p; }
                }
                peaks.push({
                    xLeft:    xStart + i0,
                    xRight:   xStart + i1,
                    x:        xStart + pxAtMax,
                    width:    width,
                    strength: pmax,
                    staff:    projection.staff
                });
            }
            i0 = i1 + 1;
        }
        return peaks;
    }

    // -------------------------------------------------------------------
    // BarsRetriever — cross-staff peak alignment, system grouping, output.
    // -------------------------------------------------------------------
    function retrieveBarsAndSystems(bin, width, height, staves, scale) {
        if (!staves || staves.length === 0) {
            return { barlines: [], systems: [], peaks: [] };
        }
        var interline = scale && scale.interline ? scale.interline
                                                 : staves[0].interline;

        // 1. Per-staff projection + peaks.
        var perStaff = [];
        for (var s = 0; s < staves.length; s++) {
            var projection = buildStaffProjection(bin, width, height, staves[s]);
            var peaks      = findProjectionPeaks(projection, interline);
            perStaff.push({ staff: staves[s], projection: projection, peaks: peaks });
        }

        // 2. Align peaks between adjacent staves + test vertical ink.
        var maxDx = Math.max(3, Math.round(C.maxAlignmentDxInterlines * interline));
        var parent = [];
        for (var k = 0; k < staves.length; k++) parent.push(k);
        function find(a) {
            while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
            return a;
        }
        function union(a, b) {
            var ra = find(a), rb = find(b);
            if (ra !== rb) parent[ra] = rb;
        }

        var connections = [];
        for (var si = 0; si < perStaff.length - 1; si++) {
            var upper = perStaff[si];
            var lower = perStaff[si + 1];
            // Deskew the lower peaks using slope difference. For a nearly
            // horizontal sheet this is a no-op.
            var slope = (upper.staff.slope + lower.staff.slope) / 2;

            for (var pu = 0; pu < upper.peaks.length; pu++) {
                var up = upper.peaks[pu];
                for (var pl = 0; pl < lower.peaks.length; pl++) {
                    var lp = lower.peaks[pl];
                    // Skew-corrected dx: project upper peak down by slope.
                    var yMidUpper = (up.staff.yTop + up.staff.yBottom) / 2;
                    var yMidLower = (lp.staff.yTop + lp.staff.yBottom) / 2;
                    var dySpan = yMidLower - yMidUpper;
                    var upAdjustedX = up.x + slope * dySpan;
                    if (Math.abs(upAdjustedX - lp.x) > maxDx) continue;
                    if (hasVerticalInkBetween(bin, width, height,
                            Math.round((up.x + lp.x) / 2),
                            Math.round(up.staff.yBottom),
                            Math.round(lp.staff.yTop))) {
                        connections.push({ upper: up, lower: lp });
                        union(si, si + 1);
                    }
                }
            }
        }

        // 3. Build systems via DSU buckets.
        var systemMap = {};
        for (var ss = 0; ss < staves.length; ss++) {
            var root = find(ss);
            if (!systemMap[root]) systemMap[root] = [];
            systemMap[root].push(staves[ss]);
        }
        var systems = [];
        Object.keys(systemMap).sort(function (a, b) {
            return systemMap[a][0].yTop - systemMap[b][0].yTop;
        }).forEach(function (rootKey, idx) {
            var group = systemMap[rootKey];
            systems.push({
                id:     idx + 1,
                staves: group,
                top:    group[0].yTop,
                bottom: group[group.length - 1].yBottom
            });
        });

        // 4. Classify peak widths: THIN vs THICK via median split.
        var allPeaks = [];
        for (var j = 0; j < perStaff.length; j++) {
            for (var q = 0; q < perStaff[j].peaks.length; q++) {
                allPeaks.push(perStaff[j].peaks[q]);
            }
        }
        if (allPeaks.length > 0) {
            var widths = allPeaks.map(function (p) { return p.width; }).sort(
                function (a, b) { return a - b; });
            var median = widths[Math.floor(widths.length / 2)];
            for (var m = 0; m < allPeaks.length; m++) {
                allPeaks[m].kind = (allPeaks[m].width > median * 1.5)
                    ? 'THICK'
                    : 'THIN';
            }
        }

        // 5. Convert peaks to Barline objects and attach per-staff.
        var barlines = [];
        for (var pp = 0; pp < allPeaks.length; pp++) {
            var pk = allPeaks[pp];
            var bl = {
                x:      pk.x,
                xLeft:  pk.xLeft,
                xRight: pk.xRight,
                top:    pk.staff.yTop,
                bottom: pk.staff.yBottom,
                width:  pk.width,
                kind:   pk.kind || 'THIN',
                staff:  pk.staff
            };
            barlines.push(bl);
        }

        // 6. Per-system barline attachment. A system's barlines are the
        // deskew-aligned set of peaks that connect ALL staves in the
        // system at (approximately) the same x.
        for (var sy = 0; sy < systems.length; sy++) {
            var sys = systems[sy];
            sys.barlines = [];
            if (sys.staves.length === 1) {
                // Single-staff system: every peak on that staff is a bar.
                for (var b = 0; b < barlines.length; b++) {
                    if (barlines[b].staff === sys.staves[0]) {
                        sys.barlines.push(barlines[b]);
                    }
                }
            } else {
                // Multi-staff: only peaks that align across ALL system staves.
                var firstStaff = sys.staves[0];
                var firstPeaks = barlines.filter(function (b0) {
                    return b0.staff === firstStaff;
                });
                for (var fp = 0; fp < firstPeaks.length; fp++) {
                    var seed = firstPeaks[fp];
                    var present = true;
                    var group   = [seed];
                    for (var ss2 = 1; ss2 < sys.staves.length && present; ss2++) {
                        var found = null;
                        for (var bb = 0; bb < barlines.length; bb++) {
                            if (barlines[bb].staff !== sys.staves[ss2]) continue;
                            if (Math.abs(barlines[bb].x - seed.x) <= maxDx) {
                                found = barlines[bb];
                                break;
                            }
                        }
                        if (!found) present = false;
                        else group.push(found);
                    }
                    if (present) {
                        sys.barlines.push({
                            x:     seed.x,
                            kind:  seed.kind,
                            group: group
                        });
                    }
                }
            }
        }

        // 7. Debug overlay.
        if (OMR.debug && OMR.debug.push) {
            var shapes = [];
            for (var bi = 0; bi < barlines.length; bi++) {
                var blx = barlines[bi];
                shapes.push({
                    kind:  'line',
                    x1:    blx.x, y1: blx.top,
                    x2:    blx.x, y2: blx.bottom,
                    color: blx.kind === 'THICK' ? '#ff3333' : '#33ccff'
                });
            }
            for (var syi = 0; syi < systems.length; syi++) {
                var sysd = systems[syi];
                shapes.push({
                    kind:  'label',
                    x:     10,
                    y:     Math.round(sysd.top) - 4,
                    text:  'SYS' + sysd.id + ' (' + sysd.staves.length + ')',
                    color: '#ffcc00'
                });
            }
            OMR.debug.push('gridBars', shapes);
        }

        if (typeof console !== 'undefined' && console.log) {
            console.log('[PianoModeOMR] Grid/Bars: ' + barlines.length
                        + ' peaks, ' + connections.length + ' connections, '
                        + systems.length + ' system(s)');
        }

        return {
            barlines:    barlines,
            systems:     systems,
            connections: connections,
            peaks:       allPeaks
        };
    }

    // -------------------------------------------------------------------
    // Helper: test whether there is a continuous vertical stroke of ink
    // between y0 and y1 at (approximately) a given x. Used to validate a
    // peak-to-peak BarConnection. Scans a small x-corridor (±1 px) to be
    // tolerant of slight misalignment.
    // -------------------------------------------------------------------
    function hasVerticalInkBetween(bin, width, height, x, y0, y1) {
        if (y1 <= y0) return false;
        if (x < 1 || x >= width - 1) return false;
        var inkRows = 0;
        var totalRows = (y1 - y0 + 1);
        for (var y = y0; y <= y1; y++) {
            if (y < 0 || y >= height) continue;
            if (bin[y * width + x]
                    || bin[y * width + x - 1]
                    || bin[y * width + x + 1]) {
                inkRows++;
            }
        }
        return (inkRows / totalRows) >= C.minConnectionFillRatio;
    }

    // -------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------
    OMR.GridBars = {
        retrieveBarsAndSystems: retrieveBarsAndSystems,
        _buildStaffProjection:  buildStaffProjection,
        _findProjectionPeaks:   findProjectionPeaks
    };

    if (typeof console !== 'undefined' && console.log) {
        console.log('[PianoModeOMR] omr-grid-bars loaded '
                    + '(Phase 5 BarsRetriever + StaffProjector port)');
    }
})();
