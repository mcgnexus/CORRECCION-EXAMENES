import { requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getBatchRepository } from "@/repositories";

export async function GET(_request: Request, context: { params: Promise<{ id: string; batchId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const result = await getBatchRepository().get(ownerId, params.id, params.batchId);
    if (!result) throw new AppError("NOT_FOUND", "Lote no encontrado.", 404);
    return Response.json({ data: result.value, requestId }, { headers: { "x-request-id": requestId, etag: result.etag } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
