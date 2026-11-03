import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const env = readFileSync(".env.local", "utf8");
const read = (k) => env.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?`, "m"))?.[1];
const client = createClient(read("NEXT_PUBLIC_SUPABASE_URL"), read("SUPABASE_SECRET_KEY"), { auth: { persistSession: false } });
const apply = process.argv.includes("--apply");
const examId = process.argv.find((a, i) => i >= 2 && a !== "--apply") ?? "93e6944a-db50-4919-9535-3fca2eda8fca";
const ownerId = "ACPL";

async function getJson(path) {
  const { data, error } = await client.rpc("app_object_get", { p_path: path });
  if (error) throw new Error(`${path}: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data);
  return row ? { etag: row.etag, value: JSON.parse(Buffer.from(row.body_base64, "base64").toString("utf8")) } : null;
}

const exam = await getJson(`owners/${ownerId}/exams/${examId}/manifest.json`);
if (!exam?.value.activeRevisionId) throw new Error("El examen no tiene revisión activa");
const revId = exam.value.activeRevisionId;
const revPath = `owners/${ownerId}/exams/${examId}/revisions/${revId}/manifest.json`;
const pagesPath = `owners/${ownerId}/exams/${examId}/pages/manifest.json`;
const [revision, pages] = await Promise.all([getJson(revPath), getJson(pagesPath)]);
if (!revision || !pages) throw new Error("Faltan revisión o páginas");

console.log("revision.pagesManifestEtag:", revision.value.pagesManifestEtag);
console.log("pages etag actual:        ", pages.etag);
if (revision.value.pagesManifestEtag === pages.etag) { console.log("Ya sincronizados; nada que hacer."); process.exit(0); }

const summarize = (m) => JSON.stringify((m.pages ?? []).map((p) => [p.pageId, p.order, p.rotation, p.sourceAssetId]));
const snapshot = { pagesPath, revisionPath: revPath, prevRevision: revision.value };
if (!apply) {
  console.log("DRY-RUN. Contenido páginas:", summarize(pages.value).slice(0, 200), "...");
  console.log("Ejecuta con --apply para copiar el etag actual a la revisión.");
  process.exit(0);
}

mkdirSync(".backup/pages-etag", { recursive: true });
writeFileSync(`.backup/pages-etag/${revId}.json`, JSON.stringify(snapshot, null, 2));
const updated = { ...revision.value, pagesManifestEtag: pages.etag, updatedAt: new Date().toISOString() };
const { error } = await client.rpc("app_object_put_json", {
  p_path: revPath,
  p_body_base64: Buffer.from(JSON.stringify(updated)).toString("base64"),
  p_content_type: "application/json",
  p_if_match: revision.etag,
  p_if_none_match: false,
});
if (error) throw new Error(error.message);
console.log("APLICADO: revisión sincronizada con el manifiesto de páginas actual.");
