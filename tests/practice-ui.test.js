const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function source(name) {
    const match = html.match(new RegExp(`^        function ${name}\\([^]*?^        }`, 'm'));
    assert.ok(match, `Missing function ${name}`);
    return match[0];
}

function harness(notes = [{ hand: 'R', midi: 60 }]) {
    const transforms = [];
    const draws = [];
    const labels = [];
    const strokes = [];
    let currentPath = [];
    const ctx = new Proxy({
        beginPath: () => { currentPath = []; },
        moveTo: (x, y) => currentPath.push(['moveTo', x, y]),
        lineTo: (x, y) => currentPath.push(['lineTo', x, y]),
        stroke: () => strokes.push({ path: [...currentPath], color: ctx.strokeStyle, alpha: ctx.globalAlpha, width: ctx.lineWidth }),
        setTransform: (...args) => transforms.push(args),
        createLinearGradient: () => ({ addColorStop() {} }),
        arc: (...args) => draws.push({ alpha: ctx.globalAlpha, args }),
        fillText: (...args) => labels.push({ text: args[0], x: args[1], align: ctx.textAlign })
    }, { get: (target, key) => key in target ? target[key] : () => {} });
    const viewport = { clientWidth: 760, clientHeight: 260, scrollTop: 0 };
    const canvas = {
        style: {}, width: 0, height: 0,
        getBoundingClientRect: () => ({ width: viewport.clientWidth, height: parseFloat(canvas.style.height) || 0 })
    };
    const elements = { sheetViewport: viewport, sheetZoom: {}, sheetZoomValue: {} };
    const context = vm.createContext({
        canvas, ctx, window: { devicePixelRatio: 2 },
        document: { getElementById: id => elements[id] },
        state: { currentSongKey: 'song', transposeSemitones: 0, currentNoteIndex: 0, smoothScrollIndex: 0, noteStates: [], theme: 'dark' },
        SONGS: { song: { notes } }, DIATONIC_STEP_FROM_C4: { 60: 0, 48: -7, 72: 7 },
        MIDI_MAP: { 60: { jianpu: '1', note: 'C4' } },
        requestAnimationFrame() {}
    });
    vm.runInContext(`
        let sheetZoom = 1, sheetLayout = null, sheetLayoutNotes = null,
            sheetLayoutTranspose = null, sheetFollowIndex = null;
        function getTransposedMidi(midi) { return midi + state.transposeSemitones; }
        ${['buildSheetLayout', 'getSheetFollowScroll', 'resizeSheetCanvas', 'setSheetZoom', 'renderSheetMusicLoop'].map(source).join('\n')}
    `, context);
    return { context, viewport, canvas, elements, transforms, draws, labels, strokes, run: code => vm.runInContext(code, context) };
}

test('barlines stay opaque and bright in dark theme without changing light theme or geometry', () => {
    for (const hands of [['R'], ['L'], ['R', 'L']]) {
        const h = harness(Array.from({ length: 5 }, (_, i) => ({ hand: hands[i % hands.length], midi: 60 })));
        for (const theme of ['dark', 'light', 'dark']) {
            h.context.state.theme = theme;
            h.strokes.length = 0;
            h.context.renderSheetMusicLoop();
            const barX = h.viewport.clientWidth * 0.20 + 3.5 * 92;
            const barlines = h.strokes.filter(stroke => stroke.path.length === 2 && stroke.path[0][1] === barX);
            assert.equal(barlines.length, 1);
            assert.deepEqual(barlines[0], {
                path: [['moveTo', barX, h.run('sheetLayout.staves.R.top')], ['lineTo', barX, h.run('sheetLayout.staves.L.bottom')]],
                color: theme === 'dark' ? '#cbd5e1' : 'rgba(100,116,139,0.35)',
                alpha: 1,
                width: 1.5
            });
        }
    }
});

test('single-hand scores compress and fade only the unused staff; mixed scores retain both', () => {
    const { context } = harness();
    for (const hand of ['R', 'L']) {
        const layout = context.buildSheetLayout([{ hand, step: 0 }]);
        const other = hand === 'R' ? 'L' : 'R';
        assert.equal(layout.staves[hand].spacing, 11);
        assert.equal(layout.staves[hand].opacity, 1);
        assert.equal(layout.staves[other].spacing, 6);
        assert.equal(layout.staves[other].opacity, 0.3);
    }
    const mixed = context.buildSheetLayout([{ hand: 'R', step: 0 }, { hand: 'L', step: -7 }]);
    assert.equal(mixed.staves.R.opacity, 1);
    assert.equal(mixed.staves.L.opacity, 1);
    const empty = context.buildSheetLayout([]);
    assert.equal(empty.positions.length, 0);
    assert.ok(Number.isFinite(empty.height));
});

test('custom ledger-range notes and fingers fit without crossing staff blocks', () => {
    const { context } = harness();
    const notes = ['R', 'L'].flatMap(hand => [-14, -7, 0, 7, 14].map(step => ({ hand, step })));
    const layout = context.buildSheetLayout(notes);
    layout.positions.forEach((pos, index) => {
        const staff = layout.staves[notes[index].hand];
        assert.ok(pos.fingerY - 8 >= 0);
        assert.ok(pos.fingerY + 8 < staff.top);
        assert.ok(pos.fingerY + 8 < pos.y - 26, 'finger clears stem');
        assert.ok(pos.textY > pos.y + 8);
        assert.ok(pos.textY + 22 < layout.height);
        if (notes[index].hand === 'R') assert.ok(pos.textY + 22 < layout.staves.L.top);
    });
});

test('zoom clamps 100–200%, scales backing store with DPR and never changes viewport width/height', () => {
    const h = harness();
    h.context.setSheetZoom(200);
    const contentHeight = parseFloat(h.canvas.style.height);
    assert.equal(h.run('sheetZoom'), 2);
    assert.equal(h.canvas.width, 1520);
    assert.equal(h.canvas.height, contentHeight * 2);
    assert.ok(contentHeight > h.viewport.clientHeight);
    assert.deepEqual(h.transforms.at(-1), [4, 0, 0, 4, 0, 0]);
    assert.equal(h.viewport.clientWidth, 760);
    assert.equal(h.viewport.clientHeight, 260);
    assert.equal(h.elements.sheetZoomValue.textContent, '200%');
    for (const [input, expected] of [[500, 200], [-50, 100], ['oops', 100], [145, 150]]) {
        h.context.setSheetZoom(input);
        assert.equal(h.elements.sheetZoom.value, String(expected));
    }
    h.viewport.clientWidth = 500;
    h.viewport.clientHeight = 400;
    h.context.resizeSheetCanvas();
    assert.equal(h.canvas.width, 1000);
});

test('current note and lyric appear to the right of the blue playhead', () => {
    const h = harness([{ hand: 'R', midi: 60, lyric: 'Do', finger: 1 }, { hand: 'R', midi: 60, lyric: 'Do', finger: 2 }]);
    h.context.renderSheetMusicLoop();
    const playheadX = Math.max(95, h.viewport.clientWidth * 0.20);
    const current = h.labels.filter(label => label.text === 'C4' || label.text === 'Do').slice(0, 2);
    assert.equal(current.length, 2);
    assert.ok(current.every(label => label.x === playheadX + 3 && label.align === 'left'));
    const next = h.labels.filter(label => label.text === 'C4' || label.text === 'Do').slice(2);
    assert.ok(next.every(label => label.align === 'center'));
});

test('grand staff stays vertically centered when it fits and retains scrollable zoom layout', () => {
    const h = harness([{ hand: 'R', midi: 60 }, { hand: 'L', midi: 48 }]);
    const original = h.context.buildSheetLayout([{ hand: 'R', step: 0 }, { hand: 'L', step: -7 }]);
    h.viewport.clientHeight = 600;
    h.context.resizeSheetCanvas();
    const offset = (600 - original.height) / 2;
    assert.equal(h.run('sheetLayout.staves.R.top'), original.staves.R.top + offset);
    assert.equal(h.run('sheetLayout.staves.L.bottom'), original.staves.L.bottom + offset);
    assert.equal(h.run('sheetLayout.positions[0].y'), original.positions[0].y + offset);
    assert.equal(h.canvas.style.height, '600px');
    h.context.renderSheetMusicLoop();
    assert.equal(h.viewport.scrollTop, 0);

    h.viewport.clientHeight = 200;
    h.context.setSheetZoom(200);
    assert.equal(h.run('sheetLayout.staves.R.top'), original.staves.R.top);
    assert.ok(parseFloat(h.canvas.style.height) > h.viewport.clientHeight);
});

test('following is bounded, keeps current finger/note visible and preserves manual scrolling between notes', () => {
    const h = harness([{ hand: 'R', midi: 60 }, { hand: 'L', midi: 48 }]);
    h.context.setSheetZoom(200);
    h.context.renderSheetMusicLoop();
    h.viewport.scrollTop = 100;
    h.context.renderSheetMusicLoop();
    assert.equal(h.viewport.scrollTop, 100, 'same note must not undo manual scrolling');
    h.context.state.currentNoteIndex = 1;
    h.context.renderSheetMusicLoop();
    const pos = h.run('sheetLayout.positions[1]');
    assert.ok(h.viewport.scrollTop <= (pos.fingerY - 8) * 2);
    assert.ok(h.viewport.scrollTop + h.viewport.clientHeight >= (pos.y + 8) * 2);
    assert.ok(h.viewport.scrollTop >= 0);
    assert.ok(h.viewport.scrollTop <= parseFloat(h.canvas.style.height) - h.viewport.clientHeight);
    assert.ok(h.draws.every(draw => draw.alpha === 1), 'fingering remains fully opaque');
    const oldY = pos.y;
    h.context.state.transposeSemitones = 12;
    h.context.renderSheetMusicLoop();
    assert.notEqual(h.run('sheetLayout.positions[1].y'), oldY);
    h.context.SONGS.song.notes = [{ hand: 'R', midi: 72 }];
    h.context.renderSheetMusicLoop();
    assert.equal(h.run('sheetLayout.staves.L.opacity'), 0.3);
});

test('follow clamps extreme positions and handles a viewport taller than the score', () => {
    const { context } = harness();
    const follow = context.getSheetFollowScroll;
    assert.equal(follow({ fingerY: -20, y: 0, textY: 20 }, 2, 200, 500, 0), 0);
    assert.equal(follow({ fingerY: 450, y: 500, textY: 520 }, 2, 200, 500, 0), 300);
    assert.equal(follow({ fingerY: 30, y: 60, textY: 80 }, 1, 900, 200, 0), 0);
});

test('missing songs do not resize on every frame and long songs have bounded layout calculation', () => {
    const h = harness();
    h.context.state.currentSongKey = 'missing';
    h.context.renderSheetMusicLoop();
    const count = h.transforms.length;
    h.context.renderSheetMusicLoop();
    assert.equal(h.transforms.length, count);
    const layout = h.context.buildSheetLayout(Array.from({ length: 150000 }, () => ({ hand: 'R', step: 0 })));
    assert.equal(layout.positions.length, 150000);
    assert.ok(Number.isFinite(layout.height));
});

test('secondary actions use bounded glass styling without restyling primary controls or piano keys', () => {
    const controls = [...html.matchAll(/<button\b[^>]*class="[^"]*\bsecondary-control\b[^>]*>/g)];
    assert.deepEqual(controls.map(([tag]) => tag.match(/id="([^"]+)"/)[1]).sort(),
        ['demoPlayBtn', 'fullscreenToggleBtn', 'resetSongBtn', 'themeToggleBtn']);
    const style = html.match(/\.theme-surface\.secondary-control \{([^]*?)\n        \}/)[1];
    assert.match(style, /background-color: var\(--control-fill\) !important/);
    assert.match(style, /border: 1px solid var\(--control-border\) !important/);
    assert.match(style, /min-width: 44px/);
    assert.match(style, /min-height: 44px/);
    assert.match(html, /html\.light \.theme-surface\.secondary-control \{/);
    assert.match(html, /@media \(hover: hover\) \{\s*\.theme-surface\.secondary-control:hover/);
    assert.match(html, /\.theme-surface\.secondary-control:active \{\s*background-color: var\(--control-pressed\) !important/);
    assert.match(html, /@media \(prefers-reduced-motion: reduce\) \{\s*\.theme-surface\.secondary-control \{ transition: none; \}/);
    assert.match(html, /button:focus-visible[^}]*outline: 3px solid #f59e0b/);
});

test('controls preserve audio checkbox state, accessible zoom and separate functional groups', () => {
    for (const id of ['sustainPedalToggle', 'playSynthToggle']) {
        assert.match(html, new RegExp(`<input type="checkbox" role="switch" id="${id}" aria-label="[^"]+" checked>`));
    }
    assert.match(html, /min-height: 44px/);
    const shortcuts = html.match(/<nav aria-label="學習捷徑"[^]*?<\/nav>/)?.[0];
    assert.ok(shortcuts);
    assert.match(shortcuts, /id="openCustomSongModalBtn"/);
    assert.match(shortcuts, /id="openChordDojoBtn"/);
    assert.doesNotMatch(shortcuts, /<details/);
    const settings = html.match(/<details class="control-menu"[^]*?<\/details>/)?.[0];
    assert.ok(settings);
    assert.match(settings, /<summary class="theme-surface">練習設定/);
    assert.doesNotMatch(settings, /id="(?:themeToggleBtn|fullscreenToggleBtn)"/);
    const topActions = html.match(/role="group" aria-label="即時操作與顯示"[^]*?<\/div>/)?.[0];
    assert.ok(topActions);
    for (const id of ['toggleMicBtn', 'themeToggleBtn', 'fullscreenToggleBtn']) assert.match(topActions, new RegExp(`id="${id}"`));
    const sheetToolbar = html.match(/<div class="sheet-toolbar">[^]*?<div id="sheetViewport"/)?.[0];
    assert.ok(sheetToolbar);
    assert.match(sheetToolbar, /id="demoPlayBtn"/);
    assert.match(sheetToolbar, /id="resetSongBtn"[^]*?<span>重置<\/span>/);
    assert.match(html, /id="sheetZoom" type="range" min="100" max="200" step="10"/);
    assert.match(html, /id="sheetViewport" tabindex="0" role="region"/);
    assert.match(html, /#sheetViewport #sheetCanvas \{ touch-action: pan-y !important;/);
    const ids = [...html.matchAll(/\bid="([\w-]+)"/g)].map(match => match[1]);
    for (const id of ['sheetZoom', 'sheetViewport', 'sustainPedalToggle', 'playSynthToggle', 'openMicSetupBtn', 'openCustomSongModalBtn', 'openChordDojoBtn', 'themeToggleBtn', 'fullscreenToggleBtn', 'demoPlayBtn', 'resetSongBtn']) {
        assert.equal(ids.filter(value => value === id).length, 1);
    }
});
