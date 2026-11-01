import { describe, expect, it } from "vitest";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { extractAndRenderPdf } from "../src/lib/pdf";

describe("pipeline PDF", () => {
  it("extrae texto y renderiza una página con una figura sin Poppler", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([400, 300]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText("Pregunta sintética con figura", { x: 40, y: 250, size: 18, font });
    page.drawRectangle({ x: 100, y: 80, width: 160, height: 100, color: rgb(0.1, 0.4, 0.7) });
    const result = await extractAndRenderPdf(new Uint8Array(await document.save()));
    expect(result.pageCount).toBe(1);
    expect(result.text).toContain("Pregunta sintética con figura");
    expect(result.png.byteLength).toBeGreaterThan(100);
    expect(result.width).toBeGreaterThan(400);
  });
});
