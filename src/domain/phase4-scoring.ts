import { calculateWeightedScore } from "./scoring";
import type { ScoringPolicy } from "./schemas";
import type { OpenQuestionScore } from "./phase4-schemas";
import type { ScoreComputation } from "./phase3-scoring";

export function computeMixedScore(input: { base: ScoreComputation; openQuestionScores: OpenQuestionScore[]; policy: ScoringPolicy; openPending?: number; blockingIssues?: string[] }) {
  const openPending = input.openPending ?? 0;
  const blockingIssues = [...input.base.blockingIssues, ...(input.blockingIssues ?? [])];
  const openPoints = input.openQuestionScores.reduce((sum, item) => sum + item.points, 0);
  const openMaximumPoints = input.openQuestionScores.reduce((sum, item) => sum + item.maximumPoints, 0);
  if (openPending > 0 || blockingIssues.length > 0) {
    return { ...input.base, state: "draft" as const, openQuestionScores: input.openQuestionScores, openPoints, openMaximumPoints, openPending, blockingIssues, rawPoints: 0, score: 0 };
  }
  if (input.openQuestionScores.length === 0) return { ...input.base, openQuestionScores: [], openPoints: 0, openMaximumPoints: 0, openPending: 0 };
  if (input.policy.sections.length === 0) {
    const result = calculateWeightedScore([{ section: { sectionId: "open", maxPoints: openMaximumPoints, weightBasisPoints: 10_000, kind: "open" }, earnedPoints: openPoints }], input.policy);
    return { ...input.base, state: "review" as const, openQuestionScores: input.openQuestionScores, openPoints, openMaximumPoints, openPending: 0, rawPoints: result.rawPoints, score: result.score, blockingIssues: [] };
  }
  const sections = input.policy.sections.map((section) => {
    if (section.kind === "open") {
      const points = input.openQuestionScores.filter((item) => item.sectionId === section.sectionId).reduce((sum, item) => sum + item.points, 0);
      return { section, earnedPoints: points };
    }
    const earned = input.base.correct * input.policy.correctPoints + input.base.incorrect * input.policy.incorrectPenalty + input.base.blank * input.policy.blankPoints;
    return { section, earnedPoints: Math.max(0, Math.min(section.maxPoints, earned)) };
  });
  const result = calculateWeightedScore(sections, input.policy);
  return { ...input.base, state: "review" as const, openQuestionScores: input.openQuestionScores, openPoints, openMaximumPoints, openPending: 0, rawPoints: result.rawPoints, score: result.score, blockingIssues: [] };
}
