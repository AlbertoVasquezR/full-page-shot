import { attach, detach, evaluate, sendCommand } from "./cdp";
import type { Debuggee } from "./cdp";
import type { CaptureMode, ProgressStage, Settings } from "./types";
import { base64ToBlob, blobToBase64, describeError } from "./util";

/**
 * Altura hasta la que se intenta una captura unica. Es un limite real de Chrome:
 * a traves de chrome.debugger, una captura de mas de ~16384 px falla con
 * "Unable to capture screenshot", asi que por encima de esto se va por segmentos.
 */
const MAX_SINGLE_SHOT_HEIGHT = 16000;
/** Limite prudente del lienzo de Chromium para unir segmentos. */
const MAX_CANVAS_DIM = 30000;
/** Presupuesto de pixeles del lienzo final (~160 MB en RGBA). */
const MAX_CANVAS_PIXELS = 40_000_000;

export class CaptureError extends Error {
  readonly hint: string;

  constructor(message: string, hint = "") {
    super(message);
    this.name = "CaptureError";
    this.hint = hint;
  }
}

export interface CaptureOutput {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
  /** true si hubo que reducir la resolucion para que cupiera en el lienzo. */
  downscaled: boolean;
  url: string;
  title: string;
}

export type ProgressFn = (stage: ProgressStage, percent: number, detail: string) => void;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Region a capturar; `scale` la acepta el protocolo como factor de zoom. */
interface Clip extends Rect {
  scale: number;
}

interface LayoutMetrics {
  cssContentSize?: Rect;
  contentSize?: Rect;
  cssVisualViewport?: { clientWidth?: number; clientHeight?: number };
  visualViewport?: { clientWidth?: number; clientHeight?: number };
}

interface Slice {
  base64: string;
  y: number;
  height: number;
}

function mimeFor(settings: Settings): string {
  return settings.format === "jpeg" ? "image/jpeg" : "image/png";
}

/** Traduce los errores cripticos del depurador a algo que el usuario pueda accionar. */
export function friendlyError(error: unknown): CaptureError {
  if (error instanceof CaptureError) return error;
  const raw = describeError(error);
  const message = raw.toLowerCase();

  if (message.includes("another debugger")) {
    return new CaptureError(
      "A debugger is already attached to this tab.",
      "Close DevTools (F12) on that tab and try again.",
    );
  }
  if (message.includes("restricted by policy")) {
    return new CaptureError(
      "Screenshot capture is blocked by your organization's policy.",
      "Ask your administrator to enable screenshot capture in Edge.",
    );
  }
  if (
    message.includes("cannot attach") ||
    message.includes("cannot access") ||
    message.includes("chrome://") ||
    message.includes("edge://") ||
    message.includes("extension://")
  ) {
    return new CaptureError(
      "Edge won't capture this page.",
      "Doesn't work on internal pages (edge://, chrome://), the extensions store, new tabs or local files. Use a normal web page (http or https).",
    );
  }
  if (message.includes("no tab with id") || message.includes("no window with id")) {
    return new CaptureError(
      "The tab is no longer available.",
      "Reopen the page you wanted to capture and try again.",
    );
  }
  return new CaptureError("Could not complete the capture.", raw);
}

/** Recorre la pagina de arriba a abajo para disparar el lazy loading y vuelve al inicio. */
const LAZY_LOAD_SCRIPT = `new Promise(function (resolve) {
  function scroller() {
    if (document.body && document.body.scrollHeight > document.body.clientHeight + 1) return document.body;
    if (document.documentElement.scrollHeight > document.documentElement.clientHeight + 1) return document.documentElement;
    var best = null;
    var nodes = document.querySelectorAll('*');
    var limit = Math.min(nodes.length, 4000);
    for (var i = 0; i < limit; i++) {
      var n = nodes[i];
      var cs = getComputedStyle(n);
      if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
        if (n.scrollHeight > n.clientHeight + 50) {
          if (!best || n.scrollHeight > best.scrollHeight) best = n;
        }
      }
    }
    return best || document.documentElement;
  }
  var doc = scroller();
  var step = Math.max(240, Math.floor((doc.clientHeight || window.innerHeight || 800) * 0.85));
  var guard = 0;

  function waitForImages() {
    var pending = Array.prototype.slice.call(document.images).filter(function (img) {
      return !img.complete;
    });
    if (pending.length === 0) return Promise.resolve();
    return Promise.all(pending.map(function (img) {
      return new Promise(function (done) {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        setTimeout(done, 3000);
      });
    }));
  }

  (async function () {
    try {
      var y = 0;
      while (y < doc.scrollHeight && guard < 500) {
        doc.scrollTop = y;
        try { if (doc === document.documentElement || doc === document.body) window.scrollTo(0, y); } catch (e) {}
        await new Promise(function (r) { setTimeout(r, 90); });
        y += step;
        guard += 1;
      }
      doc.scrollTop = doc.scrollHeight;
      try { if (doc === document.documentElement || doc === document.body) window.scrollTo(0, doc.scrollHeight); } catch (e) {}
      await new Promise(function (r) { setTimeout(r, 250); });
      doc.scrollTop = 0;
      try { if (doc === document.documentElement || doc === document.body) window.scrollTo(0, 0); } catch (e) {}
      await waitForImages();
      await new Promise(function (r) { setTimeout(r, 250); });
      resolve(true);
    } catch (error) {
      resolve(false);
    }
  })();
})`;

async function runLazyLoadPass(target: Debuggee): Promise<void> {
  try {
    await evaluate<boolean>(target, LAZY_LOAD_SCRIPT);
  } catch {
    // If the page blocks execution, continue with the capture as is.
  }
}

/** Posicion vertical actual del contenedor principal desplazable. */
async function getScrollY(target: Debuggee): Promise<number> {
  try {
    const value = await evaluate<number>(target, `(function () {
      // recompute scroller and read scrollTop
      function scroller() {
        if (document.body && document.body.scrollHeight > document.body.clientHeight + 1) return document.body;
        if (document.documentElement.scrollHeight > document.documentElement.clientHeight + 1) return document.documentElement;
        var best = null;
        var nodes = document.querySelectorAll('*');
        var limit = Math.min(nodes.length, 4000);
        for (var i = 0; i < limit; i++) {
          var n = nodes[i];
          var cs = getComputedStyle(n);
          if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
            if (n.scrollHeight > n.clientHeight + 50) {
              if (!best || n.scrollHeight > best.scrollHeight) best = n;
            }
          }
        }
        return best || document.documentElement;
      }
      return scroller().scrollTop || 0;
    })()`);
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

async function scrollTo(target: Debuggee, y: number): Promise<void> {
  const yy = Math.max(0, Math.round(y));
  try {
    await evaluate<boolean>(target, `(function () {
      function scroller() {
        if (document.body && document.body.scrollHeight > document.body.clientHeight + 1) return document.body;
        if (document.documentElement.scrollHeight > document.documentElement.clientHeight + 1) return document.documentElement;
        var best = null;
        var nodes = document.querySelectorAll('*');
        var limit = Math.min(nodes.length, 4000);
        for (var i = 0; i < limit; i++) {
          var n = nodes[i];
          var cs = getComputedStyle(n);
          if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
            if (n.scrollHeight > n.clientHeight + 50) {
              if (!best || n.scrollHeight > best.scrollHeight) best = n;
            }
          }
        }
        return best || document.documentElement;
      }
      var s = scroller();
      s.scrollTop = ${yy};
      try { if (s === document.documentElement || s === document.body) window.scrollTo(0, ${yy}); } catch (e) {}
      return true;
    })()`);
  } catch {
    // If the page blocks execution, the capture is still attempted.
  }
}

/**
 * Espera a que la pagina pinte el fotograma tras un desplazamiento. Dos
 * requestAnimationFrame garantizan que el compositor ya compuso la nueva
 * posicion; el timeout corto cubre imagenes que se decodifican un instante
 * despues. Un tope de seguridad evita quedarse colgado si la pagina nunca pinta.
 */
const SETTLE_SCRIPT = `new Promise(function (resolve) {
  var done = false;
  function finish() { if (done) return; done = true; resolve(true); }
  try {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { setTimeout(finish, 120); });
    });
  } catch (error) { finish(); }
  setTimeout(finish, 900);
})`;

async function settle(target: Debuggee): Promise<void> {
  try {
    await evaluate<boolean>(target, SETTLE_SCRIPT);
  } catch {
    // If the page blocks execution, the capture proceeds anyway.
  }
}

/**
 * Heuristica que decide si la pagina carga contenido al desplazarse y por tanto
 * conviene el recorrido por scroll. No es infalible, pero cubre los casos
 * habituales (imagenes con carga diferida, render diferido por CSS,
 * animaciones al entrar en vista) sin coste apreciable.
 */
const DETECT_DYNAMIC_SCRIPT = `(async function () {
  try {
    var score = 0;
    var signals = [];

    // 1) Images with declared lazy loading.
    var lazy = document.querySelectorAll(
      'img[loading="lazy"],img[data-src],img[data-srcset],img[data-lazy],img[data-original],img[data-lazy-src],iframe[loading="lazy"],iframe[data-src],source[data-srcset]'
    ).length;
    if (lazy > 0) { score += 3; signals.push('lazy:' + lazy); }

    // 2) Images still not loaded (several, not just one).
    var pending = 0;
    var images = document.images;
    for (var i = 0; i < images.length; i++) { if (!images[i].complete) pending += 1; }
    if (pending > 3) { score += 1; signals.push('pendientes:' + pending); }

    // 3) Content with deferred rendering via CSS.
    var deferred = 0;
    var all = document.querySelectorAll('body *');
    var limit = Math.min(all.length, 3000);
    for (var j = 0; j < limit; j++) {
      var style = getComputedStyle(all[j]);
      if (style.contentVisibility === 'auto') { deferred += 1; if (deferred > 2) break; }
    }
    if (deferred > 0) { score += 3; signals.push('content-visibility:' + deferred); }

    // 4) Animaciones al entrar en vista (bibliotecas conocidas).
    if (document.querySelector('[data-aos],[data-wow],[data-animate],[data-scroll],[class*="reveal"],[class*="animate-"]')) {
      score += 2; signals.push('reveal');
    }

    // 5) Containers that scroll internally (the real page is a div).
    var scrollContainers = 0;
    var nodes = document.querySelectorAll('body *');
    var nlimit = Math.min(nodes.length, 4000);
    for (var k = 0; k < nlimit; k++) {
      var n = nodes[k];
      var cs = getComputedStyle(n);
      if (cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflow === 'auto' || cs.overflow === 'scroll') {
        if (n.scrollHeight > n.clientHeight + 50) { scrollContainers += 1; if (scrollContainers > 3) break; }
      }
    }
    if (scrollContainers > 0) { score += 3; signals.push('scroll-containers:' + scrollContainers); }

    // 6) Scroll-driven layout (snap).
    var snap = document.querySelector('[style*="scroll-snap"], [class*="snap"]') ? 1 : 0;
    // also check computed style of html/body and containers with snap
    if (!snap) {
      var snapNodes = document.querySelectorAll('body *');
      var slimit = Math.min(snapNodes.length, 2000);
      for (var s = 0; s < slimit; s++) {
        var ss = getComputedStyle(snapNodes[s]);
        if (ss.scrollSnapType && ss.scrollSnapType !== 'none') { snap = 1; break; }
      }
    }
    if (snap > 0) { score += 2; signals.push('scroll-snap'); }

    // 7) Iframes (especially those that load on scroll or are large).
    var iframes = document.querySelectorAll('iframe');
    var heavyIframes = 0;
    for (var f = 0; f < iframes.length; f++) {
      var fr = iframes[f];
      var rect = fr.getBoundingClientRect();
      if (rect.height > 200 || fr.hasAttribute('loading') || fr.hasAttribute('data-src')) heavyIframes += 1;
    }
    if (heavyIframes > 0) { score += 2; signals.push('iframes:' + heavyIframes); }

    // 8) Virtualized content: many direct children in a container with
    //    hidden or auto overflow and fixed height (virtualized list pattern).
    var virtualized = 0;
    var vNodes = document.querySelectorAll('body *');
    var vlimit = Math.min(vNodes.length, 2000);
    for (var v = 0; v < vlimit; v++) {
      var vn = vNodes[v];
      var vcs = getComputedStyle(vn);
      var childCount = vn.childElementCount;
      if (childCount >= 50 && (vcs.overflowY === 'auto' || vcs.overflowY === 'scroll' || vcs.overflowY === 'hidden')) {
        if (vn.clientHeight > 0 && vn.clientHeight < vn.scrollHeight) { virtualized += 1; if (virtualized > 2) break; }
      }
    }
    if (virtualized > 0) { score += 3; signals.push('virtualized:' + virtualized); }

    // 9) Lazy-loaded background images.
    var lazyBg = document.querySelectorAll('[data-background],[data-bg],[data-lazy-bg],[data-lazy-background]').length;
    if (lazyBg > 0) { score += 2; signals.push('lazy-bg:' + lazyBg); }

    // 10) Smooth scroll behavior.
    var smooth = 0;
    try {
      if (getComputedStyle(document.documentElement).scrollBehavior === 'smooth' ||
          getComputedStyle(document.body).scrollBehavior === 'smooth') smooth = 1;
    } catch (e) { smooth = 0; }
    if (smooth > 0) { score += 1; signals.push('smooth-scroll'); }

    // 11) will-change on several elements.
    var willChange = 0;
    var wcNodes = document.querySelectorAll('body *');
    var wlimit = Math.min(wcNodes.length, 2000);
    for (var w = 0; w < wlimit; w++) {
      var wcs = getComputedStyle(wcNodes[w]).willChange;
      if (wcs && wcs !== 'auto' && wcs !== 'normal') { willChange += 1; if (willChange > 5) break; }
    }
    if (willChange > 5) { score += 1; signals.push('will-change:' + willChange); }

    // 12) Parallax: background-attachment fixed.
    var parallax = 0;
    var pNodes = document.querySelectorAll('body *');
    var plimit = Math.min(pNodes.length, 2000);
    for (var p = 0; p < plimit; p++) {
      if (getComputedStyle(pNodes[p]).backgroundAttachment === 'fixed') { parallax += 1; if (parallax > 2) break; }
    }
    if (parallax > 0) { score += 2; signals.push('parallax:' + parallax); }

    // If the heuristics already decide, the behavioral test is unnecessary.
    if (score >= 3) {
      return { scroll: true, score: score, signals: signals.join(',') };
    }

    // 13) Behavioral test: scroll one viewport, wait and check whether the
    //     page changes (new nodes or visibility classes). The most reliable
    //     signal for pages that animate or load content with IntersectionObserver
    //     without leaving a trace in the initial DOM. Undoes the scroll at the end.
    try {
      var initialCount = document.querySelectorAll('*').length;
      var visibleClassRe = /(visible|active|in-view|inview|shown|animated|revealed|is-visible)/i;
      function countVisible() {
        var n = 0; var els = document.querySelectorAll('body *');
        var l = Math.min(els.length, 5000);
        for (var c = 0; c < l; c++) {
          var cls = els[c].className;
          if (typeof cls === 'string' && visibleClassRe.test(cls)) n += 1;
        }
        return n;
      }
      var initialVisible = countVisible();
      function scroller() {
        if (document.body && document.body.scrollHeight > document.body.clientHeight + 1) return document.body;
        if (document.documentElement.scrollHeight > document.documentElement.clientHeight + 1) return document.documentElement;
        var best = null;
        var nodes = document.querySelectorAll('*');
        var limit = Math.min(nodes.length, 4000);
        for (var i = 0; i < limit; i++) {
          var n = nodes[i];
          var cs = getComputedStyle(n);
          if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
            if (n.scrollHeight > n.clientHeight + 50) {
              if (!best || n.scrollHeight > best.scrollHeight) best = n;
            }
          }
        }
        return best || document.documentElement;
      }
      var sc = scroller();
      var startY = sc.scrollTop || 0;
      var targetY = Math.max(0, Math.round((sc.scrollHeight || 0) / 2));
      sc.scrollTop = targetY;
      try { if (sc === document.documentElement || sc === document.body) window.scrollTo(0, targetY); } catch (e) {}
      await new Promise(function (r) { setTimeout(r, 450); });
      var afterCount = document.querySelectorAll('*').length;
      var afterVisible = countVisible();
      sc.scrollTop = startY;
      try { if (sc === document.documentElement || sc === document.body) window.scrollTo(0, startY); } catch (e) {}
      await new Promise(function (r) { setTimeout(r, 120); });

      if (afterCount - initialCount >= 3) { score += 3; signals.push('nuevos-nodos:' + (afterCount - initialCount)); }
      if (afterVisible - initialVisible >= 1) { score += 3; signals.push('clases-visibilidad:' + (afterVisible - initialVisible)); }
    } catch (e) { /* ignorar */ }

    var scroll = score >= 3;
    return { scroll: scroll, score: score, signals: signals.join(',') || 'none' };
  } catch (error) {
    return { scroll: false, score: 0, signals: 'error' };
  }
})()`;

interface DynamicSignals {
  scroll?: boolean;
  score?: number;
  signals?: string;
  lazy?: number;
  pending?: number;
  deferred?: number;
  reveal?: number;
}

async function detectDynamicContent(target: Debuggee): Promise<DynamicSignals> {
  try {
    const result = await evaluate<DynamicSignals>(target, DETECT_DYNAMIC_SCRIPT);
    return result ?? { scroll: false };
  } catch {
    return { scroll: false };
  }
}

/**
 * Intenta cerrar los banners de cookies/consentimiento mas habituales. No es
 * infalible (cada sitio usa el suyo), pero cubre los grandes proveedores y un
 * par de selectores genericos. Se ejecuta antes de medir/capturar.
 */
const DISMISS_COOKIES_SCRIPT = `(function () {
  var selectors = [
    // OneTrust
    '#onetrust-accept-btn-handler', '#onetrust-reject-all-handler', '.onetrust-close-btn-handler',
    // Cookiebot
    '#CybotCookiebotDialogBodyLevelButtonAccept', '#CybotCookiebotDialogBodyButtonAccept',
    // Didomi
    '#didomi-notice-agree-button', '.didomi-continue-without-agreeing',
    // Quantcast / TCF
    '.qc-cmp2-summary-buttons button[mode="primary"]', '.qc-cmp-button',
    // Generic
    'button[id*="accept" i]', 'button[id*="cookie" i][id*="accept" i]',
    'button[aria-label*="accept" i]', 'button[aria-label*="aceptar" i]',
    'a[id*="accept" i]', '[data-testid*="accept" i]',
  ];
  var clicked = 0;
  for (var i = 0; i < selectors.length; i++) {
    var nodes = document.querySelectorAll(selectors[i]);
    for (var j = 0; j < nodes.length; j++) {
      try { nodes[j].click(); clicked += 1; } catch (e) {}
    }
  }
  return clicked;
})()`;

async function dismissCookieBanners(target: Debuggee): Promise<number> {
  try {
    const count = await evaluate<number>(target, DISMISS_COOKIES_SCRIPT);
    return typeof count === "number" && Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}

/**
 * Fuerza un repintado de la pagina: util para que Canvas/WebGL y animaciones
 * se pinten antes de la captura. Se ejecuta una sola vez al empezar.
 */
const REPAINT_SCRIPT = `(function () {
  try {
    // force reflow
    void document.body.offsetHeight;
    window.dispatchEvent(new Event('resize'));
    // micro-scroll to wake up lazy content and the compositor
    var y = window.scrollY || 0;
    window.scrollTo(0, y + 1);
    window.scrollTo(0, y);
    return true;
  } catch (e) {
    return false;
  }
})()`;

async function repaintPage(target: Debuggee): Promise<void> {
  try {
    await evaluate<boolean>(target, REPAINT_SCRIPT);
    await new Promise((r) => setTimeout(r, 120));
  } catch {
    // Not critical.
  }
}

/**
 * Espera a que los iframes (sobre todo los de otros dominios) terminen de cargar.
 */
const WAIT_IFRAMES_SCRIPT = `new Promise(function (resolve) {
  var iframes = Array.prototype.slice.call(document.querySelectorAll('iframe'));
  if (iframes.length === 0) return resolve(true);
  var pending = iframes.filter(function (f) { return !f.contentDocument || (f.contentDocument && f.contentDocument.readyState !== 'complete'); });
  // Only wait for those declaring lazy loading or visible; 4 s cap.
  var toWait = iframes.slice(0, 20);
  var done = 0;
  var total = toWait.length;
  var finished = false;
  function finish() { if (finished) return; finished = true; resolve(true); }
  setTimeout(finish, 4000);
  toWait.forEach(function (f) {
    try {
      if (f.contentDocument && f.contentDocument.readyState === 'complete') { done += 1; if (done >= total) finish(); return; }
    } catch (e) {}
    f.addEventListener('load', function () { done += 1; if (done >= total) finish(); }, { once: true });
    f.addEventListener('error', function () { done += 1; if (done >= total) finish(); }, { once: true });
  });
  if (toWait.length === 0) finish();
})`;

async function waitForIframes(target: Debuggee): Promise<void> {
  try {
    await evaluate<boolean>(target, WAIT_IFRAMES_SCRIPT);
  } catch {
    // Not critical.
  }
}

/**
 * Prepara la pagina para la captura: espera fuentes, pausa animaciones y transiciones,
 * fuerza content-visibility a visible y elimina containment que podria ocultar contenido.
 * Se restaura al final con RESTORE_PAGE_SCRIPT.
 */
const PREPARE_PAGE_SCRIPT = `(function () {
  try {
    // Save original styles to restore them.
    window.__fpsOriginalStyles = window.__fpsOriginalStyles || new Map();

    // 1) Force content-visibility: visible on all elements.
    var all = document.querySelectorAll('body *');
    var limit = Math.min(all.length, 5000);
    for (var i = 0; i < limit; i++) {
      var el = all[i];
      var cs = getComputedStyle(el);
      if (cs.contentVisibility && cs.contentVisibility !== 'visible') {
        if (!window.__fpsOriginalStyles.has(el)) window.__fpsOriginalStyles.set(el, { cv: el.style.contentVisibility });
        el.style.setProperty('content-visibility', 'visible', 'important');
      }
      // 2) Remove containment that could clip.
      if (cs.contain && cs.contain !== 'none') {
        if (!window.__fpsOriginalStyles.has(el)) window.__fpsOriginalStyles.set(el, {});
        var s = window.__fpsOriginalStyles.get(el);
        s.contain = el.style.contain;
        el.style.setProperty('contain', 'none', 'important');
      }
    }

    // 3) Pause animations and transitions.
    var style = document.getElementById('__fps-pause-style');
    if (!style) {
      style = document.createElement('style');
      style.id = '__fps-pause-style';
      style.textContent = '*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }';
      (document.head || document.documentElement).appendChild(style);
    }

    return true;
  } catch (e) {
    return false;
  }
})()`;

const RESTORE_PAGE_SCRIPT = `(function () {
  try {
    // Restore content-visibility and contain.
    if (window.__fpsOriginalStyles) {
      window.__fpsOriginalStyles.forEach(function (orig, el) {
        try {
          if (orig.cv !== undefined) el.style.removeProperty('content-visibility');
          if (orig.contain !== undefined) {
            if (orig.contain) el.style.contain = orig.contain;
            else el.style.removeProperty('contain');
          }
        } catch (e) {}
      });
      window.__fpsOriginalStyles = null;
    }
    // Remove the pause style.
    var style = document.getElementById('__fps-pause-style');
    if (style && style.parentNode) style.parentNode.removeChild(style);
    return true;
  } catch (e) {
    return false;
  }
})()`;

/**
 * Espera a que las fuentes web terminen de cargar (evita texto faltante).
 */
const WAIT_FONTS_SCRIPT = `new Promise(function (resolve) {
  try {
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { resolve(true); });
      setTimeout(function () { resolve(true); }, 3000);
    } else {
      resolve(true);
    }
  } catch (e) {
    resolve(true);
  }
})`;

/**
 * Recorre shadow roots buscando imagenes con carga diferida y fuerza su carga.
 */
const LOAD_SHADOW_IMAGES_SCRIPT = `(function () {
  try {
    function walk(root) {
      if (!root) return;
      var imgs = root.querySelectorAll ? root.querySelectorAll('img[loading="lazy"], img[data-src], img[data-lazy-src]') : [];
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        if (img.dataset && img.dataset.src) img.src = img.dataset.src;
        if (img.dataset && img.dataset.lazySrc) img.src = img.dataset.lazySrc;
        img.loading = 'eager';
      }
      var all = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (var j = 0; j < all.length; j++) {
        if (all[j].shadowRoot) walk(all[j].shadowRoot);
      }
    }
    walk(document);
    return true;
  } catch (e) {
    return false;
  }
})()`;

async function preparePage(target: Debuggee): Promise<void> {
  try {
    await evaluate<boolean>(target, PREPARE_PAGE_SCRIPT);
    await evaluate<boolean>(target, LOAD_SHADOW_IMAGES_SCRIPT);
    await evaluate<boolean>(target, WAIT_FONTS_SCRIPT);
  } catch {
    // Not critical.
  }
}

async function restorePage(target: Debuggee): Promise<void> {
  try {
    await evaluate<boolean>(target, RESTORE_PAGE_SCRIPT);
  } catch {
    // Not critical.
  }
}

const HIDE_ATTRIBUTE = "data-full-page-shot-oculto";

/**
 * Oculta los elementos con position fixed o sticky. Se usa solo entre segmentos:
 * al desplazar la pagina se pegarian al borde superior y saldrian repetidos.
 * `visibility` conserva el espacio ocupado, asi que no altera la maquetacion.
 */
const HIDE_STICKY_SCRIPT = `(function () {
  var elements = document.querySelectorAll('body *');
  var count = 0;
  for (var i = 0; i < elements.length; i++) {
    var element = elements[i];
    var style = getComputedStyle(element);
    if (style.position !== 'fixed' && style.position !== 'sticky') continue;
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    element.setAttribute('${HIDE_ATTRIBUTE}', '1');
    element.style.setProperty('visibility', 'hidden', 'important');
    count += 1;
  }
  return count;
})()`;

const SHOW_STICKY_SCRIPT = `(function () {
  var elements = document.querySelectorAll('[${HIDE_ATTRIBUTE}]');
  for (var i = 0; i < elements.length; i++) {
    elements[i].removeAttribute('${HIDE_ATTRIBUTE}');
    elements[i].style.removeProperty('visibility');
  }
  return elements.length;
})()`;

async function hideStickyElements(target: Debuggee): Promise<number> {
  try {
    const count = await evaluate<number>(target, HIDE_STICKY_SCRIPT);
    return typeof count === "number" && Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}

async function showStickyElements(target: Debuggee): Promise<void> {
  try {
    await evaluate<number>(target, SHOW_STICKY_SCRIPT);
  } catch {
    // The page may have navigated or closed during capture.
  }
}

async function measurePage(target: Debuggee): Promise<{ width: number; height: number; nestedScroller: boolean }> {
  const metrics = await sendCommand<LayoutMetrics>(target, "Page.getLayoutMetrics");
  const content = metrics?.cssContentSize ?? metrics?.contentSize;
  const visual = metrics?.cssVisualViewport ?? metrics?.visualViewport;

  let width = Math.max(1, Math.ceil(content?.width ?? 0));
  let height = Math.max(1, Math.ceil(content?.height ?? 0));

  if (visual?.clientWidth) width = Math.max(width, Math.ceil(visual.clientWidth));

  // Some pages (e.g. CT System) freeze the document (html with overflow hidden)
  // and the real content scrolls inside the body or a container.
  // Page.getLayoutMetrics only sees the document (600 px), so the real height of
  // the main scrollable container is measured from the page.
  try {
    const fullHeight = await evaluate<number>(target, `(function () {
      function scroller() {
        if (document.body && document.body.scrollHeight > document.body.clientHeight + 1) return document.body;
        if (document.documentElement.scrollHeight > document.documentElement.clientHeight + 1) return document.documentElement;
        var best = null;
        var nodes = document.querySelectorAll('*');
        var limit = Math.min(nodes.length, 4000);
        for (var i = 0; i < limit; i++) {
          var n = nodes[i];
          var cs = getComputedStyle(n);
          if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
            if (n.scrollHeight > n.clientHeight + 50) {
              if (!best || n.scrollHeight > best.scrollHeight) best = n;
            }
          }
        }
        return best || document.documentElement;
      }
      var s = scroller();
      return Math.max(s.scrollHeight, document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
    })()`);
    if (typeof fullHeight === "number" && Number.isFinite(fullHeight) && fullHeight > height) {
      height = Math.ceil(fullHeight);
    }
  } catch {
    // Keep the protocol measurement.
  }

  // True if the document itself does not scroll (nested scroll): in that case
  // fast mode (single shot with captureBeyondViewport) doesn't work, must scroll.
  let nestedScroller = false;
  try {
    const nested = await evaluate<boolean>(target, `(document.documentElement.scrollHeight <= document.documentElement.clientHeight + 1)`);
    nestedScroller = nested === true;
  } catch {
    nestedScroller = false;
  }

  return { width, height, nestedScroller };
}

/** Altura visible (en px CSS) de la ventana: el paso del modo "por scroll". */
async function measureViewport(target: Debuggee): Promise<number> {
  try {
    const metrics = await sendCommand<LayoutMetrics>(target, "Page.getLayoutMetrics");
    const visual = metrics?.cssVisualViewport ?? metrics?.visualViewport;
    const height = visual?.clientHeight;
    if (typeof height === "number" && Number.isFinite(height) && height > 0) {
      return Math.round(height);
    }
  } catch {
    // Fall back to reading directly from the page.
  }
  try {
    const height = await evaluate<number>(target, "window.innerHeight || 0");
    if (typeof height === "number" && Number.isFinite(height) && height > 0) return Math.round(height);
  } catch {
    // Last resort.
  }
  return 800;
}

async function shoot(target: Debuggee, settings: Settings, clip: Clip): Promise<string> {
  const params: Record<string, unknown> = {
    format: settings.format,
    fromSurface: true,
    captureBeyondViewport: true,
    clip,
  };
  if (settings.format === "jpeg") params.quality = settings.quality;

  const response = await sendCommand<{ data?: string }>(target, "Page.captureScreenshot", params);
  if (!response?.data) {
    throw new CaptureError(
      "Edge didn't return the image.",
      "The page may be too large or protected against captures.",
    );
  }
  return response.data;
}

/**
 * Photographs what is currently on screen (without captureBeyondViewport).
 * Se usa en el recorrido por scroll, que desplaza el contenedor principal antes
 * de capturar. Sirve tanto para paginas normales como para las que desplazan
 * un contenedor interno (html con overflow hidden y body/contenedor con scroll).
 */
async function shootViewport(target: Debuggee, settings: Settings): Promise<string> {
  const params: Record<string, unknown> = {
    format: settings.format,
    fromSurface: true,
    captureBeyondViewport: false,
  };
  if (settings.format === "jpeg") params.quality = settings.quality;

  const response = await sendCommand<{ data?: string }>(target, "Page.captureScreenshot", params);
  if (!response?.data) {
    throw new CaptureError(
      "Edge didn't return the image.",
      "The page may be too large or protected against captures.",
    );
  }
  return response.data;
}

async function captureSlices(
  target: Debuggee,
  settings: Settings,
  width: number,
  height: number,
  onProgress: ProgressFn,
): Promise<{ slices: Slice[]; downscaled: boolean }> {
  if (height <= MAX_SINGLE_SHOT_HEIGHT) {
    onProgress("capturing", 35, `Capturando ${width} × ${height} px`);
    try {
      const base64 = await shoot(target, settings, { x: 0, y: 0, width, height, scale: 1 });
      return { slices: [{ base64, y: 0, height }], downscaled: false };
    } catch (error) {
      // A single shot can fail due to GPU surface limits: retry in segments
      // before giving up.
      console.warn("Captura unica fallida, se reintenta por segmentos:", describeError(error));
    }
  }

  // If the single shot already failed, split into smaller parts.
  const sliceHeight = height > MAX_SINGLE_SHOT_HEIGHT ? MAX_SINGLE_SHOT_HEIGHT : Math.max(1000, Math.ceil(height / 2));
  const total = Math.max(2, Math.ceil(height / sliceHeight));
  const slices: Slice[] = [];

  // The first part is taken with the page intact and scrolled to the top, so
  // fixed headers appear only once, at the start of the image.
  await scrollTo(target, 0);
  onProgress("capturing", 30, `Capturando parte 1 de ${total}`);
  const firstHeight = Math.min(sliceHeight, height);
  slices.push({
    base64: await shoot(target, settings, { x: 0, y: 0, width, height: firstHeight, scale: 1 }),
    y: 0,
    height: firstHeight,
  });

  // When scrolling for the remaining parts, fixed and sticky headers would stick
  // to the top edge and appear repeated in the middle of the image, so they are
  // hidden for the duration of the segmented capture.
  const hidden = await hideStickyElements(target);
  try {
    for (let index = 1; index < total; index += 1) {
      const y = index * sliceHeight;
      const currentHeight = Math.min(sliceHeight, height - y);
      onProgress("capturing", 30 + Math.round((index / total) * 40), `Capturando parte ${index + 1} de ${total}`);
      // Scrolling to the segment is essential: with the clip far from the
      // viewport, Chrome rasterizes the whole page and the segment takes
      // minutes instead of tenths of a second.
      await scrollTo(target, y);
      const base64 = await shoot(target, settings, { x: 0, y, width, height: currentHeight, scale: 1 });
      slices.push({ base64, y, height: currentHeight });
    }
  } finally {
    if (hidden > 0) await showStickyElements(target);
  }

  await scrollTo(target, 0);
  return { slices, downscaled: false };
}

/**
 * Modo "por scroll": baja la vista pantalla a pantalla, espera a que cada
 * posicion se pinte y captura ese tramo mediante `clip`, que es determinista y no
 * depende de la superficie real de la ventana. Al recorrer la pagina de verdad se
 * dispara la carga diferida y se captura el estado real de cada tramo, que es
 * justo lo que no consigue una toma unica en paginas con contenido perezoso o
 * animado. Se detiene al final que tenia la pagina al empezar (no sigue feeds
 * infinitos).
 *
 * Cada paso avanza exactamente una vista; la ultima pantalla se ancla al borde
 * inferior, de modo que las dos ultimas se solapan. Ese solape son pixeles
 * identicos del mismo tramo, asi que al unir la ultima pasada los reescribe y no
 * deja costura. Las cabeceras fijas se ocultan a partir de la segunda pantalla
 * para que no se repitan, igual que al segmentar.
 */
async function captureByScroll(
  target: Debuggee,
  settings: Settings,
  width: number,
  height: number,
  onProgress: ProgressFn,
): Promise<{ slices: Slice[]; downscaled: boolean }> {
  // If the window scrolls (normal page), captureBeyondViewport with a clip can
  // be used: deterministic and fast. Otherwise (nested scroll) the viewport must
  // be photographed after scrolling the container.
  let windowScrolls = true;
  try {
    windowScrolls = (await evaluate<boolean>(target, `(document.documentElement.scrollHeight > document.documentElement.clientHeight + 1)`)) === true;
  } catch {
    windowScrolls = true;
  }

  const viewportHeight = await measureViewport(target);
  const step = Math.max(200, Math.min(viewportHeight, height));
  let lastY = Math.max(0, height - step);
  let total = Math.max(1, Math.ceil(height / step));
  const slices: Slice[] = [];

  // First screen with the page intact and scrolled to the top, so fixed headers
  // appear only once, at the start of the image.
  await scrollTo(target, 0);
  await settle(target);
  onProgress("capturing", 30, total === 1 ? `Capturando ${width} × ${height} px` : `Capturando parte 1 de ${total}`);
  const firstHeight = Math.min(step, height);
  slices.push({
    base64: windowScrolls
      ? await shoot(target, settings, { x: 0, y: 0, width, height: firstHeight, scale: 1 })
      : await shootViewport(target, settings),
    y: 0,
    height: firstHeight,
  });

  if (total > 1) {
    const hidden = await hideStickyElements(target);
    try {
      for (let index = 1; index < total; index += 1) {
        const y = Math.min(index * step, lastY);
        onProgress("capturing", 30 + Math.round((index / total) * 40), `Capturando parte ${index + 1} de ${total}`);
        await scrollTo(target, y);
        await settle(target);
        slices.push({
          base64: windowScrolls
            ? await shoot(target, settings, { x: 0, y, width, height: step, scale: 1 })
            : await shootViewport(target, settings),
          y,
          height: step,
        });
      }
    } finally {
      if (hidden > 0) await showStickyElements(target);
    }
  }

  // Infinite scroll follow: if the page grows on scroll, capture the new parts.
  // Safety cap to avoid capturing forever.
  if (settings.followInfiniteScroll) {
    let guard = 0;
    while (guard < 10) {
      guard += 1;
      await scrollTo(target, lastY);
      await new Promise((r) => setTimeout(r, 700));
      await settle(target);
      const measured = await measurePage(target);
      const newHeight = measured.height;
      if (!Number.isFinite(newHeight) || newHeight <= height + 50) break;

      const oldHeight = height;
      height = newHeight;
      lastY = Math.max(0, height - step);

      onProgress("capturing", 50, `Loading more content (${guard})…`);
      const hidden = await hideStickyElements(target);
      try {
        let y = oldHeight;
        while (y < newHeight) {
          const yy = Math.min(y, newHeight - step);
          await scrollTo(target, yy);
          await settle(target);
          slices.push({
            base64: windowScrolls
              ? await shoot(target, settings, { x: 0, y: yy, width, height: step, scale: 1 })
              : await shootViewport(target, settings),
            y: yy,
            height: Math.min(step, newHeight - yy),
          });
          y += step;
          if (y >= newHeight) break;
        }
      } finally {
        if (hidden > 0) await showStickyElements(target);
      }
    }
  }

  await scrollTo(target, 0);
  return { slices, downscaled: false };
}

/**
 * Captura solo lo que se ve ahora mismo en pantalla (sin desplazarse). Util para
 * guardar un estado puntual (menu desplegado, hover, etc.).
 */
async function captureVisible(target: Debuggee, settings: Settings, onProgress: ProgressFn): Promise<CaptureOutput> {
  onProgress("capturing", 35, "Capturando la vista visible");
  const base64 = await shootViewport(target, settings);

  // Real dimensions of the captured image.
  const bitmap = await createImageBitmap(base64ToBlob(base64, mimeFor(settings)));
  const width = bitmap.width;
  const height = bitmap.height;
  bitmap.close();

  const info = await evaluate<{ url: string; title: string }>(
    target,
    "({ url: location.href, title: document.title || '' })",
  );

  return {
    base64,
    mimeType: mimeFor(settings),
    width,
    height,
    downscaled: false,
    url: typeof info?.url === "string" ? info.url : "",
    title: typeof info?.title === "string" ? info.title : "",
  };
}

async function stitchSlices(
  slices: Slice[],
  settings: Settings,
  width: number,
  height: number,
  onProgress: ProgressFn,
): Promise<{ base64: string; downscaled: boolean; width: number; height: number }> {
  const mimeType = mimeFor(settings);
  const ratio = Math.min(
    MAX_CANVAS_DIM / width,
    MAX_CANVAS_DIM / height,
    Math.sqrt(MAX_CANVAS_PIXELS / (width * height)),
    1,
  );

  const canvasWidth = Math.max(1, Math.round(width * ratio));
  const canvasHeight = Math.max(1, Math.round(height * ratio));
  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new CaptureError("Could not create the canvas to stitch the image parts.");
  }

  if (settings.format === "jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvasWidth, canvasHeight);
  }

  for (let index = 0; index < slices.length; index += 1) {
    const slice = slices[index];
    if (!slice) continue;
    onProgress("stitching", 70 + Math.round((index / slices.length) * 25), `Uniendo parte ${index + 1} de ${slices.length}`);

    const bitmap = await createImageBitmap(base64ToBlob(slice.base64, mimeType));
    // Edges are computed by rounding the accumulated offset to avoid 1 px seams.
    const top = Math.round(slice.y * ratio);
    const bottom = Math.round((slice.y + slice.height) * ratio);
    context.drawImage(bitmap, 0, top, canvasWidth, Math.max(1, bottom - top));
    bitmap.close();
  }

  const blob =
    settings.format === "jpeg"
      ? await canvas.convertToBlob({ type: mimeType, quality: settings.quality / 100 })
      : await canvas.convertToBlob({ type: mimeType });

  return { base64: await blobToBase64(blob), downscaled: ratio < 1, width: canvasWidth, height: canvasHeight };
}

/** true si la pestana es la activa de su ventana (lo normal al capturar). */
async function isTabActive(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.active === true;
  } catch {
    // If it can't be determined, assume yes to avoid touching focus needlessly.
    return true;
  }
}

/**
 * Respaldo para paginas restringidas (internas, PDF, etc.): captura solo la
 * vista visible con chrome.tabs.captureVisibleTab. No es captura completa, pero
 * permite obtener algo cuando el depurador esta bloqueado.
 */
async function captureVisibleTabFallback(tabId: number, settings: Settings): Promise<CaptureOutput> {
  const tab = await chrome.tabs.get(tabId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: settings.format === "jpeg" ? "jpeg" : "png",
    quality: settings.format === "jpeg" ? settings.quality : undefined,
  });
  const base64 = (dataUrl.split(",")[1] ?? "").trim();
  if (!base64) throw new CaptureError("Edge didn't return the image.");

  const bitmap = await createImageBitmap(base64ToBlob(base64, mimeFor(settings)));
  const width = bitmap.width;
  const height = bitmap.height;
  bitmap.close();

  return {
    base64,
    mimeType: mimeFor(settings),
    width,
    height,
    downscaled: false,
    url: tab.url ?? "",
    title: tab.title ?? "",
  };
}

/** Captura toda la pagina de una pestana usando el protocolo DevTools. */
export async function captureFullPage(
  tabId: number,
  settings: Settings,
  onProgress: ProgressFn,
): Promise<CaptureOutput> {
  onProgress("preparing", 3, "Connecting to the tab");

  let target!: Debuggee;
  try {
    target = await attach(tabId);
  } catch (error) {
    const fe = friendlyError(error);
    // Restricted pages: attempt at least a visible-viewport capture.
    const restricted =
      fe.hint.includes("internal pages") ||
      fe.message.includes("No se pudo completar") ||
      fe.message.includes("bloqueada");
    if (restricted) {
      try {
        onProgress("preparing", 5, "Restricted page: capturing visible viewport only");
        const fallback = await captureVisibleTabFallback(tabId, settings);
        return fallback;
      } catch {
        // If the fallback also fails, report the original error.
      }
    }
    throw fe;
  }

  let initialScroll = 0;

  try {
    await sendCommand(target, "Page.enable");
    await sendCommand(target, "Runtime.enable");

    // Segmented captures need the tab to be visible: otherwise the compositor
    // won't produce new frames and segments from the second one hang. Only
    // activated when needed, because activating the tab would close the popup and
    // lose the focus the clipboard needs. In normal usage it's already active.
    if (!(await isTabActive(tabId))) {
      await sendCommand(target, "Page.bringToFront");
    }

    initialScroll = await getScrollY(target);

    const info = await evaluate<{ url: string; title: string }>(
      target,
      "({ url: location.href, title: document.title || '' })",
    );
    const url = typeof info?.url === "string" ? info.url : "";
    const title = typeof info?.title === "string" ? info.title : "";

    let effectiveMode: CaptureMode = settings.captureMode;
    if (effectiveMode === "auto") {
      onProgress("loading", 6, "Analyzing the page");
      const signals = await detectDynamicContent(target);
      effectiveMode = signals.scroll ? "scroll" : "fast";
      if (effectiveMode === "scroll") {
        onProgress("loading", 8, "Dynamic page detected: will use scroll walk");
      }
    }

    // Visible-only capture: resolved here, without scrolling.
    if (effectiveMode === "visible") {
      if (settings.dismissCookieBanners) {
        onProgress("loading", 6, "Dismissing cookie banners");
        await dismissCookieBanners(target);
      }
      if (settings.captureDelay > 0) {
        for (let s = settings.captureDelay; s > 0; s -= 1) {
          onProgress("loading", 6, `Capturing in ${s} s…`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      const visible = await captureVisible(target, settings, onProgress);
      await scrollTo(target, initialScroll);
      await detach(target);
      return visible;
    }

    // If the document does not scroll by itself (nested scroll), fast mode can
    // only capture the visible viewport: scroll is forced.
    if (effectiveMode === "fast") {
      try {
        const nested = await evaluate<boolean>(target, `(document.documentElement.scrollHeight <= document.documentElement.clientHeight + 1)`);
        if (nested === true) {
          effectiveMode = "scroll";
          onProgress("loading", 8, "Content in scrollable container: will use scroll walk");
        }
      } catch {
        // Keep the current mode.
      }
    }

    if (settings.repaintCanvas) {
      onProgress("loading", 7, "Repainting the page");
      await repaintPage(target);
    }

    onProgress("loading", 7, "Preparing the page");
    await preparePage(target);

    if (settings.dismissCookieBanners) {
      onProgress("loading", 6, "Dismissing cookie banners");
      await dismissCookieBanners(target);
    }

    if (settings.captureDelay > 0) {
      for (let s = settings.captureDelay; s > 0; s -= 1) {
        onProgress("loading", 6, `Capturing in ${s} s…`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (settings.lazyLoadPass && effectiveMode !== "scroll") {
      onProgress("loading", 8, "Scrolling to load deferred content");
      await runLazyLoadPass(target);
    }

    await waitForIframes(target);

    onProgress("measuring", 22, "Measuring the page");
    const { width, height } = await measurePage(target);

    const { slices, downscaled: sliceDownscaled } =
      effectiveMode === "scroll"
        ? await captureByScroll(target, settings, width, height, onProgress)
        : await captureSlices(target, settings, width, height, onProgress);

    let base64 = slices[0]?.base64 ?? "";
    let downscaled = sliceDownscaled;
    // width/height are the page's; if the canvas downscales the image, the real
    // output size must be reported, not the page's.
    let outputWidth = width;
    let outputHeight = height;

    if (slices.length > 1) {
      onProgress("stitching", 70, "Uniendo las partes de la imagen");
      const stitched = await stitchSlices(slices, settings, width, height, onProgress);
      base64 = stitched.base64;
      downscaled = stitched.downscaled;
      outputWidth = stitched.width;
      outputHeight = stitched.height;
    }

    if (!base64) {
      throw new CaptureError("The capture came out empty.", "Try again; if it persists, reload the page.");
    }

    return {
      base64,
      mimeType: mimeFor(settings),
      width: outputWidth,
      height: outputHeight,
      downscaled,
      url,
      title,
    };
  } catch (error) {
    throw friendlyError(error);
  } finally {
    // Restore the styles that were changed for capture.
    await restorePage(target);
    // Segmented capture scrolls the page: return it to its place.
    await scrollTo(target, initialScroll);
    await detach(target);
  }
}
