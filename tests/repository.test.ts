import { describe, expect, it } from "vitest";
import { MemoryBlobStore } from "../src/repositories/blob-store";
import { ExamRepository } from "../src/repositories/exam-repository";
import { transitionExam } from "../src/domain/exam-state";

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
});
