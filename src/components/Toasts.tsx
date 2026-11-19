import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useApp } from "../lib/store";

export function Toasts() {
  const { toasts, dismiss } = useApp();
  return (
    <div className="no-print pointer-events-none fixed top-4 right-4 z-[60] flex w-[360px] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.kind === "error" ? AlertCircle : t.kind === "success" ? CheckCircle2 : Info;
        return (
          <div key={t.id} role={t.kind === "error" ? "alert" : "status"} className="pointer-events-auto flex animate-rise items-start gap-2.5 rounded-md border border-line bg-paper-raised px-3 py-2.5 shadow-[var(--shadow-raised)]">
            <Icon className={`mt-[1px] size-4 shrink-0 ${t.kind === "error" ? "text-clay" : t.kind === "success" ? "text-sprout" : "text-ink-subtle"}`} />
            <div className="flex-1 text-[13px] leading-snug text-ink">{t.text}</div>
            {t.action && <button onClick={() => { t.action!.run(); dismiss(t.id); }} className="shrink-0 text-[12.5px] font-medium text-ink underline">{t.action.label}</button>}
            <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="shrink-0 text-ink-subtle hover:text-ink"><X className="size-3.5" /></button>
          </div>
        );
      })}
    </div>
  );
}
