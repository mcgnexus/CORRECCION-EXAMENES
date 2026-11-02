import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getAnswerKeyRepository, getBatchRepository, getManualDecisionRepository, getOmrReadingRepository, getResponseDecisionRepository, getScoreSnapshotRepository, getSubmissionRepository, getTranscriptionRepository } from "@/repositories";
import { computeScore } from "@/domain/phase3-scoring";
import { computeMixedScore } from "@/domain/phase4-scoring";
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

export async function GET(_request: Request, context: { params: Promise<{ id: string; batchId: string; submissionId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const submission = await getSubmissionRepository().get(ownerId, params.batchId, params.submissionId);
    if (!submission) throw new AppError("NOT_FOUND", "Entrega no encontrada.", 404);
    const readings = await getOmrReadingRepository().list(ownerId, submission.value.readingIds);
    const decisions = await getManualDecisionRepository().listByReadings(ownerId, submission.value.readingIds);
    const snapshot = submission.value.snapshotId ? await getScoreSnapshotRepository().get(ownerId, submission.value.snapshotId) : null;
    return Response.json({ data: { submission: submission.value, readings: readings.map((item) => item.value), decisions, snapshot: snapshot?.value ?? null, snapshotEtag: snapshot?.etag ?? null }, requestId }, { headers: { "x-request-id": requestId, etag: submission.etag } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

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
      const grouped = new Map<string, typeof input.decisions>();
      for (const decision of input.decisions) grouped.set(decision.readingId, [...(grouped.get(decision.readingId) ?? []), decision]);
      for (const [readingId, decisions] of grouped) {
        const reading = await getOmrReadingRepository().get(ownerId, readingId);
        if (!reading || reading.value.submissionId !== submission.value.submissionId) throw new AppError("INVALID_READING", "La lectura no pertenece a la entrega.", 400);
        const decisionQuestions = new Set<string>();
        let updatedRows = reading.value.rows;
        for (const decision of decisions) {
          if (decisionQuestions.has(decision.questionId)) throw new AppError("DECISION_CONFLICT", "No se puede resolver dos veces la misma fila en una petición.", 409);
          decisionQuestions.add(decision.questionId);
          const row = updatedRows.find((item) => item.questionId === decision.questionId);
          if (!row || row.status !== decision.originalStatus) throw new AppError("DECISION_CONFLICT", "La fila cambió desde que se cargó.", 409);
          if (decision.resolvedStatus === "blank" && decision.selectedOptionIds.length > 0) throw new AppError("INVALID_DECISION", "Una fila en blanco no puede tener opciones seleccionadas.", 400);
          if (decision.resolvedStatus === "single" && decision.selectedOptionIds.length !== 1) throw new AppError("INVALID_DECISION", "Una fila single requiere exactamente una opción.", 400);
          if (decision.resolvedStatus === "single" && !row.candidateOptionIds.includes(decision.selectedOptionIds[0])) throw new AppError("INVALID_DECISION", "La opción elegida no está entre las candidatas de la lectura.", 400);
          updatedRows = updatedRows.map((item) => item.questionId === decision.questionId ? { ...item, status: decision.resolvedStatus, selectedOptionIds: decision.selectedOptionIds, requiresHumanReview: false } : item);
        }
        await getOmrReadingRepository().update(ownerId, readingId, reading.etag, { rows: updatedRows, status: "reviewed" });
        for (const decision of decisions) {
          await getManualDecisionRepository().create({ readingId: decision.readingId, questionId: decision.questionId, originalStatus: decision.originalStatus, resolvedStatus: decision.resolvedStatus, selectedOptionIds: decision.selectedOptionIds, actorId: ownerId, reason: decision.reason });
        }
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
      const batch = await getBatchRepository().get(ownerId, params.id, params.batchId);
      if (!batch) throw new AppError("NOT_FOUND", "Lote no encontrado.", 404);
      const answerKey = await getAnswerKeyRepository().get(ownerId, params.id, batch.value.answerKeyRevisionId);
      if (!answerKey || answerKey.value.status !== "approved") throw new AppError("ANSWER_KEY_STALE", "El solucionario debe estar aprobado.", 409);
      if (answerKey.value.scoringPolicyRevisionId !== batch.value.scoringPolicyRevisionId) throw new AppError("SCORING_POLICY_MISMATCH", "La política del lote no coincide con la del solucionario.", 409);
      const openQuestionIds = Object.entries(answerKey.value.decisions).filter(([, decision]) => Boolean(decision.sectionId)).map(([questionId]) => questionId);
      if (refreshed.value.readingIds.length === 0 && openQuestionIds.length === 0) throw new AppError("READINGS_REQUIRED", "La entrega no tiene lecturas ni preguntas abiertas.", 409);
      const readings = (await getOmrReadingRepository().list(ownerId, refreshed.value.readingIds)).filter((reading): reading is { value: OmrReading; etag: string } => Boolean(reading));
      if (readings.length !== refreshed.value.readingIds.length) throw new AppError("READING_NOT_FOUND", "Falta una lectura de la entrega.", 409);
      const answersByQuestion: Record<string, { correctOptionIds: string[] }> = {};
      const manualSelections: Record<string, { selectedOptionIds: string[]; status: "single" | "blank" }> = {};
      for (const [questionId, decision] of Object.entries(answerKey.value.decisions)) {
        const raw = decision.answer as { selectedOptionIds?: string[] } | string[] | null;
        const selected = Array.isArray(raw) ? raw : raw?.selectedOptionIds;
        if (Array.isArray(selected)) answersByQuestion[questionId] = { correctOptionIds: selected.map(String) };
      }
      const decisions = await getManualDecisionRepository().listByReadings(ownerId, refreshed.value.readingIds);
      for (const decision of decisions) {
        manualSelections[decision.questionId] = { selectedOptionIds: decision.selectedOptionIds, status: decision.resolvedStatus as "single" | "blank" };
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
        scoringPolicyRevisionId: batch.value.scoringPolicyRevisionId,
        policy: batch.value.scoringPolicy,
      });
      const responseDecisions = await getResponseDecisionRepository().list(ownerId, params.submissionId);
      const activeDecisionIds = new Set(refreshed.value.responseDecisionIds);
      const currentResponseDecisions = responseDecisions.filter((item) => activeDecisionIds.has(item.value.decisionId) && openQuestionIds.includes(item.value.questionId));
      const transcriptions = await getTranscriptionRepository().list(ownerId, params.submissionId);
      const openScores = [];
      const openIssues: string[] = [];
      for (const questionId of openQuestionIds) {
        const decision = currentResponseDecisions.find((item) => item.value.questionId === questionId);
        if (!decision) { openIssues.push(`open_decision_missing:${questionId}`); continue; }
        const transcription = transcriptions.find((item) => item.value.transcriptionId === decision.value.transcriptionId && item.value.state === "confirmed");
        if (!transcription) { openIssues.push(`transcription_missing:${questionId}`); continue; }
        openScores.push({ questionId, sectionId: decision.value.sectionId, points: decision.value.totalPoints, maximumPoints: decision.value.maximumPoints, source: decision.value.source, transcriptionId: decision.value.transcriptionId, decisionId: decision.value.decisionId });
      }
      const mixed = computeMixedScore({ base: computation, openQuestionScores: openScores, openPending: openIssues.length, blockingIssues: openIssues, policy: batch.value.scoringPolicy });
      const snapshot = await getScoreSnapshotRepository().create({ ...mixed, responseRegionRevisionId: refreshed.value.activeResponseRegionRevisionId, transcriptionRevisionIds: refreshed.value.responseTranscriptionIds, evaluationIds: refreshed.value.responseEvaluationIds, decisionIds: refreshed.value.responseDecisionIds });
      await getSubmissionRepository().update(ownerId, params.batchId, params.submissionId, refreshed.etag, { state: mixed.blockingIssues.length === 0 ? "scored" : "review", snapshotId: snapshot.snapshot.snapshotId });
      return Response.json({ data: snapshot.snapshot, requestId }, { status: 201, headers: { "x-request-id": requestId } });
    }

    throw new AppError("UNKNOWN_ACTION", "Acción no soportada.", 400);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
