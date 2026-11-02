import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getAuditRepository, getEvaluationRepository, getResponseDecisionRepository, getScoreSnapshotRepository, getSubmissionRepository, getTranscriptionRepository } from "@/repositories";

const patchSchema = z.object({ expectedEtag: z.string().min(1), normalizedText: z.string().optional(), correctedText: z.string().optional(), confirm: z.boolean().default(true) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string; batchId: string; submissionId: string; transcriptionId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const input = patchSchema.parse(await request.json());
    const current = await getTranscriptionRepository().get(ownerId, params.submissionId, params.transcriptionId);
    if (!current || current.value.batchId !== params.batchId || current.value.examId !== params.id) throw new AppError("NOT_FOUND", "Transcripción no encontrada.", 404);
    if (current.etag !== input.expectedEtag) throw new AppError("ETAG_CONFLICT", "La transcripción cambió en otro proceso.", 409);
    if (!input.confirm) throw new AppError("TRANSCRIPTION_CONFIRMATION_REQUIRED", "Confirma la transcripción o corrígela antes de continuar.", 409);
    const created = await getTranscriptionRepository().create({ regionRevisionId: current.value.regionRevisionId, submissionId: current.value.submissionId, batchId: current.value.batchId, examId: current.value.examId, ownerId, questionId: current.value.questionId, regionIds: current.value.regionIds, cropAssetIds: current.value.cropAssetIds, literalText: current.value.literalText, normalizedText: input.normalizedText ?? current.value.normalizedText, correctedText: input.correctedText ?? current.value.correctedText, confidence: current.value.confidence, uncertainSpans: current.value.uncertainSpans, flags: current.value.flags, provider: current.value.provider, model: current.value.model, providerRunId: current.value.providerRunId, state: "confirmed", confirmedBy: ownerId, confirmedAt: new Date().toISOString() });
    const submission = await getSubmissionRepository().get(ownerId, params.batchId, params.submissionId);
    if (!submission) throw new AppError("NOT_FOUND", "Entrega no encontrada.", 404);
    const ids = submission.value.responseTranscriptionIds.filter((id) => id !== current.value.transcriptionId);
    const decisions = await getResponseDecisionRepository().list(ownerId, params.submissionId);
    const evaluations = await getEvaluationRepository().list(ownerId, params.submissionId);
    for (const evaluation of evaluations.filter((item) => item.value.questionId === current.value.questionId && item.value.state === "completed")) {
      await getEvaluationRepository().updateState(ownerId, params.submissionId, evaluation.value.evaluationId, evaluation.etag, "stale");
    }
    const invalidDecisionIds = new Set(decisions.filter((item) => item.value.questionId === current.value.questionId).map((item) => item.value.decisionId));
    const decisionIds = submission.value.responseDecisionIds.filter((id) => !invalidDecisionIds.has(id));
    if (submission.value.snapshotId) {
      const snapshot = await getScoreSnapshotRepository().get(ownerId, submission.value.snapshotId);
      if (snapshot && snapshot.value.state !== "stale") await getScoreSnapshotRepository().update(ownerId, submission.value.snapshotId, snapshot.etag, { state: "stale" });
    }
    await getSubmissionRepository().update(ownerId, params.batchId, params.submissionId, submission.etag, { responseTranscriptionIds: [...ids, created.transcription.transcriptionId], responseDecisionIds: decisionIds, responseEvaluationIds: [], responseBlockingIssues: [], state: "transcription_review" });
    await getAuditRepository().append({ ownerId, actorId: ownerId, type: "response.transcription.confirmed", aggregateType: "submission", aggregateId: params.submissionId, payload: { questionId: current.value.questionId, previousTranscriptionId: current.value.transcriptionId, transcriptionId: created.transcription.transcriptionId } });
    return Response.json({ data: created.transcription, requestId }, { status: 201, headers: { "x-request-id": requestId, etag: created.etag } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
