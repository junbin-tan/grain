import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CircleCheck, CircleDashed, Loader2, Lock, X } from "lucide-react";
import { fmtTs } from "../lib/format";

// Buttons, chips and the recording pill are the gr- components in design/components; see docs/DESIGN_SYSTEM.md.
type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger";

/** One `primary` or `accent` per view. `accent` (malt) is reserved for Enhance notes. */
export function Button({ variant = "secondary", size = "md", loading, children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || loading} className={`gr-btn gr-btn--${variant} ${size === "sm" ? "gr-btn--sm" : ""} shrink-0 justify-center ${className}`}>
      {loading && <Loader2 className="animate-spin" />}
      {children}
    </button>
  );
}

/** The kernel: seven waveform bars, the centre one malt (the cited moment). `mono` for use on malt fills. */
export function GrainMark({ mono, className = "size-4" }: { mono?: boolean; className?: string }) {
  const bars = [[12.38, 83.64, 18.06, 95.28], [22.91, 63.39, 38.06, 94.46], [36.17, 48.77, 56.29, 90.01], [51.62, 38.61, 73.32, 83.1], [69.13, 32.69, 89.25, 73.94], [88.82, 31.25, 103.97, 62.31], [111.25, 35.41, 116.93, 47.06]];
  return (
    <svg viewBox="3.13 22 123.05 82.53" className={`shrink-0 ${className}`} aria-hidden fill="none" strokeWidth="10.5" strokeLinecap="round">
      {bars.map(([x1, y1, x2, y2], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={i === 3 && !mono ? "var(--malt)" : "currentColor"} />)}
    </svg>
  );
}

/** The recording dot. Pulses while live; the only place `rec` red appears. */
export function RecDot({ pulse, className = "size-2" }: { pulse?: boolean; className?: string }) {
  return <span aria-hidden className={`shrink-0 rounded-full bg-rec ${pulse ? "animate-pulse-rec" : ""} ${className}`} />;
}

/** Every control that starts audio capture looks the same: the red dot leads the label. */
export function RecordButton({ variant = "primary", loading, children, ...rest }: Parameters<typeof Button>[0]) {
  return <Button variant={variant} loading={loading} {...rest}>{!loading && <RecDot />}{children}</Button>;
}

/** Links a claim to the transcript moment it came from. */
export function CitationChip({ n, ms, onClick, title }: { n: number; ms?: number | null; onClick?: () => void; title?: string }) {
  return <button type="button" className="gr-cite" onClick={onClick} disabled={!onClick} title={title}>{n}{ms != null && <span className="gr-cite__time">{fmtTs(ms)}</span>}</button>;
}

/** What the checker concluded about a claim, or where processing happened. Always icon + words. */
export function VerifyBadge({ state, children }: { state: "found" | "missing" | "local"; children?: ReactNode }) {
  const Icon = { found: CircleCheck, missing: CircleDashed, local: Lock }[state];
  return <span className={`gr-verify gr-verify--${state}`}><Icon strokeWidth={1.75} />{children ?? { found: "Found in transcript", missing: "Not found in transcript", local: "On this Mac" }[state]}</span>;
}

export function SpeakerLabel({ speaker }: { speaker: string | null }) {
  return <span className={`gr-speaker ${speaker === "Me" ? "gr-speaker--me" : "gr-speaker--them"}`}>{speaker ?? "Them"}</span>;
}

export function IconButton({ label, children, className = "", active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button {...rest} aria-label={label} title={label} className={`inline-grid size-8 shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-paper-sunken hover:text-ink disabled:opacity-40 ${active ? "bg-paper-sunken text-ink" : ""} ${className}`}>
      {children}
    </button>
  );
}

export function Badge({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: "neutral" | "sprout" | "clay"; className?: string }) {
  const t = { neutral: "bg-paper-sunken text-ink-muted", sprout: "bg-sprout-tint text-sprout", clay: "bg-clay-tint text-clay" }[tone];
  return <span className={`inline-flex h-5 items-center gap-1 rounded-sm px-2 text-[11.5px] font-medium whitespace-nowrap ${t} ${className}`}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-[4px] border border-line bg-paper-raised px-1 font-sans text-[10.5px] text-ink-subtle">{children}</kbd>;
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors disabled:opacity-40 ${checked ? "bg-ink" : "bg-line-strong"}`}>
      <span className={`absolute top-[2px] size-[14px] rounded-full bg-paper-raised shadow transition-[left] ${checked ? "left-[14px]" : "left-[2px]"}`} />
    </button>
  );
}

export function Select({ value, onChange, options, className = "", label }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
      className={`h-8 rounded-sm border border-line-strong bg-paper-raised px-2 pr-7 text-[13px] text-ink outline-none hover:bg-paper-sunken ${className}`}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 className={`size-4 animate-spin text-ink-subtle ${className}`} />;
}

export function Progress({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div className={`h-1 overflow-hidden rounded-full bg-paper-sunken ${className}`} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-ink transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </div>
  );
}

/** Dropdown menu anchored to its trigger. */
export function Menu({ trigger, children, align = "right" }: { trigger: (open: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      {trigger(() => setOpen((o) => !o))}
      {open && (
        <div role="menu" className={`absolute top-[calc(100%+4px)] z-40 min-w-[200px] animate-rise rounded-md border border-line bg-paper-raised p-1 shadow-[var(--shadow-raised)] ${align === "right" ? "right-0" : "left-0"}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, danger, icon, hint }: { children: ReactNode; onClick: () => void; danger?: boolean; icon?: ReactNode; hint?: ReactNode }) {
  return (
    <button role="menuitem" onClick={onClick} className={`flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px] hover:bg-paper-sunken ${danger ? "text-clay" : "text-ink"}`}>
      {icon && <span className="grid size-4 place-items-center text-ink-subtle">{icon}</span>}
      <span className="flex-1">{children}</span>
      {hint && <span className="text-[11.5px] text-ink-subtle">{hint}</span>}
    </button>
  );
}

export function Modal({ open, onClose, title, children, width = 520 }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid animate-fade place-items-start justify-center bg-ink/20 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="animate-rise overflow-hidden rounded-lg border border-line bg-paper-raised shadow-[var(--shadow-raised)]" style={{ width }}>
        {title && (
          <div className="flex h-12 items-center justify-between border-b border-line px-4">
            <div className="text-[14px] font-semibold">{title}</div>
            <IconButton label="Close" onClick={onClose}><X className="size-4" /></IconButton>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, body, children }: { icon?: ReactNode; title: string; body?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[380px] flex-col items-center py-16 text-center">
      {icon && <div className="mb-4 grid size-11 place-items-center rounded-md bg-paper-sunken text-ink-muted">{icon}</div>}
      <div className="text-[15px] font-semibold">{title}</div>
      {body && <div className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{body}</div>}
      {children && <div className="mt-5 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

export function Banner({ tone = "neutral", icon, children, action }: { tone?: "neutral" | "sprout" | "clay"; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  const t = { neutral: "bg-paper-sunken text-ink-muted", sprout: "bg-sprout-tint text-sprout", clay: "bg-clay-tint text-clay" }[tone];
  return (
    <div className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] ${t}`}>
      {icon && <span className="shrink-0">{icon}</span>}
      <div className="flex-1 leading-snug">{children}</div>
      {action}
    </div>
  );
}

/** Live audio level meter in the RecordingPill style: 7 bars (the mark's count), the centre one malt while live. */
export function LevelBars({ level, active = true, className = "" }: { level: number; active?: boolean; className?: string }) {
  const l = Math.min(1, Math.sqrt(level) * 1.6);
  return (
    <span className={`gr-rec__wave h-4 ${className}`} aria-hidden>
      {[0.3, 0.55, 0.8, 1, 0.75, 0.5, 0.3].map((shape, i) => (
        <i key={i} className={`transition-[height] duration-100 ${i === 3 && active ? "on" : ""}`} style={{ height: `${(active ? Math.max(0.2, l * shape) : 0.2) * 100}%` }} />
      ))}
    </span>
  );
}
