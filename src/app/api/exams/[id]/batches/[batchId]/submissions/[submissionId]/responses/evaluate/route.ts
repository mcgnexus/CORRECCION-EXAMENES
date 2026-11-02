import { z } from "zod";
import { start } from "workflow/api";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getBatchRepository, getIdempotencyRepository, getSubmissionRepository, getAnswerKeyRepository } from "@/repositories";
import { evaluateOpenResponsesWorkflow } from "@/workflows/phase4-workflows";

const bodySchema = z.object({ expectedEtag: z.string().min(1), answerKeyRevisionId: z.string().min(1) });

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
    if (!submission.value.confirmedIdentity) throw new AppError("SUBMISSION_UNASSIGNED", "Confirma la identidad antes de evaluar.", 409);
    const batch = await getBatchRepository().get(ownerId, params.id, params.batchId);
    const answerKey = await getAnswerKeyRepository().get(ownerId, params.id, input.answerKeyRevisionId);
    if (!batch || !answerKey || answerKey.value.status !== "approved" || batch.value.answerKeyRevisionId !== input.answerKeyRevisionId) throw new AppError("ANSWER_KEY_STALE", "El solucionario no coincide con el lote o no está aprobado.", 409);
    if (submission.etag !== input.expectedEtag) throw new AppError("ETAG_CONFLICT", "La entrega cambió en otro proceso.", 409);
    const outcome = await getIdempotencyRepository().execute(ownerId, "evaluate-open-responses", idempotencyKey, async () => {
      const started = await start(evaluateOpenResponsesWorkflow, [{ ownerId, examId: params.id, batchId: params.batchId, submissionId: params.submissionId, answerKeyRevisionId: input.answerKeyRevisionId }]);
      const current = await getSubmissionRepository().get(ownerId, params.batchId, params.submissionId);
      if (current) await getSubmissionRepository().update(ownerId, params.batchId, params.submissionId, current.etag, { state: "evaluating", responseBlockingIssues: [] });
      return { runId: started.runId, answerKeyRevisionId: input.answerKeyRevisionId };
    });
    return Response.json({ data: outcome.result, replayed: outcome.replayed, requestId }, { status: outcome.replayed ? 200 : 202, headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
