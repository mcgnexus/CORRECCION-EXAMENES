import { describe, expect, it } from "vitest";
import { MemoryBlobStore } from "../src/repositories/blob-store";
import { AuditRepository } from "../src/repositories/audit-repository";
import { JobRepository } from "../src/repositories/job-repository";

describe("trabajos y auditoría", () => {
  it("persiste un trabajo y protege su actualización con CAS", async () => {
    const repository = new JobRepository(new MemoryBlobStore());
    const job = await repository.create("owner-1", { kind: "extract", step: "prepare", idempotencyKey: "job-key" });
    const current = await repository.getWithMeta("owner-1", job.jobId);
    const updated = await repository.update("owner-1", job.jobId, current!.etag, { status: "running", attempt: 1 });
    expect(updated.status).toBe("running");
    await expect(repository.update("owner-1", job.jobId, current!.etag, { status: "failed" })).rejects.toMatchObject({ code: "ETAG_CONFLICT" });
  });

  it("escribe eventos separados e inmutables", async () => {
    const repository = new AuditRepository(new MemoryBlobStore());
    const event = await repository.append({ ownerId: "owner-1", actorId: "owner-1", type: "exam.created", aggregateType: "exam", aggregateId: "exam-1", payload: {} });
    expect(event.eventId).toBeTruthy();
    expect(event.schemaVersion).toBe(1);
  });
});
