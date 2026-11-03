import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultScoringPolicy } from "../src/domain/defaults";
import { processBatchWorkflow } from "../src/workflows/batch-processing-workflows";

const mocks = vi.hoisted(() => ({ repositories: {} as Record<string, () => unknown>, fetch: vi.fn(), regions: vi.fn(), evaluations: vi.fn() }));
vi.mock("@/repositories", () => Object.fromEntries([
  "getBatchRepository", "getAnswerKeyRepository", "getExamRevisionRepository", "getStructureProposalRepository", "getOmrTemplateRepository", "getSubmissionRepository", "getAssetRepository", "getJobRepository", "getOmrReadingRepository", "getResponseRegionRepository", "getEvaluationRepository", "getManualDecisionRepository", "getResponseDecisionRepository", "getTranscriptionRepository", "getScoreSnapshotRepository", "getAuditRepository",
].map((name) => [name, () => mocks.repositories[name]()])));
vi.mock("@/repositories/blob-store", () => ({ getBlobStore: () => ({ get: async () => ({ body: Buffer.from("image") }) }) }));
vi.mock("@/providers/gemini", () => ({ generateGeminiJsonWithMetadata: vi.fn() }));

const input = { ownerId: "owner", examId: "exam", batchId: "batch", jobId: "job", answerKeyRevisionId: "key", templateRevisionId: "template", scoringPolicyRevisionId: "policy", concurrency: 1, maxAttempts: 2 };
const row = (questionId: string, status = "single") => ({ questionId, status, selectedOptionIds: ["A"], candidateOptionIds: ["A"], metrics: [], requiresHumanReview: status !== "single", flags: [] });

function fixture(count = 1, identity = true) {
  const questions = Array.from({ length: count }, (_, index) => ({ questionId: `uuid-${index + 1}`, number: index + 1, label: String(index + 1) }));
  const submission = { submissionId: "submission", assetIds: ["asset"], pageIds: ["page"], readingIds: [] as string[], responseTranscriptionIds: [], responseEvaluationIds: [], responseDecisionIds: [], confirmedIdentity: identity ? { studentId: "student" } : undefined, state: "ready", snapshotId: undefined as string | undefined };
  const batch = { ...input, state: "ready", maxPages: 10, submissionIds: [submission.submissionId], blockingIssues: [], scoringPolicy: { ...defaultScoringPolicy, confirmed: true } };
  const readings: Array<{ value: Record<string, unknown>; etag: string }> = [];
  const snapshots: Array<Record<string, unknown>> = [];
  const job: Record<string, unknown> = { status: "queued" };
  const wrap = (value: unknown) => ({ value, etag: "etag" });
  const omr = {
    findByInput: async (_owner: string, ids: string[], assetId: string, templateId: string, inputHash: string) => readings.find(({ value }) => ids.includes(String(value.readingId)) && value.assetId === assetId && value.templateRevisionId === templateId && value.inputHash === inputHash),
    list: async (_owner: string, ids: string[]) => readings.filter(({ value }) => ids.includes(String(value.readingId))),
    create: async (data: Record<string, unknown>) => { const reading = { ...data, readingId: `reading-${readings.length}`, updatedAt: "2026-11-02" }; readings.push({ value: reading, etag: "etag" }); return { reading }; },
    update: async (_owner: string, id: string, _etag: string, patch: Record<string, unknown>) => { const entry = readings.find(({ value }) => value.readingId === id)!; Object.assign(entry.value, patch); return entry; },
  };
  const repositories = {
    getBatchRepository: () => ({ get: async () => wrap(batch), update: async (_owner: string, _exam: string, _id: string, _etag: string, patch: object) => { Object.assign(batch, patch); return wrap(batch); } }),
    getAnswerKeyRepository: () => ({ get: async () => wrap({ status: "approved", examRevisionId: "revision", decisions: Object.fromEntries(questions.map((q) => [q.questionId, { answer: { selectedOptionIds: ["A"] } }])) }) }),
    getExamRevisionRepository: () => ({ get: async () => wrap({ activeStructureProposalId: "structure" }) }),
    getStructureProposalRepository: () => ({ get: async () => wrap({ examRevisionId: "revision", questions }) }),
    getOmrTemplateRepository: () => ({ get: async () => wrap({ state: "approved", templateId: "template", algorithmVersion: "v1", bubbles: questions.map((q) => ({ questionId: q.label })) }) }),
    getSubmissionRepository: () => ({ get: async () => wrap(submission), update: async (_owner: string, _batch: string, _id: string, _etag: string, patch: object) => { Object.assign(submission, patch); return wrap(submission); } }),
    getAssetRepository: () => ({ getWithMeta: async () => ({ asset: { assetId: "asset", state: "validated", mimeType: "image/png", blobPath: "image" } }) }),
    getJobRepository: () => ({ getWithMeta: async () => ({ job, etag: "etag" }), updateWithMeta: async (_owner: string, _id: string, _etag: string, patch: object) => { Object.assign(job, patch); return { job, etag: "etag" }; } }),
    getOmrReadingRepository: () => omr,
    getResponseRegionRepository: () => ({ getActive: mocks.regions }),
    getEvaluationRepository: () => ({ list: mocks.evaluations }),
    getManualDecisionRepository: () => ({ listByReadings: async () => [] }),
    getResponseDecisionRepository: () => ({ list: async () => [] }),
    getTranscriptionRepository: () => ({ list: async () => [] }),
    getScoreSnapshotRepository: () => ({ get: async (_owner: string, id: string) => { const snapshot = snapshots.find((s) => s.snapshotId === id); return snapshot ? wrap(snapshot) : null; }, create: async (data: object) => { const snapshot = { ...data, snapshotId: `snapshot-${snapshots.length}` }; snapshots.push(snapshot); return { snapshot }; } }),
    getAuditRepository: () => ({ append: async () => undefined }),
  };
  mocks.repositories = repositories;
  mocks.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ result: { alignment: {}, rows: questions.map((q) => row(q.label)) } }) });
  return { job, submission, readings, snapshots, questions, batch };
}

describe("procesamiento batch sin red", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", mocks.fetch); vi.stubEnv("INTERNAL_SERVICE_SECRET", "test-secret"); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("mapea 50 números a UUID, cuenta test y no prepara regiones ni evaluaciones abiertas", async () => {
    const state = fixture(50);
    await processBatchWorkflow(input);
    expect(state.job).toMatchObject({ status: "completed", phase: "completed", progress: { completedQuestions: 50, completedSubmissions: 1, percent: 100 } });
    expect(state.snapshots[0]).toMatchObject({ correct: 50, blockingIssues: [] });
    expect(state.readings[0].value.rows).toEqual(state.questions.map((q) => row(q.questionId)));
    expect(mocks.regions).not.toHaveBeenCalled();
    expect(mocks.evaluations).not.toHaveBeenCalled();
    expect(state.submission.state).toBe("scored");
  });

  it("persiste solo código HTTP seguro y reintenta la misma lectura failed en otra ejecución", async () => {
    const state = fixture();
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 400, text: async () => "SECRET RAW BODY" });
    await processBatchWorkflow(input);
    expect(state.readings[0].value).toMatchObject({ status: "failed", errorCode: "OMR_SERVICE_HTTP_400" });
    expect(state.job).toMatchObject({ status: "completed", phase: "review_required", progress: { completedQuestions: 0, percent: 0 } });
    expect(JSON.stringify(state)).not.toContain("SECRET RAW BODY");
    await processBatchWorkflow(input);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(state.readings).toHaveLength(1);
    expect(state.readings[0].value).toMatchObject({ status: "completed", errorCode: undefined });
    expect(state.snapshots.at(-1)).toMatchObject({ correct: 1, blockingIssues: [] });
  });

  it("reintenta errores transitorios dentro del mismo job sin crear otra lectura", async () => {
    const state = fixture();
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 503, text: async () => "unavailable" });
    await processBatchWorkflow(input);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(state.readings).toHaveLength(1);
    expect(state.job).toMatchObject({ phase: "completed", progress: { completedQuestions: 1 } });
  });

  it.each(["unknown", "ambiguous", "duplicate", "missing", "pending"])("bloquea filas %s sin contar respuestas inválidas", async (kind) => {
    const state = fixture();
    if (kind === "ambiguous") state.questions.push({ questionId: "other-uuid", number: 1, label: "other" });
    const rows = kind === "missing" ? [] : kind === "duplicate" ? [row("1"), row("uuid-1")] : [row(kind === "unknown" ? "unknown" : "1", kind === "pending" ? "ambiguous" : "single")];
    mocks.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ result: { alignment: {}, rows } }) });
    await processBatchWorkflow(input);
    expect(state.job).toMatchObject({ phase: "review_required", progress: { completedQuestions: 0, blockedSubmissions: 1 } });
    expect(state.snapshots[0].blockingIssues).not.toEqual([]);
  });

  it("preserva IDs internos válidos aunque colisionen con un label", async () => {
    const state = fixture();
    state.questions.push({ questionId: "other-uuid", number: 2, label: "uuid-1" });
    mocks.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ result: { alignment: {}, rows: [row("uuid-1")] } }) });
    await processBatchWorkflow(input);
    expect(state.readings[0].value.rows).toEqual([row("uuid-1")]);
    expect(state.job).toMatchObject({ progress: { completedQuestions: 1 } });
  });

  it("mantiene identidad obligatoria y no cierra la entrega", async () => {
    const state = fixture(1, false);
    await processBatchWorkflow(input);
    expect(state.snapshots[0].blockingIssues).toContain("IDENTITY_REQUIRED");
    expect(state.job).toMatchObject({ status: "completed", phase: "review_required", progress: { percent: 99 } });
    expect(state.submission.state).toBe("review");
  });

  it("descarta lecturas fallidas de una plantilla anterior en el snapshot actual", async () => {
    const state = fixture();
    state.readings.push({ value: { readingId: "old-error", assetId: "asset", templateRevisionId: "old-template", status: "failed", errorCode: "OLD_FAILURE", rows: [] }, etag: "etag" });
    state.submission.readingIds.push("old-error");
    await processBatchWorkflow(input);
    expect(state.snapshots[0]).toMatchObject({ correct: 1, blockingIssues: [] });
    expect(state.job).toMatchObject({ phase: "completed" });
  });

  it("no cuenta una fila single que exige revisión humana", async () => {
    const state = fixture();
    mocks.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ result: { alignment: {}, rows: [{ ...row("1"), requiresHumanReview: true }] } }) });
    await processBatchWorkflow(input);
    expect(state.job).toMatchObject({ phase: "review_required", progress: { completedQuestions: 0 } });
    expect(state.snapshots[0].blockingIssues).toContain("omr_review_required:uuid-1");
  });

  it("conserva las aprobaciones obligatorias del solucionario", async () => {
    fixture();
    mocks.repositories.getAnswerKeyRepository = () => ({ get: async () => ({ value: { status: "draft" } }) });
    await expect(processBatchWorkflow(input)).rejects.toMatchObject({ code: "ANSWER_KEY_STALE" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("exige regiones cuando el solucionario sí contiene preguntas abiertas", async () => {
    const state = fixture();
    state.batch.scoringPolicy.sections = [{ sectionId: "open", kind: "open", maxPoints: 1, weightBasisPoints: 10000 }];
    mocks.repositories.getAnswerKeyRepository = () => ({ get: async () => ({ value: { status: "approved", examRevisionId: "revision", decisions: { "uuid-1": { answer: { selectedOptionIds: ["A"] } }, "open-uuid": { sectionId: "open", answer: "Respuesta abierta" } } } }) });
    mocks.regions.mockResolvedValueOnce(null);
    mocks.evaluations.mockResolvedValueOnce([]);
    await processBatchWorkflow(input);
    expect(mocks.regions).toHaveBeenCalledTimes(1);
    expect(state.snapshots[0].blockingIssues).toContain("OPEN_REGIONS_REQUIRED");
    expect(state.job).toMatchObject({ phase: "review_required", progress: { completedQuestions: 1, totalQuestions: 2 } });
  });
});
