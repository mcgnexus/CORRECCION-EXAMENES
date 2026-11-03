import { list, get } from "@vercel/blob";

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) throw new Error("Falta BLOB_READ_WRITE_TOKEN");
const submissionId = process.argv[2] ?? "7a416039-f11a-47c8-a997-f49933e45eef";

const blobs = [];
let cursor;
do {
  const res = await list({ token, limit: 1000, cursor });
  blobs.push(...res.blobs.map((b) => b.pathname));
  cursor = res.cursor && res.hasMore ? res.cursor : undefined;
} while (cursor);
console.log("total blobs:", blobs.length);

const submissionPath = blobs.find((p) => p.includes(submissionId) && p.endsWith(".json"));
console.log("submission blob:", submissionPath ?? "(no encontrado)");
if (!submissionPath) process.exit(0);

async function fetchBlob(pathname) {
  const result = await get(pathname, { token, access: "private", useCache: false });
  if (!result || result.statusCode !== 200) throw new Error(`No se pudo leer ${pathname}`);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(await new Response(result.stream).arrayBuffer())));
}

const submission = await fetchBlob(submissionPath);
console.log("submission:", JSON.stringify({ state: submission.state, confirmedIdentity: submission.confirmedIdentity, readingIds: submission.readingIds, responseBlockingIssues: (submission.responseBlockingIssues ?? []).slice(0, 5), snapshotId: submission.snapshotId ?? null }, null, 1));

for (const readingId of submission.readingIds ?? []) {
  const path = blobs.find((p) => p.includes(`omr-readings/${readingId}`));
  if (!path) { console.log("lectura no encontrada:", readingId); continue; }
  const reading = await fetchBlob(path);
  const ids = (reading.rows ?? []).map((r) => r.questionId);
  console.log("lectura", readingId, "estado:", reading.status, "error:", reading.errorCode ?? "-", "filas:", ids.length);
  console.log("  questionIds OMR:", ids.join(","));
}

const examId = submissionPath.split("/exams/")[1]?.split("/")[0];
const ownerPrefix = submissionPath.split("/exams/")[0];
console.log("examId:", examId);
const answerKeyPaths = blobs.filter((p) => p.startsWith(`${ownerPrefix}/exams/${examId}/`) && p.includes("answer-keys") && p.endsWith(".json"));
console.log("answer-key blobs:", answerKeyPaths.length);
for (const path of answerKeyPaths) {
  const key = await fetchBlob(path);
  const decisionIds = Object.keys(key.decisions ?? {});
  console.log("answer-key", path);
  console.log("  estado:", key.status, "decisiones:", decisionIds.length);
  console.log("  questionIds key:", decisionIds.join(","));
  const first = key.decisions?.[decisionIds[0]];
  console.log("  muestra:", JSON.stringify(first));
}
