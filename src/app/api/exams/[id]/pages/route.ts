import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getAssetRepository, getDocumentPagesRepository, getExamRepository } from "@/repositories";
import { documentGroupSchema, documentPageSchema } from "@/domain/schemas";

const updateSchema = z.object({ expectedEtag: z.string().min(1), pages: z.array(documentPageSchema), groups: z.array(documentGroupSchema) });

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { ownerId } = await requireOwner();
    const examId = (await context.params).id;
    if (!(await getExamRepository().get(ownerId, examId))) throw new AppError("NOT_FOUND", "Examen no encontrado.", 404);
    const result = await getDocumentPagesRepository().initialize(ownerId, examId);
    return Response.json({ data: result.manifest, requestId }, { headers: { "x-request-id": requestId, etag: result.etag } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const examId = (await context.params).id;
    if (!(await getExamRepository().get(ownerId, examId))) throw new AppError("NOT_FOUND", "Examen no encontrado.", 404);
    const input = updateSchema.parse(await request.json());
    const assets = getAssetRepository();
    for (const page of input.pages) {
      const asset = await assets.getWithMeta(ownerId, page.sourceAssetId);
      if (!asset || asset.asset.examId !== examId || asset.asset.state !== "validated") throw new AppError("INVALID_PAGE_ASSET", "La página referencia un asset inválido.", 400);
    }
    const result = await getDocumentPagesRepository().replace(ownerId, examId, input.expectedEtag, input.pages, input.groups);
    return Response.json({ data: result.manifest, requestId }, { headers: { "x-request-id": requestId, etag: result.etag } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
