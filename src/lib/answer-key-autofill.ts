import type { Rubric } from "@/domain/schemas";
import type { SolutionProposal, StructureProposal } from "@/domain/phase2-schemas";

const OPEN_TYPES = new Set(["short_text", "essay", "calculation", "drawing", "mixed"]);

export function sectionForQuestion(question: StructureProposal["questions"][number]) {
  return OPEN_TYPES.has(question.type) ? "open" : "test";
}

export function normalizeSelection(answer: unknown, options: Array<{ label: string; text: string }>) {
  const raw = Array.isArray(answer)
    ? answer
    : answer && typeof answer === "object" && Array.isArray((answer as { selectedOptionIds?: unknown }).selectedOptionIds)
      ? (answer as { selectedOptionIds: unknown[] }).selectedOptionIds
      : typeof answer === "string"
        ? [answer]
        : [];
  const labels = options.map((option) => option.label);
  const values = raw.map((item) => {
    const text = String(item ?? "").trim();
    const byLabel = labels.find((label) => label.toLowerCase() === text.toLowerCase());
    if (byLabel) return byLabel;
    const byText = options.find((option) => option.text.trim().toLowerCase() === text.toLowerCase());
    return byText?.label ?? text;
  }).filter((label) => labels.includes(label));
  return [...new Set(values)];
}

export function rubricFor(questionId: string, maxPoints: number): Rubric {
  return {
    criteria: [{ id: `criterion-${questionId}`, description: "Respuesta correcta y completa.", maxPoints, requiredEvidence: "Contenido de la respuesta del alumno.", validAlternatives: [], partialScoring: "Proporcional a los elementos correctos.", commonErrors: [], dependsOnCriterionIds: [] }],
    totalMax: maxPoints,
  };
}

export function pickSolution(questionId: string, solutions: SolutionProposal[], preferred?: "gemini" | "deepseek") {
  const candidates = solutions.filter((solution) => solution.questionId === questionId);
  if (candidates.length === 0) return null;
  if (preferred) {
    const match = candidates.find((solution) => solution.provider === preferred);
    if (match) return match;
  }
  return [...candidates].sort((a, b) => b.confidence - a.confidence || (a.provider === "gemini" ? -1 : 1))[0];
}
