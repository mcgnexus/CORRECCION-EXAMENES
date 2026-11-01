import { deepseekCapabilities, reviewWithDeepSeek } from "@/providers/deepseek";
import { geminiCapabilities, solveWithGemini } from "@/providers/gemini";

const probePrompt = "Devuelve JSON con answer='ok', justification='synthetic probe', doubts=[], sourceEvidence=[] y reviewScope='text_only'. No uses datos reales.";
const syntheticPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export async function POST(request: Request) {
  if (!process.env.INTERNAL_SERVICE_SECRET || request.headers.get("x-internal-service-secret") !== process.env.INTERNAL_SERVICE_SECRET) {
    return Response.json({ error: "SERVICE_AUTH_REQUIRED" }, { status: 403 });
  }
  let geminiResult: Record<string, unknown> = { ...geminiCapabilities(), probe: "not_run" };
  let deepseekResult: Record<string, unknown> = { ...deepseekCapabilities(), probe: "not_run" };
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_SOLVE_MODEL) {
    try {
      const proposal = await solveWithGemini(probePrompt, { parts: [{ text: probePrompt }, { inlineData: { mimeType: "image/png", data: syntheticPng } }] });
      geminiResult = { ...geminiCapabilities(), probe: "ok", visionProbe: "ok", structuredOutput: proposal.reviewScope };
    } catch (error) {
      geminiResult = { ...geminiCapabilities(), probe: "failed", error: error instanceof Error ? error.message : "unknown" };
    }
    try {
      const proposal = await solveWithGemini(probePrompt, { useSearch: true });
      geminiResult = { ...geminiResult, searchProbe: "ok", searchReviewScope: proposal.reviewScope };
    } catch (error) {
      geminiResult = { ...geminiResult, searchProbe: "failed", searchError: error instanceof Error ? error.message : "unknown" };
    }
  }
  if (process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_REVIEW_MODEL) {
    try {
      const proposal = await reviewWithDeepSeek(probePrompt, { messages: [{ role: "user", content: [{ type: "text", text: probePrompt }, { type: "image_url", image_url: { url: `data:image/png;base64,${syntheticPng}`, detail: "low" } }] }] });
      deepseekResult = { ...deepseekCapabilities(), probe: "ok", visionProbe: "ok", structuredOutput: proposal.reviewScope };
    } catch (error) {
      deepseekResult = { ...deepseekCapabilities(), probe: "failed", error: error instanceof Error ? error.message : "unknown" };
    }
  }
  return Response.json({ result: { gemini: geminiResult, deepseek: deepseekResult } });
}
