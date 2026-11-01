"use client";

import { FormEvent, useEffect, useState } from "react";

type Exam = { examId: string; title: string; subject: string; state: string; updatedAt: string };

export default function ExamsPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const response = await fetch("/api/exams");
    const payload = (await response.json()) as { data?: Exam[]; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message ?? "No se pudieron cargar los exámenes.");
    setExams(payload.data ?? []);
  }

  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : "No se pudieron cargar los exámenes.")).finally(() => setLoading(false)); }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const response = await fetch("/api/exams", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ title, subject }) });
    const payload = (await response.json()) as { error?: { message?: string } };
    if (!response.ok) { setMessage(payload.error?.message ?? "No se pudo crear el examen."); return; }
    setTitle("");
    setSubject("");
    await load();
  }

  return (
    <main className="shell">
      <header className="topbar"><a className="eyebrow" href="/">Corrector de exámenes</a><span className="status">Área del docente</span></header>
      <section>
        <h1>Preparar un examen antes de corregirlo.</h1>
        <p className="intro">Crea el agregado del examen. La extracción, el solucionario y la subida de documentos solo se habilitan cuando sus capacidades técnicas estén verificadas.</p>
        <form className="form" onSubmit={create}>
          <label className="label">Título<input className="input" value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
          <label className="label">Asignatura<input className="input" value={subject} onChange={(event) => setSubject(event.target.value)} required /></label>
          {message ? <p className="notice" role="alert">{message}</p> : null}
          <button className="button" type="submit">Crear examen en borrador</button>
        </form>
        <div className="list" aria-live="polite">
          {loading ? <p className="intro">Cargando...</p> : exams.length === 0 ? <p className="intro">Todavía no hay exámenes persistidos.</p> : exams.map((exam) => <article className="list-item" key={exam.examId}><div><strong>{exam.title}</strong><br /><small>{exam.subject}</small></div><span className="eyebrow">{exam.state}</span></article>)}
        </div>
      </section>
    </main>
  );
}
