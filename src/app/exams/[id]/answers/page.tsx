"use client";

import { ExamWorkflowNav } from "@/components/exam-workflow-nav";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Exam = { examId: string; activeRevisionId?: string };
type Revision = { examRevisionId: string; status: string; workflowRunId?: string; answerKeyRevisionId?: string; pagesManifestEtag?: string };
type Progress = { phase: string; completed?: number; total?: number };
type Run = { runId: string; revisionId: string; status: string };

export default function AnswersWorkflowPage() {
  const { id: examId } = useParams<{ id: string }>();
  const [exam, setExam] = useState<Exam | null>(null);
  const [revision, setRevision] = useState<Revision | null>(null);
  const [answerKeyApproved, setAnswerKeyApproved] = useState(false);
  const [sourceStale, setSourceStale] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [examResponse, pagesResponse] = await Promise.all([fetch(`/api/exams/${examId}`), fetch(`/api/exams/${examId}/pages`)]);
    const examPayload = await examResponse.json() as { data?: Exam; error?: { message?: string } };
    const pagesPayload = await pagesResponse.json() as { data?: { pages?: unknown[] } };
    if (!examResponse.ok || !examPayload.data) throw new Error(examPayload.error?.message ?? "No se pudo cargar el examen.");
    setExam(examPayload.data);
    setPageCount(pagesPayload.data?.pages?.length ?? 0);
    const currentPagesEtag = pagesResponse.headers.get("etag") ?? "";
    const revisionId = examPayload.data.activeRevisionId;
    if (!revisionId) { setRevision(null); setSourceStale(false); setAnswerKeyApproved(false); return; }
    const solutionResponse = await fetch(`/api/exams/${examId}/revisions/${revisionId}/solutions`);
    const solutionPayload = await solutionResponse.json() as { data?: { revision: Revision; answerKey?: { status?: string } | null }; error?: { message?: string } };
    if (!solutionResponse.ok || !solutionPayload.data) throw new Error(solutionPayload.error?.message ?? "No se pudo cargar la revisión actual.");
    setRevision(solutionPayload.data.revision);
    const stale = solutionPayload.data.revision.pagesManifestEtag !== currentPagesEtag;
    setSourceStale(stale);
    setAnswerKeyApproved(solutionPayload.data.answerKey?.status === "approved" && !stale);
    if (solutionPayload.data.revision.workflowRunId && ["extracting", "solving"].includes(solutionPayload.data.revision.status)) {
      setRun({ runId: solutionPayload.data.revision.workflowRunId, revisionId, status: "running" });
    } else setRun(null);
  }, [examId]);

  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : "Error de carga.")); }, [load]);

  useEffect(() => {
    if (!run || !["queued", "running"].includes(run.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const url = new URL(`/api/phase0/workflow/${run.runId}`, window.location.origin);
        url.searchParams.set("examId", examId);
        url.searchParams.set("revisionId", run.revisionId);
        const response = await fetch(url);
        const payload = await response.json() as { data?: { status?: string; output?: { revisionId?: string }; progress?: Progress }; error?: { message?: string } };
        if (!response.ok || !payload.data?.status) { setMessage(payload.error?.message ?? "No se pudo consultar el progreso. Seguimos comprobando la ejecución."); return; }
        setProgress(payload.data.progress ?? null);
        setRun((current) => current ? { ...current, status: payload.data!.status! } : current);
        if (payload.data.status === "completed") {
          const revisionId = payload.data.output?.revisionId ?? run.revisionId;
          setRun(null);
          window.location.href = `/exams/${examId}/revisions/${revisionId}/answer-key`;
        } else if (["failed", "cancelled"].includes(payload.data.status)) {
          setMessage("La ejecución terminó sin generar el solucionario. Puedes iniciar otra revisión.");
        }
      } catch {
        setMessage("No se pudo consultar el progreso por un problema de conexión. Seguimos comprobando la ejecución.");
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [examId, run]);

  async function startAi(regenerate = false) {
    if (regenerate && !window.confirm("Se creará una revisión nueva. Las revisiones y lotes existentes se conservarán como histórico; las nuevas correcciones necesitarán un lote nuevo.")) return;
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/exams/${examId}/autopilot`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: window.location.origin, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ language: "es" }),
    });
    const payload = await response.json() as { data?: { runId?: string; revisionId?: string }; error?: { code?: string; message?: string } };
    setBusy(false);
    if (!response.ok || !payload.data?.runId || !payload.data.revisionId) {
      setMessage(`${payload.error?.code ?? "ERROR"}: ${payload.error?.message ?? "No se pudo iniciar la lectura IA."}`);
      return;
    }
    setRun({ runId: payload.data.runId, revisionId: payload.data.revisionId, status: "running" });
    setRevision({ examRevisionId: payload.data.revisionId, status: "extracting", workflowRunId: payload.data.runId });
    setProgress({ phase: "preparing", completed: 0, total: 0 });
  }

  const approved = answerKeyApproved;
  const activeRun = Boolean(run && ["queued", "running"].includes(run.status));

  return (
    <main className="shell">
      <header className="topbar"><a className="eyebrow" href={`/exams/${examId}`}>Volver al examen</a><span className="status">Paso 2 · Respuestas IA</span></header>
      <section>
        <h1>Respuestas generadas con IA.</h1>
        <ExamWorkflowNav current={2} links={[
          { stage: 1, title: "Examen", href: `/exams/${examId}`, enabled: true },
          { stage: 2, title: "Respuestas IA", href: `/exams/${examId}/answers`, enabled: true },
          { stage: 3, title: "Plantilla OMR", href: `/exams/${examId}/omr-template`, enabled: approved },
          { stage: 4, title: "Alumnos", href: `/exams/${examId}/students`, enabled: false },
          { stage: 5, title: "Comparar", href: `/exams/${examId}/students`, enabled: false },
          { stage: 6, title: "Calificar", href: `/exams/${examId}/students`, enabled: false },
        ]} />
        <p className="intro">La IA lee el documento y propone las respuestas. Revisa y aprueba el solucionario antes de calibrar la hoja de respuestas.</p>
        {message ? <p className="notice" role="status">{message}</p> : null}
        {activeRun ? <section className="panel" aria-live="polite"><h2>Lectura en curso</h2><p>{progress?.phase === "solving_questions" ? `Resolviendo preguntas: ${progress.completed ?? 0}/${progress.total ?? "…"}.` : progress?.phase === "reading_pages" ? `Leyendo páginas: ${progress.completed ?? 0}/${progress.total ?? "…"}.` : "Preparando el examen para la IA…"}</p></section> : null}
        {!activeRun && !revision ? <div className="panel"><p>{pageCount ? `${pageCount} páginas fuente preparadas.` : "Sube y ordena las páginas del examen en la pantalla 1 antes de iniciar."}</p><button className="button" type="button" disabled={busy || pageCount === 0} onClick={() => startAi()}>{busy ? "Iniciando…" : "Iniciar lectura y respuestas IA"}</button></div> : null}
        {!activeRun && revision?.answerKeyRevisionId ? <div className="panel"><p>Revisión actual: <strong>{revision.status}</strong>. {sourceStale ? "La fuente del examen cambió; este solucionario ya no sirve para lotes nuevos." : "Se conserva como histórico al regenerar."}</p><div className="actions">{!sourceStale ? <a className="button" href={`/exams/${examId}/revisions/${revision.examRevisionId}/answer-key`}>{approved ? "Ver solucionario aprobado" : "Revisar y aprobar respuestas"}</a> : <a className="button secondary" href={`/exams/${examId}/revisions/${revision.examRevisionId}/answer-key`}>Ver revisión histórica</a>}<button className="button secondary" type="button" disabled={busy || pageCount === 0} onClick={() => startAi(true)}>{sourceStale ? "Generar respuestas para la fuente nueva" : "Regenerar respuestas IA"}</button></div></div> : null}
        {!activeRun && revision && !revision.answerKeyRevisionId ? <div className="panel"><p>La revisión actual no contiene solucionario aprobado. Puedes reanudar la lectura o crear una revisión nueva.</p><button className="button" disabled={busy || pageCount === 0} onClick={() => startAi(true)}>Reintentar con IA</button></div> : null}
        {!activeRun && approved ? <div className="actions"><a className="button" href={`/exams/${examId}/omr-template`}>Siguiente: plantilla OMR</a></div> : null}
      </section>
    </main>
  );
}
