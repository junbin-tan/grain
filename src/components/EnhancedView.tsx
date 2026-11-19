import { useEffect, useState } from "react";
import { CircleDashed, History, RefreshCw } from "lucide-react";
import { api, on, type ActionItem, type MeetingDetail, type Note, type Segment, type Template } from "../lib/api";
import { relTime } from "../lib/format";
import { useApp } from "../lib/store";
import { Editor } from "./Editor";
import { Badge, Banner, Button, CitationChip, EmptyState, GrainMark, Menu, MenuItem, Progress, VerifyBadge } from "./ui";

const STAGES: Record<string, string> = { loading: "Loading the local model…", reading: "Reading the transcript…", writing: "Writing your notes…", checking: "Checking facts against the transcript…" };

export function useEnhance(meetingId: string, onDone: () => void) {
  const { toast } = useApp();
  const [stage, setStage] = useState<{ stage: string; progress: number } | null>(null);
  useEffect(() => on<any>("enhance-status", (e) => {
    if (e.meetingId !== meetingId) return;
    if (e.stage === "done" || e.stage === "error") setStage(null);
    else setStage({ stage: e.stage, progress: e.progress ?? 0 });
  }), [meetingId]);
  const run = async (templateId?: string) => {
    setStage({ stage: "loading", progress: 0 });
    try {
      await api.enhanceNotes(meetingId, templateId);
      onDone();
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setStage(null);
    }
  };
  return { stage, run };
}

/** design/components/ActionItem: task, owner and deadline, then its sources. */
export function ActionRow({ a, onToggle, segments, onTimestamp }: { a: ActionItem; onToggle: () => void; segments?: Segment[]; onTimestamp?: (ms: number) => void }) {
  const done = a.status === "done";
  const sources = segments ? a.evidence.map((id) => segments.find((s) => s.id === id)).filter((s): s is Segment => !!s) : [];
  return (
    <div className="gr-action">
      <input type="checkbox" className="gr-action__check" checked={done} onChange={onToggle} aria-label={done ? "Mark open" : "Mark done"} />
      <div className="min-w-0">
        <div className={`gr-action__text ${done ? "text-ink-subtle line-through" : ""}`}>{a.description}</div>
        <div className="gr-action__meta">
          {a.owner ? <span className="gr-action__owner">{a.owner}</span> : <span>No owner stated</span>}
          {a.deadline && <span>· {a.deadline}</span>}
          {a.kind === "suggestion" && <Badge>Suggested, not agreed</Badge>}
          {sources.map((s, i) => <CitationChip key={s.id} n={i + 1} ms={s.startMs} onClick={onTimestamp && (() => onTimestamp(s.startMs))} title={s.text} />)}
          {!a.verified && <VerifyBadge state="missing" />}
        </div>
      </div>
    </div>
  );
}

export function EnhancedView({ detail, templates, onTimestamp, reload, enhance }: {
  detail: MeetingDetail;
  templates: Template[];
  onTimestamp: (ms: number) => void;
  reload: () => void;
  enhance: ReturnType<typeof useEnhance>;
}) {
  const { catalog, settings, navigate } = useApp();
  const [viewing, setViewing] = useState<Note | null>(null);
  const current = detail.enhanced;
  const note = viewing ?? current;
  const llmReady = catalog.some((c) => c.id === settings.llmModel && c.status === "ready");
  const hasInput = detail.segments.length > 0 || (detail.manual?.content.trim().length ?? 0) > 0;
  const tpl = (id?: string | null) => templates.find((t) => t.id === id)?.name ?? "General meeting";

  useEffect(() => setViewing(null), [current?.version, detail.meeting.id]);

  if (enhance.stage) {
    return (
      <div className="py-6">
        <div className="mb-3 flex items-center gap-2 text-[13.5px] text-ink-muted"><GrainMark className="size-4" />{STAGES[enhance.stage.stage] ?? "Working…"}</div>
        <Progress value={Math.max(0.04, enhance.stage.progress)} className="mb-6 max-w-[320px]" />
        {[90, 70, 82, 40, 76, 60].map((w, i) => <div key={i} className="skeleton mb-3 h-3.5" style={{ width: `${w}%` }} />)}
        <div className="mt-6 text-[12px] text-ink-subtle">Running on this Mac. You can keep editing your notes in the meantime.</div>
      </div>
    );
  }

  if (!note) {
    return (
      <EmptyState icon={<GrainMark className="size-5" />} title="No enhanced notes yet"
        body={!hasInput ? "Record the meeting or write some notes first. Grain combines your notes with the transcript." : "Grain will combine your notes with the transcript into structured notes, with decisions and action items linked to the moments they were said."}>
        {!llmReady ? (
          <Button onClick={() => navigate({ name: "models", role: "llm" })}>Download a notes model</Button>
        ) : (
          <Button variant="accent" disabled={!hasInput} onClick={() => enhance.run()}><GrainMark mono />Enhance notes</Button>
        )}
      </EmptyState>
    );
  }

  const unverified = (note.structured?.action_items ?? []).filter((a: any) => a.verified === false).length + (note.structured?.decisions ?? []).filter((d: any) => d.verified === false).length;
  const checks: string[] = (note.structured?.action_items ?? []).flatMap((a: any) => a.checks ?? []);

  return (
    <div className="enhanced">
      <div className="mb-3 flex items-center gap-2 text-[12px] text-ink-subtle">
        <GrainMark className="size-3.5" />
        <span>v{note.version} · {tpl(note.templateId)} · {note.modelId} · {relTime(note.createdAt)}</span>
        <div className="flex-1" />
        {detail.enhancedVersions.length > 1 && (
          <Menu trigger={(t) => <Button size="sm" variant="ghost" onClick={t}><History className="size-3.5" />Versions</Button>}>
            {(close) => detail.enhancedVersions.map((v) => (
              <MenuItem key={v.version} onClick={async () => { close(); setViewing(v.version === current?.version ? null : await api.enhancedVersion(detail.meeting.id, v.version)); }}
                hint={relTime(v.createdAt)}>v{v.version} · {tpl(v.templateId)}{v.version === current?.version ? " (current)" : ""}</MenuItem>
            ))}
          </Menu>
        )}
        <Menu trigger={(t) => <Button size="sm" variant="ghost" onClick={t} disabled={!llmReady}><RefreshCw className="size-3.5" />Regenerate</Button>}>
          {(close) => templates.map((t) => <MenuItem key={t.id} onClick={() => { close(); enhance.run(t.id); }}>{t.name}</MenuItem>)}
        </Menu>
      </div>
      {viewing && (
        <div className="mb-3"><Banner icon={<History className="size-4" />} action={<Button size="sm" onClick={() => setViewing(null)}>Back to current</Button>}>Viewing an earlier version (read-only).</Banner></div>
      )}
      {(unverified > 0 || checks.length > 0) && !viewing && (
        <div className="mb-3">
          <Banner tone="clay" icon={<CircleDashed className="size-4" />}>
            {unverified > 0 && `${unverified} item${unverified > 1 ? "s" : ""} could not be matched to the transcript. `}
            {checks.length > 0 && `Removed ${checks.length} owner/deadline detail${checks.length > 1 ? "s" : ""} that nobody said.`} Review before sharing.
          </Banner>
        </div>
      )}
      {viewing ? (
        <div className="pointer-events-none opacity-90"><Editor docKey={`v-${viewing.id}`} value={viewing.content} onChange={() => {}} /></div>
      ) : (
        <Editor docKey={`e-${note.id}`} value={note.content} onChange={(md) => api.saveEnhancedNote(detail.meeting.id, md)} onTimestamp={onTimestamp} placeholder="Enhanced notes" />
      )}
      {!viewing && detail.actionItems.length > 0 && (
        <section className="-mt-24 mb-28 rounded-lg border border-line bg-paper-raised px-4 py-3">
          <div className="label mb-1 text-ink-muted">Track action items</div>
          {detail.actionItems.map((a) => <ActionRow key={a.id} a={a} segments={detail.segments} onTimestamp={onTimestamp} onToggle={async () => { await api.setActionStatus(a.id, a.status === "done" ? "open" : "done"); reload(); }} />)}
        </section>
      )}
    </div>
  );
}
