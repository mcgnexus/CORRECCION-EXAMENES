import { createHash } from "node:crypto";
import { imageSize } from "image-size";
import { AppError } from "./errors";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_DOCUMENT_PAGES = 30;
export const allowedUploadTypes = ["image/jpeg", "image/png", "application/pdf", "image/webp"] as const;

type DetectedType = (typeof allowedUploadTypes)[number] | "image/heic" | "unknown";

export type UploadInspection = {
  mimeType: (typeof allowedUploadTypes)[number];
  sizeBytes: number;
  sha256: string;
  width?: number;
  height?: number;
  pageCount?: number;
};

function startsWithBytes(bytes: Uint8Array, expected: number[]) {
  return expected.every((value, index) => bytes[index] === value);
}

function detectType(bytes: Uint8Array): DetectedType {
  if (startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (new TextDecoder().decode(bytes.slice(4, 12)) === "ftyp" || new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp") {
    const brands = new TextDecoder().decode(bytes.slice(8, 32));
    if (/heic|heix|hevc|mif1/i.test(brands)) return "image/heic";
  }
  return "unknown";
}

async function inspectPdf(bytes: Uint8Array) {
  const content = new TextDecoder("latin1").decode(bytes.slice(0, Math.min(bytes.byteLength, 2 * 1024 * 1024)));
  if (/\/Encrypt\b/.test(content)) throw new AppError("PDF_ENCRYPTED", "Los PDF cifrados no están permitidos.", 400);
  if (/\/JavaScript\b|\/JS\b|\/EmbeddedFile\b/.test(content)) throw new AppError("PDF_ACTIVE_CONTENT", "El PDF contiene contenido activo o adjuntos.", 400);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { pathToFileURL } = await import("node:url");
  const { join } = await import("node:path");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs")).toString();
  const document = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, disableFontFace: true }).promise;
  if (document.numPages > MAX_DOCUMENT_PAGES) throw new AppError("BATCH_PAGE_LIMIT", `El documento supera ${MAX_DOCUMENT_PAGES} páginas.`, 413);
  return { pageCount: document.numPages };
}

export async function inspectUpload(bytes: Uint8Array, declaredMimeType: string): Promise<UploadInspection> {
  if (bytes.byteLength === 0) throw new AppError("INVALID_FILE", "El archivo está vacío.", 400);
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new AppError("FILE_TOO_LARGE", "El archivo supera 25 MB.", 413);
  const detected = detectType(bytes);
  if (detected === "image/heic") throw new AppError("UNSUPPORTED_HEIC", "HEIC no está soportado todavía; conviértelo a JPEG o PNG.", 400);
  if (!(allowedUploadTypes as readonly string[]).includes(detected)) throw new AppError("INVALID_FILE", "El tipo real del archivo no está permitido.", 400);
  const mimeType = detected as (typeof allowedUploadTypes)[number];
  if (declaredMimeType !== mimeType) throw new AppError("MIME_MISMATCH", "El MIME declarado no coincide con el contenido.", 400);
  const result: UploadInspection = { mimeType, sizeBytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
  if (mimeType === "application/pdf") {
    Object.assign(result, await inspectPdf(bytes));
  } else {
    try {
      const dimensions = imageSize(Buffer.from(bytes));
      if (!dimensions.width || !dimensions.height) throw new Error("dimensions");
      result.width = dimensions.width;
      result.height = dimensions.height;
    } catch {
      throw new AppError("INVALID_IMAGE", "No se pudieron leer las dimensiones de la imagen.", 400);
    }
  }
  return result;
}
