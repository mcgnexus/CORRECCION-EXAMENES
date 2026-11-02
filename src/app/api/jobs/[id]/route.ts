import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getJobRepository } from "@/repositories";
import { z } from "zod";

const patchSchema = z.object({
  expectedEtag: z.string().min(1),
  status: z.enum(["queued", "running", "completed", "failed", "cancel_requested", "cancelled"]).optional(),
  step: z.string().min(1).optional(),
  attempt: z.number().int().nonnegative().optional(),
  errorCode: z.string().min(1).optional(),
  retryable: z.boolean().optional(),
  outputRefs: z.array(z.string().min(1)).optional(),
  phase: z.string().min(1).optional(),
  progress: z.object({ phase: z.string().min(1), current: z.number().int().nonnegative(), completed: z.number().int().nonnegative(), total: z.number().int().nonnegative(), percent: z.number().min(0).max(100) }).optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { ownerId } = await requireOwner();
    const result = await getJobRepository().getWithMeta(ownerId, (await context.params).id);
    if (!result) throw new AppError("NOT_FOUND", "Trabajo no encontrado.", 404);
    return Response.json({ data: result.job, requestId }, { headers: { "x-request-id": requestId, etag: result.etag } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const { expectedEtag, ...patch } = patchSchema.parse(await request.json());
    const job = await getJobRepository().update(ownerId, (await context.params).id, expectedEtag, patch);
    const current = await getJobRepository().getWithMeta(ownerId, (await context.params).id);
    return Response.json({ data: job, requestId }, { headers: { "x-request-id": requestId, ...(current ? { etag: current.etag } : {}) } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
