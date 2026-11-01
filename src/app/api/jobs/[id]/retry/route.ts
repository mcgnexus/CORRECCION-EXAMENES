import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getJobRepository } from "@/repositories";

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
    const job = await repository.update(ownerId, current.job.jobId, expectedEtag, { status: "queued", attempt: current.job.attempt + 1, errorCode: undefined });
    return Response.json({ data: job, requestId }, { status: 202, headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
