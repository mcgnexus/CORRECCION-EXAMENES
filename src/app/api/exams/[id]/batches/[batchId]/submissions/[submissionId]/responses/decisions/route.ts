import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getAnswerKeyRepository, getAuditRepository, getBatchRepository, getEvaluationRepository, getResponseDecisionRepository, getSubmissionRepository, getTranscriptionRepository } from "@/repositories";

const decisionSchema = z.object({ questionId: z.string().min(1), transcriptionId: z.string().min(1), source: z.enum(["gemini", "deepseek", "manual"]), selectedEvaluationId: z.string().min(1).optional(), manualCriterionScores: z.array(z.object({ criterionId: z.string().min(1), points: z.number().nonnegative(), evidence: z.string() })).optional(), reason: z.string().min(1) });
const bodySchema = z.object({ expectedEtag: z.string().min(1), decisions: z.array(decisionSchema).min(1) });

export async function POST(request: Request, context: { params: Promise<{ id: string; batchId: string; submissionId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const input = bodySchema.parse(await request.json());
    const submission = await getSubmissionRepository().get(ownerId, params.batchId, params.submissionId);
    if (!submission || submission.value.examId !== params.id) throw new AppError("NOT_FOUND", "Entrega no encontrada.", 404);
    if (!submission.value.confirmedIdentity || submission.etag !== input.expectedEtag) throw new AppError(submission.value.confirmedIdentity ? "ETAG_CONFLICT" : "SUBMISSION_UNASSIGNED", submission.value.confirmedIdentity ? "La entrega cambió en otro proceso." : "Confirma la identidad antes de decidir.", 409);
    const batch = await getBatchRepository().get(ownerId, params.id, params.batchId);
    if (!batch) throw new AppError("BATCH_NOT_FOUND", "Lote no encontrado.", 404);
    const answerKey = await getAnswerKeyRepository().get(ownerId, params.id, batch.value.answerKeyRevisionId);
    if (!answerKey || answerKey.value.status !== "approved") throw new AppError("ANSWER_KEY_STALE", "El solucionario debe estar aprobado.", 409);
    const evaluations = await getEvaluationRepository().list(ownerId, params.submissionId);
    const transcriptions = await getTranscriptionRepository().list(ownerId, params.submissionId);
    const created = [];
    const usedQuestions = new Set<string>();
    for (const item of input.decisions) {
      if (usedQuestions.has(item.questionId)) throw new AppError("DECISION_CONFLICT", "No se puede decidir dos veces la misma pregunta en una petición.", 409);
      usedQuestions.add(item.questionId);
      const transcription = transcriptions.find((candidate) => candidate.value.transcriptionId === item.transcriptionId && candidate.value.questionId === item.questionId && candidate.value.state === "confirmed");
      const keyDecision = answerKey.value.decisions[item.questionId];
      if (!transcription || !keyDecision?.sectionId) throw new AppError("RESPONSE_DEPENDENCY_STALE", "La transcripción o sección de la pregunta no está confirmada.", 409);
      const expected = new Map(keyDecision.rubric.criteria.map((criterion) => [criterion.id, criterion.maxPoints]));
      let criterionScores;
      let source = item.source;
      if (source === "manual") {
        if (!item.manualCriterionScores || item.manualCriterionScores.length !== expected.size) throw new AppError("INVALID_DECISION", "La decisión manual debe cubrir todos los criterios.", 400);
        criterionScores = item.manualCriterionScores.map((score) => {
          const maxPoints = expected.get(score.criterionId);
          if (maxPoints === undefined || score.points > maxPoints) throw new AppError("INVALID_DECISION", "La puntuación manual no es válida.", 400);
          return { criterionId: score.criterionId, points: score.points, maxPoints, evidence: score.evidence, incidents: [] };
        });
      } else {
        if (!item.selectedEvaluationId) throw new AppError("INVALID_DECISION", "Selecciona una evaluación.", 400);
        const selected = evaluations.find((candidate) => candidate.value.evaluationId === item.selectedEvaluationId && candidate.value.questionId === item.questionId && candidate.value.transcriptionId === item.transcriptionId && candidate.value.provider === source && candidate.value.state === "completed");
        if (!selected) throw new AppError("INVALID_DECISION", "La evaluación seleccionada no está disponible.", 409);
        criterionScores = selected.value.criterionScores;
      }
      const totalPoints = criterionScores.reduce((sum, score) => sum + score.points, 0);
      const maximumPoints = keyDecision.rubric.totalMax;
      if (totalPoints > maximumPoints) throw new AppError("INVALID_DECISION", "La suma de puntos supera el máximo.", 400);
      const manualScores = item.manualCriterionScores?.map((score) => ({ ...score, maxPoints: expected.get(score.criterionId) ?? 0 }));
      created.push(await getResponseDecisionRepository().create({ submissionId: params.submissionId, batchId: params.batchId, examId: params.id, ownerId, questionId: item.questionId, transcriptionId: item.transcriptionId, answerKeyRevisionId: batch.value.answerKeyRevisionId, sectionId: keyDecision.sectionId, source, selectedEvaluationId: item.selectedEvaluationId, manualCriterionScores: manualScores, criterionScores, totalPoints, maximumPoints, reason: item.reason, actorId: ownerId, decidedAt: new Date().toISOString() }));
    }
    const previous = await getResponseDecisionRepository().list(ownerId, params.submissionId);
    const removed = new Set(input.decisions.map((item) => item.questionId));
    const decisionIds = previous.filter((item) => !removed.has(item.value.questionId)).map((item) => item.value.decisionId).concat(created.map((item) => item.decision.decisionId));
    const refreshed = await getSubmissionRepository().get(ownerId, params.batchId, params.submissionId);
    if (!refreshed) throw new AppError("NOT_FOUND", "Entrega no encontrada.", 404);
    await getSubmissionRepository().update(ownerId, params.batchId, params.submissionId, refreshed.etag, { responseDecisionIds: decisionIds, responseBlockingIssues: [], state: "review_scores" });
    await getAuditRepository().append({ ownerId, actorId: ownerId, type: "response.decision.created", aggregateType: "submission", aggregateId: params.submissionId, payload: { questionIds: input.decisions.map((item) => item.questionId), decisionIds: created.map((item) => item.decision.decisionId) } });
    return Response.json({ data: created.map((item) => item.decision), requestId }, { status: 201, headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
