import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getExamRepository, getIdempotencyRepository } from "@/repositories";

const createExamSchema = z.object({ title: z.string().trim().min(1).max(200), subject: z.string().trim().min(1).max(200), modelIds: z.array(z.string().min(1)).max(10).optional() });

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const { ownerId } = await requireOwner();
    const exams = await getExamRepository().list(ownerId);
    return Response.json({ data: exams, requestId }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "Falta Idempotency-Key.", 400);
    const input = createExamSchema.parse(await request.json());
    const outcome = await getIdempotencyRepository().execute(ownerId, "create-exam", idempotencyKey, () => getExamRepository().create(ownerId, input));
    return Response.json({ data: outcome.result, replayed: outcome.replayed, requestId }, { status: outcome.replayed ? 200 : 201, headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
