import { CheckSquare, Copy, Cpu, Home, MessageCircle, MoreHorizontal, Settings, Trash2 } from "lucide-react";
import { useState } from "react";
import { useApp, type Route } from "../lib/store";
import { api, type Meeting } from "../lib/api";
import { confirm } from "../lib/dialogs";
import { IconButton, Kbd, Menu, MenuItem, RecDot, VerifyBadge } from "./ui";
import { fmtTs } from "../lib/format";

const MIN_W = 180, MAX_W = 400;

function NavItem({ icon, label, active, onClick, hint }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; hint?: string }) {
  return (
    <button onClick={onClick} aria-current={active ? "page" : undefined}
      className={`group flex h-[30px] w-full items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors ${active ? "bg-line font-medium text-ink" : "text-ink-muted hover:bg-line/50 hover:text-ink"}`}>
      <span className="grid size-4 place-items-center">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {hint && <span className="opacity-0 transition-opacity group-hover:opacity-100"><Kbd>{hint}</Kbd></span>}
    </button>
  );
}

export function Sidebar() {
  const { route, navigate, meetings, recording, refreshMeetings, toast, settings, setSetting } = useApp();
  const [width, setWidth] = useState<number>(settings.sidebarWidth ?? 232);
  const is = (n: Route["name"]) => route.name === n;
  const recent = meetings.slice(0, 12);

  // Copies the title and your own notes; transcript, audio and Grain's notes stay with the original.
  const duplicate = async (m: Meeting) => {
    try {
      const { manual } = await api.meetingDetail(m.id);
      const copy = await api.createMeeting(`${m.title || "Untitled meeting"} (copy)`, m.templateId);
      if (manual?.content) await api.saveManualNote(copy.id, manual.content);
      await refreshMeetings();
      navigate({ name: "meeting", id: copy.id });
    } catch (e) { toast(String(e), "error"); }
  };
  const remove = async (m: Meeting) => {
    if (!(await confirm(`Delete "${m.title || "Untitled meeting"}"? Its notes, transcript and audio will be removed from this Mac.`, { title: "Delete meeting", okLabel: "Delete" }))) return;
    try {
      await api.deleteMeeting(m.id);
      await refreshMeetings();
      if (route.name === "meeting" && route.id === m.id) navigate({ name: "home" });
    } catch (e) { toast(String(e), "error"); }
  };
  // Dragging resizes between MIN and MAX; only the toggle hides the sidebar.
  const clamp = (w: number) => Math.min(MAX_W, Math.max(MIN_W, w));
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = width;
    let w = w0;
    const move = (ev: PointerEvent) => { w = clamp(w0 + ev.clientX - x0); setWidth(w); };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      setSetting("sidebarWidth", w);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = "col-resize";
  };
  const nudge = (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
    if (!d) return;
    e.preventDefault();
    const w = clamp(width + d);
    setWidth(w);
    setSetting("sidebarWidth", w);
  };

  if (settings.sidebarCollapsed) return null;
  return (
    <aside className="no-print relative flex shrink-0 flex-col border-r border-line bg-paper-sunken" style={{ width }}>
      <div role="separator" aria-orientation="vertical" aria-label="Resize sidebar" aria-valuenow={width} aria-valuemin={MIN_W} aria-valuemax={MAX_W} tabIndex={0}
        onPointerDown={startResize} onKeyDown={nudge}
        className="group no-drag absolute inset-y-0 -right-[3px] z-20 w-[5px] cursor-col-resize outline-none">
        <span className="mx-auto block h-full w-px group-hover:bg-line-strong group-focus-visible:bg-ink-muted" />
      </div>
      <div className="drag h-[52px] shrink-0" />
      <div className="px-2.5">
        <NavItem icon={<Home className="size-[15px]" />} label="Meetings" active={is("home") || is("meeting")} onClick={() => navigate({ name: "home" })} />
        <NavItem icon={<MessageCircle className="size-[15px]" />} label="Ask Grain" active={is("chat")} onClick={() => navigate({ name: "chat" })} hint="⌘J" />
        <NavItem icon={<CheckSquare className="size-[15px]" />} label="Action items" active={is("actions")} onClick={() => navigate({ name: "actions" })} />
      </div>

      {recording && (
        <button onClick={() => navigate({ name: "meeting", id: recording.meetingId })}
          className="mx-2.5 mt-3 flex items-center gap-2 rounded-md border border-line bg-paper-raised px-2.5 py-2 text-left text-[12.5px] text-ink">
          <RecDot pulse={!recording.paused} />
          <span className="flex-1 truncate font-medium">{recording.paused ? "Paused" : "Recording"}</span>
          <span className="timestamp text-ink-muted">{fmtTs(recording.elapsed * 1000)}</span>
        </button>
      )}

      <div className="label mt-4 px-4 text-ink-muted">Recent</div>
      <div className="scroll-y mt-1 flex-1 px-2.5 pb-2">
        {recent.length === 0 && <div className="px-2 py-1.5 text-[12.5px] text-ink-subtle">No meetings yet</div>}
        {recent.map(({ meeting: m }) => {
          const active = route.name === "meeting" && route.id === m.id;
          return (
            <div key={m.id} className={`group flex h-[28px] items-center rounded-md ${active ? "bg-line text-ink" : "text-ink-muted hover:bg-line/50"}`}>
              <button onClick={() => navigate({ name: "meeting", id: m.id })} className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left text-[12.5px]">
                {recording?.meetingId === m.id && <RecDot className="size-1.5" />}
                <span className="truncate">{m.title || "Untitled meeting"}</span>
              </button>
              <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                <Menu trigger={(t) => <IconButton label="More" className="size-6" onClick={t}><MoreHorizontal className="size-3.5" /></IconButton>}>
                  {(close) => <>
                    <MenuItem icon={<Copy className="size-3.5" />} onClick={() => { close(); duplicate(m); }}>Duplicate</MenuItem>
                    <MenuItem danger icon={<Trash2 className="size-3.5" />} onClick={() => { close(); remove(m); }}>Delete meeting</MenuItem>
                  </>}
                </Menu>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-line px-2.5 py-2">
        <NavItem icon={<Cpu className="size-[15px]" />} label="Models" active={is("models")} onClick={() => navigate({ name: "models" })} />
        <NavItem icon={<Settings className="size-[15px]" />} label="Settings" active={is("settings")} onClick={() => navigate({ name: "settings" })} hint="⌘," />
        <div className="mt-1.5 px-1" title="Audio, transcripts and notes are stored and processed on this Mac.">
          <VerifyBadge state="local">Stored on this Mac</VerifyBadge>
        </div>
      </div>
    </aside>
  );
}
