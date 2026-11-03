"use client";

export type WorkflowLink = { stage: number; title: string; href: string; enabled: boolean };

export function ExamWorkflowNav({ current, links }: { current: number; links: WorkflowLink[] }) {
  return (
    <nav aria-label="Etapas de corrección" className="actions">
      {links.map((link) => link.enabled ? (
        <a className={`button ${link.stage === current ? "" : "secondary"}`} aria-current={link.stage === current ? "step" : undefined} href={link.href} key={link.stage}>
          {link.stage}. {link.title}
        </a>
      ) : (
        <span className="button secondary" aria-disabled="true" key={link.stage} style={{ opacity: 0.55, cursor: "not-allowed" }}>
          {link.stage}. {link.title}
        </span>
      ))}
    </nav>
  );
}
