// Typed wrappers over Grain's Tauri commands. All processing happens in the
// local Rust backend; nothing here talks to the network.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Meeting = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number;
  status: "draft" | "recording" | "paused" | "processing" | "done" | "interrupted";
  templateId: string;
  folder: string | null;
  language: string | null;
  metadata: Record<string, unknown>;
};

export type Segment = {
  id: number;
  meetingId: string;
  source: "mic" | "system";
  speaker: string | null;
  startMs: number;
  endMs: number;
  text: string;
  originalText: string;
  language: string | null;
  modelId: string;
  status: string;
  edited: boolean;
};

export type Note = {
  id: number;
  meetingId: string;
  kind: "manual" | "enhanced";
  version: number;
  content: string;
  structured: any | null;
  modelId: string | null;
  templateId: string | null;
  createdAt: number;
};

export type ActionItem = {
  id: number;
  meetingId: string;
  description: string;
  owner: string | null;
  deadline: string | null;
  kind: "commitment" | "suggestion";
  status: "open" | "done";
  verified: boolean;
  evidence: number[];
  createdAt: number;
};

export type Mark = { id: number; meetingId: string; atMs: number; label: string };
export type Recording = { id: string; meetingId: string; source: string; path: string; sampleRate: number; durationMs: number; status: string };

export type MeetingDetail = {
  meeting: Meeting;
  manual: Note | null;
  enhanced: Note | null;
  enhancedVersions: { version: number; createdAt: number; modelId: string | null; templateId: string | null }[];
  segments: Segment[];
  actionItems: ActionItem[];
  marks: Mark[];
  recordings: Recording[];
};

export type CatalogModel = {
  id: string;
  name: string;
  description: string;
  role: "asr" | "llm" | "embed";
  family: string;
  params: string;
  languages: string[];
  license: string;
  repo: string;
  filename: string;
  quant: string;
  size: number;
  sha256: string;
  curated: boolean;
  capabilities: { streaming?: boolean; translate?: boolean; languageDetection?: boolean; timestamps?: boolean };
  accuracy: Record<string, number>;
  speed: number | null;
  minRamGb: number;
  ctx: number;
  thinking: boolean;
  recommended: boolean;
  status: "available" | "downloading" | "ready" | "missing";
  partialBytes: number;
  partialQuant?: string | null;
  installedQuant?: string | null;
  installedSize?: number;
  quants: { quant: string; filename: string; size: number; sha256: string }[];
  custom?: boolean;
  /** A copy another app already downloaded (verified by SHA-256 before use). */
  found?: { quant: string; source: string; size: number; path: string };
  /** Where an installed model came from: clone/reference of another app's file, or a download. */
  origin?: { source: string; how: "clone" | "reference" | "copy"; from: string } | null;
};
export type FoundModel = { path: string; size: number; source: string; modelId: string | null; quant: string | null; hashNamed: boolean; arch: string | null; name: string | null; role: "asr" | "llm" | "embed" | null };

export type Hardware = {
  os: string;
  osVersion: string;
  arch: string;
  chip: string;
  appleSilicon: boolean;
  gpu: string;
  totalRamGb: number;
  availableRamGb: number;
  freeDiskGb: number;
  cpuCores: number;
  supported: boolean;
  notes: string[];
};

export type Template = { id: string; name: string; instructions: string; builtin: boolean };
export type Source = { n: number; meetingId: string; meetingTitle: string; meetingDate: number; kind: string; refId: number; startMs: number | null; excerpt: string };
export type ChatMessage = { id: number; threadId: string; role: "user" | "assistant"; content: string; sources: Source[]; createdAt: number };
export type SearchHit = { meetingId: string; meetingTitle: string; meetingDate: number; kind: string; refId: number; startMs: number | null; snippet: string; text: string; score: number };
export type Recommendation = { asr: string[]; llm: string; embed: string; reasons: Record<string, string> };
export type Permissions = { mic: "granted" | "denied" | "restricted" | "not_determined"; screen: "granted" | "not_granted" };
export type Device = { uid: string; name: string; default: boolean };
export type Storage = { models: number; recordings: number; database: number; root: string; freeDisk: number | null };
export type Settings = Record<string, any>;

export const api = {
  bootstrap: () => invoke<{ settings: Settings; hardware: Hardware; storage: Storage; recording: string | null; initialRoute: any | null; e2e: { phase: string; exportDir: string | null; importFile: string | null } | null }>("bootstrap"),
  setSetting: (key: string, value: unknown) => invoke<void>("set_setting", { key, value }),
  listMeetings: () => invoke<{ meeting: Meeting; preview: string }[]>("list_meetings"),
  createMeeting: (title?: string, templateId?: string) => invoke<Meeting>("create_meeting", { title, templateId }),
  meetingDetail: (id: string) => invoke<MeetingDetail>("meeting_detail", { id }),
  enhancedVersion: (id: string, version: number) => invoke<Note | null>("enhanced_version", { id, version }),
  updateMeeting: (id: string, patch: Record<string, unknown>) => invoke<Meeting>("update_meeting", { id, patch }),
  deleteMeeting: (id: string) => invoke<void>("delete_meeting", { id }),
  deleteAudio: (id: string) => invoke<void>("delete_audio", { id }),
  saveManualNote: (id: string, content: string) => invoke<void>("save_manual_note", { id, content }),
  saveEnhancedNote: (id: string, content: string) => invoke<void>("save_enhanced_note", { id, content }),
  updateSegment: (id: number, text: string) => invoke<void>("update_segment", { id, text }),
  addMark: (meetingId: string, atMs: number, label: string) => invoke<Mark>("add_mark", { meetingId, atMs, label }),
  listActionItems: () => invoke<{ item: ActionItem; meetingTitle: string | null; meetingDate: number | null }[]>("list_action_items"),
  setActionStatus: (id: number, status: "open" | "done") => invoke<void>("set_action_status", { id, status }),
  permissions: () => invoke<Permissions>("capture_permissions"),
  requestPermission: (kind: "mic" | "screen") => invoke<Permissions>("request_permission", { kind }),
  devices: () => invoke<Device[]>("list_devices"),
  startRecording: (meetingId: string, mic: string | null, system: boolean) => invoke<void>("start_recording", { meetingId, mic, system }),
  pauseRecording: () => invoke<void>("pause_recording"),
  resumeRecording: () => invoke<void>("resume_recording"),
  stopRecording: () => invoke<void>("stop_recording"),
  switchMic: (uid: string) => invoke<void>("switch_mic", { uid }),
  audioTest: (mic: string | null, system: boolean, seconds: number) => invoke<{ mic: number; system: number; errors: string[] }>("audio_test", { mic, system, seconds }),
  transcribeMeeting: (id: string) => invoke<void>("transcribe_meeting", { id }),
  warmModels: () => invoke<void>("warm_models"),
  enhanceNotes: (id: string, templateId?: string) => invoke<Note>("enhance_notes", { id, templateId }),
  ask: (question: string, threadId?: string | null, meetingId?: string | null) => invoke<{ threadId: string; message: ChatMessage }>("ask", { question, threadId, meetingId }),
  listThreads: (meetingId?: string | null) => invoke<{ id: string; meetingId: string | null; title: string; createdAt: number }[]>("list_threads", { meetingId }),
  threadMessages: (threadId: string) => invoke<ChatMessage[]>("thread_messages", { threadId }),
  deleteThread: (threadId: string) => invoke<void>("delete_thread", { threadId }),
  search: (query: string, kinds?: string[], semantic?: boolean) => invoke<SearchHit[]>("search", { query, kinds, semantic }),
  reindexSemantic: () => invoke<number>("reindex_semantic"),
  listCatalog: () => invoke<CatalogModel[]>("list_catalog"),
  recommend: (languages: string[]) => invoke<Recommendation>("recommend", { languages }),
  downloadModel: (id: string, quant?: string, activate = true) => invoke<void>("download_model", { id, quant, activate }),
  importModel: (role: "asr" | "llm" | "embed", path: string) => invoke<unknown>("import_model", { role, path }),
  rescanLocalModels: () => invoke<FoundModel[]>("rescan_local_models"),
  useFoundModel: (role: string, path: string, source: string) => invoke<unknown>("use_found_model", { role, path, source }),
  cancelDownload: (id: string) => invoke<boolean>("cancel_download", { id }),
  deleteModel: (id: string) => invoke<void>("delete_model", { id }),
  storage: () => invoke<Storage>("storage"),
  listTemplates: () => invoke<Template[]>("list_templates"),
  saveTemplate: (name: string, instructions: string, id?: string) => invoke<Template>("save_template", { id, name, instructions }),
  deleteTemplate: (id: string) => invoke<void>("delete_template", { id }),
  exportMeeting: (id: string, format: string, path: string) => invoke<void>("export_meeting", { id, format, path }),
  exportPreview: (id: string) => invoke<string>("export_preview", { id }),
  printWindow: () => invoke<void>("print_window"),
  revealDataFolder: () => invoke<void>("reveal_data_folder"),
  openPrivacySettings: (kind: "mic" | "screen") => invoke<void>("open_privacy_settings", { kind }),
  deleteAllData: (includeModels: boolean) => invoke<void>("delete_all_data", { includeModels }),
};

export function on<T = any>(event: string, cb: (payload: T) => void): () => void {
  let un: UnlistenFn | null = null;
  let cancelled = false;
  listen<T>(event, (e) => cb(e.payload)).then((u) => {
    if (cancelled) u();
    else un = u;
  });
  return () => {
    cancelled = true;
    un?.();
  };
}
