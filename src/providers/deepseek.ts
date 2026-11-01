import { providerProposalSchema, ProviderError, parseProviderJson, type ProviderCapabilities, type ProviderProposal } from "./contracts";

function modelName() {
  const model = process.env.DEEPSEEK_REVIEW_MODEL;
  if (!model) throw new ProviderError("MODEL_NOT_CONFIGURED", "DEEPSEEK_REVIEW_MODEL no está configurado.", false);
  return model;
}

export async function reviewWithDeepSeek(prompt: string, options: { messages?: unknown[] } = {}): Promise<ProviderProposal> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new ProviderError("PROVIDER_NOT_CONFIGURED", "DEEPSEEK_API_KEY no está configurada.", false);
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: modelName(),
      messages: options.messages ?? [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new ProviderError("DEEPSEEK_REQUEST_FAILED", `DeepSeek respondió HTTP ${response.status}.`, retryable, response.status);
  }
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = payload.choices?.[0]?.message?.content;
  if (!text) throw new ProviderError("EMPTY_PROVIDER_OUTPUT", "DeepSeek no devolvió contenido textual.", false);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ProviderError("INVALID_PROVIDER_JSON", "DeepSeek devolvió JSON inválido.", false); }
  const normalized = parsed && typeof parsed === "object" ? { ...(parsed as Record<string, unknown>), reviewScope: (parsed as Record<string, unknown>).reviewScope ?? "text_only" } : parsed;
  return parseProviderJson(normalized, providerProposalSchema);
}

export function deepseekCapabilities(): ProviderCapabilities {
  return { provider: "deepseek", model: process.env.DEEPSEEK_REVIEW_MODEL ?? null, configured: Boolean(process.env.DEEPSEEK_API_KEY), text: true, vision: "unverified", search: "unsupported", structuredJson: "unverified" };
}
