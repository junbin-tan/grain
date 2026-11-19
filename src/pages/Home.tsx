import { useMemo, useState } from "react";
import { AlertTriangle, FileText, Mic, MoreHorizontal, Search, Trash2 } from "lucide-react";
import { useApp } from "../lib/store";
import { api, type Meeting } from "../lib/api";
import { dayLabel, fmtDuration, fmtTime } from "../lib/format";
import { Badge, Banner, Button, EmptyState, IconButton, Kbd, Menu, MenuItem, RecDot, RecordButton } from "../components/ui";
import { confirm } from "../lib/dialogs";

function StatusBadge({ m, processing }: { m: Meeting; processing?: string }) {
  if (processing) return <Badge>{processing}</Badge>;
  if (m.status === "recording") return <Badge tone="clay"><RecDot pulse className="size-1.5" />Recording</Badge>;
  if (m.status === "paused") return <Badge tone="clay">Paused</Badge>;
  if (m.status === "interrupted") return <Badge tone="clay"><AlertTriangle className="size-3" />Interrupted</Badge>;
  return null;
}

export function Home() {
  const { meetings, navigate, newMeeting, processing, refreshMeetings, setSearchOpen, settings, catalog, toast } = useApp();
  const [filter, setFilter] = useState("");
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = meetings.filter(({ meeting, preview }) => !q || meeting.title.toLowerCase().includes(q) || preview.toLowerCase().includes(q));
    const g = new Map<string, typeof list>();
    for (const item of list) {
      const k = dayLabel(item.meeting.startedAt ?? item.meeting.createdAt);
      g.set(k, [...(g.get(k) ?? []), item]);
    }
    return [...g.entries()];
  }, [meetings, filter]);

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
    <div className="flex h-full flex-col">
      <header className="drag flex h-[52px] shrink-0 items-center justify-end gap-2 px-5">
        <div className="no-drag relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-subtle" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter meetings"
            className="h-8 w-[220px] rounded-md border border-line bg-paper-raised pr-2 pl-8 text-[13px] outline-none placeholder:text-ink-subtle focus:border-line-strong" />
        </div>
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
          ) : groups.length === 0 ? (
            <div className="py-12 text-center text-[13px] text-ink-muted">No meetings match "{filter}". <button className="underline" onClick={() => setSearchOpen(true)}>Search everything</button> <Kbd>⌘K</Kbd></div>
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
    </div>
  );
}
