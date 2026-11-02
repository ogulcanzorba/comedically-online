export interface RuleCardRule {
  id: string;
  modality: string;
  title: string;
  description: string;
  action: string;
  severity: string;
  explanation: string;
  examples: string[];
}

function ModalityIcon({ modality }: { modality: string }) {
  if (modality === 'video') {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="3" y="6" width="12" height="12" rx="2" />
        <polygon points="15,10 21,6 21,18 15,14" />
      </svg>
    );
  }
  if (modality === 'text') {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 10v4h3l4 4V6l-4 4H4z" />
      <path d="M15 9a4 4 0 0 1 0 6" />
    </svg>
  );
}

const SEVERITY_CLS: Record<string, string> = {
  low: 'bg-neutral-700 text-neutral-200',
  medium: 'bg-amber-300/20 text-amber-200',
  high: 'bg-red-500/20 text-red-200',
};

/** One rulebook rule, rendered for comedians (reference + acceptance). */
export function RuleCard({ rule }: { rule: RuleCardRule }) {
  return (
    <article className="rounded-md border border-neutral-800 bg-neutral-900/60 p-5" aria-label={`Rule: ${rule.title}`}>
      <div className="flex items-center gap-2 text-spotlight">
        <ModalityIcon modality={rule.modality} />
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{rule.modality}</span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${SEVERITY_CLS[rule.severity] ?? SEVERITY_CLS.low}`}>
          {rule.severity} · {rule.action}
        </span>
      </div>
      <h3 className="mt-2 font-serif text-xl">{rule.title}</h3>
      <p className="mt-1 text-sm text-neutral-300">{rule.description}</p>
      {rule.examples.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-neutral-400">
          {rule.examples.map((ex) => (
            <li key={ex}>{ex}</li>
          ))}
        </ul>
      )}
      <p className="mt-3 border-t border-neutral-800 pt-2 text-sm">
        <span className="font-semibold text-neutral-200">Why: </span>
        <span className="text-neutral-400">{rule.explanation}</span>
      </p>
      <p className="mt-1 font-mono text-[11px] text-neutral-500">{rule.id}</p>
    </article>
  );
}
