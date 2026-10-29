import { writeImageToClipboard } from "./clipboard";
import { getSettings, onSettingsChanged, updateSettings } from "./settings";
import type {
  BackgroundRequest,
  BackgroundResponse,
  CaptureMode,
  CaptureResult,
  CopyToClipboardRequest,
  ImageFormat,
  PopupEvent,
  Settings,
} from "./types";
import { formatBytes } from "./util";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Falta el elemento #${id} en popup.html`);
  return node as T;
}

const captureButton = el<HTMLButtonElement>("capture");
const progress = el<HTMLElement>("progress");
const progressFill = el<HTMLElement>("progressFill");
const statusText = el<HTMLElement>("statusText");
const resultCard = el<HTMLElement>("result");
const resultTitle = el<HTMLElement>("resultTitle");
const resultMeta = el<HTMLElement>("resultMeta");
const showFileButton = el<HTMLButtonElement>("showFile");
const againButton = el<HTMLButtonElement>("captureAgain");
const errorBox = el<HTMLElement>("errorBox");
const errorTitle = el<HTMLElement>("errorTitle");
const errorHint = el<HTMLElement>("errorHint");
const formatGroup = el<HTMLElement>("formatGroup");
const qualityField = el<HTMLElement>("qualityField");
const qualityInput = el<HTMLInputElement>("quality");
const qualityValue = el<HTMLOutputElement>("qualityValue");
const copyToggle = el<HTMLInputElement>("copyToggle");
const modeGroup = el<HTMLElement>("modeGroup");
const openOptionsButton = el<HTMLButtonElement>("openOptions");
const destHint = el<HTMLElement>("destHint");
const recentSection = el<HTMLElement>("recentSection");
const recentList = el<HTMLElement>("recentList");

let lastDownloadId: number | null = null;
let running = false;

function setFormat(format: ImageFormat): void {
  for (const button of formatGroup.querySelectorAll<HTMLButtonElement>("button[data-format]")) {
    button.classList.toggle("is-active", button.dataset.format === format);
  }
  qualityField.hidden = format !== "jpeg";
}

function setMode(mode: CaptureMode): void {
  for (const button of modeGroup.querySelectorAll<HTMLButtonElement>("button[data-mode]")) {
    button.classList.toggle("is-active", button.dataset.mode === mode);
  }
}

function applySettings(next: Settings): void {
  setFormat(next.format);
  setMode(next.captureMode);
  qualityInput.value = String(next.quality);
  qualityValue.textContent = String(next.quality);
  copyToggle.checked = next.copyToClipboard;
  destHint.textContent = next.askWhereToSave
    ? "Se preguntará dónde guardar"
    : next.subfolder.trim()
      ? `Descargas/${next.subfolder.trim()}`
      : "Descargas";
}

function setRunning(value: boolean): void {
  running = value;
  captureButton.disabled = value;
  captureButton.classList.toggle("is-busy", value);
  el<HTMLElement>("captureLabel").textContent = value ? "Capturando…" : "Capturar página completa";
}

function showProgress(percent: number, detail: string): void {
  progress.hidden = false;
  progressFill.style.width = `${Math.max(2, Math.min(100, percent))}%`;
  statusText.textContent = detail;
}

function clearFeedback(): void {
  resultCard.hidden = true;
  errorBox.hidden = true;
}

function showError(message: string, hint: string): void {
  progress.hidden = true;
  resultCard.hidden = true;
  errorBox.hidden = false;
  errorTitle.textContent = message;
  errorHint.textContent = hint;
}

function showDone(result: CaptureResult): void {
  progress.hidden = true;
  errorBox.hidden = true;
  resultCard.hidden = false;
  resultTitle.textContent = result.displayName;

  const parts = [
    `${result.width} × ${result.height} px`,
    formatBytes(result.bytes),
    `${(result.elapsedMs / 1000).toFixed(1)} s`,
  ];
  if (result.downscaled) parts.push("reducida");
  if (result.clipboard === "ok") parts.push("copiada");
  if (result.clipboard === "failed") parts.push("portapapeles falló");
  resultMeta.textContent = parts.join(" · ");

  if (result.clipboard === "failed" && result.clipboardError) {
    resultMeta.title = result.clipboardError;
  }

  lastDownloadId = result.downloadId;
  void renderRecent();
}

async function renderRecent(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get("recentCaptures");
    const list = Array.isArray(stored?.recentCaptures) ? stored.recentCaptures : [];
    if (list.length === 0) {
      recentSection.hidden = true;
      return;
    }
    recentSection.hidden = false;
    recentList.innerHTML = "";
    for (const item of list) {
      const li = document.createElement("li");
      li.className = "recent__item";
      const name = document.createElement("span");
      name.className = "recent__name";
      const fullName = item.displayName ?? "captura";
      // Se trunca para que scrollWidth no empuje el ancho del popup.
      name.textContent = fullName.length > 34 ? fullName.slice(0, 31) + "…" : fullName;
      name.title = fullName;
      const meta = document.createElement("span");
      meta.className = "recent__meta";
      meta.textContent = `${item.width}×${item.height}`;
      const open = document.createElement("button");
      open.className = "recent__open";
      open.type = "button";
      open.textContent = "Ver";
      open.addEventListener("click", () => {
        if (typeof item.downloadId === "number") chrome.downloads.show(item.downloadId);
      });
      li.append(name, meta, open);
      recentList.appendChild(li);
    }
  } catch {
    recentSection.hidden = true;
  }
}

async function startCapture(): Promise<void> {
  if (running) return;
  clearFeedback();
  setRunning(true);
  showProgress(2, "Iniciando…");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const request: BackgroundRequest = { target: "background", type: "CAPTURE", tabId: tab?.id ?? -1 };
    const response = (await chrome.runtime.sendMessage(request)) as BackgroundResponse | undefined;

    if (!response || !response.ok) {
      showError(response?.message ?? "No se pudo completar la captura.", response?.hint ?? "");
    }
  } catch (error) {
    showError("No se pudo completar la captura.", error instanceof Error ? error.message : String(error));
  } finally {
    setRunning(false);
    progress.hidden = true;
  }
}

/* --------------------------------- Eventos ---------------------------------- */

formatGroup.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-format]");
  if (!button) return;
  const format = button.dataset.format === "jpeg" ? "jpeg" : "png";
  setFormat(format);
  void updateSettings({ format });
});

qualityInput.addEventListener("input", () => {
  qualityValue.textContent = qualityInput.value;
});

qualityInput.addEventListener("change", () => {
  void updateSettings({ quality: Number(qualityInput.value) });
});

copyToggle.addEventListener("change", () => {
  void updateSettings({ copyToClipboard: copyToggle.checked });
});

modeGroup.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-mode]");
  if (!button) return;
  const m = button.dataset.mode;
  const mode: CaptureMode = m === "scroll" ? "scroll" : m === "auto" ? "auto" : m === "visible" ? "visible" : "fast";
  setMode(mode);
  void updateSettings({ captureMode: mode });
});

captureButton.addEventListener("click", () => {
  void startCapture();
});

againButton.addEventListener("click", () => {
  clearFeedback();
  void startCapture();
});

showFileButton.addEventListener("click", () => {
  if (lastDownloadId === null) return;
  chrome.downloads.show(lastDownloadId);
});

openOptionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const event = message as PopupEvent | CopyToClipboardRequest | undefined;
  if (!event || event.target !== "popup") return undefined;

  if (event.type === "COPY") {
    // El popup esta enfocado mientras el usuario mira el progreso: es el mejor
    // sitio para escribir la imagen en el portapapeles.
    void writeImageToClipboard(event.base64, event.mimeType).then(sendResponse);
    return true;
  }

  if (event.type === "PROGRESS") {
    showProgress(event.percent, event.detail);
  } else if (event.type === "DONE") {
    showDone(event.result);
  } else if (event.type === "ERROR") {
    showError(event.message, event.hint);
  }
  return undefined;
});

onSettingsChanged((next) => {
  if (running) return;
  applySettings(next);
});

void getSettings().then(applySettings);
void renderRecent();
