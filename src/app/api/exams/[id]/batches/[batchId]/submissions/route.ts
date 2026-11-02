import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getAssetRepository, getBatchRepository, getDocumentPagesRepository, getSubmissionRepository } from "@/repositories";
import { start } from "workflow/api";
import { readSubmissionOmrWorkflow } from "@/workflows/phase3-workflows";

const createSchema = z.object({ assetIds: z.array(z.string().min(1)).min(1) });

export async function POST(request: Request, context: { params: Promise<{ id: string; batchId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const batch = await getBatchRepository().get(ownerId, params.id, params.batchId);
    if (!batch) throw new AppError("NOT_FOUND", "Lote no encontrado.", 404);
    const input = createSchema.parse(await request.json());
    if (input.assetIds.length > batch.value.maxPages) throw new AppError("BATCH_PAGE_LIMIT", "La entrega supera el límite de páginas del lote.", 413);
    const assets = await Promise.all(input.assetIds.map((assetId) => getAssetRepository().getWithMeta(ownerId, assetId)));
    if (assets.some((asset) => !asset || asset.asset.state !== "validated" || asset.asset.examId !== params.id)) throw new AppError("INVALID_PAGE_ASSET", "Algunos assets no son válidos para este examen.", 400);
    const pages = await getDocumentPagesRepository().initialize(ownerId, params.id);
    const pageIds = input.assetIds.map((assetId) => pages.manifest.pages.find((page) => page.sourceAssetId === assetId)?.pageId ?? assetId);
    const submission = await getSubmissionRepository().create({ batchId: params.batchId, examId: params.id, ownerId, pageIds, assetIds: input.assetIds });
    const batchUpdate = await getBatchRepository().update(ownerId, params.id, params.batchId, batch.etag, { submissionIds: [...batch.value.submissionIds, submission.submission.submissionId], state: batch.value.state === "draft" ? "reading" : batch.value.state });
    return Response.json({ data: submission.submission, batch: batchUpdate.value, requestId }, { status: 201, headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string; batchId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const body = (await request.json()) as { submissionId?: string };
    if (!body.submissionId) throw new AppError("SUBMISSION_REQUIRED", "Falta submissionId.", 400);
    const submission = await getSubmissionRepository().get(ownerId, params.batchId, body.submissionId);
    if (!submission) throw new AppError("NOT_FOUND", "Entrega no encontrada.", 404);
    const batch = await getBatchRepository().get(ownerId, params.id, params.batchId);
    if (!batch) throw new AppError("NOT_FOUND", "Lote no encontrado.", 404);
    const run = await start(readSubmissionOmrWorkflow, [{ ownerId, examId: params.id, batchId: params.batchId, submissionId: submission.value.submissionId, templateRevisionId: batch.value.templateRevisionId }]);
    await getSubmissionRepository().update(ownerId, params.batchId, submission.value.submissionId, submission.etag, { state: "reading" });
    return Response.json({ data: { runId: run.runId, submissionId: submission.value.submissionId }, requestId }, { status: 202, headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
