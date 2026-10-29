/** Tipos compartidos entre el service worker, el popup, la pagina de opciones y la ventana auxiliar. */

export type ImageFormat = "png" | "jpeg";

/**
 * Como se recorre la pagina al capturar:
 * - "fast": una sola toma (o por segmentos) sin desplazarla. Rapido y fiel para
 *   la mayoria de paginas.
 * - "scroll": baja la vista pantalla a pantalla y captura cada posicion.
 *   Imprescindible cuando el contenido solo aparece al desplazarse (imagenes con
 *   carga diferida, listas virtualizadas, animaciones al entrar en vista).
 * - "auto": decide entre los dos anteriores mirando si la pagina carga contenido
 *   al desplazarse. Es el valor por defecto.
 */
export type CaptureMode = "fast" | "scroll" | "auto" | "visible";

export interface Settings {
  /** Formato de salida. */
  format: ImageFormat;
  /** Calidad JPEG (1-100). Se ignora en PNG. */
  quality: number;
  /** Copiar la captura al portapapeles al terminar. */
  copyToClipboard: boolean;
  /** Subcarpeta dentro de Descargas. Vacio = raiz de Descargas. */
  subfolder: string;
  /** Abrir el dialogo nativo para elegir carpeta en cada captura. */
  askWhereToSave: boolean;
  /** Recorrer la pagina antes de capturar para forzar la carga diferida (lazy loading). */
  lazyLoadPass: boolean;
  /** Mostrar una notificacion del sistema al terminar. */
  notifyOnDone: boolean;
  /** Como se recorre la pagina al capturar. */
  captureMode: CaptureMode;
  /** Segundos de espera antes de capturar (0 = inmediato). Util para capturar estados con hover. */
  captureDelay: number;
  /** Intentar cerrar banners de cookies/consentimiento antes de capturar. */
  dismissCookieBanners: boolean;
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
  /** Ruta relativa a Descargas, con subcarpeta incluida. */
  filename: string;
  /** Solo el nombre del archivo, para mostrar al usuario. */
  displayName: string;
  width: number;
  height: number;
  bytes: number;
  /** true si el resultado se redujo para caber en el limite del lienzo. */
  downscaled: boolean;
  downloadId: number;
  clipboard: ClipboardOutcome;
  clipboardError: string;
  /** Como se escribio en el portapapeles: api moderna o execCommand. */
  clipboardMethod: string;
  elapsedMs: number;
}

/* ---------------------------------- Mensajes --------------------------------- */

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
  /** De la ventana de fondo al popup: "escribe esto en el portapapeles". */
  target: "popup";
  type: "COPY";
  base64: string;
  mimeType: string;
}

export interface CopyHelperReadyRequest {
  /** De la ventana auxiliar a la ventana de fondo: "dame el trabajo pendiente". */
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
  /** "clipboard-api" cuando lo escribio la API moderna. */
  method: string;
  error: string;
}
