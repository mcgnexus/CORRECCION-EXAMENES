import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getAnswerKeyRepository, getBatchRepository, getExamRepository, getOmrTemplateRepository } from "@/repositories";
import { getIdempotencyRepository } from "@/repositories";
import { scoringPolicySchema } from "@/domain/schemas";

const createSchema = z.object({
  answerKeyRevisionId: z.string().min(1),
  templateRevisionId: z.string().min(1),
  scoringPolicyRevisionId: z.string().min(1),
  scoringPolicy: scoringPolicySchema,
  maxPages: z.number().int().positive().max(30).default(30),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { ownerId } = await requireOwner();
    const examId = (await context.params).id;
    const batches = await getBatchRepository().list(ownerId, examId);
    return Response.json({ data: batches.map((item) => item.value), requestId }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const examId = (await context.params).id;
    if (!(await getExamRepository().get(ownerId, examId))) throw new AppError("NOT_FOUND", "Examen no encontrado.", 404);
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "Falta Idempotency-Key.", 400);
    const input = createSchema.parse(await request.json());
    const template = await getOmrTemplateRepository().get(ownerId, examId, input.templateRevisionId);
    if (!template || template.value.state !== "approved") throw new AppError("TEMPLATE_NOT_APPROVED", "La plantilla debe estar aprobada.", 409);
    const answerKey = await getAnswerKeyRepository().get(ownerId, examId, input.answerKeyRevisionId);
    if (!answerKey || answerKey.value.status !== "approved") throw new AppError("ANSWER_KEY_STALE", "El solucionario debe estar aprobado.", 409);
    if (answerKey.value.scoringPolicyRevisionId !== input.scoringPolicyRevisionId) throw new AppError("SCORING_POLICY_MISMATCH", "La política no coincide con la revisión del solucionario.", 409);
    const outcome = await getIdempotencyRepository().execute(ownerId, "create-batch", idempotencyKey, async () => {
      const result = await getBatchRepository().create({ examId, ownerId, answerKeyRevisionId: input.answerKeyRevisionId, templateRevisionId: input.templateRevisionId, scoringPolicyRevisionId: input.scoringPolicyRevisionId, scoringPolicy: input.scoringPolicy, maxPages: input.maxPages });
      return result.batch.batchId;
    });
    const batch = await getBatchRepository().get(ownerId, examId, outcome.result);
    return Response.json({ data: batch?.value, replayed: outcome.replayed, requestId }, { status: outcome.replayed ? 200 : 201, headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
