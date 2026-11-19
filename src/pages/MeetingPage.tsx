import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowUp, AudioLines, ChevronDown, ChevronUp, Download, Flag, Mic, MoreHorizontal, Pause, Play, RotateCcw, Trash2, X } from "lucide-react";
import { confirm } from "../lib/dialogs";
import { api, on, type Device, type MeetingDetail, type Segment, type Template } from "../lib/api";
import { fmtDate, fmtDuration, fmtTime, fmtTs } from "../lib/format";
import { useApp, type Tab } from "../lib/store";
import { Editor } from "../components/Editor";
import { TranscriptView } from "../components/Transcript";
import { EnhancedView, useEnhance } from "../components/EnhancedView";
import { AskPanel, SUGGESTIONS_MEETING } from "../components/AskPanel";
import { ExportDialog } from "../components/ExportDialog";
import { Badge, Banner, Button, GrainMark, IconButton, Kbd, LevelBars, Menu, MenuItem, RecDot, RecordButton, Spinner, Toggle } from "../components/ui";

export function MeetingPage({ id, tab: initialTab, at }: { id: string; tab?: Tab; at?: number }) {
  const { recording, processing, navigate, back, refreshMeetings, startRecording, settings, catalog, toast } = useApp();
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tab, setTab] = useState<Tab>(initialTab ?? "notes");
  const [jump, setJump] = useState<number | undefined>(at);
  const [askOpen, setAskOpen] = useState(() => (window as any).__grainUi?.side === "ask");
  // A question typed in the dock; the panel sends it once when it opens.
  const [pendingAsk, setPendingAsk] = useState<string | undefined>();
  const [liveOpen, setLiveOpen] = useState(() => (window as any).__grainUi?.side === "live");
  const [exportOpen, setExportOpen] = useState<boolean>(() => !!(window as any).__grainUi?.export);
  const [starting, setStarting] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await api.meetingDetail(id));
    } catch {
      navigate({ name: "home" });
    }
  }, [id]);

  useEffect(() => {
    setDetail(null);
    load();
    api.listTemplates().then(setTemplates);
  }, [id]);
  useEffect(() => { if (initialTab) setTab(initialTab); setJump(at); }, [initialTab, at]);
  const fitTitle = () => { const t = titleRef.current; if (t) { t.style.height = "auto"; t.style.height = `${t.scrollHeight}px`; } };
  const titleTimer = useRef<number | undefined>(undefined);
  const saveTitle = (raw: string, refresh: boolean) => {
    const t = raw.replace(/\s+/g, " ").trim();
    window.clearTimeout(titleTimer.current);
    if (t === (detail?.meeting.title ?? "")) return;
    return api.updateMeeting(id, { title: t }).then(() => { if (refresh) { load(); } refreshMeetings(); });
  };
  // Re-measure once the bundled serif loads: the fallback font is wider and would leave a two-line box.
  useEffect(() => { fitTitle(); document.fonts.ready.then(fitTitle); }, [detail?.meeting.title]);

  // A transcript without notes usually means Enhance is next: load the model now, not on click.
  useEffect(() => { if (detail && detail.segments.length > 0 && !detail.enhanced) api.warmModels().catch(() => {}); }, [detail?.meeting.id, !!detail?.enhanced, (detail?.segments.length ?? 0) > 0]);
  const enhanceHook = useEnhance(id, () => { load(); refreshMeetings(); setTab("enhanced"); });
  // Show the staged progress straight away instead of after the notes are written.
  const enhance = { ...enhanceHook, run: (templateId?: string) => { setTab("enhanced"); return enhanceHook.run(templateId); } };
  const isRecording = recording?.meetingId === id;
  const busy = processing[id];
  useEffect(() => { if (!askOpen) setPendingAsk(undefined); }, [askOpen]);
  // Fold the transcript away when recording stops so Enhance and the notes are in view.
  const wasRecording = useRef(isRecording);
  useEffect(() => { if (wasRecording.current && !isRecording) setLiveOpen(false); wasRecording.current = isRecording; }, [isRecording]);

  useEffect(() => {
    const offs = [
      on<{ meetingId: string; segments: Segment[] }>("transcript", (e) => {
        if (e.meetingId !== id) return;
        setDetail((d) => (d ? { ...d, segments: [...d.segments, ...e.segments].sort((a, b) => a.startMs - b.startMs) } : d));
      }),
      on<any>("meeting-status", (e) => { if (e.meetingId === id) load(); }),
      on<any>("transcription-status", (e) => { if (e.meetingId === id && (e.state === "done" || e.state === "error")) load(); }),
      on<any>("capture", (e) => { if (e.meetingId === id && e.event === "started") { load(); if (settings.transcriptionMode !== "after") setLiveOpen(true); } }),
    ];
    return () => offs.forEach((f) => f());
  }, [id, settings.transcriptionMode]);

  // Keyboard shortcuts scoped to the meeting page.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      if (e.key === "1") { e.preventDefault(); setTab("notes"); }
      if (e.key === "2") { e.preventDefault(); setTab("enhanced"); }
      if (e.key === "3") { e.preventDefault(); setTab("transcript"); }
      if (e.key === "j") { e.preventDefault(); setAskOpen((o) => !o); }
      if (e.key === "e" && !isRecording) { e.preventDefault(); enhance.run(); }
      if (e.key === "r") { e.preventDefault(); if (isRecording) api.stopRecording(); else record(); }
      if (e.key === "m" && isRecording) { e.preventDefault(); mark(); }
      if (e.key === "p" && e.shiftKey && isRecording) { e.preventDefault(); if (recording?.paused) api.resumeRecording(); else api.pauseRecording(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [isRecording, recording?.paused, detail]);

  const record = async () => {
    if (recording && !isRecording) {
      toast("Another meeting is being recorded.", "info", { label: "Go there", run: () => navigate({ name: "meeting", id: recording.meetingId }) });
      return;
    }
    setStarting(true);
    await startRecording(id);
    setStarting(false);
  };
  const mark = async () => {
    if (!recording) return;
    const m = await api.addMark(id, Math.round(recording.elapsed * 1000), "");
    setDetail((d) => (d ? { ...d, marks: [...d.marks, m] } : d));
    toast(`Marked ${fmtTs(m.atMs)} as important`, "success");
  };
  const toTimestamp = (ms: number) => { setTab("transcript"); setJump(ms); };

  const hasAudio = useMemo(() => detail?.recordings.some((r) => r.status !== "deleted") ?? false, [detail]);
  const asrReady = catalog.some((c) => c.id === settings.asrModel && c.status === "ready");

  if (!detail) return <div className="grid h-full place-items-center"><Spinner /></div>;
  const m = detail.meeting;
  const neverRecorded = !m.startedAt && !isRecording;

  const retranscribe = async () => {
    if (detail.segments.length > 0 && !(await confirm("Re-transcribe the whole recording with the current speech model? The existing transcript, including your corrections, will be replaced.", { title: "Re-transcribe", okLabel: "Re-transcribe" }))) return;
    try { await api.transcribeMeeting(id); toast("Transcribing…"); } catch (e) { toast(String(e), "error"); }
  };
  const removeAudio = async () => {
    if (!(await confirm("Delete the audio recording for this meeting? The transcript and notes are kept.", { title: "Delete audio", okLabel: "Delete audio" }))) return;
    await api.deleteAudio(id); load();
  };
  const removeMeeting = async () => {
    if (!(await confirm(`Delete "${m.title || "Untitled meeting"}"? Notes, transcript and audio will be removed from this Mac.`, { title: "Delete meeting", okLabel: "Delete" }))) return;
    try { await api.deleteMeeting(id); await refreshMeetings(); navigate({ name: "home" }); } catch (e) { toast(String(e), "error"); }
  };

  const tabBtn = (t: Tab, label: string, count?: number) => (
    <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
      className={`relative h-9 px-0.5 text-[13px] font-medium transition-colors ${tab === t ? "text-ink" : "text-ink-subtle hover:text-ink-muted"}`}>
      {label}{count != null && count > 0 && <span className="ml-1 text-ink-subtle">{count}</span>}
      {tab === t && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-ink" />}
    </button>
  );

  return (
    <div className="flex h-full min-w-0">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="drag no-print flex h-[52px] shrink-0 items-center gap-1 px-3 in-data-[sidebar=collapsed]:pl-[148px]">
          <IconButton className="no-drag" label="Back" onClick={back}><ArrowLeft className="size-4" /></IconButton>
          <div className="truncate px-1 text-[12.5px] text-ink-subtle">Meetings / <span className="text-ink-muted">{m.title || "Untitled meeting"}</span></div>
          <div className="flex-1" />
          <div className="no-drag flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setExportOpen(true)}><Download className="size-3.5" />Export</Button>
            <Menu trigger={(t) => <IconButton label="More" onClick={t}><MoreHorizontal className="size-4" /></IconButton>}>
              {(close) => (
                <>
                  <MenuItem icon={<RotateCcw className="size-3.5" />} onClick={() => { close(); retranscribe(); }}>Re-transcribe recording</MenuItem>
                  {hasAudio && <MenuItem icon={<AudioLines className="size-3.5" />} onClick={() => { close(); removeAudio(); }}>Delete audio only</MenuItem>}
                  <MenuItem danger icon={<Trash2 className="size-3.5" />} onClick={() => { close(); removeMeeting(); }}>Delete meeting</MenuItem>
                </>
              )}
            </Menu>
          </div>
        </header>

        <div className="scroll-y print-area flex-1">
          <div className="mx-auto w-full max-w-[720px] px-10">
            <textarea ref={titleRef} rows={1} defaultValue={m.title} key={m.id + m.title} placeholder="Untitled meeting" aria-label="Meeting title"
              onInput={(e) => { fitTitle(); const v = (e.target as HTMLTextAreaElement).value; window.clearTimeout(titleTimer.current); titleTimer.current = window.setTimeout(() => saveTitle(v, false), 500); }}
              onBlur={(e) => saveTitle(e.target.value, true)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
              className="title mt-3 block w-full bg-transparent outline-none placeholder:text-ink-subtle" />
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-subtle">
              <span>{fmtDate(m.startedAt ?? m.createdAt)} · {fmtTime(m.startedAt ?? m.createdAt)}</span>
              {m.durationMs > 0 && <span>· {fmtDuration(m.durationMs)}</span>}
              <span>·</span>
              <select aria-label="Note template" value={m.templateId} onChange={(e) => api.updateMeeting(id, { templateId: e.target.value }).then(load)}
                className="bare h-6 rounded-sm bg-transparent px-1.5 text-[12.5px] text-ink-muted outline-none hover:bg-paper-sunken">
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {isRecording && <Badge tone="clay"><RecDot pulse={!recording?.paused} className="size-1.5" />{recording?.paused ? "Paused" : "Recording"}</Badge>}
              {busy && <Badge><Spinner className="size-3" />{busy}</Badge>}
            </div>

            <div className="mt-4 flex flex-col gap-2 empty:hidden">
              {m.status === "interrupted" && !isRecording && (
                <Banner tone="clay" icon={<AlertTriangle className="size-4" />}
                  action={hasAudio && <Button size="sm" onClick={retranscribe} disabled={!asrReady}>Transcribe audio</Button>}>
                  This recording was interrupted. {fmtDuration(m.durationMs) || "Some"} of audio was saved{detail.segments.length ? " and partly transcribed" : ""}.
                </Banner>
              )}
              {!asrReady && (isRecording || hasAudio) && (
                <Banner tone="clay" icon={<AlertTriangle className="size-4" />} action={<Button size="sm" onClick={() => navigate({ name: "models", role: "asr" })}>Get a speech model</Button>}>
                  No speech model installed. Audio is being kept; transcribe it after downloading a model.
                </Banner>
              )}
              {recording?.warnings.length && isRecording ? <Banner tone="clay" icon={<AlertTriangle className="size-4" />}>{recording.warnings.join(" · ")}</Banner> : null}
            </div>

            <div role="tablist" className="no-print mt-4 flex gap-5 border-b border-line">
              {tabBtn("notes", "My notes")}
              {tabBtn("enhanced", "Enhanced notes")}
              {tabBtn("transcript", "Transcript", detail.segments.length)}
            </div>

            <div className="pt-4">
              {tab === "notes" && (
                <Editor docKey={`m-${id}`} value={detail.manual?.content ?? ""} autoFocus={neverRecorded || isRecording}
                  onChange={(md) => api.saveManualNote(id, md).then(refreshMeetings)}
                  placeholder={isRecording ? "Write notes as you go. Short phrases are enough; Grain fills in the details from the transcript." : "Write notes…"} />
              )}
              {tab === "enhanced" && <EnhancedView detail={detail} templates={templates} onTimestamp={toTimestamp} reload={load} enhance={enhance} />}
              {tab === "transcript" && (
                <div className="pb-40">
                  <TranscriptView segments={detail.segments} marks={detail.marks} at={jump} live={isRecording} onChanged={() => {}}
                    emptyHint={hasAudio ? (asrReady ? <>Audio is saved. <button className="underline" onClick={retranscribe}>Transcribe it now</button>.</> : "Audio is saved. Download a speech model to transcribe it.") : undefined} />
                </div>
              )}
            </div>
          </div>
        </div>

        <Dock {...{ isRecording, neverRecorded, starting, record, mark, enhance, busy, liveOpen, setLiveOpen,
          hasInput: detail.segments.length > 0 || !!detail.manual?.content.trim(), hasEnhanced: !!detail.enhanced,
          askOpen, onAsk: (q: string) => { setPendingAsk(q); setAskOpen(true); },
          transcript: <TranscriptView segments={detail.segments} marks={detail.marks} live={isRecording} onChanged={() => {}} /> }} />
      </div>

      {askOpen && (
        <aside className="no-print flex w-[360px] shrink-0 animate-fade flex-col border-l border-line bg-paper">
          <div className="drag flex h-[52px] shrink-0 items-center gap-1 px-4">
            <div className="label text-ink-muted">Ask Grain</div>
            <div className="flex-1" />
            <IconButton className="no-drag" label="Close panel" onClick={() => setAskOpen(false)}><X className="size-4" /></IconButton>
          </div>
          <AskPanel meetingId={id} compact ask={pendingAsk} />
        </aside>
      )}
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} meetingId={id} title={m.title} hasAudio={hasAudio} />
    </div>
  );
}

// The dock, left to right: the recorder (opens the live transcript), then Ask. One status or action floats above.
function Dock({ isRecording, neverRecorded, starting, record, mark, enhance, busy, liveOpen, setLiveOpen, hasInput, hasEnhanced, askOpen, onAsk, transcript }: any) {
  const { recording, settings, setSetting } = useApp();
  const r = isRecording ? recording : null;
  const [q, setQ] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  useEffect(() => { if (liveOpen) api.devices().then(setDevices).catch(() => {}); }, [liveOpen]);
  const ask = (text: string) => { if (!text.trim()) return; onAsk(text.trim()); setQ(""); };
  const pill = "flex animate-rise items-center rounded-full border border-line bg-paper-raised shadow-[var(--shadow-raised)]";
  const chevron = (
    <IconButton className="size-7" label={liveOpen ? "Hide transcript" : "Show transcript"} aria-expanded={liveOpen} onClick={() => setLiveOpen(!liveOpen)}>
      {liveOpen ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
    </IconButton>
  );

  return (
    <div className="no-print pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-6">
      <div className="pointer-events-auto flex w-full max-w-[680px] flex-col items-center gap-2">
        {liveOpen && (
          <aside aria-label="Live transcript" className="flex h-[min(380px,50vh)] w-full animate-rise flex-col overflow-hidden rounded-xl border border-line bg-paper-raised shadow-[var(--shadow-raised)]">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-4">
              <div className="label text-ink-muted">{r ? "Live transcript" : "Transcript"}</div>
              {r && <span className="timestamp text-ink-subtle">{fmtTs(r.elapsed * 1000)}</span>}
              <div className="flex-1" />
              <IconButton className="size-7" label="Minimise transcript" onClick={() => setLiveOpen(false)}><ChevronDown className="size-4" /></IconButton>
            </div>
            <div className="scroll-y flex-1 px-4 pb-4">{transcript}</div>
            <div className="flex h-11 shrink-0 items-center gap-2 border-t border-line px-3 text-[12.5px] text-ink-muted">
              {r ? (
                <>
                  <IconButton className="size-7" label="Mark important moment (⌘M)" onClick={mark}><Flag className="size-3.5" /></IconButton>
                  <IconButton className="size-7" label={r.paused ? "Resume (⌘⇧P)" : "Pause (⌘⇧P)"} onClick={() => (r.paused ? api.resumeRecording() : api.pauseRecording())}>{r.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}</IconButton>
                  <span className={`flex items-center gap-1 ${r.systemOn ? "text-speaker-them" : "text-ink-subtle"}`} title={r.systemOn ? "Them: computer audio" : "Computer audio off"}>
                    <AudioLines className="size-3.5" /><LevelBars level={r.system} active={r.systemOn && !r.paused} />
                  </span>
                </>
              ) : (
                <label className="flex items-center gap-2" title="The other people on your call">
                  <AudioLines className="size-3.5" />Computer audio
                  <Toggle label="Computer audio" checked={settings.captureSystem !== false} onChange={(v) => setSetting("captureSystem", v)} />
                </label>
              )}
              <div className="flex-1" />
              <Mic className="size-3.5 shrink-0" />
              <select aria-label="Microphone" value={settings.micDevice ?? "default"}
                onChange={(e) => { const v = e.target.value; setSetting("micDevice", v === "default" ? null : v); if (r && v !== "none") api.switchMic(v).catch(() => {}); }}
                className="bare h-7 max-w-[220px] truncate rounded-sm bg-transparent px-1.5 text-[12.5px] text-ink-muted outline-none hover:bg-paper-sunken">
                <option value="default">System default</option>
                <option value="none">Off (computer audio only)</option>
                {devices.map((d) => <option key={d.uid} value={d.uid}>{d.name}</option>)}
              </select>
            </div>
          </aside>
        )}
        {r || neverRecorded ? (
          !liveOpen && <div className="rounded-full border border-line bg-paper-raised px-3 py-1 text-[11.5px] text-ink-subtle">Tell everyone you're recording. Consent rules vary by place. Audio stays on this Mac.</div>
        ) : enhance.stage ? (
          <div className={`${pill} h-9 gap-2 px-4 text-[13px] text-ink-muted`}><GrainMark className="size-4" /> Enhancing notes on this Mac…</div>
        ) : !hasEnhanced && (
          <Button variant="accent" className="rounded-full" disabled={!hasInput || !!busy} onClick={() => enhance.run()}>
            <GrainMark mono />Enhance notes <Kbd>⌘E</Kbd>
          </Button>
        )}

        <div className="flex w-full items-center gap-2">
          {r ? (
            <div className={`gr-rec animate-rise ${r.paused ? "gr-rec--paused" : ""}`} role="status" aria-label="Recording controls">
              <span className="gr-rec__dot" />
              <span className="gr-rec__time w-[44px]">{fmtTs(r.elapsed * 1000)}</span>
              <span className={r.micOn ? "" : "opacity-40"} title={r.micOn ? `Me: ${r.micDevice}` : "Microphone off"}><LevelBars level={r.mic} active={r.micOn && !r.paused} /></span>
              {chevron}
              <button className="gr-rec__stop" aria-label="Stop recording (⌘R)" title="Stop recording (⌘R)" onClick={() => api.stopRecording()} />
            </div>
          ) : (
            <div className={`${pill} h-11 gap-1 pr-1.5 pl-2`}>
              {chevron}
              <RecordButton variant={neverRecorded ? "primary" : "ghost"} size="sm" loading={starting} disabled={!!busy} onClick={record}>{neverRecorded ? "Start recording" : "Resume"}</RecordButton>
            </div>
          )}
          {!askOpen && (
            <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className={`${pill} h-11 min-w-0 flex-1 gap-2 pr-1.5 pl-4 focus-within:border-ink-muted`}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask anything" aria-label="Ask about this meeting"
                className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-ink-subtle" />
              {q.trim() ? (
                <button type="submit" aria-label="Ask" className="grid size-8 place-items-center rounded-full bg-ink text-paper hover:bg-ink-muted"><ArrowUp className="size-4" /></button>
              ) : (
                <button type="button" onClick={() => ask(SUGGESTIONS_MEETING[2])} className="h-8 shrink-0 truncate rounded-full border border-line px-3 text-[12.5px] text-ink-muted hover:bg-paper-sunken hover:text-ink">{SUGGESTIONS_MEETING[2]}</button>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
