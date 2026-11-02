import { describe, expect, it } from "vitest";
import { computeScore } from "../src/domain/phase3-scoring";
import { defaultScoringPolicy } from "../src/domain/defaults";
import { omrReadingSchema, omrTemplateRevisionSchema, scoreSnapshotSchema } from "../src/domain/phase3-schemas";

const policy = { ...defaultScoringPolicy, confirmed: true };

function makeReading(rows: Array<Record<string, unknown>>, status: "completed" | "failed" = "completed") {
  return omrReadingSchema.parse({
    schemaVersion: 1,
    readingId: "reading-1",
    submissionId: "sub-1",
    batchId: "batch-1",
    examId: "exam-1",
    ownerId: "owner-1",
    pageId: "page-1",
    assetId: "asset-1",
    templateRevisionId: "tpl-1",
    algorithmVersion: "omr-1",
    inputHash: "a".repeat(64),
    alignment: {},
    rows,
    status,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  });
}

describe("puntuación Fase 3", () => {
  it("puntúa single/blank con respuestas del solucionario", () => {
    const readingResult = makeReading([
      { questionId: "q1", status: "single", selectedOptionIds: ["A"], candidateOptionIds: ["A"], metrics: [], requiresHumanReview: false, flags: [] },
      { questionId: "q2", status: "blank", selectedOptionIds: [], candidateOptionIds: [], metrics: [], requiresHumanReview: false, flags: [] },
      { questionId: "q3", status: "single", selectedOptionIds: ["B"], candidateOptionIds: ["B"], metrics: [], requiresHumanReview: false, flags: [] },
    ]);
    const { computation, blockingIssues } = computeScore({
      submissionId: "sub-1",
      batchId: "batch-1",
      examId: "exam-1",
      ownerId: "owner-1",
      answerKeyRevisionId: "key-1",
      templateRevisionId: "tpl-1",
      readings: [readingResult],
      answersByQuestion: { q1: { correctOptionIds: ["A"] }, q2: { correctOptionIds: ["C"] }, q3: { correctOptionIds: ["C"] } },
      manualSelections: {},
      scoringPolicyRevisionId: "policy-fixture",
      policy,
    });
    expect(blockingIssues).toHaveLength(0);
    expect(computation.correct).toBe(1);
    expect(computation.blank).toBe(1);
    expect(computation.incorrect).toBe(1);
    expect(computation.score).toBeCloseTo((1 - 0.25) / 3 * 10, 2);
    expect(computation.scoringPolicyRevisionId).toBe("policy-fixture");
    expect(computation.state).toBe("review");
  });

  it("bloquea la puntuación con filas ambiguas o lecturas fallidas", () => {
    const ambiguous = makeReading([
      { questionId: "q1", status: "ambiguous", selectedOptionIds: [], candidateOptionIds: ["A", "B"], metrics: [], requiresHumanReview: true, flags: [] },
    ]);
    const failed = makeReading([], "failed");
    const { computation, blockingIssues } = computeScore({
      submissionId: "sub-1",
      batchId: "batch-1",
      examId: "exam-1",
      ownerId: "owner-1",
      answerKeyRevisionId: "key-1",
      templateRevisionId: "tpl-1",
      readings: [ambiguous, failed],
      answersByQuestion: { q1: { correctOptionIds: ["A"] } },
      manualSelections: {},
      policy,
    });
    expect(computation.pending).toBe(1);
    expect(computation.state).toBe("draft");
    expect(blockingIssues.some((issue) => issue.startsWith("ambiguous:"))).toBe(true);
    expect(blockingIssues.some((issue) => issue.startsWith("reading_failed:"))).toBe(true);
  });

  it("aplica la decisión manual con prioridad sobre la lectura", () => {
    const readingRow = makeReading([
      { questionId: "q1", status: "single", selectedOptionIds: ["B"], candidateOptionIds: ["B"], metrics: [], requiresHumanReview: false, flags: [] },
    ]);
    const { computation } = computeScore({
      submissionId: "sub-1",
      batchId: "batch-1",
      examId: "exam-1",
      ownerId: "owner-1",
      answerKeyRevisionId: "key-1",
      templateRevisionId: "tpl-1",
      readings: [readingRow],
      answersByQuestion: { q1: { correctOptionIds: ["A"] } },
      manualSelections: { q1: { selectedOptionIds: ["A"], status: "single" } },
      policy,
    });
    expect(computation.correct).toBe(1);
    expect(computation.questionScores[0].source).toBe("manual");
  });
});

describe("contratos Fase 3", () => {
  it("rechaza plantillas sin cuatro anclas o sin burbujas", () => {
    const base = {
      schemaVersion: 1,
      templateId: "tpl-1",
      examId: "exam-1",
      ownerId: "owner-1",
      state: "draft",
      canvasWidth: 800,
      canvasHeight: 1000,
      sourceAnchors: [[0, 0], [1, 0], [1, 1], [0, 1]],
      targetAnchors: [[0, 0], [1, 0], [1, 1], [0, 1]],
      bubbles: [{ questionId: "q1", optionId: "A", x: 0.1, y: 0.1, width: 0.05, height: 0.03 }],
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z",
    };
    expect(omrTemplateRevisionSchema.parse(base).state).toBe("draft");
    expect(() => omrTemplateRevisionSchema.parse({ ...base, sourceAnchors: [[0, 0]] })).toThrow();
    expect(() => omrTemplateRevisionSchema.parse({ ...base, bubbles: [] })).toThrow();
  });

  it("aplica el preprocesamiento por defecto y valida sus límites", () => {
    const base = {
      schemaVersion: 1,
      templateId: "tpl-1",
      examId: "exam-1",
      ownerId: "owner-1",
      state: "draft",
      canvasWidth: 800,
      canvasHeight: 1000,
      sourceAnchors: [[0, 0], [1, 0], [1, 1], [0, 1]],
      targetAnchors: [[0, 0], [1, 0], [1, 1], [0, 1]],
      bubbles: [{ questionId: "q1", optionId: "A", x: 0.1, y: 0.1, width: 0.05, height: 0.03 }],
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z",
    };
    const parsed = omrTemplateRevisionSchema.parse(base);
    expect(parsed.preprocess).toEqual({ rotation: 0, brightness: 1, contrast: 1 });
    const customized = omrTemplateRevisionSchema.parse({ ...base, preprocess: { rotation: 2.5, brightness: 1.2, contrast: 1.1 } });
    expect(customized.preprocess.rotation).toBe(2.5);
    expect(() => omrTemplateRevisionSchema.parse({ ...base, preprocess: { rotation: 400, brightness: 1, contrast: 1 } })).toThrow();
  });

  it("conserva snapshot en draft con incidencias", () => {
    const snapshot = scoreSnapshotSchema.parse({
      schemaVersion: 1,
      snapshotId: "snap-1",
      submissionId: "sub-1",
      batchId: "batch-1",
      examId: "exam-1",
      ownerId: "owner-1",
      answerKeyRevisionId: "key-1",
      templateRevisionId: "tpl-1",
      state: "draft",
      questionScores: [],
      correct: 0,
      blank: 0,
      incorrect: 0,
      pending: 1,
      rawPoints: 0,
      score: 0,
      blockingIssues: ["ambiguous:q1"],
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z",
    });
    expect(snapshot.blockingIssues).toContain("ambiguous:q1");
  });
});

