import { describe, expect, it } from "vitest";
import { normalizeSelection, pickSolution, rubricFor, sectionForQuestion } from "../src/lib/answer-key-autofill";
import type { SolutionProposal, StructureProposal } from "../src/domain/phase2-schemas";

const options = [{ id: "o1", label: "A", text: "Uno" }, { id: "o2", label: "B", text: "Dos" }];
const question = (overrides: Partial<StructureProposal["questions"][number]> = {}) => ({ questionId: "q1", number: 1, label: "1", type: "single_choice" as const, text: "Pregunta", options, pageIds: ["page-1"], figureIds: [], dependsOnQuestionIds: [], flags: [], ...overrides });
const solution = (overrides: Partial<SolutionProposal> = {}) => ({ schemaVersion: 1 as const, solutionProposalId: "sol-1", examRevisionId: "rev-1", questionId: "q1", provider: "gemini" as const, model: "gemini-test", reviewScope: "text_and_visual" as const, answer: { selectedOptionIds: ["A"] }, explanation: "Porque sí.", alternatives: [], confidence: 0.9, doubts: [], sourceEvidenceIds: [], sourceMissing: false, rawOutputRef: "sol-1", createdAt: new Date().toISOString(), ...overrides });

describe("solucionario generado desde la IA", () => {
  it("normaliza etiquetas, textos y descarta opciones inexistentes", () => {
    expect(normalizeSelection({ selectedOptionIds: ["A"] }, options)).toEqual(["A"]);
    expect(normalizeSelection(["Dos"], options)).toEqual(["B"]);
    expect(normalizeSelection("b", options)).toEqual(["B"]);
    expect(normalizeSelection("Z", options)).toEqual([]);
    expect(normalizeSelection({ selectedOptionIds: ["A", "A"] }, options)).toEqual(["A"]);
  });

  it("asigna sección abierta o test según el tipo de pregunta", () => {
    expect(sectionForQuestion(question({ type: "essay" }))).toBe("open");
    expect(sectionForQuestion(question({ type: "short_text" }))).toBe("open");
    expect(sectionForQuestion(question({ type: "single_choice" }))).toBe("test");
  });

  it("prefiere el proveedor solicitado y si no la mayor confianza", () => {
    const gemini = solution({ confidence: 0.4 });
    const deepseek = solution({ solutionProposalId: "sol-2", provider: "deepseek", confidence: 0.95 });
    expect(pickSolution("q1", [gemini, deepseek])?.solutionProposalId).toBe("sol-2");
    expect(pickSolution("q1", [gemini, deepseek], "gemini")?.solutionProposalId).toBe("sol-1");
    expect(pickSolution("q2", [gemini, deepseek])).toBeNull();
  });

  it("crea una rúbrica de un criterio con el máximo indicado", () => {
    const rubric = rubricFor("q1", 2.5);
    expect(rubric.totalMax).toBe(2.5);
    expect(rubric.criteria).toHaveLength(1);
    expect(rubric.criteria[0].maxPoints).toBe(2.5);
  });
});
