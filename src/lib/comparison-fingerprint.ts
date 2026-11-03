import { createHash } from "node:crypto";

type FingerprintReading = {
  etag: string;
  value: {
    readingId: string;
    status?: string;
    rows: Array<{ questionId: string; status: string; selectedOptionIds: string[]; requiresHumanReview: boolean }>;
  };
};

export function comparisonFingerprint(answerKeyRevisionId: string, readings: FingerprintReading[]) {
  const canonical = [...readings]
    .sort((a, b) => a.value.readingId.localeCompare(b.value.readingId))
    .map(({ value, etag }) => ({ readingId: value.readingId, etag, rows: value.rows.map((row) => ({ questionId: row.questionId, status: row.status, selectedOptionIds: [...row.selectedOptionIds].sort(), requiresHumanReview: row.requiresHumanReview })) }));
  return createHash("sha256").update(JSON.stringify({ answerKeyRevisionId, readings: canonical })).digest("hex");
}
