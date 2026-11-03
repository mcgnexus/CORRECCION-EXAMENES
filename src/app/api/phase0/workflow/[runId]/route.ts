import { getRun } from "workflow/api";
import { requireOwner } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { autopilotProgressPath } from "@/lib/autopilot-recovery";
import { getExamRevisionRepository } from "@/repositories";
import { getBlobStore } from "@/repositories/blob-store";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { ownerId } = await requireOwner();
    const run = getRun((await context.params).runId);
    const status = await run.status;
    const data: { runId: string; status: string; output?: unknown; progress?: { phase: string; completed?: number; total?: number; updatedAt?: string } } = { runId: run.runId, status };
    if (status === "completed") data.output = await run.returnValue;
    const url = new URL(_request.url);
    const examId = url.searchParams.get("examId");
    const revisionId = url.searchParams.get("revisionId");
    if (examId && revisionId) {
      const revision = await getExamRevisionRepository().get(ownerId, examId, revisionId);
      if (!revision || revision.value.workflowRunId !== run.runId) return Response.json({ data, requestId }, { headers: { "x-request-id": requestId } });
      const stored = await getBlobStore().get(autopilotProgressPath(ownerId, examId, revisionId));
      if (stored) {
        const progress = JSON.parse(new TextDecoder().decode(stored.body)) as { phase?: unknown; completed?: unknown; total?: unknown; updatedAt?: unknown };
        if (typeof progress.phase === "string") data.progress = {
          phase: progress.phase,
          completed: typeof progress.completed === "number" ? progress.completed : undefined,
          total: typeof progress.total === "number" ? progress.total : undefined,
          updatedAt: typeof progress.updatedAt === "string" ? progress.updatedAt : undefined,
        };
      }
    }
    return Response.json({ data, requestId }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
