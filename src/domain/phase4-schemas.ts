import { z } from "zod";
import { idSchema, isoDateSchema, questionTypeSchema, schemaVersion } from "./schemas";
import { providerNameSchema } from "./phase2-schemas";

export const responseRegionStateSchema = z.enum(["draft", "ready", "stale"]);
export const transcriptionStateSchema = z.enum(["proposed", "confirmed", "rejected", "failed", "stale"]);
export const evaluationStateSchema = z.enum(["completed", "failed", "stale"]);
export const responseDecisionSourceSchema = z.enum(["gemini", "deepseek", "manual"]);

export const responseRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
});

export const responseRegionSchema = z.object({
  regionId: idSchema,
  questionId: idSchema,
  questionType: questionTypeSchema,
  pageId: idSchema,
  sourceAssetId: idSchema,
  cropAssetId: idSchema,
  rect: responseRectSchema,
  order: z.number().int().nonnegative(),
});

export const responseRegionRevisionSchema = z.object({
  schemaVersion,
  regionRevisionId: idSchema,
  submissionId: idSchema,
  batchId: idSchema,
  examId: idSchema,
  ownerId: idSchema,
  state: responseRegionStateSchema,
  regions: z.array(responseRegionSchema).min(1),
  createdBy: idSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const responseRegionPointerSchema = z.object({
  schemaVersion,
  ownerId: idSchema,
  submissionId: idSchema,
  activeRevisionId: idSchema,
  updatedAt: isoDateSchema,
});

export const uncertainSpanSchema = z.object({
  text: z.string().min(1),
  reason: z.string().min(1),
});

export const transcriptionRevisionSchema = z.object({
  schemaVersion,
  transcriptionId: idSchema,
  regionRevisionId: idSchema,
  submissionId: idSchema,
  batchId: idSchema,
  examId: idSchema,
  ownerId: idSchema,
  questionId: idSchema,
  regionIds: z.array(idSchema).min(1),
  cropAssetIds: z.array(idSchema).min(1),
  literalText: z.string(),
  normalizedText: z.string().optional(),
  correctedText: z.string().optional(),
  confidence: z.number().min(0).max(1),
  uncertainSpans: z.array(uncertainSpanSchema),
  flags: z.array(z.string()),
  provider: providerNameSchema,
  model: z.string().min(1),
  providerRunId: idSchema.optional(),
  state: transcriptionStateSchema,
  confirmedBy: idSchema.optional(),
  confirmedAt: isoDateSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const evaluationCriterionScoreSchema = z.object({
  criterionId: idSchema,
  points: z.number().nonnegative(),
  maxPoints: z.number().nonnegative(),
  evidence: z.string(),
  incidents: z.array(z.string()),
});

export const evaluationProposalSchema = z.object({
  schemaVersion,
  evaluationId: idSchema,
  transcriptionId: idSchema,
  submissionId: idSchema,
  batchId: idSchema,
  examId: idSchema,
  ownerId: idSchema,
  questionId: idSchema,
  answerKeyRevisionId: idSchema,
  sectionId: idSchema,
  provider: providerNameSchema,
  model: z.string().min(1),
  reviewScope: z.literal("text_only"),
  criterionScores: z.array(evaluationCriterionScoreSchema),
  totalPoints: z.number().nonnegative(),
  maximumPoints: z.number().nonnegative(),
  explanation: z.string(),
  incidents: z.array(z.string()),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  providerRunId: idSchema.optional(),
  state: evaluationStateSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const manualCriterionScoreSchema = z.object({
  criterionId: idSchema,
  maxPoints: z.number().nonnegative(),
  points: z.number().nonnegative(),
  evidence: z.string(),
});

export const responseDecisionSchema = z.object({
  schemaVersion,
  decisionId: idSchema,
  submissionId: idSchema,
  batchId: idSchema,
  examId: idSchema,
  ownerId: idSchema,
  questionId: idSchema,
  transcriptionId: idSchema,
  answerKeyRevisionId: idSchema,
  sectionId: idSchema,
  source: responseDecisionSourceSchema,
  selectedEvaluationId: idSchema.optional(),
  manualCriterionScores: z.array(manualCriterionScoreSchema).optional(),
  criterionScores: z.array(evaluationCriterionScoreSchema),
  totalPoints: z.number().nonnegative(),
  maximumPoints: z.number().nonnegative(),
  reason: z.string().min(1),
  actorId: idSchema,
  decidedAt: isoDateSchema,
  createdAt: isoDateSchema,
});

export const openQuestionScoreSchema = z.object({
  questionId: idSchema,
  sectionId: idSchema,
  points: z.number().nonnegative(),
  maximumPoints: z.number().nonnegative(),
  source: responseDecisionSourceSchema,
  transcriptionId: idSchema,
  decisionId: idSchema,
});

export const transcriptionModelOutputSchema = z.object({
  literalText: z.string(),
  confidence: z.number().min(0).max(1),
  uncertainSpans: z.array(uncertainSpanSchema),
  flags: z.array(z.string()),
});

export const evaluationModelOutputSchema = z.object({
  criterionScores: z.array(evaluationCriterionScoreSchema),
  explanation: z.string(),
  incidents: z.array(z.string()),
});

export type ResponseRegion = z.infer<typeof responseRegionSchema>;
export type ResponseRegionRevision = z.infer<typeof responseRegionRevisionSchema>;
export type TranscriptionRevision = z.infer<typeof transcriptionRevisionSchema>;
export type EvaluationProposal = z.infer<typeof evaluationProposalSchema>;
export type ResponseDecision = z.infer<typeof responseDecisionSchema>;
export type OpenQuestionScore = z.infer<typeof openQuestionScoreSchema>;
