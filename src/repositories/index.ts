import { ExamRepository } from "./exam-repository";
import { getBlobStore } from "./blob-store";
import { IdempotencyRepository } from "./idempotency";
import { JobRepository } from "./job-repository";
import { AuditRepository } from "./audit-repository";

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
