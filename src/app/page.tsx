const cards = [
  ["Solucionarios aprobados", "Cada clave y rúbrica se conserva como revisión inmutable antes de corregir."],
  ["Lectura con evidencias", "Original, transcripción, recortes y observaciones permanecen relacionados."],
  ["Decisión humana", "Las propuestas de los modelos orientan la revisión; nunca cierran una nota por sí solas."],
] as const;

export default function HomePage() {
  return (
    <main className="shell">
      <header className="topbar">
        <span className="eyebrow">Corrector de exámenes / preview</span>
        <span className="status">Base técnica en preparación</span>
      </header>
      <section>
        <h1>Corregir con contexto, no con suposiciones.</h1>
        <p className="intro">
          Espacio privado para preparar solucionarios, leer respuestas y revisar notas con trazabilidad completa.
          Esta vista no contiene resultados simulados: el procesamiento se habilitará cuando sus capacidades reales
          estén verificadas.
        </p>
      </section>
      <section className="grid" aria-label="Principios del producto">
        {cards.map(([title, description]) => (
          <article className="card" key={title}>
            <strong>{title}</strong>
            <p>{description}</p>
          </article>
        ))}
      </section>
      <div className="actions">
        <a className="button" href="/login">Acceder al espacio privado</a>
      </div>
    </main>
  );
}
