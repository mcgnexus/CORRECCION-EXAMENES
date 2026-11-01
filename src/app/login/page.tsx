"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login, password }) });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "No se pudo iniciar sesión.");
      router.push("/exams" as Route);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo iniciar sesión.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar"><a className="eyebrow" href="/">Corrector de exámenes</a><span className="status">Acceso privado</span></header>
      <section>
        <h1>Entrar sin abrir el archivo al mundo.</h1>
        <p className="intro">La sesión protege documentos, trabajos y exportaciones. Las credenciales solo se validan en el servidor.</p>
        <form className="form" onSubmit={submit}>
          <label className="label">Usuario<input className="input" value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" required /></label>
          <label className="label">Contraseña<input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
          {message ? <p className="notice" role="alert">{message}</p> : null}
          <button className="button" type="submit" disabled={busy}>{busy ? "Validando..." : "Iniciar sesión"}</button>
        </form>
      </section>
    </main>
  );
}
