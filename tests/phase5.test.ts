import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { assetSchema, jobSchema } from "../src/domain/schemas";
import { generateCsv, generatePdf, generateXlsx } from "../src/lib/export-generation";
import { ExportRepository } from "../src/repositories/export-repository";
import { MemoryBlobStore } from "../src/repositories/blob-store";
import { ProviderLeaseRepository } from "../src/repositories/provider-lease-repository";
import { JobRepository } from "../src/repositories/job-repository";
import { OmrReadingRepository } from "../src/repositories/phase3-repository";

describe("Fase 5 exportaciones", () => {
  it("mantiene compatibilidad con manifests antiguos", () => {
    const job = jobSchema.parse({ schemaVersion: 1, jobId: "job-1", ownerId: "owner-1", kind: "solve", status: "queued", step: "start", attempt: 0, idempotencyKey: "key", retryable: false, outputRefs: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    expect(job.progress.percent).toBe(0);
    const asset = assetSchema.parse({ schemaVersion: 1, assetId: "asset-1", ownerId: "owner-1", kind: "original", state: "validated", origin: "upload", sha256: "a".repeat(64), mimeType: "image/png", blobPath: "owners/owner-1/exams/exam-1/assets/asset-1/original", sizeBytes: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    expect(asset.metadata).toEqual({});
    const batchJob = jobSchema.parse({ schemaVersion: 1, jobId: "job-batch", ownerId: "owner-1", kind: "batch", status: "queued", step: "queued", attempt: 0, idempotencyKey: "batch-key", retryable: false, batchRequest: { examId: "exam-1", batchId: "batch-1", answerKeyRevisionId: "key-1", templateRevisionId: "template-1", scoringPolicyRevisionId: "policy-1", concurrency: 2 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    expect(batchJob.batchRequest?.concurrency).toBe(2);
  });

  it("neutraliza fórmulas y conserva números en CSV/XLSX", async () => {
    const row = { submissionId: "s1", identity: "=2+2", createdAt: "2026-01-01T00:00:00.000Z", closedAt: "2026-01-01T00:00:00.000Z", score: 8.5, rawPoints: 10, correct: 4, blank: 1, incorrect: 0, pending: 0, openPoints: 2, openMaximumPoints: 3, sectionPoints: "[{\"sectionId\":\"open\"}]", snapshotId: "snap-1", responseRegionRevisionId: "", transcriptionRevisionIds: "[]", evaluationIds: "[]", decisionIds: "[]", incidents: "[]" } as const;
    const csv = new TextDecoder().decode(generateCsv([row]));
    expect(csv).toContain("'=2+2");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await generateXlsx([row], { batchId: "batch-1" }) as never);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["results", "metadata"]);
    expect(workbook.getWorksheet("results")?.getCell("E2").value).toBe(8.5);
    expect(workbook.getWorksheet("results")?.getCell("B2").value).toBe("'=2+2");
  });

  it("crea outputs privados y los marca borrados mediante CAS", async () => {
    const blobs = new MemoryBlobStore();
    const repository = new ExportRepository(blobs);
    const created = await repository.create({ ownerId: "owner-1", examId: "exam-1", batchId: "batch-1", format: "csv", body: new TextEncoder().encode("a,b\n1,2\n"), mimeType: "text/csv", sizeBytes: 8, snapshotRefs: ["snap-1"], revisionRefs: ["key-1"], expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(created.manifest.blobPath).toContain("owners/owner-1/exports/");
    const current = await repository.getWithMeta("owner-1", created.manifest.exportId);
    expect(current).not.toBeNull();
    await repository.markDeleted("owner-1", created.manifest.exportId, current!.etag);
    expect((await repository.getWithMeta("owner-1", created.manifest.exportId))?.manifest.state).toBe("deleted");
    await repository.deleteManifest(created.manifest);
    expect(await repository.getWithMeta("owner-1", created.manifest.exportId)).toBeNull();
  });

  it("genera PDF definitivo sin incluir raw provider output", async () => {
    const pdf = await generatePdf({ identity: "Alumno 1", submissionId: "s1", score: 9, rawPoints: 10, correct: 4, blank: 0, incorrect: 0, pending: 0, openPoints: 3, openMaximumPoints: 4, snapshotId: "snap-1", exportedAt: "2026-01-01T00:00:00.000Z", sections: [{ sectionId: "open", points: 3, maximumPoints: 4 }], questions: [{ questionId: "q1", transcription: "respuesta corregida", decision: "manual", points: 3, maximumPoints: 4, criteria: "c1:3/4" }], incidents: [] });
    expect(pdf.slice(0, 5)).toEqual(new Uint8Array([37, 80, 68, 70, 45]));
    expect(new TextDecoder().decode(pdf)).not.toContain("rawOutput");
  });

  it("reserva slots de proveedor con expiración y liberación durable", async () => {
    const blobs = new MemoryBlobStore();
    const repository = new ProviderLeaseRepository(blobs);
    const first = await repository.acquire("owner-1", "job-1", "task-1", 1, 60_000);
    await expect(repository.acquire("owner-2", "job-2", "task-2", 1, 60_000)).rejects.toMatchObject({ code: "PROVIDER_CONCURRENCY_LIMIT" });
    await repository.release(first.lease);
    const second = await repository.acquire("owner-2", "job-2", "task-2", 1, 60_000);
    expect(second.lease.slotId).toBe("0");
  });

  it("reanuda una lectura existente sin duplicar manifiestos y conserva el job activo", async () => {
    const blobs = new MemoryBlobStore();
    const readings = new OmrReadingRepository(blobs);
    const created = await readings.create({ submissionId: "submission-1", batchId: "batch-1", examId: "exam-1", ownerId: "owner-1", pageId: "page-1", assetId: "asset-1", templateRevisionId: "template-1", algorithmVersion: "omr-v1", inputHash: "a".repeat(64), alignment: {}, rows: [], status: "completed" });
    expect((await readings.findByInput("owner-1", [created.reading.readingId], "asset-1", "template-1", "a".repeat(64)))?.value.readingId).toBe(created.reading.readingId);
    const jobs = new JobRepository(blobs);
    const job = await jobs.create("owner-1", { kind: "batch", step: "queued", idempotencyKey: "batch-idempotency", batchRequest: { examId: "exam-1", batchId: "batch-1", answerKeyRevisionId: "key-1", templateRevisionId: "template-1", scoringPolicyRevisionId: "policy-1", concurrency: 2, maxAttempts: 3 } });
    expect((await jobs.findActiveBatch("owner-1", "batch-1"))?.job.jobId).toBe(job.jobId);
  });
});
