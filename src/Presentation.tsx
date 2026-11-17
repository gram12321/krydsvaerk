import type { ReactNode } from "react";

export function SiteHeader({ edition, homeTarget = "#top" }: { edition: string; homeTarget?: string }) {
  return <header className="site-header">
    <a className="brand" href={homeTarget} aria-label="Krydsværk, til forsiden">
      <span className="brand-mark" aria-hidden="true"><span>K</span><span>R</span><span>Y</span><span>D</span></span>
      <span>krydsværk<span className="brand-dot">.</span></span>
    </a>
    <div className="site-header-note"><span /> EN LILLE PAUSE TIL HOVEDET</div>
    <span className="site-header-edition">{edition} <span aria-hidden="true">✳</span></span>
  </header>;
}

export function PageIntro({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children: ReactNode }) {
  return <div className="page-intro"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-description">{children}</p></div>;
}

export function PanelHeading({ number, label, title, id, level = 2, actions }: {
  number: string;
  label: string;
  title: ReactNode;
  id?: string;
  level?: 2 | 3;
  actions?: ReactNode;
}) {
  const Heading = level === 3 ? "h3" : "h2";
  return <header className="panel-heading shared-panel-heading"><div className="panel-heading-copy"><span>{number} / {label}</span><Heading id={id}>{title}</Heading></div>{actions}</header>;
}
