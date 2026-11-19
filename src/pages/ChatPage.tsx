import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { relTime } from "../lib/format";
import { AskPanel } from "../components/AskPanel";
import { Button, IconButton } from "../components/ui";

export function ChatPage({ threadId, ask }: { threadId?: string; ask?: string }) {
  const [threads, setThreads] = useState<{ id: string; title: string; createdAt: number }[]>([]);
  const [active, setActive] = useState<string | null>(threadId ?? null);
  const [key, setKey] = useState(0);
  const { navigate } = useApp();
  const load = () => api.listThreads(null).then(setThreads);
  useEffect(() => { load(); }, []);

  return (
    <div className="flex h-full">
      <div className="flex w-[220px] shrink-0 flex-col border-r border-line">
        <div className="drag h-[52px] shrink-0" />
        <div className="px-3 pb-3">
          <Button size="sm" className="w-full" onClick={() => { setActive(null); setKey((k) => k + 1); }}><Plus className="size-3.5" />New chat</Button>
        </div>
        <div className="px-3 pb-1 text-[11px] font-medium tracking-[0.04em] text-ink-subtle uppercase">History</div>
        <div className="scroll-y flex-1 px-2">
          {threads.length === 0 && <div className="px-2 py-1 text-[12.5px] text-ink-subtle">No chats yet</div>}
          {threads.map((t) => (
            <div key={t.id} className={`group flex items-center rounded-md ${active === t.id ? "bg-paper-sunken" : "hover:bg-paper-sunken"}`}>
              <button onClick={() => setActive(t.id)} className="min-w-0 flex-1 px-2 py-1.5 text-left">
                <div className="truncate text-[12.5px] text-ink">{t.title}</div>
                <div className="text-[11px] text-ink-subtle">{relTime(t.createdAt)}</div>
              </button>
              <IconButton label="Delete chat" className="opacity-0 group-hover:opacity-100" onClick={async () => { await api.deleteThread(t.id); if (active === t.id) setActive(null); load(); }}><Trash2 className="size-3.5" /></IconButton>
            </div>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="drag h-[52px] shrink-0" />
        <div className="min-h-0 flex-1">
          <AskPanel key={`${active ?? "new"}-${key}`} threadId={active} ask={active ? undefined : ask} onThread={(id) => { setActive(id); load(); if (ask) navigate({ name: "chat", threadId: id }, true); }}
            header={<h1 className="mx-auto w-full max-w-[680px] px-4 title">Ask Grain</h1>} />
        </div>
      </div>
    </div>
  );
}
