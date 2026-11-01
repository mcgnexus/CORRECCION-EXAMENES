"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Proposal = { proposalId: string; provider: "gemini" | "deepseek"; model: string; reviewScope: string; questions: Array<{ questionId: string; number: number; label: string; type: string; text: string; options: Array<{ label: string; text: string }>; flags: string[] }>; doubts: string[]; flags: string[] };
type Revision = { examRevisionId: string; status: string; proposals: string[]; activeStructureProposalId?: string; blockingIssues: string[] };

export default function RevisionPage() {
  const params = useParams<{ id: string; revisionId: string }>();
  const [revision, setRevision] = useState<Revision | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [etag, setEtag] = useState("");
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/exams/${params.id}/revisions/${params.revisionId}/structure`);
    const payload = await response.json() as { data?: { revision: Revision; proposals: Proposal[] }; error?: { message?: string } };
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "No se pudo cargar la revisión.");
    setRevision(payload.data.revision);
    setProposals(payload.data.proposals);
    setSelected(payload.data.revision.activeStructureProposalId ?? payload.data.proposals[0]?.proposalId ?? "");
    setEtag(response.headers.get("etag") ?? "");
  }, [params.id, params.revisionId]);

  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : "No se pudo cargar la revisión.")); }, [load]);

  async function selectProposal() {
    setBusy(true);
    const response = await fetch(`/api/exams/${params.id}/revisions/${params.revisionId}/structure`, { method: "PATCH", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ expectedEtag: etag, activeStructureProposalId: selected, blockingIssues: [], status: "solving" }) });
    const payload = await response.json() as { error?: { message?: string }; data?: Revision };
    setBusy(false);
    if (!response.ok || !payload.data) { setMessage(payload.error?.message ?? "No se pudo seleccionar la estructura."); return; }
    setRevision(payload.data);
    setEtag(response.headers.get("etag") ?? etag);
    setMessage("Estructura seleccionada. Puedes iniciar el solucionario.");
  }

  async function solve() {
    setBusy(true);
    const response = await fetch(`/api/exams/${params.id}/solve`, { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ revisionId: params.revisionId, structureProposalId: selected }) });
    const payload = await response.json() as { error?: { message?: string } };
    setBusy(false);
    setMessage(response.ok ? "Solucionario iniciado. Revisa sus propuestas cuando termine." : payload.error?.message ?? "No se pudo iniciar el solucionario.");
  }

  return <main className="shell"><header className="topbar"><a className="eyebrow" href={`/exams/${params.id}`}>Volver al examen</a><span className="status">Revisión de estructura</span></header><section><h1>Comparar antes de aprobar.</h1><p className="intro">Las propuestas son independientes. Seleccionar una no aprueba preguntas ni crea una nota.</p>{message ? <p className="notice" role="status">{message}</p> : null}<div className="actions"><button className="button" type="button" disabled={!selected || busy} onClick={selectProposal}>Seleccionar estructura</button><button className="button secondary" type="button" disabled={!selected || busy || revision?.status !== "solving"} onClick={solve}>Iniciar solucionario</button></div><div className="grid">{proposals.map((proposal) => <article className={`card ${selected === proposal.proposalId ? "selected" : ""}`} key={proposal.proposalId} onClick={() => setSelected(proposal.proposalId)}><strong>{proposal.provider} · {proposal.model}</strong><p>{proposal.reviewScope} · {proposal.questions.length} preguntas · {proposal.doubts.length} dudas</p>{proposal.flags.length ? <p className="notice">{proposal.flags.join("; ")}</p> : null}<ul>{proposal.questions.slice(0, 5).map((question) => <li key={question.questionId}>#{question.number} {question.label}: {question.text.slice(0, 140)}</li>)}</ul></article>)}</div></section></main>;
}
