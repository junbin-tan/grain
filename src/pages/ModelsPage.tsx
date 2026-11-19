import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, CircleHelp, Download, FilePlus2, HardDrive, Laptop, RefreshCw, Search, Trash2, X } from "lucide-react";
import { openFile } from "../lib/dialogs";
import { api, type CatalogModel, type FoundModel, type Recommendation } from "../lib/api";
import { fmtBytes, grade, langName, speedLevel } from "../lib/format";
import { useApp } from "../lib/store";
import { Badge, Button, IconButton, Progress, Toggle } from "../components/ui";

// Quantisations from smallest to largest, with a plain-language hint.
// The quant a user picked survives re-renders and section moves.
const quantChoice = new Map<string, string>();

const QUANT_HINT: Record<string, string> = { Q4_K_M: "smallest", Q5_K_M: "small", Q6_K: "balanced", Q8_0: "default", F16: "full precision", BF16: "full precision" };

type Role = "asr" | "llm" | "embed";
const ROLES: { id: Role; label: string; blurb: string; setting: string }[] = [
  { id: "asr", label: "Transcription", blurb: "Speech-to-text models turn meeting audio into a transcript.", setting: "asrModel" },
  { id: "llm", label: "Notes & chat", blurb: "A language model writes enhanced notes and answers questions about your meetings.", setting: "llmModel" },
  { id: "embed", label: "Search by meaning", blurb: "Optional. An embedding model lets search and Ask Grain find related passages, not just exact words.", setting: "embedModel" },
];

const GRADE_TONE: Record<string, string> = { A: "bg-[#dfeccf] text-[#2f5a1f]", B: "bg-[#e8efd5] text-[#4d6420]", C: "bg-[#f4ecd0] text-[#7a6214]", D: "bg-[#f6e0cc] text-[#8a4b14]", F: "bg-[#f6d9d4] text-[#933226]" };

function Grade({ m, lang }: { m: CatalogModel; lang: string }) {
  const err = m.accuracy[lang];
  const g = grade(err);
  if (!g) return <span className="text-[12px] text-ink-3" title="No published benchmark for this language">–</span>;
  return <span title={`${err.toFixed(1)}% error on FLEURS (${langName(lang)}), published by transcribe.cpp`} className={`inline-grid h-5 w-6 place-items-center rounded-[5px] text-[11.5px] font-semibold ${GRADE_TONE[g]}`}>{g}</span>;
}

function Speed({ m }: { m: CatalogModel }) {
  const l = speedLevel(m.speed);
  if (!l) return <span className="text-[12px] text-ink-3">–</span>;
  return (
    <span className="flex gap-[3px]" title={`${m.speed?.toFixed(1)}× real-time on the published reference machine (not measured on this Mac)`}>
      {[1, 2, 3, 4].map((i) => <span key={i} className={`size-[6px] rounded-full ${i <= l ? "bg-ink-2" : "bg-line-strong"}`} />)}
    </span>
  );
}

function Row({ m, active, recommended, reason, lang, ramGb, langs }: { m: CatalogModel; active: boolean; recommended: boolean; reason?: string; lang: string; ramGb: number; langs: string[] }) {
  const { downloads, setSetting, refreshCatalog, toast, recording } = useApp();
  const [asking, setAsking] = useState(false);
  const [quant, setQuantState] = useState<string>(quantChoice.get(m.id) ?? m.partialQuant ?? m.found?.quant ?? m.quant);
  const setQuant = (q: string) => { quantChoice.set(m.id, q); setQuantState(q); };
  useEffect(() => { const q = m.partialQuant ?? m.found?.quant; if (q && !quantChoice.has(m.id)) setQuantState(q); }, [m.partialQuant, m.found?.quant]);
  const chosen = m.quants.find((q) => q.quant === quant);
  const size = m.status === "ready" ? m.installedSize ?? m.size : downloads[m.id]?.total ?? chosen?.size ?? m.size;
  const missingLangs = m.role === "asr" && !m.custom ? langs.filter((l) => !m.languages.includes(l)) : [];
  const d = downloads[m.id];
  // The catalogue status from the backend wins over a possibly stale progress event.
  const downloading = m.status !== "ready" && (m.status === "downloading" || d?.state === "downloading" || d?.state === "verifying");
  const installed = m.status === "ready";
  const pct = d?.total ? (d.downloaded ?? 0) / d.total : m.partialBytes / size;
  const tight = ramGb > 0 && m.minRamGb > ramGb;
  const role = ROLES.find((r) => r.id === m.role)!;
  const caps = m.capabilities;

  const use = async () => {
    if (!installed || active) return;
    await setSetting(role.setting, m.id);
    toast(`${m.name} is now used for ${role.label.toLowerCase()}`, "success");
  };

  return (
    <div role="button" tabIndex={0} onClick={use} onKeyDown={(e) => e.key === "Enter" && use()}
      className={`group grid grid-cols-[22px_1fr_44px_54px_72px_120px] items-center gap-3 border-b border-line px-3 py-2.5 last:border-0 ${installed && !active ? "cursor-pointer hover:bg-paper" : ""} ${active ? "bg-[#f7f9f3]" : ""}`}>
      <span className={`grid size-[18px] place-items-center rounded-full border ${active ? "border-accent bg-accent text-white" : installed ? "border-line-strong" : "border-transparent"}`}>
        {active && <Check className="size-3" />}
        {!installed && !downloading && <Download className="size-3.5 text-ink-3" />}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13.5px] font-medium text-ink">{m.name}</span>
          {recommended && <Badge tone="accent">Recommended</Badge>}
          {caps.streaming && <Badge>Streaming</Badge>}
          {caps.translate && <Badge>Translate</Badge>}
          {m.role === "llm" && m.thinking && <Badge>Thinking off</Badge>}
          {m.custom && <Badge>{m.origin?.source && m.origin.source !== "A file you added" ? `From ${m.origin.source}` : "Imported"}</Badge>}
          {!installed && m.found && <Badge tone="accent" className="!gap-1"><Laptop className="size-3" />On this Mac · {m.found.source}</Badge>}
          {installed && m.installedQuant && m.quants.length > 1 && <Badge>{m.installedQuant}</Badge>}
          {!m.curated && <Badge tone="warn">Experimental</Badge>}
          {tight && <Badge tone="warn" className="!gap-1"><AlertTriangle className="size-3" />Needs ~{m.minRamGb} GB RAM</Badge>}
          {m.status === "missing" && <Badge tone="rec">File missing</Badge>}
        </div>
        <div className="mt-0.5 truncate text-[12px] text-ink-2">{reason ?? m.description}</div>
        {installed && m.origin && !m.custom && <div className="mt-0.5 text-[11.5px] text-ink-3">From {m.origin.source} · {m.origin.how === "clone" ? "shared copy, no extra disk space" : m.origin.how === "reference" ? "used where it is" : "copied"}</div>}
        {missingLangs.length > 0 && <div className="mt-0.5 text-[11.5px] text-warn">Doesn't support {missingLangs.map(langName).join(", ")}</div>}
        {m.role === "asr" && !m.custom && (
          <div className="mt-0.5 truncate text-[11.5px] text-ink-3" title={m.languages.map(langName).join(", ")}>
            {m.languages.length > 6 ? `${m.languages.length} languages: ${m.languages.slice(0, 6).map(langName).join(", ")}…` : m.languages.map(langName).join(", ")} · {m.params} · {m.license}
          </div>
        )}
        {m.role !== "asr" && !m.custom && <div className="mt-0.5 text-[11.5px] text-ink-3">{m.params} · {m.quant} · {m.license} · {m.repo}</div>}
        {m.custom && <div className="mt-0.5 truncate text-[11.5px] text-ink-3">{m.filename}{m.quant && ` · ${m.quant}`}</div>}
        {!installed && !downloading && m.quants.length > 1 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <span className="mr-0.5 text-[11.5px] text-ink-3">Size:</span>
            {[...m.quants].sort((a, b) => a.size - b.size).map((q) => (
              <button key={q.quant} onClick={() => setQuant(q.quant)} title={`${q.quant}: ${QUANT_HINT[q.quant] ?? ""}. Smaller files use less memory and can be slightly less accurate.`}
                className={`h-5 rounded-[5px] px-1.5 text-[11px] whitespace-nowrap tabular-nums ${quant === q.quant ? "bg-ink text-white" : "bg-wash text-ink-2 hover:bg-line"}`}>
                {q.quant} · {fmtBytes(q.size)}
              </button>
            ))}
          </div>
        )}
        {downloading && (
          <div className="mt-1.5 flex items-center gap-2">
            <Progress value={pct} className="w-[220px]" />
            <span className="text-[11.5px] text-ink-3 tabular-nums">
              {d?.state === "verifying" ? "Verifying…" : `${Math.round(pct * 100)}% of ${fmtBytes(d?.total ?? size)}${d?.bytesPerSec ? ` · ${fmtBytes(d.bytesPerSec)}/s` : ""}`}
            </span>
          </div>
        )}
        {!downloading && !installed && m.partialBytes > 0 && <div className="mt-1 text-[11.5px] text-ink-3">Paused at {Math.round((m.partialBytes / size) * 100)}%{m.partialQuant && ` (${m.partialQuant})`}. Download resumes where it stopped.</div>}
        {d?.state === "failed" && <div className="mt-1 text-[11.5px] text-rec">{d.error}</div>}
      </div>
      <span>{m.role === "asr" && <Grade m={m} lang={lang} />}</span>
      <span>{m.role === "asr" && <Speed m={m} />}</span>
      <span className="text-right text-[12px] text-ink-2 tabular-nums">{fmtBytes(size)}</span>
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {asking ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
            <Button size="sm" variant="danger" onClick={async () => {
              setAsking(false);
              try { await api.deleteModel(m.id); await refreshCatalog(); toast(`Deleted ${m.name}`); } catch (e) { toast(String(e), "error"); }
            }}>Delete</Button>
          </>
        ) : downloading ? (
          <IconButton label={`Cancel download of ${m.name}`} onClick={() => api.cancelDownload(m.id)}><X className="size-4" /></IconButton>
        ) : installed ? (
          <>
            {!active && <Button size="sm" onClick={use}>Use</Button>}
            <IconButton label={`Delete ${m.name}`} disabled={!!recording && active && m.role === "asr"} className="opacity-50 group-hover:opacity-100" onClick={() => setAsking(true)}><Trash2 className="size-3.5" /></IconButton>
          </>
        ) : (
          m.found && m.found.quant === quant ? (
            <Button size="sm" variant="primary" title={`Already on this Mac (${m.found.source}). Checked with SHA-256, then shared with no extra disk space.`}
              onClick={async () => { try { await api.downloadModel(m.id, m.found!.quant, true); refreshCatalog(); } catch (e) { toast(String(e), "error"); } }}>
              Use — no download
            </Button>
          ) : (
            <Button size="sm" title="Downloads, verifies, then switches to this model" onClick={async () => { try { await api.downloadModel(m.id, quant, true); refreshCatalog(); } catch (e) { toast(String(e), "error"); } }}>
              {m.partialBytes > 0 && m.partialQuant === quant ? "Resume" : "Download"}
            </Button>
          )
        )}
      </div>
    </div>
  );
}

function Table({ title, models, ...rest }: { title: string; models: CatalogModel[]; activeId?: string; rec: Recommendation | null; lang: string; ramGb: number; langs: string[] }) {
  if (models.length === 0) return null;
  return (
    <section className="mt-6">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <h2 className="text-[12.5px] font-semibold text-ink-2">{title}</h2>
      </div>
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-raised">
        {models.map((m) => (
          <Row key={m.id} m={m} active={m.id === rest.activeId} recommended={!!rest.rec && (rest.rec.asr[0] === m.id || rest.rec.llm === m.id || rest.rec.embed === m.id)}
            reason={rest.rec?.reasons[m.id]} lang={rest.lang} ramGb={rest.ramGb} langs={rest.langs} />
        ))}
      </div>
    </section>
  );
}

/** Models that are not in Grain's catalogue but another app already downloaded (e.g. LM Studio). */
function OthersTable({ others, onUsed }: { others: FoundModel[]; onUsed: () => void }) {
  const { toast, refreshCatalog } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  if (!others.length) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-1.5 px-1 text-[12.5px] font-semibold text-ink-2">Other models found on this Mac</h2>
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-raised">
        {others.map((o) => (
          <div key={o.path} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-0">
            <Laptop className="size-4 shrink-0 text-ink-3" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5"><span className="text-[13.5px] font-medium">{o.name ?? o.path.split("/").pop()}</span><Badge tone="accent">{o.source}</Badge>{o.arch && <Badge>{o.arch}</Badge>}</div>
              <div className="mt-0.5 truncate text-[11.5px] text-ink-3" title={o.path}>{o.path.split("/").pop()} · not tested with Grain; checked when first used</div>
            </div>
            <span className="text-[12px] text-ink-2 tabular-nums">{fmtBytes(o.size)}</span>
            <Button size="sm" loading={busy === o.path} onClick={async () => {
              setBusy(o.path);
              try { await api.useFoundModel(o.role!, o.path, o.source); await refreshCatalog(); onUsed(); toast(`Using ${o.name ?? "the model"} from ${o.source}`, "success"); } catch (e) { toast(String(e), "error"); } finally { setBusy(null); }
            }}>Use</Button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ModelsPage({ role: initialRole }: { role?: Role }) {
  const { catalog, settings, hardware, storage, refreshStorage, refreshCatalog, toast } = useApp();
  const [role, setRole] = useState<Role>(initialRole ?? "asr");
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const [mine, setMine] = useState(false);
  const [others, setOthers] = useState<FoundModel[]>([]);
  const [scanning, setScanning] = useState(false);
  const rescan = async () => {
    setScanning(true);
    try { setOthers(await api.rescanLocalModels()); await refreshCatalog(); } finally { setScanning(false); }
  };
  useEffect(() => { rescan(); }, []);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [legend, setLegend] = useState(false);
  const langs: string[] = settings.languages ?? ["en"];
  const lang = langs[0] ?? "en";
  const ramGb = hardware?.totalRamGb ?? 0;

  useEffect(() => { if (initialRole) setRole(initialRole); }, [initialRole]);
  useEffect(() => {
    const d = (window as any).__grainUi?.download; // screenshot-audit hook (GRAIN_ROUTE only)
    if (d) { (window as any).__grainUi.download = null; api.downloadModel(d.id, d.quant, true).then(refreshCatalog); }
  }, []);
  useEffect(() => { api.recommend(langs).then(setRec); refreshStorage(); refreshCatalog(); }, [settings.languages]);

  const meta = ROLES.find((r) => r.id === role)!;
  const activeId = settings[meta.setting];
  const { installed, recommended, rest } = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = catalog
      .filter((m) => m.role === role)
      .filter((m) => !needle || m.name.toLowerCase().includes(needle) || m.description.toLowerCase().includes(needle) || m.languages.some((l) => l === needle || langName(l).toLowerCase().includes(needle)));
    // Rows stay where they are while downloading; they move to "Installed" only once installed.
    const inst = list.filter((m) => m.status === "ready" || m.status === "missing");
    const foundFirst = (a: CatalogModel, b: CatalogModel) => Number(!!b.found) - Number(!!a.found);
    const recIds = role === "asr" ? rec?.asr ?? [] : role === "llm" ? [rec?.llm] : [rec?.embed];
    const recd = list.filter((m) => recIds.includes(m.id) && !inst.includes(m)).sort((a, b) => foundFirst(a, b) || recIds.indexOf(a.id) - recIds.indexOf(b.id));
    const covers = (m: CatalogModel) => role !== "asr" || langs.every((l) => m.languages.includes(l));
    const others = list
      .filter((m) => !inst.includes(m) && !recd.includes(m))
      .filter((m) => all || m.curated || !!needle || !!m.found)
      .filter((m) => !mine || covers(m))
      // Models covering your languages first, then by published accuracy for your main language.
      .sort((a, b) => foundFirst(a, b) || Number(covers(b)) - Number(covers(a)) || (a.accuracy[lang] ?? 99) - (b.accuracy[lang] ?? 99));
    return { installed: inst, recommended: recd, rest: others };
  }, [catalog, role, q, all, mine, rec, settings.languages]);

  const importFile = async () => {
    const path = await openFile([{ name: "GGUF model", extensions: ["gguf"] }]);
    if (!path) return;
    try {
      await api.importModel(role, path);
      await refreshCatalog();
      refreshStorage();
      toast("Model added", "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="drag h-[52px] shrink-0" />
      <div className="scroll-y flex-1">
        <div className="mx-auto max-w-[860px] px-8 pb-20">
          <h1 className="font-serif text-[30px] font-semibold">Models</h1>
          <p className="mt-1 text-[13px] text-ink-2">Everything runs on this Mac. Models are downloaded once from Hugging Face, checked against a SHA-256 hash, and then work offline.</p>

          <div className="mt-5 flex items-center gap-1 border-b border-line">
            {ROLES.map((r) => (
              <button key={r.id} onClick={() => setRole(r.id)} className={`relative h-9 px-3 text-[13px] font-medium ${role === r.id ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}>
                {r.label}{role === r.id && <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-ink" />}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[12.5px] text-ink-2">{meta.blurb}</p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={role === "asr" ? "Search by name or language (e.g. Cantonese)" : "Search models"}
                className="h-8 w-full rounded-[8px] border border-line bg-raised pr-2 pl-8 text-[13px] outline-none placeholder:text-ink-3 focus:border-line-strong" />
            </div>
            {role === "asr" && (
              <>
                <label className="flex items-center gap-2 text-[12.5px] text-ink-2" title="Only models that support every language you picked">My languages only <Toggle checked={mine} onChange={setMine} label="My languages only" /></label>
                <label className="flex items-center gap-2 text-[12.5px] text-ink-2" title="Include experimental and specialised models">Show all <Toggle checked={all} onChange={setAll} label="Show all models" /></label>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={importFile} title="Add a .gguf model file you already have"><FilePlus2 className="size-3.5" />Add model file…</Button>
            <IconButton label="Look again for models other apps downloaded" onClick={rescan}><RefreshCw className={`size-4 ${scanning ? "animate-spin" : ""}`} /></IconButton>
            {role === "asr" && (
              <div className="relative">
                <IconButton label="How grades and speed are measured" onClick={() => setLegend((v) => !v)}><CircleHelp className="size-4" /></IconButton>
                {legend && (
                  <div className="absolute top-9 right-0 z-30 w-[330px] animate-rise rounded-[12px] border border-line bg-raised p-3.5 text-[12px] leading-relaxed text-ink-2 shadow-[var(--shadow-pop)]">
                    <b className="text-ink">Accuracy</b> grade for {langName(lang)} from the error rate published by transcribe.cpp on the FLEURS test set (A ≤5%, B ≤9%, C ≤14%, D ≤22%, F &gt;22%).
                    <br /><b className="text-ink">Speed</b> is the published real-time factor on a reference laptop, not this Mac. Neither is a guarantee for your meetings.
                  </div>
                )}
              </div>
            )}
          </div>
          {role === "asr" && (
            <div className="mt-3 grid grid-cols-[22px_1fr_44px_54px_72px_120px] gap-3 px-3 text-[11px] font-medium tracking-[0.03em] text-ink-3 uppercase">
              <span /> <span>Model</span> <span title={`Accuracy for ${langName(lang)}`}>{lang}</span> <span>Speed</span> <span className="text-right">Size</span> <span />
            </div>
          )}

          {(() => {
            const fc = catalog.filter((m) => m.found && m.status !== "ready");
            const n = fc.length + others.length;
            if (!n) return null;
            const sources = [...new Set([...fc.map((m) => m.found!.source), ...others.map((o) => o.source)].map((s) => s.replace(/ \(.*\)$/, "")))];
            return (
              <div className="mt-4 flex items-center gap-2.5 rounded-[10px] bg-accent-soft px-3 py-2 text-[13px] text-[#2f4428]">
                <Laptop className="size-4 shrink-0" />
                <div className="flex-1">Found {n} model{n > 1 ? "s" : ""} already on this Mac ({sources.join(", ")}). Use them with no download and no extra disk space.</div>
              </div>
            );
          })()}
          <OthersTable others={others.filter((o) => o.role === role)} onUsed={rescan} />
          <Table title="Installed on this Mac" models={installed} activeId={activeId} rec={rec} lang={lang} ramGb={ramGb} langs={langs} />
          <Table title={role === "asr" ? `Recommended for ${langs.map(langName).join(" + ")}` : "Recommended for this Mac"} models={recommended} activeId={activeId} rec={rec} lang={lang} ramGb={ramGb} langs={langs} />
          <Table title={role === "asr" ? (all ? "All models" : "More models") : "Other models"} models={rest} activeId={activeId} rec={rec} lang={lang} ramGb={ramGb} langs={langs} />
          {role === "asr" && !all && <div className="mt-3 px-1 text-[12px] text-ink-3">{catalog.filter((m) => m.role === "asr" && !m.curated).length} more experimental and specialised models (Moonshine, Voxtral, Granite, GigaAM…) are hidden. Turn on “Show all” to see them.</div>}
          <div className="mt-3 px-1 text-[12px] text-ink-3">Have a model file already? <button className="underline" onClick={importFile}>Add a .gguf file</button> (transcribe.cpp GGUF for transcription, llama.cpp GGUF for notes and search).</div>

          {storage && (
            <div className="mt-8 flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-raised px-4 py-3 text-[12.5px] text-ink-2">
              <HardDrive className="size-4 text-ink-3" />
              <div className="flex-1">Models use <b className="text-ink">{fmtBytes(storage.models)}</b> · Recordings {fmtBytes(storage.recordings)} · Database {fmtBytes(storage.database)}{storage.freeDisk != null && ` · ${fmtBytes(storage.freeDisk)} free`}</div>
              <Button size="sm" variant="ghost" onClick={() => api.revealDataFolder()}>Show in Finder</Button>
            </div>
          )}
          {hardware && <div className="mt-2 px-1 text-[12px] text-ink-3">This Mac: {hardware.chip || hardware.arch} · {Math.round(hardware.totalRamGb)} GB memory · {hardware.gpu}</div>}
        </div>
      </div>
    </div>
  );
}
