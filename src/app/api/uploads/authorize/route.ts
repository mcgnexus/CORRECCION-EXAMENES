import { handleUpload } from "@vercel/blob/client";
import { requireOwner, assertSameOrigin } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new AppError("BLOB_NOT_CONFIGURED", "BLOB_READ_WRITE_TOKEN no está configurado.", 503);
    const body = await request.json();
    const pathname = body?.payload?.pathname;
    const allowedPrefix = `owners/${ownerId}/`;
    if (typeof pathname !== "string" || !pathname.startsWith(allowedPrefix) || pathname.includes("..")) {
      throw new AppError("INVALID_UPLOAD_PATH", "La ruta de subida no pertenece al propietario.", 400);
    }
    const result = await handleUpload({
      request,
      body,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["image/jpeg", "image/png", "application/pdf", "image/webp"],
        maximumSizeInBytes: 25 * 1024 * 1024,
        validUntil: Date.now() + 10 * 60 * 1000,
        addRandomSuffix: true,
        allowOverwrite: false,
      }),
      onUploadCompleted: async ({ blob }) => {
        if (!blob.pathname.startsWith(allowedPrefix)) throw new AppError("INVALID_UPLOAD_PATH", "La subida completada no pertenece al propietario.", 400);
      },
    });
    return Response.json({ ...result, requestId }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
