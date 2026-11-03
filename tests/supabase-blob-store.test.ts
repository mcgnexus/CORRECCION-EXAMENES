import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  createSignedUploadUrl: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    rpc: mocks.rpc,
    storage: { from: () => ({ upload: mocks.upload, download: mocks.download, remove: mocks.remove, createSignedUploadUrl: mocks.createSignedUploadUrl }) },
  }),
  getSupabaseStorageBucket: () => "exam-objects",
}));

import { SupabaseBlobStore } from "@/repositories/supabase-blob-store";

describe("SupabaseBlobStore", () => {
  beforeEach(() => vi.clearAllMocks());

  it("guarda JSON mediante RPC con condiciones de ETag", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ etag: '"next"' }], error: null });
    const store = new SupabaseBlobStore();
    const body = new TextEncoder().encode('{"state":"draft"}');

    const saved = await store.put("owners/a/exams/b/manifest.json", body, "application/json", { ifMatch: '"previous"' });

    expect(mocks.rpc).toHaveBeenCalledWith("app_object_put_json", expect.objectContaining({
      p_path: "owners/a/exams/b/manifest.json",
      p_body_base64: Buffer.from(body).toString("base64"),
      p_if_match: '"previous"',
      p_if_none_match: false,
    }));
    expect(saved.etag).toBe('"next"');
  });

  it("devuelve el JSON indexado y su ETag", async () => {
    const body = Buffer.from('{"state":"ready"}');
    mocks.rpc.mockResolvedValue({ data: [{ body_base64: body.toString("base64"), content_type: "application/json", etag: '"abc"', is_binary: false }], error: null });
    const stored = await new SupabaseBlobStore().get("owners/a/manifest.json");

    expect(new TextDecoder().decode(stored?.body)).toBe('{"state":"ready"}');
    expect(stored?.etag).toBe('"abc"');
  });

  it("convierte conflictos CAS de PostgreSQL a 409 de aplicación", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "ETAG_CONFLICT" } });
    await expect(new SupabaseBlobStore().put("owners/a/manifest.json", new Uint8Array(), "application/json", { ifMatch: '"old"' }))
      .rejects.toMatchObject({ code: "ETAG_CONFLICT", status: 409 });
  });
});
