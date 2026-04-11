/**
 * PianoMode OMR Engine — NoteHeadsBuilder (Phase 8b)
 *
 * Pragmatic JavaScript port of
 *   app/src/main/java/org/audiveris/omr/sheet/note/NoteHeadsBuilder.java
 *
 * Audiveris uses a two-pass template-matching strategy to locate every
 * note head on every staff line and space position. This port follows
 * the same structure:
 *
 *   PASS 1 (seed-based, "lookupSeeds")
 *     - For every stem seed from Phase 6 that intersects a pitch
 *       position's y range, try every stem-based shape
 *       (NOTEHEAD_BLACK, NOTEHEAD_VOID) at LEFT_STEM and RIGHT_STEM
 *       anchors, in a small (x, y) neighborhood of the intersection.
 *     - Keep the best match per (seed, side, shape).
 *
 *   PASS 2 (range-based, "lookupRange")
 *     - Walk every abscissa along each pitch line.
 *     - Use the sheet's distance-to-fore map to skip empty corridors:
 *       if the distance at (x + templateHalf, y) is larger than
 *       templateHalf we know there is no ink nearby and we can jump.
 *     - At each candidate x, try NOTEHEAD_BLACK, NOTEHEAD_VOID,
 *       WHOLE_NOTE, BREVE at MIDDLE_LEFT anchor (stem-less shapes are
 *       always tested; stem shapes are also tested to catch notes whose
 *       stem is too weak to have produced a seed).
 *     - Keep the best match per shape.
 *
 * Pitch positions scanned:
 *   For a 5-line staff, pitches range from -5 (space just above line 1)
 *   to +5 (space just below line 5). The pipeline scans 11 pitches:
 *   above/on for lines 1..4, and above/on/below for line 5. See
 *   Audiveris NoteHeadsBuilder.processStaff.
 *
 * Deduplication:
 *   - Two heads with intersecting bounding boxes are deduped: the one
 *     with the higher grade (lower match distance) wins.
 *   - Distance is converted to a 0..1 grade via Template.impactOf
 *     (Audiveris uses a linear function 1 - d / maxAcceptable).
 *
 * Output head shape:
 *   { x, y, pitch, shape, grade, staff, side }
 *   where x, y is the anchor point in the sheet, pitch is the pitch
 *   position (−5..+5), side is 'LEFT' / 'RIGHT' / null, grade is the
 *   contextual grade.
 *
 * Deferred:
 *   - Ledger line positions (handled after Phase 9 LedgersBuilder
 *     assigns ledger y values to pitches ±6, ±8, ...).
 *   - Small/cue head sizes.
 *   - Black-as-void reclassification via a second hole scan.
 *   - Head spot pre-filtering to limit Pass 2 x range.
 *
 * @package PianoMode
 * @version 6.5.0
 */
(function () {
    'use strict';

    var OMR = window.PianoModeOMR;
    if (!OMR) {
        console.error('[PianoModeOMR] omr-heads.js loaded before omr-core.js');
        return;
    }
    if (!OMR.Templates) {
        console.error('[PianoModeOMR] omr-heads.js requires omr-templates.js');
        return;
    }
    if (!OMR.Distance) {
        console.error('[PianoModeOMR] omr-heads.js requires omr-distance.js');
        return;
    }

    var ANCHORS = OMR.Templates.ANCHORS;

    // Thresholds ported from NoteHeadsBuilder$Parameters (profile 0).
    // All distances are in normalized pixel units (divide raw by
    // chamfer normalizer before comparing).
    var C = {
        // Grade 0 ↔ distance == params.maxDistance
        // Grade 1 ↔ distance == 0
        maxDistanceLow:      2.0,   // acceptable head match distance
        maxDistanceHigh:     3.5,   // "reallyBad" cutoff; abandon template
        minGrade:            0.35,  // min acceptable grade (0..1)

        // x offsets tried around a seed (centered, grows outward)
        maxStemXOffsetRatio: 0.15,  // fraction of interline
        maxYOffsetRatio:     0.20,  // fraction of interline

        // Distance skip in Pass 2
        templateHalfRatio:   1.0    // templateHalf = interline * this
    };

    /**
     * Main entry point. Builds note heads for every staff in the sheet.
     *
     * @param {Uint8Array} cleanBin  staff-lines-removed binary
     * @param {number}     width
     * @param {number}     height
     * @param {object}     scale     Phase 2 Scale result
     * @param {Array}      staves    Phase 4 Staff[]
     * @param {Array}      stemSeeds Phase 6 { seeds } or array
     * @returns {{heads: Array, distanceTable: object}}
     */
    function buildHeads(cleanBin, width, height, scale, staves, stemSeeds) {
        if (!cleanBin || !scale || !scale.valid || !staves || staves.length === 0) {
            return { heads: [], distanceTable: null };
        }
        var interline     = scale.interline;
        var maxXOffset    = Math.max(1, Math.round(C.maxStemXOffsetRatio * interline));
        var maxYOffset    = Math.max(1, Math.round(C.maxYOffsetRatio * interline));
        var templateHalf  = Math.max(4, Math.round(C.templateHalfRatio * interline));

        // Compute distance-to-foreground table on the clean binary. This
        // is the single most expensive step; we do it once per sheet.
        var distTable = OMR.Distance.computeToFore(cleanBin, width, height);

        // Build template catalog at the sheet's interline.
        var catalog = OMR.Templates.buildCatalog(interline);

        // Precompute x offset sequence 0, -1, +1, -2, +2, ..., ±max.
        var xOffsets = buildOffsetSequence(maxXOffset);
        var yOffsets = buildOffsetSequence(maxYOffset);

        // Normalize seed list.
        var seeds = [];
        if (stemSeeds) {
            if (Array.isArray(stemSeeds)) seeds = stemSeeds;
            else if (stemSeeds.seeds)     seeds = stemSeeds.seeds;
        }

        var heads = [];

        // For every staff: scan every pitch position in both passes.
        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            if (!staff || !staff.lines || staff.lines.length < 5) continue;

            // Group seeds intersecting this staff's y range (+ half
            // interline margin) — Pass 1 only considers these.
            var yTop = staff.yTop - interline;
            var yBot = staff.yBottom + interline;
            var staffSeeds = [];
            for (var si = 0; si < seeds.length; si++) {
                var sd = seeds[si];
                if (sd.y2 >= yTop && sd.y1 <= yBot) staffSeeds.push(sd);
            }

            // Walk pitches −5..+5.
            for (var pitch = -5; pitch <= 5; pitch++) {
                var lineFn = makeLineYFn(staff, pitch);

                // --- PASS 1: seed-based ---
                for (var k = 0; k < staffSeeds.length; k++) {
                    var seed = staffSeeds[k];
                    var xSeed = seed.x;
                    var ySeed = lineFn(xSeed);
                    if (ySeed < seed.y1 - interline
                            || ySeed > seed.y2 + interline) continue;

                    ['LEFT_STEM', 'RIGHT_STEM'].forEach(function (anchor) {
                        ['NOTEHEAD_BLACK', 'NOTEHEAD_VOID'].forEach(function (shapeKey) {
                            var best = evalShapeNeighborhood(
                                catalog[shapeKey], xSeed, ySeed,
                                anchor, distTable, xOffsets, yOffsets);
                            if (!best) return;
                            heads.push(makeHead(best, shapeKey, anchor,
                                pitch, staff));
                        });
                    });
                }

                // --- PASS 2: range-based ---
                var xLeft  = Math.max(staff.xLeft,  templateHalf + 1);
                var xRight = Math.min(staff.xRight, width - templateHalf - 1);
                var skipJump = Math.max(2, Math.round(interline * 0.75));

                for (var x = xLeft; x <= xRight; x++) {
                    var y = Math.round(lineFn(x));
                    if (y < 0 || y >= height) continue;

                    // Fast skip if there is no ink within half a
                    // template on either side of x, y.
                    var dRight = distTable.getPixelDistance(
                        Math.min(width - 1, x + templateHalf), y);
                    if (dRight > templateHalf) {
                        x += skipJump;
                        continue;
                    }

                    // Try every shape.
                    ['NOTEHEAD_BLACK', 'NOTEHEAD_VOID', 'WHOLE_NOTE', 'BREVE'].forEach(
                        function (shapeKey) {
                            var best = evalShapeNeighborhood(
                                catalog[shapeKey], x, y,
                                ANCHORS.MIDDLE_LEFT, distTable,
                                yOffsetsTinyAt(maxYOffset), [0]);
                            if (!best) return;
                            heads.push(makeHead(best, shapeKey,
                                ANCHORS.MIDDLE_LEFT, pitch, staff));
                        });
                }
            }
        }

        // Dedup by overlapping bounding box: keep the head with the best
        // grade (lowest distance).
        var deduped = dedupHeads(heads, catalog, interline);

        // Debug overlay.
        if (OMR.debug && OMR.debug.push) {
            var shapes = [];
            for (var h = 0; h < deduped.length; h++) {
                var hd = deduped[h];
                var tpl = catalog[hd.shape];
                shapes.push({
                    kind: 'rect',
                    x:    hd.x - tpl.width / 2,
                    y:    hd.y - tpl.height / 2,
                    w:    tpl.width,
                    h:    tpl.height,
                    color: hd.shape === 'NOTEHEAD_BLACK' ? '#ff3366'
                         : hd.shape === 'NOTEHEAD_VOID'  ? '#33ffee'
                         : hd.shape === 'WHOLE_NOTE'     ? '#ffff33'
                                                         : '#aaaaaa'
                });
            }
            OMR.debug.push('heads', shapes);
        }

        if (typeof console !== 'undefined' && console.log) {
            console.log('[PianoModeOMR] Heads: ' + heads.length
                        + ' raw matches, ' + deduped.length + ' after dedup');
        }

        return { heads: deduped, distanceTable: distTable };
    }

    // -------------------------------------------------------------------
    // Shape evaluation at (x, y) with small neighborhood search.
    // Returns { x, y, d, grade } for the best match, or null if no match
    // is below the reallyBad cutoff or no match beats maxDistanceLow.
    // -------------------------------------------------------------------
    function evalShapeNeighborhood(template, x0, y0, anchorName,
                                    distTable, xOffsets, yOffsets) {
        if (!template) return null;
        var bestD = Infinity;
        var bestX = x0;
        var bestY = y0;
        for (var i = 0; i < xOffsets.length; i++) {
            var x = x0 + xOffsets[i];
            for (var j = 0; j < yOffsets.length; j++) {
                var y = y0 + yOffsets[j];
                var d = template.evaluate(x, y, anchorName, distTable);
                if (d < bestD) {
                    bestD = d;
                    bestX = x;
                    bestY = y;
                }
                // First eval: if really bad, abandon this shape entirely.
                if (i === 0 && j === 0 && d > C.maxDistanceHigh) {
                    return null;
                }
            }
        }
        if (bestD > C.maxDistanceLow) return null;
        return {
            x:     bestX,
            y:     bestY,
            d:     bestD,
            grade: distanceToGrade(bestD)
        };
    }

    function makeHead(loc, shapeKey, anchorName, pitch, staff) {
        var side = (anchorName === 'LEFT_STEM')  ? 'LEFT'
                 : (anchorName === 'RIGHT_STEM') ? 'RIGHT'
                 : null;
        return {
            x:     loc.x,
            y:     loc.y,
            d:     loc.d,
            grade: loc.grade,
            shape: shapeKey,
            pitch: pitch,
            side:  side,
            staff: staff
        };
    }

    // Audiveris impactOf: linear falloff from 1 at d=0 to 0 at maxDistance.
    function distanceToGrade(d) {
        var g = 1.0 - (d / C.maxDistanceHigh);
        if (g < 0) g = 0;
        if (g > 1) g = 1;
        return g;
    }

    // -------------------------------------------------------------------
    // Dedup by bounding-box overlap — keep the best-grade head per cluster.
    // Runs in O(n^2) which is fine for a few hundred matches per sheet.
    // -------------------------------------------------------------------
    function dedupHeads(heads, catalog, interline) {
        // Sort by x so we can early-exit the inner loop.
        heads.sort(function (a, b) { return a.x - b.x; });

        var result = [];
        var removed = new Uint8Array(heads.length);
        var maxW = interline * 2;

        for (var i = 0; i < heads.length; i++) {
            if (removed[i]) continue;
            var hi = heads[i];
            var ti = catalog[hi.shape];
            var xi0 = hi.x - ti.width / 2;
            var xi1 = hi.x + ti.width / 2;
            var yi0 = hi.y - ti.height / 2;
            var yi1 = hi.y + ti.height / 2;
            for (var j = i + 1; j < heads.length; j++) {
                if (removed[j]) continue;
                var hj = heads[j];
                if (hj.x - hi.x > maxW) break;
                var tj = catalog[hj.shape];
                var xj0 = hj.x - tj.width / 2;
                var xj1 = hj.x + tj.width / 2;
                var yj0 = hj.y - tj.height / 2;
                var yj1 = hj.y + tj.height / 2;
                if (xi1 < xj0 || xj1 < xi0 || yi1 < yj0 || yj1 < yi0) continue;
                // Overlap — drop the worse one.
                if (hj.grade > hi.grade) {
                    removed[i] = 1;
                    break;
                } else {
                    removed[j] = 1;
                }
            }
            if (!removed[i]) result.push(hi);
        }

        // Filter by minGrade.
        return result.filter(function (h) { return h.grade >= C.minGrade; });
    }

    // -------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------

    // Build a symmetric search sequence: 0, -1, +1, -2, +2, ..., ±max.
    function buildOffsetSequence(max) {
        var out = [0];
        for (var i = 1; i <= max; i++) {
            out.push(-i);
            out.push(+i);
        }
        return out;
    }

    // Smaller y sweep for Pass 2 (abscissa scan) — we already sit on the
    // theoretical y from the line function, so ±1 is enough.
    function yOffsetsTinyAt(maxY) {
        void maxY;
        return [0, -1, 1];
    }

    // Return a function x -> y that computes the theoretical y on the
    // staff at the given pitch. Pitch -4, -2, 0, 2, 4 are the five staff
    // lines (indexes 0..4). Odd pitches are interpolated between adjacent
    // lines. Pitches -5 / +5 are extrapolated half an interline outside.
    function makeLineYFn(staff, pitch) {
        var lines = staff.lines;
        var N = lines.length; // 5
        return function (x) {
            // Map pitch to line index as float.
            // pitch -4 → 0, -3 → 0.5, -2 → 1, ..., 4 → 4, 5 → 4.5
            var idx = (pitch + 4) / 2;
            if (idx <= 0) {
                // Extrapolate above line 0.
                var y0 = lines[0].getYAtX(x);
                var y1 = lines[1].getYAtX(x);
                var dy = y1 - y0;
                return y0 + idx * dy;
            }
            if (idx >= N - 1) {
                var yN1 = lines[N - 1].getYAtX(x);
                var yN2 = lines[N - 2].getYAtX(x);
                var dyN = yN1 - yN2;
                return yN1 + (idx - (N - 1)) * dyN;
            }
            var lo = Math.floor(idx);
            var hi = lo + 1;
            var t  = idx - lo;
            return (1 - t) * lines[lo].getYAtX(x) + t * lines[hi].getYAtX(x);
        };
    }

    // -------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------
    OMR.Heads = {
        buildHeads:      buildHeads,
        _evalShape:      evalShapeNeighborhood,
        _dedup:          dedupHeads,
        _distanceToGrade: distanceToGrade
    };

    if (typeof console !== 'undefined' && console.log) {
        console.log('[PianoModeOMR] omr-heads loaded '
                    + '(Phase 8b NoteHeadsBuilder port)');
    }
})();
