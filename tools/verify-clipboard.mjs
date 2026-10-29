/**
 * Verificacion del portapapeles.
 *
 * El modo headless de Edge no conecta el portapapeles con el de Windows, asi
 * que "la funcion devolvio true" no basta como prueba. Este script hace la
 * captura con copia activada y despues LEE el portapapeles desde una pagina de
 * la propia extension, comprobando que contiene una imagen PNG real y que sus
 * dimensiones coinciden con la captura.
 *
 * Se prueban los dos caminos con la misma forma que tienen en la realidad:
 *   popup  -> el popup es una ventana enfocada y la pestana de contenido sigue
 *             siendo la activa (como cuando el usuario pulsa el icono).
 *   helper -> el popup se cerro; copia una ventana auxiliar enfocada (respaldo).
 *
 *   node tools/verify-clipboard.mjs [--height=45000] [--mode=popup|helper] [--trace]
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const TEST_FOLDER = "fps-clip-verify";
const downloadDir = path.join(os.homedir(), "Downloads", TEST_FOLDER);
const profileDir = path.join(os.tmpdir(), "fps-clip-profile");

const WIDTH = 1280;
const HEIGHT = Number(process.argv.find((arg) => arg.startsWith("--height="))?.slice("--height=".length)) || 1500;
const modeFilter = process.argv.find((arg) => arg.startsWith("--mode="))?.slice("--mode=".length) ?? "";
const trace = process.argv.includes("--trace");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const findEdge = () => EDGE_CANDIDATES.find((candidate) => existsSync(candidate));

function pageHtml() {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Clipboard ${WIDTH}x${HEIGHT}</title>
<style>
  html, body { margin: 0; padding: 0; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; background: #7c3aed; }
</style></head><body></body></html>`;
}

/** Pide el contenido del portapapeles y describe lo que hay. */
const readBackExpression = `(async () => {
  try {
    if (!navigator.clipboard?.read) return { ok: false, error: 'navigator.clipboard.read no esta disponible.' };
    const items = await navigator.clipboard.read();
    const report = [];
    for (const item of items) {
      const entry = { types: item.types, size: null };
      if (item.types.includes('image/png')) {
        const bitmap = await createImageBitmap(await item.getType('image/png'));
        entry.size = bitmap.width + 'x' + bitmap.height;
        bitmap.close();
      }
      report.push(entry);
    }
    return { ok: true, items: report, focused: document.hasFocus() };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error), focused: document.hasFocus() };
  }
})()`;

const applySettings = (page, subfolder) =>
  page.evaluate(async (folder) => {
    await chrome.storage.sync.set({
      subfolder: folder,
      askWhereToSave: false,
      lazyLoadPass: false,
      notifyOnDone: false,
      format: "png",
      copyToClipboard: true,
    });
  }, subfolder);

/**
 * Dispara una captura de la unica pestana que no es de la extension.
 * En modo popup la pagina vive en su propia ventana, asi que la pestana de
 * contenido es la de la otra ventana; en modo helper se busca dentro de la
 * misma ventana descartando la pestana desde la que se llama.
 */
const triggerCapture = (page, mode) =>
  page.evaluate(async (current) => {
    const tabs = await chrome.tabs.query({});
    const selfWindow = await chrome.windows.getCurrent();
    const selfTab = await chrome.tabs.getCurrent();
    const candidates =
      current === "popup"
        ? tabs.filter((tab) => tab.windowId !== selfWindow?.id)
        : tabs.filter((tab) => tab.windowId === selfWindow?.id && tab.id !== selfTab?.id);
    if (candidates.length !== 1) {
      const detail = candidates.map((tab) => `#${tab.id}@w${tab.windowId}${tab.active ? "*" : ""}`).join(", ");
      return { ok: false, message: `${candidates.length} pestanas candidatas de ${tabs.length} (${detail}).` };
    }
    return await chrome.runtime.sendMessage({ target: "background", type: "CAPTURE", tabId: candidates[0].id });
  }, mode);

async function closeQuietly(page) {
  if (!page || page.isClosed()) return;
  await page.close().catch(() => {});
}

async function runScenario(browser, extensionId, pageUrl, mode) {
  const startedAt = Date.now();
  const step = (label) => console.log(`  · [${String(Date.now() - startedAt).padStart(6)} ms] ${label}`);
  const opened = [];

  try {
    const [firstPage] = await browser.pages();
    const page = firstPage ?? (await browser.newPage());
    await page.setViewport({ width: WIDTH, height: 800 });
    await page.goto(pageUrl, { waitUntil: "load" });
    step("página de prueba lista");

    // El popup real es una ventana aparte; se recrea igual para que la pestana de
    // contenido siga siendo la activa mientras la ventana del popup tiene el foco.
    const creator = await browser.newPage();
    opened.push(creator);
    await creator.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: "load" });
    await applySettings(creator, TEST_FOLDER);
    step("ajustes guardados");

    const before = new Set(await browser.pages());
    const popupWindow = await creator.evaluate(
      async (url) => {
        const created = await chrome.windows.create({ url, type: "popup", focused: true, width: 420, height: 560 });
        return { id: created.id };
      },
      `chrome-extension://${extensionId}/popup.html`,
    );
    await sleep(400);
    const popupPage = (await browser.pages()).find(
      (target) => !before.has(target) && target.url().includes("popup.html"),
    );
    opened.push(popupPage);
    await closeQuietly(creator);
    if (!popupPage) return { mode, ok: false, motivo: "no se pudo abrir la ventana del popup" };
    step("ventana del popup abierta");

    let trigger;
    let readPage;
    if (mode === "popup") {
      trigger = popupPage;
      readPage = popupPage;
    } else {
      await popupPage
        .evaluate(async (id) => {
          await chrome.windows.remove(id).catch(() => {});
        }, popupWindow.id)
        .catch(() => {});
      await sleep(300);
      // Contexto de disparo sin escucha de COPY, para forzar el respaldo.
      const options = await browser.newPage();
      opened.push(options);
      await options.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: "load" });
      await options.bringToFront();
      trigger = options;
      step("popup cerrado; se dispara desde la pagina de opciones");
    }

    // Vigila si aparece la ventana auxiliar durante la captura.
    let helperSeen = false;
    const watch = (async () => {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const urls = await browser.pages().then(
          (pages) => pages.map((target) => target.url()),
          () => [],
        );
        if (urls.some((url) => url.includes("helper.html"))) {
          helperSeen = true;
          return;
        }
        await sleep(20);
      }
    })();

    const triggerPromise = triggerCapture(trigger, mode).then(
      (value) => ({ value }),
      (error) => ({ error: String(error?.message ?? error) }),
    );

    let triggered = await Promise.race([triggerPromise, sleep(60_000).then(() => null)]);
    if (triggered === null) {
      step("la captura no respondio en 60 s");
      return { mode, ok: false, motivo: "la captura no respondio" };
    }
    if (triggered.error) {
      step(`error al disparar: ${triggered.error}`);
      return { mode, ok: false, motivo: triggered.error };
    }
    triggered = triggered.value;
    step(`captura terminada (portapapeles=${triggered?.result?.clipboard ?? "n/d"})`);
    await Promise.race([watch, sleep(21_000)]);
    step(`ventana auxiliar vista: ${helperSeen}`);

    if (!triggered?.ok) {
      return { mode, ok: false, motivo: triggered?.message ?? triggered?.hint ?? "sin respuesta" };
    }

    // El lector debe tener foco para poder leer el portapapeles.
    if (!readPage) {
      readPage = await browser.newPage();
      opened.push(readPage);
      await readPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
    }
    await readPage.bringToFront();
    step("leyendo el portapapeles");
    const readBack = await readPage.evaluate(readBackExpression);
    step(`portapapeles leído: ${JSON.stringify(readBack.items ?? readBack.error)}`);

    const png = readBack.ok ? readBack.items.find((item) => item.types.includes("image/png")) : null;
    const expected = `${triggered.result.width}x${triggered.result.height}`;
    const ok = triggered.result.clipboard === "ok" && Boolean(png) && png.size === expected;

    return {
      mode,
      ok,
      captura: expected,
      portapapeles: triggered.result.clipboard,
      metodo: triggered.result.clipboardMethod || "n/d",
      ventanaAuxiliar: helperSeen,
      imagen: png ? png.size : "ninguna",
      lectorEnfocado: readBack.focused,
      error: triggered.result.clipboardError || readBack.error || "",
    };
  } finally {
    for (const page of opened) await closeQuietly(page);
  }
}

async function main() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(pageHtml());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const pageUrl = `http://127.0.0.1:${server.address().port}/clip`;

  rmSync(downloadDir, { recursive: true, force: true });
  mkdirSync(downloadDir, { recursive: true });
  rmSync(profileDir, { recursive: true, force: true });

  const browser = await puppeteer.launch({
    executablePath: findEdge(),
    headless: true,
    userDataDir: profileDir,
    protocolTimeout: 120_000,
    // Sin defaultViewport: aplicar metricas a cada ventana nueva rompe con las
    // ventanas de la extension. El tamano se fija solo en la pagina web.
    defaultViewport: null,
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
    console.log(`Extension: ${extensionId}\n`);

    // Permite leer el portapapeles desde el origen de la extension.
    const client = await browser.target().createCDPSession();
    await client.send("Browser.grantPermissions", {
      origin: `chrome-extension://${extensionId}`,
      permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
    });

    if (trace) {
      const browserSession = await browser.target().createCDPSession();
      await browserSession.send("Target.setDiscoverTargets", { discover: true });
      const seen = new Map();
      browserSession.on("Target.targetCreated", ({ targetInfo }) => {
        seen.set(targetInfo.targetId, `${targetInfo.type} ${targetInfo.url}`);
        console.log(`  [target+] ${targetInfo.type} ${targetInfo.url.slice(0, 90)}`);
      });
      browserSession.on("Target.targetDestroyed", ({ targetId }) => {
        console.log(`  [target-] ${String(seen.get(targetId) ?? targetId).slice(0, 90)}`);
      });

      const workerSession = await workerTarget.createCDPSession();
      await workerSession.send("Runtime.enable");
      workerSession.on("Runtime.consoleAPICalled", (event) => {
        const text = event.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(" ");
        console.log(`  [worker ${event.type}] ${String(text).slice(0, 200)}`);
      });
      workerSession.on("Runtime.exceptionThrown", (event) => {
        const details = event.exceptionDetails;
        console.log(`  [worker ERROR] ${String(details?.exception?.description ?? details?.text).slice(0, 300)}`);
      });
    }

    for (const mode of ["popup", "helper"]) {
      if (modeFilter && modeFilter !== mode) continue;
      console.log(`--- Camino "${mode}" ---`);
      const result = await runScenario(browser, extensionId, pageUrl, mode);
      results.push(result);
      console.log(JSON.stringify(result, null, 2), "\n");
    }
  } finally {
    await browser.close().catch(() => {});
    server.close();
    await sleep(200);
    rmSync(profileDir, { recursive: true, force: true });
    rmSync(downloadDir, { recursive: true, force: true });
  }

  const passed = results.filter((result) => result.ok).length;
  console.log(`=== Resumen: ${passed}/${results.length} correctos ===`);
  for (const result of results) {
    if (!result.ok) console.log(` - FALLO (${result.mode}): ${result.motivo ?? result.error ?? "revisar detalle"}`);
  }
  if (passed !== results.length || results.length === 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Verificacion fallida:", error);
  process.exitCode = 1;
});
