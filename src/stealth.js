'use strict';

// Stealth layer for pwterm.
//
// Stock Playwright + Chromium leaks a handful of automation tells:
// navigator.webdriver === true, a "HeadlessChrome" UA in headless mode,
// and SwiftShader WebGL rendering in headless. Real anti-detect projects
// (CloakBrowser et al.) fix these by recompiling Chromium with C++ patches
// — not possible from a Node CLI, and not possible on a phone. What CAN
// be fixed from here:
//
//   launch flags     --disable-blink-features=AutomationControlled stops
//                    Chromium flagging contexts as automated; drop
//                    --enable-automation if something upstream adds it.
//   init script      patches for the webdriver flag, the WebRTC/
//                    permissions mismatch, and headless WebGL software
//                    rendering. Small and tested (tests/stealth.spec.js).
//   headless UA      the binary reports "HeadlessChrome/<ver>" when
//                    headless; we ask it for its real version and present
//                    as plain Chrome.
//
// Deliberately NOT spoofed: plugins, mimeTypes, window.chrome, languages
// are already correct in modern headless Chromium — faking them caused
// more mismatches (instanceof/toString checks) than it fixed. GPU, screen,
// and platform stay as the real values too (pass-through > incoherent
// spoofing).

const { spawnSync } = require('child_process');

const STEALTH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-first-run',
  '--no-default-browser-check',
];

const IGNORE_DEFAULT_ARGS = ['--enable-automation'];

function enabled(options = {}) {
  if (process.env.PWTERM_NO_STEALTH) return false;
  return options.stealth !== false;
}

// Runs in every document of every context this browser creates. No
// backticks inside — the payload itself is a template literal here.
const INIT_SCRIPT = `(() => {
  'use strict';

  const shim = (fn) => fn; // tagged for the toString guard below

  // --- Function.prototype.toString guard -------------------------------
  const nativeToString = Function.prototype.toString;
  const shimmed = new Set();
  const toStringShim = shim(function toString() {
    if (shimmed.has(this)) return 'function ' + (this.name || '') + '() { [native code] }';
    return nativeToString.call(this);
  });
  shimmed.add(toStringShim);
  Function.prototype.toString = toStringShim;

  // --- navigator.webdriver ----------------------------------------------
  // Patch the prototype (like real Chrome), NOT the instance: lodash's
  // _.has(navigator, 'webdriver') only finds own properties.
  const navProto = Object.getPrototypeOf(navigator);
  if (navProto) {
    try { delete navProto.webdriver; } catch (e) {}
    try {
      Object.defineProperty(navProto, 'webdriver', { get: () => false, configurable: true });
    } catch (e) { /* non-configurable: the launch flag already disabled it */ }
  }

  // --- permissions --------------------------------------------------------
  // The classic leak: querying notification permission while it is still
  // "prompt" throws instead of resolving.
  if (window.Notification && navigator.permissions) {
    const permProto = Object.getPrototypeOf(navigator.permissions);
    if (permProto && typeof permProto.query === 'function') {
      const origQuery = permProto.query;
      permProto.query = shim(function query(params) {
        if (params && params.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission, onchange: null });
        }
        return origQuery.call(this, params);
      });
    }
  }

  // --- WebGL ---------------------------------------------------------------
  // Only touch it when headless really is leaking (SwiftShader / llvmpipe);
  // real GPUs pass through untouched.
  const swRenderer = /swiftshader|llvmpipe|software/i;
  const patchGetParameter = (proto) => {
    if (!proto || typeof proto.getParameter !== 'function') return;
    const orig = proto.getParameter;
    proto.getParameter = shim(function getParameter(p) {
      if (p === 37445) { // UNMASKED_VENDOR_WEBGL
        const v = orig.call(this, p);
        return swRenderer.test(String(v)) ? 'Intel Inc.' : v;
      }
      if (p === 37446) { // UNMASKED_RENDERER_WEBGL
        const v = orig.call(this, p);
        return swRenderer.test(String(v)) ? 'Intel(R) UHD Graphics 630' : v;
      }
      return orig.call(this, p);
    });
  };
  if (window.WebGLRenderingContext) patchGetParameter(window.WebGLRenderingContext.prototype);
  if (window.WebGL2RenderingContext) patchGetParameter(window.WebGL2RenderingContext.prototype);
})();`;

// Ask the real binary for its version so the headless UA keeps the exact
// build number — a mismatched version is its own fingerprint.
let cachedUa = null;
function headlessUserAgent(executablePath) {
  if (cachedUa !== null) return cachedUa;
  try {
    const result = spawnSync(executablePath, ['--version'], {
      timeout: 8000,
      encoding: 'utf8',
    });
    const version = String(result.stdout || '').match(/\d+(?:\.\d+)+/);
    cachedUa = version
      ? `Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version[0]} Safari/537.36`
      : null;
  } catch {
    cachedUa = null;
  }
  return cachedUa;
}

// Extra launch options for a stealth browser, composed with the caller's
// own args/userAgent.
function launchOptions(options = {}) {
  const args = [...STEALTH_ARGS, ...(options.args || [])];
  const out = { args, ignoreDefaultArgs: IGNORE_DEFAULT_ARGS };

  // Only mask the UA when we are leaking it (headless) and the caller is
  // not managing it themselves.
  if (options.headless !== false && !options.userAgent && options.executablePath) {
    const ua = headlessUserAgent(options.executablePath);
    if (ua) args.push(`--user-agent=${ua}`);
  }
  return out;
}

// Wire every context of a launched browser: new contexts (including ones
// created later, like the REPL's) get the init script.
function harden(browser) {
  browser.on('context', (context) => {
    context.addInitScript(INIT_SCRIPT).catch(() => {});
  });
}

module.exports = {
  STEALTH_ARGS,
  IGNORE_DEFAULT_ARGS,
  INIT_SCRIPT,
  enabled,
  harden,
  launchOptions,
};
