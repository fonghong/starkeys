'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const PianoCurriculum = require('../piano-curriculum.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function extract(name) {
    const match = html.match(new RegExp(`^        (?:async )?function ${name}\\([^]*?^        }`, 'm'));
    assert.ok(match, name);
    return match[0];
}
function harness() {
    const elements = new Map();
    const timers = new Map();
    const storage = new Map();
    const tones = [];
    let id = 0;
    const profile = { id: 'kid', curriculumVersion: 2, unlockedStageOrder: 24, xp: 0, stageProgress: {}, history: [], badges: [] };
    const state = { profiles: { kid: profile }, activeProfileId: 'kid', currentSongKey: 'stage1_middleC',
        practiceMode: 'learn', handMode: 'both', tempoMultiplier: 1, transposeSemitones: 0 };
    const context = vm.createContext({ PianoCurriculum, state, console,
        MIDI_MAP: Object.fromEntries(Array.from({ length: 32 }, (_, i) => [48 + i, { solfege: String(i), note: String(i) }])),
        document: { getElementById(key) {
            if (!elements.has(key)) elements.set(key, { textContent: '', classList: { add() {}, remove() {} } });
            return elements.get(key);
        } },
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
        setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id; }, clearTimeout: key => timers.delete(key),
        setInterval(fn, ms) { timers.set(++id, { fn, ms }); return id; }, clearInterval: key => timers.delete(key),
        performance: { now: () => 0 }, updateInstructionUI() {}, updateKeyboardHighlights() {},
        updateProfileHeaderUI() {}, playVictoryFanfare() {}, playMetronomeTick() {},
        playPianoTone: (...args) => tones.push(args)
    });
    vm.runInContext(html.slice(html.indexOf('        const SONGS ='), html.indexOf('        function getTransposedMidi')), context);
    vm.runInContext(html.slice(html.indexOf('        const LOCAL_STORAGE_THEME_KEY'), html.indexOf('        function applyTheme')), context);
    vm.runInContext('let demoTimeout = null; let metronomeInterval = null; let metroBeatCount = 0;\n' + [
        'getTransposedMidi', 'getPracticeBeatMs', 'toggleMetronome', 'loadSong', 'toggleDemoPlay',
        'checkAndAutoPlayOtherHand', 'restartFlowModeTimer', 'handleUserPlayedNote', 'finishStageAndEvaluate'
    ].map(extract).join('\n'), context);
    context.saveProfileToCloud = () => context.saveToLocalStorage();
    const songs = vm.runInContext('SONGS', context);
    context.loadSong('stage1_middleC');
    return { context, state, profile, songs, elements, timers, storage, tones,
        evaluate: code => vm.runInContext(code, context),
        run(timerId) { const timer = timers.get(timerId); assert.ok(timer); timers.delete(timerId); timer.fn(); } };
}
function bindings(h, ids) {
    const handlers = new Map();
    h.context.bindSafariButton = (id, fn) => handlers.set(id, fn);
    h.context.renderProfileModal = () => {};
    for (const id of ids) {
        const match = html.match(new RegExp(`^            bindSafariButton\\('${id}', \\(\\) => \\{[^]*?^            \\}\\);`, 'm'));
        assert.ok(match, id);
        h.evaluate(match[0]);
    }
    return handlers;
}
test('profile reset, creation and deletion isolate runs without touching another child’s progress', () => {
    const h = harness();
    const handlers = bindings(h, ['resetProfileProgressBtn', 'createProfileBtn', 'deleteProfileBtn']);
    h.state.profiles.other = { ...plain(h.profile), id: 'other', xp: 500 };
    h.context.loadSong('step_finale');
    h.state.editingProfileId = 'other';
    const runId = h.state.practiceRunId;
    handlers.get('resetProfileProgressBtn')();
    assert.equal(h.state.practiceRunId, runId);
    assert.equal(h.state.currentSongKey, 'step_finale');
    h.state.editingProfileId = 'kid';
    handlers.get('resetProfileProgressBtn')();
    assert.equal(h.state.currentSongKey, 'stage1_middleC');
    assert.equal(h.profile.unlockedStageOrder, 1);
    assert.ok(h.state.practiceRunId > runId);
    h.context.document.getElementById('newProfileNameInput').value = 'New child';
    h.context.document.getElementById('newProfileAvatar').value = '⭐';
    handlers.get('createProfileBtn')();
    const newId = h.state.activeProfileId;
    assert.notEqual(newId, 'kid');
    assert.equal(h.state.profiles[newId].curriculumVersion, 2);
    assert.equal(h.state.currentSongKey, 'stage1_middleC');
    h.state.editingProfileId = newId;
    handlers.get('deleteProfileBtn')();
    assert.equal(h.state.activeProfileId, 'kid');
    assert.equal(h.state.profiles[newId], undefined);
    assert.equal(h.state.currentNoteIndex, 0);
    h.state.editingProfileId = 'other';
    const activeRun = h.state.practiceRunId;
    handlers.get('deleteProfileBtn')();
    assert.equal(h.state.practiceRunId, activeRun);
});
test('hand, tempo and transposition changes reset partial runs and pending feedback', () => {
    const h = harness();
    const handlers = bindings(h, ['handPracticeBtn', 'tempoSelectBtn', 'transposeUpBtn']);
    h.evaluate(html.slice(html.indexOf('            const updateTransposeUI'), html.indexOf("            bindSafariButton('transposeDownBtn'")));
    for (const id of ['handPracticeBtn', 'tempoSelectBtn', 'transposeUpBtn']) {
        h.context.handleUserPlayedNote(h.context.getTransposedMidi(60), 'keyboard');
        assert.equal(h.state.correctHits, 1);
        const feedbackTimer = h.state.correctTimer;
        handlers.get(id)();
        assert.equal(h.state.correctHits, 0);
        assert.equal(h.state.currentNoteIndex, 0);
        assert.equal(h.timers.has(feedbackTimer), false);
        assert.equal(h.context.document.getElementById('rhythmTimingBadge').textContent, '跟拍練習（只評音高）');
    }
    assert.equal(h.state.handMode, 'R');
    assert.equal(h.state.tempoMultiplier, 0.6);
    assert.equal(h.state.transposeSemitones, 1);
});
test('stale flow reminder cannot replace feedback from a new run', () => {
    const h = harness();
    h.state.practiceMode = 'flow';
    h.context.restartFlowModeTimer();
    const stale = h.timers.get(h.state.flowTimer).fn;
    h.context.loadSong('step_rightFive');
    const badge = h.context.document.getElementById('rhythmTimingBadge');
    badge.textContent = 'new run';
    stale();
    assert.equal(badge.textContent, 'new run');
});
test('24 contiguous lessons preserve legacy IDs; every campaign, dojo and preset note is valid', () => {
    const h = harness();
    const campaign = Object.values(h.songs).filter(song => song.isCampaign);
    assert.equal(campaign.length, 24);
    assert.deepEqual(campaign.map(s => s.order).sort((a, b) => a - b), Array.from({ length: 24 }, (_, i) => i + 1));
    assert.equal(new Set(campaign.map(s => s.tier)).size, 6);
    for (const key of PianoCurriculum.LEGACY_KEYS) assert.ok(h.songs[key].isCampaign);
    for (const [key, song] of Object.entries(h.songs)) {
        assert.ok(song.setup && song.tip && song.beatMs >= 850, key);
        assert.ok(song.notes.length > 0, key);
        for (const note of song.notes) {
            assert.ok(Number.isInteger(note.midi) && note.midi >= 48 && note.midi <= 79, key);
            assert.ok(Number.isInteger(note.finger) && note.finger >= 1 && note.finger <= 5, key);
            assert.ok(['L', 'R'].includes(note.hand), key);
            assert.ok([0.5, 1, 2, 4].includes(note.dur), key);
        }
    }
});
test('reviewed fingerings use consistent five-finger positions with explicit relocations', () => {
    const { songs } = harness();
    assert.deepEqual(plain(songs.stage5_twinkleStar.notes.map(n => n.finger)), [1,1,4,4,5,5,4,3,3,2,2,1,1,1]);
    assert.match(songs.stage5_twinkleStar.notes[2].cue, /放開/);
    assert.match(songs.stage5_twinkleStar.notes.at(-1).cue, /移返/);
    assert.equal(songs.stage9_blackKeyMinuet.notes[8].finger, 5);
    assert.match(songs.stage9_blackKeyMinuet.notes[8].cue, /A4–E5/);
    assert.equal(songs.stage9_blackKeyMinuet.notes[13].finger, 2);
    assert.match(songs.stage11_bachPrelude.notes[8].cue, /D3–A3/);
    for (let i = 0; i < 16; i += 4) {
        const group = songs.dojo_triads_prog.notes.slice(i + 1, i + 4);
        assert.deepEqual(plain(group.map(n => n.finger)), [1,3,5]);
        assert.equal(group[2].midi - group[0].midi, 7);
        assert.ok(group[0].cue);
    }
    assert.deepEqual(plain(songs.dojo_hanon_1.notes.slice(0, 5).map(n => n.midi)), [60,62,64,65,67]);
    assert.match(songs.dojo_hanon_1.notes[8].cue, /整手/);
    assert.deepEqual(plain(songs.step_leftScale.notes.slice(0, 8).map(n => n.finger)), [5,4,3,2,1,3,2,1]);
    assert.deepEqual(plain(songs.stage6_cMajorScale.notes.slice(0, 8).map(n => n.finger)), [1,2,3,1,2,3,4,5]);
});
test('all six reviewed presets round-trip through the actual parser, including low right-hand notes and durations', () => {
    const h = harness();
    const presets = Object.values(h.evaluate('BUILTIN_CUSTOM_PRESETS'));
    assert.equal(presets.length, 6);
    const musical = notes => plain(notes.map(({ midi, finger, hand, dur }) => ({ midi, finger, hand, dur })));
    for (const song of presets) assert.deepEqual(musical(h.context.parseJianpuString(song.rawJianpu)), musical(song.notes), song.title);
    assert.equal(h.songs.custom_preset_twinkle_full.notes.length, 42);
    assert.equal(h.songs.custom_preset_birthday.notes[0].hand, 'R');
    assert.equal(h.songs.custom_preset_birthday.notes[0].midi, 55);
    assert.equal(h.songs.custom_preset_london_full.notes.at(-1).dur, 2);
    assert.equal(h.songs.custom_preset_ode_full.notes.at(-1).dur, 2);
    const whole = [{ midi: 77, finger: 4, hand: 'R', dur: 4 }];
    assert.deepEqual(musical(h.context.parseJianpuString(PianoCurriculum.serializeNotes(whole))), whole);
});
test('migration maps each legacy unlock, preserves achievements, and is idempotent', () => {
    const { songs } = harness();
    PianoCurriculum.LEGACY_KEYS.forEach((key, i) => {
        const profile = { unlockedStageOrder: i + 1, xp: 600, history: ['old'], stageProgress: {} };
        PianoCurriculum.migrateProfile(profile, songs);
        assert.equal(profile.unlockedStageOrder, songs[key].order);
        const snapshot = plain(profile);
        PianoCurriculum.migrateProfile(profile, songs);
        assert.deepEqual(profile, snapshot);
    });
    const completed = { unlockedStageOrder: 12, xp: 500, stageProgress: { stage12_furElise: { stars: 2, bestAcc: 91 }, bad: null }, history: ['old'] };
    PianoCurriculum.migrateProfile(completed, songs);
    assert.equal(completed.unlockedStageOrder, 24);
    assert.equal(completed.xp, 500);
    assert.deepEqual(completed.history, ['old']);
    assert.equal(completed.stageProgress.stage12_furElise.stars, 2);
    const fresh = { curriculumVersion: 2, unlockedStageOrder: 1 };
    PianoCurriculum.migrateProfile(fresh, songs);
    assert.equal(fresh.unlockedStageOrder, 1);
});
test('passes require a full personal performance; zero, partial, assisted and loop counts cannot pass', () => {
    for (const args of [[10,0,0], [10,5,5], [10,11,11], [0,0,0], [10,10,13]]) {
        assert.equal(PianoCurriculum.evaluatePerformance(...args).passed, false);
    }
    assert.equal(PianoCurriculum.evaluatePerformance(8,8,10).stars, 1);
    assert.equal(PianoCurriculum.evaluatePerformance(8,8,9).stars, 2);
    assert.equal(PianoCurriculum.evaluatePerformance(8,8,8).stars, 3);
    const { songs } = harness();
    assert.equal(PianoCurriculum.nextLessonKey(songs, 'step_handDialogue', 13), 'step_rightThumb');
    assert.equal(PianoCurriculum.nextLessonKey(songs, 'step_handDialogue', 12), null);
    assert.equal(PianoCurriculum.nextLessonKey(songs, 'step_finale', 24), null);
    assert.equal(PianoCurriculum.nextLessonKey(songs, 'custom_preset_birthday', 24), null);
});
test('actual storage upgrades untouched presets, protects lessons, preserves edits and persists migration', () => {
    const h = harness();
    const legacy = plain(h.evaluate('LEGACY_BUILTIN_PRESETS'));
    const edited = { ...legacy.custom_preset_london_full, title: 'My edited London', setup: 'stale', tip: 'stale' };
    h.storage.set('starkeys_custom_songs_v2', JSON.stringify({ ...legacy, custom_preset_london_full: edited,
        stage1_middleC: { notes: [{ midi: 79 }] }, dojo_hanon_1: { notes: [{ midi: 79 }] },
        custom_mine: { title: 'Mine', notes: [{ midi: 60, finger: 1, hand: 'R', dur: 1 }] } }));
    h.storage.set('starkeys_profiles_v2', JSON.stringify({ kid: { ...h.profile, curriculumVersion: undefined, unlockedStageOrder: 7, xp: 300 }, invalid: null }));
    h.storage.set('starkeys_active_profile_v2', 'kid');
    h.context.loadFromLocalStorage();
    assert.equal(h.songs.stage1_middleC.notes[0].midi, 60);
    assert.equal(h.songs.dojo_hanon_1.notes[0].midi, 60);
    assert.match(h.songs.custom_preset_birthday.title, /C 大調/);
    assert.equal(h.songs.custom_preset_london_full.title, edited.title);
    assert.deepEqual(plain(h.songs.custom_preset_london_full.notes), edited.notes);
    assert.equal(h.songs.custom_preset_london_full.setup, undefined);
    assert.equal(h.songs.custom_mine.title, 'Mine');
    const saved = JSON.parse(h.storage.get('starkeys_profiles_v2'));
    assert.equal(saved.kid.curriculumVersion, 2);
    assert.equal(saved.kid.unlockedStageOrder, 6);
    assert.equal(saved.kid.xp, 300);
    assert.equal(saved.invalid, undefined);
    const before = plain(h.songs.custom_preset_birthday);
    h.context.loadFromLocalStorage();
    assert.deepEqual(plain(h.songs.custom_preset_birthday), before);
});
test('demo starts without unintended accompaniment, cannot score, and resets without rewards', () => {
    const h = harness();
    h.context.loadSong('step_handDialogue', false);
    h.state.handMode = 'R';
    h.context.toggleDemoPlay();
    assert.equal(h.tones.length, 1);
    assert.equal(h.state.isDemoPlaying, true);
    h.context.handleUserPlayedNote(60, 'keyboard');
    h.context.finishStageAndEvaluate();
    assert.equal(h.state.totalAttempts, 0);
    assert.equal(h.profile.xp, 0);
    const stale = [...h.timers.values()][0].fn;
    h.state.handMode = 'both';
    for (let i = 0; h.state.isDemoPlaying && i < 50; i++) h.run([...h.timers.keys()][0]);
    assert.equal(h.state.isDemoPlaying, false);
    assert.equal(h.state.currentNoteIndex, 0);
    assert.equal(h.profile.history.length, 0);
    stale();
    assert.equal(h.state.currentNoteIndex, 0);
});
test('actual completion unlocks above 12, caps at 24, ignores duplicate completion and assisted best accuracy', () => {
    const h = harness();
    h.profile.unlockedStageOrder = 13;
    h.context.loadSong('step_rightThumb');
    const count = h.songs.step_rightThumb.notes.length;
    Object.assign(h.state, { currentNoteIndex: count, correctHits: count, totalAttempts: count });
    h.context.finishStageAndEvaluate();
    assert.equal(h.profile.unlockedStageOrder, 14);
    const xp = h.profile.xp;
    h.context.finishStageAndEvaluate();
    assert.equal(h.profile.xp, xp);
    h.profile.unlockedStageOrder = 24;
    h.context.loadSong('step_finale');
    Object.assign(h.state, { currentNoteIndex: h.songs.step_finale.notes.length, correctHits: h.songs.step_finale.notes.length, totalAttempts: h.songs.step_finale.notes.length });
    h.context.finishStageAndEvaluate();
    assert.equal(h.profile.unlockedStageOrder, 24);
    h.context.loadSong('step_finale');
    const earned = h.profile.xp;
    h.state.currentNoteIndex = h.songs.step_finale.notes.length;
    h.context.finishStageAndEvaluate();
    assert.equal(h.profile.xp, earned);
    assert.equal(h.profile.stageProgress.step_finale.stars, 3);
    assert.equal(h.profile.stageProgress.step_finale.bestAcc, 100);
});
test('new lesson cancels stale accompaniment and delayed evaluation; locked navigation returns to first lesson', () => {
    const h = harness();
    h.state.handMode = 'R';
    h.context.loadSong('step_handDialogue');
    const staleAuto = h.timers.get(h.state.autoHandTimer).fn;
    h.state.handMode = 'both';
    h.context.loadSong('stage1_middleC');
    staleAuto();
    assert.equal(h.state.currentNoteIndex, 0);
    for (const note of h.songs.stage1_middleC.notes) h.context.handleUserPlayedNote(note.midi, 'mic');
    const staleFinish = [...h.timers.values()].find(timer => timer.ms === 400).fn;
    h.context.loadSong('step_rightFive');
    staleFinish();
    assert.equal(h.profile.history.length, 0);
    h.profile.unlockedStageOrder = 1;
    h.context.loadSong('step_finale');
    assert.equal(h.state.currentSongKey, 'stage1_middleC');
});
test('demo, flow, other-hand accompaniment and metronome share lesson tempo and note durations', () => {
    const h = harness();
    h.state.tempoMultiplier = 0.6;
    h.context.loadSong('step_handDialogue', false);
    const beat = Math.round(h.songs.step_handDialogue.beatMs / 0.6);
    assert.equal(h.context.getPracticeBeatMs(), beat);
    h.context.toggleMetronome();
    assert.ok([...h.timers.values()].some(t => t.ms === beat));
    h.context.toggleMetronome();
    h.state.practiceMode = 'flow';
    h.context.restartFlowModeTimer();
    assert.equal(h.timers.get(h.state.flowTimer).ms, beat);
    h.state.handMode = 'R';
    h.state.currentNoteIndex = 2;
    h.context.checkAndAutoPlayOtherHand();
    assert.equal(h.timers.get(h.state.autoHandTimer).ms, beat * 2);
    assert.equal(h.tones.at(-1)[1], beat * 2 / 1000);
    h.context.toggleDemoPlay();
    assert.equal(h.tones.at(-1)[1], beat / 1000);
});
