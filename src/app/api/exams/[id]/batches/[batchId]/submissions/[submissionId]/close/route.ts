import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getAnswerKeyRepository, getAuditRepository, getBatchRepository, getScoreSnapshotRepository, getSubmissionRepository } from "@/repositories";

const closeSchema = z.object({
  expectedEtag: z.string().min(1),
  snapshotExpectedEtag: z.string().min(1),
});

export async function POST(request: Request, context: { params: Promise<{ id: string; batchId: string; submissionId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const input = closeSchema.parse(await request.json());
    const submission = await getSubmissionRepository().get(ownerId, params.batchId, params.submissionId);
    if (!submission) throw new AppError("NOT_FOUND", "Entrega no encontrada.", 404);
    if (submission.etag !== input.expectedEtag) throw new AppError("ETAG_CONFLICT", "La entrega cambió en otro proceso.", 409);
    if (!submission.value.confirmedIdentity) throw new AppError("SUBMISSION_UNASSIGNED", "Confirma la identidad antes de cerrar.", 409);
    if (submission.value.state !== "review" && submission.value.state !== "review_scores" && submission.value.state !== "scored") throw new AppError("SUBMISSION_NOT_CLOSABLE", "La entrega no está lista para cierre.", 409);
    if (!submission.value.snapshotId) throw new AppError("SNAPSHOT_REQUIRED", "La entrega necesita un snapshot de puntuación.", 409);

    const batch = await getBatchRepository().get(ownerId, params.id, params.batchId);
    if (!batch) throw new AppError("NOT_FOUND", "Lote no encontrado.", 404);
    if (batch.value.state === "closed") throw new AppError("BATCH_CLOSED", "El lote ya está cerrado.", 409);
    const answerKey = await getAnswerKeyRepository().get(ownerId, params.id, batch.value.answerKeyRevisionId);
    if (!answerKey || answerKey.value.status !== "approved") throw new AppError("ANSWER_KEY_STALE", "El solucionario debe estar aprobado.", 409);
    if (answerKey.value.scoringPolicyRevisionId !== batch.value.scoringPolicyRevisionId) throw new AppError("SCORING_POLICY_MISMATCH", "La política del lote no coincide con la del solucionario.", 409);
    const snapshot = await getScoreSnapshotRepository().get(ownerId, submission.value.snapshotId);
    if (!snapshot) throw new AppError("SNAPSHOT_REQUIRED", "El snapshot de puntuación no existe.", 409);
    if (snapshot.etag !== input.snapshotExpectedEtag) throw new AppError("ETAG_CONFLICT", "El snapshot cambió en otro proceso.", 409);
    if (snapshot.value.state !== "review") throw new AppError("SNAPSHOT_NOT_CLOSABLE", "El snapshot no está en revisión.", 409);
    if (snapshot.value.blockingIssues.length > 0) throw new AppError("SNAPSHOT_BLOCKED", "La puntuación contiene incidencias pendientes. Revisa la lectura y vuelve a puntuar antes de cerrar.", 409);
    if (submission.value.responseBlockingIssues.length > 0) throw new AppError("SUBMISSION_BLOCKED", "La entrega contiene incidencias pendientes. Resuélvelas antes de cerrar.", 409);
    if (snapshot.value.submissionId !== submission.value.submissionId || snapshot.value.batchId !== params.batchId || snapshot.value.examId !== params.id || snapshot.value.ownerId !== ownerId || snapshot.value.answerKeyRevisionId !== batch.value.answerKeyRevisionId || snapshot.value.templateRevisionId !== batch.value.templateRevisionId || snapshot.value.scoringPolicyRevisionId !== batch.value.scoringPolicyRevisionId || snapshot.value.responseRegionRevisionId !== submission.value.activeResponseRegionRevisionId || JSON.stringify(snapshot.value.transcriptionRevisionIds) !== JSON.stringify(submission.value.responseTranscriptionIds) || JSON.stringify(snapshot.value.evaluationIds) !== JSON.stringify(submission.value.responseEvaluationIds) || JSON.stringify(snapshot.value.decisionIds) !== JSON.stringify(submission.value.responseDecisionIds)) {
      throw new AppError("SNAPSHOT_DEPENDENCIES_STALE", "El snapshot no corresponde a las revisiones vigentes del lote.", 409);
    }

    const closedSnapshot = await getScoreSnapshotRepository().update(ownerId, snapshot.value.snapshotId, input.snapshotExpectedEtag, { state: "closed" });
    const closedSubmission = await getSubmissionRepository().update(ownerId, params.batchId, params.submissionId, input.expectedEtag, { state: "closed" });
    await getAuditRepository().append({ ownerId, actorId: ownerId, type: "submission.closed", aggregateType: "submission", aggregateId: params.submissionId, payload: { batchId: params.batchId, snapshotId: snapshot.value.snapshotId, answerKeyRevisionId: batch.value.answerKeyRevisionId, templateRevisionId: batch.value.templateRevisionId, scoringPolicyRevisionId: batch.value.scoringPolicyRevisionId } });
    return Response.json({ data: { submission: closedSubmission.value, snapshot: closedSnapshot.value }, requestId }, { headers: { "x-request-id": requestId, etag: closedSubmission.etag } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
