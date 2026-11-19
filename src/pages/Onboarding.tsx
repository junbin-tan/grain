import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Cpu, Lock, Mic, MonitorSpeaker, ShieldCheck, Sparkles, WifiOff } from "lucide-react";
import { api, type Permissions, type Recommendation } from "../lib/api";
import { fmtBytes, langName } from "../lib/format";
import { useApp } from "../lib/store";
import { AudioTest, LanguagePicker } from "./SettingsPage";
import { Badge, Banner, Button, Progress } from "../components/ui";

const STEPS = ["Welcome", "Privacy", "Your Mac", "Languages", "Models", "Permissions", "Audio test", "Ready"];

function Mark() {
  return (
    // Same geometry as scripts/make-icon.swift: one grain seed; its crease doubles as a single voice-level bar.
    <svg viewBox="-50 -50 100 100" className="size-14" aria-hidden>
      <rect x="-50" y="-50" width="100" height="100" rx="22.5" className="fill-accent" />
      <path fillRule="evenodd" className="fill-paper" d="M0 -30 C19 -12 19 12 0 30 C-19 12 -19 -12 0 -30Z M-2.2 -15 a2.2 2.2 0 0 1 4.4 0 V15 a2.2 2.2 0 0 1 -4.4 0Z" />
    </svg>
  );
}

function ModelPick({ id, reason }: { id: string; reason?: string }) {
  const { catalog, downloads, toast, refreshCatalog } = useApp();
  const m = catalog.find((c) => c.id === id);
  if (!m) return null;
  const d = downloads[id];
  const busy = m.status === "downloading" || d?.state === "downloading" || d?.state === "verifying";
  const pct = d?.total ? (d.downloaded ?? 0) / d.total : 0;
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-line bg-raised px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13.5px] font-medium">{m.name} <span className="text-[12px] font-normal text-ink-3">{fmtBytes(m.size)}</span></div>
        <div className="text-[12px] text-ink-2">{m.found && m.status !== "ready" ? `Already on this Mac (from ${m.found.source}) — no download needed` : reason ?? m.description}</div>
        {busy && <div className="mt-1.5 flex items-center gap-2"><Progress value={pct} className="w-[200px]" /><span className="text-[11.5px] text-ink-3 tabular-nums">{d?.state === "verifying" ? "Verifying…" : `${Math.round(pct * 100)}%`}</span></div>}
        {d?.state === "failed" && <div className="mt-1 text-[11.5px] text-rec">{d.error}</div>}
      </div>
      {m.status === "ready" ? <Badge tone="accent"><Check className="size-3" />Installed</Badge> : !busy && m.found ? (
        <Button size="sm" variant="primary" title={`Found in ${m.found.source}; checked with SHA-256, no download`} onClick={async () => { try { await api.downloadModel(id, m.found!.quant); refreshCatalog(); } catch (e) { toast(String(e), "error"); } }}>Use it — on this Mac</Button>
      ) : busy ? (
        <Button size="sm" variant="ghost" onClick={() => api.cancelDownload(id)}>Cancel</Button>
      ) : (
        <Button size="sm" onClick={async () => { try { await api.downloadModel(id); refreshCatalog(); } catch (e) { toast(String(e), "error"); } }}>{m.partialBytes > 0 ? "Resume" : "Download"}</Button>
      )}
    </div>
  );
}

export function Onboarding() {
  const { hardware, settings, setSetting, catalog, newMeeting } = useApp();
  const [step, setStep] = useState<number>(() => (window as any).__grainUi?.step ?? 0);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [perms, setPerms] = useState<Permissions | null>(null);
  const langs: string[] = settings.languages ?? ["en"];

  useEffect(() => { api.recommend(langs).then(setRec); }, [settings.languages]);
  useEffect(() => { if (step === 5) api.permissions().then(setPerms); }, [step]);

  const finish = async (record: boolean) => {
    await setSetting("onboardingDone", true);
    if (record) await newMeeting(false);
  };
  const ready = (id?: string) => !!id && catalog.some((c) => c.id === id && c.status === "ready");
  const asrOk = catalog.some((c) => c.role === "asr" && c.status === "ready");
  const llmOk = catalog.some((c) => c.role === "llm" && c.status === "ready");

  const body = [
    <div key="w" className="text-center">
      <div className="flex justify-center"><Mark /></div>
      <h1 className="mt-5 font-serif text-[34px] font-semibold tracking-[-0.01em]">Welcome to Grain</h1>
      <p className="mx-auto mt-3 max-w-[440px] text-[14.5px] leading-relaxed text-ink-2">The AI notepad for your meetings. Jot down what matters, and Grain turns your notes and the conversation into clear meeting notes, entirely on this Mac.</p>
      <p className="mt-2 text-[12.5px] text-ink-3">No account. No bot joins your calls.</p>
    </div>,
    <div key="p">
      <h1 className="font-serif text-[28px] font-semibold">Private by design</h1>
      <div className="mt-5 grid gap-3">
        {[[Lock, "Everything stays on this Mac", "Audio, transcripts, notes and chats are stored in a local folder you control. Delete anything, any time."],
          [Cpu, "AI runs locally", "Speech recognition and the notes model run on your Mac's GPU. Nothing is sent to an AI service."],
          [WifiOff, "Works offline", "After you download the models (next steps), Grain works with the internet switched off."],
          [ShieldCheck, "You're in control of recording", "Grain only records when you press Record and always shows a recording indicator. Tell people you're recording: consent laws vary."]].map(([Icon, t, d]: any) => (
          <div key={t} className="flex gap-3 rounded-[12px] border border-line bg-raised p-3.5">
            <div className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-accent-soft text-accent"><Icon className="size-[18px]" /></div>
            <div><div className="text-[13.5px] font-semibold">{t}</div><div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">{d}</div></div>
          </div>
        ))}
      </div>
    </div>,
    <div key="h">
      <h1 className="font-serif text-[28px] font-semibold">Your Mac</h1>
      <p className="mt-1 text-[13px] text-ink-2">Grain picks models that fit this computer.</p>
      {hardware && (
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          {[["Chip", hardware.chip || hardware.arch], ["Memory", `${Math.round(hardware.totalRamGb)} GB`], ["Acceleration", hardware.gpu], ["Free storage", `${hardware.freeDiskGb.toFixed(0)} GB`], ["System", `${hardware.os} ${hardware.osVersion}`], ["CPU cores", String(hardware.cpuCores)]].map(([k, v]) => (
            <div key={k} className="rounded-[10px] border border-line bg-raised px-3 py-2.5"><div className="text-[11.5px] text-ink-3">{k}</div><div className="mt-0.5 text-[13.5px] font-medium">{v}</div></div>
          ))}
        </div>
      )}
      <div className="mt-4 flex flex-col gap-2">
        {hardware?.notes.map((n) => <Banner key={n} tone="warn" icon={<AlertTriangle className="size-4" />}>{n}</Banner>)}
        {hardware && hardware.freeDiskGb < 6 && <Banner tone="warn" icon={<AlertTriangle className="size-4" />}>Low storage: the recommended models need about 4 GB.</Banner>}
        {hardware?.appleSilicon && !hardware.notes.length && <Banner tone="accent" icon={<Check className="size-4" />}>Apple Silicon with Metal: models run on the GPU.</Banner>}
      </div>
    </div>,
    <div key="l">
      <h1 className="font-serif text-[28px] font-semibold">Which languages do you speak in meetings?</h1>
      <p className="mt-1 text-[13px] text-ink-2">Pick all that apply, including languages you mix (for example English and Mandarin).</p>
      <div className="mt-5"><LanguagePicker /></div>
      {langs.length === 0 && <div className="mt-3 text-[12.5px] text-rec">Choose at least one language.</div>}
    </div>,
    <div key="m">
      <h1 className="font-serif text-[28px] font-semibold">Download your models</h1>
      <p className="mt-1 text-[13px] text-ink-2">Recommended for {langs.map(langName).join(" + ")} on this Mac. Downloads continue in the background; you can change models later.</p>
      {rec && (
        <div className="mt-5 flex flex-col gap-4">
          <div><div className="mb-1.5 text-[12px] font-semibold text-ink-2">1 · Transcription (speech to text)</div><ModelPick id={rec.asr[0]} reason={rec.reasons[rec.asr[0]]} /></div>
          <div><div className="mb-1.5 text-[12px] font-semibold text-ink-2">2 · Notes & chat (writes notes, answers questions)</div><ModelPick id={rec.llm} reason={rec.reasons[rec.llm]} /></div>
          <div><div className="mb-1.5 text-[12px] font-semibold text-ink-2">3 · Search by meaning <span className="font-normal text-ink-3">(optional)</span></div><ModelPick id={rec.embed} /></div>
          {!ready(rec.asr[0]) && !ready(rec.llm) && <div className="text-[12px] text-ink-3">Only these downloads use the internet. Files come from Hugging Face and are verified with SHA-256.</div>}
        </div>
      )}
    </div>,
    <div key="perm">
      <h1 className="font-serif text-[28px] font-semibold">Allow audio access</h1>
      <p className="mt-1 text-[13px] text-ink-2">macOS asks once for each. Grain records only while you're in a meeting you started.</p>
      <div className="mt-5 flex flex-col gap-2.5">
        <div className="flex items-center gap-3 rounded-[10px] border border-line bg-raised px-3.5 py-3">
          <Mic className="size-5 text-accent" />
          <div className="flex-1"><div className="text-[13.5px] font-medium">Microphone</div><div className="text-[12px] text-ink-2">Your side of the conversation.</div></div>
          {perms?.mic === "granted" ? <Badge tone="accent"><Check className="size-3" />Allowed</Badge> : perms?.mic === "denied" ? <Button size="sm" onClick={() => api.openPrivacySettings("mic")}>Open System Settings</Button> : <Button size="sm" onClick={async () => setPerms(await api.requestPermission("mic"))}>Allow</Button>}
        </div>
        <div className="flex items-center gap-3 rounded-[10px] border border-line bg-raised px-3.5 py-3">
          <MonitorSpeaker className="size-5 text-them" />
          <div className="flex-1"><div className="text-[13.5px] font-medium">Screen & system audio</div><div className="text-[12px] text-ink-2">Lets Grain hear the other people on Zoom, Meet or Teams. Your screen is never recorded.</div></div>
          {perms?.screen === "granted" ? <Badge tone="accent"><Check className="size-3" />Allowed</Badge> : <div className="flex gap-1.5"><Button size="sm" onClick={async () => setPerms(await api.requestPermission("screen"))}>Allow</Button><Button size="sm" variant="ghost" onClick={() => api.openPrivacySettings("screen")}>Settings</Button></div>}
        </div>
        {perms?.screen !== "granted" && <div className="text-[12px] text-ink-3">After allowing screen & system audio in System Settings, macOS may ask you to reopen Grain.</div>}
        <Button size="sm" variant="ghost" className="self-start" onClick={() => api.permissions().then(setPerms)}>Check again</Button>
      </div>
    </div>,
    <div key="a">
      <h1 className="font-serif text-[28px] font-semibold">Test your audio</h1>
      <p className="mt-1 text-[13px] text-ink-2">Say something, and play a video or music on your computer. Both meters should move.</p>
      <div className="mt-6 rounded-[12px] border border-line bg-raised p-4"><AudioTest /></div>
      <div className="mt-3 text-[12px] text-ink-3">The test recording is deleted straight away.</div>
    </div>,
    <div key="r">
      <h1 className="font-serif text-[28px] font-semibold">You're ready</h1>
      <div className="mt-5 flex flex-col gap-3 text-[13.5px] text-ink-2">
        {[["1", "Start a meeting", "Press Record (⌘R) when your call begins. No bot joins."], ["2", "Jot down what matters", "Short phrases are enough. Your notes tell Grain what's important."], ["3", "Enhance your notes", "When the call ends, press Enhance notes (⌘E). Decisions and action items are linked to the moment they were said."], ["4", "Ask about any meeting", "Ask Grain (⌘J) answers from your meetings, with sources."]].map(([n, t, d]) => (
          <div key={n} className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-semibold text-white">{n}</span><div><div className="font-medium text-ink">{t}</div><div className="text-[12.5px]">{d}</div></div></div>
        ))}
      </div>
      {(!asrOk || !llmOk) && <div className="mt-5"><Banner tone="warn" icon={<AlertTriangle className="size-4" />}>{!asrOk ? "No speech model yet: recordings will be kept and can be transcribed later." : "No notes model yet: you can still record and transcribe."}</Banner></div>}
    </div>,
  ];

  return (
    <div className="flex h-full flex-col bg-paper">
      <div className="drag h-[52px] shrink-0" />
      <div className="scroll-y flex-1">
        <div className="mx-auto flex min-h-full max-w-[560px] flex-col px-8 pb-10">
          <div className="mb-8 flex gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((s, i) => <div key={s} title={s} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? "bg-ink" : "bg-line"}`} />)}
          </div>
          <div key={step} className="flex-1 animate-rise">{body[step]}</div>
          <div className="mt-10 flex items-center justify-between">
            {step > 0 ? <Button variant="ghost" onClick={() => setStep(step - 1)}>Back</Button> : <span />}
            {step < STEPS.length - 1 ? (
              <div className="flex gap-2">
                {step >= 4 && step <= 6 && <Button variant="ghost" onClick={() => setStep(step + 1)}>Skip</Button>}
                <Button variant="primary" size="lg" disabled={step === 3 && langs.length === 0} onClick={() => setStep(step + 1)}>{step === 0 ? "Get started" : "Continue"}<ArrowRight className="size-4" /></Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button size="lg" onClick={() => finish(false)}>Go to meetings</Button>
                <Button variant="primary" size="lg" onClick={() => finish(true)}><Sparkles className="size-4" />Start my first meeting</Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
