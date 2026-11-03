import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = readFileSync(".env.local", "utf8");
const read = (k) => env.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?`, "m"))?.[1];
const url = read("NEXT_PUBLIC_SUPABASE_URL");
const key = read("SUPABASE_SECRET_KEY");
if (!url || !key) throw new Error("Faltan credenciales Supabase");

const examId = process.argv[2] ?? "93e6944a-db50-4919-9535-3fca2eda8fca";
const ownerId = "ACPL";

const client = createClient(url, key, { auth: { persistSession: false } });

async function getJson(path) {
  const { data, error } = await client.rpc("app_object_get", { p_path: path });
  if (error) throw new Error(`${path}: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data);
  if (!row) return null;
  return { etag: row.etag, value: JSON.parse(Buffer.from(row.body_base64, "base64").toString("utf8")) };
}
async function list(prefix) {
  const { data, error } = await client.rpc("app_object_list", { p_prefix: prefix });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.path);
}

const exam = await getJson(`owners/${ownerId}/exams/${examId}/manifest.json`);
console.log("examen:", exam ? JSON.stringify({ activeRevisionId: exam.value.activeRevisionId, etag: exam.etag }) : "NO ENCONTRADO");
if (!exam?.value.activeRevisionId) { console.log("=> Causa probable: ANSWER_KEY_REQUIRED (no hay revisión activa)"); process.exit(0); }

const revId = exam.value.activeRevisionId;
const revision = await getJson(`owners/${ownerId}/exams/${examId}/revisions/${revId}/manifest.json`);
console.log("revisión:", revision ? JSON.stringify({ answerKeyRevisionId: revision.value.answerKeyRevisionId, pagesManifestEtag: revision.value.pagesManifestEtag }) : "NO ENCONTRADA");

const pages = await getJson(`owners/${ownerId}/exams/${examId}/pages/manifest.json`).catch(() => null);
console.log("páginas etag real:", pages?.etag ?? "NO ENCONTRADO", "· en revisión:", revision?.value.pagesManifestEtag ?? "-");
console.log("etags iguales:", pages?.etag === revision?.value.pagesManifestEtag);

const keyId = revision?.value.answerKeyRevisionId;
if (keyId) {
  const answerKey = await getJson(`owners/${ownerId}/exams/${examId}/answer-keys/${keyId}/manifest.json`);
  console.log("answer-key:", answerKey ? JSON.stringify({ status: answerKey.value.status, decisiones: Object.keys(answerKey.value.decisions ?? {}).length }) : "NO ENCONTRADA");
} else {
  console.log("answer-key: (revisión sin answerKeyRevisionId)");
}

const templates = await list(`owners/${ownerId}/exams/${examId}/omr-templates/`);
console.log("plantillas existentes:", templates.length, templates.slice(0, 5));

const checks = [
  ["activeRevisionId", !!exam.value.activeRevisionId],
  ["revisión existe", !!revision],
  ["etags páginas coinciden", pages?.etag === revision?.value.pagesManifestEtag],
  ["answerKey existe", !!keyId],
  ["answerKey aprobada", !!(await keyId && getJson(`owners/${ownerId}/exams/${examId}/answer-keys/${keyId}/manifest.json`).then(k => k?.value.status === "approved"))],
];
const failing = checks.filter(([, ok]) => !ok).map(([n]) => n);
console.log(failing.length ? "=> FALLAN: " + failing.join(", ") + " (ANSWER_KEY_STALE)" : "=> Todo válido: el 409 vendría de otra cosa");
