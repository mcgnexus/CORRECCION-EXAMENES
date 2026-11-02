import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getExamRepository, getOmrTemplateRepository } from "@/repositories";
import { omrBubbleSchema } from "@/domain/phase3-schemas";

const patchSchema = z.object({
  expectedEtag: z.string().min(1),
  canvasWidth: z.number().int().positive().max(10_000).optional(),
  canvasHeight: z.number().int().positive().max(10_000).optional(),
  sourceAnchors: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).length(4).optional(),
  targetAnchors: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).length(4).optional(),
  bubbles: z.array(omrBubbleSchema).min(1).optional(),
  threshold: z.number().min(0).max(1).optional(),
  margin: z.number().min(0).max(1).optional(),
  state: z.enum(["draft", "testing", "stale"]).optional(),
});

const approveSchema = z.object({ expectedEtag: z.string().min(1) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string; templateId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const input = patchSchema.parse(await request.json());
    const { expectedEtag, ...patch } = input;
    const result = await getOmrTemplateRepository().update(ownerId, params.id, params.templateId, expectedEtag, patch);
    return Response.json({ data: result.value, requestId }, { headers: { "x-request-id": requestId, etag: result.etag } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string; templateId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const input = approveSchema.parse(await request.json());
    const current = await getOmrTemplateRepository().get(ownerId, params.id, params.templateId);
    if (!current) throw new AppError("NOT_FOUND", "Plantilla no encontrada.", 404);
    if (current.value.bubbles.length === 0) throw new AppError("TEMPLATE_EMPTY", "La plantilla no tiene burbujas.", 400);
    const result = await getOmrTemplateRepository().update(ownerId, params.id, params.templateId, input.expectedEtag, { state: "approved", approvedBy: ownerId, approvedAt: new Date().toISOString() });
    return Response.json({ data: result.value, requestId }, { headers: { "x-request-id": requestId, etag: result.etag } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
