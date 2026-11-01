import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getAssetRepository, getDocumentPagesRepository, getExamRepository } from "@/repositories";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { ownerId } = await requireOwner();
    const examId = (await context.params).id;
    if (!(await getExamRepository().get(ownerId, examId))) throw new AppError("NOT_FOUND", "Examen no encontrado.", 404);
    return Response.json({ data: await getAssetRepository().listByExam(ownerId, examId), requestId }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const examId = (await context.params).id;
    const assetId = request.headers.get("x-asset-id");
    if (!assetId) throw new AppError("ASSET_REQUIRED", "Falta x-asset-id.", 400);
    const repository = getAssetRepository();
    const current = await repository.getWithMeta(ownerId, assetId);
    if (!current || current.asset.examId !== examId) throw new AppError("NOT_FOUND", "Asset no encontrado.", 404);
    const deleting = await repository.updateState(ownerId, assetId, current.etag, "deleting");
    const { getBlobStore } = await import("@/repositories/blob-store");
    await getBlobStore().delete(deleting.blobPath);
    await getDocumentPagesRepository().removeAssetPages(ownerId, examId, assetId);
    const deleted = await repository.updateState(ownerId, assetId, deleting.etag ?? "", "deleted");
    return Response.json({ data: deleted, requestId }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
