import { writeImageToClipboard } from "./clipboard";
import type { CopyHelperJob, CopyHelperReadyRequest, CopyHelperResultRequest } from "./types";

/**
 * Ventana auxiliar de copiado.
 *
 * Se abre solo cuando el popup ya no esta disponible (el usuario hizo clic
 * fuera mientras se capturaba). Al ser una ventana con foco, si puede usar la
 * API del portapapeles. Vive lo justo para copiar y se cierra sola.
 */

async function run(): Promise<void> {
  const request: CopyHelperReadyRequest = { target: "background", type: "COPY_HELPER_READY" };

  let job: CopyHelperJob | null = null;
  try {
    job = ((await chrome.runtime.sendMessage(request)) as CopyHelperJob | null) ?? null;
  } catch {
    job = null;
  }

  if (!job) {
    window.close();
    return;
  }

  const outcome = await writeImageToClipboard(job.base64, job.mimeType);

  const result: CopyHelperResultRequest = {
    target: "background",
    type: "COPY_HELPER_RESULT",
    ok: outcome.ok,
    method: outcome.method,
    error: outcome.error,
  };

  try {
    await chrome.runtime.sendMessage(result);
  } catch {
    // La ventana de fondo pudo perderse: no hay nada mas que hacer.
  }

  window.close();
}

void run();
