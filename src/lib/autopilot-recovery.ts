export const AUTOPILOT_STUCK_THRESHOLD_MS = 10 * 60 * 1000;

export function autopilotProgressPath(ownerId: string, examId: string, revisionId: string) {
  return `owners/${ownerId}/exams/${examId}/revisions/${revisionId}/progress.json`;
}

export function latestAutopilotProgressAt(...timestamps: Array<string | null | undefined>) {
  const values = timestamps
    .map((value) => (typeof value === "string" ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value));
  return values.length > 0 ? Math.max(...values) : null;
}

export function isAutopilotStuck(timestamps: Array<string | null | undefined>, now = Date.now()) {
  const latest = latestAutopilotProgressAt(...timestamps);
  return latest !== null && now - latest > AUTOPILOT_STUCK_THRESHOLD_MS;
}
