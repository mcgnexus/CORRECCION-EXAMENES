import { handleUpload } from "@vercel/blob/client";
import { completeUploadedAsset } from "./asset-completion";
import { AppError } from "./errors";
import { allowedUploadTypes, MAX_UPLOAD_BYTES } from "./upload-validation";

const assetPathPattern = /^owners\/([^/]+)\/exams\/([^/]+)\/assets\/([0-9a-f-]{36})\/original$/;

export async function authorizeExamUpload(request: Request, ownerId: string, expectedExamId?: string) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new AppError("BLOB_NOT_CONFIGURED", "BLOB_READ_WRITE_TOKEN no está configurado.", 503);
  const body = await request.json();
  const pathname = body?.payload?.pathname;
  if (typeof pathname !== "string" || pathname.includes("..")) throw new AppError("INVALID_UPLOAD_PATH", "La ruta de subida no es válida.", 400);
  const match = assetPathPattern.exec(pathname);
  if (!match || match[1] !== ownerId || (expectedExamId && match[2] !== expectedExamId)) throw new AppError("INVALID_UPLOAD_PATH", "La ruta no pertenece al examen o propietario.", 400);
  const examId = match[2];
  const assetId = match[3];
  return handleUpload({
    request,
    body,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    onBeforeGenerateToken: async () => ({
      allowedContentTypes: [...allowedUploadTypes],
      maximumSizeInBytes: MAX_UPLOAD_BYTES,
      validUntil: Date.now() + 10 * 60 * 1000,
      addRandomSuffix: false,
      allowOverwrite: false,
      tokenPayload: JSON.stringify({ ownerId, examId, assetId }),
    }),
    onUploadCompleted: async ({ blob }) => {
      if (blob.pathname !== pathname) throw new AppError("INVALID_UPLOAD_PATH", "La subida completada no coincide con la ruta autorizada.", 400);
      await completeUploadedAsset({ ownerId, examId, assetId, pathname: blob.pathname });
    },
  });
}
