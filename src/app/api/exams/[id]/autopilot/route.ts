import { start } from "workflow/api";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getDocumentPagesRepository, getExamRepository, getExamRevisionRepository, getIdempotencyRepository } from "@/repositories";
import { examAutopilotWorkflow } from "@/workflows/phase2-workflows";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const examId = (await context.params).id;
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "Falta Idempotency-Key.", 400);
    const exam = await getExamRepository().getWithMeta(ownerId, examId);
    if (!exam) throw new AppError("NOT_FOUND", "Examen no encontrado.", 404);
    const pages = await getDocumentPagesRepository().getWithMeta(ownerId, examId);
    if (!pages || pages.manifest.pages.length === 0) throw new AppError("PAGES_REQUIRED", "Sube las páginas del examen antes de que la IA lo lea.", 409);
    if (exam.exam.activeRevisionId) {
      const current = await getExamRevisionRepository().get(ownerId, examId, exam.exam.activeRevisionId);
      if (current && ["extracting", "solving"].includes(current.value.status)) throw new AppError("AUTOPILOT_IN_PROGRESS", "La IA ya está procesando este examen.", 409, true);
    }
    const outcome = await getIdempotencyRepository().execute(ownerId, "exam-autopilot", idempotencyKey, async () => {
      const revision = await getExamRevisionRepository().create(ownerId, examId, pages.etag, pages.manifest.pages.map((page) => page.pageId));
      const updatedExam = await getExamRepository().update(ownerId, examId, exam.etag, { activeRevisionId: revision.revision.examRevisionId, state: "extracting" });
      void updatedExam;
      const run = await start(examAutopilotWorkflow, [{ ownerId, examId, revisionId: revision.revision.examRevisionId }]);
      return { revisionId: revision.revision.examRevisionId, runId: run.runId };
    });
    return Response.json({ data: outcome.result, replayed: outcome.replayed, requestId }, { status: outcome.replayed ? 200 : 202, headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
