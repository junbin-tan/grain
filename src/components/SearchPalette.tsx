import { useEffect, useMemo, useRef, useState } from "react";
import { CheckSquare, FileText, Quote, Search, Sparkles } from "lucide-react";
import { api, type SearchHit } from "../lib/api";
import { fmtDate, fmtTs, highlight } from "../lib/format";
import { useApp } from "../lib/store";
import { Kbd, Spinner, Toggle } from "./ui";

const FILTERS = [
  { id: "all", label: "All", kinds: undefined },
  { id: "transcript", label: "Transcripts", kinds: ["segment"] },
  { id: "notes", label: "Notes", kinds: ["manual", "enhanced", "title"] },
  { id: "action", label: "Action items", kinds: ["action"] },
] as const;

const KIND_LABEL: Record<string, string> = { segment: "Transcript", manual: "My notes", enhanced: "Enhanced notes", title: "Title", action: "Action item" };

export function SearchPalette() {
  const { searchOpen, setSearchOpen, navigate, catalog, settings } = useApp();
  const [q, setQ] = useState<string>(() => (window as any).__grainUi?.query ?? "");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [semantic, setSemantic] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const embedReady = catalog.some((c) => c.id === settings.embedModel && c.status === "ready");

  useEffect(() => { if (searchOpen) { setTimeout(() => input.current?.focus(), 10); setSel(0); } }, [searchOpen]);

  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const kinds = FILTERS.find((f) => f.id === filter)!.kinds as string[] | undefined;
    setLoading(true);
    const t = setTimeout(() => {
      api.search(q, kinds, semantic && embedReady).then((h) => { setHits(h); setSel(0); }).catch(() => setHits([])).finally(() => setLoading(false));
    }, semantic ? 250 : 120);
    return () => clearTimeout(t);
  }, [q, filter, semantic]);

  const groups = useMemo(() => {
    const g = new Map<string, SearchHit[]>();
    for (const h of hits) g.set(h.meetingId, [...(g.get(h.meetingId) ?? []), h]);
    return [...g.values()];
  }, [hits]);
  const flat = groups.flat();

  if (!searchOpen) return null;
  const open = (h: SearchHit) => {
    const kind = h.kind.replace(":semantic", "");
    setSearchOpen(false);
    navigate({ name: "meeting", id: h.meetingId, tab: kind === "segment" ? "transcript" : kind === "manual" ? "notes" : kind === "title" ? undefined : "enhanced", at: h.startMs ?? undefined });
  };

  return (
    <div className="fixed inset-0 z-50 flex animate-fade justify-center bg-[rgb(31_36_32/0.16)] pt-[11vh]" onMouseDown={(e) => e.target === e.currentTarget && setSearchOpen(false)}>
      <div className="flex h-fit max-h-[70vh] w-[640px] animate-rise flex-col overflow-hidden rounded-[14px] border border-line bg-raised shadow-[var(--shadow-pop)]"
        onKeyDown={(e) => {
          if (e.key === "Escape") setSearchOpen(false);
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(flat.length - 1, s + 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          if (e.key === "Enter" && flat[sel]) open(flat[sel]);
        }}>
        <div className="flex h-12 items-center gap-2.5 border-b border-line px-4">
          {loading ? <Spinner /> : <Search className="size-4 text-ink-3" />}
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search meetings, notes, transcripts…" className="h-full flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-ink-3" />
          <Kbd>esc</Kbd>
        </div>
        <div className="flex items-center gap-1 border-b border-line px-3 py-1.5">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={`h-6 rounded-full px-2.5 text-[12px] ${filter === f.id ? "bg-ink text-white" : "text-ink-2 hover:bg-wash"}`}>{f.label}</button>
          ))}
          <div className="flex-1" />
          <label className={`flex items-center gap-2 text-[12px] ${embedReady ? "text-ink-2" : "text-ink-3"}`} title={embedReady ? "Also match by meaning, using the local embedding model" : "Install an embedding model in Models to search by meaning"}>
            <Sparkles className="size-3.5" /> By meaning
            <Toggle checked={semantic && embedReady} onChange={setSemantic} disabled={!embedReady} label="Search by meaning" />
          </label>
        </div>
        <div className="scroll-y flex-1 p-1.5">
          {!q.trim() && <div className="px-3 py-6 text-center text-[12.5px] text-ink-3">Search across titles, your notes, enhanced notes, transcripts and action items. Everything is searched on this Mac.</div>}
          {q.trim() && !loading && flat.length === 0 && <div className="px-3 py-6 text-center text-[12.5px] text-ink-3">No results for “{q}”</div>}
          {groups.map((g) => (
            <div key={g[0].meetingId} className="mb-1">
              <div className="flex items-center gap-2 px-2.5 pt-2 pb-1 text-[11.5px] font-medium text-ink-3">
                <span className="truncate text-ink-2">{g[0].meetingTitle || "Untitled meeting"}</span> · {fmtDate(g[0].meetingDate)}
              </div>
              {g.map((h) => {
                const i = flat.indexOf(h);
                const kind = h.kind.replace(":semantic", "");
                const Icon = kind === "segment" ? Quote : kind === "action" ? CheckSquare : FileText;
                return (
                  <button key={`${h.kind}-${h.refId}`} onMouseEnter={() => setSel(i)} onClick={() => open(h)}
                    className={`flex w-full items-start gap-2.5 rounded-[8px] px-2.5 py-2 text-left ${i === sel ? "bg-wash" : ""}`}>
                    <Icon className="mt-[2px] size-3.5 shrink-0 text-ink-3" />
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-[13px] leading-snug text-ink" dangerouslySetInnerHTML={{ __html: highlight(h.snippet) }} />
                      <div className="mt-0.5 text-[11.5px] text-ink-3">{KIND_LABEL[kind] ?? kind}{h.startMs != null && ` · ${fmtTs(h.startMs)}`}{h.kind.endsWith(":semantic") && " · related by meaning"}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
