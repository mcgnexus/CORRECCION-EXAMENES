import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revisionGet: vi.fn(), revisionUpdate: vi.fn(), keyGet: vi.fn(), keyCreate: vi.fn(), keyUpdate: vi.fn(),
  structureGet: vi.fn(), solutionsList: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ assertSameOrigin: vi.fn(), requireOwner: async () => ({ ownerId: "owner" }) }));
vi.mock("@/repositories", () => ({
  getExamRevisionRepository: () => ({ get: mocks.revisionGet, update: mocks.revisionUpdate }),
  getAnswerKeyRepository: () => ({ get: mocks.keyGet, create: mocks.keyCreate, update: mocks.keyUpdate }),
  getStructureProposalRepository: () => ({ get: mocks.structureGet }),
  getSolutionProposalRepository: () => ({ list: mocks.solutionsList }),
}));
import { POST } from "../src/app/api/exams/[id]/revisions/[revisionId]/answer-key/autofill/route";

describe("ETag al generar el primer solucionario", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.revisionGet.mockResolvedValue({ etag: "revision-etag", value: { status: "key_review", activeStructureProposalId: "structure" } });
    mocks.structureGet.mockResolvedValue({ value: { questions: [{ questionId: "q1", type: "short_text" }] } });
    mocks.solutionsList.mockResolvedValue([{ value: { questionId: "q1", provider: "deepseek", model: "test", solutionProposalId: "solution", answer: "Respuesta", explanation: "Explicacion", confidence: 0.9 } }]);
    mocks.keyCreate.mockResolvedValue({ etag: "new-key-etag", answerKey: { answerKeyRevisionId: "key" } });
    mocks.keyUpdate.mockResolvedValue({ answerKey: { status: "review" }, etag: "saved-key-etag" });
  });

  const request = (etag: string) => new Request("https://example.com/api/autofill", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedEtag: etag }),
  });
  const context = { params: Promise.resolve({ id: "exam", revisionId: "revision" }) };

  it("comprueba el ETag de revision y usa el del solucionario nuevo para guardar", async () => {
    expect((await POST(request("revision-etag"), context)).status).toBe(200);
    expect(mocks.keyUpdate).toHaveBeenCalledWith("owner", "exam", "key", "new-key-etag", expect.objectContaining({ status: "review" }));
  });

  it("crea el solucionario aunque el ETag de la revision haya cambiado", async () => {
    expect((await POST(request("old-etag"), context)).status).toBe(200);
    expect(mocks.keyCreate).toHaveBeenCalled();
  });

  it("conserva el ETag enviado cuando el solucionario ya existe", async () => {
    mocks.revisionGet.mockResolvedValue({ etag: "revision-etag", value: { status: "key_review", activeStructureProposalId: "structure", answerKeyRevisionId: "key" } });
    mocks.keyGet.mockResolvedValue({ etag: "existing-key-etag", value: { answerKeyRevisionId: "key" } });
    expect((await POST(request("existing-key-etag"), context)).status).toBe(200);
    expect(mocks.keyCreate).not.toHaveBeenCalled();
    expect(mocks.keyUpdate).toHaveBeenCalledWith("owner", "exam", "key", "existing-key-etag", expect.anything());
  });
});
