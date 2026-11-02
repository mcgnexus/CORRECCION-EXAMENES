import { z } from "zod";
import { providerProposalSchema, ProviderError, parseProviderJson, type ProviderCapabilities, type ProviderProposal, withProviderRetry } from "./contracts";

const PROVIDER_TIMEOUT_MS = 75_000;

function modelName() {
  const model = process.env.DEEPSEEK_REVIEW_MODEL;
  if (!model) throw new ProviderError("MODEL_NOT_CONFIGURED", "DEEPSEEK_REVIEW_MODEL no está configurado.", false);
  return model;
}

export async function reviewWithDeepSeek(prompt: string, options: { messages?: unknown[] } = {}): Promise<ProviderProposal> {
  const result = await reviewWithDeepSeekJson(prompt, providerProposalSchema, options);
  return { answer: result.answer, justification: result.justification ?? "", doubts: result.doubts ?? [], sourceEvidence: result.sourceEvidence ?? [], reviewScope: result.reviewScope };
}

export async function reviewWithDeepSeekJson<S extends z.ZodTypeAny>(prompt: string, schema: S, options: { messages?: unknown[] } = {}): Promise<z.output<S>> {
  return (await reviewWithDeepSeekJsonWithMetadata(prompt, schema, options)).value;
}

export async function reviewWithDeepSeekJsonWithMetadata<S extends z.ZodTypeAny>(prompt: string, schema: S, options: { messages?: unknown[] } = {}): Promise<{ value: z.output<S>; usage?: { inputTokens?: number; outputTokens?: number } }> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new ProviderError("PROVIDER_NOT_CONFIGURED", "DEEPSEEK_API_KEY no está configurada.", false);
  const response = await withProviderRetry(async () => {
    try {
      return await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: modelName(), messages: options.messages ?? [{ role: "user", content: prompt }], response_format: { type: "json_object" } }),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      }).then(async (result) => {
        if (!result.ok) {
          const retryable = result.status === 429 || result.status >= 500;
          const retryAfter = Number(result.headers.get("retry-after"));
          throw new ProviderError("DEEPSEEK_REQUEST_FAILED", `DeepSeek respondió HTTP ${result.status}.`, retryable, result.status, Number.isFinite(retryAfter) ? retryAfter * 1_000 : undefined);
        }
        return result;
      });
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new ProviderError("DEEPSEEK_TIMEOUT", "DeepSeek tardó demasiado en responder.", true, 504);
      throw error;
    }
  });
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const text = payload.choices?.[0]?.message?.content;
  if (!text) throw new ProviderError("EMPTY_PROVIDER_OUTPUT", "DeepSeek no devolvió contenido textual.", false);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ProviderError("INVALID_PROVIDER_JSON", "DeepSeek devolvió JSON inválido.", false); }
  const normalized = parsed && typeof parsed === "object" ? { ...(parsed as Record<string, unknown>), reviewScope: (parsed as Record<string, unknown>).reviewScope ?? "text_only" } : parsed;
  return { value: parseProviderJson(normalized, schema), usage: payload.usage ? { inputTokens: payload.usage.prompt_tokens, outputTokens: payload.usage.completion_tokens } : undefined };
}

export function deepseekCapabilities(): ProviderCapabilities {
  return { provider: "deepseek", model: process.env.DEEPSEEK_REVIEW_MODEL ?? null, configured: Boolean(process.env.DEEPSEEK_API_KEY), text: true, vision: process.env.DEEPSEEK_REVIEW_MODEL === "deepseek-flash" ? "unverified" : "unsupported", search: "unsupported", structuredJson: "unverified" };
}
