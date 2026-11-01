import { getAssetRepository, getAuditRepository, getDocumentPagesRepository } from "@/repositories";
import { getBlobStore } from "@/repositories/blob-store";
import { AppError } from "./errors";
import { inspectUpload } from "./upload-validation";

export async function completeUploadedAsset(input: { ownerId: string; examId: string; assetId: string; pathname: string }) {
  const expectedPath = `owners/${input.ownerId}/exams/${input.examId}/assets/${input.assetId}/original`;
  if (input.pathname !== expectedPath) throw new AppError("INVALID_UPLOAD_PATH", "La ruta no pertenece al examen o propietario.", 400);
  const store = getBlobStore();
  const stored = await store.get(input.pathname);
  if (!stored) throw new AppError("ASSET_NOT_FOUND", "El objeto subido no está disponible.", 404);
  try {
    const inspection = await inspectUpload(stored.body, stored.contentType);
    const asset = await getAssetRepository().create({
      assetId: input.assetId,
      ownerId: input.ownerId,
      examId: input.examId,
      kind: "original",
      state: "validated",
      origin: "upload",
      sha256: inspection.sha256,
      mimeType: inspection.mimeType,
      blobPath: input.pathname,
      sizeBytes: inspection.sizeBytes,
      width: inspection.width,
      height: inspection.height,
      pageCount: inspection.pageCount,
    });
    await getDocumentPagesRepository().appendAssetPages(asset);
    await getAuditRepository().append({ ownerId: input.ownerId, actorId: input.ownerId, type: "asset.validated", aggregateType: "asset", aggregateId: input.assetId, payload: { examId: input.examId, mimeType: inspection.mimeType, pageCount: inspection.pageCount ?? 1 } });
    return asset;
  } catch (error) {
    await store.delete(input.pathname).catch(() => undefined);
    throw error;
  }
}
