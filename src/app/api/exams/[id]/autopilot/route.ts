import { getRun, start } from "workflow/api";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getDocumentPagesRepository, getExamRepository, getExamRevisionRepository, getIdempotencyRepository } from "@/repositories";
import { examAutopilotWorkflow } from "@/workflows/phase2-workflows";

const STARTUP_GRACE_MS = 30_000;
const ACTIVE_STATUSES = ["extracting", "solving"] as const;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const examId = (await context.params).id;
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "Falta Idempotency-Key.", 400);
    const exams = getExamRepository();
    const revisions = getExamRevisionRepository();
    let exam = await exams.getWithMeta(ownerId, examId);
    if (!exam) throw new AppError("NOT_FOUND", "Examen no encontrado.", 404);
    let pages = await getDocumentPagesRepository().getWithMeta(ownerId, examId);
    if (!pages || pages.manifest.pages.length === 0) throw new AppError("PAGES_REQUIRED", "Sube las páginas del examen antes de que la IA lo lea.", 409);

    if (exam.exam.activeRevisionId) {
      const current = await revisions.get(ownerId, examId, exam.exam.activeRevisionId);
      if (current && ACTIVE_STATUSES.includes(current.value.status as typeof ACTIVE_STATUSES[number])) {
        if (current.value.workflowRunId) {
          let status: string;
          try { status = await getRun(current.value.workflowRunId).status; }
          catch { throw new AppError("AUTOPILOT_STATUS_UNAVAILABLE", "No se pudo comprobar la ejecución actual. Reintenta en unos instantes.", 503, true); }
          if (["queued", "running"].includes(status)) {
            return Response.json({ data: { revisionId: current.value.examRevisionId, runId: current.value.workflowRunId }, replayed: true, requestId }, { status: 202, headers: { "x-request-id": requestId } });
          }
        } else if (Date.now() - Date.parse(current.value.createdAt) < STARTUP_GRACE_MS) {
          throw new AppError("AUTOPILOT_STARTING", "La ejecución está arrancando. Reintenta en unos instantes.", 503, true);
        }

        try { await revisions.update(ownerId, examId, current.value.examRevisionId, current.etag, { status: "stale", blockingIssues: ["AUTOPILOT_INTERRUPTED"] }); }
        catch { throw new AppError("AUTOPILOT_RECOVERY_CONFLICT", "La revisión está cambiando en otra petición. Reintenta.", 409, true); }
        exam = await exams.getWithMeta(ownerId, examId);
        if (!exam) throw new AppError("NOT_FOUND", "Examen no encontrado.", 404);
        pages = await getDocumentPagesRepository().getWithMeta(ownerId, examId);
        if (!pages || pages.manifest.pages.length === 0) throw new AppError("PAGES_REQUIRED", "Sube las páginas del examen antes de que la IA lo lea.", 409);
      }
    }

    const outcome = await getIdempotencyRepository().execute(ownerId, "exam-autopilot", idempotencyKey, async () => {
      const revision = await revisions.create(ownerId, examId, pages!.etag, pages!.manifest.pages.map((page) => page.pageId));
      try { await exams.update(ownerId, examId, exam!.etag, { activeRevisionId: revision.revision.examRevisionId, state: "extracting" }); }
      catch { throw new AppError("AUTOPILOT_START_CONFLICT", "El examen cambió durante el inicio. Reintenta.", 409, true); }
      const run = await start(examAutopilotWorkflow, [{ ownerId, examId, revisionId: revision.revision.examRevisionId }]);
      try {
        await revisions.update(ownerId, examId, revision.revision.examRevisionId, revision.etag, { workflowRunId: run.runId });
      } catch {
        let status: string;
        try { status = await getRun(run.runId).status; }
        catch { throw new AppError("AUTOPILOT_STATUS_UNAVAILABLE", "La ejecución arrancó, pero todavía no se pudo confirmar. Reintenta.", 503, true); }
        if (["queued", "running"].includes(status)) return { revisionId: revision.revision.examRevisionId, runId: run.runId };
        throw new AppError("AUTOPILOT_START_CONFLICT", "No se pudo asociar la ejecución a la revisión. Reintenta.", 409, true);
      }
      return { revisionId: revision.revision.examRevisionId, runId: run.runId };
    });
    return Response.json({ data: outcome.result, replayed: outcome.replayed, requestId }, { status: outcome.replayed ? 200 : 202, headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
