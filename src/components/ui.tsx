import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "rec";
const variants: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-[#333a34] active:bg-black",
  secondary: "bg-raised text-ink border border-line-strong hover:bg-wash",
  ghost: "text-ink-2 hover:bg-wash hover:text-ink",
  danger: "bg-rec text-white hover:bg-[#c93b2e]",
  rec: "bg-rec-soft text-rec hover:bg-[#f7d6d1]",
};

export function Button({ variant = "secondary", size = "md", loading, children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  const s = size === "sm" ? "h-7 px-2.5 text-[12.5px] gap-1.5 rounded-[7px]" : size === "lg" ? "h-10 px-4 text-[14px] gap-2 rounded-[10px]" : "h-8 px-3 text-[13px] gap-1.5 rounded-[8px]";
  return (
    <button {...rest} disabled={rest.disabled || loading} className={`inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors disabled:opacity-45 disabled:pointer-events-none ${s} ${variants[variant]} ${className}`}>
      {loading && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className = "", active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button {...rest} aria-label={label} title={label} className={`inline-grid size-8 shrink-0 place-items-center rounded-[8px] text-ink-2 transition-colors hover:bg-wash hover:text-ink disabled:opacity-40 ${active ? "bg-wash text-ink" : ""} ${className}`}>
      {children}
    </button>
  );
}

export function Badge({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: "neutral" | "accent" | "rec" | "warn"; className?: string }) {
  const t = { neutral: "bg-wash text-ink-2", accent: "bg-accent-soft text-accent", rec: "bg-rec-soft text-rec", warn: "bg-warn-soft text-warn" }[tone];
  return <span className={`inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap ${t} ${className}`}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-[4px] border border-line bg-raised px-1 font-sans text-[10.5px] text-ink-3">{children}</kbd>;
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors disabled:opacity-40 ${checked ? "bg-accent" : "bg-line-strong"}`}>
      <span className={`absolute top-[2px] size-[14px] rounded-full bg-white shadow transition-[left] ${checked ? "left-[14px]" : "left-[2px]"}`} />
    </button>
  );
}

export function Select({ value, onChange, options, className = "", label }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
      className={`h-8 rounded-[8px] border border-line-strong bg-raised px-2 pr-7 text-[13px] text-ink outline-none hover:bg-wash ${className}`}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 className={`size-4 animate-spin text-ink-3 ${className}`} />;
}

export function Progress({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div className={`h-1 overflow-hidden rounded-full bg-wash ${className}`} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
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
        <div role="menu" className={`absolute top-[calc(100%+4px)] z-40 min-w-[200px] animate-rise rounded-[10px] border border-line bg-raised p-1 shadow-[var(--shadow-pop)] ${align === "right" ? "right-0" : "left-0"}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, danger, icon, hint }: { children: ReactNode; onClick: () => void; danger?: boolean; icon?: ReactNode; hint?: ReactNode }) {
  return (
    <button role="menuitem" onClick={onClick} className={`flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[13px] hover:bg-wash ${danger ? "text-rec" : "text-ink"}`}>
      {icon && <span className="grid size-4 place-items-center text-ink-3">{icon}</span>}
      <span className="flex-1">{children}</span>
      {hint && <span className="text-[11.5px] text-ink-3">{hint}</span>}
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
    <div className="fixed inset-0 z-50 grid animate-fade place-items-start justify-center bg-[rgb(31_36_32/0.18)] pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="animate-rise overflow-hidden rounded-[14px] border border-line bg-raised shadow-[var(--shadow-pop)]" style={{ width }}>
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
      {icon && <div className="mb-4 grid size-11 place-items-center rounded-[12px] bg-wash text-ink-2">{icon}</div>}
      <div className="text-[15px] font-semibold">{title}</div>
      {body && <div className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{body}</div>}
      {children && <div className="mt-5 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

export function Banner({ tone = "neutral", icon, children, action }: { tone?: "neutral" | "warn" | "rec" | "accent"; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  const t = { neutral: "bg-wash text-ink-2", warn: "bg-warn-soft text-[#7a4d0c]", rec: "bg-rec-soft text-[#9b2f24]", accent: "bg-accent-soft text-accent" }[tone];
  return (
    <div className={`flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13px] ${t}`}>
      {icon && <span className="shrink-0">{icon}</span>}
      <div className="flex-1 leading-snug">{children}</div>
      {action}
    </div>
  );
}

/** Live audio level meter: a few bars, like a compact waveform. */
export function LevelBars({ level, active = true, bars = 5, className = "" }: { level: number; active?: boolean; bars?: number; className?: string }) {
  const l = Math.min(1, Math.sqrt(level) * 1.6);
  return (
    <div className={`flex h-4 items-center gap-[2px] ${className}`} aria-hidden>
      {Array.from({ length: bars }).map((_, i) => {
        const shape = [0.45, 0.8, 1, 0.75, 0.5, 0.85, 0.6][i % 7];
        const h = active ? Math.max(0.18, l * shape) : 0.18;
        return <span key={i} className="w-[3px] rounded-full bg-current transition-[height] duration-100" style={{ height: `${h * 100}%` }} />;
      })}
    </div>
  );
}
