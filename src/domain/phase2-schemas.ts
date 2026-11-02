import { z } from "zod";
import { idSchema, isoDateSchema, questionTypeSchema, rubricSchema, schemaVersion, sourceEvidenceSchema } from "./schemas";

export const reviewScopeSchema = z.enum(["text_only", "text_and_visual"]);
export const providerNameSchema = z.enum(["gemini", "deepseek"]);
export const providerRunStatusSchema = z.enum(["queued", "running", "completed", "failed", "blocked"]);

export const structureOptionSchema = z.object({ id: idSchema, label: z.string().min(1), text: z.string() });

export const structureQuestionSchema = z.object({
  questionId: idSchema,
  number: z.number().int().positive(),
  label: z.string().min(1),
  type: questionTypeSchema,
  text: z.string(),
  options: z.array(structureOptionSchema),
  pageIds: z.array(idSchema),
  figureIds: z.array(idSchema),
  dependsOnQuestionIds: z.array(idSchema),
  flags: z.array(z.string()),
});

export const structureFigureSchema = z.object({
  figureId: idSchema,
  pageId: idSchema,
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
  assetId: idSchema.optional(),
  description: z.string().optional(),
});

export const structureProposalSchema = z.object({
  schemaVersion,
  proposalId: idSchema,
  examRevisionId: idSchema,
  provider: providerNameSchema,
  model: z.string().min(1),
  reviewScope: reviewScopeSchema,
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  questions: z.array(structureQuestionSchema),
  figures: z.array(structureFigureSchema),
  doubts: z.array(z.string()),
  flags: z.array(z.string()),
  sourceEvidenceIds: z.array(idSchema),
  rawOutputRef: idSchema,
  createdAt: isoDateSchema,
});

const modelOptionSchema = z.union([
  z.string(),
  z.object({ label: z.union([z.string(), z.number()]).optional(), text: z.string().optional(), value: z.string().optional(), content: z.string().optional() }).passthrough(),
]).catch("");

const modelFigureBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
});

export const structureModelOutputSchema = z.object({
  questions: z.array(z.object({
    number: z.coerce.number().int().positive().catch(0),
    label: z.union([z.string(), z.number()]).optional(),
    type: z.string().optional(),
    text: z.string().catch(""),
    options: z.array(modelOptionSchema).catch([]),
    pageNumbers: z.array(z.coerce.number().int().positive()).catch([]),
    figureBoxes: z.array(modelFigureBoxSchema).catch([]),
    flags: z.array(z.string()).catch([]),
  }).passthrough()).catch([]),
  doubts: z.array(z.string()).catch([]),
  flags: z.array(z.string()).catch([]),
}).transform((result) => ({
  ...result,
  questions: result.questions.map((question, index) => {
    const number = question.number || index + 1;
    const options = question.options.flatMap((option, optionIndex) => {
      if (typeof option === "string") return option.trim() ? [{ label: String.fromCharCode(65 + optionIndex), text: option }] : [];
      const text = option.text ?? option.value ?? option.content ?? "";
      return text.trim() ? [{ label: String(option.label ?? String.fromCharCode(65 + optionIndex)), text }] : [];
    });
    const parsedType = questionTypeSchema.safeParse(question.type);
    return {
      number,
      label: String(question.label ?? number),
      type: parsedType.success ? parsedType.data : options.length ? "single_choice" as const : "short_text" as const,
      text: question.text,
      options,
      pageNumbers: question.pageNumbers,
      figureBoxes: question.figureBoxes,
      flags: question.flags,
    };
  }),
}));

export const solutionModelOutputSchema = z.object({
  answer: z.unknown(),
  explanation: z.string(),
  alternatives: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  doubts: z.array(z.string()),
  sourceEvidence: z.array(z.object({ url: z.string().url(), title: z.string(), supportedClaim: z.string(), excerpt: z.string() })),
  sourceMissing: z.boolean(),
});

export const examRevisionSchema = z.object({
  schemaVersion,
  examRevisionId: idSchema,
  examId: idSchema,
  ownerId: idSchema,
  pagesManifestEtag: z.string().min(1),
  sourcePageIds: z.array(idSchema),
  status: z.enum(["extracting", "structure_review", "solving", "key_review", "approved", "stale"]),
  workflowRunId: idSchema.optional(),
  language: z.string().min(2).max(20),
  proposals: z.array(idSchema),
  activeStructureProposalId: idSchema.optional(),
  answerKeyRevisionId: idSchema.optional(),
  blockingIssues: z.array(z.string()),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const sourceEvidenceExtendedSchema = sourceEvidenceSchema.extend({
  provider: providerNameSchema.optional(),
  query: z.string().optional(),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

export const solutionProposalSchema = z.object({
  schemaVersion,
  solutionProposalId: idSchema,
  examRevisionId: idSchema,
  questionId: idSchema,
  provider: providerNameSchema,
  model: z.string().min(1),
  reviewScope: reviewScopeSchema,
  answer: z.unknown(),
  explanation: z.string(),
  alternatives: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  doubts: z.array(z.string()),
  sourceEvidenceIds: z.array(idSchema),
  sourceMissing: z.boolean(),
  rawOutputRef: idSchema,
  createdAt: isoDateSchema,
});

export const questionDecisionSchema = z.object({
  questionId: idSchema,
  sectionId: idSchema.optional(),
  answer: z.unknown(),
  explanation: z.string(),
  rubric: rubricSchema,
  proposalIds: z.array(idSchema),
  sourceEvidenceIds: z.array(idSchema),
  humanNote: z.string().optional(),
  resolved: z.boolean(),
});

export const answerKeyRevisionSchema = z.object({
  schemaVersion,
  answerKeyRevisionId: idSchema,
  examRevisionId: idSchema,
  examId: idSchema,
  ownerId: idSchema,
  status: z.enum(["draft", "review", "approved", "stale"]),
  scoringPolicyRevisionId: idSchema,
  decisions: z.record(z.string(), questionDecisionSchema),
  blockingIssues: z.array(z.string()),
  approvedBy: idSchema.optional(),
  approvedAt: isoDateSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const providerRunSchema = z.object({
  schemaVersion,
  providerRunId: idSchema,
  ownerId: idSchema,
  examRevisionId: idSchema,
  questionId: idSchema.optional(),
  provider: providerNameSchema,
  model: z.string().min(1),
  status: providerRunStatusSchema,
  attempt: z.number().int().nonnegative(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  reviewScope: reviewScopeSchema,
  retryable: z.boolean(),
  errorCode: z.string().optional(),
  httpStatus: z.number().int().positive().optional(),
  inputRef: idSchema,
  outputRef: idSchema.optional(),
  tokenUsage: z.record(z.string(), z.number()).optional(),
  searchUsed: z.boolean(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type ExamRevision = z.infer<typeof examRevisionSchema>;
export type StructureProposal = z.infer<typeof structureProposalSchema>;
export type SolutionProposal = z.infer<typeof solutionProposalSchema>;
export type AnswerKeyRevision = z.infer<typeof answerKeyRevisionSchema>;
export type ProviderRun = z.infer<typeof providerRunSchema>;
