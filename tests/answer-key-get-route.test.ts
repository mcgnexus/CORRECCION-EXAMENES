import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ revisionGet: vi.fn(), keyGet: vi.fn(), keyCreate: vi.fn(), revisionUpdate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireOwner: async () => ({ ownerId: "owner" }) }));
vi.mock("@/repositories", () => ({
  getExamRevisionRepository: () => ({ get: mocks.revisionGet, update: mocks.revisionUpdate }),
  getAnswerKeyRepository: () => ({ get: mocks.keyGet, create: mocks.keyCreate }),
}));

import { GET } from "../src/app/api/exams/[id]/revisions/[revisionId]/answer-key/route";

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
