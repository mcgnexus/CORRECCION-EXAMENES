import { requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getExportRepository } from "@/repositories";
import { getBlobStore } from "@/repositories/blob-store";

export async function GET(_request: Request, context: { params: Promise<{ exportId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { ownerId } = await requireOwner();
    const { exportId } = await context.params;
    const result = await getExportRepository().getWithMeta(ownerId, exportId);
    if (!result || result.manifest.state !== "available") throw new AppError("EXPORT_NOT_AVAILABLE", "La exportación no está disponible.", 404);
    if (Date.parse(result.manifest.expiresAt) <= Date.now()) throw new AppError("EXPORT_EXPIRED", "La exportación ha expirado.", 410);
    const body = await getBlobStore().get(result.manifest.blobPath);
    if (!body) throw new AppError("EXPORT_CONTENT_MISSING", "El contenido de la exportación no existe.", 404);
    const extension = result.manifest.format;
    return new Response(body.body as unknown as BodyInit, { headers: { "content-type": result.manifest.mimeType, "content-length": String(body.body.byteLength), "content-disposition": `attachment; filename="${result.manifest.batchId}-${result.manifest.exportId}.${extension}"`, "cache-control": "private, no-store", "x-export-expires-at": result.manifest.expiresAt, "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
