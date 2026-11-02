import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getManualDecisionRepository, getOmrReadingRepository, getScoreSnapshotRepository, getSubmissionRepository, getBatchRepository, getAnswerKeyRepository } from "@/repositories";
import { computeScore } from "@/domain/phase3-scoring";
import { defaultScoringPolicy } from "@/domain/defaults";
import type { OmrReading } from "@/domain/phase3-schemas";

const decisionSchema = z.object({
  readingId: z.string().min(1),
  questionId: z.string().min(1),
  originalStatus: z.enum(["single", "blank", "multiple", "ambiguous", "unreadable"]),
  resolvedStatus: z.enum(["single", "blank"]),
  selectedOptionIds: z.array(z.string().min(1)),
  reason: z.string().min(1),
});

const decideSchema = z.object({ decisions: z.array(decisionSchema).min(1) });

const scoreSchema = z.object({ expectedEtag: z.string().min(1).optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string; batchId: string; submissionId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const submission = await getSubmissionRepository().get(ownerId, params.batchId, params.submissionId);
    if (!submission) throw new AppError("NOT_FOUND", "Entrega no encontrada.", 404);
    const body = await request.json() as { action?: string };
    if (body.action === "decide") {
      const input = decideSchema.parse(body);
      for (const decision of input.decisions) {
        const reading = await getOmrReadingRepository().get(ownerId, decision.readingId);
        if (!reading || reading.value.submissionId !== submission.value.submissionId) throw new AppError("INVALID_READING", "La lectura no pertenece a la entrega.", 400);
        const row = reading.value.rows.find((item) => item.questionId === decision.questionId);
        if (!row || row.status !== decision.originalStatus) throw new AppError("DECISION_CONFLICT", "La fila cambió desde que se cargó.", 409);
        await getManualDecisionRepository().create({ readingId: decision.readingId, questionId: decision.questionId, originalStatus: decision.originalStatus, resolvedStatus: decision.resolvedStatus, selectedOptionIds: decision.selectedOptionIds, actorId: ownerId, reason: decision.reason });
        const updatedRows = reading.value.rows.map((item) => item.questionId === decision.questionId ? { ...item, status: decision.resolvedStatus, selectedOptionIds: decision.selectedOptionIds, requiresHumanReview: false } : item);
        const reviewed = await getOmrReadingRepository().update(ownerId, decision.readingId, reading.etag, { rows: updatedRows, status: "reviewed" });
        void reviewed;
      }
      const refreshed = await getSubmissionRepository().get(ownerId, params.batchId, params.submissionId);
      if (refreshed) await getSubmissionRepository().update(ownerId, params.batchId, params.submissionId, refreshed.etag, { state: "review" });
      return Response.json({ ok: true, requestId }, { headers: { "x-request-id": requestId } });
    }

    if (body.action === "confirm-identity") {
      const identitySchema = z.object({ identity: z.string().min(1).max(200) });
      const input = identitySchema.parse(body);
      const refreshed = await getSubmissionRepository().get(ownerId, params.batchId, params.submissionId);
      if (!refreshed) throw new AppError("NOT_FOUND", "Entrega no encontrada.", 404);
      const updated = await getSubmissionRepository().update(ownerId, params.batchId, params.submissionId, refreshed.etag, { confirmedIdentity: input.identity, confirmedBy: ownerId, confirmedAt: new Date().toISOString(), identitySource: "manual", state: "review" });
      return Response.json({ data: updated.value, requestId }, { headers: { "x-request-id": requestId } });
    }

    if (body.action === "score") {
      const refreshed = await getSubmissionRepository().get(ownerId, params.batchId, params.submissionId);
      if (!refreshed) throw new AppError("NOT_FOUND", "Entrega no encontrada.", 404);
      if (!refreshed.value.confirmedIdentity) throw new AppError("SUBMISSION_UNASSIGNED", "Confirma la identidad antes de puntuar.", 409);
      if (refreshed.value.readingIds.length === 0) throw new AppError("READINGS_REQUIRED", "La entrega no tiene lecturas.", 409);
      const batch = await getBatchRepository().get(ownerId, params.id, params.batchId);
      if (!batch) throw new AppError("NOT_FOUND", "Lote no encontrado.", 404);
      const answerKey = await getAnswerKeyRepository().get(ownerId, params.id, batch.value.answerKeyRevisionId);
      if (!answerKey || answerKey.value.status !== "approved") throw new AppError("ANSWER_KEY_STALE", "El solucionario debe estar aprobado.", 409);
      const readings = (await Promise.all(refreshed.value.readingIds.map((readingId) => getOmrReadingRepository().get(ownerId, readingId)))).filter((reading): reading is { value: OmrReading; etag: string } => Boolean(reading));
      const answersByQuestion: Record<string, { correctOptionIds: string[] }> = {};
      const manualSelections: Record<string, { selectedOptionIds: string[]; status: "single" | "blank" }> = {};
      for (const [questionId, decision] of Object.entries(answerKey.value.decisions)) {
        const raw = decision.answer as { selectedOptionIds?: string[] } | string[] | null;
        const selected = Array.isArray(raw) ? raw : raw?.selectedOptionIds;
        if (Array.isArray(selected)) answersByQuestion[questionId] = { correctOptionIds: selected.map(String) };
      }
      for (const reading of readings) {
        void reading;
      }
      const { computation } = computeScore({
        submissionId: submission.value.submissionId,
        batchId: params.batchId,
        examId: params.id,
        ownerId,
        answerKeyRevisionId: batch.value.answerKeyRevisionId,
        templateRevisionId: batch.value.templateRevisionId,
        readings: readings.map((reading) => reading.value),
        answersByQuestion,
        manualSelections,
        policy: defaultScoringPolicy,
      });
      const snapshot = await getScoreSnapshotRepository().create(computation);
      await getSubmissionRepository().update(ownerId, params.batchId, params.submissionId, refreshed.etag, { state: computation.blockingIssues.length === 0 ? "scored" : "review", snapshotId: snapshot.snapshot.snapshotId });
      return Response.json({ data: snapshot.snapshot, requestId }, { status: 201, headers: { "x-request-id": requestId } });
    }

    throw new AppError("UNKNOWN_ACTION", "Acción no soportada.", 400);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
