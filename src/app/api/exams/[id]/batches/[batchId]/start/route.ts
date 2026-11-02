import { start } from "workflow/api";
import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getAnswerKeyRepository, getAuditRepository, getBatchRepository, getIdempotencyRepository, getJobRepository, getOmrTemplateRepository, getSubmissionRepository } from "@/repositories";
import { processBatchWorkflow } from "@/workflows/batch-processing-workflows";

const bodySchema = z.object({
  expectedEtag: z.string().min(1),
  concurrency: z.number().int().positive().max(8).optional(),
  maxAttempts: z.number().int().positive().max(5).optional(),
  budget: z.object({ maxInputTokens: z.number().int().positive().optional(), maxOutputTokens: z.number().int().positive().optional(), maxAmount: z.number().positive().optional(), currency: z.string().min(1).optional() }).optional(),
});

function configuredConcurrency(value?: number) {
  const configured = Number(process.env.AI_CONCURRENCY ?? 2);
  if (!Number.isInteger(configured) || configured < 1 || configured > 8) throw new AppError("INVALID_AI_CONCURRENCY", "AI_CONCURRENCY debe estar entre 1 y 8.", 500);
  if (value !== undefined && value > configured) throw new AppError("AI_CONCURRENCY_LIMIT", `La concurrencia solicitada no puede superar AI_CONCURRENCY=${configured}.`, 400);
  return value ?? configured;
}

export async function POST(request: Request, context: { params: Promise<{ id: string; batchId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "Falta Idempotency-Key.", 400);
    const input = bodySchema.parse(await request.json());
    const batch = await getBatchRepository().get(ownerId, params.id, params.batchId);
    if (!batch) throw new AppError("NOT_FOUND", "Lote no encontrado.", 404);
    if (batch.etag !== input.expectedEtag) throw new AppError("ETAG_CONFLICT", "El lote cambió en otro proceso.", 409, true);
    if (["closed", "cancelled"].includes(batch.value.state)) throw new AppError("BATCH_NOT_PROCESSABLE", "El lote ya no admite procesamiento.", 409);
    if (batch.value.submissionIds.length === 0) throw new AppError("BATCH_EMPTY", "No se puede procesar un lote vacío.", 409);
    const concurrency = configuredConcurrency(input.concurrency);
    const [answerKey, template, submissions] = await Promise.all([
      getAnswerKeyRepository().get(ownerId, params.id, batch.value.answerKeyRevisionId),
      getOmrTemplateRepository().get(ownerId, params.id, batch.value.templateRevisionId),
      Promise.all(batch.value.submissionIds.map((submissionId) => getSubmissionRepository().get(ownerId, params.batchId, submissionId))),
    ]);
    if (!answerKey || answerKey.value.status !== "approved" || answerKey.value.scoringPolicyRevisionId !== batch.value.scoringPolicyRevisionId) throw new AppError("BATCH_DEPENDENCIES_STALE", "El solucionario no coincide con la política aprobada del lote.", 409);
    if (!template || template.value.state !== "approved") throw new AppError("BATCH_DEPENDENCIES_STALE", "La plantilla del lote no está aprobada.", 409);
    if (submissions.some((submission) => !submission)) throw new AppError("SUBMISSION_MANIFEST_MISSING", "Falta una entrega oficial del lote.", 409);
    const totalPages = submissions.reduce((total, submission) => total + (submission?.value.pageIds.length ?? 0), 0);
    if (totalPages > batch.value.maxPages) throw new AppError("BATCH_PAGE_LIMIT", "El lote supera el límite de páginas configurado.", 413);

    const outcome = await getIdempotencyRepository().execute(ownerId, "process-batch", idempotencyKey, async () => {
      const active = await getJobRepository().findActiveBatch(ownerId, params.batchId);
      if (active) throw new AppError("BATCH_PROCESSING_IN_PROGRESS", "Ya existe un procesamiento activo para este lote.", 409, true);
      const job = await getJobRepository().create(ownerId, { kind: "batch", step: "queued", idempotencyKey, batchRequest: { examId: params.id, batchId: params.batchId, answerKeyRevisionId: batch.value.answerKeyRevisionId, templateRevisionId: batch.value.templateRevisionId, scoringPolicyRevisionId: batch.value.scoringPolicyRevisionId, concurrency, maxAttempts: input.maxAttempts ?? 3, budget: input.budget } });
      const run = await start(processBatchWorkflow, [{ ownerId, examId: params.id, batchId: params.batchId, jobId: job.jobId, answerKeyRevisionId: batch.value.answerKeyRevisionId, templateRevisionId: batch.value.templateRevisionId, scoringPolicyRevisionId: batch.value.scoringPolicyRevisionId, concurrency, maxAttempts: input.maxAttempts ?? 3 }]);
      await getAuditRepository().append({ ownerId, actorId: ownerId, type: "batch.processing.started", aggregateType: "job", aggregateId: job.jobId, payload: { examId: params.id, batchId: params.batchId, runId: run.runId, totalPages, concurrency } });
      return job.jobId;
    });
    const current = await getJobRepository().getWithMeta(ownerId, outcome.result);
    return Response.json({ data: { jobId: outcome.result, job: current?.job, dependencies: { answerKeyRevisionId: batch.value.answerKeyRevisionId, templateRevisionId: batch.value.templateRevisionId, scoringPolicyRevisionId: batch.value.scoringPolicyRevisionId } }, replayed: outcome.replayed, requestId }, { status: outcome.replayed ? 200 : 202, headers: { "x-request-id": requestId, ...(current ? { etag: current.etag } : {}) } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
