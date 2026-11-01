import type { ScoringPolicy, ScoringSection } from "./schemas";

const SCORE_SCALE = 100;
const WEIGHT_SCALE = 10_000;

export type TestOutcome = "correct" | "blank" | "incorrect" | "multiple" | "ambiguous" | "unreadable";

export type TestScoreInput = {
  correct: number;
  blank: number;
  incorrect: number;
  pending?: number;
  totalQuestions: number;
};

export type ScoreResult = {
  rawPoints: number;
  maximumPoints: number;
  score: number;
  scoreScaled: number;
  pending: boolean;
};

export class PendingScoringError extends Error {
  constructor(message = "La puntuacion tiene incidencias pendientes.") {
    super(message);
    this.name = "PendingScoringError";
  }
}

export class InvalidScoringInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidScoringInputError";
  }
}

function assertNonNegativeInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidScoringInputError(`${name} debe ser un entero no negativo.`);
  }
}

function roundHalfUp(numerator: number, denominator: number) {
  if (denominator <= 0) throw new InvalidScoringInputError("El denominador debe ser positivo.");
  return Math.floor((numerator + denominator / 2) / denominator);
}

function applyMinimum(scoreScaled: number, policy: ScoringPolicy) {
  const minimum = policy.minimumScore === undefined ? undefined : Math.round(policy.minimumScore * 10 ** policy.decimals);
  return minimum === undefined ? scoreScaled : Math.max(scoreScaled, minimum);
}

export function calculateTestScore(input: TestScoreInput, policy: ScoringPolicy): ScoreResult {
  assertNonNegativeInteger(input.correct, "correct");
  assertNonNegativeInteger(input.blank, "blank");
  assertNonNegativeInteger(input.incorrect, "incorrect");
  assertNonNegativeInteger(input.pending ?? 0, "pending");
  assertNonNegativeInteger(input.totalQuestions, "totalQuestions");
  const counted = input.correct + input.blank + input.incorrect + (input.pending ?? 0);
  if (counted !== input.totalQuestions) {
    throw new InvalidScoringInputError("Las respuestas no suman el total de preguntas.");
  }
  const pending = (input.pending ?? 0) > 0;
  if (pending) return { rawPoints: 0, maximumPoints: input.totalQuestions, score: 0, scoreScaled: 0, pending: true };

  const correctScaled = Math.round(policy.correctPoints * SCORE_SCALE);
  const incorrectScaled = Math.round(policy.incorrectPenalty * SCORE_SCALE);
  const blankScaled = Math.round(policy.blankPoints * SCORE_SCALE);
  const rawPointsScaled = input.correct * correctScaled + input.incorrect * incorrectScaled + input.blank * blankScaled;
  const maximumPointsScaled = input.totalQuestions * correctScaled;
  if (maximumPointsScaled <= 0) throw new InvalidScoringInputError("El examen debe tener preguntas puntuables.");

  const multiplier = 10 ** policy.decimals;
  const scoreScaled = applyMinimum(roundHalfUp(rawPointsScaled * policy.scaleMax * multiplier, maximumPointsScaled), policy);
  return {
    rawPoints: rawPointsScaled / SCORE_SCALE,
    maximumPoints: maximumPointsScaled / SCORE_SCALE,
    score: scoreScaled / multiplier,
    scoreScaled,
    pending: false,
  };
}

export type SectionScore = {
  sectionId: string;
  earnedPoints: number;
  maximumPoints: number;
  scoreOnScale: number;
  weightBasisPoints: number;
};

export function calculateWeightedScore(
  sections: Array<{ section: ScoringSection; earnedPoints: number }>,
  policy: ScoringPolicy,
): ScoreResult {
  const weightSum = sections.reduce((sum, item) => sum + item.section.weightBasisPoints, 0);
  if (weightSum !== WEIGHT_SCALE) throw new InvalidScoringInputError("Los pesos de las secciones deben sumar 10000.");
  if (sections.length === 0) throw new InvalidScoringInputError("Debe existir al menos una seccion.");

  const sectionScores: SectionScore[] = sections.map(({ section, earnedPoints }) => {
    if (!Number.isFinite(earnedPoints) || earnedPoints < 0 || earnedPoints > section.maxPoints) {
      throw new InvalidScoringInputError(`Puntuacion invalida en ${section.sectionId}.`);
    }
    const scoreOnScale = (earnedPoints / section.maxPoints) * policy.scaleMax;
    return { sectionId: section.sectionId, earnedPoints, maximumPoints: section.maxPoints, scoreOnScale, weightBasisPoints: section.weightBasisPoints };
  });

  const multiplier = 10 ** policy.decimals;
  const weightedNumerator = sectionScores.reduce((sum, section) => sum + section.scoreOnScale * section.weightBasisPoints, 0);
  const scoreScaled = applyMinimum(Math.round((weightedNumerator / WEIGHT_SCALE) * multiplier), policy);
  return {
    rawPoints: sectionScores.reduce((sum, section) => sum + section.earnedPoints, 0),
    maximumPoints: sectionScores.reduce((sum, section) => sum + section.maximumPoints, 0),
    score: scoreScaled / multiplier,
    scoreScaled,
    pending: false,
  };
}
