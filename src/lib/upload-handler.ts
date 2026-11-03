import { AppError } from "./errors";
import { getBlobStore } from "@/repositories/blob-store";
import { allowedUploadTypes, MAX_UPLOAD_BYTES } from "./upload-validation";

const assetPathPattern = /^owners\/([^/]+)\/exams\/([^/]+)\/assets\/([0-9a-f-]{36})\/original$/;

export async function authorizeExamUpload(request: Request, ownerId: string, expectedExamId?: string) {
  const body = await request.json();
  const pathname = body?.pathname;
  const contentType = body?.contentType;
  if (typeof pathname !== "string" || pathname.includes("..")) throw new AppError("INVALID_UPLOAD_PATH", "La ruta de subida no es válida.", 400);
  const match = assetPathPattern.exec(pathname);
  if (!match || match[1] !== ownerId || (expectedExamId && match[2] !== expectedExamId)) throw new AppError("INVALID_UPLOAD_PATH", "La ruta no pertenece al examen o propietario.", 400);
  if (!(allowedUploadTypes as readonly string[]).includes(contentType)) throw new AppError("INVALID_UPLOAD_TYPE", "El tipo de archivo no está permitido.", 400);
  if (Number(body?.sizeBytes) > MAX_UPLOAD_BYTES) throw new AppError("FILE_TOO_LARGE", "El archivo supera 25 MB.", 413);
  const store = getBlobStore();
  if (!store.createSignedUploadUrl) throw new AppError("SUPABASE_STORAGE_NOT_ACTIVE", "Supabase Storage aún no está activado para la aplicación.", 503, true);
  return { data: await store.createSignedUploadUrl(pathname), contentType };
}
