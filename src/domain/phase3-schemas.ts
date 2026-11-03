import { z } from "zod";
import { idSchema, isoDateSchema, omrStatusSchema, schemaVersion, scoringPolicySchema } from "./schemas";
import { openQuestionScoreSchema } from "./phase4-schemas";

export const templateStateSchema = z.enum(["draft", "testing", "approved", "stale"]);
export const batchStateSchema = z.enum(["draft", "reading", "review", "scoring", "review_scores", "closed", "cancelled"]);
export const submissionStateSchema = z.enum(["uploading", "pages_ready", "identity_pending", "reading", "transcribing", "transcription_review", "evaluating", "review_scores", "review", "scored", "closed", "rejected"]);
export const identitySourceSchema = z.enum(["manual", "ocr_suggestion", "identity_unreadable"]);

export const omrBubbleSchema = z.object({
  questionId: idSchema,
  optionId: idSchema,
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
});

export const omrPreprocessSchema = z.object({
  rotation: z.number().min(-180).max(180).default(0),
  brightness: z.number().min(0.5).max(2).default(1),
  contrast: z.number().min(0.5).max(2).default(1),
});

export const omrTemplateRevisionSchema = z
  .object({
    schemaVersion,
    templateId: idSchema,
    examId: idSchema,
    ownerId: idSchema,
    state: templateStateSchema,
    canvasWidth: z.number().int().positive(),
    canvasHeight: z.number().int().positive(),
    sourceAnchors: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])),
    targetAnchors: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])),
    bubbles: z.array(omrBubbleSchema),
    preprocess: omrPreprocessSchema.default({ rotation: 0, brightness: 1, contrast: 1 }),
    threshold: z.number().min(0).max(1).default(0.35),
    margin: z.number().min(0).max(1).default(0.08),
    algorithmVersion: z.string().min(1).default("omr-1"),
    fixtureAssetId: idSchema.optional(),
    approvedBy: idSchema.optional(),
    approvedAt: isoDateSchema.optional(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .superRefine((value, context) => {
    if (value.sourceAnchors.length !== 4 || value.targetAnchors.length !== 4) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "La plantilla requiere exactamente cuatro anclas." });
    }
    if (value.bubbles.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "La plantilla requiere al menos una burbuja." });
    }
  });

export const batchSchema = z.object({
  schemaVersion,
  batchId: idSchema,
  examId: idSchema,
  ownerId: idSchema,
  state: batchStateSchema,
  answerKeyRevisionId: idSchema,
  templateRevisionId: idSchema,
  scoringPolicyRevisionId: idSchema,
  scoringPolicy: scoringPolicySchema,
  maxPages: z.number().int().positive().default(30),
  submissionIds: z.array(idSchema),
  blockingIssues: z.array(z.string()),
  closedAt: isoDateSchema.optional(),
  closedBy: idSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const submissionSchema = z.object({
  schemaVersion,
  submissionId: idSchema,
  batchId: idSchema,
  examId: idSchema,
  ownerId: idSchema,
  state: submissionStateSchema,
  pageIds: z.array(idSchema),
  assetIds: z.array(idSchema),
  suggestedIdentity: z.string().max(200).optional(),
  identityConfidence: z.number().min(0).max(1).optional(),
  identitySource: identitySourceSchema.optional(),
  confirmedIdentity: z.string().max(200).optional(),
  confirmedBy: idSchema.optional(),
  confirmedAt: isoDateSchema.optional(),
  ocrRef: idSchema.optional(),
  readingIds: z.array(idSchema),
  snapshotId: idSchema.optional(),
  activeResponseRegionRevisionId: idSchema.optional(),
  responseTranscriptionIds: z.array(idSchema).default([]),
  responseEvaluationIds: z.array(idSchema).default([]),
  responseDecisionIds: z.array(idSchema).default([]),
  responseBlockingIssues: z.array(z.string()).default([]),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const omrRowResultSchema = z.object({
  questionId: idSchema,
  status: omrStatusSchema,
  selectedOptionIds: z.array(idSchema),
  candidateOptionIds: z.array(idSchema),
  metrics: z.array(z.object({ optionId: idSchema, fill: z.number().min(0).max(1) })),
  requiresHumanReview: z.boolean(),
  flags: z.array(z.string()).default([]),
});

export const omrReadingSchema = z.object({
  schemaVersion,
  readingId: idSchema,
  submissionId: idSchema,
  batchId: idSchema,
  examId: idSchema,
  ownerId: idSchema,
  pageId: idSchema,
  assetId: idSchema,
  templateRevisionId: idSchema,
  algorithmVersion: z.string().min(1),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  alignment: z.record(z.string(), z.unknown()),
  rows: z.array(omrRowResultSchema),
  status: z.enum(["completed", "failed", "reviewed"]),
  errorCode: z.string().optional(),
  overlayRef: idSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const manualDecisionSchema = z.object({
  schemaVersion,
  decisionId: idSchema,
  readingId: idSchema,
  questionId: idSchema,
  originalStatus: omrStatusSchema,
  resolvedStatus: z.enum(["single", "blank"]),
  selectedOptionIds: z.array(idSchema),
  actorId: idSchema,
  reason: z.string().min(1),
  decidedAt: isoDateSchema,
});

export const questionScoreSchema = z.object({
  questionId: idSchema,
  outcome: z.enum(["correct", "blank", "incorrect", "pending"]),
  selectedOptionIds: z.array(idSchema),
  source: z.enum(["omr", "manual"]),
});

export const scoreSnapshotSchema = z.object({
  schemaVersion,
  snapshotId: idSchema,
  submissionId: idSchema,
  batchId: idSchema,
  examId: idSchema,
  ownerId: idSchema,
  answerKeyRevisionId: idSchema,
  templateRevisionId: idSchema,
  scoringPolicyRevisionId: idSchema.default("legacy-unknown"),
  state: z.enum(["draft", "review", "closed", "stale"]),
  questionScores: z.array(questionScoreSchema),
  correct: z.number().int().nonnegative(),
  blank: z.number().int().nonnegative(),
  incorrect: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  rawPoints: z.number(),
  score: z.number(),
  blockingIssues: z.array(z.string()),
  openQuestionScores: z.array(openQuestionScoreSchema).default([]),
  openPoints: z.number().default(0),
  openMaximumPoints: z.number().default(0),
  openPending: z.number().int().nonnegative().default(0),
  responseRegionRevisionId: idSchema.optional(),
  transcriptionRevisionIds: z.array(idSchema).default([]),
  evaluationIds: z.array(idSchema).default([]),
  decisionIds: z.array(idSchema).default([]),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type OmrTemplateRevision = z.infer<typeof omrTemplateRevisionSchema>;
export type Batch = z.infer<typeof batchSchema>;
export type Submission = z.infer<typeof submissionSchema>;
export type OmrReading = z.infer<typeof omrReadingSchema>;
export type ManualDecision = z.infer<typeof manualDecisionSchema>;
export type ScoreSnapshot = z.infer<typeof scoreSnapshotSchema>;
export type { ScoringPolicy } from "./schemas";
