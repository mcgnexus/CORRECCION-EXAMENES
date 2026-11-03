import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ batch: vi.fn(), submission: vi.fn(), snapshot: vi.fn(), key: vi.fn(), template: vi.fn(), updateBatch: vi.fn(), updateSubmission: vi.fn(), updateSnapshot: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ assertSameOrigin: vi.fn(), requireOwner: async () => ({ ownerId: "owner" }) }));
vi.mock("@/repositories", () => ({
  getBatchRepository: () => ({ get: mocks.batch, update: mocks.updateBatch }),
  getSubmissionRepository: () => ({ get: mocks.submission, update: mocks.updateSubmission }),
  getScoreSnapshotRepository: () => ({ get: mocks.snapshot, update: mocks.updateSnapshot }),
  getAnswerKeyRepository: () => ({ get: mocks.key }),
  getOmrTemplateRepository: () => ({ get: mocks.template }),
  getAuditRepository: () => ({ append: mocks.audit }),
}));
import { POST as finalize } from "../src/app/api/exams/[id]/batches/[batchId]/finalize/route";
import { POST as close } from "../src/app/api/exams/[id]/batches/[batchId]/submissions/[submissionId]/close/route";

const dependencies = { ownerId: "owner", examId: "exam", batchId: "batch", submissionId: "submission", answerKeyRevisionId: "key", templateRevisionId: "template", scoringPolicyRevisionId: "policy", transcriptionRevisionIds: [], evaluationIds: [], decisionIds: [] };
const context = { params: Promise.resolve({ id: "exam", batchId: "batch", submissionId: "submission" }) };
const request = () => new Request("https://example.com/api/finalize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedEtag: "etag", snapshotExpectedEtag: "snapshot-etag" }) });
const submission = (patch = {}) => ({ etag: "etag", value: { ...dependencies, state: "closed", confirmedIdentity: "Alumno", snapshotId: "snapshot", responseBlockingIssues: [], responseTranscriptionIds: [], responseEvaluationIds: [], responseDecisionIds: [], ...patch } });
const snapshot = (patch = {}) => ({ etag: "snapshot-etag", value: { ...dependencies, state: "closed", snapshotId: "snapshot", blockingIssues: [], ...patch } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.batch.mockResolvedValue({ etag: "etag", value: { ...dependencies, state: "review", submissionIds: ["submission"], blockingIssues: [], scoringPolicy: { confirmed: true } } });
  mocks.key.mockResolvedValue({ value: { status: "approved", scoringPolicyRevisionId: "policy" } });
  mocks.template.mockResolvedValue({ value: { state: "approved" } });
  mocks.submission.mockResolvedValue(submission());
  mocks.snapshot.mockResolvedValue(snapshot());
  mocks.updateBatch.mockResolvedValue({ value: { state: "closed" }, etag: "closed" });
  mocks.updateSubmission.mockResolvedValue({ value: { state: "closed" }, etag: "closed" });
  mocks.updateSnapshot.mockResolvedValue({ value: { state: "closed" }, etag: "closed" });
});

describe("cierre seguro de lotes", () => {
  it("no confunde job completado con entrega cerrada e indica el paso pendiente", async () => {
    mocks.submission.mockResolvedValue(submission({ state: "review" }));
    const response = await finalize(request(), context);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({ code: "SUBMISSION_NOT_CLOSED", message: expect.stringContaining("Confirma la identidad") });
    expect(mocks.updateBatch).not.toHaveBeenCalled();
  });

  it("no permite finalizar con incidencias de la entrega", async () => {
    mocks.submission.mockResolvedValue(submission({ responseBlockingIssues: ["OMR_SERVICE_FAILED"] }));
    const response = await finalize(request(), context);
    expect((await response.json()).error.code).toBe("SUBMISSION_BLOCKED");
    expect(mocks.updateBatch).not.toHaveBeenCalled();
  });

  it("no permite finalizar con puntuaciones bloqueadas aunque esten cerradas", async () => {
    mocks.snapshot.mockResolvedValue(snapshot({ blockingIssues: ["reading_failed"] }));
    const response = await finalize(request(), context);
    expect((await response.json()).error.code).toBe("SNAPSHOT_BLOCKED");
    expect(mocks.updateBatch).not.toHaveBeenCalled();
  });

  it("finaliza solo con entregas y puntuaciones cerradas sin incidencias", async () => {
    expect((await finalize(request(), context)).status).toBe(200);
    expect(mocks.updateBatch).toHaveBeenCalledWith("owner", "exam", "batch", "etag", expect.objectContaining({ state: "closed" }));
  });
});

describe("cierre seguro de entregas", () => {
  it("no cierra una puntuacion que procede de lectura fallida", async () => {
    mocks.submission.mockResolvedValue(submission({ state: "review" }));
    mocks.snapshot.mockResolvedValue(snapshot({ state: "review", blockingIssues: ["OMR_SERVICE_FAILED"] }));
    const response = await close(request(), context);
    expect((await response.json()).error.code).toBe("SNAPSHOT_BLOCKED");
    expect(mocks.updateSnapshot).not.toHaveBeenCalled();
    expect(mocks.updateSubmission).not.toHaveBeenCalled();
  });

  it("bloquea incidencias en la entrega aunque el snapshot no las incluya", async () => {
    mocks.submission.mockResolvedValue(submission({ state: "review", responseBlockingIssues: ["OMR_SERVICE_FAILED"] }));
    mocks.snapshot.mockResolvedValue(snapshot({ state: "review" }));
    const response = await close(request(), context);
    expect((await response.json()).error.code).toBe("SUBMISSION_BLOCKED");
    expect(mocks.updateSubmission).not.toHaveBeenCalled();
  });

  it("cierra la entrega revisada con identidad confirmada y sin incidencias", async () => {
    mocks.submission.mockResolvedValue(submission({ state: "review" }));
    mocks.snapshot.mockResolvedValue(snapshot({ state: "review" }));
    expect((await close(request(), context)).status).toBe(200);
    expect(mocks.updateSnapshot).toHaveBeenCalled();
    expect(mocks.updateSubmission).toHaveBeenCalled();
  });
});
