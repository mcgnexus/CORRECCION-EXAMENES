import type { z } from "zod";
import { examStateSchema } from "./schemas";

export type ExamState = z.infer<typeof examStateSchema>;

const transitions: Record<ExamState, readonly ExamState[]> = {
  draft: ["extracting"],
  extracting: ["structure_review"],
  structure_review: ["solving"],
  solving: ["key_review"],
  key_review: ["approved"],
  approved: [],
};

export class InvalidExamTransitionError extends Error {
  constructor(from: ExamState, to: ExamState) {
    super(`Transición de examen no permitida: ${from} -> ${to}.`);
    this.name = "InvalidExamTransitionError";
  }
}

export function canTransitionExam(from: ExamState, to: ExamState) {
  return transitions[from].includes(to);
}

export function transitionExam(from: ExamState, to: ExamState): ExamState {
  if (!canTransitionExam(from, to)) throw new InvalidExamTransitionError(from, to);
  return to;
}
