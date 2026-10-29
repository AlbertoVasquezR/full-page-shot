import type { ClipboardWriteResult } from "./types";
import { base64ToBytes, describeError } from "./util";

/**
 * Writing images to the clipboard.
 *
 * This module must run in an extension page that HAS FOCUS (the popup or the
 * helper window). The only way Chromium allows copying an image from code is the
 * asynchronous Clipboard API, and that API rejects any unfocused document with
 * the error "Document is not focused".
 *
 * An offscreen document can never have focus, so it's useless for this; and
 * `document.execCommand("copy")` doesn't help either because it only leaves text
 * and HTML on the clipboard, not an image. See chromium/issues/40252021 and
 * 40288517.
 */

const PNG_MIME = "image/png";

async function toPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo preparar el lienzo para convertir la imagen.");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (output) => (output ? resolve(output) : reject(new Error("No se pudo convertir la imagen a PNG."))),
      PNG_MIME,
    );
  });
}

export async function writeImageToClipboard(base64: string, mimeType: string): Promise<ClipboardWriteResult> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return { ok: false, method: "", error: "Este navegador no permite copiar imágenes al portapapeles." };
  }

  try {
    const blob = new Blob([base64ToBytes(base64)], { type: mimeType });
    // The Windows clipboard only reliably accepts PNG.
    const pngBlob = mimeType === PNG_MIME ? blob : await toPng(blob);
    await navigator.clipboard.write([new ClipboardItem({ [PNG_MIME]: pngBlob })]);
    return { ok: true, method: "clipboard-api", error: "" };
  } catch (error) {
    return { ok: false, method: "", error: describeError(error) };
  }
}