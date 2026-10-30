import { getSettings, updateSettings } from "./settings";
import { DEFAULT_SETTINGS } from "./types";
import type { CaptureMode, ImageFormat, Settings } from "./types";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Falta el elemento #${id} en options.html`);
  return node as T;
}

const subfolderInput = el<HTMLInputElement>("subfolder");
const askWhereInput = el<HTMLInputElement>("askWhere");
const lazyLoadInput = el<HTMLInputElement>("lazyLoad");
const dismissCookiesInput = el<HTMLInputElement>("dismissCookies");
const followInfiniteInput = el<HTMLInputElement>("followInfinite");
const repaintCanvasInput = el<HTMLInputElement>("repaintCanvas");
const captureDelayInput = el<HTMLInputElement>("captureDelay");
const captureDelayValue = el<HTMLOutputElement>("captureDelayValue");
const notifyInput = el<HTMLInputElement>("notify");
const formatGroup = el<HTMLElement>("formatGroup");
const qualityField = el<HTMLElement>("qualityField");
const qualityInput = el<HTMLInputElement>("quality");
const qualityValue = el<HTMLOutputElement>("qualityValue");
const copyToggle = el<HTMLInputElement>("copyToggle");
const modeGroup = el<HTMLElement>("modeGroup");
const saveButton = el<HTMLButtonElement>("save");
const resetButton = el<HTMLButtonElement>("reset");
const savedBadge = el<HTMLElement>("saved");
const preview = el<HTMLElement>("preview");

let format: ImageFormat = "png";
let mode: CaptureMode = "fast";

function setFormat(next: ImageFormat): void {
  format = next;
  for (const button of formatGroup.querySelectorAll<HTMLButtonElement>("button[data-format]")) {
    button.classList.toggle("is-active", button.dataset.format === next);
  }
  qualityField.hidden = next !== "jpeg";
}

function setMode(next: CaptureMode): void {
  mode = next;
  for (const button of modeGroup.querySelectorAll<HTMLButtonElement>("button[data-mode]")) {
    button.classList.toggle("is-active", button.dataset.mode === next);
  }
}

function updatePreview(): void {
  const raw = subfolderInput.value.trim().replace(/[\\/]+/g, "/");
  const folder = raw ? raw.replace(/^\/+|\/+$/g, "") : "";
  const extension = format === "png" ? "png" : "jpg";
  const target = askWhereInput.checked ? "(will ask)" : folder ? `Downloads/${folder}/` : "Downloads/";
  preview.textContent = `${target}captura-sitio-web-20261016-143000.${extension}`;
}

function applySettings(settings: Settings): void {
  setFormat(settings.format);
  setMode(settings.captureMode);
  qualityInput.value = String(settings.quality);
  qualityValue.textContent = String(settings.quality);
  copyToggle.checked = settings.copyToClipboard;
  subfolderInput.value = settings.subfolder;
  askWhereInput.checked = settings.askWhereToSave;
  lazyLoadInput.checked = settings.lazyLoadPass;
  dismissCookiesInput.checked = settings.dismissCookieBanners;
  followInfiniteInput.checked = settings.followInfiniteScroll;
  repaintCanvasInput.checked = settings.repaintCanvas;
  captureDelayInput.value = String(settings.captureDelay);
  captureDelayValue.textContent = String(settings.captureDelay);
  notifyInput.checked = settings.notifyOnDone;
  updatePreview();
}

function flashSaved(): void {
  savedBadge.classList.add("is-visible");
  window.setTimeout(() => savedBadge.classList.remove("is-visible"), 1600);
}

async function save(): Promise<void> {
  saveButton.disabled = true;
  try {
    await updateSettings({
      format,
      quality: Number(qualityInput.value),
      copyToClipboard: copyToggle.checked,
      subfolder: subfolderInput.value.trim(),
      askWhereToSave: askWhereInput.checked,
      lazyLoadPass: lazyLoadInput.checked,
      dismissCookieBanners: dismissCookiesInput.checked,
      followInfiniteScroll: followInfiniteInput.checked,
      repaintCanvas: repaintCanvasInput.checked,
      captureDelay: Number(captureDelayInput.value),
      notifyOnDone: notifyInput.checked,
      captureMode: mode,
    });
    flashSaved();
  } finally {
    saveButton.disabled = false;
  }
}

formatGroup.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-format]");
  if (!button) return;
  setFormat(button.dataset.format === "jpeg" ? "jpeg" : "png");
  updatePreview();
});

modeGroup.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-mode]");
  if (!button) return;
  const m = button.dataset.mode;
  setMode(m === "scroll" ? "scroll" : m === "auto" ? "auto" : m === "visible" ? "visible" : "fast");
});

captureDelayInput.addEventListener("input", () => {
  captureDelayValue.textContent = captureDelayInput.value;
});

resetButton.addEventListener("click", async () => {
  resetButton.disabled = true;
  try {
    await updateSettings({ ...DEFAULT_SETTINGS });
    applySettings(await getSettings());
    flashSaved();
  } finally {
    resetButton.disabled = false;
  }
});

qualityInput.addEventListener("input", () => {
  qualityValue.textContent = qualityInput.value;
});

subfolderInput.addEventListener("input", updatePreview);
askWhereInput.addEventListener("change", updatePreview);
saveButton.addEventListener("click", () => {
  void save();
});

void getSettings().then(applySettings);

// Ctrl/Cmd + S saves from any field.
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void save();
  }
});
