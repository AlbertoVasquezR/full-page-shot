import { writeImageToClipboard } from "./clipboard";
import type { CopyHelperJob, CopyHelperReadyRequest, CopyHelperResultRequest } from "./types";

/**
 * Clipboard helper window.
 *
 * Opened only when the popup is no longer available (the user clicked away
 * while capturing). Because it's a focused window, it can use the Clipboard
 * API. It lives just long enough to copy and closes itself.
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
    // The background window may be gone: nothing else to do.
  }

  window.close();
}

void run();