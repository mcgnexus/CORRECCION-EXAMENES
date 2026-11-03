import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = readFileSync(".env.local", "utf8");
const read = (k) => env.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?`, "m"))?.[1];
const client = createClient(read("NEXT_PUBLIC_SUPABASE_URL"), read("SUPABASE_SECRET_KEY"), { auth: { persistSession: false } });
const path = "owners/ACPL/exams/93e6944a-db50-4919-9535-3fca2eda8fca/manifest.json";
for (let i = 0; i < 3; i++) {
  const { data, error } = await client.rpc("app_object_get", { p_path: path });
  console.log(`intento ${i + 1} · error:`, error?.message ?? "ninguno", "· data tipo:", Array.isArray(data) ? "array" : typeof data, "· valor:", data === null ? "null" : JSON.stringify(data).slice(0, 120));
  await new Promise((r) => setTimeout(r, 1500));
}
