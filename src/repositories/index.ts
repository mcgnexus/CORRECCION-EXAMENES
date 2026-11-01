import { ExamRepository } from "./exam-repository";
import { getBlobStore } from "./blob-store";
import { IdempotencyRepository } from "./idempotency";
import { JobRepository } from "./job-repository";
import { AuditRepository } from "./audit-repository";
import { AssetRepository } from "./asset-repository";
import { DocumentPagesRepository } from "./document-pages-repository";

export function getExamRepository() {
  return new ExamRepository(getBlobStore());
}

export function getIdempotencyRepository() {
  return new IdempotencyRepository(getBlobStore());
}

export function getJobRepository() {
  return new JobRepository(getBlobStore());
}

export function getAuditRepository() {
  return new AuditRepository(getBlobStore());
}

export function getAssetRepository() {
  return new AssetRepository(getBlobStore());
}

export function getDocumentPagesRepository() {
  return new DocumentPagesRepository(getBlobStore());
}
