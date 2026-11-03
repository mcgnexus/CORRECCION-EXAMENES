import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { assertSameOrigin, requireOwner } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { responseRectSchema } from "@/domain/phase4-schemas";
import { getAnswerKeyRepository, getAssetRepository, getBatchRepository, getExamRevisionRepository, getResponseRegionRepository, getStructureProposalRepository, getSubmissionRepository } from "@/repositories";
import { getBlobStore } from "@/repositories/blob-store";
import { cropResponseRegion } from "@/lib/response-crop";

const regionInputSchema = z.object({
  questionId: z.string().min(1),
  questionType: z.enum(["short_text", "essay"]),
  pageId: z.string().min(1),
  sourceAssetId: z.string().min(1),
  rect: responseRectSchema,
  order: z.number().int().nonnegative(),
});

const patchSchema = z.object({
  expectedEtag: z.string().min(1).optional(),
  regions: z.array(regionInputSchema).min(1),
});

async function loadQuestions(ownerId: string, examId: string, answerKeyRevisionId: string) {
  const key = await getAnswerKeyRepository().get(ownerId, examId, answerKeyRevisionId);
  if (!key) throw new AppError("ANSWER_KEY_NOT_FOUND", "No se encontró el solucionario.", 404);
  const revision = await getExamRevisionRepository().get(ownerId, examId, key.value.examRevisionId);
  if (!revision?.value.activeStructureProposalId) throw new AppError("STRUCTURE_NOT_FOUND", "No se encontró la estructura activa.", 409);
  const structure = await getStructureProposalRepository().get(ownerId, examId, revision.value.activeStructureProposalId);
  if (!structure) throw new AppError("STRUCTURE_NOT_FOUND", "No se encontró la propuesta de estructura.", 404);
  return new Map(structure.value.questions.map((question) => [question.questionId, question]));
}

export async function GET(_request: Request, context: { params: Promise<{ id: string; batchId: string; submissionId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const submission = await getSubmissionRepository().get(ownerId, params.batchId, params.submissionId);
    if (!submission || submission.value.examId !== params.id) throw new AppError("NOT_FOUND", "Entrega no encontrada.", 404);
    const active = await getResponseRegionRepository().getActive(ownerId, params.submissionId);
    return Response.json({ data: active?.revision ?? null, requestId }, { headers: { "x-request-id": requestId, etag: active?.pointerEtag ?? "" } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; batchId: string; submissionId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { ownerId } = await requireOwner();
    const params = await context.params;
    const input = patchSchema.parse(await request.json());
    const submission = await getSubmissionRepository().get(ownerId, params.batchId, params.submissionId);
    if (!submission || submission.value.examId !== params.id) throw new AppError("NOT_FOUND", "Entrega no encontrada.", 404);
    const batch = await getBatchRepository().get(ownerId, params.id, params.batchId);
    if (!batch) throw new AppError("BATCH_NOT_FOUND", "Lote no encontrado.", 404);
    const questions = await loadQuestions(ownerId, params.id, batch.value.answerKeyRevisionId);
    const seen = new Set<string>();
    const assets = getAssetRepository();
    const blobs = getBlobStore();
    const regions = [];
    for (const item of input.regions) {
      if (seen.has(`${item.questionId}:${item.order}`)) throw new AppError("DUPLICATE_RESPONSE_REGION", "Hay regiones duplicadas para una pregunta.", 400);
      seen.add(`${item.questionId}:${item.order}`);
      const question = questions.get(item.questionId);
      if (!question || question.type !== item.questionType) throw new AppError("QUESTION_TYPE_MISMATCH", "La región no coincide con una pregunta abierta.", 400);
      const pageIndex = submission.value.pageIds.indexOf(item.pageId);
      if (pageIndex < 0 || submission.value.assetIds[pageIndex] !== item.sourceAssetId) throw new AppError("RESPONSE_PAGE_SCOPE_MISMATCH", "La región no pertenece a una imagen de esta entrega.", 400);
      const asset = await assets.getWithMeta(ownerId, item.sourceAssetId);
      if (!asset || asset.asset.examId !== params.id || asset.asset.state !== "validated") throw new AppError("INVALID_PAGE_ASSET", "El asset de la región no es válido.", 400);
      const stored = await blobs.get(asset.asset.blobPath);
      if (!stored) throw new AppError("ASSET_CONTENT_NOT_FOUND", "No se pudo leer el asset de la página.", 404);
      const cropped = await cropResponseRegion({ bytes: stored.body, mimeType: stored.contentType, pageNumber: 1, rotation: 0, rect: item.rect });
      const cropAssetId = randomUUID();
      const cropPath = `owners/${ownerId}/exams/${params.id}/assets/${cropAssetId}/derived/response-region.png`;
      await blobs.put(cropPath, cropped.png, "image/png", { ifNoneMatch: true });
      await assets.create({ assetId: cropAssetId, ownerId, examId: params.id, kind: "derived", state: "validated", origin: "derived", sha256: createHash("sha256").update(cropped.png).digest("hex"), mimeType: "image/png", blobPath: cropPath, sizeBytes: cropped.png.byteLength, width: cropped.width, height: cropped.height, sourceAssetId: item.sourceAssetId });
      regions.push({ regionId: randomUUID(), questionId: item.questionId, questionType: item.questionType, pageId: item.pageId, sourceAssetId: item.sourceAssetId, cropAssetId, rect: item.rect, order: item.order });
    }
    const active = await getResponseRegionRepository().getActive(ownerId, params.submissionId);
    const saved = await getResponseRegionRepository().save({ submissionId: params.submissionId, batchId: params.batchId, examId: params.id, ownerId, state: "ready", regions, createdBy: ownerId }, input.expectedEtag ?? active?.pointerEtag);
    const refreshed = await getSubmissionRepository().get(ownerId, params.batchId, params.submissionId);
    if (refreshed) await getSubmissionRepository().update(ownerId, params.batchId, params.submissionId, refreshed.etag, { activeResponseRegionRevisionId: saved.revision.regionRevisionId, responseBlockingIssues: [] });
    return Response.json({ data: saved.revision, requestId }, { status: 201, headers: { "x-request-id": requestId, etag: saved.pointerEtag } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
