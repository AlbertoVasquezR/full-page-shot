/** Shared types between the service worker, the popup, the options page and the helper window. */

export type ImageFormat = "png" | "jpeg";

/**
 * How the page is walked while capturing:
 * - "fast": single shot (or segmented) without scrolling. Fast and faithful for
 *   most pages.
 * - "scroll": walks the view screen by screen and captures each position.
 *   Essential when content only appears on scroll (lazy images, virtualized
 *   lists, entrance animations).
 * - "auto": decides between the two above by checking whether the page loads
 *   content on scroll. Default value.
 * - "visible": captures only what is currently on screen, without scrolling.
 */
export type CaptureMode = "fast" | "scroll" | "auto" | "visible";

export interface Settings {
  /** Output format. */
  format: ImageFormat;
  /** JPEG quality (1-100). Ignored for PNG. */
  quality: number;
  /** Copy the capture to the clipboard when finished. */
  copyToClipboard: boolean;
  /** Subfolder inside Downloads. Empty = Downloads root. */
  subfolder: string;
  /** Open the native dialog to choose the folder on every capture. */
  askWhereToSave: boolean;
  /** Walk the page before capturing to force lazy loading. */
  lazyLoadPass: boolean;
  /** Show a system notification when finished. */
  notifyOnDone: boolean;
  /** How the page is walked while capturing. */
  captureMode: CaptureMode;
  /** Seconds to wait before capturing (0 = immediate). Useful for hover states. */
  captureDelay: number;
  /** Try to dismiss cookie/consent banners before capturing. */
  dismissCookieBanners: boolean;
  /** Keep capturing while the page keeps growing (infinite scroll). */
  followInfiniteScroll: boolean;
  /** Force a repaint before capturing (improves Canvas/WebGL). */
  repaintCanvas: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  format: "png",
  quality: 92,
  copyToClipboard: true,
  subfolder: "FullPageShot",
  askWhereToSave: false,
  lazyLoadPass: true,
  notifyOnDone: true,
  captureMode: "auto",
  captureDelay: 0,
  dismissCookieBanners: true,
  followInfiniteScroll: false,
  repaintCanvas: true,
};

export type ProgressStage =
  | "preparing"
  | "loading"
  | "measuring"
  | "capturing"
  | "stitching"
  | "clipboard"
  | "saving";

export type ClipboardOutcome = "ok" | "failed" | "skipped";

export interface CaptureResult {
  /** Path relative to Downloads, including the subfolder. */
  filename: string;
  /** Just the file name, to show to the user. */
  displayName: string;
  width: number;
  height: number;
  bytes: number;
  /** True if the result was downscaled to fit the canvas limit. */
  downscaled: boolean;
  downloadId: number;
  clipboard: ClipboardOutcome;
  clipboardError: string;
  /** How it was written to the clipboard: modern API or execCommand. */
  clipboardMethod: string;
  elapsedMs: number;
}

/* ---------------------------------- Messages --------------------------------- */

export interface ProgressMessage {
  target: "popup";
  type: "PROGRESS";
  stage: ProgressStage;
  percent: number;
  detail: string;
}

export interface DoneMessage {
  target: "popup";
  type: "DONE";
  result: CaptureResult;
}

export interface FailMessage {
  target: "popup";
  type: "ERROR";
  message: string;
  hint: string;
}

export type PopupEvent = ProgressMessage | DoneMessage | FailMessage;

export interface CaptureRequest {
  target: "background";
  type: "CAPTURE";
  tabId: number;
}

export interface OpenOptionsRequest {
  target: "background";
  type: "OPEN_OPTIONS";
}

export type BackgroundRequest = CaptureRequest | OpenOptionsRequest;

export interface BackgroundSuccess {
  ok: true;
  result: CaptureResult;
}

export interface BackgroundFailure {
  ok: false;
  message: string;
  hint: string;
}

export type BackgroundResponse = BackgroundSuccess | BackgroundFailure;

export interface CopyToClipboardRequest {
  /** From the background window to the popup: "write this to the clipboard". */
  target: "popup";
  type: "COPY";
  base64: string;
  mimeType: string;
}

export interface CopyHelperReadyRequest {
  /** From the helper window to the background window: "give me the pending job". */
  target: "background";
  type: "COPY_HELPER_READY";
}

export interface CopyHelperResultRequest {
  target: "background";
  type: "COPY_HELPER_RESULT";
  ok: boolean;
  method: string;
  error: string;
}

export interface CopyHelperJob {
  base64: string;
  mimeType: string;
}

export interface ClipboardWriteResult {
  ok: boolean;
  /** "clipboard-api" when written with the modern API. */
  method: string;
  error: string;
}