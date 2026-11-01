import { createHash } from "node:crypto";
import { del, get, list, put } from "@vercel/blob";
import { AppError } from "../lib/errors";

export type StoredObject = { path: string; body: Uint8Array; contentType: string; etag: string };

export interface BlobStore {
  put(path: string, body: Uint8Array, contentType: string, options?: { ifMatch?: string; ifNoneMatch?: boolean }): Promise<StoredObject>;
  get(path: string): Promise<StoredObject | null>;
  list(prefix: string): Promise<string[]>;
  delete(path: string): Promise<void>;
}

function etagFor(body: Uint8Array) {
  return `"${createHash("sha256").update(body).digest("hex")}"`;
}

export class MemoryBlobStore implements BlobStore {
  private readonly objects = new Map<string, StoredObject>();

  async put(path: string, body: Uint8Array, contentType: string, options: { ifMatch?: string; ifNoneMatch?: boolean } = {}) {
    const current = this.objects.get(path);
    if (options.ifNoneMatch && current) throw new AppError("OBJECT_EXISTS", "El objeto ya existe.", 409);
    if (options.ifMatch && current?.etag !== options.ifMatch) throw new AppError("ETAG_CONFLICT", "El objeto ha cambiado.", 409);
    if (options.ifMatch && !current) throw new AppError("ETAG_CONFLICT", "El objeto ya no existe.", 409);
    const value = { path, body: new Uint8Array(body), contentType, etag: etagFor(body) };
    this.objects.set(path, value);
    return value;
  }

  async get(path: string) { return this.objects.get(path) ?? null; }
  async list(prefix: string) { return [...this.objects.keys()].filter((path) => path.startsWith(prefix)).sort(); }
  async delete(path: string) { this.objects.delete(path); }
}

export class UnavailablePrivateBlobStore implements BlobStore {
  private unavailable(): never {
    throw new AppError("PRIVATE_BLOB_NOT_VERIFIED", "El almacenamiento Blob privado no está verificado para el SDK instalado.", 503, true);
  }
  async put() { return this.unavailable(); }
  async get() { return this.unavailable(); }
  async list() { return this.unavailable(); }
  async delete() { return this.unavailable(); }
}

export class VercelPrivateBlobStore implements BlobStore {
  private readonly token = process.env.BLOB_READ_WRITE_TOKEN;

  private auth() {
    if (!this.token) throw new AppError("BLOB_NOT_CONFIGURED", "BLOB_READ_WRITE_TOKEN no está configurado.", 503);
    return { token: this.token };
  }

  async put(path: string, body: Uint8Array, contentType: string, options: { ifMatch?: string; ifNoneMatch?: boolean } = {}) {
    const result = await put(path, Buffer.from(body), { ...this.auth(), access: "private", contentType, ...(options.ifMatch ? { ifMatch: options.ifMatch } : {}), allowOverwrite: Boolean(options.ifMatch) });
    return { path: result.pathname, body: new Uint8Array(body), contentType: result.contentType, etag: result.etag };
  }

  async get(path: string) {
    const result = await get(path, { ...this.auth(), access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return null;
    const body = new Uint8Array(await new Response(result.stream).arrayBuffer());
    return { path: result.blob.pathname, body, contentType: result.blob.contentType, etag: result.blob.etag };
  }

  async list(prefix: string) {
    const paths: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await list({ ...this.auth(), prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
      paths.push(...result.blobs.map((blob) => blob.pathname));
      cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);
    return paths;
  }

  async delete(path: string) {
    await del(path, this.auth());
  }
}

let store: BlobStore | undefined;

export function getBlobStore(): BlobStore {
  if (!store) {
    store = process.env.BLOB_STORAGE_MODE === "memory"
      ? new MemoryBlobStore()
      : process.env.BLOB_READ_WRITE_TOKEN
        ? new VercelPrivateBlobStore()
        : new UnavailablePrivateBlobStore();
  }
  return store;
}
