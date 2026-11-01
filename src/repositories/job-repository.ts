import { randomUUID } from "node:crypto";
import { jobSchema, type Job } from "../domain/schemas";
import { AppError } from "../lib/errors";
import type { BlobStore } from "./blob-store";

function pathFor(ownerId: string, jobId: string) { return `owners/${ownerId}/jobs/${jobId}/manifest.json`; }
function encode(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)); }
function decode<T>(body: Uint8Array) { return JSON.parse(new TextDecoder().decode(body)) as T; }

export class JobRepository {
  constructor(private readonly blobs: BlobStore) {}

  async create(ownerId: string, input: Pick<Job, "kind" | "step" | "idempotencyKey">) {
    const now = new Date().toISOString();
    const job = jobSchema.parse({ schemaVersion: 1, jobId: randomUUID(), ownerId, kind: input.kind, status: "queued", step: input.step, attempt: 0, idempotencyKey: input.idempotencyKey, retryable: false, outputRefs: [], createdAt: now, updatedAt: now });
    await this.blobs.put(pathFor(ownerId, job.jobId), encode(job), "application/json", { ifNoneMatch: true });
    return job;
  }

  async getWithMeta(ownerId: string, jobId: string) {
    const object = await this.blobs.get(pathFor(ownerId, jobId));
    if (!object) return null;
    const parsed = jobSchema.safeParse(decode<Job>(object.body));
    if (!parsed.success || parsed.data.ownerId !== ownerId || parsed.data.jobId !== jobId) throw new AppError("INVALID_JOB", "El trabajo no es válido.", 500);
    return { job: parsed.data, etag: object.etag };
  }

  async update(ownerId: string, jobId: string, expectedEtag: string, patch: Partial<Pick<Job, "status" | "step" | "attempt" | "errorCode" | "retryable" | "outputRefs">>) {
    const current = await this.getWithMeta(ownerId, jobId);
    if (!current) throw new AppError("NOT_FOUND", "Trabajo no encontrado.", 404);
    if (current.etag !== expectedEtag) throw new AppError("ETAG_CONFLICT", "El trabajo fue modificado por otro worker.", 409, true);
    const updated = jobSchema.parse({ ...current.job, ...patch, updatedAt: new Date().toISOString() });
    await this.blobs.put(pathFor(ownerId, jobId), encode(updated), "application/json", { ifMatch: expectedEtag });
    return updated;
  }
}
