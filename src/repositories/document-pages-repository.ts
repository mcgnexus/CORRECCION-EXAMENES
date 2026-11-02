import { randomUUID } from "node:crypto";
import { documentPagesManifestSchema, type Asset, type DocumentGroup, type DocumentPage, type DocumentPagesManifest } from "../domain/schemas";
import { AppError } from "../lib/errors";
import type { BlobStore } from "./blob-store";

function pathFor(ownerId: string, examId: string) { return `owners/${ownerId}/exams/${examId}/pages/manifest.json`; }
function encode(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)); }
function decode<T>(body: Uint8Array) { return JSON.parse(new TextDecoder().decode(body)) as T; }

function validateReferences(ownerId: string, examId: string, pages: DocumentPage[], groups: DocumentGroup[]) {
  const pageIds = new Set<string>();
  const orders = new Set<number>();
  for (const page of pages) {
    if (page.ownerId !== ownerId || page.examId !== examId) throw new AppError("PAGE_SCOPE_MISMATCH", "La página no pertenece al examen.", 400);
    if (pageIds.has(page.pageId)) throw new AppError("DUPLICATE_PAGE", "La página aparece más de una vez.", 400);
    if (orders.has(page.order)) throw new AppError("DUPLICATE_PAGE_ORDER", "El orden de página está duplicado.", 400);
    pageIds.add(page.pageId);
    orders.add(page.order);
  }
  for (const group of groups) {
    if (group.ownerId !== ownerId || group.examId !== examId) throw new AppError("GROUP_SCOPE_MISMATCH", "El grupo no pertenece al examen.", 400);
    if (new Set(group.pageIds).size !== group.pageIds.length || group.pageIds.some((pageId) => !pageIds.has(pageId))) throw new AppError("INVALID_GROUP_PAGES", "El grupo referencia páginas inválidas.", 400);
  }
}

export class DocumentPagesRepository {
  constructor(private readonly blobs: BlobStore) {}

  async getWithMeta(ownerId: string, examId: string): Promise<{ manifest: DocumentPagesManifest; etag: string } | null> {
    const object = await this.blobs.get(pathFor(ownerId, examId));
    if (!object) return null;
    const parsed = documentPagesManifestSchema.safeParse(decode<DocumentPagesManifest>(object.body));
    if (!parsed.success || parsed.data.ownerId !== ownerId || parsed.data.examId !== examId) throw new AppError("INVALID_PAGE_MANIFEST", "El manifiesto de páginas no es válido.", 500);
    return { manifest: parsed.data, etag: object.etag };
  }

  async initialize(ownerId: string, examId: string) {
    const existing = await this.getWithMeta(ownerId, examId);
    if (existing) return existing;
    const manifest = documentPagesManifestSchema.parse({ schemaVersion: 1, ownerId, examId, pages: [], groups: [], updatedAt: new Date().toISOString() });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const stored = await this.blobs.put(pathFor(ownerId, examId), encode(manifest), "application/json", { ifNoneMatch: true });
        return { manifest, etag: stored.etag };
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== "OBJECT_EXISTS") throw error;
        const created = await this.getWithMeta(ownerId, examId);
        if (created) return created;
      }
    }
    throw new AppError("PAGE_MANIFEST_CONFLICT", "No se pudo inicializar el manifiesto de páginas.", 409, true);
  }

  async replace(ownerId: string, examId: string, expectedEtag: string, pages: DocumentPage[], groups: DocumentGroup[]) {
    const current = await this.getWithMeta(ownerId, examId);
    if (!current) throw new AppError("NOT_FOUND", "Manifiesto de páginas no encontrado.", 404);
    if (current.etag !== expectedEtag) throw new AppError("ETAG_CONFLICT", "Las páginas fueron modificadas por otro editor.", 409);
    validateReferences(ownerId, examId, pages, groups);
    const manifest = documentPagesManifestSchema.parse({ schemaVersion: 1, ownerId, examId, pages, groups, updatedAt: new Date().toISOString() });
    const stored = await this.blobs.put(pathFor(ownerId, examId), encode(manifest), "application/json", { ifMatch: expectedEtag });
    return { manifest, etag: stored.etag };
  }

  async appendAssetPages(asset: Asset) {
    if (!asset.examId) throw new AppError("ASSET_EXAM_REQUIRED", "El asset debe pertenecer a un examen.", 400);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.initialize(asset.ownerId, asset.examId);
      if (current.manifest.pages.some((page) => page.sourceAssetId === asset.assetId)) return current;
      const pageCount = asset.pageCount ?? 1;
      const startOrder = current.manifest.pages.length;
      const pages = [...current.manifest.pages];
      for (let index = 0; index < pageCount; index += 1) {
        pages.push({ schemaVersion: 1, pageId: randomUUID(), examId: asset.examId, ownerId: asset.ownerId, sourceAssetId: asset.assetId, pageNumber: index + 1, order: startOrder + index, rotation: 0 });
      }
      try {
        return await this.replace(asset.ownerId, asset.examId, current.etag, pages, current.manifest.groups);
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== "ETAG_CONFLICT") throw error;
      }
    }
    throw new AppError("ETAG_CONFLICT", "No se pudo añadir el asset tras varios conflictos.", 409, true);
  }

  async removeAssetPages(ownerId: string, examId: string, assetId: string) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.getWithMeta(ownerId, examId);
      if (!current) return null;
      const removedIds = new Set(current.manifest.pages.filter((page) => page.sourceAssetId === assetId).map((page) => page.pageId));
      if (removedIds.size === 0) return current;
      const pages = current.manifest.pages.filter((page) => !removedIds.has(page.pageId)).map((page, order) => ({ ...page, order }));
      const groups = current.manifest.groups.map((group) => ({ ...group, pageIds: group.pageIds.filter((pageId) => !removedIds.has(pageId)) })).filter((group) => group.pageIds.length > 0);
      try {
        return await this.replace(ownerId, examId, current.etag, pages, groups);
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== "ETAG_CONFLICT") throw error;
      }
    }
    throw new AppError("ETAG_CONFLICT", "No se pudieron eliminar las páginas tras varios conflictos.", 409, true);
  }
}
