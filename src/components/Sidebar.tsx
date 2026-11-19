import { CheckSquare, Cpu, Home, MessageCircle, Plus, Search, Settings, ShieldCheck } from "lucide-react";
import { useApp, type Route } from "../lib/store";
import { Kbd, RecDot } from "./ui";
import { fmtTs } from "../lib/format";

function NavItem({ icon, label, active, onClick, hint }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; hint?: string }) {
  return (
    <button onClick={onClick} aria-current={active ? "page" : undefined}
      className={`group flex h-[30px] w-full items-center gap-2.5 rounded-[7px] px-2 text-[13px] transition-colors ${active ? "bg-line font-medium text-ink" : "text-ink-2 hover:bg-wash hover:text-ink"}`}>
      <span className="grid size-4 place-items-center">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {hint && <span className="opacity-0 transition-opacity group-hover:opacity-100"><Kbd>{hint}</Kbd></span>}
    </button>
  );
}

export function Sidebar() {
  const { route, navigate, meetings, recording, newMeeting, setSearchOpen } = useApp();
  const is = (n: Route["name"]) => route.name === n;
  const recent = meetings.slice(0, 12);
  return (
    <aside className="no-print flex w-[232px] shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="drag h-[52px] shrink-0" />
      <div className="px-2.5">
        <button onClick={() => newMeeting(false)}
          className="mb-2 flex h-8 w-full items-center gap-2 rounded-full border border-line-strong bg-raised px-2.5 text-[13px] font-medium text-ink shadow-[0_1px_1px_rgb(0_0_0/0.03)] hover:bg-paper">
          <Plus className="size-4" /> <span className="flex-1 text-left">New note</span> <Kbd>⌘N</Kbd>
        </button>
        <NavItem icon={<Search className="size-[15px]" />} label="Search" onClick={() => setSearchOpen(true)} hint="⌘K" />
        <NavItem icon={<Home className="size-[15px]" />} label="Meetings" active={is("home") || is("meeting")} onClick={() => navigate({ name: "home" })} />
        <NavItem icon={<MessageCircle className="size-[15px]" />} label="Ask Grain" active={is("chat")} onClick={() => navigate({ name: "chat" })} hint="⌘J" />
        <NavItem icon={<CheckSquare className="size-[15px]" />} label="Action items" active={is("actions")} onClick={() => navigate({ name: "actions" })} />
      </div>

      {recording && (
        <button onClick={() => navigate({ name: "meeting", id: recording.meetingId })}
          className="mx-2.5 mt-3 flex items-center gap-2 rounded-[9px] bg-rec-soft px-2.5 py-2 text-left text-[12.5px] text-rec-ink">
          <RecDot pulse={!recording.paused} />
          <span className="flex-1 truncate font-medium">{recording.paused ? "Paused" : "Recording"}</span>
          <span className="tabular-nums">{fmtTs(recording.elapsed * 1000)}</span>
        </button>
      )}

      <div className="mt-4 px-4 text-[11px] font-medium uppercase tracking-[0.04em] text-ink-3">Recent</div>
      <div className="scroll-y mt-1 flex-1 px-2.5 pb-2">
        {recent.length === 0 && <div className="px-2 py-1.5 text-[12.5px] text-ink-3">No meetings yet</div>}
        {recent.map(({ meeting: m }) => {
          const active = route.name === "meeting" && route.id === m.id;
          return (
            <button key={m.id} onClick={() => navigate({ name: "meeting", id: m.id })}
              className={`flex h-[28px] w-full items-center gap-2 rounded-[7px] px-2 text-left text-[12.5px] ${active ? "bg-line text-ink" : "text-ink-2 hover:bg-wash"}`}>
              {recording?.meetingId === m.id && <RecDot className="size-1.5" />}
              <span className="truncate">{m.title || "Untitled meeting"}</span>
            </button>
          );
        })}
      </div>

      <div className="border-t border-line px-2.5 py-2">
        <NavItem icon={<Cpu className="size-[15px]" />} label="Models" active={is("models")} onClick={() => navigate({ name: "models" })} />
        <NavItem icon={<Settings className="size-[15px]" />} label="Settings" active={is("settings")} onClick={() => navigate({ name: "settings" })} hint="⌘," />
        <div className="mt-1.5 flex items-center gap-1.5 px-2 text-[11.5px] text-ink-3" title="Audio, transcripts, notes and AI all stay on this Mac.">
          <ShieldCheck className="size-3.5 text-accent" /> On-device · no cloud
        </div>
      </div>
    </aside>
  );
}
