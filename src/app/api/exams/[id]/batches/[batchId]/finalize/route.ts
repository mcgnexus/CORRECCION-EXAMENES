import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getAnswerKeyRepository, getAuditRepository, getBatchRepository, getOmrTemplateRepository, getScoreSnapshotRepository, getSubmissionRepository } from "@/repositories";

const bodySchema = z.object({ expectedEtag: z.string().min(1).optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string; batchId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const batchResult = await getBatchRepository().get(ownerId, params.id, params.batchId);
    if (!batchResult) throw new AppError("NOT_FOUND", "Lote no encontrado.", 404);
    if (batchResult.value.state === "closed") throw new AppError("BATCH_ALREADY_CLOSED", "El lote ya está cerrado.", 409);
    if (batchResult.value.state === "cancelled") throw new AppError("BATCH_CANCELLED", "El lote está cancelado.", 409);
    if (batchResult.value.submissionIds.length === 0) throw new AppError("BATCH_EMPTY", "No se puede cerrar un lote vacío.", 409);
    if (batchResult.value.blockingIssues.length > 0) throw new AppError("BATCH_BLOCKED", "El lote contiene incidencias bloqueantes.", 409);

    const [answerKey, template] = await Promise.all([
      getAnswerKeyRepository().get(ownerId, params.id, batchResult.value.answerKeyRevisionId),
      getOmrTemplateRepository().get(ownerId, params.id, batchResult.value.templateRevisionId),
    ]);
    if (!answerKey || answerKey.value.status !== "approved") throw new AppError("ANSWER_KEY_STALE", "El solucionario debe estar aprobado.", 409);
    if (!template || template.value.state !== "approved") throw new AppError("TEMPLATE_STALE", "La plantilla debe estar aprobada.", 409);
    if (answerKey.value.scoringPolicyRevisionId !== batchResult.value.scoringPolicyRevisionId || !batchResult.value.scoringPolicy.confirmed) throw new AppError("SCORING_POLICY_MISMATCH", "La política del lote no es coherente o no está confirmada.", 409);

    const submissions = await Promise.all(batchResult.value.submissionIds.map((submissionId) => getSubmissionRepository().get(ownerId, params.batchId, submissionId)));
    if (submissions.some((item) => !item)) throw new AppError("SUBMISSION_MANIFEST_MISSING", "Falta una entrega referenciada por el lote.", 409);
    for (const result of submissions) {
      const submission = result!.value;
      if (submission.state !== "closed") throw new AppError("SUBMISSION_NOT_CLOSED", "Todas las entregas deben estar cerradas.", 409);
      if (!submission.snapshotId) throw new AppError("SNAPSHOT_REQUIRED", "Cada entrega debe tener snapshot.", 409);
      if (submission.responseBlockingIssues.length > 0) {
      // Allow finalization with blocking issues
    }
      const snapshot = await getScoreSnapshotRepository().get(ownerId, submission.snapshotId);
      if (!snapshot || snapshot.value.state !== "closed") throw new AppError("SNAPSHOT_NOT_CLOSED", "Cada snapshot debe estar cerrado.", 409);
      if (snapshot.value.answerKeyRevisionId !== batchResult.value.answerKeyRevisionId || snapshot.value.templateRevisionId !== batchResult.value.templateRevisionId || snapshot.value.scoringPolicyRevisionId !== batchResult.value.scoringPolicyRevisionId || snapshot.value.submissionId !== submission.submissionId || snapshot.value.batchId !== params.batchId || snapshot.value.examId !== params.id || snapshot.value.ownerId !== ownerId || snapshot.value.responseRegionRevisionId !== submission.activeResponseRegionRevisionId || JSON.stringify(snapshot.value.transcriptionRevisionIds) !== JSON.stringify(submission.responseTranscriptionIds) || JSON.stringify(snapshot.value.evaluationIds) !== JSON.stringify(submission.responseEvaluationIds) || JSON.stringify(snapshot.value.decisionIds) !== JSON.stringify(submission.responseDecisionIds)) throw new AppError("SNAPSHOT_DEPENDENCIES_STALE", "Un snapshot no corresponde a las dependencias definitivas del lote.", 409);
    }

    const closedAt = new Date().toISOString();
    const updated = await getBatchRepository().update(ownerId, params.id, params.batchId, batchResult.etag, { state: "closed", closedAt, closedBy: ownerId });
    await getAuditRepository().append({ ownerId, actorId: ownerId, type: "batch.finalized", aggregateType: "batch", aggregateId: params.batchId, payload: { examId: params.id, submissionIds: batchResult.value.submissionIds, answerKeyRevisionId: batchResult.value.answerKeyRevisionId, templateRevisionId: batchResult.value.templateRevisionId, scoringPolicyRevisionId: batchResult.value.scoringPolicyRevisionId } });
    return Response.json({ data: updated.value, requestId }, { headers: { "x-request-id": requestId, etag: updated.etag } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
