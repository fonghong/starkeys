/* Local-only microphone controller. All levels are pre-gain, filtered RMS. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.MicrophoneAuto = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
    function levels(samples) {
        let energy = 0, peak = 0;
        for (const sample of samples) {
            if (!Number.isFinite(sample)) return { rms: NaN, peak: NaN };
            energy += sample * sample;
            peak = Math.max(peak, Math.abs(sample));
        }
        return { rms: samples.length ? Math.sqrt(energy / samples.length) : 0, peak };
    }
    class Controller {
        constructor() { this.mode = 'auto'; this.stop(); }
        stop() {
            this.phase = 'off';
            this.noiseFloor = 0;
            this.gain = 1;
            this.lastTime = null;
            this.startedAt = null;
            this.quietMs = 0;
            this.quietSamples = [];
            this.toneMs = 0;
            this.lastFreq = 0;
            this.holdUntil = 0;
            this.clipUntil = 0;
        }
        begin(now) { this.stop(); this.phase = 'calibrating'; this.startedAt = now; }
        setMode(mode, now) {
            const running = this.phase !== 'off';
            this.mode = mode === 'manual' ? 'manual' : 'auto';
            this.stop();
            if (running) {
                if (this.mode === 'auto') this.begin(now);
                else this.phase = 'ready';
            }
        }
        get threshold() { return clamp(this.noiseFloor * 2.5 + 0.001, 0.003, 0.04); }
        observe(frame, now) {
            if (this.phase === 'off') return { blocked: true, reason: 'off' };
            const elapsed = this.lastTime === null ? 0 : now - this.lastTime;
            const dt = elapsed > 0 && elapsed <= 250 ? elapsed : 0;
            this.lastTime = now;
            const { rms, peak, clarity, freq, rawPeak = peak } = frame;
            if (![rms, peak, rawPeak, clarity].every(Number.isFinite)) {
                this.phase = 'retry';
                return { blocked: true, reason: 'invalid_signal' };
            }
            const clipping = rawPeak >= 0.98 || peak >= 0.98;
            if (clipping) { this.gain = 1; this.clipUntil = now + 500; }
            // Tonality is checked even below the note gate; held notes must never become noise.
            const tonal = clarity >= 0.55;
            if (tonal || rms > Math.max(0.006, this.noiseFloor * 2)) this.holdUntil = now + 800;
            const quiet = !tonal && !clipping && rms > 0.000001 && rms < 0.025;
            if (this.phase === 'calibrating') {
                if (!quiet || !dt) { this.quietMs = 0; this.quietSamples = []; }
                if (quiet) { this.quietMs += dt; this.quietSamples.push(rms); }
                if (this.quietMs >= 1200 && this.quietSamples.length >= 12) {
                    const sorted = this.quietSamples.slice().sort((a, b) => a - b);
                    const floor = sorted[Math.floor(sorted.length * 0.8)];
                    if (floor > 0.014) this.phase = 'retry';
                    else { this.noiseFloor = floor; this.phase = 'ready'; }
                    this.quietSamples = [];
                } else if (now - this.startedAt >= 6000) this.phase = 'retry';
                // The completion frame is also calibration, never a played note.
                return { blocked: true, reason: this.phase === 'retry' ? 'retry' : 'calibrating' };
            }
            if (this.phase === 'retry') return { blocked: true, reason: 'retry' };
            if (now < this.clipUntil) return { blocked: true, reason: 'clipping' };
            if (this.mode === 'auto') {
                // Only low, non-tonal inter-note evidence may move the floor, at <=0.0005/s.
                if (quiet && now >= this.holdUntil && rms <= Math.max(0.003, this.noiseFloor * 1.8)) {
                    const step = 0.0005 * dt / 1000;
                    this.noiseFloor = clamp(this.noiseFloor + clamp(rms - this.noiseFloor, -step, step), 0.00001, 0.014);
                }
                const cleanTone = freq > 0 && clarity >= 0.85 && rms > Math.max(this.threshold, this.noiseFloor * 4);
                if (cleanTone && this.lastFreq > 0 && Math.abs(12 * Math.log2(freq / this.lastFreq)) < 0.3 && dt) this.toneMs += dt;
                else this.toneMs = 0;
                this.lastFreq = cleanTone ? freq : 0;
                if (this.toneMs >= 200) {
                    const desired = clamp(Math.min(0.06 / rms, 0.8 / Math.max(peak, 0.001)), 1, 4);
                    const step = dt / 1000 * 0.5;
                    this.gain += clamp(desired - this.gain, -step, step);
                }
                if (peak * this.gain > 0.9) this.gain = Math.max(1, 0.8 / peak);
            }
            return { blocked: false, reason: null };
        }
    }
    return { Controller, levels };
});
