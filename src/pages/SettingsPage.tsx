import { useEffect, useState, type ReactNode } from "react";
import { confirm, openFolder } from "../lib/dialogs";
import { AudioLines, Mic, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { api, on, type Device, type Permissions, type Template } from "../lib/api";
import { fmtBytes, langName, LANGUAGES, PRIORITY_LANGUAGES } from "../lib/format";
import { useApp } from "../lib/store";
import { Badge, Button, Kbd, LevelBars, Select, Toggle } from "../components/ui";

const SECTIONS = [
  ["general", "General"], ["audio", "Audio"], ["transcription", "Transcription"], ["notes", "Notes & templates"],
  ["search", "Search"], ["privacy", "Privacy & data"], ["shortcuts", "Keyboard shortcuts"], ["about", "About"],
] as const;

function Row({ label, desc, children }: { label: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-6 border-b border-line py-3.5 last:border-0">
      <div className="flex-1">
        <div className="text-[13.5px] font-medium text-ink">{label}</div>
        {desc && <div className="mt-0.5 text-[12.5px] leading-snug text-ink-muted">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      {title && <h2 className="mb-2 px-1 text-[12.5px] font-semibold text-ink-muted">{title}</h2>}
      <div className="rounded-lg border border-line bg-paper-raised px-4">{children}</div>
    </section>
  );
}

export function LanguagePicker() {
  const { settings, setSetting } = useApp();
  const langs: string[] = settings.languages ?? ["en"];
  const toggle = (l: string) => setSetting("languages", langs.includes(l) ? langs.filter((x) => x !== l) : [...langs, l]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {PRIORITY_LANGUAGES.map((l) => (
        <button key={l} onClick={() => toggle(l)} aria-pressed={langs.includes(l)}
          className={`h-7 rounded-sm border px-3 text-[12.5px] ${langs.includes(l) ? "border-ink bg-ink text-paper" : "border-line bg-paper-raised text-ink-muted hover:bg-paper-sunken"}`}>
          {langName(l)}
        </button>
      ))}
    </div>
  );
}

export function AudioTest() {
  const { settings, toast } = useApp();
  const [levels, setLevels] = useState({ mic: 0, system: 0 });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ mic: number; system: number } | null>(null);
  useEffect(() => on<any>("audio-test", (e) => setLevels({ mic: e.mic ?? 0, system: e.system ?? 0 })), []);
  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const perms = await api.permissions();
      const r = await api.audioTest(perms.mic === "granted" ? (settings.micDevice ?? null) : "none", settings.captureSystem !== false && perms.screen === "granted", 5);
      setResult(r);
      r.errors.forEach((e) => toast(e, "error"));
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setRunning(false);
      setLevels({ mic: 0, system: 0 });
    }
  };
  const verdict = (v: number) => (v > 0.05 ? <Badge tone="sprout">Heard</Badge> : v > 0.005 ? <Badge tone="clay">Very quiet</Badge> : <Badge>Silent</Badge>);
  return (
    <div className="flex items-center gap-4">
      <span className="flex items-center gap-1.5 text-speaker-me"><Mic className="size-4" /><LevelBars level={levels.mic} active={running} /></span>
      <span className="flex items-center gap-1.5 text-speaker-them"><AudioLines className="size-4" /><LevelBars level={levels.system} active={running} /></span>
      <Button size="sm" onClick={run} loading={running}>{running ? "Listening 5 s…" : "Test audio"}</Button>
      {result && <span className="flex gap-1.5 text-[12px]">Mic {verdict(result.mic)} System {verdict(result.system)}</span>}
    </div>
  );
}

function Templates() {
  const { toast } = useApp();
  const [list, setList] = useState<Template[]>([]);
  const [edit, setEdit] = useState<{ id?: string; name: string; instructions: string } | null>(null);
  const load = () => api.listTemplates().then(setList);
  useEffect(() => { load(); }, []);
  return (
    <div className="py-3">
      {list.map((t) => (
        <div key={t.id} className="group flex items-start gap-3 rounded-md px-2 py-2 hover:bg-paper">
          <div className="flex-1">
            <div className="text-[13px] font-medium">{t.name} {t.builtin && <span className="text-[11.5px] font-normal text-ink-subtle">· built-in</span>}</div>
            <div className="text-[12px] text-ink-muted">{t.instructions}</div>
          </div>
          {!t.builtin && (
            <div className="flex gap-1 opacity-0 group-hover:opacity-100">
              <Button size="sm" variant="ghost" onClick={() => setEdit(t)}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={async () => { await api.deleteTemplate(t.id); load(); }}><Trash2 className="size-3.5" /></Button>
            </div>
          )}
        </div>
      ))}
      {edit ? (
        <div className="mt-2 rounded-md border border-line p-3">
          <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Template name (e.g. Sales call)" className="h-8 w-full rounded-md border border-line px-2 text-[13px] outline-none focus:border-line-strong" />
          <textarea value={edit.instructions} onChange={(e) => setEdit({ ...edit, instructions: e.target.value })} rows={3} placeholder="What should the notes focus on? e.g. Customer's goals, objections, budget, next steps."
            className="mt-2 w-full rounded-md border border-line p-2 text-[13px] outline-none focus:border-line-strong" />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={async () => { try { await api.saveTemplate(edit.name, edit.instructions, edit.id); setEdit(null); load(); } catch (e) { toast(String(e), "error"); } }}>Save template</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" className="mt-2" onClick={() => setEdit({ name: "", instructions: "" })}><Plus className="size-3.5" />New template</Button>
      )}
    </div>
  );
}

export function SettingsPage({ section: initial }: { section?: string }) {
  const { settings, setSetting, catalog, navigate, storage, refreshStorage, hardware, toast, refreshMeetings, refreshCatalog } = useApp();
  const [section, setSection] = useState(initial ?? "general");
  const [devices, setDevices] = useState<Device[]>([]);
  const [perms, setPerms] = useState<Permissions | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [indexing, setIndexing] = useState(false);

  useEffect(() => { api.devices().then(setDevices).catch(() => {}); api.permissions().then(setPerms).catch(() => {}); api.listTemplates().then(setTemplates); refreshStorage(); }, [section]);

  const installed = (role: string) => catalog.filter((m) => m.role === role && m.status === "ready");
  // Like Handy: every curated model is in the dropdown; picking one that isn't installed downloads it and switches when ready.
  const modelSelect = (role: string, key: string) => {
    const list = installed(role);
    const available = catalog.filter((m) => m.role === role && m.curated && m.status !== "ready");
    const options = [
      ...(settings[key] ? [] : [{ value: "", label: "Choose…" }]),
      ...list.map((m) => ({ value: m.id, label: m.name })),
      ...available.map((m) => ({ value: m.id, label: m.status === "downloading" ? `${m.name} (downloading…)` : `${m.name} — download ${fmtBytes(m.size)}` })),
    ];
    return (
      <div className="flex items-center gap-1.5">
        <Select label={key} value={settings[key] ?? ""} className="w-[280px]" options={options}
          onChange={async (v) => {
            const m = catalog.find((c) => c.id === v);
            if (!m) return;
            if (m.status === "ready") return setSetting(key, v);
            try { await api.downloadModel(v, undefined, true); refreshCatalog(); toast(`Downloading ${m.name}. Grain switches to it when it's ready.`); } catch (e) { toast(String(e), "error"); }
          }} />
        <Button size="sm" variant="ghost" onClick={() => navigate({ name: "models", role: role as any })}>All models</Button>
      </div>
    );
  };
  const asr = catalog.find((m) => m.id === settings.asrModel);
  const shortcuts: [string, string][] = [["⌘N", "New note"], ["⌘K", "Search"], ["⌘J", "Ask Grain"], ["⌘R", "Start / stop recording"], ["⌘⇧P", "Pause / resume recording"], ["⌘M", "Mark an important moment"], ["⌘E", "Enhance notes"], ["⌘1 / ⌘2 / ⌘3", "My notes / Enhanced / Transcript"], ["⌘,", "Settings"], ["⌘[", "Back"]];

  return (
    <div className="flex h-full">
      <nav className="w-[200px] shrink-0 border-r border-line px-2">
        <div className="drag h-[52px]" />
        {SECTIONS.map(([id, label]) => (
          <button key={id} onClick={() => setSection(id)} className={`flex h-[30px] w-full items-center rounded-md px-2.5 text-[13px] ${section === id ? "bg-paper-sunken font-medium text-ink" : "text-ink-muted hover:bg-paper-sunken"}`}>{label}</button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="drag h-[52px] shrink-0" />
        <div className="scroll-y flex-1">
          <div className="mx-auto max-w-[680px] px-8 pb-20">
            <h1 className="title">{SECTIONS.find((s) => s[0] === section)?.[1]}</h1>

            {section === "general" && (
              <Card>
                <Row label="Default note template" desc="Used for new meetings. You can change it per meeting.">
                  <Select label="Default template" value={settings.defaultTemplate ?? "general"} onChange={(v) => setSetting("defaultTemplate", v)} options={templates.map((t) => ({ value: t.id, label: t.name }))} className="w-[220px]" />
                </Row>
                <Row label="Your name" desc="Optional. Helps Ask Grain answer “what did I commit to?”. Only stored on this Mac.">
                  <input defaultValue={settings.userName ?? ""} onBlur={(e) => setSetting("userName", e.target.value.trim())} placeholder="e.g. Alex" className="h-8 w-[220px] rounded-md border border-line-strong px-2 text-[13px] outline-none" />
                </Row>
                <Row label="Run setup again" desc="Revisit languages, models and permissions."><Button size="sm" onClick={() => setSetting("onboardingDone", false)}>Open setup</Button></Row>
              </Card>
            )}

            {section === "audio" && (
              <>
                <Card title="Sources">
                  <Row label="Microphone" desc="Your voice. Recorded as “Me”.">
                    <Select label="Microphone" value={settings.micDevice ?? "default"} onChange={(v) => { setSetting("micDevice", v === "default" ? null : v); if (v !== "none") api.switchMic(v).catch(() => {}); }}
                      options={[{ value: "default", label: "System default" }, { value: "none", label: "Off (computer audio only)" }, ...devices.map((d) => ({ value: d.uid, label: d.name + (d.default ? " (default)" : "") }))]} className="w-[260px]" />
                  </Row>
                  <Row label="Computer audio" desc="The other people on your call (Zoom, Meet, Teams…), captured with macOS ScreenCaptureKit. Recorded as “Them”. No video is captured.">
                    <Toggle label="Computer audio" checked={settings.captureSystem !== false} onChange={(v) => setSetting("captureSystem", v)} />
                  </Row>
                  <Row label="Test" desc="Speak, and play something on your computer."><AudioTest /></Row>
                </Card>
                <Card title="Permissions">
                  <Row label="Microphone access" desc={perms?.mic === "denied" ? "Denied. Enable Grain in System Settings › Privacy & Security › Microphone." : undefined}>
                    {perms?.mic === "granted" ? <Badge tone="sprout">Allowed</Badge> : perms?.mic === "denied" ? <Button size="sm" onClick={() => api.openPrivacySettings("mic")}>Open System Settings</Button> : <Button size="sm" onClick={async () => setPerms(await api.requestPermission("mic"))}>Allow</Button>}
                  </Row>
                  <Row label="Screen & system audio recording" desc="Required by macOS to capture computer audio. Grain never records your screen.">
                    {perms?.screen === "granted" ? <Badge tone="sprout">Allowed</Badge> : <div className="flex gap-1.5"><Button size="sm" onClick={async () => setPerms(await api.requestPermission("screen"))}>Allow</Button><Button size="sm" variant="ghost" onClick={() => api.openPrivacySettings("screen")}>Open Settings</Button></div>}
                  </Row>
                </Card>
              </>
            )}

            {section === "transcription" && (
              <>
                <Card>
                  <Row label="Speech model" desc={asr ? `${asr.description}` : "No speech model installed."}>{modelSelect("asr", "asrModel")}</Row>
                  <Row label="When to transcribe" desc="Live shows text during the meeting (processed in short chunks after each pause, a few seconds behind; not word-by-word streaming). After the meeting runs once on the full recording.">
                    <Select label="Transcription mode" value={settings.transcriptionMode ?? "live"} onChange={(v) => setSetting("transcriptionMode", v)} options={[{ value: "live", label: "Live (chunked)" }, { value: "after", label: "After the meeting" }]} />
                  </Row>
                  <Row label="Spoken language" desc="Auto uses your languages below. Mixed-language speech is kept as spoken, not translated, where the model allows.">
                    <Select label="Spoken language" value={settings.asrLanguage ?? "auto"} onChange={(v) => setSetting("asrLanguage", v)}
                      options={[{ value: "auto", label: "Auto (your languages)" }, ...(asr?.languages ?? Object.keys(LANGUAGES)).map((l) => ({ value: l, label: langName(l) }))]} className="w-[220px]" />
                  </Row>
                </Card>
                <Card title="Your languages">
                  <div className="py-3.5">
                    <div className="mb-2.5 text-[12.5px] text-ink-muted">Used for model recommendations and as language hints.</div>
                    <LanguagePicker />
                  </div>
                </Card>
              </>
            )}

            {section === "notes" && (
              <>
                <Card>
                  <Row label="Notes & chat model" desc="Writes enhanced notes and answers in Ask Grain. Runs locally with llama.cpp on the GPU.">{modelSelect("llm", "llmModel")}</Row>
                </Card>
                <Card title="Templates"><Templates /></Card>
              </>
            )}

            {section === "search" && (
              <Card>
                <Row label="Embedding model" desc="Optional. Enables search by meaning. Vectors are stored in Grain's local database.">{modelSelect("embed", "embedModel")}</Row>
                <Row label="Rebuild semantic index" desc="Re-index every meeting with the current embedding model.">
                  <Button size="sm" loading={indexing} disabled={!installed("embed").length} onClick={async () => { setIndexing(true); try { const n = await api.reindexSemantic(); toast(`Indexed ${n} passages`, "success"); } catch (e) { toast(String(e), "error"); } setIndexing(false); }}>Rebuild</Button>
                </Row>
              </Card>
            )}

            {section === "privacy" && (
              <>
                <div className="mt-5 flex gap-3 rounded-lg bg-paper-sunken p-4 text-[13px] leading-relaxed text-ink-muted">
                  <ShieldCheck className="mt-0.5 size-5 shrink-0" />
                  <div>Grain has no account, no telemetry and no cloud. Audio, transcripts, notes, embeddings and chats are stored only in the folder below. The only network requests Grain makes are model downloads you start in Models. The local AI runtime is started with networking disabled and only listens on 127.0.0.1.</div>
                </div>
                <Card title="Your data">
                  <Row label="Data folder" desc={<span className="selectable font-mono text-[11.5px]">{storage?.root}</span>}><Button size="sm" onClick={() => api.revealDataFolder()}>Show in Finder</Button></Row>
                  <Row label="Storage" desc={storage ? `Recordings ${fmtBytes(storage.recordings)} · Models ${fmtBytes(storage.models)} · Database ${fmtBytes(storage.database)}` : ""}><span /></Row>
                  <Row label="Keep audio after transcription" desc="Off: audio is deleted as soon as the transcript is saved. Deleting a meeting always deletes its audio.">
                    <Toggle label="Keep audio" checked={settings.keepAudio !== false} onChange={(v) => setSetting("keepAudio", v)} />
                  </Row>
                  <Row label="Find models other apps downloaded" desc="Grain looks (read-only, on this Mac) in the Hugging Face cache used by Handy, Ollama, LM Studio, llama.cpp, Jan, GPT4All and /Users/Shared, so it never downloads a model twice. Found files are checked with SHA-256 and shared without extra disk space; the originals are never changed.">
                    <Toggle label="Find models other apps downloaded" checked={settings.scanOtherApps !== false} onChange={async (v) => { await setSetting("scanOtherApps", v); await api.rescanLocalModels(); refreshCatalog(); }} />
                  </Row>
                  <Row label="Also look in these folders" desc={<>{((settings.modelFolders as string[]) ?? []).map((f) => (
                      <span key={f} className="mr-1.5 mt-1 inline-flex items-center gap-1 rounded-sm bg-paper-sunken px-1.5 py-0.5 font-mono text-[11px]">{f}
                        <button aria-label={`Stop looking in ${f}`} onClick={async () => { await setSetting("modelFolders", ((settings.modelFolders as string[]) ?? []).filter((x) => x !== f)); await api.rescanLocalModels(); refreshCatalog(); }}>×</button></span>
                    ))}{!((settings.modelFolders as string[]) ?? []).length && "Sharing this Mac? Put model files in /Users/Shared and every account's Grain finds them."}</>}>
                    <Button size="sm" onClick={async () => { const f = await openFolder(); if (!f) return; await setSetting("modelFolders", [...new Set([...(((settings.modelFolders as string[]) ?? [])), f])]); await api.rescanLocalModels(); refreshCatalog(); }}>Add folder…</Button>
                  </Row>
                  <Row label="Delete all meetings" desc="Removes every meeting, note, transcript, recording and chat. Models are kept.">
                    <Button size="sm" variant="danger" onClick={async () => {
                      if (!(await confirm("Delete all meetings, notes, transcripts, recordings and chats from this Mac? This cannot be undone.", { title: "Delete all data", okLabel: "Delete everything" }))) return;
                      try { await api.deleteAllData(false); await refreshMeetings(); refreshStorage(); toast("All meeting data deleted", "success"); } catch (e) { toast(String(e), "error"); }
                    }}>Delete all</Button>
                  </Row>
                  <Row label="Delete all data and models" desc="Also removes downloaded models.">
                    <Button size="sm" variant="danger" onClick={async () => {
                      if (!(await confirm("Delete all meetings and all downloaded models? This cannot be undone.", { title: "Delete everything", okLabel: "Delete everything" }))) return;
                      try { await api.deleteAllData(true); await refreshMeetings(); await refreshCatalog(); refreshStorage(); toast("Everything deleted", "success"); } catch (e) { toast(String(e), "error"); }
                    }}>Delete everything</Button>
                  </Row>
                </Card>
                <Card title="Recording consent">
                  <div className="py-3.5 text-[12.5px] leading-relaxed text-ink-muted">Recording laws differ between countries and states. Some require everyone's consent. Tell participants you are recording and stop if anyone objects. Grain shows a recording indicator in the window and the menu bar whenever it records, and only records after you press Record.</div>
                </Card>
              </>
            )}

            {section === "shortcuts" && (
              <Card>{shortcuts.map(([k, v]) => <Row key={k} label={v}><Kbd>{k}</Kbd></Row>)}</Card>
            )}

            {section === "about" && (
              <Card>
                <Row label="Grain" desc="Version 0.1.0 · MIT licence">{hardware && <span className="text-[12px] text-ink-subtle">{hardware.os} {hardware.osVersion} · {hardware.arch}</span>}</Row>
                <Row label="Speech recognition" desc="transcribe.cpp (MIT) on ggml with Metal. Model catalogue from Handy (MIT)."><span /></Row>
                <Row label="Language models" desc="llama.cpp (MIT) llama-server, bundled. Models: Qwen3 family (Apache-2.0)."><span /></Row>
                <Row label="Model licences" desc="Each model has its own licence, shown in Models. Some (e.g. CC-BY-NC) restrict commercial use."><span /></Row>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
