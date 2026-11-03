import { list, get, put } from "@vercel/blob";
import { mkdirSync, writeFileSync } from "node:fs";

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) throw new Error("Falta BLOB_READ_WRITE_TOKEN");
const apply = process.argv.includes("--apply");
const examId = "182c31fe-2d0b-46c0-84f3-e9a8756f9ee6";
const batchId = "93f0a1a0-8b6b-4a32-94c9-905c516922ed";
const answerKeyPath = `owners/ACPL/exams/${examId}/answer-keys/310d4acb-ddfd-499d-9ca6-46ab045a8311/manifest.json`;
const structurePath = `owners/ACPL/exams/${examId}/phase2/structure/544bdec7-04e2-48bc-9221-5adeeb7b5571.json`;

const paths = [];
let cursor;
do {
  const res = await list({ token, limit: 1000, cursor });
  paths.push(...res.blobs.map((b) => b.pathname));
  cursor = res.hasMore ? res.cursor : undefined;
} while (cursor);

async function readBlob(pathname) {
  const result = await get(pathname, { token, access: "private", useCache: false });
  if (!result || result.statusCode !== 200) throw new Error(`No se pudo leer ${pathname}`);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(await new Response(result.stream).arrayBuffer())));
}
async function backup(pathname, value) {
  mkdirSync(".backup/close-409", { recursive: true });
  writeFileSync(`.backup/close-409/${pathname.replaceAll("/", "__")}`, JSON.stringify(value, null, 2));
}

const structure = await readBlob(structurePath);
const questions = structure.proposal?.questions ?? structure.questions ?? [];
const uuidToNumber = new Map(questions.map((q) => [q.questionId, String(q.number)]));
if (uuidToNumber.size !== 50) throw new Error(`Estructura inesperada: ${uuidToNumber.size} preguntas`);
console.log("mapeo uuid->numero:", uuidToNumber.size);

const key = await readBlob(answerKeyPath);
const rekeyed = {};
for (const [uuid, decision] of Object.entries(key.decisions)) {
  const number = uuidToNumber.get(uuid);
  if (!number) throw new Error(`Sin mapeo para ${uuid}`);
  rekeyed[number] = { ...decision, questionId: number };
}
console.log("decisiones re-clave:", Object.keys(rekeyed).length);

const submissions = paths.filter((p) => p.includes(`batches/${batchId}/submissions/`) && p.endsWith("manifest.json"));
console.log("entregas en el lote:", submissions.length);
for (const path of submissions) {
  const submission = await readBlob(path);
  const readings = await Promise.all((submission.readingIds ?? []).map(async (id) => {
    const readingPath = paths.find((p) => p.includes(`omr-readings/${id}`));
    return { id, readingPath, value: readingPath ? await readBlob(readingPath) : null };
  }));
  const stale = readings.filter((r) => r.value && r.value.rows.some((row) => !/^\d+$/.test(row.questionId)));
  const fresh = readings.filter((r) => r.value && r.value.rows.every((row) => /^\d+$/.test(row.questionId)));
  console.log(path.split("/").slice(-2)[0], "lecturas:", readings.map((r) => `${r.id.slice(0, 8)}(${r.value ? r.value.rows.length + " filas" : "falta"})`).join(" "), stale.length ? "· obsoletas: " + stale.map((r) => r.id.slice(0, 8)).join(",") : "· ok");
  if (!apply) continue;
  if (stale.length) {
    const updated = { ...submission, readingIds: fresh.map((r) => r.id) };
    await backup(path, submission);
    await put(path, JSON.stringify(updated), { token, access: "private", contentType: "application/json", allowOverwrite: true });
  }
}

if (apply) {
  await backup(answerKeyPath, key);
  await put(answerKeyPath, JSON.stringify({ ...key, decisions: rekeyed }), { token, access: "private", contentType: "application/json", allowOverwrite: true });
  console.log("APLICADO: solucionario re-clavado y lecturas obsoletas eliminadas.");
  console.log("Siguiente paso en la app: selecciona cada entrega y pulsa «Puntuar entrega» y luego «Cerrar entrega».");
} else {
  console.log("DRY-RUN: sin cambios. Ejecuta con --apply para aplicar.");
}
