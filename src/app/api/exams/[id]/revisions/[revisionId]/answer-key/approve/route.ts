import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getAnswerKeyRepository } from "@/repositories";
import { getExamRevisionRepository, getStructureProposalRepository } from "@/repositories";

export async function POST(request: Request, context: { params: Promise<{ id: string; revisionId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const body = await request.json() as { expectedEtag?: string };
    if (!body.expectedEtag) throw new AppError("ETAG_REQUIRED", "Falta expectedEtag.", 400);
    const revision = await getExamRevisionRepository().get(ownerId, params.id, params.revisionId);
    if (!revision?.value.answerKeyRevisionId) throw new AppError("NOT_FOUND", "Answer key no encontrado.", 404);
    const current = await getAnswerKeyRepository().get(ownerId, params.id, revision.value.answerKeyRevisionId);
    if (!current) throw new AppError("NOT_FOUND", "Answer key no encontrado.", 404);
    if (current.value.blockingIssues.length > 0) throw new AppError("APPROVAL_BLOCKED", "El answer key tiene incidencias pendientes.", 409);
    if (Object.keys(current.value.decisions).length === 0) throw new AppError("APPROVAL_BLOCKED", "No hay decisiones humanas registradas.", 409);
    const examRevision = await getExamRevisionRepository().get(ownerId, params.id, params.revisionId);
    const structureId = examRevision?.value.activeStructureProposalId;
    const structure = structureId ? await getStructureProposalRepository().get(ownerId, params.id, structureId) : null;
    for (const question of structure?.value.questions ?? []) {
      if ((question.type === "short_text" || question.type === "essay") && !current.value.decisions[question.questionId]?.sectionId) {
        throw new AppError("SECTION_REQUIRED", `La pregunta ${question.questionId} necesita sectionId.`, 409);
      }
    }
    const approved = await getAnswerKeyRepository().update(ownerId, params.id, current.value.answerKeyRevisionId, body.expectedEtag, { status: "approved", approvedBy: ownerId, approvedAt: new Date().toISOString() });
    return Response.json({ data: approved.answerKey, requestId }, { headers: { "x-request-id": requestId, etag: approved.etag } });
  } catch (error) { return errorResponse(error, requestId); }
}
