'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const MicrophoneAuto = require('../microphone-auto.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const micCode = html.slice(html.indexOf('        // Mic 收音'), html.indexOf('        const LOCAL_STORAGE_THEME_KEY'));
const bindingCode = html.slice(html.indexOf("            bindSafariButton('toggleMicBtn'"), html.indexOf("            bindSafariButton('resetSongBtn'"));
function harness() {
    const elements = new Map();
    for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
        const value = /\bvalue="([^"]*)"/.exec(match[0])?.[1] || '';
        const classes = new Set((/class="([^"]*)"/.exec(match[0])?.[1] || '').split(' '));
        elements.set(match[1], { value, textContent: '', innerHTML: '', style: {}, disabled: false,
            classList: { contains: c => classes.has(c), add: c => classes.add(c), remove: c => classes.delete(c) },
            handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; },
            appendChild() {}, getContext: () => new Proxy({}, { get: () => () => {} }) });
    }
    let now = 0, nextId = 0, waveform = 'quiet', rawClip = false;
    const frames = new Map(), nodes = [], streams = [], requests = [], played = [];
    function node(kind) {
        const n = { kind, connections: [], disconnected: false, fftSize: 2048,
            frequency: { setValueAtTime() {} }, connect(other) { this.connections.push(other); },
            disconnect() { this.disconnected = true; },
            getFloatTimeDomainData(buffer) {
                let seed = 17;
                for (let i = 0; i < buffer.length; i++) {
                    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                    buffer[i] = waveform === 'quiet' ? ((seed / 4294967296) * 2 - 1) * 0.0035
                        : waveform === 'soft' ? 0.0001 * Math.sin(2 * Math.PI * 440 * i / 44100)
                        : 0.03 * Math.sin(2 * Math.PI * Number(waveform) * i / 44100);
                }
                if (rawClip && kind === 'analyser' && nodes.filter(x => x.kind === 'analyser').at(-1) === n) buffer[0] = 1;
            } };
        nodes.push(n); return n;
    }
    function stream() {
        const track = { stopped: false, listeners: {}, stop() { this.stopped = true; }, addEventListener(type, fn) { this.listeners[type] = fn; } };
        const s = { track, getTracks: () => [track] }; streams.push(s); return s;
    }
    const media = { enumerateDevices: async () => [], getUserMedia: async options => { requests.push(options); return stream(); } };
    const state = { micGainBoost: 2.5, voiceFilterLevel: 2, selectedMicDeviceId: 'default', isMicListening: false, isDemoPlaying: false, metronomeActive: false };
    const context = vm.createContext({ MicrophoneAuto, Float32Array, Math, Number, console,
        state, performance: { now: () => now }, navigator: { mediaDevices: media },
        document: { getElementById: id => { assert.ok(elements.has(id), `missing DOM id ${id}`); return elements.get(id); }, createElement: () => ({}) },
        window: { AudioContext: class { constructor() { this.state = 'running'; this.sampleRate = 44100; this.currentTime = 0; } createMediaStreamSource() { return node('source'); } createBiquadFilter() { return node('filter'); } createAnalyser() { return node('analyser'); } } },
        requestAnimationFrame(fn) { frames.set(++nextId, fn); return nextId; }, cancelAnimationFrame(id) { frames.delete(id); },
        bindSafariButton(id, fn) { assert.ok(elements.has(id)); elements.get(id).handlers.click = fn; },
        MIDI_MAP: { 69: { note: 'A4', jianpu: '6' }, 72: { note: 'C5', jianpu: "1'" } },
        SONGS: {}, getTransposedMidi: x => x,
        handleUserPlayedNote: (...args) => played.push(args)
    });
    vm.runInContext(micCode + '\n' + bindingCode, context);
    return { context, state, elements, nodes, streams, requests, frames, media, stream, played,
        eval: code => vm.runInContext(code, context),
        event(id, type, value) { const el = elements.get(id); if (value !== undefined) el.value = value; return el.handlers[type]({ target: el }); },
        waveform(value) { waveform = value; }, clipping(value) { rawClip = value; },
        tick(count = 1) { for (let i = 0; i < count; i++) { now += 50; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); } },
        get now() { return now; }
    };
}
test('all inline app scripts compile; local controller loads before inline app', () => {
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
    assert.ok(html.indexOf('src="microphone-auto.js"') < html.indexOf('        // Mic 收音'));
});
test('real bindings open Auto, calibrate silently, accept independent pitch and stop cleanly', async () => {
    const h = harness();
    assert.equal(h.eval('micAuto.mode'), 'auto');
    assert.equal(h.elements.get('micSensitivity').disabled, true);
    await h.event('toggleMicBtn', 'click');
    assert.equal(h.state.isMicListening, true);
    assert.equal(h.eval('micAuto.phase'), 'calibrating');
    assert.equal(h.frames.size, 1);
    h.tick(24);
    assert.equal(h.eval('micAuto.phase'), 'ready'); assert.equal(h.played.length, 0);
    assert.ok(h.state.ambientNoiseFloor > 0.001 && h.state.ambientNoiseFloor < 0.003);
    h.waveform(440); h.tick(20);
    assert.equal(h.played.length, 1); assert.equal(h.played[0][0], 69);
    h.waveform(523.25); h.tick(10);
    assert.equal(h.played.at(-1)[0], 72);
    await h.event('modalToggleMicBtn', 'click');
    assert.equal(h.frames.size, 0); assert.equal(h.state.isMicListening, false);
    assert.ok(h.streams.every(s => s.track.stopped)); assert.ok(h.nodes.every(n => n.disconnected));
    assert.equal(h.eval('micAuto.phase'), 'off'); assert.equal(h.state.ambientNoiseFloor, 0);
});
test('graph measures unboosted filtered noise and separate raw clipping; no output/upload', async () => {
    const h = harness(); await h.eval('toggleMicrophone()');
    const source = h.nodes.find(n => n.kind === 'source');
    assert.deepEqual(source.connections.map(n => n.kind), ['analyser', 'filter']);
    const filters = h.nodes.filter(n => n.kind === 'filter');
    assert.equal(filters[0].connections[0], filters[1]); assert.equal(filters[1].connections[0].kind, 'analyser');
    assert.equal(h.nodes.filter(n => n.kind === 'analyser').every(n => n.connections.length === 0), true);
    assert.equal(h.requests[0].audio.autoGainControl, false);
    h.tick(24); h.clipping(true); h.waveform(440); h.tick(12);
    assert.equal(h.played.length, 0); assert.match(h.elements.get('micAutoStatus').textContent, /爆音/);
    h.clipping(false); h.tick(15); assert.equal(h.played.length, 1);
});
test('soft sustained note blocks calibration; retry and recalibration reset tracking', async () => {
    const h = harness(); h.waveform('soft'); await h.eval('toggleMicrophone()'); h.tick(122);
    assert.equal(h.eval('micAuto.phase'), 'retry'); assert.equal(h.played.length, 0);
    h.waveform('quiet'); h.event('calibrateNoiseBtn', 'click'); h.tick(25);
    assert.equal(h.eval('micAuto.phase'), 'ready');
    h.waveform(440); h.tick(10); assert.equal(h.played.length, 1);
    h.event('calibrateNoiseBtn', 'click');
    assert.equal(h.state.heldMidiNote, null); h.tick(10); assert.equal(h.played.length, 1);
});
test('manual settings survive Auto; presets explicitly choose manual; no calibration timers', async () => {
    const h = harness(); h.event('micModeSelect', 'change', 'manual');
    h.event('micSensitivity', 'input', '8'); h.event('micGainBoostSlider', 'input', '4'); h.event('voiceFilterStrengthSlider', 'input', '3');
    const threshold = h.eval('getActiveRmsThreshold()');
    h.event('micModeSelect', 'change', 'auto'); await h.eval('toggleMicrophone()'); h.tick(24);
    assert.equal(h.state.micGainBoost, 4); assert.equal(h.state.voiceFilterLevel, 3);
    assert.equal(h.eval('getRequiredClarityThreshold()'), 0.77);
    h.event('micModeSelect', 'change', 'manual');
    assert.equal(h.elements.get('micSensitivity').disabled, false);
    assert.equal(h.eval('getActiveRmsThreshold()'), threshold); assert.equal(h.eval('getRequiredClarityThreshold()'), 0.84);
    h.event('presetNoisyRoomBtn', 'click'); assert.equal(h.eval('micAuto.mode'), 'manual');
    assert.equal(h.elements.get('micSensitivity').value, 5);
    h.event('calibrateNoiseBtn', 'click'); h.event('calibrateNoiseBtn', 'click');
    assert.equal(h.frames.size, 1); assert.equal(h.eval('micAuto.phase'), 'calibrating');
});
test('device restart closes old graph, uses selection and starts one new calibration loop', async () => {
    const h = harness(); await h.eval('toggleMicrophone()'); h.tick(24);
    const oldNodes = [...h.nodes];
    await h.event('micDeviceSelect', 'change', 'usb-mic');
    // The actual DOM change callback starts the async operation without returning it.
    await Promise.resolve(); await Promise.resolve();
    assert.equal(h.streams[0].track.stopped, true); assert.ok(oldNodes.every(n => n.disconnected));
    assert.equal(h.requests.at(-1).audio.deviceId.exact, 'usb-mic');
    assert.equal(h.eval('micAuto.phase'), 'calibrating'); assert.equal(h.frames.size, 1);
    h.streams.at(-1).track.listeners.ended(); assert.equal(h.state.isMicListening, false); assert.equal(h.frames.size, 0);
});
test('pending permission cancellation and overlapping restart discard stale streams', async () => {
    const h = harness(); const pending = [];
    h.media.getUserMedia = () => new Promise(resolve => pending.push(resolve));
    const first = h.eval('toggleMicrophone()');
    await h.eval('toggleMicrophone()');
    pending[0](h.stream()); await first;
    assert.equal(h.streams[0].track.stopped, true); assert.equal(h.frames.size, 0);
    const second = h.eval('toggleMicrophone()'); const third = h.eval('toggleMicrophone(true)');
    pending[2](h.stream()); await third;
    pending[1](h.stream()); await second;
    assert.equal(h.streams.at(-1).track.stopped, true); assert.equal(h.frames.size, 1);
    assert.equal(h.state.isMicListening, true);
});
test('permission and selected-device failure do not silently fall back or leave live capture', async () => {
    const h = harness(); let calls = 0;
    h.media.getUserMedia = async () => { calls++; throw Object.assign(new Error(), { name: 'NotAllowedError' }); };
    await h.eval('toggleMicrophone()'); assert.equal(calls, 1); assert.equal(h.eval('micStarting'), false);
    assert.equal(h.frames.size, 0); assert.match(h.elements.get('micAutoStatus').textContent, /未能開啟/);
    h.state.selectedMicDeviceId = 'missing';
    h.media.getUserMedia = async () => { calls++; throw Object.assign(new Error(), { name: 'OverconstrainedError' }); };
    await h.eval('toggleMicrophone()'); assert.equal(calls, 2);
});
test('manual calibration survives an Auto round-trip but not a stopped/device session', async () => {
    const h = harness(); h.event('micModeSelect', 'change', 'manual');
    await h.eval('toggleMicrophone()'); h.tick(24);
    const floor = h.eval('micAuto.noiseFloor'); assert.ok(floor > 0);
    h.event('micModeSelect', 'change', 'auto'); h.tick(25);
    h.event('micModeSelect', 'change', 'manual'); assert.equal(h.eval('micAuto.noiseFloor'), floor);
    await h.eval('toggleMicrophone()'); assert.equal(h.eval('micManualNoiseFloor'), 0);
});
test('default-device constraint fallback and graph creation failure clean up correctly', async () => {
    const h = harness(); let calls = 0;
    h.media.getUserMedia = async options => {
        calls++;
        if (calls === 1) throw Object.assign(new Error(), { name: 'OverconstrainedError' });
        assert.equal(options.audio, true); return h.stream();
    };
    await h.eval('toggleMicrophone()'); assert.equal(calls, 2); assert.equal(h.state.isMicListening, true);
    await h.eval('toggleMicrophone()');
    h.media.getUserMedia = async () => h.stream();
    h.eval("micAudioCtx.createAnalyser = () => { throw new Error('graph failed'); }");
    await h.eval('toggleMicrophone()');
    assert.equal(h.state.isMicListening, false); assert.equal(h.frames.size, 0);
    assert.ok(h.streams.every(s => s.track.stopped)); assert.ok(h.nodes.every(n => n.disconnected));
});
test('cancelled Safari context resume does not request microphone permission afterwards', async () => {
    const h = harness(); let resume;
    h.context.resumePromise = new Promise(resolve => { resume = resolve; });
    h.eval("micAudioCtx = new window.AudioContext(); micAudioCtx.state = 'suspended'; micAudioCtx.resume = () => resumePromise;");
    const opening = h.eval('toggleMicrophone()'); await h.eval('toggleMicrophone()');
    resume(); await opening; assert.equal(h.requests.length, 0); assert.equal(h.frames.size, 0);
});
test('browser global controller and modal diagnostics execute without Node globals', async () => {
    const browser = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'microphone-auto.js'), 'utf8'), browser);
    assert.equal(vm.runInContext('new MicrophoneAuto.Controller().mode', browser), 'auto');
    const h = harness(); h.elements.get('micSetupModal').classList.remove('hidden');
    await h.eval('toggleMicrophone()'); h.tick(24); h.waveform(440); h.tick(10);
    assert.equal(h.elements.get('modalDetectedNoteBig').textContent, 'A4');
    h.waveform('quiet'); h.tick(5); assert.equal(h.elements.get('modalDetectedNoteBig').textContent, '--');
});
test('demo/metronome pause calibration, learning and note submission', async () => {
    const h = harness(); h.state.isDemoPlaying = true; await h.eval('toggleMicrophone()'); h.tick(140);
    assert.equal(h.eval('micAuto.phase'), 'calibrating'); assert.equal(h.played.length, 0);
    h.state.isDemoPlaying = false; h.tick(25); assert.equal(h.eval('micAuto.phase'), 'ready');
    const floor = h.eval('micAuto.noiseFloor');
    h.state.metronomeActive = true; h.waveform(440); h.tick(30);
    assert.equal(h.played.length, 0); assert.equal(h.eval('micAuto.noiseFloor'), floor);
    h.state.metronomeActive = false; h.tick(10); assert.equal(h.played.length, 1);
});
