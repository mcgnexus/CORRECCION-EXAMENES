import { start } from "workflow/api";
import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { phase0Workflow } from "@/workflows/phase0-workflow";

const inputSchema = z.object({ failSecondStep: z.boolean().default(false) });

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const input = inputSchema.parse(await request.json().catch(() => ({})));
    const run = await start(phase0Workflow, [{ ownerId, failSecondStep: input.failSecondStep }]);
    return Response.json({ data: { runId: run.runId }, requestId }, { status: 202, headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
