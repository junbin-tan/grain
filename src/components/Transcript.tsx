import { useEffect, useMemo, useRef, useState } from "react";
import { Flag, Search } from "lucide-react";
import { api, type Mark, type Segment } from "../lib/api";
import { fmtTs, langName } from "../lib/format";
import { EmptyState, SpeakerLabel, Spinner } from "./ui";

function SegmentText({ seg, onSaved }: { seg: Segment; onSaved: (text: string) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <span ref={ref} contentEditable suppressContentEditableWarning spellCheck={false}
      onBlur={async () => {
        const t = ref.current?.innerText.trim() ?? "";
        if (t && t !== seg.text) {
          await api.updateSegment(seg.id, t);
          onSaved(t);
        }
      }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLElement).blur(); } if (e.key === "Escape") { (e.target as HTMLElement).innerText = seg.text; (e.target as HTMLElement).blur(); } }}
      className="rounded-[3px] outline-none focus:bg-paper-raised focus:shadow-[0_0_0_3px_var(--paper-raised)]">
      {seg.text}
    </span>
  );
}

export function TranscriptView({ segments, marks, at, live, onChanged, emptyHint }: { segments: Segment[]; marks: Mark[]; at?: number; live?: boolean; onChanged: () => void; emptyHint?: React.ReactNode }) {
  const [q, setQ] = useState("");
  const [, force] = useState(0);
  const target = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  // Consecutive lines from the same speaker read as one turn.
  const turns = useMemo(() => {
    const list = q ? segments.filter((s) => s.text.toLowerCase().includes(q.toLowerCase())) : segments;
    const out: { speaker: string | null; start: number; segs: Segment[] }[] = [];
    for (const s of list) {
      const last = out[out.length - 1];
      if (last && last.speaker === s.speaker && s.startMs - last.segs[last.segs.length - 1].endMs < 4000 && last.segs.length < 6) last.segs.push(s);
      else out.push({ speaker: s.speaker, start: s.startMs, segs: [s] });
    }
    return out;
  }, [segments, q]);

  const targetId = useMemo(() => {
    if (at == null) return null;
    let best: Segment | null = null;
    for (const s of segments) if (s.startMs <= at + 500) best = s;
    return best?.id ?? segments[0]?.id ?? null;
  }, [at, segments]);

  useEffect(() => target.current?.scrollIntoView({ block: "center", behavior: "smooth" }), [targetId]);
  useEffect(() => { if (live) bottom.current?.scrollIntoView({ block: "end" }); }, [segments.length, live]);

  if (segments.length === 0) {
    return live ? (
      <div className="flex items-center gap-2 py-10 text-[13px] text-ink-subtle"><Spinner /> Listening… text appears a few seconds after each pause.</div>
    ) : (
      <EmptyState title="No transcript" body={emptyHint ?? "Record this meeting to get a transcript."} />
    );
  }

  const languages = [...new Set(segments.map((s) => s.language).filter(Boolean))] as string[];
  const marksBetween = (a: number, b: number) => marks.filter((m) => m.atMs >= a && m.atMs < b);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-subtle" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search transcript"
            className="h-8 w-full rounded-md border border-line bg-paper-raised pr-2 pl-8 text-[13px] outline-none placeholder:text-ink-subtle focus:border-line-strong" />
        </div>
        <div className="text-[12px] whitespace-nowrap text-ink-subtle">
          {segments.length} {segments.length === 1 ? "line" : "lines"}{languages.length > 0 && ` · ${languages.map(langName).join(", ")}`} · {segments[0].modelId}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {turns.map((t, i) => {
          const next = turns[i + 1]?.start ?? Infinity;
          return (
            <div key={t.segs[0].id}>
              {marksBetween(i === 0 ? -1 : t.start, next).map((m) => (
                <div key={m.id} className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-malt-ink"><Flag className="size-3" /> {m.label || "Marked moment"} <span className="timestamp">{fmtTs(m.atMs)}</span></div>
              ))}
              <div className={`gr-line ${t.segs.some((s) => s.id === targetId) ? "gr-line--cited" : ""}`}>
                <div className="gr-line__meta">
                  <SpeakerLabel speaker={t.speaker} />
                  <span className="gr-line__time">{fmtTs(t.start)}</span>
                </div>
                <div className="min-w-0">
                  <div>
                    {t.segs.map((s) => (
                      <span key={s.id} ref={s.id === targetId ? target : undefined} title={s.edited ? `Edited. Original: ${s.originalText}` : fmtTs(s.startMs)}>
                        <SegmentText seg={s} onSaved={(text) => { s.text = text; s.edited = text !== s.originalText; force((n) => n + 1); onChanged(); }} />
                        {s.edited && <sup className="ml-0.5 text-[9px] text-ink-subtle">edited</sup>}{" "}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div ref={bottom} />
    </div>
  );
}
