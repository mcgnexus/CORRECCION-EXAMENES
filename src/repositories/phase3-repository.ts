import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { batchSchema, manualDecisionSchema, omrReadingSchema, omrTemplateRevisionSchema, scoreSnapshotSchema, submissionSchema, type Batch, type ManualDecision, type OmrReading, type OmrTemplateRevision, type ScoreSnapshot, type Submission } from "../domain/phase3-schemas";
import { AppError } from "../lib/errors";
import type { BlobStore } from "./blob-store";

function encode(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)); }
function decode<T>(body: Uint8Array) { return JSON.parse(new TextDecoder().decode(body)) as T; }
function now() { return new Date().toISOString(); }

class JsonRepository {
  constructor(protected readonly blobs: BlobStore) {}

  protected async readStored<T>(path: string, schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }) {
    const object = await this.blobs.get(path);
    if (!object) return null;
    const parsed = schema.safeParse(decode<unknown>(object.body));
    if (!parsed.success || !parsed.data) throw new AppError("INVALID_PHASE3_MANIFEST", "El manifiesto de Fase 3 no es válido.", 500);
    return { value: parsed.data, etag: object.etag };
  }

  protected async writeStored<T>(path: string, value: T, ifMatch?: string) {
    return this.blobs.put(path, encode(value), "application/json", ifMatch ? { ifMatch } : { ifNoneMatch: true });
  }

  protected async applyUpdate<T extends { updatedAt: string }>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, current: { value: T; etag: string }, expectedEtag: string, patch: Partial<T>) {
    if (current.etag !== expectedEtag) throw new AppError("ETAG_CONFLICT", "El manifiesto cambió en otro proceso.", 409);
    const updated = schema.safeParse({ ...current.value, ...patch, updatedAt: now() });
    if (!updated.success || !updated.data) throw new AppError("INVALID_PHASE3_MANIFEST", "El parche produce un manifiesto inválido.", 400);
    const stored = await this.writeStored(path, updated.data, expectedEtag);
    return { value: updated.data, etag: stored.etag };
  }
}

export class OmrTemplateRepository extends JsonRepository {
  private path(ownerId: string, examId: string, templateId: string) { return `owners/${ownerId}/exams/${examId}/omr-templates/${templateId}/manifest.json`; }

  async create(input: Omit<OmrTemplateRevision, "schemaVersion" | "templateId" | "state" | "createdAt" | "updatedAt">) {
    const template = omrTemplateRevisionSchema.parse({ ...input, schemaVersion: 1, templateId: randomUUID(), state: "draft", createdAt: now(), updatedAt: now() });
    const stored = await this.writeStored(this.path(template.ownerId, template.examId, template.templateId), template);
    return { template, etag: stored.etag };
  }

  async get(ownerId: string, examId: string, templateId: string) { return this.readStored<OmrTemplateRevision>(this.path(ownerId, examId, templateId), omrTemplateRevisionSchema); }

  async list(ownerId: string, examId: string) {
    const templates: Array<{ value: OmrTemplateRevision; etag: string }> = [];
    for (const path of await this.blobs.list(`owners/${ownerId}/exams/${examId}/omr-templates/`)) {
      if (!path.endsWith("/manifest.json")) continue;
      const item = await this.readStored<OmrTemplateRevision>(path, omrTemplateRevisionSchema);
      if (item) templates.push(item);
    }
    return templates;
  }

  async update(ownerId: string, examId: string, templateId: string, expectedEtag: string, patch: Partial<Omit<OmrTemplateRevision, "templateId" | "ownerId" | "examId" | "createdAt">>) {
    const current = await this.get(ownerId, examId, templateId);
    if (!current) throw new AppError("NOT_FOUND", "Plantilla no encontrada.", 404);
    return this.applyUpdate<OmrTemplateRevision>(this.path(ownerId, examId, templateId), omrTemplateRevisionSchema, current, expectedEtag, patch);
  }
}

export class BatchRepository extends JsonRepository {
  private path(ownerId: string, examId: string, batchId: string) { return `owners/${ownerId}/exams/${examId}/batches/${batchId}/manifest.json`; }

  async create(input: Pick<Batch, "examId" | "ownerId" | "answerKeyRevisionId" | "templateRevisionId" | "scoringPolicyRevisionId" | "scoringPolicy" | "maxPages">) {
    const batch = batchSchema.parse({ schemaVersion: 1, batchId: randomUUID(), ...input, state: "draft", submissionIds: [], blockingIssues: [], createdAt: now(), updatedAt: now() });
    const stored = await this.writeStored(this.path(batch.ownerId, batch.examId, batch.batchId), batch);
    return { batch, etag: stored.etag };
  }

  async get(ownerId: string, examId: string, batchId: string) { return this.readStored<Batch>(this.path(ownerId, examId, batchId), batchSchema); }

  async list(ownerId: string, examId: string) {
    const paths = await this.blobs.list(`owners/${ownerId}/exams/${examId}/batches/`);
    const batches: Array<{ value: Batch; etag: string }> = [];
    for (const path of paths.filter((item) => item.endsWith("/manifest.json"))) {
      const stored = await this.blobs.get(path);
      if (!stored) continue;
      const parsed = batchSchema.safeParse(decode<unknown>(stored.body));
      if (parsed.success) batches.push({ value: parsed.data, etag: stored.etag });
    }
    return batches;
  }

  async update(ownerId: string, examId: string, batchId: string, expectedEtag: string, patch: Partial<Pick<Batch, "state" | "submissionIds" | "blockingIssues" | "closedAt" | "closedBy">>) {
    const current = await this.get(ownerId, examId, batchId);
    if (!current) throw new AppError("NOT_FOUND", "Lote no encontrado.", 404);
    return this.applyUpdate<Batch>(this.path(ownerId, examId, batchId), batchSchema, current, expectedEtag, patch);
  }
}

export class SubmissionRepository extends JsonRepository {
  private path(ownerId: string, batchId: string, submissionId: string) { return `owners/${ownerId}/batches/${batchId}/submissions/${submissionId}/manifest.json`; }

  async create(input: Pick<Submission, "batchId" | "examId" | "ownerId" | "pageIds" | "assetIds">) {
    const submission = submissionSchema.parse({ schemaVersion: 1, submissionId: randomUUID(), ...input, state: "pages_ready", readingIds: [], createdAt: now(), updatedAt: now() });
    const stored = await this.writeStored(this.path(submission.ownerId, submission.batchId, submission.submissionId), submission);
    return { submission, etag: stored.etag };
  }

  async get(ownerId: string, batchId: string, submissionId: string) { return this.readStored<Submission>(this.path(ownerId, batchId, submissionId), submissionSchema); }

  async list(ownerId: string, batchId: string) {
    const paths = await this.blobs.list(`owners/${ownerId}/batches/${batchId}/submissions/`);
    const submissions: Array<{ value: Submission; etag: string }> = [];
    for (const path of paths.filter((item) => item.endsWith("/manifest.json"))) {
      const stored = await this.blobs.get(path);
      if (!stored) continue;
      const parsed = submissionSchema.safeParse(decode<unknown>(stored.body));
      if (parsed.success) submissions.push({ value: parsed.data, etag: stored.etag });
    }
    return submissions;
  }

  async update(ownerId: string, batchId: string, submissionId: string, expectedEtag: string, patch: Partial<Pick<Submission, "state" | "suggestedIdentity" | "identityConfidence" | "identitySource" | "confirmedIdentity" | "confirmedBy" | "confirmedAt" | "responsesConfirmedAt" | "responsesConfirmedBy" | "responsesFingerprint" | "comparisonConfirmedAt" | "comparisonConfirmedBy" | "comparisonAnswerKeyRevisionId" | "comparisonFingerprint" | "ocrRef" | "readingIds" | "snapshotId" | "activeResponseRegionRevisionId" | "responseTranscriptionIds" | "responseEvaluationIds" | "responseDecisionIds" | "responseBlockingIssues">>) {
    const current = await this.get(ownerId, batchId, submissionId);
    if (!current) throw new AppError("NOT_FOUND", "Entrega no encontrada.", 404);
    return this.applyUpdate<Submission>(this.path(ownerId, batchId, submissionId), submissionSchema, current, expectedEtag, patch);
  }
}

export class OmrReadingRepository extends JsonRepository {
  private path(ownerId: string, readingId: string) { return `owners/${ownerId}/omr-readings/${readingId}.json`; }

  async create(input: Omit<OmrReading, "schemaVersion" | "readingId" | "createdAt" | "updatedAt">) {
    const reading = omrReadingSchema.parse({ ...input, schemaVersion: 1, readingId: randomUUID(), createdAt: now(), updatedAt: now() });
    const stored = await this.writeStored(this.path(reading.ownerId, reading.readingId), reading);
    return { reading, etag: stored.etag };
  }

  async get(ownerId: string, readingId: string) { return this.readStored<OmrReading>(this.path(ownerId, readingId), omrReadingSchema); }

  async list(ownerId: string, readingIds: string[]) {
    return (await Promise.all(readingIds.map((readingId) => this.get(ownerId, readingId)))).filter((reading): reading is { value: OmrReading; etag: string } => Boolean(reading));
  }

  async findByInput(ownerId: string, readingIds: string[], assetId: string, templateRevisionId: string, inputHash: string) {
    const readings = await this.list(ownerId, readingIds);
    return readings.find((item) => item.value.assetId === assetId && item.value.templateRevisionId === templateRevisionId && item.value.inputHash === inputHash) ?? null;
  }

  async update(ownerId: string, readingId: string, expectedEtag: string, patch: Partial<Pick<OmrReading, "status" | "rows" | "alignment" | "errorCode">>) {
    const current = await this.get(ownerId, readingId);
    if (!current) throw new AppError("NOT_FOUND", "Lectura no encontrada.", 404);
    return this.applyUpdate<OmrReading>(this.path(ownerId, readingId), omrReadingSchema, current, expectedEtag, patch);
  }
}

export class ManualDecisionRepository extends JsonRepository {
  private path(ownerId: string, decisionId: string) { return `owners/${ownerId}/omr-decisions/${decisionId}.json`; }

  async create(input: Omit<ManualDecision, "schemaVersion" | "decisionId" | "decidedAt">) {
    const decision = manualDecisionSchema.parse({ ...input, schemaVersion: 1, decisionId: randomUUID(), decidedAt: now() });
    const stored = await this.writeStored(this.path(decision.actorId, decision.decisionId), decision);
    return { decision, etag: stored.etag };
  }

  async listByReadings(ownerId: string, readingIds: string[]) {
    const wanted = new Set(readingIds);
    const paths = await this.blobs.list(`owners/${ownerId}/omr-decisions/`);
    const decisions: ManualDecision[] = [];
    for (const path of paths) {
      const stored = await this.blobs.get(path);
      if (!stored) continue;
      const parsed = manualDecisionSchema.safeParse(decode<unknown>(stored.body));
      if (parsed.success && wanted.has(parsed.data.readingId)) decisions.push(parsed.data);
    }
    return decisions;
  }
}

export class ScoreSnapshotRepository extends JsonRepository {
  private path(ownerId: string, snapshotId: string) { return `owners/${ownerId}/score-snapshots/${snapshotId}.json`; }

  async create(input: Omit<ScoreSnapshot, "schemaVersion" | "snapshotId" | "createdAt" | "updatedAt">) {
    const snapshot = scoreSnapshotSchema.parse({ ...input, schemaVersion: 1, snapshotId: randomUUID(), createdAt: now(), updatedAt: now() });
    const stored = await this.writeStored(this.path(snapshot.ownerId, snapshot.snapshotId), snapshot);
    return { snapshot, etag: stored.etag };
  }

  async get(ownerId: string, snapshotId: string) { return this.readStored<ScoreSnapshot>(this.path(ownerId, snapshotId), scoreSnapshotSchema); }

  async update(ownerId: string, snapshotId: string, expectedEtag: string, patch: Partial<Pick<ScoreSnapshot, "state" | "questionScores" | "correct" | "blank" | "incorrect" | "pending" | "rawPoints" | "score" | "blockingIssues" | "openQuestionScores" | "openPoints" | "openMaximumPoints" | "openPending" | "responseRegionRevisionId" | "transcriptionRevisionIds" | "evaluationIds" | "decisionIds">>) {
    const current = await this.get(ownerId, snapshotId);
    if (!current) throw new AppError("NOT_FOUND", "Snapshot no encontrado.", 404);
    return this.applyUpdate<ScoreSnapshot>(this.path(ownerId, snapshotId), scoreSnapshotSchema, current, expectedEtag, patch);
  }
}
