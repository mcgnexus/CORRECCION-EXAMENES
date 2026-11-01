import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getAnswerKeyRepository, getExamRevisionRepository } from "@/repositories";
import { answerKeyRevisionSchema } from "@/domain/phase2-schemas";

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
    const ensured = await ensureAnswerKey(ownerId, params.id, params.revisionId);
    const current = ensured.answerKey;
    const patch = { ...input, decisions: input.decisions ? Object.fromEntries(Object.entries(input.decisions).map(([key, value]) => [key, answerKeyRevisionSchema.shape.decisions.parse({ [key]: value })[key]])) : undefined };
    const updated = await getAnswerKeyRepository().update(ownerId, params.id, current.value.answerKeyRevisionId, input.expectedEtag, patch);
    return Response.json({ data: updated.answerKey, requestId }, { headers: { "x-request-id": requestId, etag: updated.etag } });
  } catch (error) { return errorResponse(error, requestId); }
}
