import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { completeUploadedAsset } from "@/lib/asset-completion";

const bodySchema = z.object({ assetId: z.string().uuid(), pathname: z.string().min(1) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const input = bodySchema.parse(await request.json());
    const asset = await completeUploadedAsset({ ownerId, examId: (await context.params).id, ...input });
    return Response.json({ data: asset, requestId }, { status: 201, headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
