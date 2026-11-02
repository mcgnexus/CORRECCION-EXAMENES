import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { pickSolution, normalizeSelection, rubricFor, sectionForQuestion } from "@/lib/answer-key-autofill";
import { getAnswerKeyRepository, getExamRevisionRepository, getSolutionProposalRepository, getStructureProposalRepository } from "@/repositories";
import { questionDecisionSchema } from "@/domain/phase2-schemas";

const bodySchema = z.object({
  expectedEtag: z.string().min(1).optional(),
  sources: z.record(z.string(), z.enum(["gemini", "deepseek"])).optional(),
  maxPoints: z.record(z.string(), z.number().positive()).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string; revisionId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const input = bodySchema.parse(await request.json().catch(() => ({})));
    const revision = await getExamRevisionRepository().get(ownerId, params.id, params.revisionId);
    if (!revision) throw new AppError("NOT_FOUND", "Revisión no encontrada.", 404);
    if (revision.value.status === "approved") throw new AppError("REVISION_APPROVED", "La revisión ya está aprobada.", 409);
    const structureId = revision.value.activeStructureProposalId;
    if (!structureId) throw new AppError("STRUCTURE_REQUIRED", "Selecciona una estructura antes de generar el solucionario.", 409);
    const structure = await getStructureProposalRepository().get(ownerId, params.id, structureId);
    if (!structure) throw new AppError("STRUCTURE_NOT_FOUND", "No se encontró la estructura activa.", 404);
    const solutions = (await getSolutionProposalRepository().list(ownerId, params.revisionId)).map((item) => item.value);
    if (solutions.length === 0) throw new AppError("SOLUTIONS_REQUIRED", "Todavía no hay soluciones de la IA para este examen.", 409);

    let answerKey = revision.value.answerKeyRevisionId ? await getAnswerKeyRepository().get(ownerId, params.id, revision.value.answerKeyRevisionId) : null;
    let expectedEtag = input.expectedEtag ?? answerKey?.etag;
    if (!answerKey) {
    const created = await getAnswerKeyRepository().create(ownerId, params.id, params.revisionId);
    await getExamRevisionRepository().update(ownerId, params.id, params.revisionId, revision.etag, { answerKeyRevisionId: created.answerKey.answerKeyRevisionId, status: "key_review" });
    answerKey = { value: created.answerKey, etag: created.etag };
    expectedEtag = created.etag;
  }
  if (!expectedEtag) expectedEtag = answerKey.etag;

    const decisions: Record<string, z.infer<typeof questionDecisionSchema>> = {};
    const blockingIssues: string[] = [];
    for (const question of structure.value.questions) {
      const solution = pickSolution(question.questionId, solutions, input.sources?.[question.questionId]);
      if (!solution) {
        blockingIssues.push(`solution_missing:${question.questionId}`);
        continue;
      }
      const sectionId = sectionForQuestion(question);
      const humanNote = `Propuesta por ${solution.provider} (${solution.model}); pendiente de aprobación humana.`;
      if (sectionId === "open") {
        decisions[question.questionId] = {
          questionId: question.questionId,
          sectionId,
          answer: solution.answer,
          explanation: solution.explanation,
          rubric: rubricFor(question.questionId, input.maxPoints?.[question.questionId] ?? 1),
          proposalIds: [solution.solutionProposalId],
          sourceEvidenceIds: [],
          humanNote,
          resolved: true,
        };
        continue;
      }
      const selectedOptionIds = normalizeSelection(solution.answer, question.options);
      if (selectedOptionIds.length === 0) {
        blockingIssues.push(`answer_unreadable:${question.questionId}`);
        continue;
      }
      if (selectedOptionIds.length > 1) blockingIssues.push(`multiple_answers:${question.questionId}`);
      decisions[question.questionId] = {
        questionId: question.questionId,
        sectionId,
        answer: { selectedOptionIds },
        explanation: solution.explanation,
        rubric: { criteria: [], totalMax: 0 },
        proposalIds: [solution.solutionProposalId],
        sourceEvidenceIds: [],
        humanNote,
        resolved: true,
      };
    }
    if (Object.keys(decisions).length === 0) throw new AppError("NO_DECISIONS", "No se pudo generar ninguna respuesta del solucionario.", 409);

    const updated = await getAnswerKeyRepository().update(ownerId, params.id, answerKey.value.answerKeyRevisionId, expectedEtag, { status: "review", decisions, blockingIssues });
    return Response.json({ data: updated.answerKey, requestId }, { headers: { "x-request-id": requestId, etag: updated.etag } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
