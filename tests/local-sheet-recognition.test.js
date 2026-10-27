const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { recognize } = require('../local-sheet-recognition.js');

function score({ gap = 10, height = 420, staves = [[2, 5, 7, 9, 8, 7, 6, 4, 2, 0, -2]], styles = [], transparent = false, stemGray = 0 } = {}) {
    const width = gap * 65;
    const data = new Uint8ClampedArray(width * height * 4).fill(transparent ? 0 : 255);
    const pixel = (x, y, value = 0) => {
        x = Math.round(x); y = Math.round(y);
        if (x < 0 || x >= width || y < 0 || y >= height) return;
        const p = (y * width + x) * 4;
        data[p] = data[p + 1] = data[p + 2] = value;
        data[p + 3] = 255;
    };
    const rect = (x, y, w, h, value = 0) => {
        for (let py = Math.round(y); py < y + h; py++)
            for (let px = Math.round(x); px < x + w; px++) pixel(px, py, value);
    };
    staves.forEach((steps, row) => {
        const bottom = gap * (12 + row * 13);
        for (let line = 0; line < 5; line++) rect(gap * 2, bottom - line * gap, gap * 60, Math.max(1, gap * 0.08));
        // Lyrics and title blocks outside the staff must not become notes.
        for (let x = gap * 8; x < gap * 60; x += gap * 3) rect(x, bottom + gap * 5, gap, gap * 0.6);
        steps.forEach((step, i) => {
            const x = gap * (8 + i * 4.7), y = bottom - step * gap / 2;
            const style = styles[i] || 'quarter';
            const hollow = style === 'half' || style === 'whole';
            for (let dy = -gap; dy <= gap; dy++) {
                for (let dx = -gap; dx <= gap; dx++) {
                    const whole = style === 'whole';
                    const r = (dx / (gap * (whole ? 0.74 : 0.6))) ** 2 + ((dy + dx * (whole ? 0 : 0.25)) / (gap * (whole ? 0.42 : 0.38))) ** 2;
                    if (r <= 1 && (!hollow || r >= (whole ? 0.5 : 0.42))) pixel(x + dx, y + dy);
                }
            }
            for (let ledger = -2; ledger >= step; ledger -= 2) rect(x - gap * 0.9, bottom - ledger * gap / 2, gap * 1.8, 1);
            for (let ledger = 10; ledger <= step; ledger += 2) rect(x - gap * 0.9, bottom - ledger * gap / 2, gap * 1.8, 1);
            if (style === 'whole') return;
            const direction = step >= 4 ? 1 : -1;
            const sx = x - direction * gap * 0.5;
            rect(sx, direction > 0 ? y : y - gap * 3.2, Math.max(1, gap * 0.1), gap * 3.2, stemGray);
            if (style === 'eighth') rect(sx, y + direction * gap * 3, gap * 2, gap * 0.3);
            if (style === 'flagged') {
                for (let d = 0; d <= gap * 1.7; d++) {
                    const dx = Math.sin(d / (gap * 1.7) * Math.PI) * gap * 0.8;
                    rect(sx + dx, y + direction * (gap * 3.2 - d), gap * 0.25, 1);
                }
            }
        });
    });
    return { width, height, data };
}

for (const gap of [8, 10, 16]) {
    test(`staff-relative pitch and ledger notes at ${gap}px spacing`, () => {
        const result = recognize(score({ gap, height: gap * 30 }));
        assert.equal(result.staves.length, 1);
        assert.deepEqual(result.notes.map(n => n.midi), [67, 72, 76, 79, 77, 76, 74, 71, 67, 64, 60]);
        assert.ok(result.notes.every(n => n.duration === 1));
    });
}

test('page height does not affect pitch; repeated notes and multiple staves exceed 16 notes', () => {
    const staves = [Array(11).fill(5), Array(11).fill(7)];
    const short = recognize(score({ staves }));
    const tall = recognize(score({ staves, height: 900 }));
    assert.equal(short.notes.length, 22);
    assert.deepEqual(short.tokens, [...Array(11).fill("1'"), ...Array(11).fill("3'")]);
    assert.deepEqual(tall.tokens, short.tokens);
});

test('transparent paper and faint antialiased stems retain pitch', () => {
    const normal = recognize(score());
    const faint = recognize(score({ transparent: true, stemGray: 230 }));
    assert.deepEqual(faint.tokens, normal.tokens);
});

test('quarter, half, whole, beamed and flagged eighth durations', () => {
    const result = recognize(score({ staves: [[5, 5, 5, 5, 5]], styles: ['quarter', 'half', 'whole', 'eighth', 'flagged'] }));
    assert.deepEqual(result.tokens, ["1'", "1'-", "1'--", "1'/2", "1'/2"]);
});

test('empty images, empty staves and text do not fabricate melodies', () => {
    const image = score({ staves: [[]] });
    assert.deepEqual(recognize(image).tokens, []);
    image.data.fill(255);
    assert.deepEqual(recognize(image).notes, []);
    image.data.fill(0);
    assert.deepEqual(recognize(image).notes, []);
});

test('out-of-range notes are reported, never clamped to a different pitch', () => {
    const result = recognize(score({ staves: [[10]] }));
    assert.equal(result.notes.length, 1);
    assert.equal(result.notes[0].midi, 81);
    assert.equal(result.unsupported, 1);
    assert.deepEqual(result.tokens, []);
});

test('rejects malformed input', () => {
    assert.throws(() => recognize({ width: 10, height: 10, data: [] }), /Invalid RGBA/);
});

// Optional local-only fixture: the user's 768x1085 grayscale sample decoded to RGBA.
// No uploaded image, lyrics or full transcription is stored in this repository.
test('supplied score: six staves and 76 ordered notes, including flags and final whole note', {
    skip: !process.env.LOCAL_SHEET_SAMPLE_RGBA
}, () => {
    const result = recognize({ width: 768, height: 1085, data: fs.readFileSync(process.env.LOCAL_SHEET_SAMPLE_RGBA) });
    assert.deepEqual(result.staves.map(s => s.notes.length), [12, 9, 16, 13, 19, 7]);
    assert.equal(result.unsupported, 0);
    assert.equal(result.notes.at(-1).duration, 4);
    assert.equal(Math.max(...result.notes.map(n => n.midi)), 79);
    const digest = createHash('sha256').update(result.tokens.join(' ')).digest('hex');
    assert.equal(digest, '8bb2cd84f69f8f6d185f0a1d88d467e512b30f45796df1629b34ddbb51ec179e');
});
