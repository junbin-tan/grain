import { CheckSquare, Cpu, Home, MessageCircle, Plus, Search, Settings } from "lucide-react";
import { useApp, type Route } from "../lib/store";
import { Kbd, RecDot, VerifyBadge } from "./ui";
import { fmtTs } from "../lib/format";

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
  const { route, navigate, meetings, recording, newMeeting, setSearchOpen } = useApp();
  const is = (n: Route["name"]) => route.name === n;
  const recent = meetings.slice(0, 12);
  return (
    <aside className="no-print flex w-[232px] shrink-0 flex-col border-r border-line bg-paper-sunken">
      <div className="drag h-[52px] shrink-0" />
      <div className="px-2.5">
        <button onClick={() => newMeeting(false)}
          className="mb-2 flex h-8 w-full items-center gap-2 rounded-md border border-line-strong bg-paper-raised px-2.5 text-[13px] font-medium text-ink hover:bg-paper">
          <Plus className="size-4" /> <span className="flex-1 text-left">New note</span> <Kbd>⌘N</Kbd>
        </button>
        <NavItem icon={<Search className="size-[15px]" />} label="Search" onClick={() => setSearchOpen(true)} hint="⌘K" />
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
            <button key={m.id} onClick={() => navigate({ name: "meeting", id: m.id })}
              className={`flex h-[28px] w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] ${active ? "bg-line text-ink" : "text-ink-muted hover:bg-line/50"}`}>
              {recording?.meetingId === m.id && <RecDot className="size-1.5" />}
              <span className="truncate">{m.title || "Untitled meeting"}</span>
            </button>
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
