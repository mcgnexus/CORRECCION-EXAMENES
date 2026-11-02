import { randomUUID } from "node:crypto";
import { answerKeyRevisionSchema, examRevisionSchema, providerRunSchema, solutionProposalSchema, structureProposalSchema, type AnswerKeyRevision, type ExamRevision, type ProviderRun, type SolutionProposal, type StructureProposal } from "../domain/phase2-schemas";
import { AppError } from "../lib/errors";
import type { BlobStore } from "./blob-store";

function encode(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)); }
function decode<T>(body: Uint8Array) { return JSON.parse(new TextDecoder().decode(body)) as T; }
function now() { return new Date().toISOString(); }

class JsonAggregateRepository {
  constructor(protected readonly blobs: BlobStore) {}

  protected async read<T>(path: string, schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }) {
    const object = await this.blobs.get(path);
    if (!object) return null;
    const parsed = schema.safeParse(decode<unknown>(object.body));
    if (!parsed.success || !parsed.data) throw new AppError("INVALID_PHASE2_MANIFEST", "El manifiesto de Fase 2 no es válido.", 500);
    return { value: parsed.data, etag: object.etag };
  }

  protected async write<T>(path: string, value: T, contentType = "application/json", ifMatch?: string) {
    return this.blobs.put(path, encode(value), contentType, ifMatch ? { ifMatch } : { ifNoneMatch: true });
  }
}

export class ExamRevisionRepository extends JsonAggregateRepository {
  private path(ownerId: string, examId: string, revisionId: string) { return `owners/${ownerId}/exams/${examId}/revisions/${revisionId}/manifest.json`; }

  async create(ownerId: string, examId: string, pagesManifestEtag: string, sourcePageIds: string[]) {
    const revision = examRevisionSchema.parse({ schemaVersion: 1, examRevisionId: randomUUID(), examId, ownerId, pagesManifestEtag, sourcePageIds, status: "extracting", language: "es", proposals: [], blockingIssues: [], createdAt: now(), updatedAt: now() });
    const stored = await this.write(this.path(ownerId, examId, revision.examRevisionId), revision);
    return { revision, etag: stored.etag };
  }

  async get(ownerId: string, examId: string, revisionId: string) { return this.read<ExamRevision>(this.path(ownerId, examId, revisionId), examRevisionSchema); }

  async update(ownerId: string, examId: string, revisionId: string, expectedEtag: string, patch: Partial<Pick<ExamRevision, "status" | "proposals" | "activeStructureProposalId" | "answerKeyRevisionId" | "blockingIssues">>) {
    const current = await this.get(ownerId, examId, revisionId);
    if (!current) throw new AppError("NOT_FOUND", "Revisión de examen no encontrada.", 404);
    if (current.etag !== expectedEtag) throw new AppError("ETAG_CONFLICT", "La revisión fue modificada por otro proceso.", 409);
    const revision = examRevisionSchema.parse({ ...current.value, ...patch, updatedAt: now() });
    const stored = await this.write(this.path(ownerId, examId, revisionId), revision, "application/json", expectedEtag);
    return { revision, etag: stored.etag };
  }
}

export class StructureProposalRepository extends JsonAggregateRepository {
  private path(ownerId: string, examId: string, proposalId: string) { return `owners/${ownerId}/exams/${examId}/phase2/structure/${proposalId}.json`; }
  async create(ownerId: string, examId: string, proposal: StructureProposal) { const stored = await this.write(this.path(ownerId, examId, proposal.proposalId), proposal); return { proposal, etag: stored.etag }; }
  async get(ownerId: string, examId: string, proposalId: string) { return this.read<StructureProposal>(this.path(ownerId, examId, proposalId), structureProposalSchema); }
}

export class SolutionProposalRepository extends JsonAggregateRepository {
  private path(ownerId: string, examRevisionId: string, proposalId: string) { return `owners/${ownerId}/revisions/${examRevisionId}/phase2/solutions/${proposalId}.json`; }
  async create(ownerId: string, proposal: SolutionProposal) { const stored = await this.write(this.path(ownerId, proposal.examRevisionId, proposal.solutionProposalId), proposal); return { proposal, etag: stored.etag }; }
  async get(ownerId: string, examRevisionId: string, proposalId: string) { return this.read<SolutionProposal>(this.path(ownerId, examRevisionId, proposalId), solutionProposalSchema); }
  async list(ownerId: string, examRevisionId: string) {
    const proposals: Array<{ value: SolutionProposal; etag: string }> = [];
    for (const path of await this.blobs.list(`owners/${ownerId}/revisions/${examRevisionId}/phase2/solutions/`)) {
      const item = await this.read<SolutionProposal>(path, solutionProposalSchema);
      if (item) proposals.push(item);
    }
    return proposals;
  }
}

export class AnswerKeyRepository extends JsonAggregateRepository {
  private path(ownerId: string, examId: string, revisionId: string) { return `owners/${ownerId}/exams/${examId}/answer-keys/${revisionId}/manifest.json`; }
  async create(ownerId: string, examId: string, examRevisionId: string) {
    const answerKey = answerKeyRevisionSchema.parse({ schemaVersion: 1, answerKeyRevisionId: randomUUID(), examRevisionId, examId, ownerId, status: "draft", scoringPolicyRevisionId: "policy-default", decisions: {}, blockingIssues: [], createdAt: now(), updatedAt: now() });
    const stored = await this.write(this.path(ownerId, examId, answerKey.answerKeyRevisionId), answerKey);
    return { answerKey, etag: stored.etag };
  }
  async get(ownerId: string, examId: string, revisionId: string) { return this.read<AnswerKeyRevision>(this.path(ownerId, examId, revisionId), answerKeyRevisionSchema); }
  async update(ownerId: string, examId: string, revisionId: string, expectedEtag: string, patch: Partial<Pick<AnswerKeyRevision, "status" | "decisions" | "blockingIssues" | "approvedBy" | "approvedAt">>) {
    const current = await this.get(ownerId, examId, revisionId);
    if (!current) throw new AppError("NOT_FOUND", "Answer key no encontrado.", 404);
    if (current.etag !== expectedEtag) throw new AppError("ETAG_CONFLICT", "El answer key fue modificado por otro proceso.", 409);
    const answerKey = answerKeyRevisionSchema.parse({ ...current.value, ...patch, updatedAt: now() });
    const stored = await this.write(this.path(ownerId, examId, current.value.answerKeyRevisionId), answerKey, "application/json", expectedEtag);
    return { answerKey, etag: stored.etag };
  }
}

export class ProviderRunRepository extends JsonAggregateRepository {
  private path(ownerId: string, runId: string) { return `owners/${ownerId}/phase2/provider-runs/${runId}.json`; }
  async create(input: Omit<ProviderRun, "schemaVersion" | "providerRunId" | "createdAt" | "updatedAt">) {
    const run = providerRunSchema.parse({ ...input, schemaVersion: 1, providerRunId: randomUUID(), createdAt: now(), updatedAt: now() });
    const stored = await this.write(this.path(run.ownerId, run.providerRunId), run);
    return { run, etag: stored.etag };
  }
}
