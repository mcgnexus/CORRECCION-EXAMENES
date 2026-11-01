import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { inspectUpload } from "../src/lib/upload-validation";

const onePixelPng = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));

describe("validación de uploads", () => {
  it("valida MIME real y dimensiones de PNG", async () => {
    const result = await inspectUpload(onePixelPng, "image/png");
    expect(result.mimeType).toBe("image/png");
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rechaza MIME declarado incorrecto y HEIC", async () => {
    await expect(inspectUpload(onePixelPng, "image/jpeg")).rejects.toMatchObject({ code: "MIME_MISMATCH" });
    const heic = new TextEncoder().encode("\0\0\0\0ftypheic\0\0\0\0mif1");
    await expect(inspectUpload(heic, "image/heic")).rejects.toMatchObject({ code: "UNSUPPORTED_HEIC" });
  });

  it("rechaza documentos que superan treinta páginas", async () => {
    const document = await PDFDocument.create();
    for (let page = 0; page < 31; page += 1) document.addPage([100, 100]);
    await expect(inspectUpload(new Uint8Array(await document.save()), "application/pdf")).rejects.toMatchObject({ code: "BATCH_PAGE_LIMIT" });
  });
});
