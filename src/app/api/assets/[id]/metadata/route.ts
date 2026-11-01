import { requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getAssetRepository } from "@/repositories";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { ownerId } = await requireOwner();
    const result = await getAssetRepository().getWithMeta(ownerId, (await context.params).id);
    if (!result || result.asset.state === "deleted") throw new AppError("NOT_FOUND", "Asset no encontrado.", 404);
    return Response.json({ data: result.asset, requestId }, { headers: { "x-request-id": requestId, etag: result.etag } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
