import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { authorizeExamUpload } from "@/lib/upload-handler";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const result = await authorizeExamUpload(request, ownerId);
    return Response.json({ ...result, requestId }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
