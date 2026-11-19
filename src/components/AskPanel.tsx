import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, FileText, MessageCircle, Quote } from "lucide-react";
import { api, on, type ChatMessage, type Source } from "../lib/api";
import { fmtDate, fmtTs } from "../lib/format";
import { useApp } from "../lib/store";
import { Spinner } from "./ui";

/** Renders an answer with [n] citations as small clickable chips. */
function Answer({ text, sources, onSource }: { text: string; sources: Source[]; onSource: (s: Source) => void }) {
  const parts: ReactNode[] = [];
  const re = /\[(\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    parts.push(text.slice(last, m.index));
    const n = Number(m[1]);
    const s = sources.find((x) => x.n === n);
    parts.push(
      <button key={k++} onClick={() => s && onSource(s)} disabled={!s} title={s ? `${s.meetingTitle}${s.startMs != null ? ` · ${fmtTs(s.startMs)}` : ""}` : undefined}
        className="mx-[1px] inline-grid h-[17px] min-w-[17px] -translate-y-[1px] place-items-center rounded-[5px] bg-accent-soft px-1 align-middle text-[10.5px] font-semibold text-accent-ink hover:bg-accent/20">
        {n}
      </button>,
    );
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return <div className="selectable text-[13.5px] leading-[1.6] whitespace-pre-wrap text-ink">{parts}</div>;
}

export const SUGGESTIONS_MEETING = ["What were the decisions?", "List the action items and owners", "Draft a follow-up email", "What questions are still open?"];
export const SUGGESTIONS_GLOBAL = ["What did we decide yesterday?", "What action items are assigned to me?", "What did customers say about pricing?", "What blockers were raised this week?"];

export function AskPanel({ meetingId, threadId: initialThread, onThread, compact, header }: { meetingId?: string; threadId?: string | null; onThread?: (id: string) => void; compact?: boolean; header?: ReactNode }) {
  const { navigate, catalog, settings, toast } = useApp();
  const [threadId, setThreadId] = useState<string | null>(initialThread ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [stream, setStream] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<string | null>(threadId);
  threadRef.current = threadId;
  const llmReady = catalog.some((c) => c.id === settings.llmModel && c.status === "ready");

  useEffect(() => {
    setThreadId(initialThread ?? null);
  }, [initialThread]);

  useEffect(() => {
    if (threadId) api.threadMessages(threadId).then(setMessages);
    else setMessages([]);
  }, [threadId]);

  useEffect(() => on<{ threadId: string; token: string }>("chat-token", (e) => {
    if (!threadRef.current || e.threadId === threadRef.current) setStream((s) => s + e.token);
  }), []);

  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [messages, stream]);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || pending) return;
    setInput("");
    setPending(true);
    setStream("");
    setMessages((m) => [...m, { id: -Date.now(), threadId: threadId ?? "", role: "user", content: question, sources: [], createdAt: Date.now() }]);
    try {
      const r = await api.ask(question, threadId, meetingId ?? null);
      if (!threadId) {
        setThreadId(r.threadId);
        onThread?.(r.threadId);
      }
      setMessages(await api.threadMessages(r.threadId));
    } catch (e) {
      toast(String(e), "error");
      setMessages((m) => m.slice(0, -1));
      setInput(question);
    } finally {
      setPending(false);
      setStream("");
    }
  };

  const openSource = (s: Source) => navigate({ name: "meeting", id: s.meetingId, tab: s.kind === "segment" ? "transcript" : s.kind === "manual" ? "notes" : "enhanced", at: s.startMs ?? undefined });
  const suggestions = meetingId ? SUGGESTIONS_MEETING : SUGGESTIONS_GLOBAL;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="scroll-y flex-1 px-4 py-3">
        {messages.length === 0 && !pending && (
          <div className={compact ? "pt-2" : "pt-[10vh]"}>
            <div className={`mb-3 flex items-center gap-2 text-ink-2 ${compact ? "text-[13px]" : "justify-center text-[15px]"}`}>
              <MessageCircle className="size-4" /> {meetingId ? "Ask about this meeting" : "Ask about any of your meetings"}
            </div>
            {!llmReady && <div className={`mb-3 text-[12.5px] text-ink-3 ${compact ? "" : "text-center"}`}>Download a notes model in Models to get answers.</div>}
            <div className={`flex flex-wrap gap-1.5 ${compact ? "" : "mx-auto max-w-[520px] justify-center"}`}>
              {suggestions.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-line bg-raised px-3 py-1 text-[12.5px] text-ink-2 hover:bg-wash hover:text-ink">{s}</button>
              ))}
            </div>
          </div>
        )}
        <div className={compact ? "" : "mx-auto max-w-[680px]"}>
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="mt-4 flex justify-end">
                <div className="selectable max-w-[85%] rounded-[12px] bg-wash px-3 py-2 text-[13.5px] leading-[1.5] whitespace-pre-wrap">{m.content}</div>
              </div>
            ) : (
              <div key={m.id} className="mt-4">
                <Answer text={m.content} sources={m.sources} onSource={openSource} />
                {m.sources.length > 0 && (
                  <div className="mt-2.5 flex flex-col gap-1">
                    {m.sources.map((s) => (
                      <button key={s.n} onClick={() => openSource(s)} className="flex items-start gap-2 rounded-[8px] border border-line bg-raised px-2.5 py-1.5 text-left hover:bg-wash">
                        <span className="mt-[1px] grid h-[17px] min-w-[17px] place-items-center rounded-[5px] bg-accent-soft text-[10.5px] font-semibold text-accent">{s.n}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
                            {s.kind === "segment" ? <Quote className="size-3 text-ink-3" /> : <FileText className="size-3 text-ink-3" />}
                            <span className="truncate">{s.meetingTitle || "Untitled meeting"}</span>
                            <span className="shrink-0 font-normal text-ink-3">· {fmtDate(s.meetingDate)}{s.startMs != null && ` · ${fmtTs(s.startMs)}`}</span>
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-[12px] text-ink-2">{s.excerpt}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ),
          )}
          {pending && (
            <div className="mt-4">
              {stream ? <Answer text={stream} sources={[]} onSource={() => {}} /> : <div className="flex items-center gap-2 text-[13px] text-ink-3"><Spinner /> Searching your meetings…</div>}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>
      <div className={`px-3 pb-3 ${compact ? "" : "mx-auto w-full max-w-[720px]"}`}>
        <form onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="flex items-end gap-2 rounded-[12px] border border-line-strong bg-raised p-1.5 pl-3 shadow-[var(--shadow-float)] focus-within:border-ink-3">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} placeholder={meetingId ? "Ask about this meeting…" : "Ask anything about your meetings…"}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            className="max-h-32 min-h-[30px] flex-1 resize-none bg-transparent py-1.5 text-[13.5px] outline-none placeholder:text-ink-3" autoFocus={!compact} />
          <button type="submit" aria-label="Send" disabled={!input.trim() || pending}
            className="grid size-[30px] place-items-center rounded-full bg-ink text-white hover:bg-ink/88 disabled:bg-line-strong">
            {pending ? <Spinner className="text-white" /> : <ArrowUp className="size-4" />}
          </button>
        </form>
        <div className="mt-1.5 text-center text-[11px] text-ink-3">Answers come from a local model using only your meetings. Check important details against the sources.</div>
      </div>
    </div>
  );
}
