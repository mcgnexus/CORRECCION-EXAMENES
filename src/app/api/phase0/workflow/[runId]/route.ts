import { getRun } from "workflow/api";
import { requireOwner } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    await requireOwner();
    const run = getRun((await context.params).runId);
    const status = await run.status;
    const data: { runId: string; status: string; output?: unknown } = { runId: run.runId, status };
    if (status === "completed") data.output = await run.returnValue;
    return Response.json({ data, requestId }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
