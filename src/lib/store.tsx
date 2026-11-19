import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, on, type CatalogModel, type Hardware, type Meeting, type Settings, type Storage } from "./api";

export type Route =
  | { name: "home" }
  | { name: "meeting"; id: string; tab?: Tab; at?: number }
  | { name: "chat"; threadId?: string; ask?: string }
  | { name: "actions" }
  | { name: "models"; role?: "asr" | "llm" | "embed" }
  | { name: "settings"; section?: string };

export type Tab = "notes" | "enhanced" | "transcript";

export type RecordingState = {
  meetingId: string;
  paused: boolean;
  elapsed: number;
  mic: number;
  system: number;
  micOn: boolean;
  systemOn: boolean;
  micDevice: string;
  warnings: string[];
};

export type DownloadState = { state: string; downloaded?: number; total?: number; bytesPerSec?: number; error?: string };
export type Toast = { id: number; text: string; kind: "info" | "error" | "success"; action?: { label: string; run: () => void } };

type Ctx = {
  ready: boolean;
  settings: Settings;
  setSetting: (k: string, v: unknown) => Promise<void>;
  hardware: Hardware | null;
  storage: Storage | null;
  refreshStorage: () => void;
  meetings: { meeting: Meeting; preview: string }[];
  refreshMeetings: () => Promise<void>;
  recording: RecordingState | null;
  processing: Record<string, string>;
  catalog: CatalogModel[];
  refreshCatalog: () => Promise<void>;
  downloads: Record<string, DownloadState>;
  route: Route;
  navigate: (r: Route, replace?: boolean) => void;
  back: () => void;
  toasts: Toast[];
  toast: (text: string, kind?: Toast["kind"], action?: Toast["action"]) => void;
  dismiss: (id: number) => void;
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  newMeeting: (startRecording?: boolean) => Promise<void>;
  startRecording: (meetingId: string) => Promise<boolean>;
};

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>({});
  const [hardware, setHardware] = useState<Hardware | null>(null);
  const [storage, setStorage] = useState<Storage | null>(null);
  const [meetings, setMeetings] = useState<{ meeting: Meeting; preview: string }[]>([]);
  const [recording, setRecording] = useState<RecordingState | null>(null);
  const [processing, setProcessing] = useState<Record<string, string>>({});
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [history, setHistory] = useState<Route[]>([{ name: "home" }]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const toastId = useRef(0);

  const toast = useCallback((text: string, kind: Toast["kind"] = "info", action?: Toast["action"]) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text, kind, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 9000 : 4500);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const refreshMeetings = useCallback(async () => setMeetings(await api.listMeetings()), []);
  const refreshCatalog = useCallback(async () => setCatalog(await api.listCatalog()), []);
  const refreshStorage = useCallback(() => void api.storage().then(setStorage), []);

  const setSetting = useCallback(async (k: string, v: unknown) => {
    setSettings((s) => ({ ...s, [k]: v }));
    await api.setSetting(k, v);
  }, []);

  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return; // StrictMode runs effects twice in development
    booted.current = true;
    api.bootstrap().then(async (b) => {
      setSettings(b.settings);
      setHardware(b.hardware);
      setStorage(b.storage);
      await Promise.all([refreshMeetings(), refreshCatalog()]);
      if (b.initialRoute) {
        (window as any).__grainUi = b.initialRoute.ui ?? {}; // screenshot-audit hook (GRAIN_ROUTE only)
        if (b.initialRoute.onboarding) setSettings((s) => ({ ...s, onboardingDone: false }));
        else setHistory([{ name: "home" }, b.initialRoute]);
        if (b.initialRoute.search) { setSearchOpen(true); }
        if (b.initialRoute.record) api.startRecording(b.initialRoute.id, "none", true).catch((e) => toast(String(e), "error"));
      }
      if (b.e2e) {
        (window as any).__grainE2E = b.e2e;
        setTimeout(() => import("../e2e/runner").then((m) => m.run()), 300); // GUI end-to-end runner (GRAIN_E2E=1 only)
      }
      if (b.recording) setRecording({ meetingId: b.recording, paused: false, elapsed: 0, mic: 0, system: 0, micOn: true, systemOn: true, micDevice: "", warnings: [] });
      setReady(true);
      const recovered = b.settings.recoveredMeetings as string[] | undefined;
      if (recovered?.length) {
        toast(`${recovered.length === 1 ? "A recording was" : `${recovered.length} recordings were`} interrupted. The audio was kept and can be transcribed.`, "info");
        api.setSetting("recoveredMeetings", null);
      }
    });
  }, []);

  useEffect(() => {
    const offs = [
      on<any>("capture", (e) => {
        if (e.event === "started") {
          setRecording({ meetingId: e.meetingId, paused: false, elapsed: (e.offsetMs ?? 0) / 1000, mic: 0, system: 0, micOn: !!e.mic, systemOn: !!e.system, micDevice: e.micDevice ?? "", warnings: e.errors ?? [] });
        } else if (e.event === "level") {
          setRecording((r) => (r ? { ...r, elapsed: e.elapsed, mic: e.mic ?? 0, system: e.system ?? 0, paused: !!e.paused } : r));
        } else if (e.event === "paused" || e.event === "resumed") {
          setRecording((r) => (r ? { ...r, paused: e.event === "paused" } : r));
        } else if (e.event === "device_changed") {
          setRecording((r) => (r ? { ...r, micDevice: e.device } : r));
          toast(`Microphone switched to ${e.device}`);
        } else if (e.event === "device_lost") {
          toast(`${e.device} disconnected — switching to the default microphone`, "error");
        } else if (e.event === "error") {
          toast(e.source === "system" ? `System audio stopped: ${e.message}` : `Microphone: ${e.message}`, "error");
        } else if (e.event === "stopped") {
          setRecording(null);
        }
      }),
      on<any>("meeting-status", (e) => {
        setProcessing((p) => {
          const n = { ...p };
          if (e.status === "processing") n[e.meetingId] = "Finishing transcript…";
          else delete n[e.meetingId];
          return n;
        });
        if (e.status !== "processing") setRecording((r) => (r?.meetingId === e.meetingId ? null : r));
        if (e.status === "interrupted") toast("The recording stopped unexpectedly. Audio up to that point was saved.", "error");
        if (e.error) toast(e.error, "error");
        refreshMeetings();
      }),
      on<any>("transcription-status", (e) => {
        if (e.state === "running") setProcessing((p) => ({ ...p, [e.meetingId]: `Transcribing… ${Math.round((e.progress ?? 0) * 100)}%` }));
        if (e.state === "done" || e.state === "error")
          setProcessing((p) => {
            const n = { ...p };
            delete n[e.meetingId];
            return n;
          });
        if (e.state === "error" || e.state === "unavailable") toast(e.error ?? "Transcription failed", "error");
      }),
      on<any>("model-download", (e) => {
        setDownloads((d) => ({ ...d, [e.id]: e }));
        if (e.state === "ready" || e.state === "failed" || e.state === "cancelled") {
          refreshCatalog();
          refreshStorage();
          api.bootstrap().then((b) => setSettings(b.settings));
          if (e.state === "failed") toast(e.error ?? "Download failed", "error");
        }
      }),
      on<any>("settings-changed", (e) => setSettings((s) => ({ ...s, ...e }))),
      on<any>("local-models", () => refreshCatalog()),
      on<any>("llm-status", (e) => {
        if (e.warning) toast(e.warning, "info");
      }),
    ];
    return () => offs.forEach((f) => f());
  }, []);

  const route = history[history.length - 1];
  const navigate = useCallback((r: Route, replace?: boolean) => setHistory((h) => (replace ? [...h.slice(0, -1), r] : [...h.slice(-30), r])), []);
  const back = useCallback(() => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h)), []);

  const startRecording = useCallback(
    async (meetingId: string) => {
      try {
        const perms = await api.permissions();
        const wantSystem = settings.captureSystem !== false;
        const micOff = settings.micDevice === "none";
        if (micOff && !wantSystem) {
          toast("Both the microphone and computer audio are off. Turn one on in Settings › Audio.", "error", { label: "Open", run: () => navigate({ name: "settings", section: "audio" }) });
          return false;
        }
        if (perms.mic === "not_determined" && !micOff) await api.requestPermission("mic");
        if (wantSystem && perms.screen !== "granted") {
          const p = await api.requestPermission("screen");
          if (p.screen !== "granted") toast("System audio needs Screen & System Audio Recording permission. Recording your microphone only.", "error", { label: "Open Settings", run: () => api.openPrivacySettings("screen") });
        }
        const after = await api.permissions();
        if (!micOff && after.mic === "denied" && !(wantSystem && after.screen === "granted")) {
          toast("Grain can't access the microphone.", "error", { label: "Open Settings", run: () => api.openPrivacySettings("mic") });
          return false;
        }
        await api.startRecording(meetingId, !micOff && after.mic === "granted" ? (settings.micDevice ?? null) : "none", wantSystem && after.screen === "granted");
        refreshMeetings();
        return true;
      } catch (err) {
        toast(String(err), "error");
        return false;
      }
    },
    [settings, toast, navigate],
  );

  const newMeeting = useCallback(
    async (start = false) => {
      if (recording && start) {
        toast("Already recording a meeting.", "info");
        navigate({ name: "meeting", id: recording.meetingId });
        return;
      }
      const m = await api.createMeeting();
      await refreshMeetings();
      navigate({ name: "meeting", id: m.id, tab: "notes" });
      if (start) await startRecording(m.id);
    },
    [recording, startRecording],
  );

  const value = useMemo<Ctx>(
    () => ({ ready, settings, setSetting, hardware, storage, refreshStorage, meetings, refreshMeetings, recording, processing, catalog, refreshCatalog, downloads, route, navigate, back, toasts, toast, dismiss, searchOpen, setSearchOpen, newMeeting, startRecording }),
    [ready, settings, hardware, storage, meetings, recording, processing, catalog, downloads, route, toasts, searchOpen, newMeeting, startRecording],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
