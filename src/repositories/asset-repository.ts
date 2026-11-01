import { randomUUID } from "node:crypto";
import { assetSchema, type Asset } from "../domain/schemas";
import { AppError } from "../lib/errors";
import type { BlobStore } from "./blob-store";

function manifestPath(ownerId: string, assetId: string) { return `owners/${ownerId}/assets/${assetId}/manifest.json`; }
function encode(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)); }
function decode<T>(body: Uint8Array) { return JSON.parse(new TextDecoder().decode(body)) as T; }

export type NewAsset = Omit<Asset, "assetId" | "schemaVersion" | "createdAt" | "updatedAt" | "etag"> & { assetId?: string };

export class AssetRepository {
  constructor(private readonly blobs: BlobStore) {}

  async create(input: NewAsset): Promise<Asset> {
    const now = new Date().toISOString();
    const asset = assetSchema.parse({ ...input, schemaVersion: 1, assetId: input.assetId ?? randomUUID(), createdAt: now, updatedAt: now });
    const path = manifestPath(asset.ownerId, asset.assetId);
    const existing = await this.blobs.get(path);
    if (existing) {
      const parsed = assetSchema.safeParse(decode<Asset>(existing.body));
      if (parsed.success && parsed.data.sha256 === asset.sha256 && parsed.data.blobPath === asset.blobPath) return { ...parsed.data, etag: existing.etag };
      throw new AppError("ASSET_ID_CONFLICT", "El assetId ya pertenece a otro objeto.", 409);
    }
    const stored = await this.blobs.put(path, encode(asset), "application/json", { ifNoneMatch: true });
    return { ...asset, etag: stored.etag };
  }

  async getWithMeta(ownerId: string, assetId: string) {
    const object = await this.blobs.get(manifestPath(ownerId, assetId));
    if (!object) return null;
    const parsed = assetSchema.safeParse(decode<Asset>(object.body));
    if (!parsed.success || parsed.data.ownerId !== ownerId || parsed.data.assetId !== assetId) throw new AppError("INVALID_ASSET", "El manifiesto del asset no es válido.", 500);
    return { asset: parsed.data, etag: object.etag };
  }

  async listByExam(ownerId: string, examId: string) {
    const paths = await this.blobs.list(`owners/${ownerId}/assets/`);
    const assets: Asset[] = [];
    for (const path of paths.filter((value) => value.endsWith("/manifest.json"))) {
      const object = await this.blobs.get(path);
      if (!object) continue;
      const parsed = assetSchema.safeParse(decode<Asset>(object.body));
      if (parsed.success && parsed.data.ownerId === ownerId && parsed.data.examId === examId && parsed.data.state !== "deleted") assets.push({ ...parsed.data, etag: object.etag });
    }
    return assets.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async updateState(ownerId: string, assetId: string, expectedEtag: string, state: Asset["state"], errorCode?: string) {
    const current = await this.getWithMeta(ownerId, assetId);
    if (!current) throw new AppError("NOT_FOUND", "Asset no encontrado.", 404);
    if (current.etag !== expectedEtag) throw new AppError("ETAG_CONFLICT", "El asset fue modificado por otro proceso.", 409, true);
    const updated = assetSchema.parse({ ...current.asset, state, errorCode, updatedAt: new Date().toISOString() });
    const stored = await this.blobs.put(manifestPath(ownerId, assetId), encode(updated), "application/json", { ifMatch: expectedEtag });
    return { ...updated, etag: stored.etag };
  }
}
