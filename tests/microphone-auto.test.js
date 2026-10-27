'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Controller, levels } = require('../microphone-auto.js');
const quiet = { rms: 0.002, peak: 0.006, clarity: 0.1, freq: -1 };
const tone = { rms: 0.015, peak: 0.022, clarity: 0.95, freq: 440 };
function calibrated() {
    const c = new Controller();
    c.begin(0);
    for (let now = 0; now <= 1200; now += 50) assert.equal(c.observe(quiet, now).blocked, true);
    assert.equal(c.phase, 'ready');
    return c;
}
test('default Auto; pre-gain calibration blocks even its completion frame', () => {
    const c = calibrated();
    assert.equal(c.mode, 'auto');
    assert.equal(c.noiseFloor, 0.002);
    assert.equal(c.threshold, 0.006);
    assert.equal(c.observe(tone, 1250).blocked, false);
});
test('sustained and soft periodic signals never calibrate as noise', () => {
    for (const rms of [0.0001, 0.015]) {
        const c = new Controller(); c.begin(0);
        for (let now = 0; now <= 7000; now += 50) assert.equal(c.observe({ ...tone, rms }, now).blocked, true);
        assert.equal(c.phase, 'retry'); assert.equal(c.noiseFloor, 0);
    }
});
test('silence/disconnected zeros, excessive noise, clipping and invalid data fail closed', () => {
    for (const frame of [{ ...quiet, rms: 0 }, { ...quiet, rms: 0.02 }, { ...quiet, rawPeak: 1 }, { ...quiet, rms: NaN }]) {
        const c = new Controller(); c.begin(0);
        for (let now = 0; now <= 6100; now += 50) assert.equal(c.observe(frame, now).blocked, true);
        assert.equal(c.phase, 'retry');
    }
});
test('interrupted calibration and tab gaps require fresh consecutive quiet', () => {
    const c = new Controller(); c.begin(0);
    for (let now = 0; now <= 1000; now += 50) c.observe(quiet, now);
    c.observe(tone, 1050);
    c.observe(quiet, 2500);
    assert.equal(c.phase, 'calibrating');
    for (let now = 2550; now <= 3700; now += 50) c.observe(quiet, now);
    assert.equal(c.phase, 'ready');
});
test('bounded floor only learns suitable low non-tonal inter-note evidence', () => {
    const c = calibrated();
    for (let now = 1250; now < 10000; now += 50) c.observe({ ...tone, rms: 0.0001 }, now);
    assert.equal(c.noiseFloor, 0.002);
    c.observe({ ...quiet, rms: 0.02 }, 10000);
    assert.equal(c.noiseFloor, 0.002);
    for (let now = 10050; now <= 11000; now += 50) c.observe({ ...quiet, rms: 0.003 }, now);
    assert.ok(c.noiseFloor > 0.002 && c.noiseFloor <= 0.0022);
    assert.ok(c.threshold >= 0.003 && c.threshold <= 0.04);
});
test('gain needs stable clean evidence, is bounded and cannot amplify noise learning', () => {
    const c = calibrated();
    for (let now = 1250; now < 5000; now += 50) c.observe({ ...tone, clarity: 0.8 }, now);
    assert.equal(c.gain, 1);
    for (let now = 5000; now < 20000; now += 50) c.observe(tone, now);
    assert.equal(c.gain, 4); assert.equal(c.noiseFloor, 0.002);
    assert.equal(c.observe({ ...tone, rawPeak: 1 }, 20000).reason, 'clipping');
    assert.equal(c.gain, 1);
    assert.equal(c.observe(tone, 20200).blocked, true);
    assert.equal(c.observe(tone, 20500).blocked, false);
});
test('manual suspends adaptation; mode, restart and stop discard session evidence', () => {
    const c = calibrated();
    c.setMode('manual', 1300);
    for (let now = 1350; now < 5000; now += 50) c.observe(tone, now);
    assert.equal(c.gain, 1); assert.equal(c.noiseFloor, 0);
    c.begin(5000); assert.equal(c.phase, 'calibrating');
    c.setMode('auto', 6000); assert.equal(c.phase, 'calibrating');
    c.stop(); assert.equal(c.phase, 'off'); assert.equal(c.observe(tone, 6100).blocked, true);
    assert.equal(c.lastFreq, 0); assert.equal(c.clipUntil, 0);
});
test('level measurement reports raw RMS/peak and invalid samples', () => {
    assert.deepEqual(levels([0.1, -0.1]), { rms: 0.1, peak: 0.1 });
    assert.ok(Number.isNaN(levels([NaN]).rms));
});
