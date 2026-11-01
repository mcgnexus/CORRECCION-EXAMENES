import { ExamRepository } from "./exam-repository";
import { getBlobStore } from "./blob-store";
import { IdempotencyRepository } from "./idempotency";
import { JobRepository } from "./job-repository";
import { AuditRepository } from "./audit-repository";
import { AssetRepository } from "./asset-repository";
import { DocumentPagesRepository } from "./document-pages-repository";
import { AnswerKeyRepository, ExamRevisionRepository, ProviderRunRepository, SolutionProposalRepository, StructureProposalRepository } from "./phase2-repository";

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

export function getExamRevisionRepository() { return new ExamRevisionRepository(getBlobStore()); }
export function getStructureProposalRepository() { return new StructureProposalRepository(getBlobStore()); }
export function getSolutionProposalRepository() { return new SolutionProposalRepository(getBlobStore()); }
export function getAnswerKeyRepository() { return new AnswerKeyRepository(getBlobStore()); }
export function getProviderRunRepository() { return new ProviderRunRepository(getBlobStore()); }
