import type { z } from "zod";
import { examStateSchema } from "./schemas";

export type ExamState = z.infer<typeof examStateSchema>;

const transitions: Record<ExamState, readonly ExamState[]> = {
  draft: ["extracting"],
  extracting: ["structure_review", "draft"],
  structure_review: ["solving", "extracting", "draft"],
  solving: ["key_review", "extracting", "draft"],
  key_review: ["approved"],
  approved: ["extracting"],
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
