import { start } from "workflow/api";
import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getDocumentPagesRepository, getExamRevisionRepository, getIdempotencyRepository } from "@/repositories";
import { extractStructureWorkflow } from "@/workflows/phase2-workflows";

const bodySchema = z.object({ expectedPagesEtag: z.string().min(1), language: z.string().min(2).max(20).default("es") });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const examId = (await context.params).id;
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "Falta Idempotency-Key.", 400);
    const input = bodySchema.parse(await request.json());
    const pages = await getDocumentPagesRepository().getWithMeta(ownerId, examId);
    if (!pages) throw new AppError("PAGES_REQUIRED", "El examen todavía no tiene páginas.", 409);
    if (pages.etag !== input.expectedPagesEtag) throw new AppError("ETAG_CONFLICT", "Las páginas cambiaron antes de iniciar extracción.", 409);
    const outcome = await getIdempotencyRepository().execute(ownerId, "extract-structure", idempotencyKey, async () => {
      const revision = await getExamRevisionRepository().create(ownerId, examId, pages.etag, pages.manifest.pages.map((page) => page.pageId));
      const run = await start(extractStructureWorkflow, [{ ownerId, examId, revisionId: revision.revision.examRevisionId }]);
      return { revisionId: revision.revision.examRevisionId, runId: run.runId, language: input.language };
    });
    return Response.json({ data: outcome.result, replayed: outcome.replayed, requestId }, { status: outcome.replayed ? 200 : 202, headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
