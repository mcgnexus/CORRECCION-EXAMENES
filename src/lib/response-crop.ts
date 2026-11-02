import { createCanvas, loadImage } from "@napi-rs/canvas";
import { extractAndRenderPdf } from "./pdf";
import { AppError } from "./errors";

export type NormalizedResponseCrop = { x: number; y: number; width: number; height: number };

function assertRect(rect: NormalizedResponseCrop) {
  if (rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > 1 || rect.y + rect.height > 1) {
    throw new AppError("INVALID_RESPONSE_REGION", "La región de respuesta queda fuera de la página.", 400);
  }
}

async function loadSource(bytes: Uint8Array, mimeType: string, pageNumber: number) {
  if (mimeType === "application/pdf") {
    const rendered = await extractAndRenderPdf(bytes, pageNumber, 1.5);
    return { image: await loadImage(Buffer.from(rendered.png)), width: rendered.width, height: rendered.height };
  }
  const image = await loadImage(Buffer.from(bytes));
  return { image, width: image.width, height: image.height };
}

export async function cropResponseRegion(input: { bytes: Uint8Array; mimeType: string; pageNumber?: number; rotation?: 0 | 90 | 180 | 270; rect: NormalizedResponseCrop }) {
  assertRect(input.rect);
  const source = await loadSource(input.bytes, input.mimeType, input.pageNumber ?? 1);
  const rotation = input.rotation ?? 0;
  const rotatedWidth = rotation === 90 || rotation === 270 ? source.height : source.width;
  const rotatedHeight = rotation === 90 || rotation === 270 ? source.width : source.height;
  const sourceCanvas = createCanvas(rotatedWidth, rotatedHeight);
  const sourceContext = sourceCanvas.getContext("2d");
  sourceContext.fillStyle = "white";
  sourceContext.fillRect(0, 0, rotatedWidth, rotatedHeight);
  sourceContext.save();
  if (rotation === 90) { sourceContext.translate(rotatedWidth, 0); sourceContext.rotate(Math.PI / 2); }
  else if (rotation === 180) { sourceContext.translate(rotatedWidth, rotatedHeight); sourceContext.rotate(Math.PI); }
  else if (rotation === 270) { sourceContext.translate(0, rotatedHeight); sourceContext.rotate(-Math.PI / 2); }
  sourceContext.drawImage(source.image, 0, 0);
  sourceContext.restore();
  const x = Math.floor(input.rect.x * rotatedWidth);
  const y = Math.floor(input.rect.y * rotatedHeight);
  const width = Math.ceil(input.rect.width * rotatedWidth);
  const height = Math.ceil(input.rect.height * rotatedHeight);
  if (width < 8 || height < 8) throw new AppError("RESPONSE_REGION_TOO_SMALL", "La región de respuesta es demasiado pequeña.", 400);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.drawImage(sourceCanvas, x, y, width, height, 0, 0, width, height);
  return { png: new Uint8Array(canvas.toBuffer("image/png")), width, height };
}
