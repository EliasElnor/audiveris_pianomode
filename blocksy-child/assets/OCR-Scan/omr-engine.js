/**
 * PianoMode OMR Engine v5.0 - Complete Client-Side Music Recognition
 * Converts sheet music images/PDFs into MusicXML + MIDI entirely in the browser.
 *
 * Modules: ImageProcessor, StaffDetector, NoteDetector, MusicXMLWriter, MIDIWriter, Engine
 * No server dependencies. No Java. No Audiveris.
 *
 * Key v5.0 improvements over v4.0:
 *   - Audiveris-style barline detection via vertical projection + derivative peaks
 *   - Measure-based note organization (barline-bounded)
 *   - Proper time/voice assignment within measures
 *   - Beam group detection for duration classification
 *   - Key/time signature detection (Audiveris KeyBuilder approach)
 *   - Grand staff handling with proper MusicXML staves/voices
 *   - Fixed MusicXML timing (backup/forward, divisions=16)
 *   - Fixed MIDI rest handling and delta times
 *
 * @package PianoMode
 * @version 5.0.0
 */
(function() {
'use strict';

var VERSION = 'v5.0';
var OMR = window.PianoModeOMR = {};

/* =========================================================================
 *  MODULE 1: ImageProcessor
 * ========================================================================= */
OMR.ImageProcessor = {

    loadImage: function(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                var img = new Image();
                img.onload = function() {
                    var canvas = document.createElement('canvas');
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

    loadPDF: function(file) {
        return new Promise(function(resolve, reject) {
            if (typeof pdfjsLib === 'undefined') {
                reject(new Error('PDF.js library not loaded'));
                return;
            }
            var reader = new FileReader();
            reader.onload = function(e) {
                var typedArray = new Uint8Array(e.target.result);
                pdfjsLib.getDocument({ data: typedArray }).promise.then(function(pdf) {
                    return pdf.getPage(1);
                }).then(function(page) {
                    var scale = 3.0;
                    var viewport = page.getViewport({ scale: scale });
                    var canvas = document.createElement('canvas');
                    canvas.width = Math.round(viewport.width);
                    canvas.height = Math.round(viewport.height);
                    var ctx = canvas.getContext('2d');
                    return page.render({
                        canvasContext: ctx,
                        viewport: viewport
                    }).promise.then(function() {
                        var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        resolve({
                            imageData: imageData,
                            width: canvas.width,
                            height: canvas.height,
                            canvas: canvas
                        });
                    });
                }).catch(function(err) {
                    reject(new Error('PDF render failed: ' + err.message));
                });
            };
            reader.onerror = function() { reject(new Error('Failed to read PDF file')); };
            reader.readAsArrayBuffer(file);
        });
    },

    toGrayscale: function(imageData) {
        var data = imageData.data;
        var w = imageData.width;
        var h = imageData.height;
        var gray = new Uint8Array(w * h);
        for (var i = 0; i < w * h; i++) {
            var off = i * 4;
            gray[i] = Math.round(0.299 * data[off] + 0.587 * data[off + 1] + 0.114 * data[off + 2]);
        }
        return gray;
    },

    otsuThreshold: function(gray) {
        var hist = new Array(256);
        var i;
        for (i = 0; i < 256; i++) hist[i] = 0;
        for (i = 0; i < gray.length; i++) hist[gray[i]]++;

        var total = gray.length;
        var sum = 0;
        for (i = 0; i < 256; i++) sum += i * hist[i];

        var sumB = 0, wB = 0, wF = 0;
        var maxVariance = 0, threshold = 128;

        for (i = 0; i < 256; i++) {
            wB += hist[i];
            if (wB === 0) continue;
            wF = total - wB;
            if (wF === 0) break;
            sumB += i * hist[i];
            var mB = sumB / wB;
            var mF = (sum - sumB) / wF;
            var variance = wB * wF * (mB - mF) * (mB - mF);
            if (variance > maxVariance) {
                maxVariance = variance;
                threshold = i;
            }
        }
        return threshold;
    },

    binarize: function(gray, threshold) {
        var bin = new Uint8Array(gray.length);
        for (var i = 0; i < gray.length; i++) {
            bin[i] = gray[i] < threshold ? 1 : 0;
        }
        return bin;
    },

    cleanNoise: function(bin, width, height, minSize) {
        minSize = minSize || 4;
        var visited = new Uint8Array(width * height);
        var stack = [];
        var component = [];

        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var idx = y * width + x;
                if (bin[idx] === 1 && visited[idx] === 0) {
                    component.length = 0;
                    stack.length = 0;
                    stack.push(idx);
                    visited[idx] = 1;
                    while (stack.length > 0) {
                        var cur = stack.pop();
                        component.push(cur);
                        var cx = cur % width;
                        var cy = (cur - cx) / width;
                        var neighbors = [
                            cy > 0 ? cur - width : -1,
                            cy < height - 1 ? cur + width : -1,
                            cx > 0 ? cur - 1 : -1,
                            cx < width - 1 ? cur + 1 : -1
                        ];
                        for (var n = 0; n < 4; n++) {
                            var ni = neighbors[n];
                            if (ni >= 0 && bin[ni] === 1 && visited[ni] === 0) {
                                visited[ni] = 1;
                                stack.push(ni);
                            }
                        }
                    }
                    if (component.length < minSize) {
                        for (var c = 0; c < component.length; c++) {
                            bin[component[c]] = 0;
                        }
                    }
                }
            }
        }
        return bin;
    }
};


/* =========================================================================
 *  MODULE 2: StaffDetector
 * ========================================================================= */
OMR.StaffDetector = {

    detect: function(bin, width, height) {
        var hProj = new Uint32Array(height);
        var x, y, idx, i;
        for (y = 0; y < height; y++) {
            var count = 0;
            idx = y * width;
            for (x = 0; x < width; x++) {
                if (bin[idx + x] === 1) count++;
            }
            hProj[y] = count;
        }

        var totalBlack = 0;
        for (y = 0; y < height; y++) totalBlack += hProj[y];
        var avgBlack = totalBlack / height;
        var lineThreshold = Math.max(avgBlack * 2.0, width * 0.15);

        var lineRows = [];
        for (y = 0; y < height; y++) {
            if (hProj[y] >= lineThreshold) lineRows.push(y);
        }

        var lineSegments = [];
        if (lineRows.length > 0) {
            var segStart = lineRows[0];
            var segEnd = lineRows[0];
            for (i = 1; i < lineRows.length; i++) {
                if (lineRows[i] <= segEnd + 2) {
                    segEnd = lineRows[i];
                } else {
                    lineSegments.push({ y: Math.round((segStart + segEnd) / 2), top: segStart, bottom: segEnd, thickness: segEnd - segStart + 1 });
                    segStart = lineRows[i];
                    segEnd = lineRows[i];
                }
            }
            lineSegments.push({ y: Math.round((segStart + segEnd) / 2), top: segStart, bottom: segEnd, thickness: segEnd - segStart + 1 });
        }

        var staves = [];
        var used = new Array(lineSegments.length);
        for (i = 0; i < used.length; i++) used[i] = false;

        for (i = 0; i <= lineSegments.length - 5; i++) {
            if (used[i]) continue;
            var group = [lineSegments[i]];
            var lastIdx = i;
            var valid = true;
            var g, j, k;

            for (g = 1; g < 5; g++) {
                var expectedSpacing = (group.length > 1) ?
                    (group[group.length - 1].y - group[0].y) / (group.length - 1) : 0;
                var bestJ = -1;
                var bestDist = Infinity;

                for (j = lastIdx + 1; j < lineSegments.length && j <= lastIdx + 4; j++) {
                    if (used[j]) continue;
                    var gap = lineSegments[j].y - group[group.length - 1].y;
                    if (gap < 3) continue;
                    if (gap > 50) break;

                    if (expectedSpacing > 0) {
                        var dev = Math.abs(gap - expectedSpacing);
                        if (dev < bestDist && dev < expectedSpacing * 0.5) {
                            bestDist = dev;
                            bestJ = j;
                        }
                    } else {
                        if (gap < bestDist && gap >= 5 && gap <= 40) {
                            bestDist = gap;
                            bestJ = j;
                        }
                    }
                }

                if (bestJ === -1) { valid = false; break; }
                group.push(lineSegments[bestJ]);
                lastIdx = bestJ;
            }

            if (!valid || group.length !== 5) continue;

            var spacings = [];
            for (g = 1; g < 5; g++) spacings.push(group[g].y - group[g - 1].y);
            var avgSpacing = (spacings[0] + spacings[1] + spacings[2] + spacings[3]) / 4;
            var maxDev = 0;
            for (g = 0; g < 4; g++) {
                var d = Math.abs(spacings[g] - avgSpacing);
                if (d > maxDev) maxDev = d;
            }
            if (maxDev > avgSpacing * 0.35) continue;

            var lines = [];
            for (g = 0; g < 5; g++) {
                lines.push(group[g].y);
                for (k = 0; k < lineSegments.length; k++) {
                    if (lineSegments[k] === group[g]) { used[k] = true; break; }
                }
            }

            var staffTop = lines[0] - Math.round(avgSpacing);
            var staffBottom = lines[4] + Math.round(avgSpacing);
            if (staffTop < 0) staffTop = 0;
            if (staffBottom >= height) staffBottom = height - 1;

            var staffLeft = width, staffRight = 0;
            for (y = lines[0]; y <= lines[4]; y++) {
                for (x = 0; x < width; x++) {
                    if (bin[y * width + x] === 1) {
                        if (x < staffLeft) staffLeft = x;
                        if (x > staffRight) staffRight = x;
                    }
                }
            }
            if (staffLeft > 20) staffLeft -= 10;
            if (staffRight < width - 20) staffRight += 10;

            staves.push({
                lines: lines,
                top: staffTop,
                bottom: staffBottom,
                left: staffLeft,
                right: staffRight,
                spacing: avgSpacing,
                lineThickness: Math.round((group[0].thickness + group[1].thickness + group[2].thickness + group[3].thickness + group[4].thickness) / 5),
                clef: 'treble',
                staffIndex: staves.length
            });
        }

        if (staves.length === 0) {
            console.warn('[StaffDetector] No staves found');
            return { staves: [], staffSpacing: 12, systems: [] };
        }

        var globalSpacing = 0;
        for (i = 0; i < staves.length; i++) globalSpacing += staves[i].spacing;
        globalSpacing = globalSpacing / staves.length;

        var systems = this.groupIntoSystems(staves, globalSpacing);
        this.detectClefs(bin, width, height, staves);
        for (i = 0; i < staves.length; i++) staves[i].staffIndex = i;

        console.log('[StaffDetector] Found ' + staves.length + ' staves in ' + systems.length + ' systems, spacing=' + Math.round(globalSpacing));
        return { staves: staves, staffSpacing: globalSpacing, systems: systems };
    },

    groupIntoSystems: function(staves, spacing) {
        var systems = [];
        var i = 0;
        while (i < staves.length) {
            if (i + 1 < staves.length) {
                var gap = staves[i + 1].lines[0] - staves[i].lines[4];
                if (gap < spacing * 3.5 && gap > 0) {
                    systems.push({
                        staves: [staves[i], staves[i + 1]],
                        top: staves[i].top,
                        bottom: staves[i + 1].bottom,
                        isGrandStaff: true
                    });
                    i += 2;
                    continue;
                }
            }
            systems.push({
                staves: [staves[i]],
                top: staves[i].top,
                bottom: staves[i].bottom,
                isGrandStaff: false
            });
            i++;
        }
        return systems;
    },

    removeStaffLines: function(bin, width, height, staves) {
        var cleaned = new Uint8Array(bin);
        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            var maxThick = staff.lineThickness + 2;

            for (var lineIdx = 0; lineIdx < 5; lineIdx++) {
                var lineY = staff.lines[lineIdx];
                var searchTop = lineY - Math.ceil(maxThick / 2);
                var searchBot = lineY + Math.ceil(maxThick / 2);
                if (searchTop < 0) searchTop = 0;
                if (searchBot >= height) searchBot = height - 1;

                for (var x = staff.left; x <= staff.right; x++) {
                    var runTop = -1, runBot = -1;
                    for (var y = searchTop; y <= searchBot; y++) {
                        if (bin[y * width + x] === 1) {
                            if (runTop === -1) runTop = y;
                            runBot = y;
                        }
                    }
                    if (runTop === -1) continue;
                    var runLen = runBot - runTop + 1;

                    if (runLen <= maxThick) {
                        var hasAbove = (runTop > 0 && bin[(runTop - 1) * width + x] === 1);
                        var hasBelow = (runBot < height - 1 && bin[(runBot + 1) * width + x] === 1);
                        if (!(hasAbove && hasBelow)) {
                            for (var ey = runTop; ey <= runBot; ey++) {
                                cleaned[ey * width + x] = 0;
                            }
                        }
                    }
                }
            }
        }
        return cleaned;
    },

    detectClefs: function(bin, width, height, staves) {
        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            var sp = staff.spacing;
            var regionLeft = staff.left;
            var regionRight = Math.min(staff.left + Math.round(sp * 3), staff.right);
            var regionTop = staff.lines[0] - Math.round(sp * 1.5);
            var regionBottom = staff.lines[4] + Math.round(sp * 1.5);
            if (regionTop < 0) regionTop = 0;
            if (regionBottom >= height) regionBottom = height - 1;

            var centerY = Math.round((staff.lines[0] + staff.lines[4]) / 2);
            var aboveCount = 0, belowCount = 0;
            for (var y = regionTop; y <= regionBottom; y++) {
                for (var x = regionLeft; x < regionRight; x++) {
                    if (bin[y * width + x] === 1) {
                        if (y < centerY) aboveCount++;
                        else belowCount++;
                    }
                }
            }

            var ratio = (aboveCount + 1) / (belowCount + 1);
            var extentAbove = 0;
            for (y = regionTop; y < staff.lines[0]; y++) {
                for (x = regionLeft; x < regionRight; x++) {
                    if (bin[y * width + x] === 1) { extentAbove++; break; }
                }
            }

            if (extentAbove > sp * 1.2 && ratio > 0.7) {
                staff.clef = 'treble';
            } else {
                staff.clef = 'bass';
            }
        }
    }
};


/* =========================================================================
 *  MODULE 3: NoteDetector
 * ========================================================================= */
OMR.NoteDetector = {

    computeDistanceTransform: function(bin, width, height) {
        var dt = new Uint16Array(width * height);
        var INF = 30000;
        var x, y, idx;

        for (idx = 0; idx < width * height; idx++) {
            dt[idx] = bin[idx] === 1 ? INF : 0;
        }

        for (y = 1; y < height - 1; y++) {
            for (x = 1; x < width - 1; x++) {
                idx = y * width + x;
                if (dt[idx] === 0) continue;
                var v = dt[idx];
                var a = dt[(y - 1) * width + (x - 1)] + 4;
                var b = dt[(y - 1) * width + x] + 3;
                var c = dt[(y - 1) * width + (x + 1)] + 4;
                var d = dt[y * width + (x - 1)] + 3;
                if (a < v) v = a;
                if (b < v) v = b;
                if (c < v) v = c;
                if (d < v) v = d;
                dt[idx] = v;
            }
        }

        for (y = height - 2; y >= 1; y--) {
            for (x = width - 2; x >= 1; x--) {
                idx = y * width + x;
                if (dt[idx] === 0) continue;
                var v2 = dt[idx];
                var e = dt[y * width + (x + 1)] + 3;
                var f = dt[(y + 1) * width + (x - 1)] + 4;
                var g = dt[(y + 1) * width + x] + 3;
                var h = dt[(y + 1) * width + (x + 1)] + 4;
                if (e < v2) v2 = e;
                if (f < v2) v2 = f;
                if (g < v2) v2 = g;
                if (h < v2) v2 = h;
                dt[idx] = v2;
            }
        }

        return dt;
    },

    _makeNoteTemplate: function(sp) {
        var rx = Math.round(sp * 0.65);
        var ry = Math.round(sp * 0.42);
        var tw = rx * 2 + 1;
        var th = ry * 2 + 1;
        var tpl = new Uint8Array(tw * th);
        var cx = rx, cy = ry;
        var angle = -0.35;
        var cosA = Math.cos(angle);
        var sinA = Math.sin(angle);

        for (var ty = 0; ty < th; ty++) {
            for (var tx = 0; tx < tw; tx++) {
                var dx = tx - cx;
                var dy = ty - cy;
                var rdx = dx * cosA + dy * sinA;
                var rdy = -dx * sinA + dy * cosA;
                var val = (rdx * rdx) / (rx * rx) + (rdy * rdy) / (ry * ry);
                tpl[ty * tw + tx] = val <= 1.0 ? 1 : 0;
            }
        }
        return { data: tpl, width: tw, height: th };
    },

    scanForNoteheads: function(bin, dt, width, height, staves, staffSpacing, preambleWidths) {
        var sp = staffSpacing;
        var tpl = this._makeNoteTemplate(sp);
        var tw = tpl.width;
        var th = tpl.height;
        var tplData = tpl.data;
        var tplPixCount = 0;
        var ti;
        for (ti = 0; ti < tplData.length; ti++) {
            if (tplData[ti] === 1) tplPixCount++;
        }

        var noteheads = [];
        var MATCH_THRESHOLD = 0.35;

        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            var preambleWidth = (preambleWidths && preambleWidths[s]) ? preambleWidths[s] : Math.round(sp * 5);
            var scanLeft = staff.left + preambleWidth;
            var scanRight = staff.right - Math.round(sp * 0.5);
            var scanTop = staff.lines[0] - Math.round(sp * 4);
            var scanBottom = staff.lines[4] + Math.round(sp * 4);
            if (scanTop < 0) scanTop = 0;
            if (scanBottom >= height) scanBottom = height - 1;

            for (var sy = scanTop; sy <= scanBottom - th; sy++) {
                for (var sx = scanLeft; sx <= scanRight - tw; sx += 1) {
                    var cenIdx = (sy + Math.floor(th / 2)) * width + (sx + Math.floor(tw / 2));
                    if (bin[cenIdx] === 0) continue;

                    var matchSum = 0;
                    var totalWeight = 0;
                    for (var ty = 0; ty < th; ty++) {
                        for (var tx = 0; tx < tw; tx++) {
                            if (tplData[ty * tw + tx] === 1) {
                                var imgIdx = (sy + ty) * width + (sx + tx);
                                var distVal = dt[imgIdx];
                                var norm = distVal / 3.0;
                                var simil = 1.0 / (1.0 + norm * norm * 0.5);
                                matchSum += simil;
                                totalWeight++;
                            }
                        }
                    }

                    var score = totalWeight > 0 ? matchSum / totalWeight : 0;
                    if (score < MATCH_THRESHOLD) continue;

                    var headCx = sx + Math.floor(tw / 2);
                    var headCy = sy + Math.floor(th / 2);

                    var innerFilled = 0, innerTotal = 0;
                    var innerRx = Math.round(sp * 0.35);
                    var innerRy = Math.round(sp * 0.22);
                    for (var iy = -innerRy; iy <= innerRy; iy++) {
                        for (var ix = -innerRx; ix <= innerRx; ix++) {
                            var er = (ix * ix) / (innerRx * innerRx) + (iy * iy) / (innerRy * innerRy);
                            if (er <= 0.7) {
                                innerTotal++;
                                var pi = (headCy + iy) * width + (headCx + ix);
                                if (pi >= 0 && pi < width * height && bin[pi] === 1) {
                                    innerFilled++;
                                }
                            }
                        }
                    }
                    var fillRatio = innerTotal > 0 ? innerFilled / innerTotal : 0;
                    var isFilled = fillRatio > 0.55;

                    noteheads.push({
                        centerX: headCx,
                        centerY: headCy,
                        minX: sx,
                        maxX: sx + tw - 1,
                        minY: sy,
                        maxY: sy + th - 1,
                        width: tw,
                        height: th,
                        isFilled: isFilled,
                        fillRatio: fillRatio,
                        staffIndex: s,
                        matchScore: score
                    });

                    sx += Math.round(tw * 0.6);
                }
            }
        }

        noteheads.sort(function(a, b) { return b.matchScore - a.matchScore; });
        var keep = [];
        var suppressed = new Array(noteheads.length);
        for (var ni = 0; ni < suppressed.length; ni++) suppressed[ni] = false;

        var minDistSq = Math.round(sp * 0.6);
        minDistSq = minDistSq * minDistSq;

        for (var pi2 = 0; pi2 < noteheads.length; pi2++) {
            if (suppressed[pi2]) continue;
            keep.push(noteheads[pi2]);
            for (var qi = pi2 + 1; qi < noteheads.length; qi++) {
                if (suppressed[qi]) continue;
                var dxx = noteheads[pi2].centerX - noteheads[qi].centerX;
                var dyy = noteheads[pi2].centerY - noteheads[qi].centerY;
                if (dxx * dxx + dyy * dyy < minDistSq) {
                    suppressed[qi] = true;
                }
            }
        }

        return keep;
    },

    detectStems: function(bin, width, height, noteheads, staffSpacing) {
        var sp = staffSpacing;
        var minStemLen = Math.round(sp * 2.0);

        for (var n = 0; n < noteheads.length; n++) {
            var head = noteheads[n];
            head.hasStem = false;
            head.stemDir = 0;
            head.stemEndY = head.centerY;

            var sides = [
                { xStart: head.minX - 2, xEnd: head.minX + 2 },
                { xStart: head.maxX - 2, xEnd: head.maxX + 2 }
            ];

            var bestStemLen = 0;
            var bestDir = 0;
            var bestEndY = head.centerY;

            for (var si = 0; si < sides.length; si++) {
                var side = sides[si];
                for (var sx = side.xStart; sx <= side.xEnd; sx++) {
                    if (sx < 0 || sx >= width) continue;

                    var upLen = 0;
                    for (var uy = head.minY - 1; uy >= Math.max(0, head.minY - Math.round(sp * 4)); uy--) {
                        var colBlack = 0;
                        for (var cx = Math.max(0, sx - 1); cx <= Math.min(width - 1, sx + 1); cx++) {
                            if (bin[uy * width + cx] === 1) colBlack++;
                        }
                        if (colBlack >= 1) upLen++;
                        else break;
                    }

                    var downLen = 0;
                    for (var dy = head.maxY + 1; dy <= Math.min(height - 1, head.maxY + Math.round(sp * 4)); dy++) {
                        var colBlack2 = 0;
                        for (var cx2 = Math.max(0, sx - 1); cx2 <= Math.min(width - 1, sx + 1); cx2++) {
                            if (bin[dy * width + cx2] === 1) colBlack2++;
                        }
                        if (colBlack2 >= 1) downLen++;
                        else break;
                    }

                    if (upLen >= minStemLen && upLen > bestStemLen) {
                        bestStemLen = upLen;
                        bestDir = 1;
                        bestEndY = head.minY - upLen;
                    }
                    if (downLen >= minStemLen && downLen > bestStemLen) {
                        bestStemLen = downLen;
                        bestDir = -1;
                        bestEndY = head.maxY + downLen;
                    }
                }
            }

            if (bestStemLen >= minStemLen) {
                head.hasStem = true;
                head.stemDir = bestDir;
                head.stemEndY = bestEndY;
                head.stemLength = bestStemLen;
            }
        }
    },

    detectFlags: function(bin, width, height, noteheads, staffSpacing) {
        var sp = staffSpacing;
        var flagSearchW = Math.round(sp * 1.5);

        for (var n = 0; n < noteheads.length; n++) {
            var head = noteheads[n];
            head.flagCount = 0;
            if (!head.hasStem) continue;

            var flagTop, flagBot, flagLeft, flagRight;
            if (head.stemDir === 1) {
                flagTop = head.stemEndY - Math.round(sp * 0.3);
                flagBot = head.stemEndY + Math.round(sp * 1.5);
                flagLeft = head.maxX - 2;
                flagRight = head.maxX + flagSearchW;
            } else {
                flagTop = head.stemEndY - Math.round(sp * 1.5);
                flagBot = head.stemEndY + Math.round(sp * 0.3);
                flagLeft = head.maxX - 2;
                flagRight = head.maxX + flagSearchW;
            }

            if (flagTop < 0) flagTop = 0;
            if (flagBot >= height) flagBot = height - 1;
            if (flagLeft < 0) flagLeft = 0;
            if (flagRight >= width) flagRight = width - 1;

            var blackCount = 0;
            var regionSize = 0;

            for (var fy = flagTop; fy <= flagBot; fy++) {
                for (var fx = flagLeft + 3; fx <= flagRight; fx++) {
                    regionSize++;
                    if (bin[fy * width + fx] === 1) blackCount++;
                }
            }

            var density = regionSize > 0 ? blackCount / regionSize : 0;

            if (density > 0.08) {
                var bandCount = 0;
                var inBand = false;
                for (var fy2 = flagTop; fy2 <= flagBot; fy2++) {
                    var rowBlack = 0;
                    for (var fx2 = flagLeft + 3; fx2 <= flagRight; fx2++) {
                        if (bin[fy2 * width + fx2] === 1) rowBlack++;
                    }
                    var rowDensity = rowBlack / Math.max(1, flagRight - flagLeft - 3);
                    if (rowDensity > 0.15) {
                        if (!inBand) { bandCount++; inBand = true; }
                    } else {
                        inBand = false;
                    }
                }
                head.flagCount = Math.min(3, Math.max(0, bandCount));
            }
        }
    },

    detectBeams: function(bin, width, height, noteheads, staffSpacing) {
        var sp = staffSpacing;
        var beamHeight = Math.max(3, Math.round(sp * 0.45));

        var staffGroups = {};
        var n, head;
        for (n = 0; n < noteheads.length; n++) {
            head = noteheads[n];
            head.beamCount = head.beamCount || 0;
            if (!head.hasStem) continue;
            var key = head.staffIndex;
            if (!staffGroups[key]) staffGroups[key] = [];
            staffGroups[key].push(head);
        }

        for (var sKey in staffGroups) {
            if (!staffGroups.hasOwnProperty(sKey)) continue;
            var group = staffGroups[sKey];
            group.sort(function(a, b) { return a.centerX - b.centerX; });

            for (var i = 0; i < group.length - 1; i++) {
                var left = group[i];
                var right = group[i + 1];
                if (!left.hasStem || !right.hasStem) continue;
                if (left.stemDir !== right.stemDir) continue;

                var xDist = right.centerX - left.centerX;
                if (xDist < sp * 0.5 || xDist > sp * 3.5) continue;

                var stemY1 = left.stemEndY;
                var stemY2 = right.stemEndY;
                var beamLeft2 = left.centerX;
                var beamRight2 = right.centerX;

                var nBeams = 0;
                var scanTop = Math.min(stemY1, stemY2) - Math.round(sp * 0.8);
                var scanBot = Math.max(stemY1, stemY2) + Math.round(sp * 0.8);
                if (scanTop < 0) scanTop = 0;
                if (scanBot >= height) scanBot = height - 1;

                var inBeamBand = false;
                var bandThickness = 0;

                for (var by = scanTop; by <= scanBot; by++) {
                    var samplePoints = 5;
                    var blackSamples = 0;
                    for (var si2 = 0; si2 <= samplePoints; si2++) {
                        var sampleX = Math.round(beamLeft2 + (beamRight2 - beamLeft2) * si2 / samplePoints);
                        if (sampleX >= 0 && sampleX < width && bin[by * width + sampleX] === 1) {
                            blackSamples++;
                        }
                    }
                    var coverage = blackSamples / (samplePoints + 1);
                    if (coverage >= 0.6) {
                        if (!inBeamBand) { inBeamBand = true; bandThickness = 0; }
                        bandThickness++;
                    } else {
                        if (inBeamBand && bandThickness >= 2 && bandThickness <= beamHeight * 2) {
                            nBeams++;
                        }
                        inBeamBand = false;
                        bandThickness = 0;
                    }
                }
                if (inBeamBand && bandThickness >= 2 && bandThickness <= beamHeight * 2) {
                    nBeams++;
                }

                nBeams = Math.min(3, nBeams);
                if (nBeams > 0) {
                    if (nBeams > left.beamCount) left.beamCount = nBeams;
                    if (nBeams > right.beamCount) right.beamCount = nBeams;
                }
            }
        }
    },

    classifyDuration: function(noteheads) {
        for (var n = 0; n < noteheads.length; n++) {
            var head = noteheads[n];
            var beats = 4;
            var durationType = 'whole';

            if (!head.hasStem && !head.isFilled) {
                beats = 4; durationType = 'whole';
            } else if (head.hasStem && !head.isFilled) {
                beats = 2; durationType = 'half';
            } else if (head.hasStem && head.isFilled) {
                var divisions = 0;
                if (head.beamCount > 0) divisions = head.beamCount;
                else if (head.flagCount > 0) divisions = head.flagCount;

                if (divisions === 0) { beats = 1; durationType = 'quarter'; }
                else if (divisions === 1) { beats = 0.5; durationType = 'eighth'; }
                else if (divisions === 2) { beats = 0.25; durationType = '16th'; }
                else { beats = 0.125; durationType = '32nd'; }
            } else {
                beats = 1; durationType = 'quarter';
            }

            head.beats = beats;
            head.durationType = durationType;
        }
    },

    assignPitch: function(noteheads, staves) {
        var trebleDiatonic = [77, 76, 74, 72, 71, 69, 67, 65, 64, 62, 60, 59, 57, 55, 53, 52, 50, 48, 47, 45];
        var bassDiatonic = [57, 55, 53, 52, 50, 48, 47, 45, 43, 41, 40, 38, 36, 35, 33, 31, 29, 28, 26, 24];

        var trebleSteps = [
            {step:'F',oct:5},{step:'E',oct:5},{step:'D',oct:5},{step:'C',oct:5},
            {step:'B',oct:4},{step:'A',oct:4},{step:'G',oct:4},{step:'F',oct:4},
            {step:'E',oct:4},{step:'D',oct:4},{step:'C',oct:4},{step:'B',oct:3},
            {step:'A',oct:3},{step:'G',oct:3},{step:'F',oct:3},{step:'E',oct:3},
            {step:'D',oct:3},{step:'C',oct:3},{step:'B',oct:2},{step:'A',oct:2}
        ];
        var bassSteps = [
            {step:'A',oct:3},{step:'G',oct:3},{step:'F',oct:3},{step:'E',oct:3},
            {step:'D',oct:3},{step:'C',oct:3},{step:'B',oct:2},{step:'A',oct:2},
            {step:'G',oct:2},{step:'F',oct:2},{step:'E',oct:2},{step:'D',oct:2},
            {step:'C',oct:2},{step:'B',oct:1},{step:'A',oct:1},{step:'G',oct:1},
            {step:'F',oct:1},{step:'E',oct:1},{step:'D',oct:1},{step:'C',oct:1}
        ];

        for (var n = 0; n < noteheads.length; n++) {
            var head = noteheads[n];
            var staff = staves[head.staffIndex];
            if (!staff) continue;

            var halfSpacing = staff.spacing / 2;
            var posFromTop = (head.centerY - staff.lines[0]) / halfSpacing;
            var posIndex = Math.round(posFromTop);

            if (posIndex < -6) posIndex = -6;
            if (posIndex > 14) posIndex = 14;
            head.posIndex = posIndex;

            var diatonicArr = staff.clef === 'bass' ? bassDiatonic : trebleDiatonic;
            var stepsArr = staff.clef === 'bass' ? bassSteps : trebleSteps;

            var lookupIdx = posIndex + 2;
            if (lookupIdx < 0) lookupIdx = 0;
            if (lookupIdx >= diatonicArr.length) lookupIdx = diatonicArr.length - 1;

            head.midiNote = diatonicArr[lookupIdx];
            var stepInfo = stepsArr[lookupIdx] || {step: 'C', oct: 4};
            head.pitchName = stepInfo.step + stepInfo.oct;
            head.pitch = { step: stepInfo.step, octave: stepInfo.oct, alter: 0 };
        }
    },

    detectRests: function(bin, width, height, staves, staffSpacing, barlines) {
        var sp = staffSpacing;
        var rests = [];

        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            var staffBarlines = [];
            for (var b = 0; b < barlines.length; b++) {
                if (barlines[b].staffIndex === s) staffBarlines.push(barlines[b]);
            }
            staffBarlines.sort(function(a, b2) { return a.x - b2.x; });

            var measureBounds = [staff.left];
            for (b = 0; b < staffBarlines.length; b++) measureBounds.push(staffBarlines[b].x);
            measureBounds.push(staff.right);

            for (var m = 0; m < measureBounds.length - 1; m++) {
                var mLeft = measureBounds[m];
                var mRight = measureBounds[m + 1];

                var wholeRestY = staff.lines[3];
                var halfRestY = staff.lines[2];
                var blockW = Math.round(sp * 1.0);
                var blockH = Math.round(sp * 0.5);

                for (var rx = mLeft + Math.round(sp); rx < mRight - Math.round(sp * 0.5); rx++) {
                    var wholeBlack = 0, wholeRegion = 0;
                    for (var ry = wholeRestY; ry < wholeRestY + blockH && ry < height; ry++) {
                        for (var rdx = 0; rdx < blockW && rx + rdx < width; rdx++) {
                            wholeRegion++;
                            if (bin[ry * width + (rx + rdx)] === 1) wholeBlack++;
                        }
                    }
                    if (wholeRegion > 0 && wholeBlack / wholeRegion > 0.7 && wholeRegion > sp * sp * 0.3) {
                        rests.push({ type: 'whole', beats: 4, x: rx + Math.round(blockW / 2), y: wholeRestY + Math.round(blockH / 2), staffIndex: s, measureIndex: m, durationType: 'whole' });
                        rx += blockW + Math.round(sp);
                        continue;
                    }

                    var halfBlack = 0, halfRegion = 0;
                    for (var ry2 = halfRestY - blockH; ry2 <= halfRestY && ry2 >= 0; ry2++) {
                        for (var rdx2 = 0; rdx2 < blockW && rx + rdx2 < width; rdx2++) {
                            halfRegion++;
                            if (bin[ry2 * width + (rx + rdx2)] === 1) halfBlack++;
                        }
                    }
                    if (halfRegion > 0 && halfBlack / halfRegion > 0.7 && halfRegion > sp * sp * 0.3) {
                        rests.push({ type: 'half', beats: 2, x: rx + Math.round(blockW / 2), y: halfRestY - Math.round(blockH / 2), staffIndex: s, measureIndex: m, durationType: 'half' });
                        rx += blockW + Math.round(sp);
                        continue;
                    }
                }

                var quarterSearchLeft = mLeft + Math.round(sp * 1.5);
                var quarterSearchRight = mRight - Math.round(sp * 0.5);
                var staffH = staff.lines[4] - staff.lines[0];

                for (var qx = quarterSearchLeft; qx < quarterSearchRight; qx += Math.round(sp * 0.3)) {
                    var colTop = -1, colBot = -1, colBlack = 0;
                    for (var qy = staff.lines[0]; qy <= staff.lines[4]; qy++) {
                        var nearBlack = 0;
                        for (var qdx = -2; qdx <= 2; qdx++) {
                            if (qx + qdx >= 0 && qx + qdx < width && bin[qy * width + (qx + qdx)] === 1) nearBlack++;
                        }
                        if (nearBlack >= 2) {
                            if (colTop === -1) colTop = qy;
                            colBot = qy;
                            colBlack++;
                        }
                    }
                    if (colTop === -1) continue;
                    var colHeight = colBot - colTop;

                    if (colHeight > staffH * 0.55 && colHeight < staffH * 1.1) {
                        var restWidth = 0;
                        var midRow = Math.round((colTop + colBot) / 2);
                        for (var wdx = -Math.round(sp); wdx <= Math.round(sp); wdx++) {
                            if (qx + wdx >= 0 && qx + wdx < width && bin[midRow * width + (qx + wdx)] === 1) restWidth++;
                        }
                        if (restWidth < sp * 1.0 && restWidth > 2) {
                            rests.push({ type: 'quarter', beats: 1, x: qx, y: Math.round((colTop + colBot) / 2), staffIndex: s, measureIndex: m, durationType: 'quarter' });
                            qx += Math.round(sp * 1.5);
                        }
                    } else if (colHeight > staffH * 0.25 && colHeight <= staffH * 0.55) {
                        rests.push({ type: 'eighth', beats: 0.5, x: qx, y: Math.round((colTop + colBot) / 2), staffIndex: s, measureIndex: m, durationType: 'eighth' });
                        qx += Math.round(sp * 1.5);
                    }
                }
            }
        }
        return rests;
    },

    detectBarLines: function(bin, width, height, staves, staffSpacing) {
        var sp = staffSpacing;
        var barlines = [];

        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            var projTop = staff.lines[0] - 1;
            var projBot = staff.lines[4] + 1;
            if (projTop < 0) projTop = 0;
            if (projBot >= height) projBot = height - 1;
            var projH = projBot - projTop + 1;

            var vProj = new Uint32Array(width);
            for (var x = staff.left; x <= staff.right; x++) {
                var cnt = 0;
                for (var y = projTop; y <= projBot; y++) {
                    if (bin[y * width + x] === 1) cnt++;
                }
                vProj[x] = cnt;
            }

            var deriv = new Float32Array(width);
            for (x = staff.left + 1; x <= staff.right; x++) {
                deriv[x] = vProj[x] - vProj[x - 1];
            }

            var topDerivs = [];
            for (x = staff.left; x <= staff.right; x++) {
                var absD = Math.abs(deriv[x]);
                if (absD > 0) {
                    if (topDerivs.length < 20) {
                        topDerivs.push(absD);
                        topDerivs.sort(function(a, b2) { return b2 - a; });
                    } else if (absD > topDerivs[topDerivs.length - 1]) {
                        topDerivs[topDerivs.length - 1] = absD;
                        topDerivs.sort(function(a, b2) { return b2 - a; });
                    }
                }
            }

            var top5Sum = 0;
            var top5Count = Math.min(5, topDerivs.length);
            for (var ti = 0; ti < top5Count; ti++) top5Sum += topDerivs[ti];
            var derivThreshold = top5Count > 0 ? (top5Sum / top5Count) * 0.3 : projH * 0.2;

            var peaks = [];
            var peakStart = -1;
            var minProjHeight = projH * 0.65;

            for (x = staff.left + Math.round(sp * 3); x <= staff.right - Math.round(sp * 0.5); x++) {
                if (deriv[x] > derivThreshold && peakStart === -1) {
                    peakStart = x;
                }
                if (peakStart !== -1 && (deriv[x] < -derivThreshold || x === staff.right - 1)) {
                    var peakEnd = x;
                    var peakWidth = peakEnd - peakStart;

                    if (peakWidth < sp * 1.5 && peakWidth > 0) {
                        var maxProj = 0, maxX = peakStart;
                        for (var px = peakStart; px <= Math.min(peakEnd, staff.right); px++) {
                            if (vProj[px] > maxProj) { maxProj = vProj[px]; maxX = px; }
                        }

                        if (maxProj >= minProjHeight) {
                            var vertTop = -1, vertBot = -1;
                            for (y = projTop; y <= projBot; y++) {
                                if (bin[y * width + maxX] === 1) {
                                    if (vertTop === -1) vertTop = y;
                                    vertBot = y;
                                }
                            }
                            var vertSpan = (vertTop !== -1) ? vertBot - vertTop : 0;
                            var staffHeight = staff.lines[4] - staff.lines[0];

                            if (vertSpan >= staffHeight * 0.75) {
                                var tooClose = false;
                                for (var bi = peaks.length - 1; bi >= 0 && bi >= peaks.length - 2; bi--) {
                                    if (Math.abs(maxX - peaks[bi].x) < sp * 1.5) { tooClose = true; break; }
                                }
                                if (!tooClose) {
                                    peaks.push({ x: maxX, projection: maxProj, width: peakWidth, vertSpan: vertSpan });
                                }
                            }
                        }
                    }
                    peakStart = -1;
                }
                if (deriv[x] <= 0) peakStart = -1;
            }

            for (var pi = 0; pi < peaks.length; pi++) {
                barlines.push({ x: peaks[pi].x, staffIndex: s, top: projTop, bottom: projBot, type: 'single' });
            }
        }

        barlines.sort(function(a, b2) { return a.x - b2.x; });
        return barlines;
    },

    _detectKeySignature: function(bin, width, height, staff, staffSpacing) {
        var sp = staffSpacing;
        var regionLeft = staff.left + Math.round(sp * 2.5);
        var regionRight = staff.left + Math.round(sp * 5.5);
        if (regionRight > staff.right) regionRight = staff.right;
        var regionTop = staff.lines[0] - Math.round(sp * 0.5);
        var regionBot = staff.lines[4] + Math.round(sp * 0.5);
        if (regionTop < 0) regionTop = 0;
        if (regionBot >= height) regionBot = height - 1;

        var xProj = [];
        for (var x = regionLeft; x <= regionRight; x++) {
            var cnt = 0;
            for (var y = regionTop; y <= regionBot; y++) {
                if (bin[y * width + x] === 1) cnt++;
            }
            xProj.push({ x: x, count: cnt });
        }

        var threshold = sp * 0.5;
        var clusters = [];
        var inCluster = false;
        var clusterStart = 0;
        var clusterPixels = 0;

        for (var i = 0; i < xProj.length; i++) {
            if (xProj[i].count > threshold) {
                if (!inCluster) { inCluster = true; clusterStart = i; clusterPixels = 0; }
                clusterPixels += xProj[i].count;
            } else {
                if (inCluster) {
                    var clusterWidth = i - clusterStart;
                    if (clusterWidth >= 2 && clusterWidth <= sp * 1.5) {
                        clusters.push({ start: clusterStart + regionLeft, end: i - 1 + regionLeft, width: clusterWidth, pixels: clusterPixels });
                    }
                    inCluster = false;
                }
            }
        }
        if (inCluster) {
            var cw = xProj.length - clusterStart;
            if (cw >= 2 && cw <= sp * 1.5) {
                clusters.push({ start: clusterStart + regionLeft, end: xProj.length - 1 + regionLeft, width: cw, pixels: clusterPixels });
            }
        }

        if (clusters.length === 0) {
            return { fifths: 0, mode: 'major', accidentalCount: 0, type: 'none', preambleEnd: regionLeft };
        }

        var avgClusterWidth = 0;
        for (i = 0; i < clusters.length; i++) avgClusterWidth += clusters[i].width;
        avgClusterWidth = avgClusterWidth / clusters.length;

        var isSharp = avgClusterWidth > sp * 0.6;
        var accidentalCount = Math.min(7, clusters.length);
        var fifths = isSharp ? accidentalCount : -accidentalCount;
        var preambleEnd = clusters[clusters.length - 1].end + Math.round(sp * 0.5);

        return { fifths: fifths, mode: 'major', accidentalCount: accidentalCount, type: isSharp ? 'sharp' : 'flat', preambleEnd: preambleEnd };
    },

    _detectTimeSignature: function(bin, width, height, staff, staffSpacing, keySigEnd) {
        var sp = staffSpacing;
        var regionLeft = keySigEnd + Math.round(sp * 0.3);
        var regionRight = keySigEnd + Math.round(sp * 3.0);
        if (regionRight > staff.right) regionRight = Math.min(staff.right, keySigEnd + Math.round(sp * 2.0));
        var regionTop = staff.lines[0];
        var regionBot = staff.lines[4];

        var totalInk = 0, regionArea = 0;
        for (var y = regionTop; y <= regionBot; y++) {
            for (var x = regionLeft; x <= regionRight; x++) {
                regionArea++;
                if (x >= 0 && x < width && bin[y * width + x] === 1) totalInk++;
            }
        }

        var density = regionArea > 0 ? totalInk / regionArea : 0;
        if (density < 0.08) {
            return { beats: 4, beatType: 4, preambleEnd: regionLeft };
        }

        var midLine = staff.lines[2];
        var quarterY = staff.lines[0] + Math.round(sp * 1.0);
        var threeQuarterY = staff.lines[2] + Math.round(sp * 1.0);

        var topCrossings = this._countHCrossings(bin, width, quarterY, regionLeft, regionRight);
        var botCrossings = this._countHCrossings(bin, width, threeQuarterY, regionLeft, regionRight);

        var topInk = 0, botInk = 0, topArea = 0, botArea = 0;
        for (y = regionTop; y < midLine; y++) {
            for (x = regionLeft; x <= regionRight; x++) {
                topArea++;
                if (x >= 0 && x < width && bin[y * width + x] === 1) topInk++;
            }
        }
        for (y = midLine; y <= regionBot; y++) {
            for (x = regionLeft; x <= regionRight; x++) {
                botArea++;
                if (x >= 0 && x < width && bin[y * width + x] === 1) botInk++;
            }
        }

        var topDensity = topArea > 0 ? topInk / topArea : 0;
        var botDensity = botArea > 0 ? botInk / botArea : 0;

        var beats = 4, beatType = 4;
        if (topCrossings <= 2 && topDensity < 0.2) beats = 2;
        else if (topCrossings >= 4 || topDensity > 0.35) beats = 6;
        else if (topCrossings >= 3) beats = 4;
        else beats = 3;

        if (botCrossings >= 4 || botDensity > 0.35) beatType = 8;
        else beatType = 4;

        var lastInkX = regionLeft;
        for (x = regionRight; x >= regionLeft; x--) {
            var hasInk = false;
            for (y = regionTop; y <= regionBot; y++) {
                if (bin[y * width + x] === 1) { hasInk = true; break; }
            }
            if (hasInk) { lastInkX = x; break; }
        }

        return { beats: beats, beatType: beatType, preambleEnd: lastInkX + Math.round(sp * 0.5) };
    },

    _countHCrossings: function(bin, width, y, left, right) {
        if (y < 0 || y >= bin.length / width) return 0;
        var crossings = 0, wasBlack = false;
        for (var x = left; x <= right; x++) {
            if (x < 0 || x >= width) continue;
            var isBlack = bin[y * width + x] === 1;
            if (isBlack && !wasBlack) crossings++;
            wasBlack = isBlack;
        }
        return crossings;
    },

    organizeNotes: function(noteheads, rests, barlines, staves, timeSig) {
        var measures = [];
        var beatsPerMeasure = timeSig ? timeSig.beats : 4;
        var beatType = timeSig ? timeSig.beatType : 4;

        for (var s = 0; s < staves.length; s++) {
            var staff = staves[s];
            var sp = staff.spacing;

            var staffBarlines = [];
            for (var b = 0; b < barlines.length; b++) {
                if (barlines[b].staffIndex === s) staffBarlines.push(barlines[b]);
            }
            staffBarlines.sort(function(a, b2) { return a.x - b2.x; });

            var boundaries = [staff.left];
            for (b = 0; b < staffBarlines.length; b++) boundaries.push(staffBarlines[b].x);
            boundaries.push(staff.right);

            var staffNotes = [];
            for (var n = 0; n < noteheads.length; n++) {
                if (noteheads[n].staffIndex === s) staffNotes.push(noteheads[n]);
            }

            var staffRests = [];
            for (var r = 0; r < rests.length; r++) {
                if (rests[r].staffIndex === s) staffRests.push(rests[r]);
            }

            for (var m = 0; m < boundaries.length - 1; m++) {
                var mLeft = boundaries[m];
                var mRight = boundaries[m + 1];
                var events = [];

                for (n = 0; n < staffNotes.length; n++) {
                    var note = staffNotes[n];
                    if (note.centerX >= mLeft && note.centerX < mRight) {
                        events.push({
                            type: 'note', x: note.centerX, y: note.centerY,
                            beats: note.beats || 1, durationType: note.durationType || 'quarter',
                            midiNote: note.midiNote, pitch: note.pitch, pitchName: note.pitchName,
                            staffIndex: s, isFilled: note.isFilled, hasStem: note.hasStem,
                            posIndex: note.posIndex, head: note
                        });
                    }
                }

                for (r = 0; r < staffRests.length; r++) {
                    var rest = staffRests[r];
                    if (rest.x >= mLeft && rest.x < mRight) {
                        events.push({
                            type: 'rest', x: rest.x, y: rest.y,
                            beats: rest.beats || 1, durationType: rest.durationType || 'quarter',
                            staffIndex: s
                        });
                    }
                }

                events.sort(function(a, b2) { return a.x - b2.x; });

                var chordGroups = [];
                var ci = 0;
                while (ci < events.length) {
                    var chord = [events[ci]];
                    var cj = ci + 1;
                    while (cj < events.length && events[cj].type === 'note' && events[ci].type === 'note' &&
                           Math.abs(events[cj].x - events[ci].x) < sp * 0.6) {
                        chord.push(events[cj]);
                        cj++;
                    }
                    chordGroups.push(chord);
                    ci = cj;
                }

                var totalBeats = 0;
                for (var cg = 0; cg < chordGroups.length; cg++) {
                    totalBeats += chordGroups[cg][0].beats;
                }

                var timeOffset = 0;
                for (cg = 0; cg < chordGroups.length; cg++) {
                    var chordBeats = chordGroups[cg][0].beats;
                    if (totalBeats > 0 && Math.abs(totalBeats - beatsPerMeasure) > 0.5) {
                        chordBeats = chordBeats * (beatsPerMeasure / totalBeats);
                    }
                    for (var ce = 0; ce < chordGroups[cg].length; ce++) {
                        chordGroups[cg][ce].timeOffset = timeOffset;
                        chordGroups[cg][ce].adjustedBeats = chordBeats;
                    }
                    timeOffset += chordBeats;
                }

                measures.push({
                    staffIndex: s, measureNumber: m + 1,
                    left: mLeft, right: mRight,
                    events: events, chordGroups: chordGroups,
                    beatsPerMeasure: beatsPerMeasure, beatType: beatType
                });
            }
        }
        return measures;
    },

    detect: function(bin, cleanBin, dt, width, height, staves, staffSpacing) {
        if (!staves || staves.length === 0) {
            return { noteHeads: [], events: [], rests: [], barLines: [], keySignature: { fifths: 0, mode: 'major' }, timeSignature: { beats: 4, beatType: 4 }, measures: [] };
        }

        var keySigs = [];
        var preambleWidths = [];
        for (var s = 0; s < staves.length; s++) {
            var keySig = this._detectKeySignature(bin, width, height, staves[s], staffSpacing);
            keySigs.push(keySig);
            var timeSig = this._detectTimeSignature(bin, width, height, staves[s], staffSpacing, keySig.preambleEnd);
            staves[s]._timeSig = timeSig;
            staves[s]._keySig = keySig;
            preambleWidths.push(timeSig.preambleEnd - staves[s].left);
        }

        var globalKeySig = keySigs.length > 0 ? keySigs[0] : { fifths: 0, mode: 'major' };
        var globalTimeSig = staves[0]._timeSig || { beats: 4, beatType: 4 };

        var barlines = this.detectBarLines(bin, width, height, staves, staffSpacing);
        var noteheads = this.scanForNoteheads(cleanBin, dt, width, height, staves, staffSpacing, preambleWidths);
        this.detectStems(bin, width, height, noteheads, staffSpacing);
        this.detectFlags(bin, width, height, noteheads, staffSpacing);
        this.detectBeams(bin, width, height, noteheads, staffSpacing);
        this.classifyDuration(noteheads);
        this.assignPitch(noteheads, staves);
        var rests = this.detectRests(cleanBin, width, height, staves, staffSpacing, barlines);
        var measures = this.organizeNotes(noteheads, rests, barlines, staves, globalTimeSig);

        var events = [];
        for (var mi = 0; mi < measures.length; mi++) {
            for (var ei = 0; ei < measures[mi].events.length; ei++) {
                events.push(measures[mi].events[ei]);
            }
        }

        console.log('[NoteDetector] Detected ' + noteheads.length + ' noteheads, ' + rests.length + ' rests, ' + barlines.length + ' barlines, ' + measures.length + ' measures');

        return { noteHeads: noteheads, events: events, rests: rests, barLines: barlines, keySignature: globalKeySig, timeSignature: globalTimeSig, measures: measures };
    }
};


/* =========================================================================
 *  MODULE 4: MusicXMLWriter
 * ========================================================================= */
OMR.MusicXMLWriter = {

    generate: function(result, systems, title) {
        var measures = result.measures || [];
        var keySig = result.keySignature || { fifths: 0, mode: 'major' };
        var timeSig = result.timeSignature || { beats: 4, beatType: 4 };
        var DIVISIONS = 16;
        var isGrandStaff = systems && systems.length > 0 && systems[0].isGrandStaff;
        var numStaves = isGrandStaff ? 2 : 1;
        title = title || 'Untitled Score';

        var xml = '';
        xml += '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n';
        xml += '<score-partwise version="3.1">\n';
        xml += '  <work>\n';
        xml += '    <work-title>' + this._escapeXml(title) + '</work-title>\n';
        xml += '  </work>\n';
        xml += '  <identification>\n';
        xml += '    <creator type="software">PianoMode OMR Engine ' + VERSION + '</creator>\n';
        xml += '    <encoding>\n';
        xml += '      <software>PianoMode OMR</software>\n';
        xml += '      <encoding-date>' + new Date().toISOString().substring(0, 10) + '</encoding-date>\n';
        xml += '    </encoding>\n';
        xml += '  </identification>\n';
        xml += '  <part-list>\n';
        xml += '    <score-part id="P1">\n';
        xml += '      <part-name>Piano</part-name>\n';
        xml += '    </score-part>\n';
        xml += '  </part-list>\n';
        xml += '  <part id="P1">\n';

        var measuresByNumber = {};
        for (var mi = 0; mi < measures.length; mi++) {
            var mNum = measures[mi].measureNumber;
            if (!measuresByNumber[mNum]) measuresByNumber[mNum] = [];
            measuresByNumber[mNum].push(measures[mi]);
        }

        var measureNumbers = [];
        for (var key in measuresByNumber) {
            if (measuresByNumber.hasOwnProperty(key)) measureNumbers.push(parseInt(key, 10));
        }
        measureNumbers.sort(function(a, b) { return a - b; });
        if (measureNumbers.length === 0) {
            measureNumbers = [1];
            measuresByNumber[1] = [];
        }

        for (var mni = 0; mni < measureNumbers.length; mni++) {
            var measNum = measureNumbers[mni];
            var measGroup = measuresByNumber[measNum] || [];

            xml += '    <measure number="' + measNum + '">\n';

            if (mni === 0) {
                xml += '      <attributes>\n';
                xml += '        <divisions>' + DIVISIONS + '</divisions>\n';
                xml += '        <key>\n';
                xml += '          <fifths>' + keySig.fifths + '</fifths>\n';
                xml += '          <mode>' + (keySig.mode || 'major') + '</mode>\n';
                xml += '        </key>\n';
                xml += '        <time>\n';
                xml += '          <beats>' + timeSig.beats + '</beats>\n';
                xml += '          <beat-type>' + timeSig.beatType + '</beat-type>\n';
                xml += '        </time>\n';
                if (numStaves > 1) xml += '        <staves>' + numStaves + '</staves>\n';
                xml += '        <clef' + (numStaves > 1 ? ' number="1"' : '') + '>\n';
                xml += '          <sign>G</sign>\n';
                xml += '          <line>2</line>\n';
                xml += '        </clef>\n';
                if (numStaves > 1) {
                    xml += '        <clef number="2">\n';
                    xml += '          <sign>F</sign>\n';
                    xml += '          <line>4</line>\n';
                    xml += '        </clef>\n';
                }
                xml += '      </attributes>\n';
            }

            var staff1Events = [];
            var staff2Events = [];
            for (var mg = 0; mg < measGroup.length; mg++) {
                var meas = measGroup[mg];
                for (var ev = 0; ev < meas.chordGroups.length; ev++) {
                    if (meas.staffIndex % 2 === 0) staff1Events.push(meas.chordGroups[ev]);
                    else staff2Events.push(meas.chordGroups[ev]);
                }
            }

            xml += this._writeVoiceEvents(staff1Events, 1, 1, DIVISIONS, timeSig);

            if (numStaves > 1 && staff2Events.length > 0) {
                var measureDuration = this._getMeasureDuration(timeSig, DIVISIONS);
                xml += '      <backup>\n';
                xml += '        <duration>' + measureDuration + '</duration>\n';
                xml += '      </backup>\n';
                xml += this._writeVoiceEvents(staff2Events, 2, 2, DIVISIONS, timeSig);
            }

            if (mni === measureNumbers.length - 1) {
                xml += '      <barline location="right">\n';
                xml += '        <bar-style>light-heavy</bar-style>\n';
                xml += '      </barline>\n';
            }

            xml += '    </measure>\n';
        }

        xml += '  </part>\n';
        xml += '</score-partwise>\n';
        return xml;
    },

    _writeVoiceEvents: function(chordGroups, staffNum, voiceNum, divisions, timeSig) {
        var xml = '';
        var currentTime = 0;
        var measureDuration = this._getMeasureDuration(timeSig, divisions);

        if (chordGroups.length === 0) {
            xml += '      <note>\n';
            xml += '        <rest measure="yes"/>\n';
            xml += '        <duration>' + measureDuration + '</duration>\n';
            xml += '        <voice>' + voiceNum + '</voice>\n';
            xml += '        <type>whole</type>\n';
            if (staffNum > 0) xml += '        <staff>' + staffNum + '</staff>\n';
            xml += '      </note>\n';
            return xml;
        }

        for (var cg = 0; cg < chordGroups.length; cg++) {
            var chord = chordGroups[cg];
            var eventBeats = chord[0].adjustedBeats || chord[0].beats || 1;
            var eventDuration = this._beatsToDuration(eventBeats, divisions);
            var durType = chord[0].durationType || 'quarter';

            var eventTime = chord[0].timeOffset || currentTime;
            if (eventTime > currentTime + 0.01) {
                var forwardDur = this._beatsToDuration(eventTime - currentTime, divisions);
                if (forwardDur > 0) {
                    xml += '      <forward>\n';
                    xml += '        <duration>' + forwardDur + '</duration>\n';
                    xml += '      </forward>\n';
                }
            }

            for (var ci = 0; ci < chord.length; ci++) {
                var evt = chord[ci];
                xml += '      <note>\n';
                if (ci > 0 && evt.type === 'note') xml += '        <chord/>\n';

                if (evt.type === 'rest') {
                    xml += '        <rest/>\n';
                } else if (evt.type === 'note' && evt.pitch) {
                    xml += '        <pitch>\n';
                    xml += '          <step>' + evt.pitch.step + '</step>\n';
                    if (evt.pitch.alter && evt.pitch.alter !== 0) xml += '          <alter>' + evt.pitch.alter + '</alter>\n';
                    xml += '          <octave>' + evt.pitch.octave + '</octave>\n';
                    xml += '        </pitch>\n';
                } else {
                    xml += '        <rest/>\n';
                }

                xml += '        <duration>' + eventDuration + '</duration>\n';
                xml += '        <voice>' + voiceNum + '</voice>\n';
                xml += '        <type>' + durType + '</type>\n';
                if (staffNum > 0) xml += '        <staff>' + staffNum + '</staff>\n';
                xml += '      </note>\n';
            }
            currentTime = eventTime + eventBeats;
        }

        if (currentTime < timeSig.beats - 0.01) {
            var remainingBeats = timeSig.beats - currentTime;
            var remainDur = this._beatsToDuration(remainingBeats, divisions);
            var remainType = this._beatsToType(remainingBeats);
            if (remainDur > 0) {
                xml += '      <note>\n';
                xml += '        <rest/>\n';
                xml += '        <duration>' + remainDur + '</duration>\n';
                xml += '        <voice>' + voiceNum + '</voice>\n';
                xml += '        <type>' + remainType + '</type>\n';
                if (staffNum > 0) xml += '        <staff>' + staffNum + '</staff>\n';
                xml += '      </note>\n';
            }
        }

        return xml;
    },

    _getMeasureDuration: function(timeSig, divisions) {
        return Math.round(timeSig.beats * divisions * (4 / timeSig.beatType));
    },

    _beatsToDuration: function(beats, divisions) {
        return Math.max(1, Math.round(beats * divisions));
    },

    _beatsToType: function(beats) {
        if (beats >= 3.5) return 'whole';
        if (beats >= 1.5) return 'half';
        if (beats >= 0.75) return 'quarter';
        if (beats >= 0.375) return 'eighth';
        if (beats >= 0.1875) return '16th';
        return '32nd';
    },

    _escapeXml: function(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    }
};


/* =========================================================================
 *  MODULE 5: MIDIWriter
 * ========================================================================= */
OMR.MIDIWriter = {

    generate: function(result) {
        var measures = result.measures || [];
        var timeSig = result.timeSignature || { beats: 4, beatType: 4 };
        var TICKS_PER_BEAT = 480;

        var midiEvents = [];
        var sortedMeasures = measures.slice().sort(function(a, b) {
            if (a.measureNumber !== b.measureNumber) return a.measureNumber - b.measureNumber;
            return a.staffIndex - b.staffIndex;
        });

        var lastMeasureNum = 0;
        for (var mi = 0; mi < sortedMeasures.length; mi++) {
            var meas = sortedMeasures[mi];
            if (meas.measureNumber !== lastMeasureNum) lastMeasureNum = meas.measureNumber;
            var measureStartTick = (meas.measureNumber - 1) * timeSig.beats * TICKS_PER_BEAT;

            for (var cg = 0; cg < meas.chordGroups.length; cg++) {
                var chord = meas.chordGroups[cg];
                var eventBeats = chord[0].adjustedBeats || chord[0].beats || 1;
                var eventOffset = chord[0].timeOffset || 0;
                var startTick = measureStartTick + Math.round(eventOffset * TICKS_PER_BEAT);
                var durationTicks = Math.round(eventBeats * TICKS_PER_BEAT);

                for (var ci = 0; ci < chord.length; ci++) {
                    var evt = chord[ci];
                    if (evt.type !== 'note' || !evt.midiNote) continue;
                    var noteNum = evt.midiNote;
                    if (noteNum < 0) noteNum = 0;
                    if (noteNum > 127) noteNum = 127;

                    midiEvents.push({ tick: startTick, type: 'noteOn', channel: 0, note: noteNum, velocity: 80 });
                    midiEvents.push({ tick: startTick + durationTicks - 1, type: 'noteOff', channel: 0, note: noteNum, velocity: 0 });
                }
            }
        }

        midiEvents.sort(function(a, b) {
            if (a.tick !== b.tick) return a.tick - b.tick;
            if (a.type === 'noteOff' && b.type === 'noteOn') return -1;
            if (a.type === 'noteOn' && b.type === 'noteOff') return 1;
            return a.note - b.note;
        });

        var bytes = [];
        this._writeStr(bytes, 'MThd');
        this._writeU32(bytes, 6);
        this._writeU16(bytes, 0);
        this._writeU16(bytes, 1);
        this._writeU16(bytes, TICKS_PER_BEAT);

        var trackBytes = [];

        this._writeVLQ(trackBytes, 0);
        trackBytes.push(0xFF, 0x51, 0x03);
        var tempo = 500000;
        trackBytes.push((tempo >> 16) & 0xFF);
        trackBytes.push((tempo >> 8) & 0xFF);
        trackBytes.push(tempo & 0xFF);

        this._writeVLQ(trackBytes, 0);
        trackBytes.push(0xFF, 0x58, 0x04);
        trackBytes.push(timeSig.beats & 0xFF);
        var denomLog = 0, denom = timeSig.beatType;
        while (denom > 1) { denom = denom >> 1; denomLog++; }
        trackBytes.push(denomLog);
        trackBytes.push(24);
        trackBytes.push(8);

        this._writeVLQ(trackBytes, 0);
        trackBytes.push(0xC0, 0x00);

        var lastTick = 0;
        for (var ei = 0; ei < midiEvents.length; ei++) {
            var mEvt = midiEvents[ei];
            var delta = mEvt.tick - lastTick;
            if (delta < 0) delta = 0;
            this._writeVLQ(trackBytes, delta);

            if (mEvt.type === 'noteOn') {
                trackBytes.push(0x90 | (mEvt.channel & 0x0F));
                trackBytes.push(mEvt.note & 0x7F);
                trackBytes.push(mEvt.velocity & 0x7F);
            } else {
                trackBytes.push(0x80 | (mEvt.channel & 0x0F));
                trackBytes.push(mEvt.note & 0x7F);
                trackBytes.push(0);
            }
            lastTick = mEvt.tick;
        }

        this._writeVLQ(trackBytes, 0);
        trackBytes.push(0xFF, 0x2F, 0x00);

        this._writeStr(bytes, 'MTrk');
        this._writeU32(bytes, trackBytes.length);
        for (var tb = 0; tb < trackBytes.length; tb++) bytes.push(trackBytes[tb]);

        return new Uint8Array(bytes);
    },

    _writeStr: function(arr, str) {
        for (var i = 0; i < str.length; i++) arr.push(str.charCodeAt(i));
    },

    _writeU32: function(arr, val) {
        arr.push((val >> 24) & 0xFF);
        arr.push((val >> 16) & 0xFF);
        arr.push((val >> 8) & 0xFF);
        arr.push(val & 0xFF);
    },

    _writeU16: function(arr, val) {
        arr.push((val >> 8) & 0xFF);
        arr.push(val & 0xFF);
    },

    _writeVLQ: function(arr, val) {
        if (val < 0) val = 0;
        var vlqBytes = [];
        vlqBytes.push(val & 0x7F);
        val = val >> 7;
        while (val > 0) {
            vlqBytes.push((val & 0x7F) | 0x80);
            val = val >> 7;
        }
        for (var i = vlqBytes.length - 1; i >= 0; i--) arr.push(vlqBytes[i]);
    },

    toBlob: function(midiData) {
        return new Blob([midiData], { type: 'audio/midi' });
    },

    toBlobURL: function(midiData) {
        return URL.createObjectURL(this.toBlob(midiData));
    }
};


/* =========================================================================
 *  MODULE 6: Engine
 * ========================================================================= */
OMR.Engine = {

    process: function(file, onProgress) {
        var self = this;
        var report = onProgress || function() {};

        return new Promise(function(resolve, reject) {
            var fileName = file.name || 'Untitled';
            var title = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');

            report(0, 'Loading file...');

            var loadPromise;
            if (file.type === 'application/pdf' || (fileName && fileName.toLowerCase().indexOf('.pdf') !== -1)) {
                loadPromise = OMR.ImageProcessor.loadPDF(file);
            } else {
                loadPromise = OMR.ImageProcessor.loadImage(file);
            }

            loadPromise.then(function(imgResult) {
                report(10, 'Processing image...');
                return self._yieldThen(function() {
                    var gray = OMR.ImageProcessor.toGrayscale(imgResult.imageData);
                    report(15, 'Binarizing...');
                    return { gray: gray, w: imgResult.width, h: imgResult.height };
                });
            }).then(function(ctx) {
                return self._yieldThen(function() {
                    var threshold = OMR.ImageProcessor.otsuThreshold(ctx.gray);
                    var bin = OMR.ImageProcessor.binarize(ctx.gray, threshold);
                    report(20, 'Cleaning noise...');
                    return { bin: bin, w: ctx.w, h: ctx.h };
                });
            }).then(function(ctx) {
                return self._yieldThen(function() {
                    OMR.ImageProcessor.cleanNoise(ctx.bin, ctx.w, ctx.h, 6);
                    report(25, 'Detecting staves...');
                    return ctx;
                });
            }).then(function(ctx) {
                return self._yieldThen(function() {
                    var staffResult = OMR.StaffDetector.detect(ctx.bin, ctx.w, ctx.h);
                    report(35, 'Found ' + staffResult.staves.length + ' staves. Removing staff lines...');
                    ctx.staves = staffResult.staves;
                    ctx.staffSpacing = staffResult.staffSpacing;
                    ctx.systems = staffResult.systems;
                    return ctx;
                });
            }).then(function(ctx) {
                return self._yieldThen(function() {
                    var cleanBin = OMR.StaffDetector.removeStaffLines(ctx.bin, ctx.w, ctx.h, ctx.staves);
                    report(45, 'Computing distance transform...');
                    ctx.cleanBin = cleanBin;
                    return ctx;
                });
            }).then(function(ctx) {
                return self._yieldThen(function() {
                    var dt = OMR.NoteDetector.computeDistanceTransform(ctx.cleanBin, ctx.w, ctx.h);
                    report(55, 'Detecting notes and symbols...');
                    ctx.dt = dt;
                    return ctx;
                });
            }).then(function(ctx) {
                return self._yieldThen(function() {
                    var detection = OMR.NoteDetector.detect(ctx.bin, ctx.cleanBin, ctx.dt, ctx.w, ctx.h, ctx.staves, ctx.staffSpacing);
                    report(75, 'Generating MusicXML...');
                    ctx.detection = detection;
                    return ctx;
                });
            }).then(function(ctx) {
                return self._yieldThen(function() {
                    ctx.detection._staves = ctx.staves;
                    var musicxml = OMR.MusicXMLWriter.generate(ctx.detection, ctx.systems, title);
                    var musicxmlBlob = new Blob([musicxml], { type: 'application/xml' });
                    var musicxmlUrl = URL.createObjectURL(musicxmlBlob);
                    report(85, 'Generating MIDI...');
                    ctx.musicxml = musicxml;
                    ctx.musicxmlBlob = musicxmlBlob;
                    ctx.musicxmlUrl = musicxmlUrl;
                    return ctx;
                });
            }).then(function(ctx) {
                return self._yieldThen(function() {
                    var midiData = OMR.MIDIWriter.generate(ctx.detection);
                    var midiBlob = OMR.MIDIWriter.toBlob(midiData);
                    var midiUrl = OMR.MIDIWriter.toBlobURL(midiData);
                    report(95, 'Finalizing...');
                    ctx.midiData = midiData;
                    ctx.midiBlob = midiBlob;
                    ctx.midiUrl = midiUrl;
                    return ctx;
                });
            }).then(function(ctx) {
                report(100, 'Complete!');
                var noteCount = ctx.detection.noteHeads ? ctx.detection.noteHeads.length : 0;

                resolve({
                    musicxml: ctx.musicxml,
                    musicxmlBlob: ctx.musicxmlBlob,
                    musicxmlUrl: ctx.musicxmlUrl,
                    midiData: ctx.midiData,
                    midiBlob: ctx.midiBlob,
                    midiUrl: ctx.midiUrl,
                    events: ctx.detection.events,
                    noteHeads: ctx.detection.noteHeads,
                    staves: ctx.staves,
                    noteCount: noteCount,
                    title: title,
                    barLines: ctx.detection.barLines,
                    rests: ctx.detection.rests,
                    keySignature: ctx.detection.keySignature,
                    timeSignature: ctx.detection.timeSignature,
                    measures: ctx.detection.measures,
                    systems: ctx.systems,
                    version: VERSION
                });
            }).catch(function(err) {
                console.error('[PianoModeOMR] Processing error:', err);
                reject(err);
            });
        });
    },

    _yieldThen: function(fn) {
        return new Promise(function(resolve, reject) {
            setTimeout(function() {
                try {
                    resolve(fn());
                } catch (e) {
                    reject(e);
                }
            }, 4);
        });
    }
};

console.log('[PianoModeOMR] Engine ' + VERSION + ' loaded \u2014 all modules ready');

})();
