import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getAnswerKeyRepository, getExamRevisionRepository } from "@/repositories";
import { questionDecisionSchema } from "@/domain/phase2-schemas";

const patchSchema = z.object({ expectedEtag: z.string().min(1), status: z.enum(["draft", "review", "stale"]).optional(), decisions: z.record(z.unknown()).optional(), blockingIssues: z.array(z.string()).optional() });

async function ensureAnswerKey(ownerId: string, examId: string, revisionId: string) {
  const revision = await getExamRevisionRepository().get(ownerId, examId, revisionId);
  if (!revision) throw new AppError("NOT_FOUND", "Revisión no encontrada.", 404);
  if (revision.value.answerKeyRevisionId) {
    const existing = await getAnswerKeyRepository().get(ownerId, examId, revision.value.answerKeyRevisionId);
    if (existing) return { revision, answerKey: existing };
  }
  if (!revision.value.activeStructureProposalId) throw new AppError("STRUCTURE_REQUIRED", "Selecciona una propuesta de estructura antes del answer key.", 409);
  const created = await getAnswerKeyRepository().create(ownerId, examId, revisionId);
  const updatedRevision = await getExamRevisionRepository().update(ownerId, examId, revisionId, revision.etag, { answerKeyRevisionId: created.answerKey.answerKeyRevisionId, status: "key_review" });
  return { revision: { value: updatedRevision.revision, etag: updatedRevision.etag }, answerKey: { value: created.answerKey, etag: created.etag } };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string; revisionId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const existing = await getAnswerKeyRepository().get(ownerId, params.id, params.revisionId);
    if (existing) {
      const revision = await getExamRevisionRepository().get(ownerId, params.id, existing.value.examRevisionId);
      return Response.json({ data: { revision: revision?.value ?? null, answerKey: existing.value }, requestId }, { headers: { "x-request-id": requestId, etag: existing.etag } });
    }
    const result = await ensureAnswerKey(ownerId, params.id, params.revisionId);
    return Response.json({ data: { revision: result.revision.value, answerKey: result.answerKey.value }, requestId }, { headers: { "x-request-id": requestId, etag: result.answerKey.etag } });
  } catch (error) { return errorResponse(error, requestId); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; revisionId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const input = patchSchema.parse(await request.json());
    const result = await ensureAnswerKey(ownerId, params.id, params.revisionId);
    if (result.answerKey.value.status === "approved") throw new AppError("ANSWER_KEY_APPROVED", "El solucionario aprobado es inmutable. Regenera una revisión IA para crear una versión nueva.", 409);
    if (result.answerKey.etag !== input.expectedEtag) throw new AppError("ETAG_CONFLICT", "El solucionario cambió en otra pestaña.", 409);
    const decisions = input.decisions ? Object.fromEntries(Object.entries(input.decisions).map(([questionId, value]) => {
      const decision = questionDecisionSchema.parse(value);
      if (decision.questionId !== questionId) throw new AppError("QUESTION_ID_MISMATCH", "El ID de la respuesta no coincide con la pregunta.", 400);
      return [questionId, decision];
    })) : result.answerKey.value.decisions;
    const updated = await getAnswerKeyRepository().update(ownerId, params.id, result.answerKey.value.answerKeyRevisionId, input.expectedEtag, {
      ...(input.status ? { status: input.status } : {}),
      decisions,
      blockingIssues: input.blockingIssues ?? result.answerKey.value.blockingIssues,
    });
    return Response.json({ data: updated.answerKey, requestId }, { headers: { "x-request-id": requestId, etag: updated.etag } });
  } catch (error) { return errorResponse(error, requestId); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string; revisionId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const revision = await getExamRevisionRepository().get(ownerId, params.id, params.revisionId);
    if (!revision) throw new AppError("NOT_FOUND", "Revisión no encontrada.", 404);
    if (!revision.value.answerKeyRevisionId) throw new AppError("NOT_FOUND", "No hay solucionario generado para esta revisión.", 404);
    const answerKey = await getAnswerKeyRepository().get(ownerId, params.id, revision.value.answerKeyRevisionId);
    if (answerKey?.value.status === "approved") throw new AppError("ANSWER_KEY_APPROVED", "No se puede eliminar un solucionario aprobado.", 409);
    const { getBlobStore } = await import("@/repositories/blob-store");
    await getBlobStore().delete(`owners/${ownerId}/exams/${params.id}/answer-keys/${revision.value.answerKeyRevisionId}/manifest.json`);
    const updated = await getExamRevisionRepository().update(ownerId, params.id, params.revisionId, revision.etag, { answerKeyRevisionId: undefined, status: "structure_review", blockingIssues: [] });
    return Response.json({ data: updated.revision, requestId }, { headers: { "x-request-id": requestId, etag: updated.etag } });
  } catch (error) { return errorResponse(error, requestId); }
}
