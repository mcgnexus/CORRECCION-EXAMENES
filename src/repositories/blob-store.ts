import { createHash } from "node:crypto";
import { BlobAccessError, BlobContentTypeNotAllowedError, BlobError, BlobFileTooLargeError, BlobNotFoundError, BlobPreconditionFailedError, BlobServiceNotAvailable, BlobServiceRateLimited, del, get, list, put } from "@vercel/blob";
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

export function toStrongEtag(etag: string) {
  return etag.replace(/^W\//, "");
}

function mapBlobError(error: unknown, conditional?: "ifMatch" | "ifNoneMatch"): never {
  if (error instanceof AppError) throw error;
  if (error instanceof BlobPreconditionFailedError) {
    if (conditional === "ifNoneMatch") throw new AppError("OBJECT_EXISTS", "El objeto ya existe.", 409);
    throw new AppError("ETAG_CONFLICT", "El objeto ha cambiado.", 409, true);
  }
  if (error instanceof BlobNotFoundError) throw new AppError("NOT_FOUND", "El objeto no existe.", 404);
  if (error instanceof BlobServiceRateLimited) throw new AppError("BLOB_RATE_LIMITED", "El almacenamiento ha limitado la petición.", 503, true);
  if (error instanceof BlobServiceNotAvailable) throw new AppError("BLOB_UNAVAILABLE", "El almacenamiento no está disponible.", 503, true);
  if (error instanceof BlobAccessError) throw new AppError("BLOB_ACCESS_DENIED", "Sin acceso al almacenamiento privado.", 403);
  if (error instanceof BlobContentTypeNotAllowedError) throw new AppError("BLOB_CONTENT_TYPE_NOT_ALLOWED", "Tipo de contenido no permitido.", 400);
  if (error instanceof BlobFileTooLargeError) throw new AppError("BLOB_FILE_TOO_LARGE", "El objeto supera el tamaño permitido.", 413);
  if (error instanceof BlobError) throw new AppError("BLOB_ERROR", "El almacenamiento rechazó la operación.", 502, true);
  throw error;
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
  private readonly oidcToken = process.env.VERCEL_OIDC_TOKEN;
  private readonly storeId = process.env.BLOB_STORE_ID;

  private auth() {
    if (this.token) return { token: this.token };
    if (this.oidcToken && this.storeId) return { oidcToken: this.oidcToken, storeId: this.storeId };
    throw new AppError("BLOB_NOT_CONFIGURED", "No hay credenciales OIDC o token de Blob configurados.", 503);
  }

  async put(path: string, body: Uint8Array, contentType: string, options: { ifMatch?: string; ifNoneMatch?: boolean } = {}) {
    const ifMatch = options.ifMatch ? toStrongEtag(options.ifMatch) : undefined;
    try {
      const result = await put(path, Buffer.from(body), { ...this.auth(), access: "private", contentType, ...(ifMatch ? { ifMatch } : {}), allowOverwrite: Boolean(ifMatch) });
      return { path: result.pathname, body: new Uint8Array(body), contentType: result.contentType, etag: toStrongEtag(result.etag) };
    } catch (error) {
      mapBlobError(error, ifMatch ? "ifMatch" : options.ifNoneMatch ? "ifNoneMatch" : undefined);
    }
  }

  async get(path: string) {
    try {
      const result = await get(path, { ...this.auth(), access: "private", useCache: false });
      if (!result || result.statusCode !== 200) return null;
      const body = new Uint8Array(await new Response(result.stream).arrayBuffer());
      return { path: result.blob.pathname, body, contentType: result.blob.contentType, etag: toStrongEtag(result.blob.etag) };
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      mapBlobError(error);
    }
  }

  async list(prefix: string) {
    const paths: string[] = [];
    let cursor: string | undefined;
    try {
      do {
        const result = await list({ ...this.auth(), prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
        paths.push(...result.blobs.map((blob) => blob.pathname));
        cursor = result.hasMore ? result.cursor : undefined;
      } while (cursor);
      return paths;
    } catch (error) {
      mapBlobError(error);
    }
  }

  async delete(path: string) {
    try {
      await del(path, this.auth());
    } catch (error) {
      if (error instanceof BlobNotFoundError) return;
      mapBlobError(error);
    }
  }
}

let store: BlobStore | undefined;

export function getBlobStore(): BlobStore {
  if (!store) {
    store = process.env.BLOB_STORAGE_MODE === "memory"
      ? new MemoryBlobStore()
      : process.env.BLOB_READ_WRITE_TOKEN || (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID)
        ? new VercelPrivateBlobStore()
        : new UnavailablePrivateBlobStore();
  }
  return store;
}
