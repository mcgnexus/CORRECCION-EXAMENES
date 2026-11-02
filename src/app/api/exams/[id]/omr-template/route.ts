import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getExamRepository, getOmrTemplateRepository } from "@/repositories";
import { omrBubbleSchema } from "@/domain/phase3-schemas";

const createSchema = z.object({
  canvasWidth: z.number().int().positive().max(10_000),
  canvasHeight: z.number().int().positive().max(10_000),
  sourceAnchors: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).length(4),
  targetAnchors: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).length(4),
  bubbles: z.array(omrBubbleSchema).min(1),
  threshold: z.number().min(0).max(1).default(0.35),
  margin: z.number().min(0).max(1).default(0.08),
  algorithmVersion: z.string().min(1).default("omr-1"),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const examId = (await context.params).id;
    if (!(await getExamRepository().get(ownerId, examId))) throw new AppError("NOT_FOUND", "Examen no encontrado.", 404);
    const input = createSchema.parse(await request.json());
    const result = await getOmrTemplateRepository().create({ ...input, examId, ownerId });
    return Response.json({ data: result.template, requestId }, { status: 201, headers: { "x-request-id": requestId, etag: result.etag } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
