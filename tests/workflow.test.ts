import { describe, expect, it } from "vitest";
import { phase0Workflow } from "../src/workflows/phase0-workflow";

describe("workflow de Fase 0", () => {
  it("conserva el resultado de los dos pasos en ejecución local", async () => {
    await expect(phase0Workflow({ ownerId: "ACPL", failSecondStep: false })).resolves.toEqual({
      ownerId: "ACPL",
      firstStep: "first-step-completed",
      secondStep: "second-step-completed",
    });
  });

  it("expone un fallo sintético en el segundo paso", async () => {
    await expect(phase0Workflow({ ownerId: "ACPL", failSecondStep: true })).rejects.toThrow("synthetic-second-step-failure");
  });
});
