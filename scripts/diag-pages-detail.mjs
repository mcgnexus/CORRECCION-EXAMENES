import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = readFileSync(".env.local", "utf8");
const read = (k) => env.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?`, "m"))?.[1];
const client = createClient(read("NEXT_PUBLIC_SUPABASE_URL"), read("SUPABASE_SECRET_KEY"), { auth: { persistSession: false } });
const examId = "93e6944a-db50-4919-9535-3fca2eda8fca";
const ownerId = "ACPL";

async function getJson(path) {
  const { data, error } = await client.rpc("app_object_get", { p_path: path });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data);
  return row ? { etag: row.etag, value: JSON.parse(Buffer.from(row.body_base64, "base64").toString("utf8")) } : null;
}

const pages = await getJson(`owners/${ownerId}/exams/${examId}/pages/manifest.json`);
const m = pages.value;
console.log("pages updatedAt:", m.updatedAt, "· updatedAtEtag:", m.updatedAtEtag ?? "-", "· revisionEtag:", m.revisionEtag ?? "-");
console.log("páginas:", (m.pages ?? []).length);
for (const p of (m.pages ?? []).slice(0, 30)) console.log(" ", p.pageId?.slice(0,8), "asset:", p.assetId?.slice(0,8), "orden:", p.order ?? p.index, "rot:", p.rotation ?? 0, "recorte:", p.crop ? "sí" : "no");
const rev = await getJson(`owners/${ownerId}/exams/${examId}/revisions/8f3d5703-7da9-4ea4-a777-4288f7f4978b/manifest.json`);
console.log("revisión createdAt:", rev.value.createdAt, "· updatedAt:", rev.value.updatedAt);
