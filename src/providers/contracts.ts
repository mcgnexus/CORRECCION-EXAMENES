import { z } from "zod";

export const providerProposalSchema = z.object({
  answer: z.unknown(),
  justification: z.string(),
  doubts: z.array(z.string()),
  sourceEvidence: z.array(z.object({
    url: z.string().url(),
    title: z.string(),
    supportedClaim: z.string(),
    excerpt: z.string(),
  })),
  reviewScope: z.enum(["text_only", "text_and_visual"]),
});

export type ProviderProposal = z.infer<typeof providerProposalSchema>;

export type ProviderCapabilities = {
  provider: "gemini" | "deepseek";
  model: string | null;
  configured: boolean;
  text: boolean;
  vision: "verified" | "unverified" | "unsupported";
  search: "verified" | "unverified" | "unsupported";
  structuredJson: "verified" | "unverified" | "unsupported";
};

export class ProviderError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable: boolean, public readonly status?: number) {
    super(message);
    this.name = "ProviderError";
  }
}

export function parseProviderJson<T>(value: unknown, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ProviderError("INVALID_PROVIDER_OUTPUT", "La salida del proveedor no cumple el esquema.", false);
  return parsed.data;
}
