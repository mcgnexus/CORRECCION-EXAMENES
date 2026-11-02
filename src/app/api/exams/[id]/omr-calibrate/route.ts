import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getExamRepository } from "@/repositories";

const bodySchema = z.object({
  imageBase64: z.string().min(100).max(8 * 1024 * 1024),
  rotation: z.number().min(-180).max(180).default(0),
  brightness: z.number().min(0.5).max(2).default(1),
  contrast: z.number().min(0.5).max(2).default(1),
  canvasWidth: z.number().int().positive().max(10_000).default(1000),
  canvasHeight: z.number().int().positive().max(10_000).default(930),
  expectedRows: z.number().int().positive().max(200).default(25),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const examId = (await context.params).id;
    if (!(await getExamRepository().get(ownerId, examId))) throw new AppError("NOT_FOUND", "Examen no encontrado.", 404);
    const secret = process.env.INTERNAL_SERVICE_SECRET;
    if (!secret) throw new AppError("INTERNAL_SERVICE_NOT_CONFIGURED", "Falta INTERNAL_SERVICE_SECRET.", 503);
    const input = bodySchema.parse(await request.json());
    // En Vercel la auto-llamada al propio despliegue puede fallar (DNS interno y
    // protección de despliegue). Se usa un host estable configurable.
    const serviceUrl = (process.env.OMR_SERVICE_URL ?? new URL(request.url).origin).replace(/\/$/, "");
    const headers: Record<string, string> = { "content-type": "application/json", "x-internal-service-secret": secret };
    // En Preview, la protección de despliegue también bloquea las llamadas del
    // propio servidor; si existe el secreto de bypass de automatización se envía.
    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
      headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
      headers["x-vercel-set-bypass-cookie"] = "samesitenone";
    }
    let response: Response;
    try {
      response = await fetch(`${serviceUrl}/api/omr`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...input, assetId: `calibration:${ownerId}:${examId}`, mode: "calibrate" }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : "unknown";
      throw new AppError("INTERNAL_FETCH_FAILED", `No se pudo contactar con el servicio interno (${serviceUrl}): ${detail}`, 502, true);
    }
    if (response.status === 401 || response.status === 403) {
      throw new AppError("INTERNAL_SERVICE_UNAUTHORIZED", "La protección de despliegue bloquea el servicio interno. Configura VERCEL_AUTOMATION_BYPASS_SECRET o prueba en Production.", 502);
    }
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new AppError("CALIBRATION_FAILED", `El servicio de calibración respondió HTTP ${response.status}.`, 502, retryable);
    }
    const payload = (await response.json()) as Record<string, unknown>;
    return Response.json({ ...payload, requestId }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
