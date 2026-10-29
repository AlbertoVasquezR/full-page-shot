import { DEFAULT_SETTINGS } from "./types";
import type { Settings } from "./types";

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalize(raw: Record<string, unknown>): Settings {
  const quality = Number(raw.quality);
  return {
    format: raw.format === "jpeg" ? "jpeg" : "png",
    quality: Number.isFinite(quality) ? Math.min(100, Math.max(1, Math.round(quality))) : DEFAULT_SETTINGS.quality,
    copyToClipboard: asBoolean(raw.copyToClipboard, DEFAULT_SETTINGS.copyToClipboard),
    subfolder: typeof raw.subfolder === "string" ? raw.subfolder : DEFAULT_SETTINGS.subfolder,
    askWhereToSave: asBoolean(raw.askWhereToSave, DEFAULT_SETTINGS.askWhereToSave),
    lazyLoadPass: asBoolean(raw.lazyLoadPass, DEFAULT_SETTINGS.lazyLoadPass),
    notifyOnDone: asBoolean(raw.notifyOnDone, DEFAULT_SETTINGS.notifyOnDone),
    captureMode:
      raw.captureMode === "scroll" ? "scroll" :
      raw.captureMode === "fast" ? "fast" :
      raw.captureMode === "visible" ? "visible" : "auto",
    captureDelay: Number.isFinite(Number(raw.captureDelay)) ? Math.min(10, Math.max(0, Math.round(Number(raw.captureDelay)))) : DEFAULT_SETTINGS.captureDelay,
    dismissCookieBanners: asBoolean(raw.dismissCookieBanners, DEFAULT_SETTINGS.dismissCookieBanners),
    followInfiniteScroll: asBoolean(raw.followInfiniteScroll, DEFAULT_SETTINGS.followInfiniteScroll),
    repaintCanvas: asBoolean(raw.repaintCanvas, DEFAULT_SETTINGS.repaintCanvas),
  };
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS as unknown as Record<string, unknown>);
  return normalize(stored);
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  await chrome.storage.sync.set(patch as Record<string, unknown>);
  return getSettings();
}

/** Se usa en las paginas de UI para reaccionar a cambios hechos desde otra vista. */
export function onSettingsChanged(listener: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    const keys = Object.keys(changes);
    if (!keys.some((key) => key in DEFAULT_SETTINGS)) return;
    void getSettings().then(listener);
  });
}

export const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];
