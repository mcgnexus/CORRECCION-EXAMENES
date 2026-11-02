import { z } from "zod";
import { providerProposalSchema, ProviderError, parseProviderJson, type ProviderCapabilities, type ProviderProposal, withProviderRetry } from "./contracts";

const endpoint = "https://generativelanguage.googleapis.com/v1beta/models";

function modelName() {
  const model = process.env.GEMINI_SOLVE_MODEL;
  if (!model) throw new ProviderError("MODEL_NOT_CONFIGURED", "GEMINI_SOLVE_MODEL no está configurado.", false);
  return model;
}

async function request(model: string, body: unknown) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ProviderError("PROVIDER_NOT_CONFIGURED", "GEMINI_API_KEY no está configurada.", false);
  const response = await fetch(`${endpoint}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new ProviderError("GEMINI_REQUEST_FAILED", `Gemini respondió HTTP ${response.status}.`, retryable, response.status, Number.isFinite(retryAfter) ? retryAfter * 1_000 : undefined);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

function extractText(payload: Record<string, unknown>) {
  const candidates = payload.candidates;
  const first = Array.isArray(candidates) ? candidates[0] : undefined;
  const content = first && typeof first === "object" ? (first as Record<string, unknown>).content : undefined;
  const parts = content && typeof content === "object" ? (content as Record<string, unknown>).parts : undefined;
  const text = Array.isArray(parts) ? parts.find((part) => typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") : undefined;
  return text && typeof text === "object" ? (text as Record<string, string>).text : undefined;
}

export async function solveWithGemini(prompt: string, options: { parts?: unknown[]; useSearch?: boolean } = {}): Promise<ProviderProposal> {
  const result = await generateGeminiJson(prompt, providerProposalSchema, { ...options, model: "solve" });
  return { answer: result.answer, justification: result.justification ?? "", doubts: result.doubts ?? [], sourceEvidence: result.sourceEvidence ?? [], reviewScope: result.reviewScope };
}

export async function generateGeminiJson<S extends z.ZodTypeAny>(prompt: string, schema: S, options: { parts?: unknown[]; useSearch?: boolean; model?: "solve" | "transcribe" } = {}): Promise<z.output<S>> {
  return (await generateGeminiJsonWithMetadata(prompt, schema, options)).value;
}

export async function generateGeminiJsonWithMetadata<S extends z.ZodTypeAny>(prompt: string, schema: S, options: { parts?: unknown[]; useSearch?: boolean; model?: "solve" | "transcribe" } = {}): Promise<{ value: z.output<S>; usage?: { inputTokens?: number; outputTokens?: number } }> {
  const model = options.model === "transcribe" ? process.env.GEMINI_TRANSCRIBE_MODEL : modelName();
  if (!model) throw new ProviderError("MODEL_NOT_CONFIGURED", "El modelo Gemini no está configurado.", false);
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: options.parts ?? [{ text: prompt }] }],
    generationConfig: options.useSearch ? {} : { responseMimeType: "application/json" },
  };
  if (options.useSearch) {
    // La forma exacta de la herramienta debe validarse contra la versión/API elegida en Fase 0.
    body.tools = [{ google_search: {} }];
  }
  const payload = await withProviderRetry(() => request(model, body));
  const text = extractText(payload);
  if (!text) throw new ProviderError("EMPTY_PROVIDER_OUTPUT", "Gemini no devolvió contenido textual.", false);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ProviderError("INVALID_PROVIDER_JSON", "Gemini devolvió JSON inválido.", false); }
  const normalized = parsed && typeof parsed === "object" ? { ...(parsed as Record<string, unknown>), reviewScope: (parsed as Record<string, unknown>).reviewScope ?? "text_only" } : parsed;
  const usageMetadata = payload.usageMetadata;
  const usage = usageMetadata && typeof usageMetadata === "object" ? {
    inputTokens: typeof (usageMetadata as Record<string, unknown>).promptTokenCount === "number" ? (usageMetadata as Record<string, number>).promptTokenCount : undefined,
    outputTokens: typeof (usageMetadata as Record<string, unknown>).candidatesTokenCount === "number" ? (usageMetadata as Record<string, number>).candidatesTokenCount : undefined,
  } : undefined;
  return { value: parseProviderJson(normalized, schema), usage };
}

export function geminiCapabilities(): ProviderCapabilities {
  return { provider: "gemini", model: process.env.GEMINI_SOLVE_MODEL ?? null, configured: Boolean(process.env.GEMINI_API_KEY), text: true, vision: "unverified", search: "unverified", structuredJson: "unverified" };
}
