import { randomUUID } from "node:crypto";
import { examSchema, type Exam } from "../domain/schemas";
import { transitionExam } from "../domain/exam-state";
import { AppError } from "../lib/errors";
import type { BlobStore } from "./blob-store";

function pathFor(ownerId: string, examId: string) { return `owners/${ownerId}/exams/${examId}/manifest.json`; }

function encode(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)); }
function decode<T>(body: Uint8Array) { return JSON.parse(new TextDecoder().decode(body)) as T; }

export class ExamRepository {
  constructor(private readonly blobs: BlobStore) {}

  async create(ownerId: string, input: { title: string; subject: string; modelIds?: string[] }): Promise<Exam> {
    const now = new Date().toISOString();
    const exam = examSchema.parse({
      schemaVersion: 1,
      examId: randomUUID(),
      ownerId,
      title: input.title,
      subject: input.subject,
      modelIds: input.modelIds ?? ["A"],
      state: "draft",
      createdAt: now,
      updatedAt: now,
    });
    const path = pathFor(ownerId, exam.examId);
    await this.blobs.put(path, encode(exam), "application/json", { ifNoneMatch: true });
    return exam;
  }

  async get(ownerId: string, examId: string): Promise<Exam | null> {
    const result = await this.getWithMeta(ownerId, examId);
    return result?.exam ?? null;
  }

  async getWithMeta(ownerId: string, examId: string): Promise<{ exam: Exam; etag: string } | null> {
    const object = await this.blobs.get(pathFor(ownerId, examId));
    if (!object) return null;
    const exam = examSchema.safeParse(decode<Exam>(object.body));
    if (!exam.success || exam.data.ownerId !== ownerId || exam.data.examId !== examId) {
      throw new AppError("INVALID_MANIFEST", "El manifiesto del examen no es válido.", 500);
    }
    return { exam: exam.data, etag: object.etag };
  }

  async list(ownerId: string) {
    const paths = await this.blobs.list(`owners/${ownerId}/exams/`);
    const exams: Exam[] = [];
    for (const path of paths.filter((value) => value.endsWith("/manifest.json"))) {
      const object = await this.blobs.get(path);
      if (!object) continue;
      const parsed = examSchema.safeParse(decode<Exam>(object.body));
      if (parsed.success && parsed.data.ownerId === ownerId) exams.push(parsed.data);
    }
    return exams.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async update(ownerId: string, examId: string, expectedEtag: string, patch: Partial<Pick<Exam, "title" | "subject" | "state" | "activeRevisionId">>) {
    const path = pathFor(ownerId, examId);
    const current = await this.blobs.get(path);
    if (!current) throw new AppError("NOT_FOUND", "Examen no encontrado.", 404);
    const existing = examSchema.parse(decode<Exam>(current.body));
    if (current.etag !== expectedEtag) throw new AppError("ETAG_CONFLICT", "El examen fue modificado por otro editor.", 409);
    if (patch.state && patch.state !== existing.state) transitionExam(existing.state, patch.state);
    const updated = examSchema.parse({ ...existing, ...patch, updatedAt: new Date().toISOString() });
    await this.blobs.put(path, encode(updated), "application/json", { ifMatch: expectedEtag });
    return updated;
  }
}
