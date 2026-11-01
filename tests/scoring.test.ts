import { describe, expect, it } from "vitest";
import { defaultScoringPolicy } from "../src/domain/defaults";
import { calculateTestScore, calculateWeightedScore, PendingScoringError } from "../src/domain/scoring";
import type { ScoringPolicy } from "../src/domain/schemas";

const policy: ScoringPolicy = { ...defaultScoringPolicy, confirmed: true };

describe("calculateTestScore", () => {
  it("aplica la formula confirmada de 50 preguntas", () => {
    expect(calculateTestScore({ correct: 50, incorrect: 0, blank: 0, totalQuestions: 50 }, policy).score).toBe(10);
    expect(calculateTestScore({ correct: 40, incorrect: 8, blank: 2, totalQuestions: 50 }, policy).score).toBe(7.6);
  });

  it("aplica el minimo cero despues de calcular la nota", () => {
    const result = calculateTestScore({ correct: 0, incorrect: 50, blank: 0, totalQuestions: 50 }, policy);
    expect(result.rawPoints).toBe(-12.5);
    expect(result.score).toBe(0);
  });

  it("mantiene una incidencia pendiente fuera de la puntuacion", () => {
    const result = calculateTestScore({ correct: 4, incorrect: 0, blank: 0, pending: 1, totalQuestions: 5 }, policy);
    expect(result.pending).toBe(true);
    expect(result.score).toBe(0);
  });
});

describe("calculateWeightedScore", () => {
  it("normaliza secciones y aplica pesos exactos", () => {
    const mixedPolicy: ScoringPolicy = {
      ...policy,
      sections: [
        { sectionId: "test", maxPoints: 50, weightBasisPoints: 6_000, kind: "test" },
        { sectionId: "open", maxPoints: 10, weightBasisPoints: 4_000, kind: "open" },
      ],
    };
    const result = calculateWeightedScore(
      [
        { section: mixedPolicy.sections[0], earnedPoints: 40 },
        { section: mixedPolicy.sections[1], earnedPoints: 8 },
      ],
      mixedPolicy,
    );
    expect(result.score).toBe(8);
  });
});

describe("reglas de cierre", () => {
  it("expone un error de dominio para incidencias pendientes disponibles al cierre", () => {
    expect(new PendingScoringError().name).toBe("PendingScoringError");
  });
});
