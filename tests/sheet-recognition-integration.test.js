const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(match => !/\bsrc=/.test(match[1])).map(match => match[2]).join('\n');
const functionSource = name => {
    const match = script.match(new RegExp(`^        (?:async )?function ${name}\\([^]*?^        }`, 'm'));
    assert.ok(match, `Missing function ${name}`);
    return match[0];
};

function recognized(...rows) {
    const staves = rows.map(tokens => ({
        left: 20, right: 600, gap: 10,
        lines: Array.from({ length: 5 }, (_, i) => ({ y: 50 + i * 10 })),
        notes: tokens.map((token, i) => ({ token, x: 100 + i * 40, y: 70 }))
    }));
    const notes = staves.flatMap(staff => staff.notes);
    return { staves, notes, tokens: notes.map(note => note.token), unsupported: 0 };
}

function harness(results = [], { onYield } = {}) {
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
    const elements = new Map();
    const createdCanvases = [];
    const makeElement = tag => {
        const classes = new Set();
        const context = {
            fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fillText() {},
            drawImage(image) { this.image = image; },
            getImageData() { return { image: this.image }; }
        };
        return {
            tag, value: '', textContent: '', disabled: false, children: [], width: 0, height: 0,
            classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
            append(child) { this.children.push(child); }, appendChild(child) { this.append(child); },
            replaceChildren() { this.children = []; }, querySelectorAll() { return []; },
            getContext: () => context
        };
    };
    const element = id => {
        assert.ok(ids.has(id), `Unknown DOM ID: ${id}`);
        if (!elements.has(id)) elements.set(id, makeElement(id));
        return elements.get(id);
    };
    let calls = 0;
    const state = {
        transposeSemitones: 0,
        uploadedSheetPages: results.map((_, i) => ({
            imgElement: { naturalWidth: 768 + i, naturalHeight: 1085 },
            width: 480, height: 678, dataUrl: 'data:image/jpeg;base64,TEST'
        }))
    };
    const context = vm.createContext({
        state,
        document: {
            getElementById: element,
            createElement(tag) {
                const node = makeElement(tag);
                if (tag === 'canvas') createdCanvases.push(node);
                return node;
            }
        },
        setTimeout(callback) { queueMicrotask(() => { onYield?.(state); callback(); }); },
        fetch: () => { throw new Error('Local recognition must not call fetch'); },
        stopCustomSongPreview() {},
        LocalSheetRecognition: {
            recognize() {
                const result = results[calls++];
                if (result instanceof Error) throw result;
                return result;
            }
        }
    });
    const maps = script.slice(script.indexOf('        const PIANO_KEYS ='), script.indexOf('        const FINGER_NAMES ='));
    const local = script.slice(script.indexOf('        let localSheetResults ='), script.indexOf('        // Mic 收音'));
    vm.runInContext([maps, functionSource('parseJianpuString'), functionSource('getTransposedMidi'),
        functionSource('renderUploadedSheetPagesUI'), local].join('\n'), context);
    element('customSongNotesInput').value = 'old notes';
    element('customSongTitleInput').value = 'old title';
    return { context, state, element, createdCanvases, calls: () => calls };
}

const plain = value => JSON.parse(JSON.stringify(value));

test('all inline JavaScript compiles and local module loads before app code', () => {
    assert.doesNotThrow(() => new vm.Script(script));
    assert.ok(html.indexOf('src="local-sheet-recognition.js"') < html.indexOf('const PIANO_KEYS'));
});

test('parser preserves existing hands/fingers and supports G5 and whole-note playback durations', () => {
    const { context, state } = harness();
    const notes = plain(context.parseJianpuString("L1.:4 R5-:2 3/2 1'-- 4' #4' 5'"));
    assert.deepEqual(notes.map(n => n.midi), [48, 67, 64, 72, 77, 78, 79]);
    assert.deepEqual(notes.map(n => n.dur), [1, 2, 0.5, 4, 1, 1, 1]);
    assert.equal(notes[0].hand, 'L');
    assert.equal(notes[0].finger, 4);
    assert.equal(notes[1].finger, 2);
    assert.equal(context.getTransposedMidi(79), 79);
    state.transposeSemitones = 12;
    assert.equal(context.getTransposedMidi(76), 79);
    state.transposeSemitones = -12;
    assert.equal(context.getTransposedMidi(48), 48);
    assert.deepEqual(plain(vm.runInContext('[77, 78, 79].map(m => [MIDI_MAP[m].midi, DIATONIC_STEP_FROM_C4[m]])', context)), [[77, 10], [78, 10], [79, 11]]);
});

test('inline lyrics and four rest durations preserve token alignment and hand overrides', () => {
    const { context } = harness();
    const notes = plain(context.parseJianpuString('R1:1(小) R2:2(綿) R3-:3(羊) 0 0- L0-- 0/2 1'));
    assert.deepEqual(notes.slice(0, 3).map(({ midi, dur, finger, lyric }) => ({ midi, dur, finger, lyric })), [
        { midi: 60, dur: 1, finger: 1, lyric: '小' },
        { midi: 62, dur: 1, finger: 2, lyric: '綿' },
        { midi: 64, dur: 2, finger: 3, lyric: '羊' }
    ]);
    assert.deepEqual(notes.slice(3, 7).map(({ isRest, midi, dur, hand, finger }) => ({ isRest, midi, dur, hand, finger })), [
        { isRest: true, midi: null, dur: 1, hand: 'R', finger: null },
        { isRest: true, midi: null, dur: 2, hand: 'R', finger: null },
        { isRest: true, midi: null, dur: 4, hand: 'L', finger: null },
        { isRest: true, midi: null, dur: 0.5, hand: 'R', finger: null }
    ]);
    assert.equal(notes[7].lyric, vm.runInContext('MIDI_MAP[60].solfege', context));
});

test('local multi-page import keeps staff order, original resolution, debug pages and existing title', async () => {
    const h = harness([recognized(['1', '2'], ["5'--"]), recognized(['3/2'])]);
    const run = h.context.runLocalLogicSheetRecognition();
    assert.ok(h.element('runLocalLogicOcrBtn').disabled);
    await h.context.runLocalLogicSheetRecognition();
    await run;
    assert.equal(h.calls(), 2);
    assert.equal(h.element('customSongNotesInput').value, "1 2\n5'--\n3/2");
    assert.equal(h.element('customSongTitleInput').value, 'old title');
    assert.deepEqual(h.createdCanvases.map(c => c.width), [768, 769]);
    assert.equal(h.element('localOcrPageSelect').children.length, 2);
    h.context.renderLocalSheetDebug(1);
    assert.equal(h.element('localOcrDebugCanvas').getContext().image, h.state.uploadedSheetPages[1].imgElement);
    assert.equal(h.element('runLocalLogicOcrBtn').disabled, false);
    assert.equal(h.element('sheetOcrIntro').open, true);
});

test('large pages are capped at 1800px without using compressed preview', async () => {
    const h = harness([recognized(['1'])]);
    h.state.uploadedSheetPages[0].imgElement = { naturalWidth: 3000, naturalHeight: 4000 };
    h.element('customSongTitleInput').value = '';
    await h.context.runLocalLogicSheetRecognition();
    assert.equal(h.createdCanvases[0].width, 1350);
    assert.equal(h.createdCanvases[0].height, 1800);
    assert.equal(h.element('customSongTitleInput').value, '相片識譜 (1頁)');
});

for (const [label, result] of [
    ['empty page', recognized()],
    ['unsupported note', { ...recognized(['1']), unsupported: 1 }],
    ['recognizer failure', new Error('Cannot read canvas')]
]) {
    test(`${label} preserves old notes and title, including after a successful first page`, async () => {
        const h = harness([recognized(['2']), result]);
        await h.context.runLocalLogicSheetRecognition();
        assert.equal(h.element('customSongNotesInput').value, 'old notes');
        assert.equal(h.element('customSongTitleInput').value, 'old title');
        assert.match(h.element('sheetOcrStatusText').textContent, /原有簡譜已保留/);
        assert.equal(h.element('runLocalLogicOcrBtn').disabled, false);
    });
}

test('changing pages while recognition yields cannot import a stale result', async () => {
    const h = harness([recognized(['1']), recognized(['2'])], {
        onYield(state) { state.uploadedSheetPages = []; h.context.renderUploadedSheetPagesUI(); }
    });
    await h.context.runLocalLogicSheetRecognition();
    assert.equal(h.element('customSongNotesInput').value, 'old notes');
    assert.match(h.element('sheetOcrStatusText').textContent, /圖片列表已更改/);
    assert.equal(h.element('localOcrPageSelect').children.length, 0);
    assert.ok(h.element('runLocalLogicOcrBtn').disabled);
    assert.ok(h.element('localOcrDebugCanvas').classList.contains('hidden'));
});

test('upload changes clear old debug pages and status but preserve transcription', async () => {
    const h = harness([recognized(['1'])]);
    await h.context.runLocalLogicSheetRecognition();
    h.state.uploadedSheetPages = [];
    h.context.renderUploadedSheetPagesUI();
    assert.equal(h.element('localOcrPageSelect').children.length, 0);
    assert.ok(h.element('localOcrDebugCanvas').classList.contains('hidden'));
    assert.equal(h.element('sheetOcrStatusText').textContent, '');
    assert.equal(h.element('customSongNotesInput').value, '1');
    assert.ok(h.element('runLocalLogicOcrBtn').disabled);
    assert.equal(h.element('sheetOcrIntro').open, false);
});

test('OCR exposes only local recognition and keeps introduction collapsed until images are added', () => {
    assert.doesNotMatch(html, /runAiOcrBtn|runAiMultiPageOcr|generativelanguage\.googleapis\.com/);
    assert.match(html, /<details id="sheetOcrIntro"/);
    assert.doesNotMatch(html, /<details id="sheetOcrIntro"[^>]*\bopen\b/);
    const h = harness([recognized(['1'])]);
    h.context.renderUploadedSheetPagesUI();
    assert.equal(h.element('sheetOcrIntro').open, true);
});
