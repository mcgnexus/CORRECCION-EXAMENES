import { z } from "zod";
import { extractAndRenderPdf } from "@/lib/pdf";

const bodySchema = z.object({ assetId: z.string().min(1), pdfBase64: z.string().min(1) });

export async function POST(request: Request) {
  if (!process.env.INTERNAL_SERVICE_SECRET || request.headers.get("x-internal-service-secret") !== process.env.INTERNAL_SERVICE_SECRET) {
    return Response.json({ error: "SERVICE_AUTH_REQUIRED" }, { status: 403 });
  }
  try {
    const input = bodySchema.parse(await request.json());
    const result = await extractAndRenderPdf(Uint8Array.from(Buffer.from(input.pdfBase64, "base64")));
    return Response.json({ assetId: input.assetId, pageCount: result.pageCount, text: result.text, width: result.width, height: result.height, pngByteLength: result.png.byteLength });
  } catch (error) {
    return Response.json({ error: "PDF_PROCESSING_FAILED", detail: error instanceof Error ? error.message : "unknown" }, { status: 400 });
  }
}
