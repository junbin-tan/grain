import { useMemo, useState } from "react";
import { AlertTriangle, ArrowUp, FileText, Mic, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useApp } from "../lib/store";
import { api, type Meeting } from "../lib/api";
import { dayLabel, fmtDuration, fmtTime } from "../lib/format";
import { Badge, Banner, Button, EmptyState, IconButton, Menu, MenuItem, RecDot, RecordButton } from "../components/ui";
import { confirm } from "../lib/dialogs";

function StatusBadge({ m, processing }: { m: Meeting; processing?: string }) {
  if (processing) return <Badge>{processing}</Badge>;
  if (m.status === "recording") return <Badge tone="clay"><RecDot pulse className="size-1.5" />Recording</Badge>;
  if (m.status === "paused") return <Badge tone="clay">Paused</Badge>;
  if (m.status === "interrupted") return <Badge tone="clay"><AlertTriangle className="size-3" />Interrupted</Badge>;
  return null;
}

export function Home() {
  const { meetings, navigate, newMeeting, processing, refreshMeetings, settings, catalog, toast } = useApp();
  const [ask, setAsk] = useState("");
  const groups = useMemo(() => {
    const g = new Map<string, typeof meetings>();
    for (const item of meetings) {
      const k = dayLabel(item.meeting.startedAt ?? item.meeting.createdAt);
      g.set(k, [...(g.get(k) ?? []), item]);
    }
    return [...g.entries()];
  }, [meetings]);

  const asrReady = catalog.some((c) => c.id === settings.asrModel && c.status === "ready");
  const llmReady = catalog.some((c) => c.id === settings.llmModel && c.status === "ready");

  const remove = async (m: Meeting) => {
    if (!(await confirm(`Delete "${m.title || "Untitled meeting"}"? Its notes, transcript and audio will be removed from this Mac.`, { title: "Delete meeting", okLabel: "Delete" }))) return;
    try {
      await api.deleteMeeting(m.id);
      await refreshMeetings();
    } catch (e) {
      toast(String(e), "error");
    }
  };

  return (
    <div className="relative flex h-full flex-col">
      <header className="drag flex h-[52px] shrink-0 items-center justify-end gap-2 px-5">
        <Button size="sm" className="no-drag" onClick={() => newMeeting(false)} title="New note (⌘N)"><Plus className="size-3.5" />New note</Button>
      </header>
      <div className="scroll-y flex-1">
        <div className="mx-auto w-full max-w-[760px] px-8 pb-24">
          <h1 className="mt-4 title">Meetings</h1>

          {(!asrReady || !llmReady) && (
            <div className="mt-4">
              <Banner tone="clay" icon={<AlertTriangle className="size-4" />}
                action={<Button size="sm" onClick={() => navigate({ name: "models", role: !asrReady ? "asr" : "llm" })}>Open Models</Button>}>
                {!asrReady ? "Download a speech model to transcribe meetings." : "Download a notes model to generate enhanced notes and ask questions."}
              </Banner>
            </div>
          )}

          <div className="mt-5 flex items-center gap-3 rounded-lg border border-line bg-paper-raised p-4 ">
            <div className="grid size-10 place-items-center rounded-md bg-paper-sunken text-ink"><Mic className="size-5" /></div>
            <div className="flex-1">
              <div className="text-[14px] font-semibold">Start a meeting</div>
              <div className="text-[12.5px] text-ink-muted">Grain records your mic and computer audio, with no bot joining. Works with Zoom, Meet, Teams and in-person meetings.</div>
            </div>
            <RecordButton onClick={() => newMeeting(true)}>Record</RecordButton>
          </div>

          {meetings.length === 0 ? (
            <EmptyState icon={<FileText className="size-5" />} title="No meetings yet"
              body="Start a meeting to record and take notes. When it ends, Grain turns your notes and the transcript into clean meeting notes, all on this Mac.">
              <Button onClick={() => newMeeting(false)}>New note without recording</Button>
            </EmptyState>
          ) : (
            groups.map(([label, items]) => (
              <section key={label} className="mt-7">
                <h2 className="mb-1 px-2 text-[12px] font-medium text-ink-subtle">{label}</h2>
                {items.map(({ meeting: m, preview }) => (
                  <div key={m.id} role="button" tabIndex={0} onClick={() => navigate({ name: "meeting", id: m.id })} onKeyDown={(e) => e.key === "Enter" && navigate({ name: "meeting", id: m.id })}
                    className="group flex items-start gap-3 rounded-md px-2 py-2.5 hover:bg-paper-sunken">
                    <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border border-line bg-paper-raised text-ink-subtle"><FileText className="size-4" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[14px] font-medium">{m.title || "Untitled meeting"}</span>
                        <StatusBadge m={m} processing={processing[m.id]} />
                      </div>
                      <div className="mt-0.5 truncate text-[12.5px] text-ink-subtle">
                        {fmtTime(m.startedAt ?? m.createdAt)}{m.durationMs > 0 && ` · ${fmtDuration(m.durationMs)}`}{preview && ` · ${preview.replace(/[#*\-[\]()]/g, "").replace(/\s+/g, " ").slice(0, 120)}`}
                      </div>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                      <Menu trigger={(t) => <IconButton label="More" onClick={t}><MoreHorizontal className="size-4" /></IconButton>}>
                        {(close) => <MenuItem danger icon={<Trash2 className="size-3.5" />} onClick={() => { close(); remove(m); }}>Delete meeting</MenuItem>}
                      </Menu>
                    </div>
                  </div>
                ))}
              </section>
            ))
          )}
        </div>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (ask.trim()) navigate({ name: "chat", ask: ask.trim() }); }}
        className="absolute inset-x-0 bottom-4 mx-auto flex h-11 w-[min(640px,calc(100%-48px))] items-center gap-2 rounded-full border border-line-strong bg-paper-raised pr-1.5 pl-4 shadow-[var(--shadow-raised)] focus-within:border-ink-muted">
        <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Ask anything" aria-label="Ask anything about your meetings"
          className="h-full flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-ink-subtle" />
        <button type="submit" aria-label="Ask" disabled={!ask.trim()} className="grid size-8 place-items-center rounded-full bg-ink text-paper hover:bg-ink-muted disabled:bg-line-strong"><ArrowUp className="size-4" /></button>
      </form>
    </div>
  );
}
