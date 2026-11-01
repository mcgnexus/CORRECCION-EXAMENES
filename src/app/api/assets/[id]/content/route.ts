import { requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getAssetRepository } from "@/repositories";
import { getBlobStore } from "@/repositories/blob-store";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { ownerId } = await requireOwner();
    const result = await getAssetRepository().getWithMeta(ownerId, (await context.params).id);
    if (!result || result.asset.state !== "validated") throw new AppError("NOT_FOUND", "Asset no encontrado.", 404);
    const stored = await getBlobStore().get(result.asset.blobPath);
    if (!stored) throw new AppError("NOT_FOUND", "Contenido no encontrado.", 404);
    return new Response(stored.body as unknown as BodyInit, { headers: { "content-type": stored.contentType, "content-length": String(stored.body.byteLength), "cache-control": "private, no-store", etag: stored.etag, "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
