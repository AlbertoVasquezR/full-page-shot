/**
 * Prueba de humo de extremo a extremo.
 *
 * Lanza Microsoft Edge con la extension cargada, sirve una pagina larga por HTTP
 * y dispara capturas reales a traves del service worker. Despues decodifica el
 * PNG descargado y comprueba dimensiones y contenido: que la cabecera fija
 * superior y el bloque del final de la pagina realmente aparezcan.
 *
 * Las descargas van a <Descargas>/fps-smoke-test, que se limpia al empezar y al
 * terminar. No se usa Browser.setDownloadBehavior a proposito: ese override de
 * CDP ignora el parametro `filename` de chrome.downloads y falsearia la prueba.
 *
 *   node tools/smoke-test.mjs                     # rapido
 *   node tools/smoke-test.mjs --include-segments  # anade la ruta por segmentos
 *   node tools/smoke-test.mjs --only=scroll       # solo escenarios que contengan "scroll"
 *   node tools/smoke-test.mjs --keep               # conserva las descargas descargadas
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { inflateSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const includeSegments = process.argv.includes("--include-segments");
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length) ?? "";
const keepFiles = process.argv.includes("--keep");

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const TEST_FOLDER = "fps-smoke-test";
const downloadDir = path.join(os.homedir(), "Downloads", TEST_FOLDER);
const profileDir = path.join(os.tmpdir(), "fps-smoke-profile");

const SCENARIOS = [
  { name: "PNG 6000 px", height: 6000, settings: { format: "png", copyToClipboard: false }, kind: "png" },
  { name: "PNG 20000 px", height: 20000, settings: { format: "png", copyToClipboard: false }, kind: "png" },
  { name: "PNG 45000 px (pagina extrema)", height: 45000, settings: { format: "png", copyToClipboard: false }, kind: "png" },
  { name: "JPEG q80 4200 px (con portapapeles)", height: 4200, settings: { format: "jpeg", quality: 80, copyToClipboard: true }, kind: "jpg" },
  { name: "PNG por scroll 6000 px", height: 6000, settings: { format: "png", copyToClipboard: false, captureMode: "scroll" }, kind: "png" },
  { name: "PNG auto (estatica)", height: 6000, settings: { format: "png", copyToClipboard: false, captureMode: "auto" }, kind: "png", expectFast: true },
  { name: "PNG auto (diferida)", height: 6000, lazy: true, settings: { format: "png", copyToClipboard: false, captureMode: "auto" }, kind: "png", expectScroll: true },
  { name: "PNG auto (contenedor scroll)", height: 6000, scrollContainer: true, settings: { format: "png", copyToClipboard: false, captureMode: "auto" }, kind: "png", expectScroll: true },
  { name: "PNG auto (iframe)", height: 6000, iframe: true, settings: { format: "png", copyToClipboard: false, captureMode: "auto" }, kind: "png", expectScroll: true },
  { name: "PNG auto (io-reveal)", height: 6000, ioReveal: true, settings: { format: "png", copyToClipboard: false, captureMode: "auto" }, kind: "png", expectScroll: true },
];

if (includeSegments) {
  SCENARIOS.push({
    name: "PNG 65000 px (ruta por segmentos)",
    height: 65000,
    settings: { format: "png", copyToClipboard: false },
    kind: "png",
  });
  SCENARIOS.push({
    name: "PNG por scroll 20000 px",
    height: 20000,
    settings: { format: "png", copyToClipboard: false, captureMode: "scroll" },
    kind: "png",
  });
}

const selected = only
  ? SCENARIOS.filter((scenario) => scenario.name.toLowerCase().includes(only.toLowerCase()))
  : SCENARIOS;
if (selected.length === 0) throw new Error(`Ningun escenario coincide con --only=${only}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findEdge() {
  const found = EDGE_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("No se encontro msedge.exe en las rutas habituales.");
  return found;
}

/* ---------------------------------- PNG ---------------------------------- */

const channelsFor = { 6: 4, 2: 3 };

function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("El archivo no es un PNG valido.");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const chunks = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      chunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  const channels = channelsFor[colorType];
  if (bitDepth !== 8 || interlace !== 0 || !channels) throw new Error("Formato PNG no soportado por la prueba.");

  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let cursor = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    const line = raw.subarray(cursor, cursor + stride);
    cursor += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let value = line[x];

      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) {
        throw new Error(`Filtro PNG desconocido: ${filter}`);
      }
      cur[x] = value & 0xff;
    }
  }

  return { width, height, channels, data: out };
}

function pixelAt(image, x, y) {
  const index = y * image.width * image.channels + x * image.channels;
  return { r: image.data[index], g: image.data[index + 1], b: image.data[index + 2] };
}

const isGreenish = (c) => c.g > 140 && c.r < 120 && c.b < 120;
const isReddish = (c) => c.r > 140 && c.g < 120 && c.b < 120;

/**
 * Recorre una columna central y devuelve las franjas solidas rojas o verdes.
 * Sirve para detectar cabeceras fijas duplicadas en mitad de la imagen, que es
 * el fallo tipico de capturar por segmentos.
 */
function scanBands(image) {
  const x = Math.floor(image.width / 2);
  const bands = [];
  let current = null;

  for (let y = 0; y < image.height; y += 1) {
    const color = pixelAt(image, x, y);
    const kind = isReddish(color) ? "rojo" : isGreenish(color) ? "verde" : null;
    if (!kind) {
      current = null;
      continue;
    }
    if (current && current.kind === kind && current.end === y - 1) {
      current.end = y;
      continue;
    }
    current = { kind, start: y, end: y };
    bands.push(current);
  }

  return bands.filter((band) => band.end - band.start >= 3);
}

/* ---------------------------------- JPEG ---------------------------------- */

function jpegSize(buffer) {
  if (buffer.readUInt16BE(0) !== 0xffd8) throw new Error("El archivo no es un JPEG valido.");
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error("No se encontro el marcador SOF en el JPEG.");
}

/* ------------------------------ Pagina de prueba ------------------------------ */

function pageHtml(height, opts) {
  opts = opts || {};
  const lazyImg = opts.lazy
    ? `<img loading="lazy" data-src="x" alt="" style="position:absolute;left:0;top:${height - 100}px;width:40px;height:40px;" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" />`
    : "";
  const scrollContainer = opts.scrollContainer
    ? `<div id="sc" style="position:absolute;left:0;top:60px;width:120px;height:200px;overflow:auto;border:1px solid #999;">
         ${Array.from({ length: 60 }, (_, i) => `<div style="height:30px;background:${i % 2 ? '#ddd' : '#eee'};">fila ${i}</div>`).join("")}
       </div>`
    : "";
  const iframe = opts.iframe
    ? `<iframe loading="lazy" data-src="x" style="position:absolute;left:0;top:60px;width:120px;height:100px;border:1px solid #999;" src="about:blank"></iframe>`
    : "";
  const ioReveal = opts.ioReveal
    ? `<style>.reveal { opacity: 0; transform: translateY(20px); transition: opacity .3s, transform .3s; } .reveal.is-visible { opacity: 1; transform: none; }</style>
       <div class="reveal" style="position:absolute;left:200px;top:${Math.round(height/2)}px;width:100px;height:40px;background:#f59e0b;"></div>
       <script>
         const io = new IntersectionObserver((entries) => {
           for (const e of entries) if (e.isIntersecting) e.target.classList.add('is-visible');
         }, { threshold: 0.1 });
         document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
       </script>`
    : "";
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Prueba ${height}px</title>
<style>
  html, body { margin: 0; padding: 0; }
  body { height: ${height}px; background: linear-gradient(180deg, #ffffff 0%, #0f172a 100%); }
  .sticky { position: fixed; inset: 0 0 auto 0; height: 56px; background: #ef4444; }
  .bottom { position: absolute; left: 0; right: 0; top: ${height - 140}px; height: 140px; background: #22c55e; }
</style></head>
<body><div class="sticky"></div><div class="bottom"></div>${lazyImg}${scrollContainer}${iframe}${ioReveal}</body></html>`;
}

/* --------------------------------- Utilidades --------------------------------- */

function clearDownloads() {
  if (existsSync(downloadDir)) rmSync(downloadDir, { recursive: true, force: true });
  mkdirSync(downloadDir, { recursive: true });
}

function listDownloads() {
  if (!existsSync(downloadDir)) return [];
  return readdirSync(downloadDir, { recursive: true })
    .map(String)
    .filter((entry) => !entry.endsWith(".crdownload"));
}

async function waitForStableDownload() {
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    const files = listDownloads();
    if (files.length > 0) {
      const file = path.join(downloadDir, files[0]);
      let previous = -1;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const size = statSync(file).size;
        if (size > 0 && size === previous) return file;
        previous = size;
        await sleep(300);
      }
    }
    await sleep(300);
  }
  throw new Error("Se agoto el tiempo esperando la descarga.");
}

/* ------------------------------------ Prueba ------------------------------------ */

async function main() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const parsed = Number(url.searchParams.get("h"));
    const opts = {
      lazy: url.searchParams.get("lazy") === "1",
      scrollContainer: url.searchParams.get("sc") === "1",
      iframe: url.searchParams.get("if") === "1",
      ioReveal: url.searchParams.get("io") === "1",
    };
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(pageHtml(Number.isFinite(parsed) && parsed > 0 ? parsed : 3000, opts));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const pageUrl = `http://127.0.0.1:${server.address().port}/tall`;

  clearDownloads();
  rmSync(profileDir, { recursive: true, force: true });

  const browser = await puppeteer.launch({
    executablePath: findEdge(),
    headless: true,
    userDataDir: profileDir,
    protocolTimeout: 900_000,
    defaultViewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${distDir}`,
      `--load-extension=${distDir}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  const results = [];

  try {
    const workerTarget = await browser.waitForTarget(
      (target) => target.type() === "service_worker" && target.url().includes("background.js"),
      { timeout: 30_000 },
    );
    const extensionId = new URL(workerTarget.url()).host;
    console.log(`Extension cargada: ${extensionId}`);
    console.log(`Descargas en: ${downloadDir}\n`);

    const [firstPage] = await browser.pages();
    const page = firstPage ?? (await browser.newPage());
    await page.goto(pageUrl, { waitUntil: "load" });

    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });

    // Permite leer el portapapeles desde el origen de la extension.
    const client = await browser.target().createCDPSession();
    await client.send("Browser.grantPermissions", {
      origin: `chrome-extension://${extensionId}`,
      permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
    });

    for (const scenario of selected) {
      clearDownloads();
      const params = new URLSearchParams({ h: String(scenario.height) });
      if (scenario.lazy) params.set("lazy", "1");
      if (scenario.scrollContainer) params.set("sc", "1");
      if (scenario.iframe) params.set("if", "1");
      if (scenario.ioReveal) params.set("io", "1");
      await page.goto(`${pageUrl}?${params.toString()}`, { waitUntil: "load" });
      const expectedHeight = await page.evaluate(() => document.documentElement.scrollHeight);

      // En uso real el popup tiene el foco cuando el usuario pulsa el boton:
      // la API del portapapeles lo exige para poder copiar la imagen.
      await popup.bringToFront();

      // Un unico listener por escenario: se quita el anterior para no duplicar eventos.
      await popup.evaluate(() => {
        if (window.__handler) chrome.runtime.onMessage.removeListener(window.__handler);
        window.__events = [];
        window.__handler = (message) => {
          if (message?.target === "popup") {
            window.__events.push({ t: Date.now(), type: message.type, detail: message.detail });
          }
        };
        chrome.runtime.onMessage.addListener(window.__handler);
      });

      const startedAt = Date.now();
      const triggered = await popup.evaluate(async (patch) => {
        await chrome.storage.sync.set({
          subfolder: patch.subfolder,
          askWhereToSave: false,
          lazyLoadPass: false,
          notifyOnDone: false,
          ...patch.settings,
        });
        const self = await chrome.tabs.getCurrent();
        const others = (await chrome.tabs.query({})).filter((tab) => tab.id !== self?.id);
        if (others.length !== 1) return { ok: false, message: `Se esperaba 1 pestana de contenido, hay ${others.length}.` };
        return await chrome.runtime.sendMessage({ target: "background", type: "CAPTURE", tabId: others[0].id });
      }, { subfolder: TEST_FOLDER, settings: scenario.settings });
      const wallMs = Date.now() - startedAt;

      if (!triggered?.ok) {
        results.push({ scenario: scenario.name, ok: false, motivo: triggered?.message ?? triggered?.hint ?? "sin respuesta" });
        console.log(`[FALLO] ${scenario.name} -> ${triggered?.message ?? "sin respuesta"}\n`);
        continue;
      }

      const file = await waitForStableDownload();
      const buffer = readFileSync(file);

      const downloadInfo = await popup.evaluate(async (id) => {
        const [item] = await chrome.downloads.search({ id });
        return item ? { filename: item.filename } : null;
      }, triggered.result.downloadId);

      const timeline = await popup.evaluate(() =>
        (window.__events ?? []).map((event, index, all) => ({
          detalle: event.detail ?? event.type,
          desdeElAnterior: index === 0 ? 0 : event.t - all[index - 1].t,
        })),
      );

      let contenido = "n/d (JPEG)";
      let contenidoOk = true;
      if (scenario.kind === "png") {
        const image = decodePng(buffer);
        const bands = scanBands(image);
        const redBands = bands.filter((band) => band.kind === "rojo");
        const greenBands = bands.filter((band) => band.kind === "verde");

        // Debe haber exactamente una cabecera roja, pegada al borde superior,
        // y exactamente un bloque verde, pegado al borde inferior. Mas franjas
        // significan que la cabecera fija se duplico al segmentar.
        const headerOk = redBands.length === 1 && redBands[0].start <= 2 && redBands[0].end >= 20;
        const bottomOk = greenBands.length === 1 && greenBands[0].end >= image.height - 6;
        contenidoOk = headerOk && bottomOk;
        contenido =
          `cabecera=${headerOk ? "unica OK" : `MAL (${redBands.length} franjas: ${redBands.map((b) => `${b.start}-${b.end}`).join(",")})`}` +
          ` · final=${bottomOk ? "unico OK" : `MAL (${greenBands.length} franjas: ${greenBands.map((b) => `${b.start}-${b.end}`).join(",")})`}`;
        for (const band of bands) {
          const side = band.start === 0 ? "arriba" : band.end === image.height - 1 ? "abajo" : "EN MEDIO";
          console.log(`      franja ${band.kind} en ${band.start}-${band.end} (${side})`);
        }
      }

      const dimensions =
        scenario.kind === "png"
          ? { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
          : jpegSize(buffer);

      // Lee el portapapeles de verdad: debe contener una imagen PNG con las
      // mismas dimensiones que la captura que se acaba de guardar.
      let clipboardCheck = "no aplica";
      let clipboardOk = true;
      if (scenario.settings.copyToClipboard) {
        await popup.bringToFront();
        const read = await popup.evaluate(async () => {
          try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
              if (item.types.includes("image/png")) {
                const bitmap = await createImageBitmap(await item.getType("image/png"));
                const size = `${bitmap.width}x${bitmap.height}`;
                bitmap.close();
                return { ok: true, size, error: "" };
              }
            }
            return { ok: false, size: "", error: "no hay image/png" };
          } catch (error) {
            return { ok: false, size: "", error: String(error instanceof Error ? error.message : error) };
          }
        });
        const expectedSize = `${dimensions.width}x${dimensions.height}`;
        clipboardOk = read.ok && read.size === expectedSize;
        clipboardCheck = read.ok ? `${read.size}${clipboardOk ? "" : ` (se esperaba ${expectedSize})`}` : `error: ${read.error}`;
      }

      // Decision del modo "auto": se deduce del timeline de progreso.
      const detailList = timeline.map((e) => e.detalle);
      const scrolled = detailList.some((d) => /Capturando parte \d+ de \d+/.test(d));
      const single = detailList.some((d) => /Capturando \d+ × \d+ px/.test(d));
      let decisionOk = true;
      if (scenario.expectScroll) decisionOk = scrolled;
      if (scenario.expectFast) decisionOk = single && !scrolled;

      // Espeja los limites reales de capture.ts: si la pagina no cabe en el
      // lienzo, la imagen se reduce proporcionalmente.
      const MAX_CANVAS_DIM = 30000;
      const MAX_CANVAS_PIXELS = 40_000_000;
      const ratio = Math.min(
        MAX_CANVAS_DIM / 1280,
        MAX_CANVAS_DIM / expectedHeight,
        Math.sqrt(MAX_CANVAS_PIXELS / (1280 * expectedHeight)),
        1,
      );
      const expectedWidth = Math.round(1280 * ratio);
      const expectedFinalHeight = Math.round(expectedHeight * ratio);

      const ok =
        Math.abs(dimensions.width - expectedWidth) <= 2 &&
        Math.abs(dimensions.height - expectedFinalHeight) <= 2 &&
        dimensions.height > 900 &&
        contenidoOk &&
        decisionOk &&
        clipboardOk &&
        // Lo que informa la extension debe coincidir con el archivo real.
        triggered.result.width === dimensions.width &&
        triggered.result.height === dimensions.height &&
        String(downloadInfo?.filename ?? "").includes(TEST_FOLDER);

      results.push({
        scenario: scenario.name,
        ok,
        esperado: `${expectedWidth}x${expectedFinalHeight}`,
        obtenido: `${dimensions.width}x${dimensions.height}`,
        informado: `${triggered.result.width}x${triggered.result.height}`,
        reducida: ratio < 1,
        peso: `${(buffer.length / 1024).toFixed(0)} KB`,
        contenido,
        archivoGuardado: downloadInfo?.filename ?? "n/d",
        portapapeles: triggered.result.clipboard,
        portapapelesMetodo: triggered.result.clipboardMethod || "n/d",
        portapapelesImagen: clipboardCheck,
        portapapelesError: (triggered.result.clipboardError ?? "").slice(0, 160),
        ms: triggered.result.elapsedMs,
        msTotales: wallMs,
        etapas: timeline,
      });

      console.log(`[${ok ? "OK" : "FALLO"}] ${scenario.name}`);
      console.log(JSON.stringify(results.at(-1), null, 2), "\n");
    }
  } finally {
    await browser.close().catch(() => {});
    server.close();
    await sleep(300);
    rmSync(profileDir, { recursive: true, force: true });
    if (!keepFiles) rmSync(downloadDir, { recursive: true, force: true });
  }

  const passed = results.filter((result) => result.ok).length;
  console.log(`=== Resumen: ${passed}/${selected.length} correctos ===`);
  for (const result of results) {
    if (!result.ok) console.log(` - FALLO: ${result.scenario} :: ${result.motivo ?? result.contenido ?? "revisar detalle"}`);
  }
  if (passed !== selected.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Prueba de humo fallida:", error);
  process.exitCode = 1;
});
