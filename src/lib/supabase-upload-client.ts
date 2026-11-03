"use client";

import { getSupabaseBrowser } from "./supabase-browser";

export async function uploadExamAsset(input: { pathname: string; file: File; authorizeUrl: string }) {
  const authorization = await fetch(input.authorizeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pathname: input.pathname, contentType: input.file.type, sizeBytes: input.file.size }),
  });
  const payload = await authorization.json() as {
    data?: { bucket: string; path: string; token: string };
    error?: { message?: string };
  };
  if (!authorization.ok || !payload.data) throw new Error(payload.error?.message ?? "No se pudo autorizar la subida.");

  const { error } = await getSupabaseBrowser()
    .storage
    .from(payload.data.bucket)
    .uploadToSignedUrl(payload.data.path, payload.data.token, input.file, { contentType: input.file.type });
  if (error) throw new Error("Supabase no pudo recibir el archivo.");
  return { pathname: input.pathname };
}
