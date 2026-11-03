"use client";

import { ExamWorkflowNav } from "@/components/exam-workflow-nav";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Submission = { submissionId: string; confirmedIdentity?: string; readingIds: string[]; responsesConfirmedAt?: string; comparisonConfirmedAt?: string; comparisonAnswerKeyRevisionId?: string };
type Reading = { readingId: string; rows: Array<{ questionId: string; status: string; selectedOptionIds: string[]; requiresHumanReview: boolean }> };
type Decision = { sectionId?: string; answer?: { selectedOptionIds?: string[] } | string[] };
type Question = { questionId: string; number: number; label: string };
type ComparisonRow = { questionId: string; answer: string[]; correct: string[]; result: string; options: string[]; readingId: string };

export default function CompareSubmissionPage() {
  const params = useParams<{ id: string; batchId: string; submissionId: string }>();
  const base = `/api/exams/${params.id}/batches/${params.batchId}`;
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [options, setOptions] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [detailResponse, batchResponse] = await Promise.all([fetch(`${base}/submissions/${params.submissionId}`), fetch(base)]);
    const detail = await detailResponse.json() as { data?: { submission: Submission; readings: Reading[] }; error?: { message?: string } };
    const batch = await batchResponse.json() as { data?: { answerKeyRevisionId: string; templateRevisionId: string }; error?: { message?: string } };
    if (!detailResponse.ok || !detail.data || !batchResponse.ok || !batch.data) throw new Error(detail.error?.message ?? batch.error?.message ?? "No se pudo cargar la comparación.");
    setSubmission(detail.data.submission);
    setReadings(detail.data.readings);
    const [keyResponse, templateResponse] = await Promise.all([
      fetch(`/api/exams/${params.id}/revisions/${batch.data.answerKeyRevisionId}/answer-key`),
      fetch(`/api/exams/${params.id}/omr-template`),
    ]);
    const key = await keyResponse.json() as { data?: { revision?: { examRevisionId: string }; answerKey?: { decisions?: Record<string, Decision> } }; error?: { message?: string } };
    const templates = await templateResponse.json() as { data?: Array<{ templateId: string; bubbles: Array<{ questionId: string; optionId: string }> }> };
    if (!keyResponse.ok || !key.data?.answerKey) throw new Error(key.error?.message ?? "No se pudo cargar el solucionario.");
    setDecisions(key.data.answerKey.decisions ?? {});
    const structureResponse = key.data.revision?.examRevisionId ? await fetch(`/api/exams/${params.id}/revisions/${key.data.revision.examRevisionId}/solutions`) : null;
    const structure = await structureResponse?.json() as { data?: { questions?: Question[] } } | undefined;
    const template = templates.data?.find((item) => item.templateId === batch.data!.templateRevisionId);
    const questionAliases = new Map<string, string>();
    for (const question of structure?.data?.questions ?? []) {
      questionAliases.set(String(question.number), question.questionId);
      questionAliases.set(question.label, question.questionId);
      questionAliases.set(question.questionId, question.questionId);
    }
    const optionMap: Record<string, string[]> = {};
    for (const bubble of template?.bubbles ?? []) {
      const questionId = questionAliases.get(bubble.questionId) ?? bubble.questionId;
      optionMap[questionId] = [...new Set([...(optionMap[questionId] ?? []), bubble.optionId])];
    }
    setOptions(optionMap);
  }, [base, params.id, params.submissionId]);

  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : "Error al cargar la comparación.")); }, [load]);

  function rows(): ComparisonRow[] {
    const test = Object.entries(decisions).filter(([, decision]) => decision.sectionId === "test");
    return test.map(([questionId, decision]) => {
      const raw = decision.answer;
      const correct = Array.isArray(raw) ? raw : raw?.selectedOptionIds ?? [];
      const matches = readings.flatMap((reading) => reading.rows.filter((row) => row.questionId === questionId).map((row) => ({ reading, row })));
      const match = matches[0];
      const answer = match?.row.selectedOptionIds ?? [];
      const result = !match ? "Falta respuesta" : match.row.requiresHumanReview ? "Pendiente OMR" : answer.length === 0 ? "En blanco" : answer.length === 1 && correct.includes(answer[0]) ? "Correcto" : "Incorrecto";
      return { questionId, answer, correct, result, options: options[questionId] ?? [], readingId: match?.reading.readingId ?? "" };
    });
  }

  async function saveAnswer(questionId: string, readingId: string, value: string) {
    const selectedOptionIds = value ? [value] : [];
    setBusy(true);
    const response = await fetch(`${base}/submissions/${params.submissionId}`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ action: "correct-answer", readingId, questionId, selectedOptionIds, reason: "corrección confirmada en comparación" }) });
    const payload = await response.json() as { error?: { code?: string; message?: string } };
    setBusy(false);
    if (!response.ok) { setMessage(`${payload.error?.code ?? "ERROR"}: ${payload.error?.message ?? "No se pudo guardar la corrección."}`); return; }
    setMessage("Respuesta corregida; vuelve a confirmar la comparación.");
    await load();
  }

  async function confirmComparison() {
    setBusy(true);
    const response = await fetch(`${base}/submissions/${params.submissionId}`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ action: "confirm-comparison" }) });
    const payload = await response.json() as { error?: { code?: string; message?: string } };
    setBusy(false);
    if (!response.ok) { setMessage(`${payload.error?.code ?? "ERROR"}: ${payload.error?.message ?? "No se pudo confirmar."}`); return; }
    setMessage("Comparación confirmada y vinculada a esta lectura y solucionario.");
    await load();
  }

  const comparisonRows = rows();
  const canConfirm = Boolean(submission?.responsesConfirmedAt && comparisonRows.every((row) => ["Correcto", "Incorrecto", "En blanco"].includes(row.result)));
  const links = [
    { stage: 1, title: "Examen", href: `/exams/${params.id}`, enabled: true },
    { stage: 2, title: "Respuestas IA", href: `/exams/${params.id}/answers`, enabled: true },
    { stage: 3, title: "Plantilla OMR", href: `/exams/${params.id}/omr-template`, enabled: true },
    { stage: 4, title: "Alumnos", href: `${base}/submissions/${params.submissionId}/responses`, enabled: true },
    { stage: 5, title: "Comparar", href: `${base}/submissions/${params.submissionId}/compare`, enabled: true },
    { stage: 6, title: "Calificar", href: `${base}/submissions/${params.submissionId}/grade`, enabled: Boolean(submission?.comparisonConfirmedAt) },
  ];

  return <main className="shell">
    <header className="topbar"><a className="eyebrow" href={`${base}/submissions/${params.submissionId}/responses`}>Volver a respuestas</a><span className="status">Paso 5 · Comparación</span></header>
    <section>
      <h1>Comparar con las respuestas aprobadas.</h1>
      <ExamWorkflowNav current={5} links={links} />
      {message ? <p className="notice" role="status">{message}</p> : null}
      <p className="intro">Alumno: <strong>{submission?.confirmedIdentity ?? "Identidad sin confirmar"}</strong>. Corrige una respuesta si la marca se leyó mal y confirma la tabla antes de puntuar.</p>
      <div className="page-list">
        <div className="page-row"><span>Pregunta</span><span>Alumno</span><span>Correcta (IA)</span><span>Resultado / corrección</span></div>
        {comparisonRows.map((row) => <div className="page-row" key={row.questionId}>
          <span>{row.questionId}</span><span>{row.answer.join(", ") || "En blanco"}</span><span>{row.correct.join(", ") || "—"}</span>
          <span className="actions"><strong>{row.result}</strong>{row.readingId ? <select className="input" disabled={busy} value={row.answer[0] ?? ""} onChange={(event) => saveAnswer(row.questionId, row.readingId, event.target.value)}><option value="">En blanco</option>{row.options.map((option) => <option key={option} value={option}>{option}</option>)}</select> : null}</span>
        </div>)}
      </div>
      {submission?.comparisonConfirmedAt ? <p className="notice" role="status">Comparación confirmada para la revisión de solucionario {submission.comparisonAnswerKeyRevisionId}.</p> : null}
      <div className="actions"><button className="button" disabled={busy || !canConfirm} onClick={confirmComparison}>Confirmar comparación</button><a className="button secondary" aria-disabled={!submission?.comparisonConfirmedAt} href={submission?.comparisonConfirmedAt ? `${base}/submissions/${params.submissionId}/grade` : undefined} onClick={(event) => { if (!submission?.comparisonConfirmedAt) event.preventDefault(); }}>Siguiente: calificación</a></div>
    </section>
  </main>;
}
