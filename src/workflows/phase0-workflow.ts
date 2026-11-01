export type Phase0WorkflowInput = {
  ownerId: string;
  failSecondStep: boolean;
};

export type Phase0WorkflowResult = {
  ownerId: string;
  firstStep: string;
  secondStep: string;
};

export async function phase0Workflow(input: Phase0WorkflowInput): Promise<Phase0WorkflowResult> {
  "use workflow";
  const firstStep = await recordPhase0Step(input.ownerId);
  const secondStep = await verifyPhase0Step(input.failSecondStep);
  return { ownerId: input.ownerId, firstStep, secondStep };
}

async function recordPhase0Step(ownerId: string) {
  "use step";
  if (!ownerId) throw new Error("ownerId es obligatorio");
  return "first-step-completed";
}

async function verifyPhase0Step(shouldFail: boolean) {
  "use step";
  if (shouldFail) throw new Error("synthetic-second-step-failure");
  return "second-step-completed";
}
