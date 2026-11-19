import { useEffect, useState } from "react";
import { FileJson, FileText, FileType, Music, Printer } from "lucide-react";
import { saveFile } from "../lib/dialogs";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { Button, Modal } from "./ui";

const FORMATS = [
  { id: "md", label: "Markdown", ext: "md", icon: FileText, desc: "Notes, action items and transcript. Works with Obsidian, Notion, git." },
  { id: "txt", label: "Plain text", ext: "txt", icon: FileType, desc: "The same content without formatting." },
  { id: "json", label: "JSON", ext: "json", icon: FileJson, desc: "Everything, including every notes version and segment timings." },
  { id: "pdf", label: "PDF", ext: "pdf", icon: Printer, desc: "Opens the print dialog. Choose “Save as PDF”." },
  { id: "wav", label: "Audio (WAV)", ext: "wav", icon: Music, desc: "Original recording, microphone and computer audio mixed." },
] as const;

export function ExportDialog({ open, onClose, meetingId, title, hasAudio }: { open: boolean; onClose: () => void; meetingId: string; title: string; hasAudio: boolean }) {
  const { toast } = useApp();
  const [fmt, setFmt] = useState<(typeof FORMATS)[number]["id"]>("md");
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [pdf, setPdf] = useState(false);

  useEffect(() => { if (open) api.exportPreview(meetingId).then(setPreview); }, [open, meetingId]);

  const run = async () => {
    const f = FORMATS.find((x) => x.id === fmt)!;
    if (fmt === "pdf") {
      setPdf(true);
      setTimeout(async () => { try { await api.printWindow(); } catch (e) { toast(String(e), "error"); } setPdf(false); }, 150);
      return;
    }
    const safe = (title || "Untitled meeting").replace(/[/\\:*?"<>|]/g, "-").slice(0, 80);
    const path = await saveFile(`${safe}.${f.ext}`, [{ name: f.label, extensions: [f.ext] }]);
    if (!path) return;
    setBusy(true);
    try {
      await api.exportMeeting(meetingId, fmt, path);
      toast(`Exported ${f.label}`, "success");
      onClose();
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Export meeting" width={560}>
        <div className="grid grid-cols-[200px_1fr]">
          <div className="border-r border-line p-2">
            {FORMATS.map((f) => {
              const disabled = f.id === "wav" && !hasAudio;
              return (
                <button key={f.id} disabled={disabled} onClick={() => setFmt(f.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] disabled:opacity-40 ${fmt === f.id ? "bg-paper-sunken font-medium" : "hover:bg-paper-sunken"}`}>
                  <f.icon className="size-4 text-ink-subtle" />{f.label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col p-4">
            <div className="text-[12.5px] text-ink-muted">{FORMATS.find((x) => x.id === fmt)!.desc}</div>
            {fmt !== "wav" && <pre className="scroll-y selectable mt-3 h-[220px] rounded-md border border-line bg-paper p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-muted">{preview}</pre>}
            {fmt === "wav" && <div className="mt-3 text-[12.5px] text-ink-subtle">16 kHz mono WAV. Files are written only where you choose.</div>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button variant="primary" loading={busy} onClick={run}>{fmt === "pdf" ? "Print / Save PDF" : "Export…"}</Button>
            </div>
          </div>
        </div>
      </Modal>
      {pdf && (
        <div className="fixed inset-0 z-[100] overflow-auto bg-white p-12 text-[12pt] leading-relaxed text-black">
          <pre className="font-sans whitespace-pre-wrap">{preview}</pre>
        </div>
      )}
    </>
  );
}
