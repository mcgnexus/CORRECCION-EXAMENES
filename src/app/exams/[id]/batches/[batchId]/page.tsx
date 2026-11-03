"use client";

import { upload } from "@vercel/blob/client";
import { useParams } from "next/navigation";
import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";

type Submission = { submissionId: string; state: string; pageIds: string[]; assetIds: string[]; suggestedIdentity?: string; identityConfidence?: number; identitySource?: string; confirmedIdentity?: string; readingIds: string[]; snapshotId?: string; responseBlockingIssues?: string[] };
type ReadingRow = { questionId: string; status: string; selectedOptionIds: string[]; candidateOptionIds: string[]; requiresHumanReview: boolean };
type Reading = { readingId: string; status: string; rows: ReadingRow[]; errorCode?: string };
type Page = { pageId: string; sourceAssetId: string; pageNumber: number; rotation: 0 | 90 | 180 | 270 };
type ResponseRegion = { regionId: string; questionId: string; questionType: "short_text" | "essay"; pageId: string; sourceAssetId: string; cropAssetId: string; rect: { x: number; y: number; width: number; height: number }; order: number };
type Transcription = { transcriptionId: string; questionId: string; literalText: string; normalizedText?: string; correctedText?: string; confidence: number; uncertainSpans: Array<{ text: string; reason: string }>; state: string; etag: string };
type Evaluation = { evaluationId: string; questionId: string; transcriptionId: string; provider: "gemini" | "deepseek"; criterionScores: Array<{ criterionId: string; points: number; maxPoints: number; evidence: string; incidents: string[] }>; totalPoints: number; maximumPoints: number; explanation: string; state: string };
type ResponseData = { regions: { regionRevisionId: string; regions: ResponseRegion[] } | null; transcriptions: Transcription[]; evaluations: Evaluation[]; decisions: Array<{ questionId: string; decisionId: string }>; blockingIssues: string[] };
type Snapshot = { score: number; correct: number; blank: number; incorrect: number; pending: number; blockingIssues: string[]; state: string; openPending?: number };
type Batch = { batchId: string; state: string; submissionIds: string[]; answerKeyRevisionId: string; templateRevisionId: string; scoringPolicyRevisionId: string };
type JobProgress = { phase: string; current: number; completed: number; total: number; percent: number; totalSubmissions?: number; completedSubmissions?: number; failedSubmissions?: number; blockedSubmissions?: number; totalPages?: number; completedPages?: number; totalQuestions?: number; completedQuestions?: number; currentSubmissionId?: string; currentPageId?: string; currentQuestionId?: string };
type BatchJob = { jobId: string; status: string; progress: JobProgress; outputRefs: string[]; errorCode?: string; cost?: { providerCalls?: number; inputTokens?: number; outputTokens?: number; retryCount?: number; amount?: number; currency?: string } };
type ExportJob = BatchJob;

export default function BatchPage() {
  const params = useParams<{ id: string; batchId: string }>();
  const base = `/api/exams/${params.id}/batches/${params.batchId}/submissions`;
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selected, setSelected] = useState<Submission | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [responseData, setResponseData] = useState<ResponseData | null>(null);
  const [answerKeyRevisionId, setAnswerKeyRevisionId] = useState("");
  const [openPending, setOpenPending] = useState(0);
  const [regionEtag, setRegionEtag] = useState("");
  const [regionPageId, setRegionPageId] = useState("");
  const [regionQuestionId, setRegionQuestionId] = useState("");
  const [regionQuestionType, setRegionQuestionType] = useState<"short_text" | "essay">("short_text");
  const [regionRect, setRegionRect] = useState({ x: 0.1, y: 0.1, width: 0.8, height: 0.2 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [manualPoints, setManualPoints] = useState<Record<string, Record<string, number>>>({});
  const [transcriptionEdits, setTranscriptionEdits] = useState<Record<string, string>>({});
  const [identity, setIdentity] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [batchEtag, setBatchEtag] = useState("");
  const [exportFormats, setExportFormats] = useState<string[]>(["csv", "xlsx", "pdf"]);
  const [includeOriginal, setIncludeOriginal] = useState(false);
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [exportJobEtag, setExportJobEtag] = useState("");
  const [batchJob, setBatchJob] = useState<BatchJob | null>(null);
  const [batchJobEtag, setBatchJobEtag] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [uploadingStudents, setUploadingStudents] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [answerKey, setAnswerKey] = useState<Record<string, { selectedOptionIds?: string[] }>>({});
  const [detailSnapshot, setDetailSnapshot] = useState<Snapshot | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(base);
    const payload = await response.json() as { data?: Submission[]; error?: { message?: string } };
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "No se pudo cargar el lote.");
    setSubmissions(payload.data);
    const fresh = payload.data.find((submission) => submission.submissionId === selectedIdRef.current) ?? null;
    setSelected(fresh);
    if (fresh) {
      const detailResponse = await fetch(`${base}/${fresh.submissionId}`);
      const detailPayload = await detailResponse.json() as { data?: { readings?: Reading[]; snapshot?: Snapshot | null }; error?: { message?: string } };
      if (detailResponse.ok) { setReading(detailPayload.data?.readings?.[0] ?? null); setDetailSnapshot(detailPayload.data?.snapshot ?? null); }
      else { setReading(null); setDetailSnapshot(null); }
    } else {
      setSelected(null);
      setReading(null);
    }
    const batchResponse = await fetch(`/api/exams/${params.id}/batches/${params.batchId}`);
    const batchPayload = await batchResponse.json() as { data?: Batch; error?: { message?: string } };
    if (batchResponse.ok && batchPayload.data) { setBatch(batchPayload.data); setBatchEtag(batchResponse.headers.get("etag") ?? ""); }
    const examResponse = await fetch(`/api/exams/${params.id}`);
    const examPayload = await examResponse.json() as { data?: { ownerId?: string } };
    if (examResponse.ok && examPayload.data?.ownerId) setOwnerId(examPayload.data.ownerId);
  }, [base, params.batchId, params.id]);

  async function uploadStudentExams(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length || !ownerId) return;
    setUploadingStudents(true);
    setMessage(null);
    for (const file of files) {
      const assetId = crypto.randomUUID();
      const pathname = `owners/${ownerId}/exams/${params.id}/assets/${assetId}/original`;
      try {
        const uploaded = await upload(pathname, file, { access: "private", contentType: file.type, handleUploadUrl: `/api/exams/${params.id}/assets/authorize` });
        const completion = await fetch(`/api/exams/${params.id}/assets/complete`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ assetId, pathname: uploaded.pathname }) });
        if (!completion.ok) throw new Error("La subida terminó, pero no pudo validarse el archivo.");
        const submission = await fetch(base, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ assetIds: [assetId] }) });
        const submissionPayload = await submission.json() as { error?: { message?: string } };
        if (!submission.ok) throw new Error(submissionPayload.error?.message ?? "No se pudo registrar la entrega.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : `No se pudo subir ${file.name}.`);
      }
    }
    setUploadingStudents(false);
    await load();
    event.target.value = "";
  }

  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : "Error de carga.")); }, [load]);

  useEffect(() => {
    if (!exportJob || !["queued", "running", "cancel_requested"].includes(exportJob.status)) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/jobs/${exportJob.jobId}`);
      const payload = await response.json() as { data?: ExportJob };
      if (payload.data) { setExportJob(payload.data); setExportJobEtag(response.headers.get("etag") ?? exportJobEtag); }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [exportJob, exportJobEtag]);

  useEffect(() => {
    if (!batchJob || !["queued", "running", "cancel_requested"].includes(batchJob.status)) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/jobs/${batchJob.jobId}`);
      const payload = await response.json() as { data?: BatchJob };
      if (payload.data) { setBatchJob(payload.data); setBatchJobEtag(response.headers.get("etag") ?? batchJobEtag); await load(); }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [batchJob, batchJobEtag, load]);

  async function openSubmission(submission: Submission) {
    selectedIdRef.current = submission.submissionId;
    setSelected(submission);
    setIdentity(submission.confirmedIdentity ?? submission.suggestedIdentity ?? "");
    setReading(null);
    setDetailSnapshot(null);
    setWizardStep(submission.confirmedIdentity ? 2 : 1);
    const pagesResponse = await fetch(`/api/exams/${params.id}/pages`);
    const pagesPayload = await pagesResponse.json() as { data?: { pages?: Page[] } };
    setPages(pagesPayload.data?.pages?.filter((page) => submission.pageIds.includes(page.pageId)) ?? []);
    setRegionPageId(submission.pageIds[0] ?? "");
    const batchesResponse = await fetch(`/api/exams/${params.id}/batches`);
    const batchesPayload = await batchesResponse.json() as { data?: Array<{ batchId: string; answerKeyRevisionId: string }> };
    setAnswerKeyRevisionId(batchesPayload.data?.find((batch) => batch.batchId === params.batchId)?.answerKeyRevisionId ?? "");
    const response = await fetch(`${base}/${submission.submissionId}`);
    const payload = await response.json() as { data?: { readings?: Reading[]; snapshot?: { openPending?: number } | null }; error?: { message?: string } };
    if (!response.ok) { setMessage(payload.error?.message ?? "No se pudo cargar la lectura."); return; }
    setReading(payload.data?.readings?.[0] ?? null);
    setOpenPending(payload.data?.snapshot?.openPending ?? 0);
    await loadResponses(submission.submissionId);
    setMessage(null);
  }

  useEffect(() => {
    if (!batch?.answerKeyRevisionId) return;
    fetch(`/api/exams/${params.id}/revisions/${batch.answerKeyRevisionId}/answer-key`).then(async (response) => {
      const payload = await response.json() as { data?: { answerKey?: { decisions?: Record<string, { answer?: { selectedOptionIds?: string[] } | string[] }> } } };
      const decisions = payload.data?.answerKey?.decisions ?? {};
      const normalized: Record<string, { selectedOptionIds?: string[] }> = {};
      for (const [questionId, decision] of Object.entries(decisions)) {
        const raw = decision.answer as { selectedOptionIds?: string[] } | string[] | null;
        const selected = Array.isArray(raw) ? raw : raw?.selectedOptionIds;
        normalized[questionId] = { selectedOptionIds: Array.isArray(selected) ? selected.map(String) : undefined };
      }
      setAnswerKey(normalized);
    }).catch(() => setAnswerKey({}));
  }, [batch?.answerKeyRevisionId, params.id]);

  function comparisonRows(): Array<{ questionId: string; alumno: string; correcta: string; resultado: string }> {
    const rows = reading?.rows ?? [];
    return rows.map((row) => {
      const correcta = answerKey[row.questionId]?.selectedOptionIds ?? [];
      const alumno = row.selectedOptionIds ?? [];
      const resultado = alumno.length === 0 ? "En blanco" : alumno.length === 1 && correcta.includes(alumno[0]) ? "Correcto" : "Incorrecto";
      return { questionId: row.questionId, alumno: alumno.join(", ") || "—", correcta: correcta.join(", ") || "—", resultado };
    });
  }

  function stepUnlocked(step: number): boolean {
    if (!selected) return false;
    if (step === 1) return true;
    if (step === 2) return Boolean(selected.confirmedIdentity);
    if (step === 3) return Boolean(reading && !reading.errorCode && !reading.rows.some((row) => row.requiresHumanReview || ["multiple", "ambiguous", "unreadable"].includes(row.status)));
    return Boolean(selected.confirmedIdentity && reading && !reading.errorCode && !reading.rows.some((row) => row.requiresHumanReview || ["multiple", "ambiguous", "unreadable"].includes(row.status)));
  }

  async function loadResponses(submissionId = selected?.submissionId) {
    if (!submissionId) return;
    const response = await fetch(`${base}/${submissionId}/responses`);
    const payload = await response.json() as { data?: ResponseData; error?: { message?: string } };
    if (!response.ok || !payload.data) { setMessage(payload.error?.message ?? "No se pudieron cargar las respuestas abiertas."); return; }
    setResponseData(payload.data);
    setRegionEtag(response.headers.get("etag") ?? "");
  }

  async function postAction(body: Record<string, unknown>) {
    if (!selected) return;
    setBusy(true);
    const response = await fetch(`${base}/${selected.submissionId}`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify(body) });
    const payload = await response.json() as { data?: unknown; error?: { code?: string; message?: string } };
    setBusy(false);
    if (!response.ok) { setMessage(`${payload.error?.code ?? "ERROR"}: ${payload.error?.message ?? "La acción falló."}`); return; }
    setMessage("Acción completada.");
    await load();
    if (body.action === "score" && selected) {
      const refreshed = await fetch(`${base}/${selected.submissionId}`);
      const refreshedPayload = await refreshed.json() as { data?: { submission?: Submission; readings?: Reading[] } };
      setSelected(refreshedPayload.data?.submission ?? selected);
      setReading(refreshedPayload.data?.readings?.[0] ?? reading);
    }
  }

  async function addSubmissionFromPageIds() {
    if (!selected) return;
    setBusy(true);
    const response = await fetch(base, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ assetIds: selected.assetIds }) });
    setBusy(false);
    const payload = await response.json() as { error?: { message?: string } };
    if (!response.ok) { setMessage(payload.error?.message ?? "No se pudo crear la entrega."); return; }
    setMessage("Entrega registrada.");
    await load();
  }

  async function startOmr() {
    if (!selected) return;
    setBusy(true);
    const response = await fetch(base, { method: "PUT", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ submissionId: selected.submissionId }) });
    setBusy(false);
    const payload = await response.json() as { error?: { message?: string } };
    setMessage(response.ok ? "Lectura OMR iniciada." : payload.error?.message ?? "No se pudo iniciar OMR.");
    await load();
  }

  async function startBatchProcessing() {
    if (!batch || !batchEtag) return;
    setBusy(true);
    const response = await fetch(`/api/exams/${params.id}/batches/${params.batchId}/start`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ expectedEtag: batchEtag }) });
    const payload = await response.json() as { data?: { job?: BatchJob }; error?: { message?: string } };
    setBusy(false);
    if (!response.ok) { setMessage(payload.error?.message ?? "No se pudo iniciar el procesamiento."); return; }
    setBatchJob(payload.data?.job ?? null); setBatchJobEtag(response.headers.get("etag") ?? ""); setMessage("Procesamiento masivo iniciado.");
  }

  function updateRegionFromPointer(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    setRegionRect({ x: Math.min(dragStart.x, x), y: Math.min(dragStart.y, y), width: Math.abs(x - dragStart.x), height: Math.abs(y - dragStart.y) });
  }

  function beginRegion(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    setDragStart({ x, y });
    setRegionRect({ x, y, width: 0, height: 0 });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function finishRegion() { setDragStart(null); }

  async function saveResponseRegion() {
    if (!selected || !regionQuestionId || !regionPageId || regionRect.width <= 0 || regionRect.height <= 0) return;
    const page = pages.find((candidate) => candidate.pageId === regionPageId);
    if (!page) return;
    const existing = responseData?.regions?.regions ?? [];
    const sourceAssetId = page.sourceAssetId;
    const response = await fetch(`${base}/${selected.submissionId}/responses/regions`, { method: "PATCH", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ expectedEtag: regionEtag || undefined, regions: [...existing.map(({ cropAssetId: _cropAssetId, ...region }) => region), { questionId: regionQuestionId, questionType: regionQuestionType, pageId: regionPageId, sourceAssetId, rect: regionRect, order: existing.filter((item) => item.questionId === regionQuestionId).length }] }) });
    const payload = await response.json() as { data?: { regionRevisionId: string; regions: ResponseRegion[] }; error?: { message?: string } };
    if (!response.ok || !payload.data) { setMessage(payload.error?.message ?? "No se pudo guardar la región."); return; }
    setResponseData((current) => current ? { ...current, regions: payload.data! } : current);
    setRegionEtag(response.headers.get("etag") ?? regionEtag);
    setMessage("Región guardada. Puedes añadir otra región para la misma pregunta.");
  }

  async function startTranscription() {
    if (!selected || !responseData?.regions) return;
    const response = await fetch(`${base}/${selected.submissionId}/responses/transcribe`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ expectedEtag: regionEtag, regionRevisionId: responseData.regions.regionRevisionId }) });
    const payload = await response.json() as { error?: { message?: string } };
    setMessage(response.ok ? "Transcripción iniciada." : payload.error?.message ?? "No se pudo iniciar la transcripción.");
    await loadResponses();
  }

  async function confirmTranscription(transcription: Transcription) {
    if (!selected) return;
    const response = await fetch(`${base}/${selected.submissionId}/responses/transcriptions/${transcription.transcriptionId}`, { method: "PATCH", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ expectedEtag: transcription.etag, normalizedText: transcriptionEdits[transcription.transcriptionId] ?? transcription.normalizedText ?? transcription.literalText, correctedText: transcriptionEdits[transcription.transcriptionId] ?? transcription.correctedText, confirm: true }) });
    const payload = await response.json() as { error?: { message?: string } };
    setMessage(response.ok ? "Transcripción confirmada." : payload.error?.message ?? "No se pudo confirmar la transcripción.");
    await loadResponses();
  }

  async function startEvaluation() {
    if (!selected) return;
    const current = await fetch(`${base}/${selected.submissionId}`);
    const expectedEtag = current.headers.get("etag");
    if (!expectedEtag) return;
    const response = await fetch(`${base}/${selected.submissionId}/responses/evaluate`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ expectedEtag, answerKeyRevisionId }) });
    const payload = await response.json() as { error?: { message?: string } };
    setMessage(response.ok ? "Evaluación iniciada." : payload.error?.message ?? "No se pudo iniciar la evaluación.");
    await loadResponses();
  }

  async function chooseEvaluation(evaluation: Evaluation) {
    if (!selected) return;
    const current = await fetch(`${base}/${selected.submissionId}`);
    const expectedEtag = current.headers.get("etag");
    if (!expectedEtag) return;
    const response = await fetch(`${base}/${selected.submissionId}/responses/decisions`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ expectedEtag, decisions: [{ questionId: evaluation.questionId, transcriptionId: evaluation.transcriptionId, source: evaluation.provider, selectedEvaluationId: evaluation.evaluationId, reason: "revisión humana de propuesta" }] }) });
    const payload = await response.json() as { error?: { message?: string } };
    setMessage(response.ok ? `Decisión ${evaluation.provider} guardada.` : payload.error?.message ?? "No se pudo guardar la decisión.");
    await loadResponses();
  }

  async function saveManualDecision(evaluation: Evaluation) {
    if (!selected) return;
    const current = await fetch(`${base}/${selected.submissionId}`);
    const expectedEtag = current.headers.get("etag");
    if (!expectedEtag) return;
    const scores = evaluation.criterionScores.map((criterion) => ({ criterionId: criterion.criterionId, points: manualPoints[evaluation.questionId]?.[criterion.criterionId] ?? criterion.points, evidence: "Decisión manual del docente" }));
    const response = await fetch(`${base}/${selected.submissionId}/responses/decisions`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ expectedEtag, decisions: [{ questionId: evaluation.questionId, transcriptionId: evaluation.transcriptionId, source: "manual", manualCriterionScores: scores, reason: "puntuación manual del docente" }] }) });
    const payload = await response.json() as { error?: { message?: string } };
    setMessage(response.ok ? "Puntuación manual guardada." : payload.error?.message ?? "No se pudo guardar la puntuación manual.");
    await loadResponses();
  }

  async function resolveRow(row: ReadingRow, optionId: string) {
    if (!reading) return;
    await postAction({ action: "decide", decisions: [{ readingId: reading.readingId, questionId: row.questionId, originalStatus: row.status, resolvedStatus: "single", selectedOptionIds: [optionId], reason: "revisión visual de fixture" }] });
    const refreshed = await fetch(`${base}/${selected?.submissionId ?? ""}`);
    const payload = await refreshed.json() as { data?: { readings?: Reading[] } };
    setReading(payload.data?.readings?.[0] ?? reading);
  }

  async function closeSubmission() {
    if (!selected) return;
    setBusy(true);
    const currentResponse = await fetch(`${base}/${selected.submissionId}`);
    const currentPayload = await currentResponse.json() as { data?: { snapshotEtag?: string | null }; error?: { message?: string } };
    const expectedEtag = currentResponse.headers.get("etag");
    const snapshotExpectedEtag = currentPayload.data?.snapshotEtag;
    if (!expectedEtag || !snapshotExpectedEtag) { setBusy(false); setMessage(currentPayload.error?.message ?? "El snapshot no está disponible para cierre."); return; }
    const response = await fetch(`${base}/${selected.submissionId}/close`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ expectedEtag, snapshotExpectedEtag }) });
    const payload = await response.json() as { error?: { code?: string; message?: string } };
    setBusy(false);
    setMessage(response.ok ? "Entrega cerrada." : payload.error?.message ? `${payload.error.message} (código: ${payload.error.code})` : "No se pudo cerrar la entrega.");
    if (response.ok) await load();
  }

  async function finalizeBatch() {
    if (!batch || !batchEtag) return;
    const pending = submissions.filter((submission) => submission.state !== "closed");
    if (submissions.length === 0 || pending.length > 0) {
      setMessage(submissions.length === 0 ? "Sube y procesa las entregas antes de finalizar." : `Quedan ${pending.length} entregas por cerrar. Selecciona cada entrega, confirma su identidad, revisa la lectura, puntúa y pulsa Cerrar entrega.`);
      return;
    }
    setBusy(true);
    const response = await fetch(`/api/exams/${params.id}/batches/${params.batchId}/finalize`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ expectedEtag: batchEtag }) });
    const payload = await response.json() as { data?: Batch; error?: { message?: string } };
    setBusy(false);
    if (!response.ok) { setMessage(payload.error?.message ?? "No se pudo finalizar el lote."); return; }
    setBatch(payload.data ?? batch); setBatchEtag(response.headers.get("etag") ?? batchEtag); setMessage("Lote finalizado.");
  }

  async function startExport() {
    if (!batch || !batchEtag || exportFormats.length === 0) return;
    setBusy(true);
    const response = await fetch(`/api/exams/${params.id}/batches/${params.batchId}/export`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ formats: exportFormats, includeOriginal, expectedEtag: batchEtag }) });
    const payload = await response.json() as { data?: { job?: ExportJob }; error?: { message?: string } };
    setBusy(false);
    if (!response.ok) { setMessage(payload.error?.message ?? "No se pudo iniciar la exportación."); return; }
    setExportJob(payload.data?.job ?? null); setExportJobEtag(response.headers.get("etag") ?? ""); setMessage("Exportación iniciada.");
  }

  async function updateExportJob(action: "cancel" | "retry") {
    if (!exportJob || !exportJobEtag) return;
    const response = await fetch(`/api/jobs/${exportJob.jobId}/${action}`, { method: "POST", headers: { origin: window.location.origin, "if-match": exportJobEtag } });
    const payload = await response.json() as { data?: ExportJob; error?: { message?: string } };
    if (payload.data) { setExportJob(payload.data); setExportJobEtag(response.headers.get("etag") ?? exportJobEtag); }
    setMessage(response.ok ? `Exportación ${action === "cancel" ? "cancelada" : "reintentada"}.` : payload.error?.message ?? "No se pudo actualizar el job.");
  }

  async function updateBatchJob(action: "cancel" | "retry") {
    if (!batchJob || !batchJobEtag) return;
    const response = await fetch(`/api/jobs/${batchJob.jobId}/${action}`, { method: "POST", headers: { origin: window.location.origin, "if-match": batchJobEtag } });
    const payload = await response.json() as { data?: BatchJob; error?: { message?: string } };
    if (payload.data) { setBatchJob(payload.data); setBatchJobEtag(response.headers.get("etag") ?? batchJobEtag); }
    setMessage(response.ok ? `Procesamiento ${action === "cancel" ? "cancelado" : "reintentado"}.` : payload.error?.message ?? "No se pudo actualizar el procesamiento.");
  }

  function stepOf(submission: Submission) {
    if (submission.state === "closed") return "4 · Cerrada";
    if (submission.state === "scored") return "3 · Puntuada · lista para cerrar";
    if (submission.state === "review" || submission.state === "review_scores") return submission.confirmedIdentity ? "3 · Revisar y puntuar" : "2 · Confirmar identidad";
    return "1 · Leyendo hoja (OMR + nombre)";
  }

  function workflowStep(): number {
    if (submissions.length === 0) return 0;
    if (batch && batch.state !== "closed" && (!batchJob || !["completed", "failed", "cancelled"].includes(batchJob.status))) return 1;
    const pending = submissions.find((submission) => submission.state !== "closed");
    if (!pending) return batch?.state === "closed" ? 5 : 4;
    if (!pending.confirmedIdentity) return 2;
    if (!pending.snapshotId || pending.state === "review" || pending.state === "review_scores") return 3;
    return 4;
  }

  const steps = [
    { title: "Subir exámenes", detail: "Sube los PDF o imágenes de los alumnos con el botón «Subir exámenes de alumnos» del panel Entregas." },
    { title: "Procesar lote", detail: "Pulsa «Procesar lote». La IA lee la matriz de respuestas y sugiere el nombre de cada alumno. Espera a que el job termine." },
    { title: "Confirmar identidad", detail: "Selecciona cada entrega, revisa el nombre sugerido y pulsa «Confirmar identidad»." },
    { title: "Revisar y puntuar", detail: "Resuelve las incidencias de lectura (cola de revisión OMR) y delimita/transcribe/evalúa las respuestas abiertas si las hay. Pulsa «Puntuar entrega»." },
    { title: "Cerrar cada entrega", detail: "Cuando la entrega esté puntuada y sin incidencias, pulsa «Cerrar entrega». Repite pasos 2-4 con cada entrega hasta cerrarlas todas." },
    { title: "Finalizar y exportar", detail: "Con todas las entregas cerradas, pulsa «Finalizar lote» y luego inicia la exportación en el panel Exportación del lote." },
  ];
  const currentStep = workflowStep();

  return (
    <main className="shell">
      <header className="topbar"><a className="eyebrow" href={`/exams/${params.id}`}>Volver al examen</a><span className="status">Corrección de entregas</span></header>
      <section>
        <h1>Lote de corrección.</h1>
        <p className="intro">Flujo: 1) Procesar lote: la IA lee la matriz de respuestas y sugiere el nombre del alumno comparando con el solucionario aprobado. 2) Confirma el nombre sugerido. 3) Las entregas limpias se puntúan solas; revisa solo las incidencias. 4) Cierra cada entrega. 5) Finaliza el lote y exporta.</p>
        <section className="panel" aria-label="Flujo de trabajo">
          <h2>Flujo de trabajo</h2>
          <p className="intro">Estás en el paso {currentStep + 1} de {steps.length}: <strong>{steps[currentStep]?.title}</strong>.</p>
          <ol>
            {steps.map((step, index) => <li key={step.title} style={{ fontWeight: index === currentStep ? 700 : 400 }}>{index + 1}. {step.title}: {step.detail}{index === currentStep ? " ← paso actual" : ""}</li>)}
          </ol>
        </section>
        {message ? <p className="notice" role="status">{message}</p> : null}
        {batchJob?.status === "completed" && ((batchJob.progress.blockedSubmissions ?? 0) > 0 || (batchJob.progress.failedSubmissions ?? 0) > 0) ? <p className="notice" role="status">El procesamiento ha terminado con entregas pendientes de revisión. No significa que las respuestas estén corregidas ni que el lote pueda cerrarse.</p> : null}
        {submissions.some((submission) => submission.state !== "closed") ? <section className="panel" aria-label="Pasos pendientes para finalizar"><h2>Pendiente de cierre</h2><p>Primero procesa el lote. Después revisa y cierra cada entrega; solo entonces podrás finalizar.</p><ul>{submissions.filter((submission) => submission.state !== "closed").map((submission) => <li key={submission.submissionId}><button className="button secondary" type="button" onClick={() => openSubmission(submission)}>Revisar {submission.confirmedIdentity ?? submission.submissionId.slice(0, 8)}</button> Estado: {submission.state}. {!submission.confirmedIdentity ? "Falta confirmar la identidad. " : ""}{!submission.snapshotId ? "Falta puntuar la entrega. " : ""}{submission.responseBlockingIssues?.length ? `Incidencias: ${submission.responseBlockingIssues.join(", ")}` : ""}</li>)}</ul></section> : null}
        {batch ? <><section className="panel"><h2>Procesamiento masivo</h2><p className="intro">Estado: {batch.state}. El job procesa páginas y respuestas disponibles y siempre deja la aprobación final para revisión humana.</p><div className="actions"><button className="button" type="button" disabled={busy || batch.state === "closed" || batch.state === "cancelled" || ["queued", "running", "cancel_requested"].includes(batchJob?.status ?? "")} onClick={startBatchProcessing}>Procesar lote</button>{batchJob && ["queued", "running"].includes(batchJob.status) ? <button className="button secondary" type="button" onClick={() => updateBatchJob("cancel")}>Cancelar</button> : null}{batchJob?.status === "failed" && batchJobEtag ? <button className="button secondary" type="button" onClick={() => updateBatchJob("retry")}>Reintentar</button> : null}</div>{batchJob ? <p className="intro">Job {batchJob.jobId}: {batchJob.status}, {batchJob.progress.percent}% ({batchJob.progress.phase}). Submissions {batchJob.progress.completedSubmissions ?? 0}/{batchJob.progress.totalSubmissions ?? 0}; páginas {batchJob.progress.completedPages ?? 0}/{batchJob.progress.totalPages ?? 0}; preguntas {batchJob.progress.completedQuestions ?? 0}/{batchJob.progress.totalQuestions ?? 0}. Incidencias: {batchJob.progress.blockedSubmissions ?? 0}. Llamadas: {batchJob.cost?.providerCalls ?? 0}.</p> : null}</section><section className="panel"><h2>Exportación del lote</h2><p className="intro">Solo un lote cerrado puede exportarse.</p><div className="actions"><label><input type="checkbox" checked={exportFormats.includes("csv")} onChange={(event) => setExportFormats((current) => event.target.checked ? [...new Set([...current, "csv"])] : current.filter((item) => item !== "csv"))} /> CSV</label><label><input type="checkbox" checked={exportFormats.includes("xlsx")} onChange={(event) => setExportFormats((current) => event.target.checked ? [...new Set([...current, "xlsx"])] : current.filter((item) => item !== "xlsx"))} /> XLSX</label><label><input type="checkbox" checked={exportFormats.includes("pdf")} onChange={(event) => setExportFormats((current) => event.target.checked ? [...new Set([...current, "pdf"])] : current.filter((item) => item !== "pdf"))} /> PDF</label><label><input type="checkbox" checked={includeOriginal} onChange={(event) => setIncludeOriginal(event.target.checked)} /> Incluir originales</label></div><div className="actions"><button className="button secondary" type="button" disabled={busy || batch.state === "closed" || ["queued", "running", "cancel_requested"].includes(batchJob?.status ?? "")} onClick={finalizeBatch}>Finalizar lote</button><button className="button" type="button" disabled={busy || batch.state !== "closed" || exportFormats.length === 0} onClick={startExport}>Exportar</button></div>{exportJob ? <><p className="intro">Job {exportJob.jobId}: {exportJob.status}, {exportJob.progress.percent}% ({exportJob.progress.phase}). Salidas: {exportJob.outputRefs.length}</p><div className="actions">{["queued", "running"].includes(exportJob.status) ? <button className="button secondary" type="button" onClick={() => updateExportJob("cancel")}>Cancelar</button> : null}{exportJob.status === "failed" && exportJobEtag ? <button className="button secondary" type="button" onClick={() => updateExportJob("retry")}>Reintentar</button> : null}</div></> : null}{exportJob?.outputRefs.map((outputId) => <a className="eyebrow" href={`/api/exports/${outputId}/download`} key={outputId}>Descargar {outputId.slice(0, 8)}</a>)}</section></> : null}
        <div className="detail-grid">
          <div className="panel">
            <h2>Entregas</h2>
            <label className="label">Subir exámenes de alumnos (PDF o imagen)<input className="input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple disabled={uploadingStudents} onChange={uploadStudentExams} /></label>
            {uploadingStudents ? <p className="intro">Subiendo y registrando entregas...</p> : null}
            <div className="page-list">{submissions.map((submission) => <div className={`page-row ${selected?.submissionId === submission.submissionId ? "selected" : ""}`} key={submission.submissionId} onClick={() => openSubmission(submission)}><span>#{submission.submissionId.slice(0, 8)}</span><span>{submission.confirmedIdentity ?? submission.suggestedIdentity ?? "sin identidad"}</span><span className="eyebrow">{stepOf(submission)}</span></div>)}</div>
            {selected ? <div className="actions"><button className="button secondary" type="button" disabled={busy} onClick={addSubmissionFromPageIds}>Registrar assets de nuevo</button><button className="button" type="button" disabled={busy} onClick={startOmr}>Iniciar lectura OMR</button></div> : null}
          </div>
          <div className="panel">
            <h2>Asistente de corrección</h2>
            {selected ? <>
              <div className="actions" aria-label="Pasos del asistente">
                {[1, 2, 3, 4].map((step) => <button className={`button ${wizardStep === step ? "" : "secondary"}`} type="button" key={step} onClick={() => setWizardStep(step)}>Paso {step}: {["Nombre (OCR)", "Respuestas (OMR)", "Comparación", "Puntuación"][step - 1]}{stepUnlocked(step) ? " ✓" : ""}</button>)}
              </div>
              {wizardStep === 1 ? <>
                <h3>Paso 1 · OCR del nombre</h3>
                <label className="label">Identidad confirmada<input className="input" value={identity} onChange={(event) => setIdentity(event.target.value)} /></label>
                {selected.suggestedIdentity ? <p className="intro">Nombre leído por IA: «{selected.suggestedIdentity}» ({Math.round((selected.identityConfidence ?? 0) * 100)}% de confianza). Revisa la ortografía y guarda.</p> : <p className="intro">No se pudo leer el nombre de forma automática: escríbelo y guarda.</p>}
                {selected.confirmedIdentity ? <p className="intro">Guardado como: <strong>{selected.confirmedIdentity}</strong></p> : null}
                <div className="actions"><button className="button" type="button" disabled={busy || !identity} onClick={() => postAction({ action: "confirm-identity", identity })}>Guardar identidad</button><button className="button secondary" type="button" disabled={!stepUnlocked(2)} onClick={() => setWizardStep(2)}>Siguiente: respuestas</button></div>
              </> : null}
              {wizardStep === 2 ? <>
                <h3>Paso 2 · Respuestas OMR</h3>
                {reading ? <>
                  <p className="intro">Lectura: {reading.readingId} ({reading.status}){reading.errorCode ? ` · ERROR: ${reading.errorCode}` : ""}</p>
                  {reading.errorCode ? <p className="notice" role="status">No se pudo leer la hoja: {reading.errorCode}. Corrige la causa y vuelve a procesar el lote.</p> : null}
                  <div className="page-list" aria-label="Respuestas leídas">
                    {reading.rows.map((row) => <div className="page-row" key={row.questionId} style={row.requiresHumanReview || ["multiple", "ambiguous", "unreadable"].includes(row.status) ? { border: "2px solid #d95d39" } : undefined}>
                      <span>{row.questionId}</span><span>{row.status}</span><span>{row.selectedOptionIds.join(", ") || "—"}</span>
                      <span className="actions">{row.candidateOptionIds.map((optionId) => <button className="button secondary" type="button" disabled={busy} key={optionId} onClick={() => resolveRow(row, optionId)}>Resolver {optionId}</button>)}</span>
                    </div>)}
                  </div>
                  <p className="intro">Las filas resaltadas (ambiguas, dobles o ilegibles) requieren decisión antes de continuar.</p>
                </> : <p className="intro">No hay lectura OMR. Procesa el lote o pulsa «Iniciar lectura OMR» en el panel Entregas.</p>}
                <div className="actions"><button className="button secondary" type="button" onClick={() => setWizardStep(1)}>Anterior</button><button className="button secondary" type="button" disabled={!stepUnlocked(3)} onClick={() => setWizardStep(3)}>Siguiente: comparación</button></div>
              </> : null}
              {wizardStep === 3 ? <>
                <h3>Paso 3 · Comparación con el solucionario</h3>
                {Object.keys(answerKey).length === 0 ? <p className="notice" role="status">No se pudo cargar el solucionario de este lote.</p> : null}
                <div className="page-list" aria-label="Tabla de comparación">
                  <div className="page-row"><span>Pregunta</span><span>Alumno</span><span>Correcta</span><span>Resultado</span></div>
                  {comparisonRows().map((row) => <div className="page-row" key={row.questionId}><span>{row.questionId}</span><span>{row.alumno}</span><span>{row.correcta}</span><span>{row.resultado}</span></div>)}
                </div>
                <div className="actions"><button className="button secondary" type="button" onClick={() => setWizardStep(2)}>Anterior</button><button className="button" type="button" disabled={!stepUnlocked(4)} onClick={() => setWizardStep(4)}>Siguiente: puntuación</button></div>
              </> : null}
              {wizardStep === 4 ? <>
                <h3>Paso 4 · Puntuación y cierre</h3>
                {!selected.confirmedIdentity ? <p className="notice" role="status">Falta confirmar la identidad (paso 1).</p> : null}
                {reading?.errorCode ? <p className="notice" role="status">La lectura OMR falló (paso 2): {reading.errorCode}.</p> : null}
                {reading?.rows.some((row) => row.requiresHumanReview || ["multiple", "ambiguous", "unreadable"].includes(row.status)) ? <p className="notice" role="status">Hay filas OMR sin resolver (paso 2).</p> : null}
                {selected.responseBlockingIssues?.length ? <p className="notice" role="status">Incidencias pendientes: {selected.responseBlockingIssues.slice(0, 5).join(", ")}{selected.responseBlockingIssues.length > 5 ? ` y ${selected.responseBlockingIssues.length - 5} más` : ""}</p> : null}
                {detailSnapshot ? <p className="intro">Última puntuación: <strong>{detailSnapshot.score}</strong> · correctas {detailSnapshot.correct} · incorrectas {detailSnapshot.incorrect} · en blanco {detailSnapshot.blank} · pendientes {detailSnapshot.pending}</p> : <p className="intro">Todavía no hay puntuación para esta entrega.</p>}
                <div className="actions"><button className="button secondary" type="button" onClick={() => setWizardStep(3)}>Anterior</button><button className="button" type="button" disabled={busy || !selected.confirmedIdentity} onClick={() => postAction({ action: "score" })}>Puntuar entrega</button><button className="button" type="button" disabled={busy || !selected.snapshotId} onClick={closeSubmission}>Cerrar entrega</button></div>
                {selected.snapshotId ? <p className="intro">Snapshot: {selected.snapshotId}</p> : null}
              </> : null}
              {(wizardStep === 2 || wizardStep === 4) && (openPending > 0 || selected.responseBlockingIssues?.some((issue) => issue.startsWith("open_"))) ? <section className="panel">
                <h3>Respuestas abiertas</h3>
                <p className="intro">Delimita una región por pregunta. El recorte se genera de forma privada en el servidor.</p>
                <div className="form"><input className="input" placeholder="ID de pregunta" value={regionQuestionId} onChange={(event) => setRegionQuestionId(event.target.value)} /><select className="input" value={regionQuestionType} onChange={(event) => setRegionQuestionType(event.target.value as "short_text" | "essay")}><option value="short_text">short_text</option><option value="essay">essay</option></select><select className="input" value={regionPageId} onChange={(event) => setRegionPageId(event.target.value)}>{pages.map((page) => <option value={page.pageId} key={page.pageId}>Página {page.pageNumber}</option>)}</select></div>
                {(() => { const page = pages.find((candidate) => candidate.pageId === regionPageId); return page ? <div className="preview" style={{ position: "relative", touchAction: "none" }} onPointerDown={beginRegion} onPointerMove={updateRegionFromPointer} onPointerUp={finishRegion}><img src={`/api/assets/${page.sourceAssetId}/content`} alt="Página para delimitar respuesta" style={{ transform: `rotate(${page.rotation}deg)` }} /><div style={{ position: "absolute", left: `${regionRect.x * 100}%`, top: `${regionRect.y * 100}%`, width: `${regionRect.width * 100}%`, height: `${regionRect.height * 100}%`, border: "2px solid #d95d39", pointerEvents: "none" }} /></div> : <p className="intro">No hay páginas seleccionables.</p>; })()}
                <div className="actions"><button className="button secondary" type="button" disabled={busy || !regionQuestionId || !regionPageId} onClick={saveResponseRegion}>Guardar región</button><button className="button secondary" type="button" disabled={busy || !responseData?.regions} onClick={startTranscription}>Iniciar transcripción</button><button className="button secondary" type="button" disabled={busy} onClick={() => loadResponses()}>Actualizar respuestas</button><button className="button" type="button" disabled={busy || !answerKeyRevisionId} onClick={startEvaluation}>Iniciar evaluación</button></div>
                {responseData?.transcriptions.map((transcription) => <article className="card" key={transcription.transcriptionId}><strong>{transcription.questionId} · transcripción {transcription.state}</strong><p>Literal: {transcription.literalText || "(vacía)"}</p><textarea className="input" rows={4} value={transcriptionEdits[transcription.transcriptionId] ?? transcription.correctedText ?? transcription.normalizedText ?? transcription.literalText} onChange={(event) => setTranscriptionEdits((current) => ({ ...current, [transcription.transcriptionId]: event.target.value }))} /><p>Confianza: {transcription.confidence}. {transcription.uncertainSpans.map((span) => span.text).join(", ")}</p>{transcription.state === "proposed" ? <button className="button secondary" type="button" disabled={busy} onClick={() => confirmTranscription(transcription)}>Confirmar/corregir transcripción</button> : null}</article>)}
                {responseData?.evaluations.map((evaluation) => <article className="card" key={evaluation.evaluationId}><strong>{evaluation.questionId} · {evaluation.provider}</strong><p>{evaluation.totalPoints}/{evaluation.maximumPoints}: {evaluation.explanation}</p>{evaluation.state === "completed" ? <><div className="mini-form">{evaluation.criterionScores.map((criterion) => <label className="label" key={criterion.criterionId}>{criterion.criterionId}<input className="input" type="number" min="0" max={criterion.maxPoints} step=".01" value={manualPoints[evaluation.questionId]?.[criterion.criterionId] ?? criterion.points} onChange={(event) => setManualPoints((current) => ({ ...current, [evaluation.questionId]: { ...current[evaluation.questionId], [criterion.criterionId]: Number(event.target.value) } }))} /></label>)}</div><div className="actions"><button className="button secondary" type="button" disabled={busy} onClick={() => chooseEvaluation(evaluation)}>Elegir {evaluation.provider}</button><button className="button secondary" type="button" disabled={busy} onClick={() => saveManualDecision(evaluation)}>Guardar puntuación manual</button></div></> : null}</article>)}
              </section> : null}
            </> : <p className="intro">Selecciona una entrega.</p>}
          </div>
        </div>
      </section>
    </main>
  );
}
