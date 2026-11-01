import { requireOwner } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { geminiCapabilities } from "@/providers/gemini";
import { deepseekCapabilities } from "@/providers/deepseek";

export async function POST() {
  const requestId = crypto.randomUUID();
  try {
    await requireOwner();
    return Response.json(
      {
        requestId,
        data: {
          gemini: geminiCapabilities(),
          deepseek: deepseekCapabilities(),
          blob: { configured: Boolean(process.env.BLOB_READ_WRITE_TOKEN), privateAccessVerified: false },
        },
      },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
