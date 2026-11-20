//! Grain: a local-first AI meeting notepad.
//!
//! Module map (each owns one concern; see docs/ARCHITECTURE.md):
//! - `capture`  — recording sessions via the native macOS helper
//! - `audio`    — PCM I/O, chunking at pauses, echo de-duplication, WAV export
//! - `asr`      — transcribe.cpp engine thread, live + post-meeting transcription
//! - `models`   — bundled model catalog, downloads, integrity checks
//! - `llm`      — llama.cpp server lifecycle and chat/embedding calls
//! - `notes`    — enhanced-note generation and verification
//! - `chat`     — Ask Grain retrieval-augmented answers, semantic index
//! - `db`       — SQLite schema, migrations, queries, full-text search
//! - `export`   — Markdown / text / JSON / WAV export
//! - `hardware` — system detection for recommendations

pub mod asr;
pub mod audio;
pub mod capture;
pub mod chat;
pub mod db;
pub mod export;
pub mod hardware;
pub mod llm;
pub mod local;
pub mod models;
pub mod notes;

use anyhow::Result;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};

/// Event sink to the UI (or to a test harness).
pub type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;

pub struct Paths {
    pub root: PathBuf,
    pub models: PathBuf,
    pub recordings: PathBuf,
    pub db: PathBuf,
}

impl Paths {
    pub fn new(root: &Path) -> Result<Paths> {
        let p = Paths { root: root.into(), models: root.join("models"), recordings: root.join("recordings"), db: root.join("grain.db") };
        for d in [&p.root, &p.models, &p.recordings] {
            std::fs::create_dir_all(d)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(d, std::fs::Permissions::from_mode(0o700))?;
            }
        }
        Ok(p)
    }
}

pub struct Core {
    pub db: db::Db,
    pub paths: Paths,
    pub emit: Emit,
    pub asr: asr::AsrEngine,
    pub llm: llm::LlmManager,
    pub downloads: models::Downloads,
    pub capture: tokio::sync::Mutex<Option<capture::CaptureSession>>,
    pub on_recording: Arc<dyn Fn(Option<f64>) + Send + Sync>,
    /// Models found elsewhere on this Mac (other apps, shared folders), from the last scan.
    pub found: std::sync::Mutex<Vec<local::Found>>,
}

impl Core {
    pub fn new(root: &Path, emit: Emit, on_recording: Arc<dyn Fn(Option<f64>) + Send + Sync>) -> Result<Arc<Core>> {
        let paths = Paths::new(root)?;
        let db = db::Db::open(&paths.db)?;
        for (k, v) in [("transcriptionMode", json!("live")), ("captureSystem", json!(true)), ("languages", json!(["en"])), ("asrLanguage", json!("auto")), ("keepAudio", json!(true)), ("defaultTemplate", json!("general"))] {
            if db.get_setting(k)?.is_none() {
                db.set_setting(k, &v)?;
            }
        }
        models::reconcile(&db)?;
        Ok(Arc::new(Core { db, paths, emit, asr: asr::AsrEngine::new(), llm: llm::LlmManager::default(), downloads: Default::default(), capture: Default::default(), on_recording, found: Default::default() }))
    }

    /// Look for models other apps already downloaded (no hashing; runs on a blocking thread).
    pub async fn rescan_local(self: &Arc<Self>) -> Vec<local::Found> {
        if !self.db.setting_bool("scanOtherApps", true) {
            self.found.lock().unwrap().clear();
            return vec![];
        }
        let folders: Vec<String> = self.db.get_setting("modelFolders").ok().flatten().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
        let root = self.paths.models.clone();
        let found = tokio::task::spawn_blocking(move || local::scan(&folders, &root)).await.unwrap_or_default();
        *self.found.lock().unwrap() = found.clone();
        (self.emit)("local-models", json!({"count": found.len()}));
        found
    }

    fn strings(&self, key: &str) -> Vec<String> {
        self.db.get_setting(key).ok().flatten().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
    }

    /// Pick up models already on this Mac without being asked: every verified catalogue
    /// match, plus the largest found notes model that fits in memory if Grain has none.
    /// Never downloads. Models the user deleted from Grain are not picked up again.
    pub async fn adopt_found(self: &Arc<Self>, found: &[local::Found]) {
        let skip = self.strings("notAdopted");
        let ready = |id: &str| self.db.installed_model(id).ok().flatten().is_some_and(|m| m.status == "ready");
        let langs = self.strings("languages");
        let rec = models::recommend(&langs, hardware::total_ram_gb());
        let rank = |id: &str| rec.asr.iter().position(|r| r == id).unwrap_or(usize::MAX);
        let mut known: Vec<&local::Found> = found.iter().filter(|f| f.model_id.as_deref().is_some_and(|id| !ready(id) && !skip.iter().any(|s| s == id))).collect();
        known.sort_by_key(|f| rank(f.model_id.as_deref().unwrap_or_default())); // the recommended speech model becomes the active one
        let mut done = HashSet::new();
        for f in known {
            let id = f.model_id.clone().unwrap_or_default();
            if !done.insert(id.clone()) || self.downloads.is_active(&id) {
                continue;
            }
            if let Ok(m) = self.downloads.download(&self.db, &self.paths.models, &id, f.quant.as_deref(), found, true, &self.emit).await {
                activate_model(self, &m.role, &m.id, false).await;
            }
        }
        if self.db.installed_models().unwrap_or_default().iter().any(|m| m.role == "llm" && m.status == "ready") {
            return;
        }
        let max = (hardware::total_ram_gb() * 0.4 * 1_073_741_824.0) as u64; // leave room for speech and the OS
        // Unverified files are only picked up silently when they are the user's own: another account
        // on this Mac can write /Users/Shared. Others stay listed for the user to choose.
        use std::os::unix::fs::MetadataExt;
        let me = std::fs::metadata(&self.paths.root).map(|m| m.uid()).ok();
        let mine = |p: &str| std::fs::metadata(p).ok().map(|m| m.uid()) == me && me.is_some();
        let Some(f) = found.iter().filter(|f| f.model_id.is_none() && f.role.as_deref() == Some("llm") && f.size <= max && !skip.contains(&f.path) && mine(&f.path)).max_by_key(|f| f.size).cloned() else { return };
        let c = self.clone();
        let r = tokio::task::spawn_blocking(move || models::import_as(&c.db, &c.paths.models, "llm", Path::new(&f.path), Some(&f.source))).await;
        if let Ok(Ok(m)) = r {
            activate_model(self, "llm", &m.id, false).await;
            (self.emit)("local-models", json!({"adopted": m.id}));
        }
    }

    fn dir_size(p: &Path) -> u64 {
        let mut n = 0;
        if let Ok(rd) = std::fs::read_dir(p) {
            for e in rd.flatten() {
                let m = e.metadata();
                if let Ok(m) = m {
                    n += if m.is_dir() { Self::dir_size(&e.path()) } else { m.len() };
                }
            }
        }
        n
    }

    pub fn storage(&self) -> Value {
        let db_size: u64 = ["grain.db", "grain.db-wal"].iter().map(|f| std::fs::metadata(self.paths.root.join(f)).map(|m| m.len()).unwrap_or(0)).sum();
        json!({"models": Self::dir_size(&self.paths.models), "recordings": Self::dir_size(&self.paths.recordings), "database": db_size, "root": self.paths.root, "freeDisk": models::free_space(&self.paths.root)})
    }

    pub fn delete_meeting(&self, id: &str) -> Result<()> {
        let dir = asr::checked_meeting_dir(self, id)?;
        if dir.exists() {
            std::fs::remove_dir_all(&dir)?;
        }
        self.db.delete_meeting(id)
    }

    pub fn delete_audio(&self, id: &str) -> Result<()> {
        let dir = asr::checked_meeting_dir(self, id)?;
        for src in ["mic", "system"] {
            let p = dir.join(format!("{src}.pcm"));
            if p.exists() {
                std::fs::remove_file(&p)?;
            }
            let _ = self.db.conn().execute("UPDATE recordings SET status='deleted' WHERE meeting_id=? AND source=?", [id, src]);
        }
        Ok(())
    }
}

type Res<T> = std::result::Result<T, String>;
fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}
type St<'a> = tauri::State<'a, Arc<Core>>;

#[tauri::command]
async fn bootstrap(core: St<'_>) -> Res<Value> {
    Ok(json!({
        "settings": core.db.all_settings().map_err(e)?,
        "hardware": hardware::detect(&core.paths.root),
        "storage": core.storage(),
        "recording": core.capture.lock().await.as_ref().map(|s| s.meeting_id.clone()),
        // GUI end-to-end test mode (GRAIN_E2E=1): the in-app runner drives the UI.
        "e2e": std::env::var("GRAIN_E2E").ok().filter(|v| v == "1").map(|_| json!({
            "phase": std::env::var("GRAIN_E2E_PHASE").unwrap_or_else(|_| "1".into()),
            "exportDir": std::env::var("GRAIN_E2E_EXPORT_DIR").ok(),
            "importFile": std::env::var("GRAIN_E2E_IMPORT_FILE").ok(),
            "home": std::env::var("HOME").ok(),
        })),
        // Test hook for the screenshot audit: open a given screen on launch.
        "initialRoute": std::env::var("GRAIN_ROUTE").ok().and_then(|r| serde_json::from_str::<Value>(&r).ok()),
    }))
}

#[tauri::command]
fn set_setting(core: St<'_>, key: String, value: Value) -> Res<()> {
    core.db.set_setting(&key, &value).map_err(e)
}

#[tauri::command]
fn list_meetings(core: St<'_>) -> Res<Vec<Value>> {
    let ms = core.db.list_meetings().map_err(e)?;
    Ok(ms
        .into_iter()
        .map(|m| {
            let preview = core.db.latest_note(&m.id, "enhanced").ok().flatten().or_else(|| core.db.latest_note(&m.id, "manual").ok().flatten()).map(|n| n.content.chars().take(200).collect::<String>()).unwrap_or_default();
            json!({"meeting": m, "preview": preview})
        })
        .collect())
}

#[tauri::command]
fn create_meeting(core: St<'_>, title: Option<String>, template_id: Option<String>) -> Res<db::Meeting> {
    let t = template_id.or_else(|| core.db.setting_str("defaultTemplate")).unwrap_or_else(|| "general".into());
    core.db.create_meeting(title.as_deref().unwrap_or(""), &t).map_err(e)
}

#[tauri::command]
fn meeting_detail(core: St<'_>, id: String) -> Res<Value> {
    let d = &core.db;
    Ok(json!({
        "meeting": d.get_meeting(&id).map_err(e)?,
        "manual": d.latest_note(&id, "manual").map_err(e)?,
        "enhanced": d.latest_note(&id, "enhanced").map_err(e)?,
        "enhancedVersions": d.note_versions(&id, "enhanced").map_err(e)?.iter().map(|n| json!({"version": n.version, "createdAt": n.created_at, "modelId": n.model_id, "templateId": n.template_id})).collect::<Vec<_>>(),
        "segments": d.segments(&id).map_err(e)?,
        "actionItems": d.action_items(Some(&id)).map_err(e)?,
        "marks": d.marks(&id).map_err(e)?,
        "recordings": d.recordings(&id).map_err(e)?,
    }))
}

#[tauri::command]
fn enhanced_version(core: St<'_>, id: String, version: i64) -> Res<Option<db::Note>> {
    Ok(core.db.note_versions(&id, "enhanced").map_err(e)?.into_iter().find(|n| n.version == version))
}

#[tauri::command]
fn update_meeting(core: St<'_>, id: String, patch: Value) -> Res<db::Meeting> {
    core.db.update_meeting(&id, &patch).map_err(e)
}

#[tauri::command]
async fn delete_meeting(core: St<'_>, id: String) -> Res<()> {
    if core.capture.lock().await.as_ref().map(|s| s.meeting_id == id).unwrap_or(false) {
        return Err("Stop the recording before deleting this meeting.".into());
    }
    core.delete_meeting(&id).map_err(e)
}

#[tauri::command]
fn delete_audio(core: St<'_>, id: String) -> Res<()> {
    core.delete_audio(&id).map_err(e)
}

#[tauri::command]
fn save_manual_note(core: St<'_>, id: String, content: String) -> Res<()> {
    core.db.save_manual_note(&id, &content).map_err(e)
}

#[tauri::command]
fn save_enhanced_note(core: St<'_>, id: String, content: String) -> Res<()> {
    core.db.edit_enhanced_note(&id, &content).map_err(e)
}

#[tauri::command]
fn update_segment(core: St<'_>, id: i64, text: String) -> Res<()> {
    core.db.update_segment_text(id, &text).map_err(e)
}

#[tauri::command]
fn add_mark(core: St<'_>, meeting_id: String, at_ms: i64, label: String) -> Res<db::Mark> {
    core.db.add_mark(&meeting_id, at_ms, &label).map_err(e)
}

#[tauri::command]
fn list_action_items(core: St<'_>) -> Res<Vec<Value>> {
    let ms = core.db.list_meetings().map_err(e)?;
    Ok(core
        .db
        .action_items(None)
        .map_err(e)?
        .into_iter()
        .map(|a| {
            let m = ms.iter().find(|m| m.id == a.meeting_id);
            json!({"item": a, "meetingTitle": m.map(|m| m.title.clone()), "meetingDate": m.map(|m| m.started_at.unwrap_or(m.created_at))})
        })
        .collect())
}

#[tauri::command]
fn set_action_status(core: St<'_>, id: i64, status: String) -> Res<()> {
    if !["open", "done"].contains(&status.as_str()) {
        return Err("invalid status".into());
    }
    core.db.set_action_status(id, &status).map_err(e)
}

#[tauri::command]
async fn capture_permissions() -> Res<Value> {
    capture::permissions().await.map_err(e)
}

#[tauri::command]
async fn request_permission(kind: String) -> Res<Value> {
    capture::request_permission(&kind).await.map_err(e)
}

#[tauri::command]
async fn list_devices() -> Res<Value> {
    capture::devices().await.map_err(e)
}

#[tauri::command]
async fn start_recording(core: St<'_>, meeting_id: String, mic: Option<String>, system: bool) -> Res<()> {
    capture::start(core.inner().clone(), meeting_id, mic, system).await.map_err(e)
}

#[tauri::command]
async fn pause_recording(core: St<'_>) -> Res<()> {
    capture::pause(&core).await.map_err(e)
}

#[tauri::command]
async fn resume_recording(core: St<'_>) -> Res<()> {
    capture::resume(&core).await.map_err(e)
}

#[tauri::command]
async fn stop_recording(core: St<'_>) -> Res<()> {
    capture::stop(&core).await.map_err(e)
}

#[tauri::command]
async fn switch_mic(core: St<'_>, uid: String) -> Res<()> {
    capture::switch_mic(&core, &uid).await.map_err(e)
}

#[tauri::command]
async fn audio_test(core: St<'_>, mic: Option<String>, system: bool, seconds: f64) -> Res<Value> {
    if core.capture.lock().await.is_some() {
        return Err("A meeting is being recorded.".into());
    }
    capture::audio_test(&core, mic, system, seconds).await.map_err(e)
}

#[tauri::command]
async fn transcribe_meeting(core: St<'_>, id: String) -> Res<()> {
    let c = core.inner().clone();
    asr::asr_config(&c).map_err(e)?;
    tokio::spawn(async move {
        let _ = c.db.set_status(&id, "processing");
        let r = asr::transcribe_meeting(c.clone(), id.clone()).await;
        let _ = c.db.set_status(&id, "done");
        match &r {
            Ok(_) => capture::apply_retention(&c, &id),
            Err(err) => (c.emit)("transcription-status", json!({"meetingId": id, "state": "error", "error": err.to_string()})),
        }
        (c.emit)("meeting-status", json!({"meetingId": id, "status": "done"}));
        let _ = chat::index_meeting(&c, &id).await;
    });
    Ok(())
}

/// Preload the notes/embedding models (called when a meeting with a transcript is opened).
#[tauri::command]
async fn warm_models(core: St<'_>) -> Res<()> {
    let c = core.inner().clone();
    tokio::spawn(async move { c.llm.warm(&c).await });
    Ok(())
}

#[tauri::command]
async fn enhance_notes(core: St<'_>, id: String, template_id: Option<String>) -> Res<db::Note> {
    let r = notes::enhance(core.inner().clone(), &id, template_id.as_deref()).await;
    if let Err(err) = &r {
        (core.emit)("enhance-status", json!({"meetingId": id, "stage": "error", "error": err.to_string()}));
    }
    r.map_err(e)
}

#[tauri::command]
async fn ask(core: St<'_>, thread_id: Option<String>, meeting_id: Option<String>, question: String) -> Res<Value> {
    if question.trim().is_empty() {
        return Err("Type a question".into());
    }
    chat::ask(core.inner().clone(), thread_id, meeting_id, question).await.map_err(e)
}

#[tauri::command]
fn list_threads(core: St<'_>, meeting_id: Option<String>) -> Res<Vec<Value>> {
    core.db.threads(meeting_id.as_deref()).map_err(e)
}

#[tauri::command]
fn thread_messages(core: St<'_>, thread_id: String) -> Res<Vec<db::ChatMessage>> {
    core.db.messages(&thread_id).map_err(e)
}

#[tauri::command]
fn delete_thread(core: St<'_>, thread_id: String) -> Res<()> {
    core.db.delete_thread(&thread_id).map_err(e)
}

#[tauri::command]
async fn search(core: St<'_>, query: String, kinds: Option<Vec<String>>, semantic: Option<bool>) -> Res<Vec<db::SearchHit>> {
    let mut hits = core.db.search(&query, None, kinds.as_deref(), 50).map_err(e)?;
    if semantic.unwrap_or(false) {
        if let Some(id) = core.db.setting_str("embedModel") {
            let ep = core.llm.endpoint(&core, "embed").await.map_err(e)?;
            let q = core.llm.embed(&ep, &[format!("Instruct: Given a search query, retrieve relevant meeting passages\nQuery: {query}")]).await.map_err(e)?;
            let mut v = core.db.vector_search(&q[0], None, &id, 20).map_err(e)?;
            v.retain(|h| h.score > 0.35 && !hits.iter().any(|x| x.ref_id == h.ref_id && x.kind == h.kind));
            for h in v.iter_mut() {
                h.kind = format!("{}:semantic", h.kind);
            }
            hits.extend(v);
        }
    }
    Ok(hits)
}

#[tauri::command]
async fn reindex_semantic(core: St<'_>) -> Res<usize> {
    let mut n = 0;
    for m in core.db.list_meetings().map_err(e)? {
        n += chat::index_meeting(&core, &m.id).await.map_err(e)?;
    }
    Ok(n)
}

#[tauri::command]
fn list_catalog(core: St<'_>) -> Res<Vec<Value>> {
    let installed = core.db.installed_models().map_err(e)?;
    let found = core.found.lock().unwrap().clone();
    let mut out: Vec<Value> = models::catalog()
        .iter()
        .map(|m| {
            let i = installed.iter().find(|i| i.id == m.id);
            let mut v = serde_json::to_value(m).unwrap();
            v["status"] = json!(if core.downloads.is_active(&m.id) { "downloading" } else { i.map(|i| i.status.as_str()).unwrap_or("available") });
            let partial = models::Downloads::partial(&core.paths.models, m);
            v["partialBytes"] = json!(partial.as_ref().map(|p| p.1).unwrap_or(0));
            v["partialQuant"] = json!(partial.map(|p| p.0));
            // What is on disk (quant actually installed), not only the default.
            if let Some(i) = i {
                v["installedQuant"] = json!(i.quant);
                v["installedSize"] = json!(i.size);
                v["origin"] = json!(core.db.model_origin(&i.id));
            }
            if i.map(|i| i.status != "ready").unwrap_or(true) {
                if let Some(f) = local::best_for(&found, m, None) {
                    v["found"] = json!({"quant": f.quant, "source": f.source, "size": f.size, "path": f.path});
                }
            }
            v
        })
        .collect();
    // User-imported models (not in the catalogue).
    for i in installed.iter().filter(|i| i.family.as_deref() == Some("custom")) {
        out.push(json!({
            "id": i.id, "name": i.name, "description": "Imported from a file on this Mac", "role": i.role, "family": "custom", "params": "",
            "languages": [], "license": "unknown", "repo": "", "filename": std::path::Path::new(&i.path).file_name().map(|f| f.to_string_lossy().to_string()),
            "quant": i.quant.clone().unwrap_or_default(), "size": i.size, "sha256": i.sha256, "curated": true, "custom": true, "capabilities": {}, "accuracy": {},
            "speed": null, "minRamGb": 0, "ctx": 8192, "thinking": false, "recommended": false, "quants": [], "status": i.status, "partialBytes": 0,
            "installedQuant": i.quant, "installedSize": i.size, "origin": core.db.model_origin(&i.id),
        }));
    }
    Ok(out)
}

#[tauri::command]
fn recommend(core: St<'_>, languages: Vec<String>) -> Res<models::Recommendation> {
    let _ = &core;
    Ok(models::recommend(&languages, hardware::total_ram_gb()))
}

#[tauri::command]
async fn download_model(core: St<'_>, id: String, quant: Option<String>, activate: Option<bool>) -> Res<()> {
    let c = core.inner().clone();
    if c.downloads.is_active(&id) {
        return Ok(());
    }
    tokio::spawn(async move {
        // Fresh scan, so a copy on this Mac is used even if the startup scan has not finished.
        let found = c.rescan_local().await;
        if let Ok(m) = c.downloads.download(&c.db, &c.paths.models, &id, quant.as_deref(), &found, false, &c.emit).await {
            activate_model(&c, &m.role, &m.id, activate.unwrap_or(true)).await;
        }
    });
    Ok(())
}

fn role_key(role: &str) -> &'static str {
    match role {
        "asr" => "asrModel",
        "llm" => "llmModel",
        _ => "embedModel",
    }
}

/// Like Handy: a model you chose to download becomes the active one when it is ready.
/// The first model of a kind always becomes active. Never switches the speech model mid-recording.
async fn activate_model(c: &Core, role: &str, id: &str, wanted: bool) {
    let key = role_key(role);
    let current = c.db.setting_str(key).filter(|cur| c.db.installed_model(cur).ok().flatten().is_some());
    let recording = c.capture.lock().await.is_some();
    if current.is_none() || (wanted && !(recording && role == "asr")) {
        let _ = c.db.set_setting(key, &json!(id));
        (c.emit)("settings-changed", json!({key: id}));
    }
}

/// Rescan other apps' model folders. Returns models that are not in Grain's catalogue
/// (catalogue matches are attached to the catalogue rows instead).
#[tauri::command]
async fn rescan_local_models(core: St<'_>) -> Res<Vec<local::Found>> {
    let found = core.inner().rescan_local().await;
    let installed: Vec<String> = core.db.installed_models().map_err(e)?.into_iter().filter_map(|m| core.db.model_origin(&m.id).and_then(|o| o["from"].as_str().map(String::from))).collect();
    Ok(found.into_iter().filter(|f| f.model_id.is_none() && !installed.contains(&f.path)).collect())
}

/// Use a non-catalogue model another app downloaded (cloned or used in place, never copied).
#[tauri::command]
async fn use_found_model(core: St<'_>, role: String, path: String, source: String) -> Res<db::InstalledModel> {
    let known = core.found.lock().unwrap().iter().any(|f| f.path == path);
    if !known {
        return Err("That file was not found by the last scan.".into());
    }
    let c = core.inner().clone();
    let m = tokio::task::spawn_blocking(move || models::import_as(&c.db, &c.paths.models, &role, Path::new(&path), Some(&source))).await.map_err(e)?.map_err(e)?;
    activate_model(&core, &m.role, &m.id, true).await;
    Ok(m)
}

#[tauri::command]
async fn import_model(core: St<'_>, role: String, path: String) -> Res<db::InstalledModel> {
    let c = core.inner().clone();
    // Copying and hashing a multi-GB file is blocking work: keep it off the async runtime.
    let m = tokio::task::spawn_blocking(move || models::import(&c.db, &c.paths.models, &role, Path::new(&path))).await.map_err(e)?.map_err(e)?;
    activate_model(&core, &m.role, &m.id, true).await;
    Ok(m)
}

#[tauri::command]
fn cancel_download(core: St<'_>, id: String) -> Res<bool> {
    Ok(core.downloads.cancel(&id))
}

#[tauri::command]
async fn delete_model(core: St<'_>, id: String) -> Res<()> {
    core.asr.unload();
    core.llm.stop_all().await;
    let role = core.db.installed_models().map_err(e)?.into_iter().find(|m| m.id == id).map(|m| m.role);
    // Deleted on purpose: don't pick the same model up from another app on the next launch.
    let mut skip = core.strings("notAdopted");
    skip.push(id.clone());
    skip.extend(core.db.model_origin(&id).and_then(|o| o["from"].as_str().map(String::from)));
    core.db.set_setting("notAdopted", &json!(skip)).map_err(e)?;
    models::delete(&core.db, &core.paths.models, &id).map_err(e)?;
    // Deleting the active model falls back to another installed model of the same kind.
    for key in ["asrModel", "llmModel", "embedModel"] {
        if core.db.setting_str(key).as_deref() == Some(id.as_str()) {
            let next = core.db.installed_models().map_err(e)?.into_iter().find(|m| m.status == "ready" && Some(&m.role) == role.as_ref()).map(|m| json!(m.id)).unwrap_or(Value::Null);
            core.db.set_setting(key, &next).map_err(e)?;
            (core.emit)("settings-changed", json!({key: next}));
        }
    }
    Ok(())
}

#[tauri::command]
fn storage(core: St<'_>) -> Res<Value> {
    Ok(core.storage())
}

#[tauri::command]
fn list_templates(core: St<'_>) -> Res<Vec<db::Template>> {
    core.db.templates().map_err(e)
}

#[tauri::command]
fn save_template(core: St<'_>, id: Option<String>, name: String, instructions: String) -> Res<db::Template> {
    if name.trim().is_empty() || instructions.trim().is_empty() {
        return Err("Name and instructions are required".into());
    }
    core.db.save_template(id.as_deref(), name.trim(), instructions.trim()).map_err(e)
}

#[tauri::command]
fn delete_template(core: St<'_>, id: String) -> Res<()> {
    core.db.delete_template(&id).map_err(e)
}

#[tauri::command]
fn export_meeting(core: St<'_>, id: String, format: String, path: String) -> Res<()> {
    export::write(&core, &id, &format, Path::new(&path)).map_err(e)
}

#[tauri::command]
fn export_preview(core: St<'_>, id: String) -> Res<String> {
    export::markdown(&core, &id).map_err(e)
}

#[tauri::command]
fn print_window(window: tauri::WebviewWindow) -> Res<()> {
    window.print().map_err(e)
}

fn e2e_enabled() -> Res<()> {
    if std::env::var("GRAIN_E2E").as_deref() == Ok("1") { Ok(()) } else { Err("test mode is off".into()) }
}

/// E2E only: speak a line through the speakers so it is captured as real system audio.
#[tauri::command]
async fn e2e_say(voice: String, text: String) -> Res<()> {
    e2e_enabled()?;
    tokio::process::Command::new("/usr/bin/say").arg("-v").arg(voice).arg(text).status().await.map_err(e)?;
    Ok(())
}

/// E2E only: write the runner's report.
#[tauri::command]
fn e2e_report(report: Value) -> Res<()> {
    e2e_enabled()?;
    let path = std::env::var("GRAIN_E2E_REPORT").map_err(e)?;
    std::fs::write(path, serde_json::to_string_pretty(&report).map_err(e)?).map_err(e)
}

/// E2E only: does a file exist and how big is it (export checks).
#[tauri::command]
fn e2e_file(path: String) -> Res<Option<u64>> {
    e2e_enabled()?;
    Ok(std::fs::metadata(path).ok().map(|m| m.len()))
}

/// E2E only: quit; `crash` aborts like a real crash (no clean shutdown).
#[tauri::command]
fn e2e_exit(app: tauri::AppHandle, crash: bool) -> Res<()> {
    e2e_enabled()?;
    if crash {
        std::process::abort();
    }
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn reveal_data_folder(core: St<'_>) -> Res<()> {
    std::process::Command::new("/usr/bin/open").arg(&core.paths.root).spawn().map_err(e)?;
    Ok(())
}

#[tauri::command]
fn open_privacy_settings(kind: String) -> Res<()> {
    let pane = match kind.as_str() {
        "mic" => "Privacy_Microphone",
        _ => "Privacy_ScreenCapture",
    };
    std::process::Command::new("/usr/bin/open").arg(format!("x-apple.systempreferences:com.apple.preference.security?{pane}")).spawn().map_err(e)?;
    Ok(())
}

#[tauri::command]
async fn delete_all_data(core: St<'_>, include_models: bool) -> Res<()> {
    if core.capture.lock().await.is_some() {
        return Err("Stop the recording first.".into());
    }
    for m in core.db.list_meetings().map_err(e)? {
        core.delete_meeting(&m.id).map_err(e)?;
    }
    if include_models {
        core.asr.unload();
        core.llm.stop_all().await;
        for m in core.db.installed_models().map_err(e)? {
            models::delete(&core.db, &core.paths.models, &m.id).map_err(e)?;
        }
        for key in ["asrModel", "llmModel", "embedModel"] {
            core.db.set_setting(key, &Value::Null).map_err(e)?;
        }
    }
    let c = core.db.conn();
    c.execute_batch("DELETE FROM chat_threads; DELETE FROM templates WHERE builtin=0; INSERT INTO search_index(search_index) VALUES('optimize'); VACUUM;").map_err(e)?;
    c.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(())).map_err(e)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            // GRAIN_DATA_DIR: portable/test data location (default: ~/Library/Application Support/computer.grain.app).
            let root = std::env::var_os("GRAIN_DATA_DIR").map(PathBuf::from).map(Ok).unwrap_or_else(|| app.path().app_data_dir())?;
            let emit_handle = handle.clone();
            let emit: Emit = Arc::new(move |name: &str, payload: Value| {
                let _ = emit_handle.emit(name, payload);
            });

            // Menu bar item: shows recording time, offers stop/open/quit.
            let open_i = MenuItem::with_id(app, "open", "Open Grain", true, None::<&str>)?;
            let stop_i = MenuItem::with_id(app, "stop", "Stop recording", false, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit Grain", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &stop_i, &PredefinedMenuItem::separator(app)?, &quit_i])?;
            let tray = TrayIconBuilder::with_id("grain").icon(app.default_window_icon().cloned().unwrap()).icon_as_template(false).tooltip("Grain").menu(&menu).build(app)?;
            let last = Arc::new(AtomicI64::new(-2));
            let stop_item = stop_i.clone();
            let on_recording: Arc<dyn Fn(Option<f64>) + Send + Sync> = Arc::new(move |elapsed| {
                let secs = elapsed.map(|e| e as i64).unwrap_or(-1);
                if last.swap(secs, Ordering::SeqCst) == secs {
                    return;
                }
                let title = elapsed.map(|e| format!("● {:02}:{:02}", (e as i64) / 60, (e as i64) % 60));
                let _ = tray.set_title(title.as_deref());
                let _ = tray.set_tooltip(Some(if elapsed.is_some() { "Grain — recording" } else { "Grain" }));
                let _ = stop_item.set_enabled(elapsed.is_some());
            });

            let core = Core::new(&root, emit, on_recording).map_err(|e| e.to_string())?;
            let recovered = capture::recover(&core).unwrap_or_default();
            if !recovered.is_empty() {
                let _ = core.db.set_setting("recoveredMeetings", &json!(recovered));
            }
            app.manage(core.clone());

            let c = core.clone();
            app.on_menu_event(move |app, ev| match ev.id().as_ref() {
                "open" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                "stop" => {
                    let c = c.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = capture::stop(&c).await;
                    });
                }
                "quit" => app.exit(0),
                _ => {}
            });

            let c = core.clone();
            tauri::async_runtime::spawn(async move {
                let found = c.rescan_local().await;
                c.adopt_found(&found).await;
            });
            let c = core.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                    c.llm.stop_idle().await;
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window while recording keeps recording (menu bar shows it).
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let core = window.state::<Arc<Core>>();
                let recording = tauri::async_runtime::block_on(async { core.capture.lock().await.is_some() });
                if recording {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap, set_setting, list_meetings, create_meeting, meeting_detail, enhanced_version, update_meeting, delete_meeting, delete_audio,
            save_manual_note, save_enhanced_note, update_segment, add_mark, list_action_items, set_action_status,
            capture_permissions, request_permission, list_devices, start_recording, audio_test, pause_recording, resume_recording, stop_recording, switch_mic,
            transcribe_meeting, warm_models, enhance_notes, ask, list_threads, thread_messages, delete_thread, search, reindex_semantic,
            list_catalog, recommend, download_model, import_model, rescan_local_models, use_found_model, cancel_download, delete_model, storage, list_templates, save_template, delete_template,
            export_meeting, export_preview, print_window, reveal_data_folder, open_privacy_settings, delete_all_data,
            e2e_say, e2e_report, e2e_file, e2e_exit
        ])
        .run(tauri::generate_context!())
        .expect("error while running Grain");
}
