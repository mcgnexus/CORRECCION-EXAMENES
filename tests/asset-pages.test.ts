import { describe, expect, it } from "vitest";
import { AssetRepository } from "../src/repositories/asset-repository";
import { DocumentPagesRepository } from "../src/repositories/document-pages-repository";
import { MemoryBlobStore } from "../src/repositories/blob-store";

const baseAsset = {
  assetId: "asset-1",
  ownerId: "owner-1",
  examId: "exam-1",
  kind: "original" as const,
  state: "validated" as const,
  origin: "upload" as const,
  sha256: "a".repeat(64),
  mimeType: "application/pdf",
  blobPath: "owners/owner-1/exams/exam-1/assets/asset-1/original",
  sizeBytes: 10,
  pageCount: 2,
};

describe("assets y páginas", () => {
  it("crea el asset una vez y añade sus páginas con orden estable", async () => {
    const store = new MemoryBlobStore();
    const assets = new AssetRepository(store);
    const pages = new DocumentPagesRepository(store);
    const asset = await assets.create(baseAsset);
    const first = await pages.appendAssetPages(asset);
    const second = await pages.appendAssetPages(asset);
    expect(first.manifest.pages).toHaveLength(2);
    expect(second.manifest.pages).toHaveLength(2);
    expect(second.manifest.pages.map((page) => page.order)).toEqual([0, 1]);
    const replay = await assets.create(baseAsset);
    expect(replay.assetId).toBe(asset.assetId);
  });

  it("inicializa el manifiesto una sola vez aunque lleguen peticiones concurrentes", async () => {
    const store = new MemoryBlobStore();
    const pages = new DocumentPagesRepository(store);
    const [first, second] = await Promise.all([pages.initialize("owner-1", "exam-1"), pages.initialize("owner-1", "exam-1")]);
    expect(first.etag).toBe(second.etag);
    const stored = await pages.getWithMeta("owner-1", "exam-1");
    expect(stored?.manifest.pages).toHaveLength(0);
    expect((await store.list("owners/owner-1/exams/exam-1/pages/")).length).toBe(1);
  });

  it("rechaza una actualización con ETag obsoleto", async () => {
    const store = new MemoryBlobStore();
    const assets = new AssetRepository(store);
    const pages = new DocumentPagesRepository(store);
    const asset = await assets.create(baseAsset);
    const current = await pages.appendAssetPages(asset);
    await expect(pages.replace("owner-1", "exam-1", '"stale"', current.manifest.pages, [])).rejects.toMatchObject({ code: "ETAG_CONFLICT" });
  });

  it("elimina páginas y referencias de grupos al borrar el asset", async () => {
    const store = new MemoryBlobStore();
    const assets = new AssetRepository(store);
    const pages = new DocumentPagesRepository(store);
    const asset = await assets.create(baseAsset);
    const current = await pages.appendAssetPages(asset);
    const grouped = await pages.replace("owner-1", "exam-1", current.etag, current.manifest.pages, [{ schemaVersion: 1, groupId: "group-1", examId: "exam-1", ownerId: "owner-1", label: "Entrega", pageIds: current.manifest.pages.map((page) => page.pageId) }]);
    const result = await pages.removeAssetPages("owner-1", "exam-1", asset.assetId);
    expect(grouped.manifest.groups).toHaveLength(1);
    expect(result?.manifest.pages).toHaveLength(0);
    expect(result?.manifest.groups).toHaveLength(0);
  });
});
