import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getAnswerKeyRepository, getBatchRepository, getDocumentPagesRepository, getExamRepository, getExamRevisionRepository, getOmrTemplateRepository, getStructureProposalRepository } from "@/repositories";
import type { ScoringPolicy } from "@/domain/schemas";

const bodySchema = z.object({ maxPages: z.number().int().positive().max(30).default(30) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const examId = (await context.params).id;
    const input = bodySchema.parse(await request.json().catch(() => ({})));
    const exam = await getExamRepository().get(ownerId, examId);
    if (!exam) throw new AppError("NOT_FOUND", "Examen no encontrado.", 404);
    if (!exam.activeRevisionId) throw new AppError("REVISION_REQUIRED", "La IA todavía no ha resuelto este examen.", 409);
    const revision = await getExamRevisionRepository().get(ownerId, examId, exam.activeRevisionId);
    if (!revision?.value.answerKeyRevisionId) throw new AppError("ANSWER_KEY_REQUIRED", "Genera el solucionario antes de crear el lote.", 409);
    const pages = await getDocumentPagesRepository().getWithMeta(ownerId, examId);
    if (!pages || revision.value.pagesManifestEtag !== pages.etag) throw new AppError("ANSWER_KEY_STALE", "La fuente del examen cambió después de generar las respuestas IA. Repite la pantalla 2.", 409);
    const answerKey = await getAnswerKeyRepository().get(ownerId, examId, revision.value.answerKeyRevisionId);
    if (!answerKey) throw new AppError("ANSWER_KEY_REQUIRED", "El solucionario no existe.", 404);
    if (answerKey.value.status !== "approved") throw new AppError("ANSWER_KEY_NOT_APPROVED", "Aprueba el solucionario antes de crear el lote.", 409);
    if (answerKey.value.examRevisionId !== exam.activeRevisionId) throw new AppError("ANSWER_KEY_STALE", "El solucionario no pertenece a la revisión IA activa.", 409);
    const templates = (await getOmrTemplateRepository().list(ownerId, examId)).filter((item) => item.value.state === "approved");
    const template = templates.sort((a, b) => Date.parse(b.value.updatedAt) - Date.parse(a.value.updatedAt))[0];
    if (!template) throw new AppError("TEMPLATE_REQUIRED", "Calibra y aprueba la plantilla OMR antes de crear el lote.", 409);

    const decisions = Object.values(answerKey.value.decisions);
    const testQuestions = decisions.filter((decision) => decision.sectionId === "test");
    const openQuestions = decisions.filter((decision) => decision.sectionId === "open");
    if (testQuestions.length === 0 && openQuestions.length === 0) throw new AppError("EMPTY_ANSWER_KEY", "El solucionario no contiene preguntas puntuables.", 409);
    if (testQuestions.length > 0) {
      const answerRevision = await getExamRevisionRepository().get(ownerId, examId, answerKey.value.examRevisionId);
      const structure = answerRevision?.value.activeStructureProposalId
        ? await getStructureProposalRepository().get(ownerId, examId, answerRevision.value.activeStructureProposalId)
        : null;
      if (!structure) throw new AppError("STRUCTURE_NOT_FOUND", "Falta la estructura del solucionario para validar la plantilla.", 409);
      const testIds = new Set(Object.entries(answerKey.value.decisions).filter(([, decision]) => decision.sectionId === "test").map(([id]) => id));
      const aliases = new Map<string, Set<string>>();
      for (const question of structure.value.questions) {
        for (const alias of [String(question.number), question.label]) {
          const mapped = aliases.get(alias) ?? new Set<string>();
          mapped.add(question.questionId);
          aliases.set(alias, mapped);
        }
      }
      const mappedIds = new Set<string>();
      for (const rawId of new Set(template.value.bubbles.map((bubble) => bubble.questionId))) {
        const candidates = testIds.has(rawId) ? [rawId] : [...(aliases.get(rawId) ?? [])].filter((candidate) => testIds.has(candidate));
        if (candidates.length !== 1) throw new AppError("TEMPLATE_QUESTION_MAPPING_MISMATCH", `La plantilla no asigna unívocamente la pregunta «${rawId}» del solucionario.`, 409);
        mappedIds.add(candidates[0]);
      }
      if (mappedIds.size !== testIds.size) throw new AppError("TEMPLATE_QUESTION_MAPPING_MISMATCH", "La plantilla no contiene todas las preguntas objetivas del solucionario.", 409);
    }
    const openMaxPoints = openQuestions.reduce((total, decision) => total + decision.rubric.totalMax, 0);
    const sections: ScoringPolicy["sections"] = [];
    if (testQuestions.length > 0) sections.push({ sectionId: "test", maxPoints: testQuestions.length, weightBasisPoints: openQuestions.length > 0 ? 7000 : 10000, kind: "test" });
    if (openQuestions.length > 0) sections.push({ sectionId: "open", maxPoints: openMaxPoints > 0 ? openMaxPoints : openQuestions.length, weightBasisPoints: testQuestions.length > 0 ? 3000 : 10000, kind: "open" });
    const scoringPolicy: ScoringPolicy = {
      schemaVersion: 1,
      policyId: `policy-${Date.now()}`,
      scaleMax: 10,
      correctPoints: 1,
      blankPoints: 0,
      incorrectPenalty: testQuestions.length > 0 ? -0.25 : 0,
      multipleMarkHandling: "pending",
      minimumScore: 0,
      decimals: 2,
      sections,
      confirmed: true,
    };
    const existing = (await getBatchRepository().list(ownerId, examId)).find((item) =>
      !["closed", "cancelled"].includes(item.value.state)
      && item.value.answerKeyRevisionId === answerKey.value.answerKeyRevisionId
      && item.value.templateRevisionId === template.value.templateId
      && item.value.scoringPolicyRevisionId === answerKey.value.scoringPolicyRevisionId,
    );
    if (existing) return Response.json({ data: existing.value, reused: true, requestId }, { status: 200, headers: { "x-request-id": requestId, etag: existing.etag } });

    const created = await getBatchRepository().create({
      examId,
      ownerId,
      answerKeyRevisionId: answerKey.value.answerKeyRevisionId,
      templateRevisionId: template.value.templateId,
      scoringPolicyRevisionId: answerKey.value.scoringPolicyRevisionId,
      scoringPolicy,
      maxPages: input.maxPages,
    });
    return Response.json({ data: created.batch, requestId }, { status: 201, headers: { "x-request-id": requestId, etag: created.etag } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
