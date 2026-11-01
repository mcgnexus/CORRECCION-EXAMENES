import { start } from "workflow/api";
import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getExamRevisionRepository, getIdempotencyRepository } from "@/repositories";
import { solveExamWorkflow } from "@/workflows/phase2-workflows";

const bodySchema = z.object({ revisionId: z.string().min(1), structureProposalId: z.string().min(1) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const examId = (await context.params).id;
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "Falta Idempotency-Key.", 400);
    const input = bodySchema.parse(await request.json());
    const revision = await getExamRevisionRepository().get(ownerId, examId, input.revisionId);
    if (!revision || revision.value.activeStructureProposalId !== input.structureProposalId) throw new AppError("STRUCTURE_NOT_SELECTED", "Selecciona la propuesta de estructura antes de resolver.", 409);
    const outcome = await getIdempotencyRepository().execute(ownerId, "solve-exam", idempotencyKey, async () => {
      const run = await start(solveExamWorkflow, [{ ownerId, examId, revisionId: input.revisionId, structureProposalId: input.structureProposalId }]);
      return { revisionId: input.revisionId, runId: run.runId };
    });
    return Response.json({ data: outcome.result, replayed: outcome.replayed, requestId }, { status: outcome.replayed ? 200 : 202, headers: { "x-request-id": requestId } });
  } catch (error) { return errorResponse(error, requestId); }
}
