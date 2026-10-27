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

function harness(storage = new Map()) {
    const elements = Object.fromEntries(['customSongTitleInput', 'customSongNotesInput', 'customFormModeBadge', 'deleteCustomSongBtn'].map(id => [id, {
        value: '', textContent: '', hidden: id === 'deleteCustomSongBtn',
        classList: { add() { elements[id].hidden = true; }, remove() { elements[id].hidden = false; } }
    }]));
    const preset = { title: '預設曲', notes: [{ midi: 60 }], rawJianpu: '1' };
    const songs = { stage1_middleC: { title: '第一關', isCampaign: true, notes: [{ midi: 60 }] }, custom_preset: { ...preset }, custom_123: { title: '我的歌', notes: [{ midi: 62 }], rawJianpu: '2' } };
    const state = { theme: 'dark', profiles: { p: {} }, activeProfileId: 'p', currentSongKey: 'custom_123', editingCustomSongKey: 'custom_123', deletedCustomPresetKeys: [] };
    const loaded = [];
    let confirmed = false;
    let renders = 0;
    const context = vm.createContext({
        state, SONGS: songs, BUILTIN_CUSTOM_PRESETS: { custom_preset: preset }, LEGACY_BUILTIN_PRESETS: {}, PREVIOUS_REVIEWED_PRESETS: {}, PREVIOUS_LYRICS_PRESETS: {},
        localStorage: { setItem: (key, value) => storage.set(key, value), getItem: key => storage.get(key) || null },
        document: { getElementById: id => elements[id] }, window: { confirm: () => confirmed },
        PianoCurriculum: { isUnmodifiedPreset: () => false, migrateProfile() {} },
        loadSong: key => { loaded.push(key); state.currentSongKey = key; },
        renderSavedCustomSongsList: () => { renders++; }, stopCustomSongPreview() {}, console
    });
    vm.runInContext(`
        const LOCAL_STORAGE_THEME_KEY = 'starkeys_theme_v2';
        const LOCAL_STORAGE_PROFILES_KEY = 'starkeys_profiles_v2';
        const LOCAL_STORAGE_ACTIVE_PROFILE_KEY = 'starkeys_active_profile_v2';
        const LOCAL_STORAGE_CUSTOM_SONGS_KEY = 'starkeys_custom_songs_v2';
        const LOCAL_STORAGE_DELETED_PRESETS_KEY = 'starkeys_deleted_custom_presets_v2';
        ${['saveToLocalStorage', 'loadFromLocalStorage', 'resetCustomSongForm', 'deleteCustomSongFromForm'].map(source).join('\n')}
    `, context);
    return { context, state, songs, elements, loaded, storage, confirm: () => { confirmed = true; }, renders: () => renders };
}

test('delete selected custom song only after confirmation and reset the editor and active song', () => {
    const h = harness();
    h.context.deleteCustomSongFromForm();
    assert.ok(h.songs.custom_123);
    assert.equal(h.renders(), 0);
    h.confirm();
    h.context.deleteCustomSongFromForm();
    assert.equal(h.songs.custom_123, undefined);
    assert.deepEqual(h.loaded, ['stage1_middleC']);
    assert.equal(h.state.editingCustomSongKey, null);
    assert.equal(h.elements.deleteCustomSongBtn.hidden, true);
    assert.equal(h.elements.customFormModeBadge.textContent, '✨ 建立新簡譜');
    assert.equal(h.renders(), 1);
    assert.ok(!JSON.parse(h.storage.get('starkeys_custom_songs_v2')).custom_123);
});

test('deleted built-in custom preset stays deleted after reloading local storage', () => {
    const h = harness();
    h.state.editingCustomSongKey = 'custom_preset';
    h.confirm();
    h.context.deleteCustomSongFromForm();
    assert.equal(h.songs.custom_preset, undefined);
    assert.deepEqual(JSON.parse(h.storage.get('starkeys_deleted_custom_presets_v2')), ['custom_preset']);

    const next = harness(h.storage);
    next.context.loadFromLocalStorage();
    assert.equal(next.songs.custom_preset, undefined);
    assert.ok(next.songs.stage1_middleC);
    assert.equal(next.state.deletedCustomPresetKeys[0], 'custom_preset');
});

test('editor delete control is hidden until editing and wired to the action', () => {
    assert.match(html, /id="deleteCustomSongBtn"[^>]*class="hidden /);
    assert.match(html, /bindSafariButton\('deleteCustomSongBtn', deleteCustomSongFromForm\)/);
    assert.match(source('renderSavedCustomSongsList'), /getElementById\('deleteCustomSongBtn'\)\.classList\.remove\('hidden'\)/);
});

test('resetting editor hides delete action without removing a song', () => {
    const h = harness();
    h.elements.deleteCustomSongBtn.hidden = false;
    h.context.resetCustomSongForm();
    assert.ok(h.songs.custom_123);
    assert.equal(h.elements.deleteCustomSongBtn.hidden, true);
});

test('unsaved notes can be previewed with rests and durations, then stopped or edited', () => {
    const timers = new Map();
    const played = [];
    const makeElement = () => ({
        value: '', textContent: '', children: [], attributes: {},
        classList: { values: new Set(), add(value) { this.values.add(value); }, remove(value) { this.values.delete(value); }, toggle(value, on) { if (on) this.add(value); else this.remove(value); }, contains(value) { return this.values.has(value); } },
        setAttribute(name, value) { this.attributes[name] = value; },
        removeAttribute(name) { delete this.attributes[name]; },
        replaceChildren() { this.children = []; }, append(child) { this.children.push(child); },
        addEventListener(name, handler) { this[name] = handler; },
        scrollIntoView() {}, focus() {},
        setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    });
    const elements = Object.fromEntries(['customSongNotesInput', 'previewCustomSongBtn', 'previewCustomSongStatus', 'previewCustomSongTrack'].map(id => [id, makeElement()]));
    let nextTimer = 0;
    const context = vm.createContext({
        document: { getElementById: id => elements[id], createElement: makeElement, createTextNode: text => ({ textContent: text }) },
        parseJianpuString: raw => raw.split(/\s+/).filter(Boolean).map(token => ({
            midi: Number(token[0]) + 60, dur: token.endsWith('-') ? 2 : 1, isRest: token[0] === '0'
        })),
        playPianoTone: (...args) => { played.push(args); return () => {}; },
        setTimeout: (callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, ms }); return id; },
        clearTimeout: id => timers.delete(id)
    });
    vm.runInContext(`let customSongPreviewTimer = null; let customSongPreviewStopTone = null; ${source('stopCustomSongPreview')} ${source('highlightCustomSongPreviewToken')} ${source('toggleCustomSongPreview')}`, context);
    elements.customSongNotesInput.value = '1 0\n2- 2-';
    context.toggleCustomSongPreview();
    const tokenButtons = elements.previewCustomSongTrack.children.filter(child => child.type === 'button');
    assert.deepEqual(tokenButtons.map(button => button.textContent), ['1', '0', '2-', '2-']);
    assert.ok(tokenButtons[0].classList.contains('bg-amber-400'));
    assert.deepEqual(played, [[61, 0.65, true]]);
    assert.equal([...timers.values()][0].ms, 650);
    let [id, timer] = [...timers][0]; timers.delete(id); timer.callback();
    assert.equal(played.length, 1);
    assert.ok(tokenButtons[1].classList.contains('bg-amber-400'));
    assert.ok(!tokenButtons[0].classList.contains('bg-amber-400'));
    [id, timer] = [...timers][0]; timers.delete(id); timer.callback();
    assert.deepEqual(played[1], [62, 1.3, true]);
    assert.ok(tokenButtons[2].classList.contains('bg-amber-400'));
    context.toggleCustomSongPreview();
    assert.equal(timers.size, 0);
    assert.ok(!elements.previewCustomSongTrack.classList.contains('hidden'));
    tokenButtons[3].click();
    assert.ok(tokenButtons[3].classList.contains('bg-amber-400'));
    assert.equal(elements.customSongNotesInput.selectionStart, 7);
    assert.equal(elements.customSongNotesInput.selectionEnd, 9);
    assert.equal(elements.previewCustomSongBtn.textContent, '▶ 試聽簡譜');
    context.stopCustomSongPreview();
    assert.ok(elements.previewCustomSongTrack.classList.contains('hidden'));
    elements.customSongNotesInput.value = '';
    context.toggleCustomSongPreview();
    assert.match(elements.previewCustomSongStatus.textContent, /有效簡譜/);
});
