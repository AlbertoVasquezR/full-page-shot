import { captureFullPage, CaptureError } from "./capture";
import { getSettings } from "./settings";
import type {
  CaptureMode,
  CaptureResult,
  ClipboardWriteResult,
  CopyHelperJob,
  CopyToClipboardRequest,
  PopupEvent,
  ProgressStage,
} from "./types";
import { baseName, buildFilename, describeError, estimatedBytes } from "./util";

const HELPER_PATH = "helper.html";
/** Margen para abrir la ventana auxiliar, copiar y cerrarse. */
const HELPER_TIMEOUT_MS = 15_000;

let busy = false;

/* --------------------------------- Utilidades -------------------------------- */

function emit(event: PopupEvent): void {
  chrome.runtime.sendMessage(event).catch(() => {
    // The popup may be closed; the capture process continues anyway.
  });
}

function emitProgress(stage: ProgressStage, percent: number, detail: string): void {
  emit({ target: "popup", type: "PROGRESS", stage, percent, detail });
  // Progress on the toolbar icon, useful when no popup is open (shortcut).
  try {
    chrome.action.setBadgeText({ text: percent >= 100 ? "" : `${percent}%` });
    chrome.action.setBadgeBackgroundColor({ color: "#4f46e5" });
  } catch {
    // The badge is a bonus.
  }
}

function fail(message: string, hint: string): void {
  emit({ target: "popup", type: "ERROR", message, hint });
}

/** Mapa de notificacion -> descarga, para abrir el archivo al pulsar la notificacion. */
const notificationDownloads = new Map<string, number>();

async function notify(title: string, message: string, downloadId?: number): Promise<string | undefined> {
  try {
    const id = await chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title,
      message,
      // Keeps the notification visible until the user closes or clicks it.
      requireInteraction: false,
    });
    if (id && typeof downloadId === "number") notificationDownloads.set(id, downloadId);
    return id;
  } catch {
    // Notifications are a bonus: if they fail, they don't break the capture.
    return undefined;
  }
}

// When a notification is clicked, open (or reveal in folder) the captured image.
chrome.notifications.onClicked.addListener((notificationId) => {
  const downloadId = notificationDownloads.get(notificationId);
  notificationDownloads.delete(notificationId);
  if (typeof downloadId !== "number") return;
  // Try to open the file with the default viewer; if not possible,
  // reveal it in the Downloads folder.
  chrome.downloads.open(downloadId).catch(() => {
    chrome.downloads.show(downloadId);
  });
  chrome.notifications.clear(notificationId);
});

chrome.notifications.onClosed.addListener((notificationId) => {
  notificationDownloads.delete(notificationId);
});

/* -------------------------------- Portapapeles ------------------------------ */

/**
 * La API del portapapeles exige que el documento tenga el foco y las paginas
 * offscreen nunca lo tienen, asi que la copia se hace en paginas con foco:
 *  1. El popup, que ya esta enfocado mientras el usuario mira el progreso.
 *  2. Si el popup se cerro, una ventana auxiliar diminuta y enfocada.
 */

let pendingJob: CopyHelperJob | null = null;
let helperWindowId: number | null = null;
let resolveHelper: ((outcome: ClipboardWriteResult) => void) | null = null;

function finishHelper(outcome: ClipboardWriteResult): void {
  const resolve = resolveHelper;
  resolveHelper = null;
  pendingJob = null;
  resolve?.(outcome);
}

async function copyFromPopup(base64: string, mimeType: string): Promise<ClipboardWriteResult | null> {
  const request: CopyToClipboardRequest = { target: "popup", type: "COPY", base64, mimeType };
  try {
    const response = (await chrome.runtime.sendMessage(request)) as ClipboardWriteResult | undefined;
    return response ?? null;
  } catch {
    // The popup is not open: nobody handled the message.
    return null;
  }
}

async function copyFromHelperWindow(base64: string, mimeType: string): Promise<ClipboardWriteResult> {
  pendingJob = { base64, mimeType };

  const answered = new Promise<ClipboardWriteResult>((resolve) => {
    resolveHelper = resolve;
  });

  try {
    const created = await chrome.windows.create({
      url: chrome.runtime.getURL(HELPER_PATH),
      type: "popup",
      focused: true,
      width: 240,
      height: 150,
    });
    helperWindowId = created?.id ?? null;
  } catch (error) {
    finishHelper({ ok: false, method: "", error: describeError(error) });
    return { ok: false, method: "", error: describeError(error) };
  }

  const outcome = await Promise.race([
    answered,
    new Promise<ClipboardWriteResult>((resolve) =>
      setTimeout(() => resolve({ ok: false, method: "", error: "La ventana auxiliar no respondio a tiempo." }), HELPER_TIMEOUT_MS),
    ),
  ]);

  await closeHelperWindow();
  return outcome;
}

async function closeHelperWindow(): Promise<void> {
  const id = helperWindowId;
  helperWindowId = null;
  pendingJob = null;
  if (id === null) return;
  try {
    await chrome.windows.remove(id);
  } catch {
    // The window already closed itself after copying.
  }
}

async function copyToClipboard(base64: string, mimeType: string): Promise<ClipboardWriteResult> {
  const fromPopup = await copyFromPopup(base64, mimeType);
  if (fromPopup?.ok) return fromPopup;

  const fromHelper = await copyFromHelperWindow(base64, mimeType);
  if (fromHelper.ok) return fromHelper;

  // If the popup gave a specific error, it's more informative than the fallback's.
  return fromPopup ?? fromHelper;
}

/* --------------------------------- Captura ---------------------------------- */

async function runCapture(tabId: number, forceMode?: CaptureMode): Promise<CaptureResult> {
  const startedAt = Date.now();
  const settings = await getSettings();
  if (forceMode) settings.captureMode = forceMode;

  const keepAlive = setInterval(() => {
    chrome.storage.local.get("fps-keepalive").catch(() => {});
  }, 20_000);

  try {
    const output = await captureFullPage(tabId, settings, emitProgress);

  let clipboard: CaptureResult["clipboard"] = "skipped";
  let clipboardError = "";
  let clipboardMethod = "";

  if (settings.copyToClipboard) {
    emitProgress("clipboard", 95, "Copying to clipboard");
    try {
      const response = await copyToClipboard(output.base64, output.mimeType);
      clipboard = response.ok ? "ok" : "failed";
      clipboardError = response.error;
      clipboardMethod = response.method;
    } catch (error) {
      clipboard = "failed";
      clipboardError = describeError(error);
    }
  }

  emitProgress("saving", 98, "Guardando el archivo");
  const filename = buildFilename(output.url, settings.format, settings.subfolder);

  // A data URL is used: avoids depending on a blob's lifetime across contexts.
  const downloadId = await chrome.downloads.download({
    url: `data:${output.mimeType};base64,${output.base64}`,
    filename,
    saveAs: settings.askWhereToSave,
    conflictAction: "uniquify",
  });

  const result: CaptureResult = {
    filename,
    displayName: baseName(filename),
    width: output.width,
    height: output.height,
    bytes: estimatedBytes(output.base64),
    downscaled: output.downscaled,
    downloadId,
    clipboard,
    clipboardError,
    clipboardMethod,
    elapsedMs: Date.now() - startedAt,
  };

  const details = `${result.width} × ${result.height} px`;
  if (settings.notifyOnDone) {
    await notify("Capture ready", `${result.displayName} · ${details}`, downloadId);
  }

  // History of recent captures.
  try {
    const stored = await chrome.storage.local.get("recentCaptures");
    const list = Array.isArray(stored?.recentCaptures) ? stored.recentCaptures : [];
    list.unshift({
      displayName: result.displayName,
      filename: result.filename,
      width: result.width,
      height: result.height,
      downloadId: result.downloadId,
      timestamp: Date.now(),
    });
    await chrome.storage.local.set({ recentCaptures: list.slice(0, 8) });
  } catch {
    // History is a bonus.
  }

  return result;
  } finally {
    clearInterval(keepAlive);
    chrome.action.setBadgeText({ text: "" }).catch(() => {});
  }
}

/* --------------------------------- Mensajes --------------------------------- */

/** Los mensajes llegan de otros contextos: se validan campo a campo. */
interface IncomingMessage {
  target?: string;
  type?: string;
  tabId?: number;
  ok?: boolean;
  method?: string;
  error?: string;
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const request = message as IncomingMessage | undefined;
  if (!request || request.target !== "background") return undefined;

  if (request.type === "COPY_HELPER_READY") {
    // The helper window requests the pending job (may be empty).
    sendResponse(pendingJob);
    return true;
  }

  if (request.type === "COPY_HELPER_RESULT") {
    finishHelper({
      ok: request.ok === true,
      method: typeof request.method === "string" ? request.method : "",
      error: typeof request.error === "string" ? request.error : "",
    });
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === "OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === "CAPTURE") {
    if (busy) {
      const response = { ok: false as const, message: "A capture is already running.", hint: "Wait a few seconds." };
      fail(response.message, response.hint);
      sendResponse(response);
      return true;
    }
    if (typeof request.tabId !== "number" || request.tabId < 0) {
      const response = {
        ok: false as const,
        message: "Could not identify the active tab.",
        hint: "Open a normal page (http or https) and try again.",
      };
      fail(response.message, response.hint);
      sendResponse(response);
      return true;
    }

    const tabId = request.tabId;
    busy = true;
    runCapture(tabId)
      .then((result) => {
        emit({ target: "popup", type: "DONE", result });
        sendResponse({ ok: true as const, result });
      })
      .catch((error: unknown) => {
        const captureError = error instanceof CaptureError ? error : null;
        const message = captureError?.message ?? "No se pudo completar la captura.";
        const hint = captureError?.hint ?? describeError(error);
        fail(message, hint);
        sendResponse({ ok: false as const, message, hint });
      })
      .finally(() => {
        busy = false;
      });

    return true;
  }

  return undefined;
});

// Keyboard shortcuts: capture the active tab without opening the popup.
chrome.commands.onCommand.addListener((command) => {
  const forceMode: CaptureMode | undefined =
    command === "capture-visible" ? "visible" : undefined;
  if (command !== "capture-page" && command !== "capture-visible") return;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs?.[0];
    if (!tab?.id) return;
    if (busy) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "Full Page Shot",
        message: "A capture is already running.",
      });
      return;
    }
    const tabId = tab.id;
    busy = true;
    emitProgress("preparing", 2, "Starting capture from shortcut…");
    runCapture(tabId, forceMode)
      .then((result) => {
        emit({ target: "popup", type: "DONE", result });
        chrome.notifications.create({
          type: "basic",
          iconUrl: chrome.runtime.getURL("icons/icon128.png"),
          title: "Capture ready",
          message: `${result.displayName} · ${result.width} × ${result.height} px`,
        }, (nid) => {
          if (nid) notificationDownloads.set(nid, result.downloadId);
        });
      })
      .catch((error: unknown) => {
        const captureError = error instanceof CaptureError ? error : null;
        const message = captureError?.message ?? "No se pudo completar la captura.";
        const hint = captureError?.hint ?? describeError(error);
        fail(message, hint);
        chrome.notifications.create({
          type: "basic",
          iconUrl: chrome.runtime.getURL("icons/icon128.png"),
          title: "Capture error",
          message: `${message} ${hint}`.trim(),
        });
      })
      .finally(() => {
        busy = false;
        chrome.action.setBadgeText({ text: "" }).catch(() => {});
      });
  });
});
