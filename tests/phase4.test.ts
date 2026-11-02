import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { cropResponseRegion } from "../src/lib/response-crop";
import { computeMixedScore } from "../src/domain/phase4-scoring";
import { responseRegionRevisionSchema, transcriptionModelOutputSchema } from "../src/domain/phase4-schemas";
import type { ScoreComputation } from "../src/domain/phase3-scoring";
import type { ScoringPolicy } from "../src/domain/schemas";

const policy: ScoringPolicy = {
  schemaVersion: 1,
  policyId: "policy-open-fixture",
  scaleMax: 10,
  correctPoints: 1,
  blankPoints: 0,
  incorrectPenalty: 0,
  multipleMarkHandling: "pending",
  decimals: 2,
  sections: [{ sectionId: "open", maxPoints: 6, weightBasisPoints: 10_000, kind: "open" }],
  confirmed: true,
};

const base: ScoreComputation = {
  submissionId: "submission-1",
  batchId: "batch-1",
  examId: "exam-1",
  ownerId: "owner-1",
  answerKeyRevisionId: "key-1",
  templateRevisionId: "template-1",
  scoringPolicyRevisionId: policy.policyId,
  state: "review",
  questionScores: [],
  correct: 0,
  blank: 0,
  incorrect: 0,
  pending: 0,
  rawPoints: 0,
  score: 0,
  blockingIssues: [],
  openQuestionScores: [],
  openPoints: 0,
  openMaximumPoints: 0,
  openPending: 0,
  transcriptionRevisionIds: [],
  evaluationIds: [],
  decisionIds: [],
};

describe("Puerta B: contratos y scoring abierto", () => {
  it("valida una revisión de regiones y transcripción estructurada", () => {
    const regions = responseRegionRevisionSchema.parse({ schemaVersion: 1, regionRevisionId: "regions-1", submissionId: "submission-1", batchId: "batch-1", examId: "exam-1", ownerId: "owner-1", state: "ready", createdBy: "owner-1", createdAt: "2026-11-02T00:00:00Z", updatedAt: "2026-11-02T00:00:00Z", regions: [{ regionId: "region-1", questionId: "open-1", questionType: "short_text", pageId: "page-1", sourceAssetId: "asset-1", cropAssetId: "crop-1", rect: { x: 0.1, y: 0.2, width: 0.5, height: 0.2 }, order: 0 }] });
    expect(regions.regions).toHaveLength(1);
    expect(transcriptionModelOutputSchema.parse({ literalText: "La respuesta", confidence: 0.8, uncertainSpans: [], flags: [] }).literalText).toBe("La respuesta");
  });

  it("calcula una nota abierta por sección sin penalización OMR", () => {
    const result = computeMixedScore({ base, policy, openQuestionScores: [
      { questionId: "open-1", sectionId: "open", points: 2, maximumPoints: 2, source: "gemini", transcriptionId: "transcription-1", decisionId: "decision-1" },
      { questionId: "open-2", sectionId: "open", points: 2, maximumPoints: 2, source: "manual", transcriptionId: "transcription-2", decisionId: "decision-2" },
      { questionId: "open-3", sectionId: "open", points: 1, maximumPoints: 2, source: "manual", transcriptionId: "transcription-3", decisionId: "decision-3" },
    ] });
    expect(result.score).toBeCloseTo(8.33, 2);
    expect(result.openPoints).toBe(5);
    expect(result.blockingIssues).toEqual([]);
  });

  it("bloquea el snapshot si queda una pregunta abierta sin decisión", () => {
    const result = computeMixedScore({ base, policy, openQuestionScores: [{ questionId: "open-1", sectionId: "open", points: 2, maximumPoints: 2, source: "manual", transcriptionId: "transcription-1", decisionId: "decision-1" }], openPending: 1, blockingIssues: ["open_decision_missing:open-2"] });
    expect(result.state).toBe("draft");
    expect(result.blockingIssues).toContain("open_decision_missing:open-2");
  });

  it("recorta una región normalizada sin tocar el original", async () => {
    const canvas = createCanvas(100, 80);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, 100, 80);
    context.fillStyle = "black";
    context.fillRect(20, 20, 40, 20);
    const result = await cropResponseRegion({ bytes: new Uint8Array(canvas.toBuffer("image/png")), mimeType: "image/png", rect: { x: 0.2, y: 0.25, width: 0.4, height: 0.25 } });
    expect(result.width).toBe(40);
    expect(result.height).toBe(20);
    expect(result.png.byteLength).toBeGreaterThan(0);
  });
});
