import { z } from "zod";
import { start } from "workflow/api";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getIdempotencyRepository, getResponseRegionRepository, getSubmissionRepository } from "@/repositories";
import { transcribeOpenResponsesWorkflow } from "@/workflows/phase4-workflows";

const bodySchema = z.object({ expectedEtag: z.string().min(1), regionRevisionId: z.string().min(1) });

export async function POST(request: Request, context: { params: Promise<{ id: string; batchId: string; submissionId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "Falta Idempotency-Key.", 400);
    const input = bodySchema.parse(await request.json());
    const submission = await getSubmissionRepository().get(ownerId, params.batchId, params.submissionId);
    if (!submission || submission.value.examId !== params.id) throw new AppError("NOT_FOUND", "Entrega no encontrada.", 404);
    const regions = await getResponseRegionRepository().getActive(ownerId, params.submissionId);
    if (!regions || regions.revision.regionRevisionId !== input.regionRevisionId || regions.pointerEtag !== input.expectedEtag) throw new AppError("ETAG_CONFLICT", "Las regiones cambiaron o no están disponibles.", 409);
    const outcome = await getIdempotencyRepository().execute(ownerId, "transcribe-open-responses", idempotencyKey, async () => {
      const started = await start(transcribeOpenResponsesWorkflow, [{ ownerId, examId: params.id, batchId: params.batchId, submissionId: params.submissionId, regionRevisionId: input.regionRevisionId }]);
      const current = await getSubmissionRepository().get(ownerId, params.batchId, params.submissionId);
      if (current) await getSubmissionRepository().update(ownerId, params.batchId, params.submissionId, current.etag, { state: "transcribing", responseBlockingIssues: [] });
      return { runId: started.runId, regionRevisionId: input.regionRevisionId };
    });
    return Response.json({ data: outcome.result, replayed: outcome.replayed, requestId }, { status: outcome.replayed ? 200 : 202, headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
