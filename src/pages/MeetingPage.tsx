import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, AudioLines, RefreshCw, Download, Flag, MessageCircle, Mic, MonitorSpeaker, MoreHorizontal, Pause, Play, RotateCcw, Sparkles, Square, Trash2, X } from "lucide-react";
import { confirm } from "../lib/dialogs";
import { api, on, type MeetingDetail, type Segment, type Template } from "../lib/api";
import { fmtDate, fmtDuration, fmtTime, fmtTs } from "../lib/format";
import { useApp, type Tab } from "../lib/store";
import { Editor } from "../components/Editor";
import { TranscriptView } from "../components/Transcript";
import { EnhancedView, useEnhance } from "../components/EnhancedView";
import { AskPanel } from "../components/AskPanel";
import { ExportDialog } from "../components/ExportDialog";
import { Badge, Banner, Button, IconButton, Kbd, LevelBars, Menu, MenuItem, Spinner } from "../components/ui";

export function MeetingPage({ id, tab: initialTab, at }: { id: string; tab?: Tab; at?: number }) {
  const { recording, processing, navigate, back, refreshMeetings, startRecording, settings, catalog, toast } = useApp();
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tab, setTab] = useState<Tab>(initialTab ?? "notes");
  const [jump, setJump] = useState<number | undefined>(at);
  const [side, setSide] = useState<"none" | "live" | "ask">(() => (window as any).__grainUi?.side ?? "none");
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
  useEffect(fitTitle, [detail?.meeting.title]);

  // A transcript without notes usually means Enhance is next: load the model now, not on click.
  useEffect(() => { if (detail && detail.segments.length > 0 && !detail.enhanced) api.warmModels().catch(() => {}); }, [detail?.meeting.id, !!detail?.enhanced, (detail?.segments.length ?? 0) > 0]);
  const enhanceHook = useEnhance(id, () => { load(); refreshMeetings(); setTab("enhanced"); });
  // Show the staged progress straight away instead of after the notes are written.
  const enhance = { ...enhanceHook, run: (templateId?: string) => { setTab("enhanced"); return enhanceHook.run(templateId); } };
  const isRecording = recording?.meetingId === id;
  const busy = processing[id];

  useEffect(() => {
    const offs = [
      on<{ meetingId: string; segments: Segment[] }>("transcript", (e) => {
        if (e.meetingId !== id) return;
        setDetail((d) => (d ? { ...d, segments: [...d.segments, ...e.segments].sort((a, b) => a.startMs - b.startMs) } : d));
      }),
      on<any>("meeting-status", (e) => { if (e.meetingId === id) load(); }),
      on<any>("transcription-status", (e) => { if (e.meetingId === id && (e.state === "done" || e.state === "error")) load(); }),
      on<any>("capture", (e) => { if (e.meetingId === id && e.event === "started") { load(); setSide((s) => (s === "none" && settings.transcriptionMode !== "after" ? "live" : s)); } }),
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
      if (e.key === "j") { e.preventDefault(); setSide((s) => (s === "ask" ? "none" : "ask")); }
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
      className={`relative h-9 px-0.5 text-[13px] font-medium transition-colors ${tab === t ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}>
      {label}{count != null && count > 0 && <span className="ml-1 text-ink-3">{count}</span>}
      {tab === t && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-ink" />}
    </button>
  );

  return (
    <div className="flex h-full min-w-0">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="drag no-print flex h-[52px] shrink-0 items-center gap-1 px-3">
          <IconButton className="no-drag" label="Back" onClick={back}><ArrowLeft className="size-4" /></IconButton>
          <div className="truncate px-1 text-[12.5px] text-ink-3">Meetings / <span className="text-ink-2">{m.title || "Untitled meeting"}</span></div>
          <div className="flex-1" />
          <div className="no-drag flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setSide((s) => (s === "ask" ? "none" : "ask"))}><MessageCircle className="size-3.5" />Ask</Button>
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
              className="title mt-3 block w-full bg-transparent font-serif text-[30px] leading-[1.2] font-semibold tracking-[-0.01em] outline-none placeholder:text-ink-3" />
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-3">
              <span>{fmtDate(m.startedAt ?? m.createdAt)} · {fmtTime(m.startedAt ?? m.createdAt)}</span>
              {m.durationMs > 0 && <span>· {fmtDuration(m.durationMs)}</span>}
              <span>·</span>
              <select aria-label="Note template" value={m.templateId} onChange={(e) => api.updateMeeting(id, { templateId: e.target.value }).then(load)}
                className="bare h-6 rounded-[6px] bg-transparent px-1.5 text-[12.5px] text-ink-2 outline-none hover:bg-wash">
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {isRecording && <Badge tone="rec"><span className={`size-1.5 rounded-full bg-rec ${recording?.paused ? "" : "animate-pulse-rec"}`} />{recording?.paused ? "Paused" : "Recording"}</Badge>}
              {busy && <Badge tone="accent"><Spinner className="size-3 text-accent" />{busy}</Badge>}
            </div>

            <div className="mt-4 flex flex-col gap-2 empty:hidden">
              {m.status === "interrupted" && !isRecording && (
                <Banner tone="warn" icon={<AlertTriangle className="size-4" />}
                  action={hasAudio && <Button size="sm" onClick={retranscribe} disabled={!asrReady}>Transcribe audio</Button>}>
                  This recording was interrupted. {fmtDuration(m.durationMs) || "Some"} of audio was saved{detail.segments.length ? " and partly transcribed" : ""}.
                </Banner>
              )}
              {!asrReady && (isRecording || hasAudio) && (
                <Banner tone="warn" icon={<AlertTriangle className="size-4" />} action={<Button size="sm" onClick={() => navigate({ name: "models", role: "asr" })}>Get a speech model</Button>}>
                  No speech model installed. Audio is being kept; transcribe it after downloading a model.
                </Banner>
              )}
              {recording?.warnings.length && isRecording ? <Banner tone="warn" icon={<AlertTriangle className="size-4" />}>{recording.warnings.join(" · ")}</Banner> : null}
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

        <Dock {...{ isRecording, neverRecorded, starting, record, mark, enhance, side, setSide, hasInput: detail.segments.length > 0 || !!detail.manual?.content.trim(), hasEnhanced: !!detail.enhanced, busy, setTab, onEnhancedTab: tab === "enhanced" }} />
      </div>

      {side !== "none" && (
        <aside className="no-print flex w-[360px] shrink-0 animate-fade flex-col border-l border-line bg-paper">
          <div className="drag flex h-[52px] shrink-0 items-center gap-1 px-3">
            <div className="no-drag flex gap-1">
              <Button size="sm" variant={side === "live" ? "secondary" : "ghost"} onClick={() => setSide("live")}>Live transcript</Button>
              <Button size="sm" variant={side === "ask" ? "secondary" : "ghost"} onClick={() => setSide("ask")}>Ask Grain</Button>
            </div>
            <div className="flex-1" />
            <IconButton className="no-drag" label="Close panel" onClick={() => setSide("none")}><X className="size-4" /></IconButton>
          </div>
          {side === "live" ? (
            <div className="scroll-y flex-1 px-4 pb-6">
              <TranscriptView segments={detail.segments} marks={detail.marks} live={isRecording} onChanged={() => {}} />
            </div>
          ) : (
            <AskPanel meetingId={id} compact />
          )}
        </aside>
      )}
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} meetingId={id} title={m.title} hasAudio={hasAudio} />
    </div>
  );
}

function Dock({ isRecording, neverRecorded, starting, record, mark, enhance, side, setSide, hasInput, hasEnhanced, busy, setTab, onEnhancedTab }: any) {
  const { recording, settings, setSetting } = useApp();
  const r = recording;
  return (
    <div className="no-print pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
      <div className="pointer-events-auto flex flex-col items-center gap-2">
        {isRecording && r ? (
          <div className="flex h-12 animate-rise items-center gap-1 rounded-full border border-line bg-raised py-1 pr-1.5 pl-4 shadow-[var(--shadow-float)]" role="status" aria-label="Recording controls">
            <span className={`mr-1 size-2.5 rounded-full bg-rec ${r.paused ? "opacity-40" : "animate-pulse-rec"}`} />
            <span className="w-[54px] text-[13px] font-medium tabular-nums">{fmtTs(r.elapsed * 1000)}</span>
            <span className={`flex items-center gap-1 px-1.5 ${r.micOn ? "text-accent" : "text-ink-3"}`} title={r.micOn ? `Microphone: ${r.micDevice}` : "Microphone off"}>
              <Mic className="size-3.5" /><LevelBars level={r.mic} active={r.micOn && !r.paused} />
            </span>
            <span className={`flex items-center gap-1 px-1.5 ${r.systemOn ? "text-[#5b4a7a]" : "text-ink-3"}`} title={r.systemOn ? "System audio" : "System audio off"}>
              <MonitorSpeaker className="size-3.5" /><LevelBars level={r.system} active={r.systemOn && !r.paused} />
            </span>
            <div className="mx-1 h-6 w-px bg-line" />
            <IconButton label="Mark important moment (⌘M)" onClick={mark}><Flag className="size-4" /></IconButton>
            <IconButton label={r.paused ? "Resume (⌘⇧P)" : "Pause (⌘⇧P)"} onClick={() => (r.paused ? api.resumeRecording() : api.pauseRecording())}>{r.paused ? <Play className="size-4" /> : <Pause className="size-4" />}</IconButton>
            <IconButton label="Live transcript" active={side === "live"} onClick={() => setSide(side === "live" ? "none" : "live")}><AudioLines className="size-4" /></IconButton>
            <Button variant="rec" className="ml-1 rounded-full" onClick={() => api.stopRecording()}><Square className="size-3 fill-current" />Stop</Button>
          </div>
        ) : enhance.stage ? (
          <div className="flex h-11 animate-rise items-center gap-2 rounded-full border border-line bg-raised px-4 text-[13px] text-ink-2 shadow-[var(--shadow-float)]">
            <Sparkles className="size-4 animate-pulse text-accent" /> Enhancing notes on this Mac…
          </div>
        ) : neverRecorded ? (
          <>
            <div className="flex h-12 animate-rise items-center gap-1 rounded-full border border-line bg-raised p-1.5 pl-2 shadow-[var(--shadow-float)]">
              <button onClick={() => setSetting("captureSystem", settings.captureSystem === false)} title="Include computer audio (the other people on your call)"
                className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] ${settings.captureSystem !== false ? "bg-wash text-ink" : "text-ink-3 line-through"}`}>
                <MonitorSpeaker className="size-3.5" />Computer audio
              </button>
              <span className={`flex h-8 items-center gap-1.5 px-2 text-[12.5px] ${settings.micDevice === "none" ? "text-ink-3 line-through" : "text-ink-2"}`} title={settings.micDevice === "none" ? "Microphone is off (Settings › Audio)" : "Microphone"}><Mic className="size-3.5" />Mic</span>
              <Button variant="primary" className="rounded-full" loading={starting} onClick={record}><span className="size-2 rounded-full bg-rec" />Start recording <span className="text-white/60">⌘R</span></Button>
            </div>
            <div className="text-[11.5px] text-ink-3">Tell everyone you're recording. Consent rules vary by place. Audio stays on this Mac.</div>
          </>
        ) : (
          <div className="flex h-12 animate-rise items-center gap-1 rounded-full border border-line bg-raised p-1.5 shadow-[var(--shadow-float)]">
            <Button variant="ghost" className="rounded-full" onClick={record} disabled={!!busy}><RotateCcw className="size-3.5" />Resume recording</Button>
            {hasEnhanced && onEnhancedTab ? (
              <Button variant="primary" className="rounded-full" disabled={!!busy} onClick={() => enhance.run()}><RefreshCw className="size-3.5" />Regenerate</Button>
            ) : (
              <Button variant="primary" className="rounded-full" disabled={!hasInput || !!busy} onClick={() => (hasEnhanced ? setTab("enhanced") : enhance.run())}>
                <Sparkles className="size-4" />{hasEnhanced ? "View enhanced notes" : "Enhance notes"} {!hasEnhanced && <Kbd>⌘E</Kbd>}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
