const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const names = ['isIOSDevice', 'updateImmersiveViewport', 'syncFullscreenUI', 'toggleFullScreenMode', 'setupFullscreen'];
const source = names.map(name => {
    const match = html.match(new RegExp(`^        function ${name}\\([^]*?^        }`, 'm'));
    assert.ok(match, name);
    return match[0];
}).join('\n');

function harness(navigator = { userAgent: 'Desktop', platform: 'Win32', maxTouchPoints: 0 }) {
    const events = {}, windowEvents = {}, viewportEvents = {}, styles = {}, classes = new Set();
    const icon = {}, button = { setAttribute: (name, value) => { button[name] = value; } };
    const body = {
        style: { setProperty: (name, value) => { styles[name] = value; }, removeProperty: name => { delete styles[name]; } },
        classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) }
    };
    const document = {
        body, documentElement: {}, fullscreenElement: null,
        getElementById: id => id === 'fullscreenIcon' ? icon : button,
        addEventListener: (name, fn, options) => { events[name] = { fn, options }; }
    };
    const window = {
        innerHeight: 720,
        visualViewport: { height: 680, addEventListener: (name, fn) => { viewportEvents[name] = fn; } },
        addEventListener: (name, fn) => { windowEvents[name] = fn; },
        getComputedStyle: el => el.style || { overflowX: 'visible', overflowY: 'visible' }
    };
    let resizes = 0;
    const context = vm.createContext({
        navigator, document, window, state: { isImmersiveFallback: false },
        setTimeout: fn => fn(), resizeSheetCanvas: () => { resizes++; }
    });
    vm.runInContext(source, context);
    return { context, document, window, events, windowEvents, viewportEvents, styles, classes, icon, button, get resizes() { return resizes; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('iOS and desktop-UA iPad never call either native request; toggle restores faux state', () => {
    for (const navigator of [
        { userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5 },
        { userAgent: 'iPad', platform: 'iPad', maxTouchPoints: 5 },
        { userAgent: 'iPod', platform: 'iPod', maxTouchPoints: 5 },
        { userAgent: 'Mozilla Macintosh Safari', platform: 'MacIntel', maxTouchPoints: 5 }
    ]) {
        const h = harness(navigator);
        let nativeCalls = 0;
        h.document.documentElement.requestFullscreen = h.document.documentElement.webkitRequestFullscreen = () => { nativeCalls++; };
        h.context.setupFullscreen();
        h.context.toggleFullScreenMode();
        assert.equal(nativeCalls, 0);
        assert.equal(h.context.state.isImmersiveFallback, true);
        assert.ok(h.classes.has('immersive-mode'));
        assert.equal(h.styles['--immersive-height'], '680px');
        assert.equal(h.button['aria-pressed'], 'true');
        h.context.toggleFullScreenMode();
        assert.equal(h.context.state.isImmersiveFallback, false);
        assert.equal(h.classes.size, 0);
        assert.equal(h.styles['--immersive-height'], undefined);
        assert.equal(h.button['aria-pressed'], 'false');
        assert.equal(h.icon.textContent, '⛶');
    }
});

test('desktop native promise and legacy void APIs work; browser Escape updates UI', async () => {
    for (const legacy of [false, true]) {
        const h = harness({ userAgent: 'Macintosh Safari', platform: 'MacIntel', maxTouchPoints: 0 });
        const prop = legacy ? 'webkitFullscreenElement' : 'fullscreenElement';
        h.document.documentElement[legacy ? 'webkitRequestFullscreen' : 'requestFullscreen'] = function () {
            assert.equal(this, h.document.documentElement);
            h.document[prop] = this;
            return legacy ? undefined : Promise.resolve();
        };
        h.document[legacy ? 'webkitExitFullscreen' : 'exitFullscreen'] = function () {
            assert.equal(this, h.document);
            h.document[prop] = null;
            return legacy ? undefined : Promise.resolve();
        };
        h.context.setupFullscreen();
        h.context.toggleFullScreenMode();
        await settle();
        assert.equal(h.button['aria-pressed'], 'true');
        assert.equal(h.classes.size, 0);
        h.context.toggleFullScreenMode();
        await settle();
        assert.equal(h.button['aria-pressed'], 'false');
        h.context.toggleFullScreenMode();
        await settle();
        h.document[prop] = null;
        h.events[legacy ? 'webkitfullscreenchange' : 'fullscreenchange'].fn();
        assert.equal(h.icon.textContent, '⛶');
        assert.equal(h.button['aria-pressed'], 'false');
    }
});

test('missing, rejected and synchronously throwing APIs enter fallback', async () => {
    for (const request of [undefined, () => Promise.reject(new Error('Denied')), () => { throw new Error('Denied'); }]) {
        const h = harness();
        h.document.documentElement.requestFullscreen = request;
        h.context.toggleFullScreenMode();
        await settle();
        assert.equal(h.context.state.isImmersiveFallback, true);
        assert.ok(h.classes.has('immersive-mode'));
    }
});

test('failed native exit leaves active UI; viewport resize updates only faux height', async () => {
    const h = harness();
    h.context.setupFullscreen();
    h.document.fullscreenElement = h.document.documentElement;
    h.document.exitFullscreen = () => Promise.reject(new Error('Denied'));
    h.context.toggleFullScreenMode();
    await settle();
    assert.equal(h.button['aria-pressed'], 'true');
    h.document.fullscreenElement = null;
    h.context.toggleFullScreenMode();
    h.window.visualViewport.height = 512;
    h.viewportEvents.resize();
    assert.equal(h.styles['--immersive-height'], '512px');
    h.window.visualViewport = null;
    h.windowEvents.resize();
    assert.equal(h.styles['--immersive-height'], '720px');
    h.context.toggleFullScreenMode();
    h.windowEvents.resize();
    assert.equal(h.styles['--immersive-height'], undefined);
});

test('Safari touch guard blocks background and scroll edges but preserves internal scrolling and controls', () => {
    const h = harness({ userAgent: 'iPad', platform: 'iPad', maxTouchPoints: 5 });
    h.context.setupFullscreen();
    assert.equal(h.events.touchmove.options.passive, false);
    h.context.toggleFullScreenMode();
    const target = {
        parentElement: h.document.body, closest: () => null,
        style: { overflowX: 'auto', overflowY: 'auto' },
        scrollTop: 50, scrollHeight: 300, clientHeight: 100,
        scrollLeft: 50, scrollWidth: 300, clientWidth: 100
    };
    function drag(dx, dy, touches = 1) {
        let prevented = false;
        h.events.touchstart.fn({ touches: [{ clientX: 100, clientY: 100 }] });
        h.events.touchmove.fn({ target, cancelable: true,
            touches: Array.from({ length: touches }, () => ({ clientX: 100 - dx, clientY: 100 - dy })),
            preventDefault: () => { prevented = true; }
        });
        return prevented;
    }
    assert.equal(drag(0, 20), false);
    assert.equal(drag(20, 0), false);
    target.scrollTop = 0;
    assert.equal(drag(0, -20), true);
    assert.equal(drag(0, 20), false);
    target.scrollTop = 200;
    assert.equal(drag(0, 20), true);
    target.scrollLeft = 0;
    assert.equal(drag(-20, 0), true);
    target.scrollLeft = 200;
    assert.equal(drag(20, 0), true);
    target.style = { overflowX: 'visible', overflowY: 'visible' };
    assert.equal(drag(0, 20), true);
    target.closest = () => ({});
    assert.equal(drag(0, 20), false);
    assert.equal(drag(0, 20, 2), false);
    target.closest = () => null;
    h.context.toggleFullScreenMode();
    assert.equal(drag(0, 20), false);
});

test('Web Clip metadata, legacy height fallback and safe areas remain configured', () => {
    assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
    assert.match(html, /name="apple-mobile-web-app-status-bar-style" content="black-translucent"/);
    assert.match(html, /name="viewport"[^>]*viewport-fit=cover/);
    assert.match(html, /height: 100%;\s+height: 100dvh;/);
    for (const edge of ['top', 'right', 'bottom', 'left']) assert.ok(html.includes(`env(safe-area-inset-${edge}, 0px)`));
    assert.match(html, /body\.immersive-mode\s*\{[^}]*position: fixed;[^}]*overflow: hidden;[^}]*z-index: 99999;/);
    assert.match(html, /body\.immersive-mode #topStatsRow \{ display: none !important; \}/);
    assert.match(html, /setupPracticeControls\(\);\s+setupFullscreen\(\);/);
});
