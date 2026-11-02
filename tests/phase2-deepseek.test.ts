import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryBlobStore } from "../src/repositories/blob-store";
import { ExamRepository } from "../src/repositories/exam-repository";
import { AnswerKeyRepository, ExamRevisionRepository, ProviderRunRepository, SolutionProposalRepository, StructureProposalRepository } from "../src/repositories/phase2-repository";
import { ProviderError } from "../src/providers/contracts";
import { providerNameSchema, structureProposalSchema } from "../src/domain/phase2-schemas";

const mocks = vi.hoisted(() => ({
  deepseek: vi.fn(), gemini: vi.fn(), capabilities: vi.fn(), pdf: vi.fn(), blobs: vi.fn(),
  exams: vi.fn(), revisions: vi.fn(), structures: vi.fn(), solutions: vi.fn(), runs: vi.fn(), keys: vi.fn(),
  assets: vi.fn(), pages: vi.fn(),
}));

vi.mock("@/providers/deepseek", () => ({ reviewWithDeepSeekJson: mocks.deepseek, deepseekCapabilities: mocks.capabilities }));
vi.mock("@/providers/gemini", () => ({ generateGeminiJson: mocks.gemini }));
vi.mock("@/providers/contracts", (importOriginal) => importOriginal());
vi.mock("@/domain/phase2-schemas", (importOriginal) => importOriginal());
vi.mock("@/lib/pdf", () => ({ extractAndRenderPdf: mocks.pdf }));
vi.mock("@/lib/autopilot-recovery", () => ({ autopilotProgressPath: () => "progress.json" }));
vi.mock("@/repositories/blob-store", async (importOriginal) => ({ ...await importOriginal<typeof import("../src/repositories/blob-store")>(), getBlobStore: mocks.blobs }));
vi.mock("@/repositories", () => ({
  getExamRepository: mocks.exams, getExamRevisionRepository: mocks.revisions,
  getStructureProposalRepository: mocks.structures, getSolutionProposalRepository: mocks.solutions,
  getProviderRunRepository: mocks.runs, getAnswerKeyRepository: mocks.keys,
  getAssetRepository: mocks.assets, getDocumentPagesRepository: mocks.pages,
}));

import { examAutopilotWorkflow, extractStructureWorkflow, runDeepSeekStructure, solveExamWorkflow, solveQuestionWithDeepSeek } from "../src/workflows/phase2-workflows";

let input: { ownerId: string; examId: string; revisionId: string };
let blobs: MemoryBlobStore;
let exams: ExamRepository;
let revisions: ExamRevisionRepository;
let structures: StructureProposalRepository;
let solutions: SolutionProposalRepository;
const page = { pageId: "page-1", pageNumber: 1, mimeType: "image/png", text: "Texto PDF de la pregunta 1", imageBase64: "aW1hZ2Vu" };
const solution = { answer: "4", explanation: "Dos mas dos son cuatro.", alternatives: [], confidence: 0.9, doubts: [], sourceEvidence: [], sourceMissing: true };

function structure(number: number, figures = false) {
  return { questions: [{ number, label: String(number), type: "short_text", text: `Pregunta ${number}`, options: [], pageNumbers: [number], figureBoxes: figures ? [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }] : [], flags: [] }], doubts: [], flags: [] };
}

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("NETWORK_FORBIDDEN"); }));
  vi.stubEnv("DEEPSEEK_REVIEW_MODEL", "deepseek-chat");
  blobs = new MemoryBlobStore();
  exams = new ExamRepository(blobs);
  revisions = new ExamRevisionRepository(blobs);
  structures = new StructureProposalRepository(blobs);
  solutions = new SolutionProposalRepository(blobs);
  mocks.blobs.mockReturnValue(blobs);
  mocks.exams.mockReturnValue(exams);
  mocks.revisions.mockReturnValue(revisions);
  mocks.structures.mockReturnValue(structures);
  mocks.solutions.mockReturnValue(solutions);
  mocks.keys.mockReturnValue(new AnswerKeyRepository(blobs));
  mocks.runs.mockReturnValue(new ProviderRunRepository(blobs));
  mocks.capabilities.mockReturnValue({ provider: "deepseek", model: "deepseek-chat", configured: true, text: true, vision: "unsupported", search: "unsupported", structuredJson: "unverified" });
  mocks.assets.mockReturnValue({ getWithMeta: vi.fn(async () => ({ asset: { state: "validated", blobPath: "source.pdf" } })) });
  mocks.pages.mockReturnValue({ getWithMeta: vi.fn(async () => ({ manifest: { pages: [1, 2].map((number) => ({ pageId: `page-${number}`, pageNumber: number, sourceAssetId: "asset-1", order: number })) } })) });
  mocks.pdf.mockImplementation(async (_body, number) => ({ text: `Texto PDF de la pregunta ${number}`, png: new Uint8Array([number]) }));
  mocks.deepseek.mockImplementation(async (prompt, schema) => schema.parse(prompt.startsWith("Analiza") ? structure(Number(prompt.match(/Páginas: #(\d+)/)?.[1])) : solution));
  await blobs.put("source.pdf", new Uint8Array([1]), "application/pdf", { ifNoneMatch: true });
  const exam = await exams.create("owner-1", { title: "Examen", subject: "Matematicas" });
  const revision = await revisions.create("owner-1", exam.examId, "manifest-etag", ["page-1", "page-2"]);
  input = { ownerId: "owner-1", examId: exam.examId, revisionId: revision.revision.examRevisionId };
  const current = await exams.getWithMeta(input.ownerId, input.examId);
  await exams.update(input.ownerId, input.examId, current!.etag, { state: "extracting", activeRevisionId: input.revisionId });
});

afterEach(() => {
  expect(mocks.gemini).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Fase 2 exclusivamente DeepSeek", () => {
  it("usa texto PDF sin image_url y pide JSON explicito con el enum completo", async () => {
    await runDeepSeekStructure(input, page);
    const [prompt, , options] = mocks.deepseek.mock.calls[0];
    expect(prompt).toContain('"questions":[{"number":1');
    expect(prompt).toContain("single_choice, multiple_choice, short_text, essay, calculation, drawing, mixed");
    expect(options.messages).toEqual([{ role: "user", content: prompt }]);
    expect(prompt).toContain(page.text);
    expect(JSON.stringify(options)).not.toContain("image_url");
  });

  it.each(["unsupported", "unverified"])("rechaza paginas sin texto con vision %s", async (vision) => {
    mocks.capabilities.mockReturnValue({ vision });
    await expect(runDeepSeekStructure(input, { ...page, text: "  " })).rejects.toMatchObject({ name: "ProviderError", code: "DEEPSEEK_TEXT_REQUIRED", retryable: false });
    expect(mocks.deepseek).not.toHaveBeenCalled();
  });

  it("extrae todas las paginas sin Gemini y persiste text_only", async () => {
    const result = await extractStructureWorkflow(input);
    expect(mocks.deepseek).toHaveBeenCalledTimes(2);
    expect(result.proposalIds).toHaveLength(2);
    for (const id of result.proposalIds) {
      const proposal = await structures.get(input.ownerId, input.examId, id);
      expect(proposal?.value).toMatchObject({ provider: "deepseek", reviewScope: "text_only" });
    }
    expect((await exams.getWithMeta(input.ownerId, input.examId))?.exam.state).toBe("structure_review");
  });

  it("une preguntas multipagina, resuelve todas y respeta las transiciones del examen", async () => {
    const update = vi.spyOn(exams, "update");
    const result = await examAutopilotWorkflow(input);
    const proposal = await structures.get(input.ownerId, input.examId, result.structureProposalId);
    expect(proposal?.value.questions.map((question) => question.number)).toEqual([1, 2]);
    expect(proposal?.value.questions.map((question) => question.pageIds)).toEqual([["page-1"], ["page-2"]]);
    expect(result.solutionProposalIds).toHaveLength(2);
    expect(update.mock.calls.map((call) => call[3].state)).toEqual(["structure_review", "solving", "key_review"]);
    expect((await revisions.get(input.ownerId, input.examId, input.revisionId))?.value.status).toBe("key_review");
    expect((await solutions.list(input.ownerId, input.revisionId)).every(({ value }) => value.provider === "deepseek" && value.reviewScope === "text_only")).toBe(true);
  });

  it("conserva IDs de figuras y envia imagenes solo con vision verificada", async () => {
    mocks.capabilities.mockReturnValue({ vision: "verified" });
    mocks.deepseek.mockImplementation(async (prompt, schema) => schema.parse(prompt.startsWith("Analiza") ? structure(Number(prompt.match(/Páginas: #(\d+)/)?.[1]), true) : solution));
    const result = await examAutopilotWorkflow(input);
    const proposal = (await structures.get(input.ownerId, input.examId, result.structureProposalId))!.value;
    expect(structureProposalSchema.safeParse(proposal).success).toBe(true);
    expect(proposal.reviewScope).toBe("text_and_visual");
    expect(proposal.figures).toHaveLength(2);
    for (const question of proposal.questions) {
      expect(question.figureIds).toHaveLength(1);
      expect(proposal.figures.find((figure) => figure.figureId === question.figureIds[0])?.pageId).toBe(question.pageIds[0]);
    }
    expect(JSON.stringify(mocks.deepseek.mock.calls[0][2])).toContain("image_url");
  });

  it("une continuaciones y proporciona todo su texto al resolver", async () => {
    mocks.deepseek.mockImplementation(async (prompt, schema) => schema.parse(prompt.startsWith("Analiza") ? { ...structure(1), questions: [{ ...structure(1).questions[0], text: prompt.includes("Páginas: #2") ? "Continuacion" : "Inicio" }] } : solution));
    const result = await examAutopilotWorkflow(input);
    const proposal = (await structures.get(input.ownerId, input.examId, result.structureProposalId))!.value;
    expect(proposal.questions).toHaveLength(1);
    expect(proposal.questions[0]).toMatchObject({ text: "Inicio\nContinuacion", pageIds: ["page-1", "page-2"] });
    const solvePrompt = mocks.deepseek.mock.calls.find(([prompt]) => prompt.startsWith("Resuelve"))![0];
    expect(solvePrompt).toContain("Texto PDF de la pregunta 1");
    expect(solvePrompt).toContain("Texto PDF de la pregunta 2");
  });

  it("falla sin soluciones, no llega a key_review y no recurre a Gemini", async () => {
    mocks.deepseek.mockImplementation(async (prompt, schema) => {
      if (!prompt.startsWith("Analiza")) throw new ProviderError("DEEPSEEK_REQUEST_FAILED", "fallo simulado", false);
      return schema.parse(structure(Number(prompt.match(/Páginas: #(\d+)/)?.[1])));
    });
    await expect(examAutopilotWorkflow(input)).rejects.toMatchObject({ name: "ProviderError", code: "NO_SOLUTIONS" });
    const revision = (await revisions.get(input.ownerId, input.examId, input.revisionId))!.value;
    expect(revision.status).toBe("stale");
    expect(revision.blockingIssues).toContain("NO_SOLUTIONS");
    expect((await exams.getWithMeta(input.ownerId, input.examId))?.exam.state).toBe("draft");
    expect(await solutions.list(input.ownerId, input.revisionId)).toEqual([]);
  });

  it("marca como fallida tambien la fase structure_review", async () => {
    const create = structures.create.bind(structures);
    vi.spyOn(structures, "create").mockImplementation(async (ownerId, examId, proposal) => {
      if (proposal.questions.length > 1) throw new Error("MERGED_STRUCTURE_WRITE_FAILED");
      return create(ownerId, examId, proposal);
    });
    const update = vi.spyOn(exams, "update");
    await expect(examAutopilotWorkflow(input)).rejects.toThrow("MERGED_STRUCTURE_WRITE_FAILED");
    expect(update.mock.calls.map((call) => call[3].state)).toEqual(["structure_review", "draft"]);
    expect((await revisions.get(input.ownerId, input.examId, input.revisionId))?.value.status).toBe("stale");
  });

  it("falla explicitamente si el PDF no tiene texto extraible", async () => {
    mocks.pdf.mockResolvedValue({ text: "", png: new Uint8Array([1]) });
    await expect(examAutopilotWorkflow(input)).rejects.toMatchObject({ code: "DEEPSEEK_TEXT_REQUIRED" });
    expect((await revisions.get(input.ownerId, input.examId, input.revisionId))?.value.status).toBe("stale");
    expect((await exams.getWithMeta(input.ownerId, input.examId))?.exam.state).toBe("draft");
    expect(mocks.deepseek).not.toHaveBeenCalled();
  });

  it("no acepta una respuesta vacia como solucion", async () => {
    mocks.deepseek.mockImplementation(async (prompt, schema) => schema.parse(prompt.startsWith("Analiza") ? structure(Number(prompt.match(/Páginas: #(\d+)/)?.[1])) : { ...solution, answer: null }));
    await expect(examAutopilotWorkflow(input)).rejects.toMatchObject({ code: "NO_SOLUTIONS" });
    expect(await solutions.list(input.ownerId, input.revisionId)).toEqual([]);
  });

  it("no altera el examen si otra revision esta activa", async () => {
    const current = (await exams.getWithMeta(input.ownerId, input.examId))!;
    await exams.update(input.ownerId, input.examId, current.etag, { activeRevisionId: "otra-revision" });
    const update = vi.spyOn(exams, "update");
    await examAutopilotWorkflow(input);
    expect(update).not.toHaveBeenCalled();
    expect((await exams.getWithMeta(input.ownerId, input.examId))?.exam).toMatchObject({ activeRevisionId: "otra-revision", state: "extracting" });
  });

  it("solveExamWorkflow independiente solo llama DeepSeek", async () => {
    const extracted = await extractStructureWorkflow(input);
    const result = await solveExamWorkflow({ ...input, structureProposalId: extracted.proposalIds[0] });
    expect(result.solutionProposalIds).toHaveLength(1);
    expect(mocks.deepseek).toHaveBeenCalledTimes(3);
    expect((await revisions.get(input.ownerId, input.examId, input.revisionId))?.value.status).toBe("key_review");
  });

  it("no resuelve una imagen sin texto ni vision aunque exista el enunciado", async () => {
    const result = await extractStructureWorkflow(input);
    const proposal = (await structures.get(input.ownerId, input.examId, result.proposalIds[0]))!.value;
    mocks.deepseek.mockClear();
    await expect(solveQuestionWithDeepSeek(proposal.questions[0], { ...page, text: "" })).rejects.toMatchObject({ code: "DEEPSEEK_TEXT_REQUIRED" });
    expect(mocks.deepseek).not.toHaveBeenCalled();
  });

  it("conserva compatibilidad con nombres de proveedor persistidos antiguos", () => {
    expect(providerNameSchema.parse("gemini")).toBe("gemini");
    expect(providerNameSchema.parse("deepseek")).toBe("deepseek");
  });
});
