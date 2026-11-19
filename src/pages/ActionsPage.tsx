import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, CheckSquare } from "lucide-react";
import { api, type ActionItem } from "../lib/api";
import { fmtDate } from "../lib/format";
import { useApp } from "../lib/store";
import { Badge, EmptyState } from "../components/ui";

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
          <h1 className="font-serif text-[30px] font-semibold">Action items</h1>
          <div className="mt-4 flex items-center gap-1">
            {(["open", "done", "all"] as const).map((s) => (
              <button key={s} onClick={() => setShow(s)} className={`h-7 rounded-full px-3 text-[12.5px] capitalize ${show === s ? "bg-ink text-white" : "text-ink-2 hover:bg-wash"}`}>{s}</button>
            ))}
            <div className="mx-2 h-4 w-px bg-line" />
            <button onClick={() => setMine((v) => !v)} className={`h-7 rounded-full px-3 text-[12.5px] ${mine ? "bg-accent-soft text-accent-ink" : "text-ink-2 hover:bg-wash"}`}>Assigned to me</button>
          </div>
          {byMeeting.length === 0 && <EmptyState icon={<CheckSquare className="size-5" />} title={rows.length ? "Nothing here" : "No action items yet"} body="Action items are extracted when you enhance a meeting's notes. Only commitments people actually made are listed as assigned." />}
          {byMeeting.map((g) => (
            <section key={g[0].item.meetingId} className="mt-6">
              <button onClick={() => navigate({ name: "meeting", id: g[0].item.meetingId, tab: "enhanced" })} className="mb-1 text-[12.5px] font-medium text-ink-2 hover:text-ink">
                {g[0].meetingTitle || "Untitled meeting"} <span className="font-normal text-ink-3">· {g[0].meetingDate ? fmtDate(g[0].meetingDate) : ""}</span>
              </button>
              <div className="rounded-[var(--radius-card)] border border-line bg-raised px-3">
                {g.map(({ item: a }) => (
                  <div key={a.id} className="flex items-start gap-2.5 border-b border-line py-2.5 last:border-0">
                    <button aria-label={a.status === "done" ? "Mark open" : "Mark done"} onClick={async () => { await api.setActionStatus(a.id, a.status === "done" ? "open" : "done"); load(); }}
                      className={`mt-[3px] grid size-4 shrink-0 place-items-center rounded-[4px] border ${a.status === "done" ? "border-accent bg-accent text-white" : "border-line-strong"}`}>
                      {a.status === "done" && <Check className="size-3" />}
                    </button>
                    <div className="flex-1">
                      <div className={`text-[14px] ${a.status === "done" ? "text-ink-3 line-through" : ""}`}>{a.description}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {a.owner && <Badge>{a.owner === "Me" ? "You" : a.owner}</Badge>}
                        {a.deadline && <Badge>{a.deadline}</Badge>}
                        {a.kind === "suggestion" && <Badge tone="warn">Suggested</Badge>}
                        {!a.verified && <Badge tone="rec"><AlertTriangle className="size-3" />Unverified</Badge>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
