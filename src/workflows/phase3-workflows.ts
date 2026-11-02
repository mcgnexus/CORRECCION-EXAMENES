import { createHash } from "node:crypto";
import { omrRowResultSchema, type OmrTemplateRevision } from "@/domain/phase3-schemas";
import { ProviderError } from "@/providers/contracts";
import { getAssetRepository, getBatchRepository, getDocumentPagesRepository, getExamRepository, getOmrReadingRepository, getOmrTemplateRepository, getSubmissionRepository } from "@/repositories";
import { getBlobStore } from "@/repositories/blob-store";
import { AppError } from "@/lib/errors";

type OmrPageInput = {
  submissionId: string;
  batchId: string;
  examId: string;
  ownerId: string;
  pageId: string;
  assetId: string;
  imageBase64: string;
};

const INTERNAL_TIMEOUT_MS = 120_000;

async function loadSubmissionPages(input: { ownerId: string; batchId: string; examId: string; submissionId: string }) {
  "use step";
  const submission = await getSubmissionRepository().get(input.ownerId, input.batchId, input.submissionId);
  if (!submission) throw new AppError("SUBMISSION_NOT_FOUND", "Entrega no encontrada.", 404);
  const assets = getAssetRepository();
  const blobs = getBlobStore();
  const pages: OmrPageInput[] = [];
  for (let index = 0; index < submission.value.assetIds.length; index += 1) {
    const asset = await assets.getWithMeta(input.ownerId, submission.value.assetIds[index]);
    if (!asset || asset.asset.state !== "validated" || !asset.asset.mimeType.startsWith("image/")) continue;
    const stored = await blobs.get(asset.asset.blobPath);
    if (!stored) continue;
    pages.push({
      submissionId: input.submissionId,
      batchId: input.batchId,
      examId: input.examId,
      ownerId: input.ownerId,
      pageId: submission.value.pageIds[index] ?? asset.asset.assetId,
      assetId: asset.asset.assetId,
      imageBase64: Buffer.from(stored.body).toString("base64"),
    });
  }
  if (pages.length === 0) throw new AppError("NO_IMAGE_PAGES", "La entrega no tiene páginas de imagen válidas.", 400);
  return pages;
}

async function loadTemplate(input: { ownerId: string; examId: string; templateRevisionId: string }) {
  "use step";
  const template = await getOmrTemplateRepository().get(input.ownerId, input.examId, input.templateRevisionId);
  if (!template) throw new AppError("TEMPLATE_NOT_FOUND", "Plantilla no encontrada.", 404);
  if (template.value.state !== "approved") throw new AppError("TEMPLATE_NOT_APPROVED", "La plantilla no está aprobada.", 409);
  return template.value;
}

async function callPythonOmr(page: OmrPageInput, template: OmrTemplateRevision) {
  "use step";
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (!secret) throw new AppError("INTERNAL_SERVICE_NOT_CONFIGURED", "Falta INTERNAL_SERVICE_SECRET.", 503);
  const body = JSON.stringify({
    assetId: page.assetId,
    mode: "asset_bytes",
    imageBase64: page.imageBase64,
    template: {
      canvasWidth: template.canvasWidth,
      canvasHeight: template.canvasHeight,
      sourceAnchors: template.sourceAnchors,
      targetAnchors: template.targetAnchors,
      bubbles: template.bubbles,
      threshold: template.threshold,
      margin: template.margin,
      algorithmVersion: template.algorithmVersion,
    },
  });
  const origin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
  const response = await fetch(`${origin}/api/omr`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-service-secret": secret },
    body,
    signal: AbortSignal.timeout(INTERNAL_TIMEOUT_MS),
  });
  if (response.status === 429 || response.status >= 500) throw new AppError("OMR_SERVICE_RETRYABLE", `El servicio OMR respondió HTTP ${response.status}.`, 503, true);
  if (!response.ok) throw new AppError("OMR_SERVICE_FAILED", `El servicio OMR respondió HTTP ${response.status}.`, 502);
  const payload = (await response.json()) as { result: { rows: unknown; alignment: Record<string, unknown> } };
  return payload.result;
}

async function persistReading(page: OmrPageInput, template: OmrTemplateRevision, result: { rows: unknown; alignment: Record<string, unknown> }) {
  "use step";
  const parsedRows = omrRowResultSchema.array().parse(result.rows);
  const inputHash = createHash("sha256").update(`${page.assetId}:${template.templateId}:${template.algorithmVersion}`).digest("hex");
  const reading = await getOmrReadingRepository().create({
    submissionId: page.submissionId,
    batchId: page.batchId,
    examId: page.examId,
    ownerId: page.ownerId,
    pageId: page.pageId,
    assetId: page.assetId,
    templateRevisionId: template.templateId,
    algorithmVersion: template.algorithmVersion,
    inputHash,
    alignment: result.alignment,
    rows: parsedRows,
    status: "completed",
  });
  const submission = await getSubmissionRepository().get(page.ownerId, page.batchId, page.submissionId);
  if (submission && !submission.value.readingIds.includes(reading.reading.readingId)) {
    await getSubmissionRepository().update(page.ownerId, page.batchId, page.submissionId, submission.etag, { readingIds: [...submission.value.readingIds, reading.reading.readingId], state: "review" });
  }
  return reading.reading.readingId;
}

async function persistReadingError(page: OmrPageInput, template: OmrTemplateRevision, errorCode: string) {
  "use step";
  const inputHash = createHash("sha256").update(`${page.assetId}:${template.templateId}:${template.algorithmVersion}:error`).digest("hex");
  const reading = await getOmrReadingRepository().create({
    submissionId: page.submissionId,
    batchId: page.batchId,
    examId: page.examId,
    ownerId: page.ownerId,
    pageId: page.pageId,
    assetId: page.assetId,
    templateRevisionId: template.templateId,
    algorithmVersion: template.algorithmVersion,
    inputHash,
    alignment: {},
    rows: [],
    status: "failed",
    errorCode,
  });
  return reading.reading.readingId;
}

async function finalizeBatchReading(input: { ownerId: string; examId: string; batchId: string; readingIds: string[]; errors: string[] }) {
  "use step";
  const batch = await getBatchRepository().get(input.ownerId, input.examId, input.batchId);
  if (!batch) throw new AppError("BATCH_NOT_FOUND", "Lote no encontrado.", 404);
  const blockingIssues = input.errors.length > 0 ? input.errors : [];
  const state = input.errors.length > 0 ? "review" : "review";
  const updated = await getBatchRepository().update(input.ownerId, input.examId, input.batchId, batch.etag, { state, blockingIssues });
  return { batchId: input.batchId, state: updated.value.state, readingIds: input.readingIds, blockingIssues };
}

export async function readSubmissionOmrWorkflow(input: { ownerId: string; examId: string; batchId: string; submissionId: string; templateRevisionId: string }) {
  "use workflow";
  const template = await loadTemplate(input);
  const pages = await loadSubmissionPages(input);
  const readingIds: string[] = [];
  const errors: string[] = [];
  for (const page of pages) {
    try {
      const result = await callPythonOmr(page, template);
      readingIds.push(await persistReading(page, template, result));
    } catch (error) {
      const errorCode = error instanceof ProviderError || error instanceof AppError ? error.code : "OMR_PROCESSING_FAILED";
      errors.push(`${page.assetId}:${errorCode}`);
      readingIds.push(await persistReadingError(page, template, errorCode));
    }
  }
  return finalizeBatchReading({ ownerId: input.ownerId, examId: input.examId, batchId: input.batchId, readingIds, errors });
}
