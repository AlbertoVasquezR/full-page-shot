import type { ImageFormat } from "./types";

const BASE64_CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  return new Blob([base64ToBytes(base64)], { type: mimeType });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  return bytesToBase64(new Uint8Array(buffer));
}

/** Base64 grows 4/3 relative to the binary; used to report the size to the user. */
export function estimatedBytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export function timestamp(date = new Date()): string {
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${day}-${time}`;
}

export function hostFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname || parsed.protocol.replace(":", "");
    return sanitizeName(host) || "page";
  } catch {
    return "pagina";
  }
}

/** Keeps only characters valid for a Windows file name. */
export function sanitizeName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 80);
}

/** Cleans the subfolder and blocks absolute paths or "..". */
export function normalizeSubfolder(value: string): string {
  const parts = value
    .split(/[\\/]+/)
    .map((part) => sanitizeName(part))
    .filter((part) => part.length > 0 && part !== "." && part !== "..");
  return parts.join("/");
}

export function buildFilename(url: string, format: ImageFormat, subfolder: string): string {
  const extension = format === "png" ? "png" : "jpg";
  const name = `captura-${hostFromUrl(url)}-${timestamp()}.${extension}`;
  const folder = normalizeSubfolder(subfolder);
  return folder ? `${folder}/${name}` : name;
}

export function baseName(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
