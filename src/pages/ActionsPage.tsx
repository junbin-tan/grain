import { useEffect, useMemo, useState } from "react";
import { CheckSquare } from "lucide-react";
import { api, type ActionItem } from "../lib/api";
import { fmtDate } from "../lib/format";
import { useApp } from "../lib/store";
import { EmptyState } from "../components/ui";
import { ActionRow } from "../components/EnhancedView";

type Row = { item: ActionItem; meetingTitle: string | null; meetingDate: number | null };

export function ActionsPage() {
  const { navigate } = useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [show, setShow] = useState<"open" | "done" | "all">("open");
  const [mine, setMine] = useState(false);
  const load = () => api.listActionItems().then(setRows);
  useEffect(() => { load(); }, []);

  const list = useMemo(() => rows.filter((r) => (show === "all" || r.item.status === show) && (!mine || r.item.owner === "Me")), [rows, show, mine]);
  const byMeeting = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of list) m.set(r.item.meetingId, [...(m.get(r.item.meetingId) ?? []), r]);
    return [...m.values()];
  }, [list]);

  return (
    <div className="flex h-full flex-col">
      <div className="drag h-[52px] shrink-0" />
      <div className="scroll-y flex-1">
        <div className="mx-auto max-w-[760px] px-8 pb-20">
          <h1 className="title">Action items</h1>
          <div className="mt-4 flex items-center gap-1">
            {(["open", "done", "all"] as const).map((s) => (
              <button key={s} onClick={() => setShow(s)} className={`h-7 rounded-sm px-3 text-[12.5px] capitalize ${show === s ? "bg-ink text-paper" : "text-ink-muted hover:bg-paper-sunken"}`}>{s}</button>
            ))}
            <div className="mx-2 h-4 w-px bg-line" />
            <button onClick={() => setMine((v) => !v)} className={`h-7 rounded-sm px-3 text-[12.5px] ${mine ? "bg-ink text-paper" : "text-ink-muted hover:bg-paper-sunken"}`}>Assigned to me</button>
          </div>
          {byMeeting.length === 0 && <EmptyState icon={<CheckSquare className="size-5" />} title={rows.length ? "Nothing here" : "No action items yet"} body="Action items are extracted when you enhance a meeting's notes. Only commitments people actually made are listed as assigned." />}
          {byMeeting.map((g) => (
            <section key={g[0].item.meetingId} className="mt-6">
              <button onClick={() => navigate({ name: "meeting", id: g[0].item.meetingId, tab: "enhanced" })} className="mb-1 text-[12.5px] font-medium text-ink-muted hover:text-ink">
                {g[0].meetingTitle || "Untitled meeting"} <span className="font-normal text-ink-subtle">· {g[0].meetingDate ? fmtDate(g[0].meetingDate) : ""}</span>
              </button>
              <div className="rounded-lg border border-line bg-paper-raised px-4">
                {g.map(({ item: a }) => (
                  <ActionRow key={a.id} a={{ ...a, owner: a.owner === "Me" ? "You" : a.owner }} onToggle={async () => { await api.setActionStatus(a.id, a.status === "done" ? "open" : "done"); load(); }} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
