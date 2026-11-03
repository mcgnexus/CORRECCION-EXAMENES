import { createHash } from "node:crypto";
import { AppError } from "@/lib/errors";
import { getSupabaseAdmin, getSupabaseStorageBucket } from "@/lib/supabase-admin";
import type { BlobStore, StoredObject } from "./blob-store";

type ObjectRow = { body_base64: string | null; content_type: string; etag: string; is_binary: boolean };

function etagFor(body: Uint8Array) {
  return `"${createHash("sha256").update(body).digest("hex")}"`;
}

function mapError(error: { message?: string; statusCode?: string | number } | null, fallback: string): never {
  const message = error?.message ?? fallback;
  if (message.includes("OBJECT_EXISTS")) throw new AppError("OBJECT_EXISTS", "El objeto ya existe.", 409);
  if (message.includes("ETAG_CONFLICT")) throw new AppError("ETAG_CONFLICT", "El objeto ha cambiado.", 409, true);
  if (message.includes("NOT_FOUND")) throw new AppError("NOT_FOUND", "El objeto no existe.", 404);
  const status = Number(error?.statusCode);
  if (status === 409 || /already exists|duplicate/i.test(message)) throw new AppError("OBJECT_EXISTS", "El objeto ya existe.", 409);
  if (status === 401 || status === 403) throw new AppError("SUPABASE_ACCESS_DENIED", "Supabase no autorizó la operación.", 403);
  if (status === 404) throw new AppError("NOT_FOUND", "El objeto no existe.", 404);
  throw new AppError("SUPABASE_STORAGE_ERROR", "Supabase Storage rechazó la operación.", 502, true);
}

export class SupabaseBlobStore implements BlobStore {
  private readonly client = getSupabaseAdmin();
  private readonly bucket = getSupabaseStorageBucket();

  private async getRow(path: string) {
    const { data, error } = await this.client.rpc("app_object_get", { p_path: path });
    if (error) mapError(error, "No se pudo consultar el índice de objetos.");
    return (Array.isArray(data) ? data[0] : data) as ObjectRow | undefined;
  }

  async put(path: string, body: Uint8Array, contentType: string, options: { ifMatch?: string; ifNoneMatch?: boolean } = {}) {
    if (contentType === "application/json") {
      const { data, error } = await this.client.rpc("app_object_put_json", {
        p_path: path,
        p_body_base64: Buffer.from(body).toString("base64"),
        p_content_type: contentType,
        p_if_match: options.ifMatch ?? null,
        p_if_none_match: options.ifNoneMatch ?? false,
      });
      if (error) mapError(error, "No se pudo guardar el objeto JSON.");
      const row = (Array.isArray(data) ? data[0] : data) as { etag?: string } | undefined;
      if (!row?.etag) throw new AppError("SUPABASE_STORAGE_ERROR", "Supabase no devolvió el ETag del objeto.", 502, true);
      return { path, body: new Uint8Array(body), contentType, etag: row.etag };
    }

    if (options.ifMatch) throw new AppError("UNSUPPORTED_CONDITIONAL_WRITE", "No se admite actualizar un binario con ETag; los binarios deben ser inmutables.", 501);
    if (!options.ifNoneMatch) throw new AppError("BINARY_IMMUTABLE", "Los archivos binarios deben crearse una sola vez con ifNoneMatch.", 409);
    const { error } = await this.client.storage.from(this.bucket).upload(path, Buffer.from(body), {
      contentType,
      upsert: false,
    });
    if (error) mapError(error, "No se pudo subir el archivo.");
    const etag = etagFor(body);
    const registered = await this.client.rpc("app_object_register_binary", { p_path: path, p_content_type: contentType, p_etag: etag });
    if (registered.error) {
      await this.client.storage.from(this.bucket).remove([path]);
      mapError(registered.error, "No se pudo registrar el archivo.");
    }
    return { path, body: new Uint8Array(body), contentType, etag };
  }

  async registerExternal(path: string, contentType: string) {
    const current = await this.getRow(path);
    if (current) return { path, contentType: current.content_type, etag: current.etag };
    const { data, error } = await this.client.storage.from(this.bucket).download(path);
    if (error || !data) mapError(error, "No se pudo verificar el archivo subido.");
    const body = new Uint8Array(await data.arrayBuffer());
    const etag = etagFor(body);
    const result = await this.client.rpc("app_object_register_binary", { p_path: path, p_content_type: contentType, p_etag: etag });
    if (result.error) mapError(result.error, "No se pudo registrar el archivo subido.");
    return { path, contentType, etag };
  }

  async createSignedUploadUrl(path: string) {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUploadUrl(path, { upsert: false });
    if (error) mapError(error, "No se pudo autorizar la subida.");
    return { bucket: this.bucket, path: data.path, token: data.token };
  }

  async get(path: string): Promise<StoredObject | null> {
    const row = await this.getRow(path);
    if (!row) return null;
    if (!row.is_binary) {
      if (row.body_base64 === null) throw new AppError("INVALID_MANIFEST", "El objeto JSON no tiene contenido.", 500);
      return { path, body: new Uint8Array(Buffer.from(row.body_base64, "base64")), contentType: row.content_type, etag: row.etag };
    }
    const { data, error } = await this.client.storage.from(this.bucket).download(path);
    if (error || !data) mapError(error, "No se pudo descargar el archivo.");
    return { path, body: new Uint8Array(await data.arrayBuffer()), contentType: row.content_type, etag: row.etag };
  }

  async list(prefix: string) {
    const { data, error } = await this.client.rpc("app_object_list", { p_prefix: prefix });
    if (error) mapError(error, "No se pudo listar los objetos.");
    return (data as Array<{ path: string }>).map((row) => row.path);
  }

  async delete(path: string) {
    const row = await this.getRow(path);
    if (!row) return;
    if (row.is_binary) {
      const { error } = await this.client.storage.from(this.bucket).remove([path]);
      if (error) mapError(error, "No se pudo borrar el archivo.");
    }
    const { error } = await this.client.rpc("app_object_delete", { p_path: path });
    if (error) mapError(error, "No se pudo borrar el registro del objeto.");
  }
}
