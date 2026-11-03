"use client";

import { ExamWorkflowNav } from "@/components/exam-workflow-nav";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

type Batch = { batchId: string; state: string; answerKeyRevisionId: string; templateRevisionId: string };

export default function StudentQueueStartPage() {
  const { id: examId } = useParams<{ id: string }>();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/exams/${examId}/batches`).then(async (response) => {
      const payload = await response.json() as { data?: Batch[]; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "No se pudieron cargar los lotes.");
      setBatches(payload.data ?? []);
    }).catch((error) => setMessage(error instanceof Error ? error.message : "No se pudieron cargar los lotes."));
  }, [examId]);

  async function createOrContinueBatch() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/exams/${examId}/batches/quick`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ maxPages: 30 }) });
      const payload = await response.json() as { data?: Batch; error?: { code?: string; message?: string } };
      if (!response.ok || !payload.data?.batchId) throw new Error(`${payload.error?.code ?? "ERROR"}: ${payload.error?.message ?? "No se pudo crear el lote."}`);
      window.location.href = `/exams/${examId}/batches/${payload.data.batchId}`;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo crear el lote.");
      setBusy(false);
    }
  }

  const openBatches = batches.filter((batch) => !["closed", "cancelled"].includes(batch.state));

  return (
    <main className="shell">
      <header className="topbar"><a className="eyebrow" href={`/exams/${examId}/omr-template`}>Volver a la plantilla</a><span className="status">Paso 4 · Respuestas de alumnos</span></header>
      <section>
        <h1>Respuestas de los alumnos.</h1>
        <ExamWorkflowNav current={4} links={[
          { stage: 1, title: "Examen", href: `/exams/${examId}`, enabled: true },
          { stage: 2, title: "Respuestas IA", href: `/exams/${examId}/answers`, enabled: true },
          { stage: 3, title: "Plantilla OMR", href: `/exams/${examId}/omr-template`, enabled: true },
          { stage: 4, title: "Alumnos", href: `/exams/${examId}/students`, enabled: true },
          { stage: 5, title: "Comparar", href: `/exams/${examId}/students`, enabled: false },
          { stage: 6, title: "Calificar", href: `/exams/${examId}/students`, enabled: false },
        ]} />
        <p className="intro">Inicia o continúa el lote. Después podrás subir varios archivos y procesar a cada alumno individualmente, confirmando identidad y respuestas antes de pasar a comparación.</p>
        {message ? <p className="notice" role="status">{message}</p> : null}
        {openBatches.length ? <section className="panel"><h2>Lotes pendientes</h2><ul>{openBatches.map((batch) => <li key={batch.batchId}><a href={`/exams/${examId}/batches/${batch.batchId}`}>Abrir lote {batch.batchId.slice(0, 8)}</a> · {batch.state}</li>)}</ul></section> : null}
        <button className="button" type="button" disabled={busy} onClick={createOrContinueBatch}>{busy ? "Preparando lote…" : openBatches.length ? "Continuar lote" : "Crear lote de corrección"}</button>
      </section>
    </main>
  );
}
