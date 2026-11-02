import { start } from "workflow/api";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { exportJobRequestSchema } from "@/domain/phase5-schemas";
import { getAnswerKeyRepository, getAuditRepository, getBatchRepository, getIdempotencyRepository, getJobRepository, getOmrTemplateRepository, getScoreSnapshotRepository, getSubmissionRepository } from "@/repositories";
import { exportClosedBatchWorkflow } from "@/workflows/phase5-workflows";

export async function POST(request: Request, context: { params: Promise<{ id: string; batchId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "Falta Idempotency-Key.", 400);
    const input = exportJobRequestSchema.parse(await request.json());
    const batchResult = await getBatchRepository().get(ownerId, params.id, params.batchId);
    if (!batchResult) throw new AppError("NOT_FOUND", "Lote no encontrado.", 404);
    if (batchResult.etag !== input.expectedEtag) throw new AppError("ETAG_CONFLICT", "El lote cambió en otro proceso.", 409, true);
    if (batchResult.value.state !== "closed") throw new AppError("BATCH_NOT_CLOSED", "Solo se puede exportar un lote cerrado.", 409);
    if (!batchResult.value.submissionIds.length) throw new AppError("BATCH_EMPTY", "No se puede exportar un lote vacío.", 409);
    if (batchResult.value.blockingIssues.length > 0) throw new AppError("BATCH_BLOCKED", "El lote contiene incidencias bloqueantes.", 409);
    const [answerKey, template] = await Promise.all([
      getAnswerKeyRepository().get(ownerId, params.id, batchResult.value.answerKeyRevisionId),
      getOmrTemplateRepository().get(ownerId, params.id, batchResult.value.templateRevisionId),
    ]);
    if (!answerKey || answerKey.value.status !== "approved" || answerKey.value.scoringPolicyRevisionId !== batchResult.value.scoringPolicyRevisionId || !batchResult.value.scoringPolicy.confirmed) throw new AppError("EXPORT_DEPENDENCIES_STALE", "Las dependencias del lote no son definitivas.", 409);
    if (!template || template.value.state !== "approved") throw new AppError("EXPORT_DEPENDENCIES_STALE", "La plantilla del lote no es definitiva.", 409);
    const submissions = await Promise.all(batchResult.value.submissionIds.map((submissionId) => getSubmissionRepository().get(ownerId, params.batchId, submissionId)));
    if (submissions.some((item) => !item || item.value.state !== "closed" || !item.value.snapshotId)) throw new AppError("EXPORT_NOT_READY", "Todas las entregas deben estar cerradas con snapshot.", 409);
    const snapshots = await Promise.all(submissions.map((item) => getScoreSnapshotRepository().get(ownerId, item!.value.snapshotId!)));
    if (snapshots.some((item) => !item || item.value.state !== "closed" || item.value.blockingIssues.length > 0)) throw new AppError("EXPORT_NOT_READY", "Todos los snapshots deben estar cerrados sin bloqueos.", 409);
    for (let index = 0; index < submissions.length; index += 1) {
      const submission = submissions[index]!.value;
      const snapshot = snapshots[index]!.value;
      if (submission.responseBlockingIssues.length > 0 || snapshot.submissionId !== submission.submissionId || snapshot.batchId !== params.batchId || snapshot.examId !== params.id || snapshot.ownerId !== ownerId || snapshot.answerKeyRevisionId !== batchResult.value.answerKeyRevisionId || snapshot.templateRevisionId !== batchResult.value.templateRevisionId || snapshot.scoringPolicyRevisionId !== batchResult.value.scoringPolicyRevisionId || snapshot.responseRegionRevisionId !== submission.activeResponseRegionRevisionId || JSON.stringify(snapshot.transcriptionRevisionIds) !== JSON.stringify(submission.responseTranscriptionIds) || JSON.stringify(snapshot.evaluationIds) !== JSON.stringify(submission.responseEvaluationIds) || JSON.stringify(snapshot.decisionIds) !== JSON.stringify(submission.responseDecisionIds)) throw new AppError("EXPORT_DEPENDENCIES_STALE", "Las dependencias de una entrega cambiaron.", 409);
    }

    const outcome = await getIdempotencyRepository().execute(ownerId, "export-batch", idempotencyKey, async () => {
      const job = await getJobRepository().create(ownerId, { kind: "export", step: "queued", idempotencyKey, exportRequest: { examId: params.id, batchId: params.batchId, formats: input.formats, includeOriginal: input.includeOriginal, retentionHours: input.retentionHours, dependencies: { answerKeyRevisionId: batchResult.value.answerKeyRevisionId, templateRevisionId: batchResult.value.templateRevisionId, scoringPolicyRevisionId: batchResult.value.scoringPolicyRevisionId } } });
      const run = await start(exportClosedBatchWorkflow, [{ ownerId, examId: params.id, batchId: params.batchId, jobId: job.jobId, formats: input.formats, includeOriginal: input.includeOriginal, retentionHours: input.retentionHours }]);
      await getAuditRepository().append({ ownerId, actorId: ownerId, type: "export.created", aggregateType: "job", aggregateId: job.jobId, payload: { examId: params.id, batchId: params.batchId, formats: input.formats, includeOriginal: input.includeOriginal, runId: run.runId } });
      return job.jobId;
    });
    const job = await getJobRepository().getWithMeta(ownerId, outcome.result);
    return Response.json({ data: { jobId: outcome.result, job: job?.job, dependencies: { answerKeyRevisionId: batchResult.value.answerKeyRevisionId, templateRevisionId: batchResult.value.templateRevisionId, scoringPolicyRevisionId: batchResult.value.scoringPolicyRevisionId } }, replayed: outcome.replayed, requestId }, { status: outcome.replayed ? 200 : 202, headers: { "x-request-id": requestId, ...(job ? { etag: job.etag } : {}) } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
