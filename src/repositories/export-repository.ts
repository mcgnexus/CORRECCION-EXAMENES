import { createHash, randomUUID } from "node:crypto";
import { exportManifestSchema, type ExportFormat, type ExportManifest } from "../domain/phase5-schemas";
import type { Asset } from "../domain/schemas";
import { AppError } from "../lib/errors";
import type { BlobStore } from "./blob-store";

function manifestPath(ownerId: string, exportId: string) { return `owners/${ownerId}/assets/${exportId}/manifest.json`; }
function contentPath(ownerId: string, exportId: string) { return `owners/${ownerId}/exports/${exportId}/content`; }
function encode(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)); }
function decode<T>(body: Uint8Array) { return JSON.parse(new TextDecoder().decode(body)) as T; }

export type NewExportManifest = Pick<ExportManifest, "ownerId" | "examId" | "batchId" | "format" | "sizeBytes" | "mimeType" | "snapshotRefs" | "revisionRefs" | "expiresAt"> & {
  body: Uint8Array;
  exportId?: string;
  createdAt?: string;
};

export class ExportRepository {
  constructor(private readonly blobs: BlobStore) {}

  static contentPath(ownerId: string, exportId: string) { return contentPath(ownerId, exportId); }

  async create(input: NewExportManifest) {
    const exportId = input.exportId ?? randomUUID();
    const digest = createHash("sha256").update(input.body).digest("hex");
    const now = input.createdAt ?? new Date().toISOString();
    const manifest = exportManifestSchema.parse({
      schemaVersion: 1,
      exportId,
      assetId: exportId,
      ownerId: input.ownerId,
      examId: input.examId,
      batchId: input.batchId,
      kind: "derived",
      state: "available",
      origin: "export",
      sha256: digest,
      mimeType: input.mimeType,
      blobPath: contentPath(input.ownerId, exportId),
      sizeBytes: input.body.byteLength,
      format: input.format,
      sourceRefs: [...input.snapshotRefs, ...input.revisionRefs],
      metadata: { snapshotRefs: input.snapshotRefs, revisionRefs: input.revisionRefs },
      snapshotRefs: input.snapshotRefs,
      revisionRefs: input.revisionRefs,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    const content = await this.blobs.put(manifest.blobPath, input.body, input.mimeType, { ifNoneMatch: true });
    try {
      const stored = await this.blobs.put(manifestPath(manifest.ownerId, manifest.exportId), encode(manifest), "application/json", { ifNoneMatch: true });
      return { manifest: { ...manifest, etag: stored.etag }, etag: stored.etag, contentEtag: content.etag };
    } catch (error) {
      await this.blobs.delete(manifest.blobPath).catch(() => undefined);
      throw error;
    }
  }

  async getWithMeta(ownerId: string, exportId: string) {
    const object = await this.blobs.get(manifestPath(ownerId, exportId));
    if (!object) return null;
    const parsed = exportManifestSchema.safeParse(decode<unknown>(object.body));
    if (!parsed.success || parsed.data.ownerId !== ownerId || parsed.data.exportId !== exportId) throw new AppError("INVALID_EXPORT_MANIFEST", "El manifiesto de exportación no es válido.", 500);
    return { manifest: parsed.data, etag: object.etag };
  }

  async listByBatch(ownerId: string, batchId: string) {
    const values: Array<{ manifest: ExportManifest; etag: string }> = [];
    for (const path of await this.blobs.list(`owners/${ownerId}/assets/`)) {
      if (!path.endsWith("/manifest.json")) continue;
      const object = await this.blobs.get(path);
      if (!object) continue;
      const parsed = exportManifestSchema.safeParse(decode<unknown>(object.body));
      if (parsed.success && parsed.data.ownerId === ownerId && parsed.data.batchId === batchId) values.push({ manifest: parsed.data, etag: object.etag });
    }
    return values;
  }

  async listExpired(now = new Date()) {
    const values: Array<{ manifest: ExportManifest; etag: string }> = [];
    for (const path of await this.blobs.list("owners/")) {
      if (!path.includes("/assets/") || !path.endsWith("/manifest.json")) continue;
      const object = await this.blobs.get(path);
      if (!object) continue;
      const parsed = exportManifestSchema.safeParse(decode<unknown>(object.body));
      if (parsed.success && parsed.data.state === "available" && Date.parse(parsed.data.expiresAt) <= now.getTime()) values.push({ manifest: parsed.data, etag: object.etag });
    }
    return values;
  }

  async markDeleted(ownerId: string, exportId: string, expectedEtag: string) {
    const current = await this.getWithMeta(ownerId, exportId);
    if (!current) throw new AppError("NOT_FOUND", "Exportación no encontrada.", 404);
    if (current.etag !== expectedEtag) throw new AppError("ETAG_CONFLICT", "La exportación cambió en otro proceso.", 409, true);
    const updated = exportManifestSchema.parse({ ...current.manifest, state: "deleted", updatedAt: new Date().toISOString() });
    const stored = await this.blobs.put(manifestPath(ownerId, exportId), encode(updated), "application/json", { ifMatch: expectedEtag });
    return { manifest: updated, etag: stored.etag };
  }

  async deleteContent(manifest: Pick<ExportManifest, "ownerId" | "exportId" | "blobPath">) {
    await this.blobs.delete(manifest.blobPath);
  }
}

export type ExportAsset = Asset & Pick<ExportManifest, "exportId" | "batchId" | "snapshotRefs" | "revisionRefs" | "format" | "expiresAt">;
