import { randomUUID } from "node:crypto";
import { jobSchema, type Job } from "../domain/schemas";
import { AppError } from "../lib/errors";
import type { BlobStore } from "./blob-store";

function pathFor(ownerId: string, jobId: string) { return `owners/${ownerId}/jobs/${jobId}/manifest.json`; }
function encode(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)); }
function decode<T>(body: Uint8Array) { return JSON.parse(new TextDecoder().decode(body)) as T; }
type NewBatchRequest = Omit<NonNullable<Job["batchRequest"]>, "maxAttempts"> & { maxAttempts?: number };

export class JobRepository {
  constructor(private readonly blobs: BlobStore) {}

  async create(ownerId: string, input: Pick<Job, "kind" | "step" | "idempotencyKey"> & { exportRequest?: Job["exportRequest"]; batchRequest?: NewBatchRequest }) {
    const now = new Date().toISOString();
    const job = jobSchema.parse({ schemaVersion: 1, jobId: randomUUID(), ownerId, kind: input.kind, status: "queued", step: input.step, phase: "queued", attempt: 0, idempotencyKey: input.idempotencyKey, retryable: false, outputRefs: [], exportRequest: input.exportRequest, batchRequest: input.batchRequest, createdAt: now, updatedAt: now });
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

  async list(ownerId: string) {
    const jobs: Array<{ job: Job; etag: string }> = [];
    for (const path of await this.blobs.list(`owners/${ownerId}/jobs/`)) {
      if (!path.endsWith("/manifest.json")) continue;
      const object = await this.blobs.get(path);
      if (!object) continue;
      const parsed = jobSchema.safeParse(decode<unknown>(object.body));
      if (parsed.success && parsed.data.ownerId === ownerId) jobs.push({ job: parsed.data, etag: object.etag });
    }
    return jobs;
  }

  async findActiveBatch(ownerId: string, batchId: string) {
    const jobs = await this.list(ownerId);
    return jobs.find(({ job }) => job.kind === "batch" && job.batchRequest?.batchId === batchId && ["queued", "running", "cancel_requested"].includes(job.status)) ?? null;
  }

  async update(ownerId: string, jobId: string, expectedEtag: string, patch: Partial<Pick<Job, "status" | "step" | "phase" | "attempt" | "errorCode" | "retryable" | "outputRefs" | "progress" | "cancelRequestedAt" | "cost">>) {
    const result = await this.updateWithMeta(ownerId, jobId, expectedEtag, patch);
    return result.job;
  }

  async updateWithMeta(ownerId: string, jobId: string, expectedEtag: string, patch: Partial<Pick<Job, "status" | "step" | "phase" | "attempt" | "errorCode" | "retryable" | "outputRefs" | "progress" | "cancelRequestedAt" | "cost">>) {
    const current = await this.getWithMeta(ownerId, jobId);
    if (!current) throw new AppError("NOT_FOUND", "Trabajo no encontrado.", 404);
    if (current.etag !== expectedEtag) throw new AppError("ETAG_CONFLICT", "El trabajo fue modificado por otro worker.", 409, true);
    if (["completed", "cancelled"].includes(current.job.status)) throw new AppError("JOB_TERMINAL", "El trabajo ya está terminado.", 409);
    if (current.job.status === "failed" && patch.status !== "queued" && patch.status !== undefined) throw new AppError("INVALID_JOB_TRANSITION", "Un trabajo fallido solo puede reintentarse.", 409);
    const updated = jobSchema.parse({ ...current.job, ...patch, updatedAt: new Date().toISOString() });
    const stored = await this.blobs.put(pathFor(ownerId, jobId), encode(updated), "application/json", { ifMatch: expectedEtag });
    return { job: updated, etag: stored.etag };
  }
}
