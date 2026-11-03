import { z } from "zod";

export const schemaVersion = z.literal(1);
export const idSchema = z.string().min(1).max(200);
export const ownerIdSchema = z.string().min(1).max(200);
export const isoDateSchema = z.string().datetime({ offset: true });

export const questionTypeSchema = z.enum([
  "single_choice",
  "multiple_choice",
  "short_text",
  "essay",
  "calculation",
  "drawing",
  "mixed",
]);

export const examStateSchema = z.enum([
  "draft",
  "extracting",
  "structure_review",
  "solving",
  "key_review",
  "approved",
]);

export const omrStatusSchema = z.enum([
  "single",
  "blank",
  "multiple",
  "ambiguous",
  "unreadable",
]);

export const assetKindSchema = z.enum(["original", "page", "preview", "derived"]);
export const assetStateSchema = z.enum(["uploaded", "validated", "rejected", "deleting", "deleted"]);
export const assetOriginSchema = z.enum(["upload", "derived", "provider", "export"]);

export const assetSchema = z.object({
  schemaVersion,
  assetId: idSchema,
  ownerId: ownerIdSchema,
  examId: idSchema.optional(),
  kind: assetKindSchema,
  state: assetStateSchema,
  origin: assetOriginSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.string().min(1),
  blobPath: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  pageCount: z.number().int().positive().optional(),
  pageNumber: z.number().int().positive().optional(),
  sourceAssetId: idSchema.optional(),
  expiresAt: isoDateSchema.optional(),
  format: z.enum(["csv", "xlsx", "pdf"]).optional(),
  exportId: idSchema.optional(),
  sourceRefs: z.array(idSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  errorCode: z.string().optional(),
  etag: z.string().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const normalizedCropSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
});

export const documentPageSchema = z.object({
  schemaVersion,
  pageId: idSchema,
  examId: idSchema,
  ownerId: ownerIdSchema,
  sourceAssetId: idSchema,
  previewAssetId: idSchema.optional(),
  pageNumber: z.number().int().positive(),
  order: z.number().int().nonnegative(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  crop: normalizedCropSchema.optional(),
  groupId: idSchema.optional(),
});

export const documentGroupSchema = z.object({
  schemaVersion,
  groupId: idSchema,
  examId: idSchema,
  ownerId: ownerIdSchema,
  label: z.string().min(1).max(200),
  pageIds: z.array(idSchema),
  studentLabel: z.string().max(200).optional(),
});

export const documentPagesManifestSchema = z.object({
  schemaVersion,
  examId: idSchema,
  ownerId: ownerIdSchema,
  pages: z.array(documentPageSchema),
  groups: z.array(documentGroupSchema),
  etag: z.string().optional(),
  updatedAt: isoDateSchema,
});

export const figureSchema = z.object({
  assetId: idSchema,
  pageId: idSchema,
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
  transform: z.string().min(1),
});

export const questionOptionSchema = z.object({
  id: idSchema,
  label: z.string().min(1),
  text: z.string(),
});

export const rubricCriterionSchema = z.object({
  id: idSchema,
  description: z.string().min(1),
  maxPoints: z.number().nonnegative(),
  requiredEvidence: z.string().min(1),
  validAlternatives: z.array(z.string()),
  partialScoring: z.string().min(1),
  commonErrors: z.array(z.string()),
  dependsOnCriterionIds: z.array(idSchema),
});

export const rubricSchema = z
  .object({
    criteria: z.array(rubricCriterionSchema),
    totalMax: z.number().nonnegative(),
  })
  .superRefine((value, context) => {
    const sum = value.criteria.reduce((total, criterion) => total + criterion.maxPoints, 0);
    if (Math.abs(sum - value.totalMax) > 1e-9) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "La suma de criterios debe coincidir con totalMax." });
    }
  });

export const scoringSectionSchema = z.object({
  sectionId: idSchema,
  maxPoints: z.number().positive(),
  weightBasisPoints: z.number().int().nonnegative(),
  kind: z.enum(["test", "open"]),
});

export const scoringPolicySchema = z
  .object({
    schemaVersion,
    policyId: idSchema,
    scaleMax: z.number().positive(),
    correctPoints: z.number(),
    blankPoints: z.number(),
    incorrectPenalty: z.number(),
    multipleMarkHandling: z.enum(["count_once_as_error", "pending"]),
    minimumScore: z.number().optional(),
    decimals: z.number().int().min(0).max(6),
    sections: z.array(scoringSectionSchema),
    confirmed: z.boolean(),
  })
  .superRefine((value, context) => {
    const weights = value.sections.reduce((sum, section) => sum + section.weightBasisPoints, 0);
    if (value.sections.length > 0 && weights !== 10_000) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Los pesos de seccion deben sumar 10000 puntos base." });
    }
    if (value.minimumScore !== undefined && value.minimumScore < 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "El minimo no puede ser negativo." });
    }
  });

export const answerKeyRevisionSchema = z.object({
  schemaVersion,
  revisionId: idSchema,
  examId: idSchema,
  sourceExamRevisionId: idSchema,
  ownerId: ownerIdSchema,
  approvedBy: ownerIdSchema,
  approvedAt: isoDateSchema,
  scoringPolicyRevisionId: idSchema,
  answers: z.record(z.string(), z.unknown()),
  rubricByQuestion: z.record(z.string(), rubricSchema),
  sourceEvidenceIds: z.array(idSchema),
});

export const examSchema = z.object({
  schemaVersion,
  examId: idSchema,
  ownerId: ownerIdSchema,
  title: z.string().min(1),
  subject: z.string().min(1),
  modelIds: z.array(idSchema),
  state: examStateSchema,
  activeRevisionId: idSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const responseObservationSchema = z.object({
  schemaVersion,
  observationId: idSchema,
  questionId: idSchema,
  method: z.enum(["omr", "transcription", "human"]),
  status: omrStatusSchema.optional(),
  selectedOptionIds: z.array(idSchema),
  candidateOptionIds: z.array(idSchema),
  literalText: z.string().optional(),
  formulas: z.array(z.string()),
  evidenceAssetIds: z.array(idSchema),
  flags: z.array(z.string()),
  requiresHumanReview: z.boolean(),
});

export const sourceEvidenceSchema = z.object({
  schemaVersion,
  sourceEvidenceId: idSchema,
  ownerId: ownerIdSchema,
  questionId: idSchema,
  url: z.string().url(),
  title: z.string().min(1),
  consultedAt: isoDateSchema,
  supportedClaim: z.string().min(1),
  excerpt: z.string().min(1).max(2_000),
});

export const blobManifestSchema = z.object({
  schemaVersion,
  aggregateId: idSchema,
  ownerId: ownerIdSchema,
  activeRevisionId: idSchema.optional(),
  etag: z.string().optional(),
  updatedAt: isoDateSchema,
});

export const jobSchema = z.object({
  schemaVersion,
  jobId: idSchema,
  ownerId: ownerIdSchema,
  kind: z.enum(["extract", "solve", "submission", "batch", "export", "omr"]),
  status: z.enum(["queued", "running", "completed", "failed", "cancel_requested", "cancelled"]),
  step: z.string().min(1),
  attempt: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1),
  errorCode: z.string().optional(),
  retryable: z.boolean(),
  outputRefs: z.array(idSchema).default([]),
  progress: z.object({
    phase: z.string().min(1),
    current: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    percent: z.number().min(0).max(100),
    totalSubmissions: z.number().int().nonnegative().optional(),
    completedSubmissions: z.number().int().nonnegative().optional(),
    failedSubmissions: z.number().int().nonnegative().optional(),
    blockedSubmissions: z.number().int().nonnegative().optional(),
    totalPages: z.number().int().nonnegative().optional(),
    completedPages: z.number().int().nonnegative().optional(),
    totalQuestions: z.number().int().nonnegative().optional(),
    completedQuestions: z.number().int().nonnegative().optional(),
    currentSubmissionId: idSchema.optional(),
    currentPageId: idSchema.optional(),
    currentQuestionId: idSchema.optional(),
  }).default({ phase: "queued", current: 0, completed: 0, total: 0, percent: 0 }),
  phase: z.string().min(1).default("queued"),
  cancelRequestedAt: isoDateSchema.optional(),
  cost: z.object({
    inputTokens: z.number().nonnegative().optional(),
    outputTokens: z.number().nonnegative().optional(),
    providerCalls: z.number().int().nonnegative().optional(),
    searchCalls: z.number().int().nonnegative().optional(),
    retryCount: z.number().int().nonnegative().optional(),
    amount: z.number().nonnegative().optional(),
    currency: z.string().min(1).optional(),
  }).optional(),
  exportRequest: z.object({
    examId: idSchema,
    batchId: idSchema,
    formats: z.array(z.enum(["csv", "xlsx", "pdf"])).min(1),
    includeOriginal: z.boolean(),
    retentionHours: z.number().positive(),
    dependencies: z.object({
      answerKeyRevisionId: idSchema,
      templateRevisionId: idSchema,
      scoringPolicyRevisionId: idSchema,
    }),
  }).optional(),
  batchRequest: z.object({
    examId: idSchema,
    batchId: idSchema,
    answerKeyRevisionId: idSchema,
    templateRevisionId: idSchema,
    scoringPolicyRevisionId: idSchema,
    submissionId: idSchema.optional(),
    scope: z.enum(["batch", "submission_omr", "submission_open"]).optional(),
    concurrency: z.number().int().positive().max(8),
    maxAttempts: z.number().int().positive().max(5).default(3),
    budget: z.object({
      maxInputTokens: z.number().int().positive().optional(),
      maxOutputTokens: z.number().int().positive().optional(),
      maxAmount: z.number().positive().optional(),
      currency: z.string().min(1).optional(),
    }).optional(),
  }).optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const auditEventSchema = z.object({
  schemaVersion,
  eventId: idSchema,
  ownerId: ownerIdSchema,
  actorId: ownerIdSchema,
  type: z.string().min(1),
  aggregateType: z.string().min(1),
  aggregateId: idSchema,
  payload: z.record(z.string(), z.unknown()),
  occurredAt: isoDateSchema,
});

export type Exam = z.infer<typeof examSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type DocumentPage = z.infer<typeof documentPageSchema>;
export type DocumentGroup = z.infer<typeof documentGroupSchema>;
export type DocumentPagesManifest = z.infer<typeof documentPagesManifestSchema>;
export type ScoringPolicy = z.infer<typeof scoringPolicySchema>;
export type ScoringSection = z.infer<typeof scoringSectionSchema>;
export type ResponseObservation = z.infer<typeof responseObservationSchema>;
export type Rubric = z.infer<typeof rubricSchema>;
export type Job = z.infer<typeof jobSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
