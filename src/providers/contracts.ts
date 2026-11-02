import { z } from "zod";

export const providerProposalSchema = z.object({
  answer: z.unknown(),
  justification: z.string().default(""),
  doubts: z.array(z.string()).default([]),
  sourceEvidence: z.array(z.object({
    url: z.string().url(),
    title: z.string(),
    supportedClaim: z.string(),
    excerpt: z.string(),
  })).default([]),
  reviewScope: z.enum(["text_only", "text_and_visual"]),
});

export type ProviderProposal = {
  answer?: unknown;
  justification: string;
  doubts: string[];
  sourceEvidence: Array<{ url: string; title: string; supportedClaim: string; excerpt: string }>;
  reviewScope: "text_only" | "text_and_visual";
};

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
  constructor(public readonly code: string, message: string, public readonly retryable: boolean, public readonly status?: number, public readonly retryAfterMs?: number) {
    super(message);
    this.name = "ProviderError";
  }
}

export async function withProviderRetry<T>(operation: (attempt: number) => Promise<T>, maxAttempts = 3): Promise<T> {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await operation(attempt);
    } catch (error) {
      if (!(error instanceof ProviderError) || !error.retryable || attempt >= maxAttempts) throw error;
      const delay = Math.min(error.retryAfterMs ?? 250 * 2 ** (attempt - 1), 2_000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new ProviderError("RETRY_EXHAUSTED", "Se agotaron los reintentos del proveedor.", false);
}

export function parseProviderJson<S extends z.ZodTypeAny>(value: unknown, schema: S): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ProviderError("INVALID_PROVIDER_OUTPUT", "La salida del proveedor no cumple el esquema.", false);
  return parsed.data;
}
