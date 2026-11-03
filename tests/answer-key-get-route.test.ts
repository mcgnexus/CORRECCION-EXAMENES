import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ revisionGet: vi.fn(), keyGet: vi.fn(), keyCreate: vi.fn(), keyUpdate: vi.fn(), revisionUpdate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireOwner: async () => ({ ownerId: "owner" }), assertSameOrigin: vi.fn() }));
vi.mock("@/repositories", () => ({
  getExamRevisionRepository: () => ({ get: mocks.revisionGet, update: mocks.revisionUpdate }),
  getAnswerKeyRepository: () => ({ get: mocks.keyGet, create: mocks.keyCreate, update: mocks.keyUpdate }),
}));

import { GET, PATCH } from "../src/app/api/exams/[id]/revisions/[revisionId]/answer-key/route";

describe("GET answer key route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("acepta directamente el ID del solucionario usado por los lotes", async () => {
    const answerKey = { answerKeyRevisionId: "key-id", examRevisionId: "exam-revision-id", status: "approved", decisions: {} };
    mocks.keyGet.mockResolvedValue({ value: answerKey, etag: "key-etag" });
    mocks.revisionGet.mockResolvedValue({ value: { revisionId: "exam-revision-id" }, etag: "revision-etag" });

    const response = await GET(new Request("https://example.com"), { params: Promise.resolve({ id: "exam-id", revisionId: "key-id" }) });
    const payload = await response.json() as { data: { answerKey: typeof answerKey } };

    expect(response.status).toBe(200);
    expect(payload.data.answerKey.answerKeyRevisionId).toBe("key-id");
    expect(mocks.revisionGet).toHaveBeenCalledWith("owner", "exam-id", "exam-revision-id");
  });
});

describe("PATCH answer key route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no permite cambiar una revisión aprobada", async () => {
    mocks.revisionGet.mockResolvedValue({ value: { revisionId: "exam-revision-id", answerKeyRevisionId: "key-id" }, etag: "revision-etag" });
    mocks.keyGet.mockResolvedValue({ value: { answerKeyRevisionId: "key-id", examRevisionId: "exam-revision-id", status: "approved", decisions: {}, blockingIssues: [] }, etag: "key-etag" });

    const response = await PATCH(new Request("https://example.com", { method: "PATCH", headers: { origin: "https://example.com", "content-type": "application/json" }, body: JSON.stringify({ expectedEtag: "key-etag", decisions: {} }) }), { params: Promise.resolve({ id: "exam-id", revisionId: "exam-revision-id" }) });

    expect(response.status).toBe(409);
    expect(mocks.keyUpdate).not.toHaveBeenCalled();
  });
});
