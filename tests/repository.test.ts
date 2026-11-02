import { describe, expect, it } from "vitest";
import { MemoryBlobStore, toStrongEtag } from "../src/repositories/blob-store";
import { ExamRepository } from "../src/repositories/exam-repository";
import { transitionExam } from "../src/domain/exam-state";
import { ResponseRegionRepository, TranscriptionRepository } from "../src/repositories/phase4-repository";

describe("etags de Blob", () => {
  it("normaliza ETags débiles al formato fuerte que exige ifMatch", () => {
    expect(toStrongEtag('W/"abc"')).toBe('"abc"');
    expect(toStrongEtag('"abc"')).toBe('"abc"');
  });
});

describe("ExamRepository", () => {
  it("crea manifiestos inmutables y exige el ETag esperado para editar", async () => {
    const repository = new ExamRepository(new MemoryBlobStore());
    const exam = await repository.create("owner-1", { title: "Fisica", subject: "Mecanica" });
    const current = await repository.getWithMeta("owner-1", exam.examId);
    expect(current?.exam.title).toBe("Fisica");
    expect(current?.etag).toMatch(/^\"[a-f0-9]{64}\"$/);

    await expect(repository.update("owner-1", exam.examId, '"stale"', { title: "Otra" })).rejects.toMatchObject({ code: "ETAG_CONFLICT" });
    const updated = await repository.update("owner-1", exam.examId, current!.etag, { title: "Fisica avanzada" });
    expect(updated.title).toBe("Fisica avanzada");
  });

  it("solo permite avanzar por los estados del flujo", () => {
    expect(transitionExam("draft", "extracting")).toBe("extracting");
    expect(() => transitionExam("draft", "approved")).toThrow("Transición de examen no permitida");
    expect(() => transitionExam("approved", "draft")).toThrow("Transición de examen no permitida");
  });

  it("guarda regiones abiertas con puntero activo CAS y transcripciones append-only", async () => {
    const blobs = new MemoryBlobStore();
    const regions = new ResponseRegionRepository(blobs);
    const first = await regions.save({ submissionId: "submission-1", batchId: "batch-1", examId: "exam-1", ownerId: "owner-1", state: "ready", createdBy: "owner-1", regions: [{ regionId: "region-1", questionId: "open-1", questionType: "short_text", pageId: "page-1", sourceAssetId: "asset-1", cropAssetId: "crop-1", rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 }, order: 0 }] });
    await expect(regions.save({ submissionId: "submission-1", batchId: "batch-1", examId: "exam-1", ownerId: "owner-1", state: "ready", createdBy: "owner-1", regions: [{ regionId: "region-2", questionId: "open-1", questionType: "short_text", pageId: "page-1", sourceAssetId: "asset-1", cropAssetId: "crop-2", rect: { x: 0.2, y: 0.2, width: 0.5, height: 0.2 }, order: 1 }] }, '"stale"')).rejects.toMatchObject({ code: "ETAG_CONFLICT" });
    const transcription = new TranscriptionRepository(blobs);
    const created = await transcription.create({ regionRevisionId: first.revision.regionRevisionId, submissionId: "submission-1", batchId: "batch-1", examId: "exam-1", ownerId: "owner-1", questionId: "open-1", regionIds: ["region-1"], cropAssetIds: ["crop-1"], literalText: "respuesta", confidence: 0.9, uncertainSpans: [], flags: [], provider: "gemini", model: "fixture", state: "proposed" });
    expect((await transcription.list("owner-1", "submission-1"))).toHaveLength(1);
    expect(created.transcription.state).toBe("proposed");
  });
});
