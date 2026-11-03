import { getAssetRepository, getAuditRepository, getDocumentPagesRepository } from "@/repositories";
import { getBlobStore } from "@/repositories/blob-store";
import { AppError } from "./errors";
import { inspectUpload } from "./upload-validation";

export type UploadPurpose = "exam_source" | "student_submission";

export function validateUploadPurpose(purpose: UploadPurpose, mimeType: string) {
  if (purpose === "student_submission" && !["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    throw new AppError("STUDENT_UPLOAD_IMAGE_REQUIRED", "Las entregas de alumnos solo admiten imágenes JPEG, PNG o WebP.", 400);
  }
}

export async function completeUploadedAsset(input: { ownerId: string; examId: string; assetId: string; pathname: string; contentType?: string; purpose: UploadPurpose }) {
  const expectedPath = `owners/${input.ownerId}/exams/${input.examId}/assets/${input.assetId}/original`;
  if (input.pathname !== expectedPath) throw new AppError("INVALID_UPLOAD_PATH", "La ruta no pertenece al examen o propietario.", 400);
  const store = getBlobStore();
  if (store.registerExternal) {
    if (!input.contentType) throw new AppError("INVALID_UPLOAD_TYPE", "Falta el tipo del archivo subido.", 400);
    await store.registerExternal(input.pathname, input.contentType);
  }
  const stored = await store.get(input.pathname);
  if (!stored) throw new AppError("ASSET_NOT_FOUND", "El objeto subido no está disponible.", 404);
  try {
    const inspection = await inspectUpload(stored.body, stored.contentType);
    validateUploadPurpose(input.purpose, inspection.mimeType);
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
    if (input.purpose === "exam_source") await getDocumentPagesRepository().appendAssetPages(asset);
    await getAuditRepository().append({ ownerId: input.ownerId, actorId: input.ownerId, type: "asset.validated", aggregateType: "asset", aggregateId: input.assetId, payload: { examId: input.examId, mimeType: inspection.mimeType, pageCount: inspection.pageCount ?? 1 } });
    return asset;
  } catch (error) {
    await store.delete(input.pathname).catch(() => undefined);
    throw error;
  }
}
