import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultScoringPolicy } from "../src/domain/defaults";
import { comparisonFingerprint } from "../src/lib/comparison-fingerprint";

const mocks = vi.hoisted(() => ({ submission: vi.fn(), batch: vi.fn(), key: vi.fn(), readings: vi.fn(), update: vi.fn(), snapshot: vi.fn() }));
vi.mock("@/lib/auth", () => ({ assertSameOrigin: vi.fn(), requireOwner: async () => ({ ownerId: "owner" }) }));
vi.mock("@/repositories", () => ({
  getSubmissionRepository: () => ({ get: mocks.submission, update: mocks.update }),
  getBatchRepository: () => ({ get: mocks.batch }),
  getAnswerKeyRepository: () => ({ get: mocks.key }),
  getOmrReadingRepository: () => ({ list: mocks.readings }),
  getManualDecisionRepository: () => ({ listByReadings: async () => [] }),
  getResponseDecisionRepository: () => ({ list: async () => [] }),
  getTranscriptionRepository: () => ({ list: async () => [] }),
  getScoreSnapshotRepository: () => ({ create: mocks.snapshot }),
}));
import { POST } from "../src/app/api/exams/[id]/batches/[batchId]/submissions/[submissionId]/route";

const row = { questionId: "q1", status: "single" as const, selectedOptionIds: ["B"], candidateOptionIds: ["B"], flags: [], requiresHumanReview: false, metrics: [] };
const context = { params: Promise.resolve({ id: "exam", batchId: "batch", submissionId: "submission" }) };
const request = () => new Request("https://example.com/api/score", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "score" }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.submission.mockResolvedValue({ etag: "etag", value: { submissionId: "submission", confirmedIdentity: "Alumno", readingIds: ["reading"], responseDecisionIds: [], responseTranscriptionIds: [], responseEvaluationIds: [], responseBlockingIssues: ["IDENTITY_REQUIRED"], comparisonConfirmedAt: new Date().toISOString(), comparisonAnswerKeyRevisionId: "key", comparisonFingerprint: comparisonFingerprint("key", [{ value: { readingId: "reading", status: "completed", rows: [row] }, etag: "reading-etag" }]) } });
  mocks.batch.mockResolvedValue({ value: { state: "review", answerKeyRevisionId: "key", templateRevisionId: "template", scoringPolicyRevisionId: "policy", scoringPolicy: { ...defaultScoringPolicy, confirmed: true, sections: [{ sectionId: "test", kind: "test", maxPoints: 10, weightBasisPoints: 10000 }] } } });
  mocks.key.mockResolvedValue({ value: { status: "approved", scoringPolicyRevisionId: "policy", decisions: { q1: { sectionId: "test", answer: { selectedOptionIds: ["B"] } } } } });
  mocks.readings.mockResolvedValue([{ value: { readingId: "reading", status: "completed", rows: [row] }, etag: "reading-etag" }]);
  mocks.snapshot.mockImplementation(async (value) => ({ snapshot: { ...value, snapshotId: "snapshot" } }));
});

describe("puntuar entrega test tras revisar identidad", () => {
  it("no exige decisiones abiertas para sectionId test y retira incidencias resueltas", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(201);
    expect((await response.json()).data).toMatchObject({ correct: 1, openPending: 0, blockingIssues: [] });
    expect(mocks.update).toHaveBeenCalledWith("owner", "batch", "submission", "etag", expect.objectContaining({ state: "scored", responseBlockingIssues: [] }));
  });

  it("mantiene el bloqueo si falta una pregunta del solucionario", async () => {
    const rows: typeof row[] = [];
    mocks.readings.mockResolvedValue([{ value: { readingId: "reading", status: "completed", rows }, etag: "reading-etag" }]);
    mocks.submission.mockResolvedValue({ etag: "etag", value: { submissionId: "submission", confirmedIdentity: "Alumno", readingIds: ["reading"], responseDecisionIds: [], responseTranscriptionIds: [], responseEvaluationIds: [], responseBlockingIssues: [], comparisonConfirmedAt: new Date().toISOString(), comparisonAnswerKeyRevisionId: "key", comparisonFingerprint: comparisonFingerprint("key", [{ value: { readingId: "reading", status: "completed", rows }, etag: "reading-etag" }]) } });
    const response = await POST(request(), context);
    expect((await response.json()).data.blockingIssues).toContain("omr_question_missing:q1");
    expect(mocks.update).toHaveBeenCalledWith("owner", "batch", "submission", "etag", expect.objectContaining({ state: "review" }));
  });

  it("mantiene pendientes las filas que requieren revision aunque su estado sea single", async () => {
    const rows = [{ ...row, requiresHumanReview: true }];
    mocks.readings.mockResolvedValue([{ value: { readingId: "reading", status: "completed", rows }, etag: "reading-etag" }]);
    mocks.submission.mockResolvedValue({ etag: "etag", value: { submissionId: "submission", confirmedIdentity: "Alumno", readingIds: ["reading"], responseDecisionIds: [], responseTranscriptionIds: [], responseEvaluationIds: [], responseBlockingIssues: [], comparisonConfirmedAt: new Date().toISOString(), comparisonAnswerKeyRevisionId: "key", comparisonFingerprint: comparisonFingerprint("key", [{ value: { readingId: "reading", status: "completed", rows }, etag: "reading-etag" }]) } });
    const response = await POST(request(), context);
    expect((await response.json()).data.blockingIssues).toContain("omr_review_required:q1");
  });
});
