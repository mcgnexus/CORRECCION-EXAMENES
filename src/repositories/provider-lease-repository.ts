import { randomUUID } from "node:crypto";
import { providerLeaseSchema, type ProviderLease } from "../domain/phase5-schemas";
import { AppError } from "../lib/errors";
import type { BlobStore } from "./blob-store";

function pathFor(slotId: string) { return `control/provider-slots/${slotId}.json`; }
function encode(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)); }
function decode<T>(body: Uint8Array) { return JSON.parse(new TextDecoder().decode(body)) as T; }

export class ProviderLeaseRepository {
  constructor(private readonly blobs: BlobStore) {}

  async acquire(ownerId: string, jobId: string, taskId: string, slots: number, ttlMs = 5 * 60_000) {
    const now = Date.now();
    for (let index = 0; index < slots; index += 1) {
      const slotId = String(index);
      const path = pathFor(slotId);
      const current = await this.blobs.get(path);
      const lease = providerLeaseSchema.parse({ schemaVersion: 1, leaseId: randomUUID(), slotId, ownerId, jobId, taskId, expiresAt: new Date(now + ttlMs).toISOString(), createdAt: new Date(now).toISOString() });
      try {
        const stored = current && Date.parse(providerLeaseSchema.parse(decode<unknown>(current.body)).expiresAt) > now
          ? null
          : await this.blobs.put(path, encode(lease), "application/json", current ? { ifMatch: current.etag } : { ifNoneMatch: true });
        if (stored) return { lease, etag: stored.etag };
      } catch (error) {
        if (!(error instanceof AppError) || !["OBJECT_EXISTS", "ETAG_CONFLICT"].includes(error.code)) throw error;
      }
    }
    throw new AppError("PROVIDER_CONCURRENCY_LIMIT", "No hay un slot de proveedor disponible.", 429, true);
  }

  async release(lease: ProviderLease) {
    const path = pathFor(lease.slotId);
    const current = await this.blobs.get(path);
    if (!current) return;
    const parsed = providerLeaseSchema.safeParse(decode<unknown>(current.body));
    if (parsed.success && parsed.data.leaseId === lease.leaseId && parsed.data.jobId === lease.jobId) await this.blobs.delete(path);
  }
}
