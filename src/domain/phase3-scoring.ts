import { calculateTestScore } from "./scoring";
import type { ScoringPolicy } from "./schemas";
import type { OmrReading, ScoreSnapshot } from "./phase3-schemas";

export type AnswerOption = { optionId: string; correct: boolean };

export type ScoreInput = {
  submissionId: string;
  batchId: string;
  examId: string;
  ownerId: string;
  answerKeyRevisionId: string;
  templateRevisionId: string;
  readings: OmrReading[];
  answersByQuestion: Record<string, { correctOptionIds: string[] }>;
  manualSelections: Record<string, { selectedOptionIds: string[]; status: "single" | "blank" }>;
  policy: ScoringPolicy;
};

export type ScoreComputation = Omit<ScoreSnapshot, "schemaVersion" | "snapshotId" | "createdAt" | "updatedAt">;

export function computeScore(input: ScoreInput): { computation: ScoreComputation; blockingIssues: string[] } {
  const blockingIssues: string[] = [];
  const questionScores: ScoreSnapshot["questionScores"] = [];
  const answers = input.answersByQuestion ?? {};

  for (const reading of input.readings) {
    if (reading.status === "failed") {
      blockingIssues.push(`reading_failed:${reading.readingId}`);
      continue;
    }
    for (const row of reading.rows) {
      const manual = input.manualSelections[row.questionId];
      const answer = answers[row.questionId];
      if (!answer) {
        blockingIssues.push(`answer_missing:${row.questionId}`);
        continue;
      }
      if (manual) {
        const outcome = manual.status === "single" && manual.selectedOptionIds.some((optionId) => answer.correctOptionIds.includes(optionId)) ? "correct" : manual.status === "single" ? "incorrect" : "blank";
        questionScores.push({ questionId: row.questionId, outcome, selectedOptionIds: manual.selectedOptionIds, source: "manual" });
        continue;
      }
      if (row.status === "single") {
        const outcome = row.selectedOptionIds.some((optionId) => answer.correctOptionIds.includes(optionId)) ? "correct" : "incorrect";
        questionScores.push({ questionId: row.questionId, outcome, selectedOptionIds: row.selectedOptionIds, source: "omr" });
      } else if (row.status === "blank") {
        questionScores.push({ questionId: row.questionId, outcome: "blank", selectedOptionIds: [], source: "omr" });
      } else {
        blockingIssues.push(`${row.status}:${row.questionId}`);
        questionScores.push({ questionId: row.questionId, outcome: "pending", selectedOptionIds: row.selectedOptionIds, source: "omr" });
      }
    }
  }

  const correct = questionScores.filter((item) => item.outcome === "correct").length;
  const blank = questionScores.filter((item) => item.outcome === "blank").length;
  const incorrect = questionScores.filter((item) => item.outcome === "incorrect").length;
  const pending = questionScores.filter((item) => item.outcome === "pending").length;
  if (pending > 0 || blockingIssues.length > 0) {
    return {
      computation: {
        submissionId: input.submissionId,
        batchId: input.batchId,
        examId: input.examId,
        ownerId: input.ownerId,
        answerKeyRevisionId: input.answerKeyRevisionId,
        templateRevisionId: input.templateRevisionId,
        state: "draft",
        questionScores,
        correct,
        blank,
        incorrect,
        pending,
        rawPoints: 0,
        score: 0,
        blockingIssues,
      },
      blockingIssues,
    };
  }

  const result = calculateTestScore({ correct, blank, incorrect, totalQuestions: questionScores.length }, input.policy);
  return {
    computation: {
      submissionId: input.submissionId,
      batchId: input.batchId,
      examId: input.examId,
      ownerId: input.ownerId,
      answerKeyRevisionId: input.answerKeyRevisionId,
      templateRevisionId: input.templateRevisionId,
      state: result.pending ? "draft" : "review",
      questionScores,
      correct,
      blank,
      incorrect,
      pending,
      rawPoints: result.rawPoints,
      score: result.score,
      blockingIssues,
    },
    blockingIssues,
  };
}
