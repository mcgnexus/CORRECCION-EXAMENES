import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { AppError } from "../lib/errors";
import { evaluationProposalSchema, responseDecisionSchema, responseRegionPointerSchema, responseRegionRevisionSchema, transcriptionRevisionSchema, type EvaluationProposal, type ResponseDecision, type ResponseRegionRevision, type TranscriptionRevision } from "../domain/phase4-schemas";
import type { BlobStore } from "./blob-store";

function encode(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)); }
function decode<T>(body: Uint8Array) { return JSON.parse(new TextDecoder().decode(body)) as T; }
function now() { return new Date().toISOString(); }

class Phase4JsonRepository {
  constructor(protected readonly blobs: BlobStore) {}

  protected async readStored<T>(path: string, schema: z.ZodType<T>) {
    const object = await this.blobs.get(path);
    if (!object) return null;
    const parsed = schema.safeParse(decode<unknown>(object.body));
    if (!parsed.success) throw new AppError("INVALID_PHASE4_MANIFEST", "El manifiesto de Fase 4 no es válido.", 500);
    return { value: parsed.data, etag: object.etag };
  }

  protected async writeStored<T>(path: string, value: T, options: { ifMatch?: string; ifNoneMatch?: boolean } = {}) {
    return this.blobs.put(path, encode(value), "application/json", options);
  }

  protected async listStored<T>(prefix: string, schema: z.ZodType<T>) {
    const values: Array<{ value: T; etag: string }> = [];
    for (const path of await this.blobs.list(prefix)) {
      const object = await this.blobs.get(path);
      if (!object) continue;
      const parsed = schema.safeParse(decode<unknown>(object.body));
      if (parsed.success) values.push({ value: parsed.data, etag: object.etag });
    }
    return values;
  }
}

export class ResponseRegionRepository extends Phase4JsonRepository {
  private prefix(ownerId: string, submissionId: string) { return `owners/${ownerId}/submissions/${submissionId}/responses/regions/`; }
  private pointerPath(ownerId: string, submissionId: string) { return `${this.prefix(ownerId, submissionId)}active.json`; }
  private revisionPath(ownerId: string, submissionId: string, revisionId: string) { return `${this.prefix(ownerId, submissionId)}revisions/${revisionId}.json`; }

  async getActive(ownerId: string, submissionId: string) {
    const pointer = await this.readStored(this.pointerPath(ownerId, submissionId), responseRegionPointerSchema);
    if (!pointer) return null;
    const revision = await this.readStored(this.revisionPath(ownerId, submissionId, pointer.value.activeRevisionId), responseRegionRevisionSchema);
    if (!revision) throw new AppError("RESPONSE_REGIONS_MISSING", "La revisión activa de regiones no existe.", 500);
    return { revision: revision.value, pointerEtag: pointer.etag, revisionEtag: revision.etag };
  }

  async getRevision(ownerId: string, submissionId: string, revisionId: string) {
    return this.readStored(this.revisionPath(ownerId, submissionId, revisionId), responseRegionRevisionSchema);
  }

  async save(input: Omit<ResponseRegionRevision, "schemaVersion" | "regionRevisionId" | "createdAt" | "updatedAt">, expectedPointerEtag?: string) {
    const regionRevision = responseRegionRevisionSchema.parse({ ...input, schemaVersion: 1, regionRevisionId: randomUUID(), createdAt: now(), updatedAt: now() });
    const active = await this.getActive(regionRevision.ownerId, regionRevision.submissionId);
    if (active && active.pointerEtag !== expectedPointerEtag) throw new AppError("ETAG_CONFLICT", "Las regiones fueron modificadas por otro proceso.", 409);
    if (!active && expectedPointerEtag) throw new AppError("ETAG_CONFLICT", "La revisión de regiones ya no existe.", 409);
    const revisionStored = await this.writeStored(this.revisionPath(regionRevision.ownerId, regionRevision.submissionId, regionRevision.regionRevisionId), regionRevision, { ifNoneMatch: true });
    const pointer = responseRegionPointerSchema.parse({ schemaVersion: 1, ownerId: regionRevision.ownerId, submissionId: regionRevision.submissionId, activeRevisionId: regionRevision.regionRevisionId, updatedAt: now() });
    const pointerStored = await this.writeStored(this.pointerPath(regionRevision.ownerId, regionRevision.submissionId), pointer, active ? { ifMatch: active.pointerEtag } : { ifNoneMatch: true });
    return { revision: regionRevision, revisionEtag: revisionStored.etag, pointerEtag: pointerStored.etag };
  }
}

export class TranscriptionRepository extends Phase4JsonRepository {
  private path(ownerId: string, submissionId: string, transcriptionId: string) { return `owners/${ownerId}/submissions/${submissionId}/responses/transcriptions/${transcriptionId}.json`; }

  async create(input: Omit<TranscriptionRevision, "schemaVersion" | "transcriptionId" | "createdAt" | "updatedAt">) {
    const transcription = transcriptionRevisionSchema.parse({ ...input, schemaVersion: 1, transcriptionId: randomUUID(), createdAt: now(), updatedAt: now() });
    const stored = await this.writeStored(this.path(transcription.ownerId, transcription.submissionId, transcription.transcriptionId), transcription, { ifNoneMatch: true });
    return { transcription, etag: stored.etag };
  }

  async get(ownerId: string, submissionId: string, transcriptionId: string) { return this.readStored(this.path(ownerId, submissionId, transcriptionId), transcriptionRevisionSchema); }
  async list(ownerId: string, submissionId: string) { return this.listStored(`${this.path(ownerId, submissionId, "").replace(/\.json$/, "")}`, transcriptionRevisionSchema); }
}

export class EvaluationRepository extends Phase4JsonRepository {
  private path(ownerId: string, submissionId: string, evaluationId: string) { return `owners/${ownerId}/submissions/${submissionId}/responses/evaluations/${evaluationId}.json`; }

  async create(input: Omit<EvaluationProposal, "schemaVersion" | "evaluationId" | "createdAt" | "updatedAt">) {
    const evaluation = evaluationProposalSchema.parse({ ...input, schemaVersion: 1, evaluationId: randomUUID(), createdAt: now(), updatedAt: now() });
    const stored = await this.writeStored(this.path(evaluation.ownerId, evaluation.submissionId, evaluation.evaluationId), evaluation, { ifNoneMatch: true });
    return { evaluation, etag: stored.etag };
  }

  async get(ownerId: string, submissionId: string, evaluationId: string) { return this.readStored(this.path(ownerId, submissionId, evaluationId), evaluationProposalSchema); }
  async list(ownerId: string, submissionId: string) { return this.listStored(`owners/${ownerId}/submissions/${submissionId}/responses/evaluations/`, evaluationProposalSchema); }
  async updateState(ownerId: string, submissionId: string, evaluationId: string, expectedEtag: string, state: EvaluationProposal["state"]) {
    const current = await this.get(ownerId, submissionId, evaluationId);
    if (!current) throw new AppError("NOT_FOUND", "Evaluación no encontrada.", 404);
    if (current.etag !== expectedEtag) throw new AppError("ETAG_CONFLICT", "La evaluación cambió en otro proceso.", 409);
    const updated = evaluationProposalSchema.parse({ ...current.value, state, updatedAt: now() });
    const stored = await this.writeStored(this.path(ownerId, submissionId, evaluationId), updated, { ifMatch: expectedEtag });
    return { evaluation: updated, etag: stored.etag };
  }
}

export class ResponseDecisionRepository extends Phase4JsonRepository {
  private path(ownerId: string, submissionId: string, decisionId: string) { return `owners/${ownerId}/submissions/${submissionId}/responses/decisions/${decisionId}.json`; }

  async create(input: Omit<ResponseDecision, "schemaVersion" | "decisionId" | "createdAt">) {
    const decision = responseDecisionSchema.parse({ ...input, schemaVersion: 1, decisionId: randomUUID(), createdAt: now() });
    const stored = await this.writeStored(this.path(decision.ownerId, decision.submissionId, decision.decisionId), decision, { ifNoneMatch: true });
    return { decision, etag: stored.etag };
  }

  async get(ownerId: string, submissionId: string, decisionId: string) { return this.readStored(this.path(ownerId, submissionId, decisionId), responseDecisionSchema); }
  async list(ownerId: string, submissionId: string) { return this.listStored(`owners/${ownerId}/submissions/${submissionId}/responses/decisions/`, responseDecisionSchema); }
}
