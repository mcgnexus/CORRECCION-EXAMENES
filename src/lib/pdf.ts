import { createCanvas } from "@napi-rs/canvas";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export type RenderedPdfPage = {
  pageNumber: number;
  pageCount: number;
  width: number;
  height: number;
  text: string;
  png: Uint8Array;
};

export async function extractAndRenderPdf(data: Uint8Array, pageNumber = 1, scale = 1.5): Promise<RenderedPdfPage> {
  if (data.byteLength === 0) throw new Error("El PDF está vacío.");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs")).toString();
  const standardFontDataUrl = pathToFileURL(join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/")).toString();
  const document = await pdfjs.getDocument({ data, standardFontDataUrl, useSystemFonts: false, useWorkerFetch: false, disableFontFace: true }).promise;
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.numPages) throw new Error("Página PDF fuera de rango.");
  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  await page.render({ canvas: canvas as never, canvasContext: context as never, viewport }).promise;
  const textContent = await page.getTextContent();
  const text = textContent.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " ").trim();
  return { pageNumber, pageCount: document.numPages, width: canvas.width, height: canvas.height, text, png: canvas.toBuffer("image/png") };
}
