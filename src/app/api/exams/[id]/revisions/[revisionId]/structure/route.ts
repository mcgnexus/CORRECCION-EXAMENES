import { z } from "zod";
import { requireOwner, assertSameOrigin } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getExamRevisionRepository, getStructureProposalRepository } from "@/repositories";

const patchSchema = z.object({ expectedEtag: z.string().min(1), activeStructureProposalId: z.string().min(1), blockingIssues: z.array(z.string()).default([]), status: z.enum(["structure_review", "solving", "key_review"]).default("structure_review") });

export async function GET(_request: Request, context: { params: Promise<{ id: string; revisionId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const revision = await getExamRevisionRepository().get(ownerId, params.id, params.revisionId);
    if (!revision) throw new AppError("NOT_FOUND", "Revisión no encontrada.", 404);
    const proposals = await Promise.all(revision.value.proposals.map((proposalId) => getStructureProposalRepository().get(ownerId, params.id, proposalId)));
    return Response.json({ data: { revision: revision.value, proposals: proposals.filter(Boolean).map((proposal) => proposal!.value) }, requestId }, { headers: { "x-request-id": requestId, etag: revision.etag } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; revisionId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const input = patchSchema.parse(await request.json());
    const revision = await getExamRevisionRepository().get(ownerId, params.id, params.revisionId);
    if (!revision || !revision.value.proposals.includes(input.activeStructureProposalId)) throw new AppError("INVALID_PROPOSAL", "La propuesta no pertenece a la revisión.", 400);
    const updated = await getExamRevisionRepository().update(ownerId, params.id, params.revisionId, input.expectedEtag, { activeStructureProposalId: input.activeStructureProposalId, blockingIssues: input.blockingIssues, status: input.status });
    return Response.json({ data: updated.revision, requestId }, { headers: { "x-request-id": requestId, etag: updated.etag } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
