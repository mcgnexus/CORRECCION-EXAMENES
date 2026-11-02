import { AppError } from "@/lib/errors";
import type { ExportFormat } from "@/domain/phase5-schemas";
import type { Batch, ScoreSnapshot, Submission } from "@/domain/phase3-schemas";

export type ExportClosedBatchInput = {
  ownerId: string;
  examId: string;
  batchId: string;
  jobId: string;
  formats: ExportFormat[];
  includeOriginal: boolean;
  retentionHours: number;
};

type ExportContext = { batch: Batch; submissions: Submission[]; snapshots: ScoreSnapshot[] };
type ExportQuestion = { questionId: string; transcription?: string; decision?: string; points?: number; maximumPoints?: number; criteria?: string };
type ExportCollected = { context: ExportContext; rows: Array<Record<string, string | number>>; pdfInputs: Array<{ submission: Submission; snapshot: ScoreSnapshot; questions: ExportQuestion[]; sections: Array<{ sectionId: string; points: number; maximumPoints: number }>; incidents: string[] }> };

async function setJobProgress(input: ExportClosedBatchInput, phase: string, current: number, completed: number, total: number) {
  "use step";
  const { getJobRepository } = await import("@/repositories");
  const repository = getJobRepository();
  const result = await repository.getWithMeta(input.ownerId, input.jobId);
  if (!result) throw new AppError("JOB_NOT_FOUND", "Trabajo de exportación no encontrado.", 404);
  const progress = { phase: phase as "queued" | "collect" | "csv" | "xlsx" | "pdf" | "cleanup" | "completed" | "failed" | "cancelled", current, completed, total, percent: total === 0 ? 0 : Math.min(100, Math.round((completed / total) * 100)) };
  return repository.updateWithMeta(input.ownerId, input.jobId, result.etag, { status: "running", phase, step: phase, progress });
}

async function isCancelled(input: ExportClosedBatchInput) {
  "use step";
  const { getJobRepository } = await import("@/repositories");
  const current = await getJobRepository().getWithMeta(input.ownerId, input.jobId);
  return current?.job.status === "cancel_requested" || current?.job.status === "cancelled";
}

async function loadAndValidate(input: ExportClosedBatchInput): Promise<ExportContext> {
  "use step";
  const { getAnswerKeyRepository, getBatchRepository, getOmrTemplateRepository, getScoreSnapshotRepository, getSubmissionRepository } = await import("@/repositories");
  const batch = await getBatchRepository().get(input.ownerId, input.examId, input.batchId);
  if (!batch || batch.value.state !== "closed") throw new AppError("BATCH_NOT_CLOSED", "Solo se puede exportar un lote cerrado.", 409);
  if (batch.value.submissionIds.length === 0) throw new AppError("BATCH_EMPTY", "No se puede exportar un lote vacío.", 409);
  if (batch.value.blockingIssues.length > 0) throw new AppError("BATCH_BLOCKED", "El lote contiene incidencias bloqueantes.", 409);
  const [answerKey, template] = await Promise.all([
    getAnswerKeyRepository().get(input.ownerId, input.examId, batch.value.answerKeyRevisionId),
    getOmrTemplateRepository().get(input.ownerId, input.examId, batch.value.templateRevisionId),
  ]);
  if (!answerKey || answerKey.value.status !== "approved" || answerKey.value.scoringPolicyRevisionId !== batch.value.scoringPolicyRevisionId) throw new AppError("EXPORT_DEPENDENCIES_STALE", "El answer key del lote ya no es válido.", 409);
  if (!template || template.value.state !== "approved") throw new AppError("EXPORT_DEPENDENCIES_STALE", "La plantilla del lote ya no es válida.", 409);
  const submissions = await Promise.all(batch.value.submissionIds.map((id) => getSubmissionRepository().get(input.ownerId, input.batchId, id)));
  if (submissions.some((item) => !item)) throw new AppError("SUBMISSION_MANIFEST_MISSING", "Falta una entrega del lote.", 409);
  const values = submissions.map((item) => item!.value);
  const snapshots = await Promise.all(values.map(async (submission) => submission.snapshotId ? getScoreSnapshotRepository().get(input.ownerId, submission.snapshotId) : null));
  if (snapshots.some((item) => !item || item.value.state !== "closed" || item.value.blockingIssues.length > 0)) throw new AppError("SNAPSHOT_NOT_EXPORTABLE", "Hay snapshots sin cierre definitivo.", 409);
  for (let index = 0; index < values.length; index += 1) {
    const submission = values[index];
    const snapshot = snapshots[index]!.value;
    if (submission.state !== "closed" || submission.responseBlockingIssues.length > 0 || snapshot.submissionId !== submission.submissionId || snapshot.batchId !== input.batchId || snapshot.examId !== input.examId || snapshot.ownerId !== input.ownerId || snapshot.answerKeyRevisionId !== batch.value.answerKeyRevisionId || snapshot.templateRevisionId !== batch.value.templateRevisionId || snapshot.scoringPolicyRevisionId !== batch.value.scoringPolicyRevisionId || snapshot.responseRegionRevisionId !== submission.activeResponseRegionRevisionId || JSON.stringify(snapshot.transcriptionRevisionIds) !== JSON.stringify(submission.responseTranscriptionIds) || JSON.stringify(snapshot.evaluationIds) !== JSON.stringify(submission.responseEvaluationIds) || JSON.stringify(snapshot.decisionIds) !== JSON.stringify(submission.responseDecisionIds)) throw new AppError("EXPORT_DEPENDENCIES_STALE", "Las dependencias de una entrega cambiaron.", 409);
  }
  return { batch: batch.value, submissions: values, snapshots: snapshots.map((item) => item!.value) };
}

async function collectData(input: ExportClosedBatchInput, context: ExportContext): Promise<ExportCollected> {
  "use step";
  const { getAnswerKeyRepository, getResponseDecisionRepository, getTranscriptionRepository } = await import("@/repositories");
  const answerKey = await getAnswerKeyRepository().get(input.ownerId, input.examId, context.batch.answerKeyRevisionId);
  const rows: Array<Record<string, string | number>> = [];
  const pdfInputs: ExportCollected["pdfInputs"] = [];
  for (let index = 0; index < context.submissions.length; index += 1) {
    const submission = context.submissions[index];
    const snapshot = context.snapshots[index];
    const decisions = await getResponseDecisionRepository().list(input.ownerId, submission.submissionId);
    const transcriptions = await getTranscriptionRepository().list(input.ownerId, submission.submissionId);
    const activeDecisions = decisions.filter((item) => snapshot.decisionIds.includes(item.value.decisionId)).map((item) => item.value);
    const activeTranscriptions = transcriptions.filter((item) => snapshot.transcriptionRevisionIds.includes(item.value.transcriptionId)).map((item) => item.value);
    const sections = new Map<string, { points: number; maximumPoints: number }>(context.batch.scoringPolicy.sections.map((section) => [section.sectionId, { points: 0, maximumPoints: section.maxPoints }]));
    const closedQuestions: ExportQuestion[] = snapshot.questionScores.map((score) => {
      const answerKeyDecision = answerKey?.value.decisions[score.questionId];
      const section = answerKeyDecision?.sectionId;
      const points = score.outcome === "correct" ? context.batch.scoringPolicy.correctPoints : score.outcome === "blank" ? context.batch.scoringPolicy.blankPoints : score.outcome === "incorrect" ? context.batch.scoringPolicy.incorrectPenalty : undefined;
      if (section && points !== undefined) sections.set(section, { ...(sections.get(section) ?? { points: 0, maximumPoints: 0 }), points: (sections.get(section)?.points ?? 0) + points });
      return { questionId: score.questionId, decision: score.outcome, points, maximumPoints: points === undefined ? undefined : context.batch.scoringPolicy.correctPoints };
    });
    for (const score of snapshot.openQuestionScores) {
      const current = sections.get(score.sectionId) ?? { points: 0, maximumPoints: 0 };
      current.points += score.points;
      current.maximumPoints += score.maximumPoints;
      sections.set(score.sectionId, current);
    }
    const questions: ExportQuestion[] = [...closedQuestions, ...snapshot.openQuestionScores.map((score) => {
      const transcription = activeTranscriptions.find((item) => item.transcriptionId === score.transcriptionId);
      const decision = activeDecisions.find((item) => item.decisionId === score.decisionId);
      return { questionId: score.questionId, transcription: transcription?.correctedText ?? transcription?.normalizedText ?? transcription?.literalText, decision: decision?.source, points: score.points, maximumPoints: score.maximumPoints, criteria: decision?.criterionScores.map((criterion) => `${criterion.criterionId}:${criterion.points}/${criterion.maxPoints}`).join(", ") };
    })];
    const incidents = [...submission.responseBlockingIssues, ...snapshot.blockingIssues];
    const sectionValues = [...sections.entries()].map(([sectionId, value]) => ({ sectionId, ...value }));
    rows.push({ submissionId: submission.submissionId, identity: submission.confirmedIdentity ?? "", createdAt: submission.createdAt, closedAt: submission.updatedAt, score: snapshot.score, rawPoints: snapshot.rawPoints, correct: snapshot.correct, blank: snapshot.blank, incorrect: snapshot.incorrect, pending: snapshot.pending, openPoints: snapshot.openPoints, openMaximumPoints: snapshot.openMaximumPoints, sectionPoints: JSON.stringify(sectionValues), snapshotId: snapshot.snapshotId, responseRegionRevisionId: snapshot.responseRegionRevisionId ?? "", transcriptionRevisionIds: JSON.stringify(snapshot.transcriptionRevisionIds), evaluationIds: JSON.stringify(snapshot.evaluationIds), decisionIds: JSON.stringify(snapshot.decisionIds), incidents: JSON.stringify(incidents) });
    pdfInputs.push({ submission, snapshot, questions, sections: sectionValues, incidents });
  }
  return { context, rows, pdfInputs };
}

async function appendOutputRefs(input: ExportClosedBatchInput, outputId: string) {
  "use step";
  const { getJobRepository } = await import("@/repositories");
  const repository = getJobRepository();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await repository.getWithMeta(input.ownerId, input.jobId);
    if (!current) throw new AppError("JOB_NOT_FOUND", "Trabajo no encontrado.", 404);
    if (current.job.outputRefs.includes(outputId)) return current.job;
    try { return (await repository.updateWithMeta(input.ownerId, input.jobId, current.etag, { outputRefs: [...current.job.outputRefs, outputId] })).job; } catch (error) { if (!(error instanceof AppError) || error.code !== "ETAG_CONFLICT") throw error; }
  }
  throw new AppError("ETAG_CONFLICT", "No se pudo actualizar la salida del trabajo.", 409, true);
}

async function renderAndSaveBatchOutput(input: ExportClosedBatchInput, format: "csv" | "xlsx", collected: ExportCollected, snapshotRefs: string[], revisionRefs: string[]) {
  "use step";
  const { generateCsv, generateXlsx } = await import("@/lib/export-generation");
  const { getExportRepository } = await import("@/repositories");
  const { mimeFor } = await import("@/lib/export-generation");
  const body = format === "csv" ? generateCsv(collected.rows as never) : await generateXlsx(collected.rows as never, { batchId: input.batchId, examId: input.examId, snapshotIds: JSON.stringify(snapshotRefs), dependencies: JSON.stringify(revisionRefs), exportedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + input.retentionHours * 60 * 60 * 1000).toISOString() });
  return getExportRepository().create({ ownerId: input.ownerId, examId: input.examId, batchId: input.batchId, format, body, mimeType: mimeFor(format), sizeBytes: body.byteLength, snapshotRefs, revisionRefs, expiresAt: new Date(Date.now() + input.retentionHours * 60 * 60 * 1000).toISOString() });
}

async function renderAndSavePdf(input: ExportClosedBatchInput, item: ExportCollected["pdfInputs"][number], revisionRefs: string[]) {
  "use step";
  const { generatePdf, mimeFor } = await import("@/lib/export-generation");
  const { getAssetRepository, getExportRepository } = await import("@/repositories");
  const { getBlobStore } = await import("@/repositories/blob-store");
  const originals: Array<{ mimeType: string; body: Uint8Array }> = [];
  if (input.includeOriginal) for (const assetId of item.submission.assetIds) {
    const asset = await getAssetRepository().getWithMeta(input.ownerId, assetId);
    if (!asset || asset.asset.state !== "validated") continue;
    const stored = await getBlobStore().get(asset.asset.blobPath);
    if (stored) originals.push({ mimeType: asset.asset.mimeType, body: stored.body });
  }
  const body = await generatePdf({ identity: item.submission.confirmedIdentity ?? "", submissionId: item.submission.submissionId, score: item.snapshot.score, rawPoints: item.snapshot.rawPoints, correct: item.snapshot.correct, blank: item.snapshot.blank, incorrect: item.snapshot.incorrect, pending: item.snapshot.pending, openPoints: item.snapshot.openPoints, openMaximumPoints: item.snapshot.openMaximumPoints, snapshotId: item.snapshot.snapshotId, exportedAt: new Date().toISOString(), sections: item.sections, questions: item.questions, incidents: item.incidents }, originals);
  return getExportRepository().create({ ownerId: input.ownerId, examId: input.examId, batchId: input.batchId, format: "pdf", body, mimeType: mimeFor("pdf"), sizeBytes: body.byteLength, snapshotRefs: [item.snapshot.snapshotId], revisionRefs, expiresAt: new Date(Date.now() + input.retentionHours * 60 * 60 * 1000).toISOString() });
}

async function cleanupOutputs(input: ExportClosedBatchInput, status: "cancelled" | "failed", errorCode?: string) {
  "use step";
  const { getExportRepository, getJobRepository } = await import("@/repositories");
  const exports = getExportRepository();
  const jobs = getJobRepository();
  const current = await jobs.getWithMeta(input.ownerId, input.jobId);
  if (!current) return;
  for (const outputId of current.job.outputRefs) {
    const output = await exports.getWithMeta(input.ownerId, outputId);
    if (!output) continue;
    await exports.deleteContent(output.manifest);
    await exports.markDeleted(input.ownerId, outputId, output.etag).then(() => exports.deleteManifest(output.manifest)).catch(() => undefined);
  }
  const refreshed = await jobs.getWithMeta(input.ownerId, input.jobId);
  if (refreshed) await jobs.updateWithMeta(input.ownerId, input.jobId, refreshed.etag, { status, phase: status, step: status, errorCode, retryable: status === "failed", outputRefs: [], progress: { phase: status, current: 0, completed: 0, total: refreshed.job.progress.total, percent: status === "cancelled" ? 0 : refreshed.job.progress.percent } });
}

async function finish(input: ExportClosedBatchInput, total: number) {
  "use step";
  const { getAuditRepository, getJobRepository } = await import("@/repositories");
  const current = await getJobRepository().getWithMeta(input.ownerId, input.jobId);
  if (current) {
    await getJobRepository().updateWithMeta(input.ownerId, input.jobId, current.etag, { status: "completed", phase: "completed", step: "completed", retryable: false, progress: { phase: "completed", current: total, completed: total, total, percent: 100 } });
    await getAuditRepository().append({ ownerId: input.ownerId, actorId: input.ownerId, type: "export.completed", aggregateType: "job", aggregateId: input.jobId, payload: { examId: input.examId, batchId: input.batchId, outputCount: current.job.outputRefs.length } });
  }
}

async function readOutputRefs(input: ExportClosedBatchInput) {
  "use step";
  const { getJobRepository } = await import("@/repositories");
  return (await getJobRepository().getWithMeta(input.ownerId, input.jobId))?.job.outputRefs ?? [];
}

export async function exportClosedBatchWorkflow(input: ExportClosedBatchInput) {
  "use workflow";
  let total = input.formats.filter((format) => format !== "pdf").length;
  const context = await loadAndValidate(input);
  total += input.formats.includes("pdf") ? context.submissions.length : 0;
  await setJobProgress(input, "collect", 0, 0, total);
  const collected = await collectData(input, context);
  let completed = 0;
  try {
    if (await isCancelled(input)) { await cleanupOutputs(input, "cancelled"); return { status: "cancelled" as const }; }
    const snapshotRefs = context.snapshots.map((snapshot) => snapshot.snapshotId);
    const revisionRefs = [context.batch.answerKeyRevisionId, context.batch.templateRevisionId, context.batch.scoringPolicyRevisionId];
    if (input.formats.includes("csv")) {
      const output = await renderAndSaveBatchOutput(input, "csv", collected, snapshotRefs, revisionRefs);
      await appendOutputRefs(input, output.manifest.exportId); completed += 1; await setJobProgress(input, "csv", completed, completed, total);
    }
    if (input.formats.includes("xlsx")) {
      const output = await renderAndSaveBatchOutput(input, "xlsx", collected, snapshotRefs, revisionRefs);
      await appendOutputRefs(input, output.manifest.exportId); completed += 1; await setJobProgress(input, "xlsx", completed, completed, total);
    }
    if (input.formats.includes("pdf")) {
      for (const item of collected.pdfInputs) {
        if (await isCancelled(input)) { await cleanupOutputs(input, "cancelled"); return { status: "cancelled" as const }; }
        const output = await renderAndSavePdf(input, item, revisionRefs);
        await appendOutputRefs(input, output.manifest.exportId); completed += 1; await setJobProgress(input, "pdf", completed, completed, total);
      }
    }
    await setJobProgress(input, "cleanup", completed, completed, total);
    await finish(input, total);
    return { status: "completed" as const, outputRefs: await readOutputRefs(input) };
  } catch (error) {
    const code = error instanceof AppError ? error.code : "EXPORT_FAILED";
    await cleanupOutputs(input, "failed", code);
    throw error;
  }
}
