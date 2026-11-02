import { z } from "zod";
import { assetSchema, idSchema, isoDateSchema, ownerIdSchema, schemaVersion } from "./schemas";

export const exportFormatSchema = z.enum(["csv", "xlsx", "pdf"]);

export const exportJobRequestSchema = z.object({
  formats: z.array(exportFormatSchema).min(1).max(3),
  includeOriginal: z.boolean().default(false),
  expectedEtag: z.string().min(1),
  retentionHours: z.number().positive().max(24 * 30).default(24),
}).superRefine((value, context) => {
  if (new Set(value.formats).size !== value.formats.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["formats"], message: "No se pueden repetir formatos." });
});

export const exportProgressSchema = z.object({
  phase: z.enum(["queued", "collect", "csv", "xlsx", "pdf", "cleanup", "completed", "failed", "cancelled"]),
  current: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100),
});

export const providerLeaseSchema = z.object({
  schemaVersion,
  leaseId: idSchema,
  slotId: idSchema,
  ownerId: ownerIdSchema,
  jobId: idSchema,
  taskId: idSchema,
  expiresAt: isoDateSchema,
  createdAt: isoDateSchema,
});

export const exportManifestSchema = assetSchema.extend({
  exportId: idSchema,
  ownerId: ownerIdSchema,
  examId: idSchema,
  batchId: idSchema,
  snapshotRefs: z.array(idSchema),
  revisionRefs: z.array(idSchema),
  format: exportFormatSchema,
  blobPath: z.string().min(1),
  expiresAt: isoDateSchema,
  state: z.enum(["available", "deleted", "expired"]),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type ExportFormat = z.infer<typeof exportFormatSchema>;
export type ExportJobRequest = z.infer<typeof exportJobRequestSchema>;
export type ExportProgress = z.infer<typeof exportProgressSchema>;
export type ExportManifest = z.infer<typeof exportManifestSchema>;
export type ProviderLease = z.infer<typeof providerLeaseSchema>;
