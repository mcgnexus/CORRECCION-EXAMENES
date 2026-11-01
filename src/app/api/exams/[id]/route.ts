import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getExamRepository } from "@/repositories";

const patchSchema = z.object({
  expectedEtag: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  subject: z.string().trim().min(1).max(200).optional(),
  state: z.enum(["draft", "extracting", "structure_review", "solving", "key_review", "approved"]).optional(),
  activeRevisionId: z.string().min(1).optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { ownerId } = await requireOwner();
    const result = await getExamRepository().getWithMeta(ownerId, (await context.params).id);
    if (!result) throw new AppError("NOT_FOUND", "Examen no encontrado.", 404);
    return Response.json({ data: result.exam, requestId }, { headers: { "x-request-id": requestId, etag: result.etag } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const input = patchSchema.parse(await request.json());
    const { expectedEtag, ...patch } = input;
    const exam = await getExamRepository().update(ownerId, (await context.params).id, expectedEtag, patch);
    return Response.json({ data: exam, requestId }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
