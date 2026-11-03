"use client";

import { ExamWorkflowNav } from "@/components/exam-workflow-nav";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type PointerEvent } from "react";

type Submission = { submissionId: string; state: string; pageIds: string[]; assetIds: string[]; confirmedIdentity?: string; readingIds: string[]; responsesConfirmedAt?: string; snapshotId?: string; comparisonConfirmedAt?: string; responseTranscriptionIds: string[]; responseEvaluationIds: string[]; responseDecisionIds: string[]; responseBlockingIssues: string[]; activeResponseRegionRevisionId?: string };
type Batch = { batchId: string; state: string; answerKeyRevisionId: string; scoringPolicyRevisionId: string; submissionIds: string[] };
type Page = { pageId: string; sourceAssetId: string; pageNumber: number; rotation: 0 | 90 | 180 | 270 };
type Region = { questionId: string; questionType: "short_text" | "essay"; pageId: string; sourceAssetId: string; rect: { x: number; y: number; width: number; height: number }; order: number; cropAssetId?: string; regionId?: string };
type Transcription = { transcriptionId: string; questionId: string; literalText: string; normalizedText?: string; correctedText?: string; confidence: number; uncertainSpans: Array<{ text: string; reason: string }>; state: string; etag: string };
type Evaluation = { evaluationId: string; questionId: string; transcriptionId: string; provider: "gemini" | "deepseek"; criterionScores: Array<{ criterionId: string; points: number; maxPoints: number; evidence: string; incidents: string[] }>; totalPoints: number; maximumPoints: number; explanation: string; state: string };
type Snapshot = { snapshotId: string; score: number; correct: number; blank: number; incorrect: number; pending: number; blockingIssues: string[]; state: string; openPending?: number };
type OpenQuestion = { questionId: string; type: "short_text" | "essay" };
type Job = { jobId: string; status: string; progress: { phase: string; percent: number } };
type ExportJob = Job;

export default function GradeSubmissionPage() {
  const params = useParams<{ id: string; batchId: string; submissionId: string }>();
  const root = `/api/exams/${params.id}/batches/${params.batchId}`;
  const submissionUrl = `${root}/submissions/${params.submissionId}`;
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [openQuestions, setOpenQuestions] = useState<OpenQuestion[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [regionEtag, setRegionEtag] = useState("");
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [batchEtag, setBatchEtag] = useState("");
  const [identity, setIdentity] = useState("");
  const [nextSubmissionId, setNextSubmissionId] = useState<string | null>(null);
  const [questionId, setQuestionId] = useState("");
  const [pageId, setPageId] = useState("");
  const [rect, setRect] = useState({ x: 0.1, y: 0.1, width: 0.3, height: 0.12 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [transcriptionEdits, setTranscriptionEdits] = useState<Record<string, string>>({});
  const [manualPoints, setManualPoints] = useState<Record<string, Record<string, number>>>({});
  const [job, setJob] = useState<Job | null>(null);
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [exportFormats, setExportFormats] = useState<string[]>(["csv", "xlsx", "pdf"]);
  const [includeOriginal, setIncludeOriginal] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [allSubmissionsClosed, setAllSubmissionsClosed] = useState(false);

  const load = useCallback(async () => {
    const [detailResponse, batchResponse, pagesResponse, responsesResponse] = await Promise.all([
      fetch(submissionUrl), fetch(root), fetch(`/api/exams/${params.id}/pages`), fetch(`${submissionUrl}/responses`),
    ]);
    const detail = await detailResponse.json() as { data?: { submission: Submission; snapshot: Snapshot | null }; error?: { message?: string } };
    const batchPayload = await batchResponse.json() as { data?: Batch };
    const pagesPayload = await pagesResponse.json() as { data?: { pages?: Page[] } };
    const responses = await responsesResponse.json() as { data?: { regions: { regionRevisionId: string; regions: Region[] } | null; transcriptions: Transcription[]; evaluations: Evaluation[]; blockingIssues: string[] } };
    if (!detailResponse.ok || !detail.data || !batchResponse.ok || !batchPayload.data) throw new Error(detail.error?.message ?? "No se pudo cargar la calificación.");
    setSubmission(detail.data.submission);
    setBatch(batchPayload.data);
    setSnapshot(detail.data.snapshot);
    setPages((pagesPayload.data?.pages ?? []).filter((page) => detail.data!.submission.pageIds.includes(page.pageId)));
    setTranscriptions(responses.data?.transcriptions ?? []);
    setEvaluations(responses.data?.evaluations ?? []);
    const activeRegions = responses.data?.regions;
    setRegions(activeRegions?.regions ?? []);
    setRegionEtag(responsesResponse.headers.get("etag") ?? "");
    if (!pageId) setPageId(detail.data.submission.pageIds[0] ?? "");
    setIdentity(detail.data.submission.confirmedIdentity ?? "");

    const keyResponse = await fetch(`/api/exams/${params.id}/revisions/${batchPayload.data.answerKeyRevisionId}/answer-key`);
    const keyPayload = await keyResponse.json() as { data?: { revision?: { examRevisionId: string }; answerKey?: { decisions?: Record<string, { sectionId?: string }> } } };
    const solutionsResponse = keyPayload.data?.revision?.examRevisionId ? await fetch(`/api/exams/${params.id}/revisions/${keyPayload.data.revision.examRevisionId}/solutions`) : null;
    const solutions = await solutionsResponse?.json() as { data?: { questions?: Array<{ questionId: string; type: string }> } } | undefined;
    const openIds = new Set(Object.entries(keyPayload.data?.answerKey?.decisions ?? {}).filter(([, decision]) => decision.sectionId === "open").map(([id]) => id));
    const questions = (solutions?.data?.questions ?? []).filter((question) => openIds.has(question.questionId) && ["short_text", "essay"].includes(question.type)).map((question) => ({ questionId: question.questionId, type: question.type as OpenQuestion["type"] }));
    setOpenQuestions(questions);
    if (!questionId && questions.length) setQuestionId(questions[0].questionId);

    const siblingsResponse = await fetch(`${root}/submissions`);
    const siblings = await siblingsResponse.json() as { data?: Submission[] };
    setAllSubmissionsClosed(Boolean(siblings.data?.length) && siblings.data!.every((item) => item.state === "closed"));
    const statusById = new Map((siblings.data ?? []).map((item) => [item.submissionId, item.state]));
    const currentIndex = batchPayload.data.submissionIds.indexOf(params.submissionId);
    const orderedIds = [...batchPayload.data.submissionIds.slice(currentIndex + 1), ...batchPayload.data.submissionIds.slice(0, currentIndex)];
    setNextSubmissionId(orderedIds.find((id) => statusById.get(id) !== "closed") ?? null);
    setBatchEtag(batchResponse.headers.get("etag") ?? "");
  }, [params.id, params.submissionId, pageId, questionId, root, submissionUrl]);

  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : "No se pudo cargar la pantalla.")); }, [load]);

  useEffect(() => {
    if (!job || !["queued", "running", "cancel_requested"].includes(job.status)) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/jobs/${job.jobId}`);
      const payload = await response.json() as { data?: Job };
      if (!payload.data) return;
      setJob(payload.data);
      if (["completed", "failed", "cancelled"].includes(payload.data.status)) {
        await load();
        if (payload.data.status !== "completed") setMessage("El procesamiento terminó con incidencias; revisa transcripciones y evaluaciones.");
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [job, load]);

  async function startOpenProcessing() {
    if (!batch || !batchEtag) return;
    setBusy(true);
    const response = await fetch(`${root}/start`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ expectedEtag: batchEtag, submissionId: params.submissionId, scope: "submission_open" }) });
    const payload = await response.json() as { data?: { job?: Job }; error?: { code?: string; message?: string } };
    setBusy(false);
    if (!response.ok || !payload.data?.job) { setMessage(`${payload.error?.code ?? "ERROR"}: ${payload.error?.message ?? "No se pudo iniciar la evaluación abierta."}`); return; }
    setJob(payload.data.job);
    setMessage("Transcripción y evaluación IA iniciadas para este alumno.");
  }

  function updateRect(event: PointerEvent<HTMLDivElement>) {
    if (!dragStart) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    setRect({ x: Math.min(dragStart.x, x), y: Math.min(dragStart.y, y), width: Math.abs(x - dragStart.x), height: Math.abs(y - dragStart.y) });
  }

  function beginRect(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    setDragStart({ x, y });
    setRect({ x, y, width: 0, height: 0 });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  async function saveRegion() {
    if (!submission || !batch || !questionId || !pageId || rect.width <= 0 || rect.height <= 0) return;
    const page = pages.find((item) => item.pageId === pageId);
    if (!page) return;
    const current = await fetch(`${submissionUrl}/responses/regions`);
    const active = await current.json() as { data?: { regions?: Region[] } | null };
    const existing = active.data?.regions ?? [];
    const response = await fetch(`${submissionUrl}/responses/regions`, { method: "PATCH", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ expectedEtag: current.headers.get("etag") || undefined, regions: [...existing.map(({ regionId: _id, cropAssetId: _crop, ...item }) => item), { questionId, questionType: openQuestions.find((item) => item.questionId === questionId)?.type ?? "short_text", pageId, sourceAssetId: page.sourceAssetId, rect, order: existing.filter((item) => item.questionId === questionId).length }] }) });
    const payload = await response.json() as { error?: { code?: string; message?: string } };
    if (!response.ok) { setMessage(`${payload.error?.code ?? "ERROR"}: ${payload.error?.message ?? "No se pudo guardar la región."}`); return; }
    await load();
    setMessage("Región guardada. Ejecuta la transcripción/evaluación en esta pantalla.");
  }

  async function confirmTranscription(item: Transcription) {
    const normalizedText = transcriptionEdits[item.transcriptionId] ?? item.normalizedText ?? item.literalText;
    const response = await fetch(`${submissionUrl}/responses/transcriptions/${item.transcriptionId}`, { method: "PATCH", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ expectedEtag: item.etag, normalizedText, correctedText: transcriptionEdits[item.transcriptionId] ?? item.correctedText, confirm: true }) });
    const payload = await response.json() as { error?: { message?: string } };
    setMessage(response.ok ? "Transcripción confirmada." : payload.error?.message ?? "No se pudo confirmar la transcripción.");
    if (response.ok) await load();
  }

  async function chooseEvaluation(evaluation: Evaluation) {
    const current = await fetch(submissionUrl);
    const expectedEtag = current.headers.get("etag");
    if (!expectedEtag) return;
    const response = await fetch(`${submissionUrl}/responses/decisions`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ expectedEtag, decisions: [{ questionId: evaluation.questionId, transcriptionId: evaluation.transcriptionId, source: evaluation.provider, selectedEvaluationId: evaluation.evaluationId, reason: "confirmación humana en la pantalla de calificación" }] }) });
    const payload = await response.json() as { error?: { message?: string } };
    setMessage(response.ok ? `Evaluación ${evaluation.provider} confirmada.` : payload.error?.message ?? "No se pudo confirmar la evaluación.");
    if (response.ok) await load();
  }

  async function saveManualDecision(evaluation: Evaluation) {
    const current = await fetch(submissionUrl);
    const expectedEtag = current.headers.get("etag");
    if (!expectedEtag) return;
    const manualCriterionScores = evaluation.criterionScores.map((criterion) => ({ criterionId: criterion.criterionId, points: manualPoints[evaluation.questionId]?.[criterion.criterionId] ?? criterion.points, evidence: "Decisión manual del docente" }));
    const response = await fetch(`${submissionUrl}/responses/decisions`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ expectedEtag, decisions: [{ questionId: evaluation.questionId, transcriptionId: evaluation.transcriptionId, source: "manual", manualCriterionScores, reason: "puntuación manual confirmada por el docente" }] }) });
    const payload = await response.json() as { error?: { message?: string } };
    setMessage(response.ok ? "Puntuación abierta guardada." : payload.error?.message ?? "No se pudo guardar la puntuación manual.");
    if (response.ok) await load();
  }

  async function scoreSubmission() {
    setBusy(true);
    const response = await fetch(submissionUrl, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ action: "score" }) });
    const payload = await response.json() as { error?: { code?: string; message?: string } };
    setBusy(false);
    setMessage(response.ok ? "Puntuación calculada; revisa el resumen antes de cerrar." : `${payload.error?.code ?? "ERROR"}: ${payload.error?.message ?? "No se pudo puntuar."}`);
    await load();
  }

  async function closeSubmission() {
    const currentResponse = await fetch(submissionUrl);
    const current = await currentResponse.json() as { data?: { snapshotEtag?: string | null }; error?: { message?: string } };
    const expectedEtag = currentResponse.headers.get("etag");
    if (!expectedEtag || !current.data?.snapshotEtag) { setMessage(current.error?.message ?? "No hay snapshot listo para cerrar."); return; }
    const response = await fetch(`${submissionUrl}/close`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ expectedEtag, snapshotExpectedEtag: current.data.snapshotEtag }) });
    const payload = await response.json() as { error?: { code?: string; message?: string } };
    setMessage(response.ok ? "Calificación cerrada." : `${payload.error?.code ?? "ERROR"}: ${payload.error?.message ?? "No se pudo cerrar."}`);
    if (response.ok) await load();
  }

  async function finalizeBatch() {
    if (!batchEtag) return;
    const response = await fetch(`${root}/finalize`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ expectedEtag: batchEtag }) });
    const payload = await response.json() as { error?: { message?: string } };
    setMessage(response.ok ? "Lote finalizado." : payload.error?.message ?? "No se pudo finalizar el lote.");
    if (response.ok) await load();
  }

  async function exportBatch() {
    if (!batchEtag) return;
    const response = await fetch(`${root}/export`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ formats: exportFormats, includeOriginal, expectedEtag: batchEtag }) });
    const payload = await response.json() as { data?: { job?: ExportJob }; error?: { message?: string } };
    setExportJob(payload.data?.job ?? null);
    setMessage(response.ok ? "Exportación iniciada." : payload.error?.message ?? "No se pudo exportar.");
  }

  const readingConfirmed = Boolean(submission?.responsesConfirmedAt);
  const comparisonConfirmed = Boolean(submission?.comparisonConfirmedAt);
  const closed = submission?.state === "closed";
  const hasOpenQuestions = openQuestions.length > 0;
  const links = [
    { stage: 1, title: "Examen", href: `/exams/${params.id}`, enabled: true },
    { stage: 2, title: "Respuestas IA", href: `/exams/${params.id}/answers`, enabled: true },
    { stage: 3, title: "Plantilla OMR", href: `/exams/${params.id}/omr-template`, enabled: true },
    { stage: 4, title: "Alumnos", href: `${root}/submissions/${params.submissionId}/responses`, enabled: true },
    { stage: 5, title: "Comparar", href: `${root}/submissions/${params.submissionId}/compare`, enabled: readingConfirmed },
    { stage: 6, title: "Calificar", href: `${root}/submissions/${params.submissionId}/grade`, enabled: comparisonConfirmed },
  ];

  return <main className="shell">
    <header className="topbar"><a className="eyebrow" href={`${root}/submissions/${params.submissionId}/compare`}>Volver a comparación</a><span className="status">Paso 6 · Calificación</span></header>
    <section>
      <h1>Calificación final.</h1>
      <ExamWorkflowNav current={6} links={links} />
      {message ? <p className="notice" role="status">{message}</p> : null}
      <p className="intro">Alumno: <strong>{identity || submission?.confirmedIdentity}</strong>. Las preguntas objetivas se puntúan automáticamente; las abiertas requieren transcripción confirmada y decisión humana.</p>
      {hasOpenQuestions ? <section className="panel">
        <h2>Respuestas abiertas</h2>
        <p>Selecciona pregunta y página, arrastra para delimitar la respuesta y guarda la región. Después procesa, confirma la transcripción y confirma/ajusta la evaluación.</p>
        <div className="form"><select className="input" value={questionId} onChange={(event) => setQuestionId(event.target.value)}>{openQuestions.map((question) => <option key={question.questionId} value={question.questionId}>{question.questionId} · {question.type}</option>)}</select><select className="input" value={pageId} onChange={(event) => setPageId(event.target.value)}>{pages.map((page) => <option key={page.pageId} value={page.pageId}>Página {page.pageNumber}</option>)}</select></div>
        {(() => { const page = pages.find((item) => item.pageId === pageId); return page ? <div className="preview" style={{ position: "relative", touchAction: "none" }} onPointerDown={beginRect} onPointerMove={updateRect} onPointerUp={() => setDragStart(null)}><img src={`/api/assets/${page.sourceAssetId}/content`} alt="Hoja de respuesta para delimitar" style={{ transform: `rotate(${page.rotation}deg)` }} /><div style={{ position: "absolute", left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, border: "2px solid #d95d39", pointerEvents: "none" }} /></div> : <p className="intro">No hay páginas de alumno disponibles.</p>; })()}
        <div className="actions"><button className="button secondary" disabled={busy || !questionId || !pageId} onClick={saveRegion}>Guardar región</button><button className="button" disabled={busy || !submission?.confirmedIdentity || !submission.comparisonConfirmedAt || !regions.length || Boolean(job && ["queued", "running"].includes(job.status))} onClick={startOpenProcessing}>{job && ["queued", "running"].includes(job.status) ? `Procesando ${job.progress.percent}%…` : "Transcribir y evaluar respuestas abiertas"}</button></div>
        {regions.length ? <p className="intro">Regiones activas: {regions.length}. Procesamiento usa la revisión guardada.</p> : null}
        {transcriptions.map((item) => <article className="card" key={item.transcriptionId}><strong>{item.questionId} · transcripción {item.state}</strong><p>Literal: {item.literalText || "(vacía)"} · confianza {item.confidence}</p><textarea className="input" rows={4} value={transcriptionEdits[item.transcriptionId] ?? item.correctedText ?? item.normalizedText ?? item.literalText} onChange={(event) => setTranscriptionEdits((current) => ({ ...current, [item.transcriptionId]: event.target.value }))} />{item.state === "proposed" ? <button className="button secondary" onClick={() => confirmTranscription(item)}>Confirmar/corregir transcripción</button> : null}</article>)}
        {evaluations.map((evaluation) => <article className="card" key={evaluation.evaluationId}><strong>{evaluation.questionId} · evaluación {evaluation.provider}</strong><p>{evaluation.totalPoints}/{evaluation.maximumPoints}: {evaluation.explanation}</p>{evaluation.state === "completed" ? <><div className="mini-form">{evaluation.criterionScores.map((criterion) => <label className="label" key={criterion.criterionId}>{criterion.criterionId}<input className="input" type="number" min={0} max={criterion.maxPoints} step=".01" value={manualPoints[evaluation.questionId]?.[criterion.criterionId] ?? criterion.points} onChange={(event) => setManualPoints((current) => ({ ...current, [evaluation.questionId]: { ...current[evaluation.questionId], [criterion.criterionId]: Number(event.target.value) } }))} /></label>)}</div><div className="actions"><button className="button secondary" onClick={() => chooseEvaluation(evaluation)}>Confirmar {evaluation.provider}</button><button className="button secondary" onClick={() => saveManualDecision(evaluation)}>Guardar ajustes manuales</button></div></> : null}</article>)}
      </section> : null}
      <section className="panel">
        <h2>Puntuación</h2>
        {snapshot ? <p>Nota: <strong>{snapshot.score}</strong> · correctas {snapshot.correct} · incorrectas {snapshot.incorrect} · en blanco {snapshot.blank} · abiertas pendientes {snapshot.openPending ?? 0}</p> : <p>Aún no se ha calculado la puntuación final.</p>}
        {snapshot?.blockingIssues.length ? <p className="notice">Pendiente: {snapshot.blockingIssues.join(", ")}</p> : null}
        <div className="actions"><button className="button secondary" disabled={busy || !comparisonConfirmed || closed} onClick={scoreSubmission}>Calcular/recalcular nota</button><button className="button" disabled={busy || !submission?.snapshotId || closed} onClick={closeSubmission}>Confirmar y cerrar calificación</button></div>
      </section>
      {closed && nextSubmissionId ? <div className="actions"><a className="button" href={`${root}/submissions/${nextSubmissionId}/responses`}>Siguiente alumno</a></div> : null}
      {closed && allSubmissionsClosed ? <section className="panel"><h2>Todos los alumnos están calificados</h2><p>Finaliza el lote para bloquear resultados y habilitar la exportación.</p><div className="actions"><button className="button" disabled={batch?.state === "closed"} onClick={finalizeBatch}>Finalizar lote</button>{batch?.state === "closed" ? <><label><input type="checkbox" checked={exportFormats.includes("csv")} onChange={(event) => setExportFormats((current) => event.target.checked ? [...new Set([...current, "csv"])] : current.filter((value) => value !== "csv"))} /> CSV</label><label><input type="checkbox" checked={exportFormats.includes("xlsx")} onChange={(event) => setExportFormats((current) => event.target.checked ? [...new Set([...current, "xlsx"])] : current.filter((value) => value !== "xlsx"))} /> XLSX</label><label><input type="checkbox" checked={exportFormats.includes("pdf")} onChange={(event) => setExportFormats((current) => event.target.checked ? [...new Set([...current, "pdf"])] : current.filter((value) => value !== "pdf"))} /> PDF</label><label><input type="checkbox" checked={includeOriginal} onChange={(event) => setIncludeOriginal(event.target.checked)} /> Incluir originales</label><button className="button" disabled={!exportFormats.length} onClick={exportBatch}>Exportar lote</button></> : null}</div>{exportJob ? <p className="intro">Exportación {exportJob.status}: {exportJob.progress.percent}%</p> : null}</section> : null}
    </section>
  </main>;
}
