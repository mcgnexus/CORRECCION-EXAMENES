import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getAssetRepository, getAuditRepository, getDocumentPagesRepository } from "@/repositories";
import { getBlobStore } from "@/repositories/blob-store";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const assetId = (await context.params).id;
    const repository = getAssetRepository();
    const current = await repository.getWithMeta(ownerId, assetId);
    if (!current || current.asset.state === "deleted") throw new AppError("NOT_FOUND", "Asset no encontrado.", 404);
    const deleting = await repository.updateState(ownerId, assetId, current.etag, "deleting");
    await getBlobStore().delete(deleting.blobPath);
    if (deleting.examId) await getDocumentPagesRepository().removeAssetPages(ownerId, deleting.examId, assetId);
    const deleted = await repository.updateState(ownerId, assetId, deleting.etag ?? "", "deleted");
    await getAuditRepository().append({ ownerId, actorId: ownerId, type: "asset.deleted", aggregateType: "asset", aggregateId: assetId, payload: { blobPath: current.asset.blobPath } });
    return Response.json({ data: deleted, requestId }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
