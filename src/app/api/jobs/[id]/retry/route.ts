import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getJobRepository } from "@/repositories";
import { start } from "workflow/api";
import { exportClosedBatchWorkflow } from "@/workflows/phase5-workflows";
import { processBatchWorkflow } from "@/workflows/batch-processing-workflows";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const expectedEtag = request.headers.get("if-match");
    if (!expectedEtag) throw new AppError("ETAG_REQUIRED", "Falta If-Match.", 400);
    const repository = getJobRepository();
    const current = await repository.getWithMeta(ownerId, (await context.params).id);
    if (!current) throw new AppError("NOT_FOUND", "Trabajo no encontrado.", 404);
    if (current.job.status !== "failed" || !current.job.retryable) throw new AppError("JOB_NOT_RETRYABLE", "El trabajo no está en un estado reintentable.", 409);
    const job = await repository.update(ownerId, current.job.jobId, expectedEtag, { status: "queued", phase: "queued", step: "queued", attempt: current.job.attempt + 1, errorCode: undefined, cancelRequestedAt: undefined, progress: { phase: "queued", current: 0, completed: 0, total: current.job.progress.total, percent: 0 } });
    if (job.kind === "export" && job.exportRequest) await start(exportClosedBatchWorkflow, [{ ownerId, examId: job.exportRequest.examId, batchId: job.exportRequest.batchId, jobId: job.jobId, formats: job.exportRequest.formats, includeOriginal: job.exportRequest.includeOriginal, retentionHours: job.exportRequest.retentionHours }]);
    if (job.kind === "batch" && job.batchRequest) await start(processBatchWorkflow, [{ ownerId, examId: job.batchRequest.examId, batchId: job.batchRequest.batchId, jobId: job.jobId, answerKeyRevisionId: job.batchRequest.answerKeyRevisionId, templateRevisionId: job.batchRequest.templateRevisionId, scoringPolicyRevisionId: job.batchRequest.scoringPolicyRevisionId, concurrency: job.batchRequest.concurrency, maxAttempts: job.batchRequest.maxAttempts }]);
    const refreshed = await repository.getWithMeta(ownerId, current.job.jobId);
    return Response.json({ data: job, requestId }, { status: 202, headers: { "x-request-id": requestId, ...(refreshed ? { etag: refreshed.etag } : {}) } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
