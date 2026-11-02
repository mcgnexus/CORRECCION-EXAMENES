"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Submission = { submissionId: string; state: string; assetIds: string[]; suggestedIdentity?: string; identityConfidence?: number; confirmedIdentity?: string; readingIds: string[]; snapshotId?: string };
type Reading = { readingId: string; status: string; rows: Array<{ questionId: string; status: string; selectedOptionIds: string[]; candidateOptionIds: string[]; requiresHumanReview: boolean }> };

export default function BatchPage() {
  const params = useParams<{ id: string; batchId: string }>();
  const base = `/api/exams/${params.id}/batches/${params.batchId}/submissions`;
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selected, setSelected] = useState<Submission | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [identity, setIdentity] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(base);
    const payload = await response.json() as { data?: Submission[]; error?: { message?: string } };
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "No se pudo cargar el lote.");
    setSubmissions(payload.data);
  }, [base]);

  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : "Error de carga.")); }, [load]);

  async function openSubmission(submission: Submission) {
    setSelected(submission);
    setIdentity(submission.confirmedIdentity ?? submission.suggestedIdentity ?? "");
    setReading(null);
    if (submission.readingIds.length > 0) {
      const response = await fetch(`/api/assets/${submission.readingIds[0]}/metadata`);
      void response;
    }
    setMessage(null);
  }

  async function postAction(body: Record<string, unknown>) {
    if (!selected) return;
    setBusy(true);
    const response = await fetch(`${base}/${selected.submissionId}`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify(body) });
    const payload = await response.json() as { data?: unknown; error?: { message?: string } };
    setBusy(false);
    if (!response.ok) { setMessage(payload.error?.message ?? "La acción falló."); return; }
    setMessage("Acción completada.");
    await load();
    if (body.action === "score") setSelected(payload.data as Submission ?? selected);
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

  return (
    <main className="shell">
      <header className="topbar"><a className="eyebrow" href={`/exams/${params.id}`}>Volver al examen</a><span className="status">Corrección de entregas</span></header>
      <section>
        <h1>Lote de corrección.</h1>
        <p className="intro">Identidad confirmada, lectura OMR y decisión humana antes de puntuar. Las incidencias bloquean el cierre.</p>
        {message ? <p className="notice" role="status">{message}</p> : null}
        <div className="detail-grid">
          <div className="panel">
            <h2>Entregas</h2>
            <div className="page-list">{submissions.map((submission) => <div className={`page-row ${selected?.submissionId === submission.submissionId ? "selected" : ""}`} key={submission.submissionId} onClick={() => openSubmission(submission)}><span>#{submission.submissionId.slice(0, 8)}</span><span>{submission.confirmedIdentity ?? submission.suggestedIdentity ?? "sin identidad"}</span><span className="eyebrow">{submission.state}</span></div>)}</div>
            {selected ? <div className="actions"><button className="button secondary" type="button" disabled={busy} onClick={addSubmissionFromPageIds}>Registrar assets de nuevo</button><button className="button" type="button" disabled={busy} onClick={startOmr}>Iniciar lectura OMR</button></div> : null}
          </div>
          <div className="panel">
            <h2>Decisión</h2>
            {selected ? <>
              <label className="label">Identidad confirmada<input className="input" value={identity} onChange={(event) => setIdentity(event.target.value)} /></label>
              <div className="actions"><button className="button secondary" type="button" disabled={busy || !identity} onClick={() => postAction({ action: "confirm-identity", identity })}>Confirmar identidad</button><button className="button" type="button" disabled={busy || selected.state !== "review"} onClick={() => postAction({ action: "score" })}>Puntuar entrega</button></div>
              {selected.snapshotId ? <p className="intro">Snapshot: {selected.snapshotId}</p> : null}
              {reading ? <p className="intro">Lectura: {reading.readingId} ({reading.status})</p> : null}
              <p className="intro">Las filas ambiguas, dobles o ilegibles requieren decisión en la cola de revisión antes de puntuar.</p>
            </> : <p className="intro">Selecciona una entrega.</p>}
          </div>
        </div>
      </section>
    </main>
  );
}
