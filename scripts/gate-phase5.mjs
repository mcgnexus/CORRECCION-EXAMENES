#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { del, list, put } from "@vercel/blob";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const baseUrl = (process.env.GATE_URL ?? "").replace(/\/$/, "");
const login = process.env.GATE_LOGIN ?? "";
const password = process.env.GATE_PASSWORD ?? "";
const gateOwner = process.env.GATE_OWNER ?? login;
const blobToken = process.env.BLOB_READ_WRITE_TOKEN ?? "";
const cronSecret = process.env.GATE_CRON_SECRET ?? process.env.CRON_SECRET ?? "";
const reportPath = process.env.GATE_REPORT ?? "docs/phase5-report.md";
const artifactDir = process.env.GATE_ARTIFACT_DIR ?? join(".gate", `phase5-${Date.now()}`);
const timeoutMs = Number(process.env.GATE_TIMEOUT_MS ?? 15 * 60_000);
const strict = process.env.GATE_STRICT !== "false";

if (!baseUrl || !login || !password || !gateOwner || !blobToken || !cronSecret) {
  throw new Error("Faltan GATE_URL, GATE_LOGIN, GATE_PASSWORD, GATE_OWNER, BLOB_READ_WRITE_TOKEN o GATE_CRON_SECRET.");
}

const checks = [];
const metrics = { startedAt: new Date().toISOString(), phases: {}, provider: {}, exports: [], cleanup: {}, jobs: [] };
let cookie = "";

function now() { return Date.now(); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function record(name, passed, evidence = "", detail = "") { checks.push({ name, passed, evidence, detail }); if (!passed && strict) throw new Error(`${name}: ${detail || evidence}`); }
function stage(name) { const started = now(); return () => { metrics.phases[name] = { durationMs: now() - started }; }; }
function idempotency(prefix) { return `${prefix}-${randomUUID()}`; }
function headerCookie(response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") ?? ""];
  return values.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  headers.set("origin", baseUrl);
  if (cookie) headers.set("cookie", cookie);
  if (options.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  const result = { response, body, etag: response.headers.get("etag") ?? "", requestId: response.headers.get("x-request-id") ?? body.requestId ?? "" };
  if (!response.ok) {
    const error = new Error(`${options.method ?? "GET"} ${path} -> ${response.status} ${body?.error?.code ?? body?.error?.message ?? text}`);
    error.status = response.status; error.result = result; throw error;
  }
  return result;
}

async function loginGate() {
  const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ login, password }) });
  cookie = headerCookie(result.response);
  if (!cookie) throw new Error("El login no devolvio cookie de sesion.");
}

async function pollRun(runId) {
  const started = now();
  while (now() - started < timeoutMs) {
    const result = await api(`/api/phase0/workflow/${runId}`);
    const status = result.body?.data?.status;
    if (status === "completed") return result.body.data;
    if (["failed", "cancelled"].includes(status)) throw new Error(`Workflow ${runId} termino en ${status}.`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timeout esperando workflow ${runId}.`);
}

async function pollJob(jobId, accepted = ["completed"]) {
  const started = now();
  let last;
  while (now() - started < timeoutMs) {
    const result = await api(`/api/jobs/${jobId}`);
    last = result.body?.data;
    if (accepted.includes(last?.status)) { metrics.jobs.push(last); return { ...result, job: last }; }
    if (["failed", "cancelled"].includes(last?.status)) { metrics.jobs.push(last); return { ...result, job: last }; }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timeout esperando job ${jobId}. Ultimo estado: ${last?.status ?? "desconocido"}`);
}

function buildTemplate(questionIds) {
  const bubbles = [];
  for (let questionIndex = 0; questionIndex < questionIds.length; questionIndex += 1) {
    for (let optionIndex = 0; optionIndex < 4; optionIndex += 1) bubbles.push({ questionId: questionIds[questionIndex], optionId: String.fromCharCode(65 + optionIndex), x: 0.12 + optionIndex * 0.18, y: 0.18 + questionIndex * 0.13, width: 0.08, height: 0.08 });
  }
  return { canvasWidth: 1000, canvasHeight: 930, sourceAnchors: [[0.04, 0.04], [0.96, 0.04], [0.96, 0.96], [0.04, 0.96]], targetAnchors: [[0, 0], [1, 0], [1, 1], [0, 1]], bubbles, preprocess: { rotation: 0, brightness: 1, contrast: 1 }, threshold: 0.3, margin: 0.08, algorithmVersion: "gate-phase5-omr-1" };
}

function renderSheet(template, pageIndex, questionIds) {
  const canvas = createCanvas(template.canvasWidth, template.canvasHeight);
  const context = canvas.getContext("2d");
  context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "black";
  for (const [x, y] of [[40, 40], [920, 40], [920, 850], [40, 850]]) context.fillRect(x, y, 40, 40);
  const mode = pageIndex === 25 ? "blank" : pageIndex === 26 ? "multiple" : pageIndex === 27 ? "ambiguous" : "normal";
  for (const bubble of template.bubbles) {
    const x = bubble.x * canvas.width; const y = bubble.y * canvas.height; const width = bubble.width * canvas.width; const height = bubble.height * canvas.height;
    context.strokeStyle = "#777"; context.lineWidth = 2; context.strokeRect(x, y, width, height);
    const questionIndex = questionIds.indexOf(bubble.questionId);
    const optionIndex = bubble.optionId.charCodeAt(0) - 65;
    const selected = mode === "blank" ? false : mode === "multiple" ? optionIndex < 2 && questionIndex === 0 : mode === "ambiguous" ? optionIndex === (questionIndex % 2) && questionIndex === 0 : optionIndex === ((pageIndex + questionIndex) % 4);
    if (selected) { context.fillStyle = mode === "ambiguous" ? "#999" : "black"; context.beginPath(); context.arc(x + width / 2, y + height / 2, Math.min(width, height) * 0.31, 0, Math.PI * 2); context.fill(); }
  }
  context.fillStyle = "black"; context.font = "24px sans-serif"; context.fillText("Respuesta sintetica revisada", 120, 790);
  return canvas.toBuffer("image/png");
}

async function createSourcePdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([595, 842]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const lines = ["Gate Fase 5 - examen sintetico", "Pregunta 1: Selecciona la opcion correcta. A) Uno B) Dos C) Tres D) Cuatro", "Pregunta 2: Selecciona la opcion correcta. A) Uno B) Dos C) Tres D) Cuatro", "Pregunta 3: Selecciona la opcion correcta. A) Uno B) Dos C) Tres D) Cuatro", "Pregunta 4: Selecciona la opcion correcta. A) Uno B) Dos C) Tres D) Cuatro", "Pregunta 5: Selecciona la opcion correcta. A) Uno B) Dos C) Tres D) Cuatro", "Pregunta 6: Explica brevemente por que la respuesta es valida."];
  lines.forEach((line, index) => page.drawText(line, { x: 42, y: 780 - index * 42, size: 12, font, color: rgb(0, 0, 0) }));
  return new Uint8Array(await document.save({ useObjectStreams: false }));
}

async function uploadAsset(examId, bytes, mimeType, suffix) {
  const assetId = randomUUID();
  const pathname = `owners/${gateOwner}/exams/${examId}/assets/${assetId}/original`;
  await put(pathname, bytes, { access: "private", token: blobToken, addRandomSuffix: false, contentType: mimeType });
  const completed = await api(`/api/exams/${examId}/assets/complete`, { method: "POST", body: JSON.stringify({ assetId, pathname }) });
  return { assetId, pathname, suffix, data: completed.body.data };
}

function decisionForQuestion(question) {
  const open = ["short_text", "essay"].includes(question.type);
  if (open) return { questionId: question.questionId, sectionId: "open", answer: null, explanation: "Decision sintetica revisada por humano en gate.", rubric: { criteria: [{ id: `criterion-${question.questionId}`, description: "Identifica la idea principal.", maxPoints: 2, requiredEvidence: "Respuesta coherente.", validAlternatives: [], partialScoring: "Puntuacion proporcional.", commonErrors: [], dependsOnCriterionIds: [] }], totalMax: 2 }, proposalIds: [], sourceEvidenceIds: [], humanNote: "Gate Fase 5", resolved: true };
  return { questionId: question.questionId, sectionId: "test", answer: { selectedOptionIds: [question.options?.[0]?.label ?? "A"] }, explanation: "Clave sintetica revisada por humano en gate.", rubric: { criteria: [], totalMax: 0 }, proposalIds: [], sourceEvidenceIds: [], humanNote: "Gate Fase 5", resolved: true };
}

async function listGateBlobs() {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix: `owners/${gateOwner}/`, cursor, token: blobToken });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function purgeGatePrefix() {
  const blobs = await listGateBlobs();
  for (const blob of blobs) await del(blob.url, { token: blobToken });
  return blobs.length;
}

async function verifyDownload(exportId, expectedMime) {
  const result = await fetch(`${baseUrl}/api/exports/${exportId}/download`, { headers: { cookie } });
  const bytes = new Uint8Array(await result.arrayBuffer());
  if (!result.ok || !bytes.length || result.headers.get("content-type")?.split(";", 1)[0] !== expectedMime) throw new Error(`Descarga invalida para ${exportId}: ${result.status}`);
  return { bytes, sha256: sha256(bytes), expiresAt: result.headers.get("x-export-expires-at"), contentType: result.headers.get("content-type") };
}

async function run() {
  await mkdir(artifactDir, { recursive: true });
  const localStart = now();
  await loginGate();
  const providerProbe = await api("/api/phase0/providers", { method: "POST", body: JSON.stringify({}) });
  metrics.provider = providerProbe.body.data;
  record("providers-reales", metrics.provider?.gemini?.probe === "ok" && metrics.provider?.deepseek?.probe === "ok", providerProbe.requestId, JSON.stringify(metrics.provider));

  const setupDone = stage("setup");
  const examResponse = await api("/api/exams", { method: "POST", headers: { "idempotency-key": idempotency("gate-exam") }, body: JSON.stringify({ title: "Gate Fase 5 sintetico", subject: "Validacion", modelIds: ["gate"] }) });
  const examId = examResponse.body.data.examId;
  const sourcePdf = await createSourcePdf();
  const sourceAsset = await uploadAsset(examId, sourcePdf, "application/pdf", "source.pdf");
  let pages = await api(`/api/exams/${examId}/pages`);
  const extract = await api(`/api/exams/${examId}/extract`, { method: "POST", headers: { "idempotency-key": idempotency("gate-extract") }, body: JSON.stringify({ expectedPagesEtag: pages.etag, language: "es" }) });
  await pollRun(extract.body.data.runId);
  let structure = await api(`/api/exams/${examId}/revisions/${extract.body.data.revisionId}/structure`);
  const proposal = structure.body.data.proposals.find((item) => item.questions.length >= 5);
  if (!proposal) throw new Error("La extraccion no produjo una propuesta con cinco preguntas.");
  const selected = await api(`/api/exams/${examId}/revisions/${extract.body.data.revisionId}/structure`, { method: "PATCH", body: JSON.stringify({ expectedEtag: structure.etag, activeStructureProposalId: proposal.proposalId, blockingIssues: [], status: "solving" }) });
  const solve = await api(`/api/exams/${examId}/solve`, { method: "POST", headers: { "idempotency-key": idempotency("gate-solve") }, body: JSON.stringify({ revisionId: extract.body.data.revisionId, structureProposalId: proposal.proposalId }) });
  await pollRun(solve.body.data.runId);
  const answerKeyResponse = await api(`/api/exams/${examId}/revisions/${extract.body.data.revisionId}/answer-key`);
  const decisions = Object.fromEntries(proposal.questions.map((question) => [question.questionId, decisionForQuestion(question)]));
  const keyUpdated = await api(`/api/exams/${examId}/revisions/${extract.body.data.revisionId}/answer-key`, { method: "PATCH", body: JSON.stringify({ expectedEtag: answerKeyResponse.etag, status: "review", decisions, blockingIssues: [] }) });
  const keyApproved = await api(`/api/exams/${examId}/revisions/${extract.body.data.revisionId}/answer-key/approve`, { method: "POST", body: JSON.stringify({ expectedEtag: keyUpdated.etag }) });
  const policy = { schemaVersion: 1, policyId: "policy-default", scaleMax: 10, correctPoints: 1, blankPoints: 0, incorrectPenalty: -0.25, multipleMarkHandling: "pending", minimumScore: 0, decimals: 2, sections: [{ sectionId: "test", maxPoints: 5, weightBasisPoints: 7500, kind: "test" }, { sectionId: "open", maxPoints: 2, weightBasisPoints: 2500, kind: "open" }], confirmed: true };
  const testQuestions = proposal.questions.filter((question) => !["short_text", "essay"].includes(question.type)).slice(0, 5);
  const template = buildTemplate(testQuestions.map((question) => question.questionId));
  await writeFile(join(artifactDir, "fixture.json"), JSON.stringify({ fixture: "phase5-synthetic", pageCount: 30, questionIds: testQuestions.map((question) => question.questionId), expectedModes: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [index + 1, index === 25 ? "blank" : index === 26 ? "multiple" : index === 27 ? "ambiguous" : "resolvable"])), includesOpenQuestion: true }, null, 2));
  const templateResponse = await api(`/api/exams/${examId}/omr-template`, { method: "POST", body: JSON.stringify(template) });
  const approvedTemplate = await api(`/api/exams/${examId}/omr-template/${templateResponse.body.data.templateId}`, { method: "POST", body: JSON.stringify({ expectedEtag: templateResponse.etag }) });
  const pngAssets = [];
  for (let index = 0; index < 30; index += 1) pngAssets.push(await uploadAsset(examId, renderSheet(template, index, testQuestions.map((question) => question.questionId)), "image/png", `page-${index + 1}.png`));
  pages = await api(`/api/exams/${examId}/pages`);
  const sourcePage = pages.body.data.pages[0];
  const extraPages = pngAssets.map((asset, index) => ({ schemaVersion: 1, pageId: randomUUID(), examId, ownerId: gateOwner, sourceAssetId: asset.assetId, pageNumber: index + 1, order: index, rotation: 0 }));
  const pageManifest = await api(`/api/exams/${examId}/pages`, { method: "PATCH", body: JSON.stringify({ expectedEtag: pages.etag, pages: [sourcePage, ...extraPages], groups: [] }) });
  const batchResponse = await api(`/api/exams/${examId}/batches`, { method: "POST", headers: { "idempotency-key": idempotency("gate-batch") }, body: JSON.stringify({ answerKeyRevisionId: keyApproved.body.data.answerKeyRevisionId, templateRevisionId: approvedTemplate.body.data.templateId, scoringPolicyRevisionId: policy.policyId, scoringPolicy: policy, maxPages: 30 }) });
  const batchId = batchResponse.body.data.batchId;
  const overLimit = await fetch(`${baseUrl}/api/exams/${examId}/batches`, { method: "POST", headers: { "content-type": "application/json", origin: baseUrl, cookie, "idempotency-key": idempotency("gate-over-limit") }, body: JSON.stringify({ answerKeyRevisionId: keyApproved.body.data.answerKeyRevisionId, templateRevisionId: approvedTemplate.body.data.templateId, scoringPolicyRevisionId: policy.policyId, scoringPolicy: policy, maxPages: 31 }) });
  record("limite-maximo-30", overLimit.status === 400, "create-batch", `status=${overLimit.status}`);
  const submission = await api(`/api/exams/${examId}/batches/${batchId}/submissions`, { method: "POST", body: JSON.stringify({ assetIds: pngAssets.map((asset) => asset.assetId) }) });
  const submissionId = submission.body.data.submissionId;
  await api(`/api/exams/${examId}/batches/${batchId}/submissions/${submissionId}`, { method: "POST", body: JSON.stringify({ action: "confirm-identity", identity: "=2+2" }) });
  const openQuestion = proposal.questions.find((question) => ["short_text", "essay"].includes(question.type));
  if (!openQuestion) throw new Error("La propuesta no contiene una pregunta abierta para el gate.");
  const region = await api(`/api/exams/${examId}/batches/${batchId}/submissions/${submissionId}/responses/regions`, { method: "PATCH", body: JSON.stringify({ regions: [{ questionId: openQuestion.questionId, questionType: openQuestion.type, pageId: submission.body.data.pageIds[0], sourceAssetId: pngAssets[0].assetId, rect: { x: 0.1, y: 0.72, width: 0.8, height: 0.18 }, order: 0 }] }) });
  setupDone();

  const processingDone = stage("processing");
  const batch = await api(`/api/exams/${examId}/batches/${batchId}`);
  const staleStart = await fetch(`${baseUrl}/api/exams/${examId}/batches/${batchId}/start`, { method: "POST", headers: { "content-type": "application/json", origin: baseUrl, cookie, "idempotency-key": idempotency("gate-stale-start") }, body: JSON.stringify({ expectedEtag: "stale-etag" }) });
  record("start-stale-etag-rechazado", staleStart.status === 409, staleStart.headers.get("x-request-id") ?? "", `status=${staleStart.status}`);
  const startKey = idempotency("gate-process");
  const started = await api(`/api/exams/${examId}/batches/${batchId}/start`, { method: "POST", headers: { "idempotency-key": startKey }, body: JSON.stringify({ expectedEtag: batch.etag, concurrency: 1, maxAttempts: 3 }) });
  const replay = await api(`/api/exams/${examId}/batches/${batchId}/start`, { method: "POST", headers: { "idempotency-key": startKey }, body: JSON.stringify({ expectedEtag: batch.etag, concurrency: 1, maxAttempts: 3 }) });
  record("idempotencia-start", replay.body.replayed === true && replay.body.data.jobId === started.body.data.jobId, replay.requestId, "El segundo start debe devolver el mismo job.");
  const cancelHeaders = { "if-match": started.etag };
  const cancelResponse = await fetch(`${baseUrl}/api/jobs/${started.body.data.jobId}/cancel`, { method: "POST", headers: { ...cancelHeaders, origin: baseUrl, cookie } });
  const cancelBody = await cancelResponse.json();
  const cancellationObserved = cancelResponse.ok && ["cancel_requested", "cancelled"].includes(cancelBody.data?.status);
  record("cancelacion-cooperativa", cancellationObserved, cancelBody.requestId, JSON.stringify(cancelBody));
  const firstJob = await pollJob(started.body.data.jobId, ["cancelled", "completed"]);
  let resumedJob = firstJob.job;
  if (firstJob.job.status === "cancelled") {
    const resumeBatch = await api(`/api/exams/${examId}/batches/${batchId}`);
    const resumed = await api(`/api/exams/${examId}/batches/${batchId}/start`, { method: "POST", headers: { "idempotency-key": idempotency("gate-resume") }, body: JSON.stringify({ expectedEtag: resumeBatch.etag, concurrency: 1, maxAttempts: 3 }) });
    resumedJob = (await pollJob(resumed.body.data.jobId)).job;
  }
  record("job-completado", resumedJob.status === "completed", resumedJob.jobId, JSON.stringify({ status: resumedJob.status, progress: resumedJob.progress }));
  record("batch-en-revision", (await api(`/api/exams/${examId}/batches/${batchId}`)).body.data.state === "review", "batch");
  processingDone();

  const reviewDone = stage("human-review");
  let submissionDetails = await api(`/api/exams/${examId}/batches/${batchId}/submissions/${submissionId}`);
  const ambiguous = submissionDetails.body.data.readings.flatMap((reading) => reading.rows.filter((row) => row.status !== "single" && row.status !== "blank").map((row) => ({ readingId: reading.readingId, row })));
  if (ambiguous.length) await api(`/api/exams/${examId}/batches/${batchId}/submissions/${submissionId}`, { method: "POST", body: JSON.stringify({ action: "decide", decisions: ambiguous.map(({ readingId, row }) => ({ readingId, questionId: row.questionId, originalStatus: row.status, resolvedStatus: "single", selectedOptionIds: [row.candidateOptionIds?.[0] ?? "A"], reason: "Resolucion sintetica del gate." })) }) });
  const responseData = await api(`/api/exams/${examId}/batches/${batchId}/submissions/${submissionId}/responses`);
  const proposedTranscription = responseData.body.data.transcriptions.find((item) => item.state === "proposed");
  if (!proposedTranscription) throw new Error("No se genero transcripcion propuesta.");
  await api(`/api/exams/${examId}/batches/${batchId}/submissions/${submissionId}/responses/transcriptions/${proposedTranscription.transcriptionId}`, { method: "PATCH", body: JSON.stringify({ expectedEtag: proposedTranscription.etag, correctedText: proposedTranscription.literalText ?? "Respuesta sintetica confirmada.", confirm: true }) });
  submissionDetails = await api(`/api/exams/${examId}/batches/${batchId}/submissions/${submissionId}`);
  const evaluationStart = await api(`/api/exams/${examId}/batches/${batchId}/submissions/${submissionId}/responses/evaluate`, { method: "POST", headers: { "idempotency-key": idempotency("gate-evaluate") }, body: JSON.stringify({ expectedEtag: submissionDetails.etag, answerKeyRevisionId: keyApproved.body.data.answerKeyRevisionId }) });
  await pollRun(evaluationStart.body.data.runId);
  const evaluated = await api(`/api/exams/${examId}/batches/${batchId}/submissions/${submissionId}/responses`);
  const evaluations = evaluated.body.data.evaluations.filter((item) => item.state === "completed");
  record("evaluaciones-gemini-deepseek", new Set(evaluations.map((item) => item.provider)).size >= 2, evaluated.requestId, JSON.stringify(evaluations.map((item) => item.provider)));
  const confirmed = evaluated.body.data.transcriptions.find((item) => item.state === "confirmed");
  const selectedEvaluation = evaluations.find((item) => item.transcriptionId === confirmed?.transcriptionId && item.provider === "gemini") ?? evaluations[0];
  submissionDetails = await api(`/api/exams/${examId}/batches/${batchId}/submissions/${submissionId}`);
  await api(`/api/exams/${examId}/batches/${batchId}/submissions/${submissionId}/responses/decisions`, { method: "POST", body: JSON.stringify({ expectedEtag: submissionDetails.etag, decisions: [{ questionId: openQuestion.questionId, transcriptionId: confirmed.transcriptionId, source: selectedEvaluation ? selectedEvaluation.provider : "manual", selectedEvaluationId: selectedEvaluation?.evaluationId, manualCriterionScores: selectedEvaluation ? undefined : [{ criterionId: `criterion-${openQuestion.questionId}`, points: 2, evidence: "Respuesta sintetica." }], reason: "Decision humana del gate." }] }) });
  await api(`/api/exams/${examId}/batches/${batchId}/submissions/${submissionId}`, { method: "POST", body: JSON.stringify({ action: "score" }) });
  reviewDone();

  const closeDone = stage("close-and-export");
  submissionDetails = await api(`/api/exams/${examId}/batches/${batchId}/submissions/${submissionId}`);
  const snapshot = submissionDetails.body.data.snapshot;
  if (!snapshot) throw new Error("No hay snapshot tras el score.");
  const batchBeforeClose = await api(`/api/exams/${examId}/batches/${batchId}`);
  await api(`/api/exams/${examId}/batches/${batchId}/submissions/${submissionId}/close`, { method: "POST", body: JSON.stringify({ expectedEtag: submissionDetails.etag, snapshotExpectedEtag: submissionDetails.body.data.snapshotEtag }) });
  const finalized = await api(`/api/exams/${examId}/batches/${batchId}/finalize`, { method: "POST", body: JSON.stringify({ expectedEtag: batchBeforeClose.etag }) });
  const stale = await fetch(`${baseUrl}/api/exams/${examId}/batches/${batchId}/finalize`, { method: "POST", headers: { "content-type": "application/json", origin: baseUrl, cookie }, body: JSON.stringify({ expectedEtag: batchBeforeClose.etag }) });
  record("finalizacion-stale-etag", stale.status === 409, stale.headers.get("x-request-id") ?? "", `status=${stale.status}`);
  const exportStart = await api(`/api/exams/${examId}/batches/${batchId}/export`, { method: "POST", headers: { "idempotency-key": idempotency("gate-export") }, body: JSON.stringify({ formats: ["csv", "xlsx", "pdf"], includeOriginal: false, expectedEtag: finalized.etag, retentionHours: 24 }) });
  const exportJob = (await pollJob(exportStart.body.data.jobId)).job;
  const exportMimes = ["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/pdf"];
  for (const [index, exportId] of exportJob.outputRefs.entries()) {
    const downloaded = await verifyDownload(exportId, exportMimes[index]);
    if (index === 0 && !new TextDecoder().decode(downloaded.bytes).includes("'=2+2")) throw new Error("El CSV no neutralizo la celda tipo formula.");
    if (index === 1) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(downloaded.bytes);
      if (workbook.getWorksheet("results")?.getCell("B2").value !== "'=2+2") throw new Error("El XLSX no neutralizo la celda tipo formula.");
    }
    if (index === 2 && new TextDecoder().decode(downloaded.bytes.slice(0, 5)) !== "%PDF-") throw new Error("El PDF descargado no tiene cabecera PDF.");
    metrics.exports.push({ exportId, ...downloaded, bytes: downloaded.bytes.byteLength });
  }
  const shortExportStart = await api(`/api/exams/${examId}/batches/${batchId}/export`, { method: "POST", headers: { "idempotency-key": idempotency("gate-export-retention") }, body: JSON.stringify({ formats: ["csv"], includeOriginal: false, expectedEtag: finalized.etag, retentionHours: 0.001 }) });
  const shortExportJob = (await pollJob(shortExportStart.body.data.jobId)).job;
  const shortExportId = shortExportJob.outputRefs[0];
  await new Promise((resolve) => setTimeout(resolve, 6_000));
  const shortCron = await fetch(`${baseUrl}/api/cron/cleanup-exports`, { headers: { authorization: `Bearer ${cronSecret}`, cookie } });
  if (!shortCron.ok) throw new Error(`El Cron de retencion corta fallo: ${shortCron.status}`);
  const expiredDownload = await fetch(`${baseUrl}/api/exports/${shortExportId}/download`, { headers: { cookie } });
  record("retencion-y-borrado", [404, 410].includes(expiredDownload.status), shortExportId, `status=${expiredDownload.status}`);
  closeDone();

  const unauthorized = await fetch(`${baseUrl}/api/exports/${exportJob.outputRefs[0]}/download`);
  record("descarga-sin-sesion-rechazada", [401, 403].includes(unauthorized.status), "download", `status=${unauthorized.status}`);
  const unauthorizedAsset = await fetch(`${baseUrl}/api/assets/${pngAssets[0].assetId}/metadata`);
  record("metadata-sin-sesion-rechazada", [401, 403].includes(unauthorizedAsset.status), "asset", `status=${unauthorizedAsset.status}`);
  const cronUnauthorized = await fetch(`${baseUrl}/api/cron/cleanup-exports`);
  record("cron-sin-secreto-rechazado", cronUnauthorized.status === 401, "cron", `status=${cronUnauthorized.status}`);
  const cronAuthorized = await fetch(`${baseUrl}/api/cron/cleanup-exports`, { headers: { authorization: `Bearer ${cronSecret}`, cookie } });
  record("cron-autenticado", cronAuthorized.status === 200, cronAuthorized.headers.get("x-request-id") ?? "", `status=${cronAuthorized.status}`);
  metrics.cleanup.prefix = `owners/${gateOwner}/`;
  metrics.cleanup.purgedByHarness = await purgeGatePrefix();
  metrics.cleanup.remaining = (await listGateBlobs()).length;
  record("limpieza-owner-aislado", metrics.cleanup.remaining === 0, metrics.cleanup.prefix, JSON.stringify(metrics.cleanup));
  metrics.finishedAt = new Date().toISOString(); metrics.durationMs = now() - localStart; metrics.examId = examId; metrics.batchId = batchId; metrics.submissionId = submissionId; metrics.jobId = resumedJob.jobId;
  await writeFile(join(artifactDir, "metrics.json"), JSON.stringify(metrics, null, 2));
  await writeReport();
}

async function writeReport(error) {
  const outcome = checks.every((check) => check.passed) && !error ? "PASS" : "FAIL";
  const rows = checks.map((check) => `| ${check.passed ? "PASS" : "FAIL"} | ${check.name} | ${check.evidence} | ${String(check.detail).replaceAll("|", "\\|")} |`).join("\n");
  const report = [
    "# Gate final de aceptacion de Fase 5",
    "",
    `- Resultado: **${outcome}**`,
    `- Preview: ${baseUrl}`,
    `- Owner aislado: ${gateOwner.slice(0, 6)}...`,
    `- Inicio: ${metrics.startedAt}`,
    `- Fin: ${metrics.finishedAt ?? "no completado"}`,
    `- Duracion: ${metrics.durationMs ?? "no disponible"} ms`,
    "",
    "## Metricas",
    "",
    "```json",
    JSON.stringify(metrics, null, 2),
    "```",
    "",
    "## Criterios",
    "",
    "| Resultado | Criterio | Evidencia | Detalle |",
    "|---|---|---|---|",
    rows,
    "",
    "## Limitaciones",
    "",
    "- Fixture OMR sintetico; no demuestra precision general sobre manuscritos reales.",
    "- Los costes monetarios se muestran solo si el proveedor reporta tarifa configurada.",
    "- El Cron de Production corre diariamente en el plan Hobby; el gate invoca el endpoint manualmente.",
    "- El OMR puede ejecutarse en el host estable configurado en OMR_SERVICE_URL.",
    "",
  ].join("\n");
  await writeFile(reportPath, report);
}

run().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  try { metrics.cleanup.purgedByHarness = await purgeGatePrefix(); metrics.cleanup.remaining = (await listGateBlobs()).length; } catch (cleanupError) { console.error(cleanupError); }
  try { await writeReport(error); } catch (reportError) { console.error(reportError); }
  process.exitCode = 1;
});
