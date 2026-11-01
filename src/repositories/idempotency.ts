import { createHash } from "node:crypto";
import { AppError } from "../lib/errors";
import type { BlobStore } from "./blob-store";

type RecordValue<T> = { schemaVersion: 1; status: "pending" | "completed" | "failed"; result?: T; errorCode?: string };

function pathFor(ownerId: string, operation: string, key: string) {
  const digest = createHash("sha256").update(`${operation}:${key}`).digest("hex");
  return `owners/${ownerId}/idempotency/${digest}.json`;
}

function encode(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)); }
function decode<T>(body: Uint8Array) { return JSON.parse(new TextDecoder().decode(body)) as T; }

export class IdempotencyRepository {
  constructor(private readonly blobs: BlobStore) {}

  async execute<T>(ownerId: string, operation: string, key: string, action: () => Promise<T>): Promise<{ result: T; replayed: boolean }> {
    const path = pathFor(ownerId, operation, key);
    const existing = await this.blobs.get(path);
    if (existing) {
      const record = decode<RecordValue<T>>(existing.body);
      if (record.status === "completed" && record.result !== undefined) return { result: record.result, replayed: true };
      if (record.status === "failed") throw new AppError(record.errorCode ?? "IDEMPOTENT_OPERATION_FAILED", "La operación anterior falló; usa una nueva clave tras revisar el resultado.", 409);
      throw new AppError("IDEMPOTENCY_IN_PROGRESS", "Ya existe una operación con esta clave.", 409, true);
    }

    const pending = await this.blobs.put(path, encode({ schemaVersion: 1, status: "pending" }), "application/json", { ifNoneMatch: true }).catch((error: unknown) => {
      if (error instanceof AppError && error.code === "OBJECT_EXISTS") throw new AppError("IDEMPOTENCY_IN_PROGRESS", "Ya existe una operación con esta clave.", 409, true);
      throw error;
    });
    let result: T;
    try {
      result = await action();
    } catch (error) {
      const errorCode = error instanceof AppError ? error.code : "IDEMPOTENT_OPERATION_FAILED";
      await this.blobs.put(path, encode({ schemaVersion: 1, status: "failed", errorCode }), "application/json", { ifMatch: pending.etag });
      throw error;
    }
    await this.blobs.put(path, encode({ schemaVersion: 1, status: "completed", result }), "application/json", { ifMatch: pending.etag });
    return { result, replayed: false };
  }
}
