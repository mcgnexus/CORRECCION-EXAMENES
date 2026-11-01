import type { ScoringPolicy } from "./schemas";

export const defaultScoringPolicy: ScoringPolicy = {
  schemaVersion: 1,
  policyId: "policy-default",
  scaleMax: 10,
  correctPoints: 1,
  blankPoints: 0,
  incorrectPenalty: -0.25,
  multipleMarkHandling: "count_once_as_error",
  minimumScore: 0,
  decimals: 2,
  sections: [],
  confirmed: false,
};
