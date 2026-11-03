import { requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getAnswerKeyRepository, getExamRevisionRepository, getSolutionProposalRepository, getStructureProposalRepository } from "@/repositories";

export async function GET(_request: Request, context: { params: Promise<{ id: string; revisionId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const revision = await getExamRevisionRepository().get(ownerId, params.id, params.revisionId);
    if (!revision) throw new AppError("NOT_FOUND", "Revisión no encontrada.", 404);
    const structure = revision.value.activeStructureProposalId
      ? await getStructureProposalRepository().get(ownerId, params.id, revision.value.activeStructureProposalId)
      : null;
    const [solutions, answerKey] = await Promise.all([
      getSolutionProposalRepository().list(ownerId, params.revisionId),
      revision.value.answerKeyRevisionId ? getAnswerKeyRepository().get(ownerId, params.id, revision.value.answerKeyRevisionId) : Promise.resolve(null),
    ]);
    return Response.json(
      {
        data: {
          revision: revision.value,
          questions: structure?.value.questions ?? [],
          solutions: solutions.map((item) => item.value),
          answerKey: answerKey?.value ?? null,
        },
        requestId,
      },
      { headers: { "x-request-id": requestId, etag: answerKey?.etag ?? revision.etag, "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
