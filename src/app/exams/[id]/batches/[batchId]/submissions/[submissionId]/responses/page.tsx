"use client";

import { ExamWorkflowNav } from "@/components/exam-workflow-nav";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Submission = { submissionId: string; state: string; confirmedIdentity?: string; suggestedIdentity?: string; identityConfidence?: number; readingIds: string[]; responsesConfirmedAt?: string; comparisonConfirmedAt?: string; responseBlockingIssues: string[] };
type Row = { questionId: string; status: string; selectedOptionIds: string[]; candidateOptionIds: string[]; requiresHumanReview: boolean };
type Reading = { readingId: string; status: string; errorCode?: string; rows: Row[] };
type Job = { jobId: string; status: string; progress: { phase: string; completed: number; total: number; percent: number } };

export default function StudentResponsesPage() {
  const params = useParams<{ id: string; batchId: string; submissionId: string }>();
  const base = `/api/exams/${params.id}/batches/${params.batchId}`;
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [batchEtag, setBatchEtag] = useState("");
  const [identity, setIdentity] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [detailResponse, batchResponse] = await Promise.all([fetch(`${base}/submissions/${params.submissionId}`), fetch(base)]);
    const detail = await detailResponse.json() as { data?: { submission: Submission; readings: Reading[] }; error?: { message?: string } };
    const batch = await batchResponse.json() as { data?: { answerKeyRevisionId: string }; error?: { message?: string } };
    if (!detailResponse.ok || !detail.data) throw new Error(detail.error?.message ?? "No se pudo cargar la entrega.");
    if (!batchResponse.ok || !batch.data) throw new Error(batch.error?.message ?? "No se pudo cargar el lote.");
    setSubmission(detail.data.submission);
    setReadings(detail.data.readings);
    setIdentity(detail.data.submission.confirmedIdentity ?? detail.data.submission.suggestedIdentity ?? "");
    setBatchEtag(batchResponse.headers.get("etag") ?? "");
  }, [base, params.submissionId]);

  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : "Error al cargar la entrega.")); }, [load]);

  useEffect(() => {
    if (!job || !["queued", "running", "cancel_requested"].includes(job.status)) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/jobs/${job.jobId}`);
      const payload = await response.json() as { data?: Job };
      if (!payload.data) return;
      setJob(payload.data);
      if (["completed", "failed", "cancelled"].includes(payload.data.status)) {
        await load();
        if (payload.data.status !== "completed") setMessage("La lectura terminó con errores; revisa las incidencias y reintenta si es necesario.");
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [job, load]);

  async function postSubmission(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    const response = await fetch(`${base}/submissions/${params.submissionId}`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ action, ...extra }) });
    const payload = await response.json() as { error?: { code?: string; message?: string } };
    setBusy(false);
    if (!response.ok) { setMessage(`${payload.error?.code ?? "ERROR"}: ${payload.error?.message ?? "La acción falló."}`); return false; }
    setMessage("Guardado.");
    await load();
    return true;
  }

  async function processStudent() {
    if (!batchEtag) return;
    setBusy(true);
    setMessage(null);
    const response = await fetch(`${base}/start`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ expectedEtag: batchEtag, submissionId: params.submissionId, scope: "submission_omr" }) });
    const payload = await response.json() as { data?: { job?: Job }; error?: { code?: string; message?: string } };
    setBusy(false);
    if (!response.ok || !payload.data?.job) { setMessage(`${payload.error?.code ?? "ERROR"}: ${payload.error?.message ?? "No se pudo iniciar OCR/OMR."}`); return; }
    setJob(payload.data.job);
    setMessage("Lectura OCR/OMR iniciada para este alumno.");
  }

  async function resolve(row: Row, optionId?: string) {
    const reading = readings.find((candidate) => candidate.rows.some((item) => item.questionId === row.questionId));
    if (!reading) return;
    const response = await fetch(`${base}/submissions/${params.submissionId}`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ action: "decide", decisions: [{ readingId: reading.readingId, questionId: row.questionId, originalStatus: row.status, resolvedStatus: optionId ? "single" : "blank", selectedOptionIds: optionId ? [optionId] : [], reason: "revisión humana OMR" }] }) });
    const payload = await response.json() as { error?: { code?: string; message?: string } };
    if (!response.ok) { setMessage(`${payload.error?.code ?? "ERROR"}: ${payload.error?.message ?? "No se pudo resolver la fila."}`); return; }
    await load();
    setMessage(`Pregunta ${row.questionId} resuelta.`);
  }

  const hasRows = readings.some((reading) => reading.rows.length > 0 && !reading.errorCode);
  const unresolved = readings.some((reading) => reading.errorCode || reading.rows.some((row) => row.requiresHumanReview || !["single", "blank"].includes(row.status)));
  const ready = Boolean(submission?.confirmedIdentity && hasRows && !unresolved);
  const stageLinks = [
    { stage: 1, title: "Examen", href: `/exams/${params.id}`, enabled: true },
    { stage: 2, title: "Respuestas IA", href: `/exams/${params.id}/answers`, enabled: true },
    { stage: 3, title: "Plantilla OMR", href: `/exams/${params.id}/omr-template`, enabled: true },
    { stage: 4, title: "Alumnos", href: `/exams/${params.id}/batches/${params.batchId}`, enabled: true },
    { stage: 5, title: "Comparar", href: `${base}/submissions/${params.submissionId}/compare`, enabled: Boolean(submission?.responsesConfirmedAt) },
    { stage: 6, title: "Calificar", href: `${base}/submissions/${params.submissionId}/grade`, enabled: Boolean(submission?.comparisonConfirmedAt) },
  ];

  return <main className="shell">
    <header className="topbar"><a className="eyebrow" href={`/exams/${params.id}/batches/${params.batchId}`}>Volver a alumnos</a><span className="status">Paso 4 · Respuestas del alumno</span></header>
    <section>
      <h1>Identidad y respuestas OMR.</h1>
      <ExamWorkflowNav current={4} links={stageLinks} />
      {message ? <p className="notice" role="status">{message}</p> : null}
      <section className="panel">
        <h2>1. Identidad</h2>
        {submission?.suggestedIdentity ? <p>OCR sugiere «{submission.suggestedIdentity}» con {Math.round((submission.identityConfidence ?? 0) * 100)}% de confianza.</p> : <p>No hay un nombre legible por OCR; introdúcelo manualmente.</p>}
        <div className="form"><input className="input" value={identity} onChange={(event) => setIdentity(event.target.value)} placeholder="Nombre del alumno" /><button className="button secondary" disabled={busy || !identity.trim()} onClick={() => postSubmission("confirm-identity", { identity: identity.trim() })}>Guardar identidad</button></div>
        {submission?.confirmedIdentity ? <p>Confirmada: <strong>{submission.confirmedIdentity}</strong></p> : null}
      </section>
      <section className="panel">
        <h2>2. Lectura de respuestas</h2>
        <p>Procesa solo esta entrega. Revisa las marcas resaltadas antes de confirmar.</p>
        <button className="button" disabled={busy || Boolean(job && ["queued", "running"].includes(job.status))} onClick={processStudent}>{job && ["queued", "running"].includes(job.status) ? `Procesando ${job.progress.percent}%…` : "Procesar alumno (OCR + OMR)"}</button>
        {readings.map((reading) => <section className="panel" key={reading.readingId}>
          <h3>Lectura {reading.status}{reading.errorCode ? ` · ${reading.errorCode}` : ""}</h3>
          {reading.rows.map((row) => <div className="page-row" key={`${reading.readingId}:${row.questionId}`} style={row.requiresHumanReview ? { border: "2px solid #d95d39" } : undefined}>
            <span>Pregunta {row.questionId}</span><span>{row.status}</span><span>{row.selectedOptionIds.join(", ") || "En blanco"}</span>
            <span className="actions">{row.candidateOptionIds.map((optionId) => <button className="button secondary" key={optionId} disabled={busy} onClick={() => resolve(row, optionId)}>Resolver {optionId}</button>)}{row.requiresHumanReview ? <button className="button secondary" disabled={busy} onClick={() => resolve(row)}>Marcar en blanco</button> : null}</span>
          </div>)}
        </section>)}
        {submission?.responsesConfirmedAt ? <p>Respuestas confirmadas.</p> : null}
        <div className="actions"><button className="button secondary" disabled={busy || !ready} onClick={() => postSubmission("confirm-responses")}>Confirmar respuestas OMR</button><a className={`button ${ready && submission?.responsesConfirmedAt ? "" : "secondary"}`} aria-disabled={!ready || !submission?.responsesConfirmedAt} href={ready && submission?.responsesConfirmedAt ? `${base}/submissions/${params.submissionId}/compare` : undefined} onClick={(event) => { if (!ready || !submission?.responsesConfirmedAt) event.preventDefault(); }}>Siguiente: comparar</a></div>
      </section>
    </section>
  </main>;
}
