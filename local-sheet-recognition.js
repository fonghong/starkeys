/* Local, dependency-free recognition of printed, single-voice treble staves. */
(function (root) {
    'use strict';

    function recognize(image) {
        const { width: w, height: h, data } = image;
        if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || data.length !== w * h * 4) {
            throw new Error('Invalid RGBA image');
        }
        const gray = new Uint8Array(w * h);
        const histogram = new Uint32Array(256);
        for (let i = 0; i < gray.length; i++) {
            const a = data[i * 4 + 3] / 255;
            const v = Math.round((data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) * a + 255 * (1 - a));
            gray[i] = v;
            histogram[v]++;
        }
        let sum = 0;
        for (let i = 0; i < 256; i++) sum += i * histogram[i];
        let count = 0, partial = 0, best = 0, threshold = 160;
        for (let i = 0; i < 255; i++) {
            count += histogram[i];
            partial += i * histogram[i];
            if (!count || count === gray.length) continue;
            const difference = partial / count - (sum - partial) / (gray.length - count);
            const variance = count * (gray.length - count) * difference * difference;
            if (variance > best) { best = variance; threshold = i; }
        }
        // Thin antialiased staff lines can be considerably lighter than the noteheads.
        threshold = Math.min(225, Math.max(210, threshold));
        const ink = new Uint8Array(w * h);
        const rows = new Uint32Array(h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (gray[y * w + x] <= threshold) { ink[y * w + x] = 1; rows[y]++; }
            }
        }
        const at = (x, y, faint = false) => {
            x = Math.round(x); y = Math.round(y);
            if (x < 0 || x >= w || y < 0 || y >= h) return 0;
            return faint ? Number(gray[y * w + x] < 245) : ink[y * w + x];
        };
        const bands = [];
        for (let y = 0; y < h; y++) {
            if (rows[y] < w * 0.3) continue;
            let weighted = 0, weight = 0;
            const start = y;
            while (y < h && rows[y] >= w * 0.3) {
                weighted += y * rows[y]; weight += rows[y]; y++;
            }
            bands.push({ y: weighted / weight, thickness: y - start });
        }
        const staves = [];
        for (let i = 0; i <= bands.length - 5; i++) {
            const lines = bands.slice(i, i + 5);
            const gap = (lines[4].y - lines[0].y) / 4;
            if (gap < 4 || lines.some((line, j) => Math.abs(line.y - lines[0].y - j * gap) > gap * 0.18 || line.thickness > gap * 0.4)) continue;
            let left = w, right = 0;
            for (let x = 0; x < w; x++) {
                if (lines.filter(line => at(x, line.y)).length >= 4) {
                    left = Math.min(left, x); right = x;
                }
            }
            if (right - left < w * 0.3) continue;
            staves.push({ lines, gap, left, right, notes: [] });
            i += 4;
        }

        for (const staff of staves) {
            const { gap: g, lines, left, right } = staff;
            const bottom = lines[4].y;
            const onLine = y => lines.some(line => Math.abs(y - line.y) <= line.thickness / 2 + 0.25);
            const stemAt = (x, y) => {
                let result = null;
                for (const direction of [-1, 1]) {
                    for (let sx = Math.round(x - g * 0.8); sx <= x + g * 0.8; sx++) {
                        if (Math.abs(sx - x) < g * 0.3 || (sx - x) * direction > 0) continue;
                        let hits = 0, total = 0, thick = 0;
                        for (let d = Math.ceil(g * 0.7); d <= g * 2.8; d++) {
                            const py = y + direction * d;
                            if (onLine(Math.round(py))) continue;
                            total++; hits += at(sx, py, true);
                            thick += at(sx - g * 0.3, py, true) + at(sx + g * 0.3, py, true);
                        }
                        if (total && hits / total >= 0.88 && thick / total < 0.45 && (!result || hits > result.hits)) result = { x: sx, direction, hits };
                    }
                }
                return result;
            };
            const candidates = [];
            for (let step = -4; step <= 12; step++) {
                const nominalY = bottom - step * g / 2;
                for (let x = Math.ceil(left + g * 3.8); x < right - g; x++) {
                    for (const offset of [-0.15, 0, 0.15]) {
                        const y = nominalY + offset * g;
                        let core = 0, coreN = 0, rim = 0, rimN = 0, outside = 0, outsideN = 0;
                        for (let dy = -Math.ceil(g * 0.7); dy <= g * 0.7; dy++) {
                            const py = Math.round(y) + dy;
                            if (onLine(py)) continue;
                            for (let dx = -Math.ceil(g); dx <= g; dx++) {
                                const ex = dx / (g * 0.62), ey = (py - y + dx * 0.28) / (g * 0.4);
                                const r = ex * ex + ey * ey;
                                const pixel = at(x + dx, py);
                                if (r < 0.55) { core += pixel; coreN++; }
                                else if (r < 1.2) { rim += pixel; rimN++; }
                                else if (r > 1.7 && r < 3.2) { outside += pixel; outsideN++; }
                            }
                        }
                        if (!coreN || !rimN || !outsideN) continue;
                        const fill = core / coreN, edge = rim / rimN, noise = outside / outsideN;
                        const filled = fill >= 0.75 && edge >= 0.3 && noise < 0.36;
                        const hollow = fill < 0.5 && edge >= 0.5 && noise < 0.3;
                        if (!filled && !hollow) continue;
                        let extended = 0, tested = 0;
                        for (let py = Math.ceil(y - g * 0.4); py <= y + g * 0.4; py++) {
                            if (onLine(py)) continue;
                            tested++;
                            if (at(x - g, py) || at(x + g, py)) extended++;
                        }
                        if (!tested || extended / tested > 0.25) continue;
                        const stem = stemAt(x, y);
                        if (filled && !stem) continue;
                        // Rests can resemble an open head, but lack both a stem and a complete rim.
                        if (hollow && !stem && edge < 0.65) continue;
                        candidates.push({ x, y, step, hollow, stem, score: (filled ? fill : edge) + edge * 0.35 - noise });
                    }
                }
            }
            candidates.sort((a, b) => b.score - a.score);
            for (const note of candidates) {
                // A single voice has one head per onset; flags at the other end of a stem are not notes.
                if (staff.notes.some(n => Math.abs(n.x - note.x) < g * 1.4)) continue;
                staff.notes.push(note);
            }
            staff.notes.sort((a, b) => a.x - b.x);
            for (const note of staff.notes) {
                const degree = note.step + 2; // E4 is step 0; C4 is degree 0.
                const octave = 4 + Math.floor(degree / 7);
                const index = ((degree % 7) + 7) % 7;
                note.midi = 12 * (octave + 1) + [0, 2, 4, 5, 7, 9, 11][index];
                note.duration = note.hollow ? (note.stem ? 2 : 4) : 1;
                if (!note.hollow && note.stem) {
                    const { x: sx, direction } = note.stem;
                    let flagInk = 0, flagArea = 0;
                    for (let d = Math.ceil(g * 1.2); d < g * 3.5; d++) {
                        const py = note.y + direction * d;
                        if (onLine(Math.round(py))) continue;
                        for (let dx = Math.ceil(g * 0.4); dx <= g * 1.4; dx++) {
                            flagArea++; flagInk += at(sx + dx, py);
                        }
                    }
                    if (flagArea && flagInk / flagArea > 0.12) note.duration = 0.5;
                    for (let d = Math.round(g * 1.8); d < g * 3.8; d++) {
                        if (onLine(Math.round(note.y + direction * d))) continue;
                        for (const side of [-1, 1]) {
                            let hits = 0, total = 0;
                            for (let dx = Math.ceil(g * 0.5); dx <= g * 1.5; dx++) {
                                total++; hits += at(sx + side * dx, note.y + direction * d);
                            }
                            if (total && hits / total > 0.85) note.duration = 0.5;
                        }
                    }
                }
                const pitch = String(index + 1) + (octave === 3 ? '.' : octave === 5 ? "'" : '');
                note.token = note.midi >= 48 && note.midi <= 79
                    ? pitch + ({ 0.5: '/2', 1: '', 2: '-', 4: '--' }[note.duration]) : null;
            }
        }
        const notes = staves.flatMap(staff => staff.notes);
        return { staves, notes, tokens: notes.filter(note => note.token).map(note => note.token), unsupported: notes.filter(note => !note.token).length };
    }

    const api = { recognize };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.LocalSheetRecognition = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
