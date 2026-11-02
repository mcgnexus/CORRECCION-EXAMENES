import { describe, expect, it } from "vitest";
import { ProviderError, withProviderRetry } from "../src/providers/contracts";
import { answerKeyRevisionSchema, examRevisionSchema, structureModelOutputSchema } from "../src/domain/phase2-schemas";

describe("contratos y resiliencia de Fase 2", () => {
  it("reintenta 429 y conserva el resultado final", async () => {
    let attempts = 0;
    const result = await withProviderRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw new ProviderError("RATE_LIMIT", "rate limited", true, 429, 0);
      return "ok";
    });
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("exige la forma estructurada de una propuesta", () => {
    const result = structureModelOutputSchema.parse({ questions: [], doubts: [], flags: [] });
    expect(result.questions).toHaveLength(0);
    expect(() => structureModelOutputSchema.parse({ questions: [{ number: 1 }] })).toThrow();
  });

  it("conserva bloqueos de aprobación en el answer key", () => {
    const answerKey = answerKeyRevisionSchema.parse({ schemaVersion: 1, answerKeyRevisionId: "key-1", examRevisionId: "rev-1", examId: "exam-1", ownerId: "owner-1", status: "review", scoringPolicyRevisionId: "policy-default", decisions: {}, blockingIssues: ["source_missing:q1"], createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" });
    expect(answerKey.blockingIssues).toContain("source_missing:q1");
  });

  it("acepta manifests antiguos y persiste el puntero de workflow cuando existe", () => {
    const revision = { schemaVersion: 1, examRevisionId: "rev-1", examId: "exam-1", ownerId: "owner-1", pagesManifestEtag: "pages-etag", sourcePageIds: [], status: "extracting", language: "es", proposals: [], blockingIssues: [], createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" };
    expect(examRevisionSchema.parse(revision).workflowRunId).toBeUndefined();
    expect(examRevisionSchema.parse({ ...revision, workflowRunId: "run-1" }).workflowRunId).toBe("run-1");
  });
});
