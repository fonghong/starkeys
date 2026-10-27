const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('theme choice controls Tailwind variants and native controls', async () => {
    const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
    assert.match(html, /tailwind\.config = \{ darkMode: 'class' \}/);
    assert.match(html, /html\.light \{ color-scheme: light; \}/);
    assert.match(html, /html\.dark \{ color-scheme: dark; \}/);
});

test('browser: all modal surfaces, generated cards and theme round trips', {
    skip: !process.env.THEME_TEST_BROWSER && 'Set THEME_TEST_BROWSER to a Chromium/Edge executable (Node 22+).',
    timeout: 90000
}, async () => {
    assert.equal(typeof WebSocket, 'function', 'Browser test requires Node 22+');
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'starkeys-theme-'));
    const files = new Set(['index.html', 'microphone-auto.js', 'local-sheet-recognition.js', 'piano-curriculum.js']);
    const server = http.createServer(async (req, res) => {
        const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
        if (!files.has(name)) { res.writeHead(404).end(); return; }
        try {
            res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
            res.end(await fs.readFile(path.join(root, name)));
        } catch { res.writeHead(500).end(); }
    });
    let browser, socket;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = spawn(process.env.THEME_TEST_BROWSER, [
            '--headless=new', '--no-first-run', '--no-default-browser-check',
            '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
        ], { stdio: 'ignore' });
        let launchError;
        browser.on('error', error => { launchError = error; });
        let port;
        for (let i = 0; i < 100; i++) {
            if (launchError) throw launchError;
            try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
            catch { await pause(100); }
        }
        assert.ok(port, 'Browser debugging endpoint started');
        const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
        let nextId = 0;
        const pending = new Map();
        socket.onmessage = event => {
            const message = JSON.parse(event.data);
            if (!pending.has(message.id)) return;
            const { resolve, reject, timer } = pending.get(message.id);
            clearTimeout(timer);
            pending.delete(message.id);
            if (message.error) reject(new Error(JSON.stringify(message.error)));
            else resolve(message.result);
        };
        const send = (method, params = {}) => new Promise((resolve, reject) => {
            const id = ++nextId;
            const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 15000);
            pending.set(id, { resolve, reject, timer });
            socket.send(JSON.stringify({ id, method, params }));
        });
        const evaluate = async expression => {
            const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
            return result.result.value;
        };
        await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
        await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
        let ready = false;
        for (let i = 0; i < 100; i++) {
            ready = await evaluate(`typeof state !== 'undefined' && typeof tailwind !== 'undefined' && document.querySelector('#pianoKeyboard .black-key') !== null && getComputedStyle(document.querySelector('#toggleMicBtn')).backgroundColor === 'rgb(37, 99, 235)'`);
            if (ready) break;
            await pause(200);
        }
        assert.ok(ready, 'App and Tailwind CDN loaded');
        const render = `
            state.uploadedSheetPages = [{ dataUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="80"><rect width="64" height="80" fill="white"/></svg>') }];
            renderUploadedSheetPagesUI();
            renderCourseMapModal(); renderSavedCustomSongsList(); renderProfileModal(); renderChordDojoModal();
        `;
        // Occluded elements can defer transitions in headless Chromium; assert final palettes, not animation frames.
        const settleStyles = `(() => { const style = document.createElement('style'); style.textContent = '* { transition: none !important; animation: none !important; }'; document.head.appendChild(style); })()`;
        await evaluate(settleStyles);
        await evaluate(`state.profiles[state.activeProfileId].history = [{ songTitle: 'Theme fixture', accuracy: 90, score: 100, passed: true }];
            state.profiles[state.activeProfileId].badges = [ACHIEVEMENTS_DEF[0].id];
            state.profiles.other = { id: 'other', name: 'Other', history: [], badges: [] };
            ${render}`);
        const snapshot = `JSON.stringify(Array.from(document.querySelectorAll('body, .theme-modal, .theme-modal *, #pianoKeyboard, #pianoKeyboard *')).map(el => {
            const c = getComputedStyle(el); return [c.backgroundColor, c.color, c.borderColor, c.opacity];
        }))`;
        await pause(300);
        const dark = await evaluate(snapshot);
        const piano = await evaluate(`getComputedStyle(document.querySelector('.black-key')).backgroundColor`);
        for (const width of [1280, 390]) {
            await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
            await evaluate(`applyTheme('light'); ${render}
                document.querySelectorAll('.theme-modal').forEach(el => el.parentElement.classList.remove('hidden'));
                document.getElementById('micSetupModal').classList.remove('hidden');
                renderMicDiagnosticVisualizer(new Float32Array(512), 0, 0.01, null, -1);`);
            await pause(300);
            const failures = await evaluate(`(() => {
                const failures = [];
                const rgb = color => (color.match(/[\\d.]+/g) || []).map(Number);
                const luminance = color => rgb(color).slice(0, 3).reduce((sum, value, i) => {
                    value /= 255; return sum + [0.2126, 0.7152, 0.0722][i] * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
                }, 0);
                for (const el of document.querySelectorAll('body *')) {
                    if (el.closest('#pianoKeyboard') || el.matches('.fixed.inset-0')) continue;
                    const c = getComputedStyle(el);
                    const name = el.id || el.className;
                    if (Array.from(el.classList).some(x => /^bg-(slate-[89]00|slate-950|(?:indigo|blue|emerald|red)-950)(\\/|$)/.test(x))) {
                        if (luminance(c.backgroundColor) < 0.6) failures.push('Dark surface: ' + name + ' ' + c.backgroundColor);
                    }
                    if (el.matches('.theme-modal h3, .theme-modal h4, .theme-text-main, .theme-modal input:not([type=range]), .theme-modal select') && luminance(c.color) > 0.15) failures.push('Pale title/input: ' + name);
                    if (el.matches('.theme-locked') && c.opacity !== '1') failures.push('Faded locked card: ' + name);
                }
                const background = el => {
                    let colour = [255, 255, 255];
                    const layers = [];
                    for (let node = el; node; node = node.parentElement) layers.unshift(rgb(getComputedStyle(node).backgroundColor));
                    for (const layer of layers) {
                        const alpha = layer[3] ?? 1;
                        colour = colour.map((value, i) => layer[i] * alpha + value * (1 - alpha));
                    }
                    return 'rgb(' + colour.join(',') + ')';
                };
                for (const el of document.querySelectorAll('body *')) {
                    if (!Array.from(el.childNodes).some(node => node.nodeType === 3 && node.textContent.trim())) continue;
                    if (el.closest('#pianoKeyboard, button.text-white:not(#replayStageBtn), label.text-white, script, style, option, .sr-only')) continue;
                    if (!el.getClientRects().length) continue;
                    const c = getComputedStyle(el);
                    const fg = luminance(c.color), bg = luminance(background(el));
                    const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
                    const large = parseFloat(c.fontSize) >= 24 || (parseFloat(c.fontSize) >= 18.66 && Number(c.fontWeight) >= 700);
                    if (ratio < (large ? 3 : 4.5)) failures.push('Low text contrast: ' + (el.id || el.className) + ' ' + ratio.toFixed(2));
                }
                for (const selector of ['#nextStageBtn', '#saveAndPlayCustomSongBtn', '.select-stage-btn', '.play-custom-btn', '.start-dojo-btn', 'label[for=cameraSheetInput]']) {
                    const el = document.querySelector(selector);
                    if (!el || getComputedStyle(el).color !== 'rgb(255, 255, 255)') failures.push('Primary action text: ' + selector);
                }
                if (getComputedStyle(document.documentElement).colorScheme !== 'light') failures.push('Native theme');
                if (getComputedStyle(document.querySelector('.black-key')).backgroundColor !== ${JSON.stringify(piano)}) failures.push('Piano colour changed');
                return failures;
            })()`);
            assert.deepEqual(failures, [], `Light theme at ${width}px`);
            assert.deepEqual(await evaluate(`(() => {
                return [[0, null], [0.1, null], [0.1, 'voice']].map(([rms, reason]) => {
                    renderMicDiagnosticVisualizer(new Float32Array(256), rms, 0.02, null, 0, 0, reason);
                    return document.getElementById('micVisualizerCanvas').getContext('2d').strokeStyle;
                });
            })()`), ['#92400e', '#047857', '#7e22ce']);
        }
        await evaluate(`applyTheme('dark'); ${render}`);
        await pause(300);
        // Restore dynamic diagnostic defaults before comparing the unchanged modal/card palette.
        await evaluate('window.themeTestReloading = true');
        await send('Page.reload');
        let reloaded = false;
        for (let i = 0; i < 100; i++) {
            reloaded = await evaluate(`!window.themeTestReloading && typeof state !== 'undefined' && document.querySelector('#pianoKeyboard .black-key') !== null && getComputedStyle(document.querySelector('#toggleMicBtn')).backgroundColor === 'rgb(37, 99, 235)'`);
            if (reloaded) break;
            await pause(100);
        }
        assert.ok(reloaded, 'Reloaded app and Tailwind styles ready');
        await evaluate(settleStyles);
        await evaluate(render);
        await pause(500);
        assert.equal(await evaluate(snapshot), dark, 'Dark colours restored after persisted theme round trip');
        await evaluate(`applyTheme('light'); window.themeTestReloading = true;`);
        await send('Page.reload');
        let persisted = false;
        for (let i = 0; i < 100; i++) {
            persisted = await evaluate(`!window.themeTestReloading && typeof state !== 'undefined' && state.theme === 'light' && document.documentElement.classList.contains('light')`);
            if (persisted) break;
            await pause(100);
        }
        assert.ok(persisted, 'Light theme persists on reload');
    } finally {
        if (socket) socket.close();
        if (browser && browser.exitCode === null) {
            const exited = new Promise(resolve => browser.once('exit', resolve));
            browser.kill();
            await exited;
        }
        await new Promise(resolve => server.close(resolve));
        for (let i = 0; i < 20; i++) {
            try { await fs.rm(profile, { recursive: true, force: true }); break; }
            catch (error) { if (i === 19) throw error; await pause(250); }
        }
    }
});
