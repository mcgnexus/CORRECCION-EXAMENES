"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type Question = { questionId: string; number: number; label: string; type: string; text: string; options: Array<{ label: string; text: string }> };
type Solution = { solutionProposalId: string; questionId: string; provider: "gemini" | "deepseek"; model: string; answer: unknown; explanation: string; alternatives: string[]; confidence: number; doubts: string[]; sourceMissing: boolean };
type Decision = { questionId: string; sectionId?: string; answer: unknown; explanation: string; rubric: { criteria: Array<{ id: string; description: string; maxPoints: number; requiredEvidence: string; validAlternatives: string[]; partialScoring: string; commonErrors: string[]; dependsOnCriterionIds: string[] }>; totalMax: number }; proposalIds: string[]; sourceEvidenceIds: string[]; humanNote?: string; resolved: boolean };
type AnswerKey = { answerKeyRevisionId: string; status: string; decisions: Record<string, Decision>; blockingIssues: string[] };
type Payload = { revision: { examRevisionId: string; status: string; answerKeyRevisionId?: string }; questions: Question[]; solutions: Solution[]; answerKey: AnswerKey | null };

function selectedLabels(decision: Decision | undefined) {
  const answer = decision?.answer;
  if (Array.isArray(answer)) return answer.map(String);
  if (answer && typeof answer === "object" && Array.isArray((answer as { selectedOptionIds?: unknown[] }).selectedOptionIds)) return (answer as { selectedOptionIds: unknown[] }).selectedOptionIds.map(String);
  return [];
}

function isOpen(question: Question) { return !["single_choice", "multiple_choice"].includes(question.type); }

export default function AnswerKeyPage() {
  const params = useParams<{ id: string; revisionId: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [etag, setEtag] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [draft, setDraft] = useState<Record<string, { selected: string; text: string; maxPoints: number }>>({});

  async function deleteAnswerKey() {
    if (!window.confirm("¿Eliminar el solucionario generado? Podrás regenerarlo después.")) return;
    setDeleting(true);
    const response = await fetch(`/api/exams/${params.id}/revisions/${params.revisionId}/answer-key`, { method: "DELETE", headers: { origin: window.location.origin } });
    setDeleting(false);
    if (!response.ok) {
      const payload = await response.json() as { error?: { message?: string } };
      setMessage(payload.error?.message ?? "No se pudo eliminar el solucionario.");
      return;
    }
    await load();
    setMessage("Solucionario eliminado. Puedes generarlo de nuevo.");
  }
  const load = useCallback(async () => {
    const response = await fetch(`/api/exams/${params.id}/revisions/${params.revisionId}/solutions`);
    const payload = await response.json() as { data?: Payload; error?: { message?: string } };
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "No se pudo cargar el solucionario.");
    setData(payload.data);
    setEtag(response.headers.get("etag") ?? "");
    setDraft(Object.fromEntries(payload.data.questions.map((question) => {
      const decision = payload.data?.answerKey?.decisions[question.questionId];
      return [question.questionId, { selected: selectedLabels(decision)[0] ?? "", text: typeof decision?.answer === "string" ? decision.answer : "", maxPoints: decision?.rubric.totalMax || 1 }];
    })));
  }, [params.id, params.revisionId]);

  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : "Error de carga.")); }, [load]);

  const solutionsByQuestion = useMemo(() => {
    const grouped = new Map<string, Solution[]>();
    for (const solution of data?.solutions ?? []) grouped.set(solution.questionId, [...(grouped.get(solution.questionId) ?? []), solution]);
    return grouped;
  }, [data]);

  async function autofill() {
    if (!data) return;
    setBusy(true);
    const response = await fetch(`/api/exams/${params.id}/revisions/${params.revisionId}/answer-key/autofill`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ expectedEtag: etag || undefined }) });
    const payload = await response.json() as { error?: { message?: string } };
    setBusy(false);
    if (!response.ok) { setMessage(payload.error?.message ?? "No se pudo generar el solucionario."); return; }
    await load();
    setMessage("Solucionario generado desde las respuestas de la IA. Revisa y aprueba.");
  }

  async function save() {
    if (!data?.answerKey) return;
    setBusy(true);
    const decisions = Object.fromEntries(data.questions.map((question) => {
      const base = data.answerKey!.decisions[question.questionId];
      const current = draft[question.questionId];
      if (!base) return [question.questionId, undefined];
      if (isOpen(question)) {
        const maxPoints = current?.maxPoints || base.rubric.totalMax || 1;
        const criteria = base.rubric.criteria.length ? base.rubric.criteria.map((criterion, index) => index === 0 ? { ...criterion, maxPoints } : criterion) : [{ id: `criterion-${question.questionId}`, description: "Respuesta correcta y completa.", maxPoints, requiredEvidence: "Contenido de la respuesta del alumno.", validAlternatives: [], partialScoring: "Proporcional a los elementos correctos.", commonErrors: [], dependsOnCriterionIds: [] }];
        return [question.questionId, { ...base, answer: current?.text ?? base.answer, rubric: { criteria, totalMax: criteria.reduce((total, criterion) => total + criterion.maxPoints, 0) } }];
      }
      return [question.questionId, { ...base, answer: { selectedOptionIds: current?.selected ? [current.selected] : [] } }];
    }).filter(([, decision]) => Boolean(decision)));
    const complete = data.questions.every((question) => Boolean(decisions[question.questionId]));
    const response = await fetch(`/api/exams/${params.id}/revisions/${params.revisionId}/answer-key`, { method: "PATCH", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ expectedEtag: etag, decisions, blockingIssues: complete ? [] : data.answerKey.blockingIssues }) });
    const payload = await response.json() as { error?: { message?: string } };
    setBusy(false);
    if (!response.ok) { setMessage(payload.error?.message ?? "No se pudo guardar el solucionario."); return; }
    await load();
    setMessage("Solucionario guardado.");
  }

  async function approve() {
    if (!data?.answerKey) return;
    setBusy(true);
    const response = await fetch(`/api/exams/${params.id}/revisions/${params.revisionId}/answer-key/approve`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ expectedEtag: etag }) });
    const payload = await response.json() as { error?: { message?: string } };
    setBusy(false);
    if (!response.ok) { setMessage(payload.error?.message ?? "No se pudo aprobar el solucionario."); return; }
    await load();
    setMessage("Solucionario aprobado. Ya puedes crear el lote y subir los exámenes de los alumnos.");
  }

  async function createBatch() {
    setBusy(true);
    const response = await fetch(`/api/exams/${params.id}/batches/quick`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ maxPages: 30 }) });
    const payload = await response.json() as { data?: { batchId: string }; error?: { message?: string } };
    setBusy(false);
    if (!response.ok || !payload.data?.batchId) { setMessage(payload.error?.message ?? "No se pudo crear el lote."); return; }
    window.location.href = `/exams/${params.id}/batches/${payload.data.batchId}`;
  }

  const approved = data?.answerKey?.status === "approved";

  return (
    <main className="shell">
      <header className="topbar"><a className="eyebrow" href={`/exams/${params.id}`}>Volver al examen</a><span className="status">Solucionario</span></header>
      <section>
        <h1>Resolución del examen.</h1>
        <p className="intro">DeepSeek lee el examen y propone una respuesta por pregunta. Revisa, corrige si hace falta y aprueba: la corrección de los alumnos usará esta resolución.</p>
        {message ? <p className="notice" role="status">{message}</p> : null}
        {!data ? <p className="intro">Cargando...</p> : <>
          {data.questions.length === 0 ? <div className="notice" role="status">
            <strong>No hay preguntas para mostrar en esta revisión.</strong>
            <p>La lectura no produjo una estructura válida, así que no se pudo preparar el solucionario. Vuelve al examen y reintenta para crear una revisión nueva.</p>
            <a className="button" href={`/exams/${params.id}`}>Volver al examen</a>
          </div> : <>
          <div className="actions">
            <button className="button" type="button" disabled={busy} onClick={autofill}>{data.answerKey ? "Regenerar con IA" : "Generar solucionario con IA"}</button>
            <button className="button secondary" type="button" disabled={busy || deleting || !data.answerKey} onClick={deleteAnswerKey}>{deleting ? "Eliminando..." : "Eliminar solucionario"}</button>
            <button className="button" type="button" disabled={busy || !data.answerKey || approved} onClick={approve}>Aprobar solucionario</button>
            <button className="button secondary" type="button" disabled={busy || !approved} onClick={createBatch}>Crear lote de corrección</button>
          </div>
          {data.answerKey ? <p className="intro">Estado del solucionario: <strong>{data.answerKey.status}</strong>. {data.answerKey.blockingIssues.length ? `Incidencias: ${data.answerKey.blockingIssues.join(", ")}.` : "Sin incidencias."}</p> : null}
          <div className="page-list">
            {data.questions.map((question) => {
              const decision = data.answerKey?.decisions[question.questionId];
              const solutions = solutionsByQuestion.get(question.questionId) ?? [];
              return (
                <article className="card" key={question.questionId}>
                  <strong>#{question.number} {question.label} · {question.type}</strong>
                  <p>{question.text}</p>
                  {isOpen(question) ? (
                    <div className="mini-form">
                      <label className="label">Respuesta de referencia<textarea className="input" rows={3} value={draft[question.questionId]?.text ?? ""} onChange={(event) => setDraft((current) => ({ ...current, [question.questionId]: { ...current[question.questionId], text: event.target.value } }))} /></label>
                      <label className="label">Puntos máximos<input className="input" type="number" min="0.5" step="0.5" value={draft[question.questionId]?.maxPoints ?? 1} onChange={(event) => setDraft((current) => ({ ...current, [question.questionId]: { ...current[question.questionId], maxPoints: Number(event.target.value) } }))} /></label>
                    </div>
                  ) : (
                    <label className="label">Respuesta correcta<select className="input" value={draft[question.questionId]?.selected ?? ""} onChange={(event) => setDraft((current) => ({ ...current, [question.questionId]: { ...current[question.questionId], selected: event.target.value } }))}><option value="">Sin respuesta</option>{question.options.map((option) => <option value={option.label} key={option.label}>{option.label}) {option.text}</option>)}</select></label>
                  )}
                  <p className="intro">{decision ? decision.humanNote ?? "Decisión manual." : "Sin decisión todavía."}</p>
                  <div className="page-list">
                    {solutions.map((solution) => <div className="page-row" key={solution.solutionProposalId}><span>{solution.provider}</span><span>{solution.confidence.toFixed(2)}</span><span>{String(typeof solution.answer === "string" ? solution.answer : JSON.stringify(solution.answer)).slice(0, 120)}</span></div>)}
                  </div>
                </article>
              );
            })}
          </div>
          </>}
        </>}
      </section>
    </main>
  );
}
