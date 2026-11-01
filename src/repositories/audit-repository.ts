import { randomUUID } from "node:crypto";
import { auditEventSchema, type AuditEvent } from "../domain/schemas";
import type { BlobStore } from "./blob-store";

function pathFor(ownerId: string, eventId: string) { return `owners/${ownerId}/events/${eventId}.json`; }
function encode(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)); }

export class AuditRepository {
  constructor(private readonly blobs: BlobStore) {}

  async append(input: Omit<AuditEvent, "schemaVersion" | "eventId" | "occurredAt">) {
    const event = auditEventSchema.parse({ ...input, schemaVersion: 1, eventId: randomUUID(), occurredAt: new Date().toISOString() });
    await this.blobs.put(pathFor(event.ownerId, event.eventId), encode(event), "application/json", { ifNoneMatch: true });
    return event;
  }
}
