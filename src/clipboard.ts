import type { ClipboardWriteResult } from "./types";
import { base64ToBytes, describeError } from "./util";

/**
 * Escritura de imagenes en el portapapeles.
 *
 * Este modulo debe ejecutarse en una pagina de la extension que TENGA EL FOCO
 * (el popup o la ventana auxiliar). La unica forma admitida por Chromium de
 * copiar una imagen por codigo es la API asincrona del portapapeles, y esa API
 * rechaza cualquier documento sin foco con el error "Document is not focused".
 *
 * Un documento offscreen nunca puede tener foco, asi que no sirve para esto;
 * `document.execCommand("copy")` tampoco vale porque solo deja texto y HTML en
 * el portapapeles, no una imagen. Ver chromium/issues/40252021 y 40288517.
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
    return { ok: false, method: "", error: "Este navegador no permite copiar imagenes al portapapeles." };
  }

  try {
    const blob = new Blob([base64ToBytes(base64)], { type: mimeType });
    // El portapapeles de Windows solo acepta PNG de forma fiable.
    const pngBlob = mimeType === PNG_MIME ? blob : await toPng(blob);
    await navigator.clipboard.write([new ClipboardItem({ [PNG_MIME]: pngBlob })]);
    return { ok: true, method: "clipboard-api", error: "" };
  } catch (error) {
    return { ok: false, method: "", error: describeError(error) };
  }
}
