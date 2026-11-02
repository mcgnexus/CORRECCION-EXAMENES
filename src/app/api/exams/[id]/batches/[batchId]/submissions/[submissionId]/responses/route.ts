import { requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getEvaluationRepository, getResponseDecisionRepository, getResponseRegionRepository, getSubmissionRepository, getTranscriptionRepository } from "@/repositories";

export async function GET(_request: Request, context: { params: Promise<{ id: string; batchId: string; submissionId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const submission = await getSubmissionRepository().get(ownerId, params.batchId, params.submissionId);
    if (!submission || submission.value.examId !== params.id) throw new AppError("NOT_FOUND", "Entrega no encontrada.", 404);
    const [regions, transcriptions, evaluations, decisions] = await Promise.all([
      getResponseRegionRepository().getActive(ownerId, params.submissionId),
      getTranscriptionRepository().list(ownerId, params.submissionId),
      getEvaluationRepository().list(ownerId, params.submissionId),
      getResponseDecisionRepository().list(ownerId, params.submissionId),
    ]);
    return Response.json({ data: { regions: regions?.revision ?? null, transcriptions: transcriptions.map((item) => ({ ...item.value, etag: item.etag })), evaluations: evaluations.map((item) => ({ ...item.value, etag: item.etag })), decisions: decisions.map((item) => ({ ...item.value, etag: item.etag })), blockingIssues: submission.value.responseBlockingIssues }, requestId }, { headers: { "x-request-id": requestId, etag: regions?.pointerEtag ?? "" } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
