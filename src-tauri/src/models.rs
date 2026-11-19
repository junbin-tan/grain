//! Model catalog (bundled, offline) and the download manager.
//!
//! Speech models come from `catalog/asr.json`: a verbatim copy of Handy's
//! catalog of transcribe.cpp GGUF models (MIT, pinned revisions, per-quant
//! SHA-256, published FLEURS error rates). Language models come from
//! `catalog/llm.json`, pinned the same way. Nothing is fetched to build the list.

use crate::db::{now_ms, Db, InstalledModel};
use crate::Emit;
use anyhow::{anyhow, bail, Context, Result};
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogModel {
    pub id: String,
    pub name: String,
    pub description: String,
    pub role: String,
    pub family: String,
    pub params: String,
    pub languages: Vec<String>,
    pub license: String,
    pub repo: String,
    pub revision: String,
    pub filename: String,
    pub quant: String,
    pub size: u64,
    pub sha256: String,
    pub curated: bool,
    pub capabilities: Value,
    /// Published error rate (%) per language, FLEURS test, from transcribe.cpp. Not measured by Grain.
    pub accuracy: Value,
    /// Published real-time factor on the reference benchmark machine. Not measured by Grain.
    pub speed: Option<f64>,
    pub min_ram_gb: f64,
    pub ctx: u32,
    pub thinking: bool,
    pub recommended: bool,
    /// Every downloadable quantisation (the default one is mirrored in filename/size/sha256).
    pub quants: Vec<QuantFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuantFile {
    pub quant: String,
    pub filename: String,
    pub size: u64,
    pub sha256: String,
}

impl CatalogModel {
    /// This model with a specific quantisation selected (None or unknown = the default).
    pub fn variant(&self, quant: Option<&str>) -> CatalogModel {
        let mut m = self.clone();
        if let Some(q) = quant.and_then(|q| self.quants.iter().find(|f| f.quant == q)) {
            m.quant = q.quant.clone();
            m.filename = q.filename.clone();
            m.size = q.size;
            m.sha256 = q.sha256.clone();
        }
        m
    }

    pub fn url(&self) -> String {
        format!("https://huggingface.co/{}/resolve/{}/{}", self.repo, self.revision, self.filename)
    }
}

static CATALOG: OnceLock<Vec<CatalogModel>> = OnceLock::new();

pub fn catalog() -> &'static [CatalogModel] {
    CATALOG.get_or_init(|| {
        let mut out = Vec::new();
        let asr: Value = serde_json::from_str(include_str!("../catalog/asr.json")).expect("asr catalog");
        let results = asr["results"].clone();
        for m in asr["models"].as_array().into_iter().flatten() {
            let role = m["role"].as_str().unwrap_or("asr");
            if role != "asr" {
                continue;
            }
            let quant = m["quant"].as_str().unwrap_or("Q8_0").to_string();
            let Some(f) = m["files"].get(&quant) else { continue };
            let id = m["id"].as_str().unwrap_or_default().to_string();
            let r = &results[&id];
            let accuracy: serde_json::Map<String, Value> = r["accuracy"]
                .as_object()
                .map(|o| o.iter().map(|(k, v)| (k.clone(), v["error"].clone())).collect())
                .unwrap_or_default();
            let size = f["size"].as_u64().unwrap_or(0);
            // F32 checkpoints are reference weights, too large to be useful in an app.
            let quants: Vec<QuantFile> = m["files"]
                .as_object()
                .into_iter()
                .flatten()
                .filter(|(q, _)| q.as_str() != "F32")
                .map(|(q, f)| QuantFile { quant: q.clone(), filename: f["filename"].as_str().unwrap_or_default().into(), size: f["size"].as_u64().unwrap_or(0), sha256: f["sha256"].as_str().unwrap_or_default().into() })
                .collect();
            out.push(CatalogModel {
                quants,
                name: m["name"].as_str().unwrap_or(&id).to_string(),
                description: m["description"].as_str().unwrap_or_default().to_string(),
                role: "asr".into(),
                family: m["family"].as_str().unwrap_or_default().to_string(),
                params: m["parameters"].as_str().unwrap_or_default().to_string(),
                languages: m["languages"].as_array().into_iter().flatten().filter_map(|l| l.as_str().map(String::from)).collect(),
                license: m["license"].as_str().unwrap_or_default().to_string(),
                repo: m["repository"].as_str().unwrap_or_default().to_string(),
                revision: m["revision"].as_str().unwrap_or_default().to_string(),
                filename: f["filename"].as_str().unwrap_or_default().to_string(),
                quant,
                size,
                sha256: f["sha256"].as_str().unwrap_or_default().to_string(),
                curated: m["curated"].as_bool().unwrap_or(false),
                capabilities: m["capabilities"].clone(),
                accuracy: Value::Object(accuracy),
                speed: r["performance"]["accelerated"].as_f64(),
                // Rough working-set estimate: weights are mmapped, plus activations.
                min_ram_gb: ((size as f64 / 1e9) * 2.0 + 2.0).ceil(),
                ctx: 0,
                thinking: false,
                recommended: false,
                id,
            });
        }
        let llm: Value = serde_json::from_str(include_str!("../catalog/llm.json")).expect("llm catalog");
        for m in llm["models"].as_array().into_iter().flatten() {
            out.push(CatalogModel {
                quants: vec![QuantFile { quant: m["quant"].as_str().unwrap_or_default().into(), filename: m["filename"].as_str().unwrap().into(), size: m["size"].as_u64().unwrap(), sha256: m["sha256"].as_str().unwrap().into() }],
                id: m["id"].as_str().unwrap().into(),
                name: m["name"].as_str().unwrap().into(),
                description: m["description"].as_str().unwrap_or_default().into(),
                role: m["role"].as_str().unwrap().into(),
                family: "qwen3".into(),
                params: m["params"].as_str().unwrap_or_default().into(),
                languages: vec![],
                license: m["license"].as_str().unwrap_or_default().into(),
                repo: m["repo"].as_str().unwrap().into(),
                revision: m["revision"].as_str().unwrap().into(),
                filename: m["filename"].as_str().unwrap().into(),
                quant: m["quant"].as_str().unwrap_or_default().into(),
                size: m["size"].as_u64().unwrap(),
                sha256: m["sha256"].as_str().unwrap().into(),
                curated: true,
                capabilities: json!({}),
                accuracy: json!({}),
                speed: None,
                min_ram_gb: m["minRamGb"].as_f64().unwrap_or(8.0),
                ctx: m["ctx"].as_u64().unwrap_or(8192) as u32,
                thinking: m["thinking"].as_bool().unwrap_or(false),
                recommended: m["recommended"].as_bool().unwrap_or(false),
            });
        }
        out
    })
}

pub fn get(id: &str) -> Option<&'static CatalogModel> {
    catalog().iter().find(|m| m.id == id)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    pub asr: Vec<String>,
    pub llm: String,
    pub embed: String,
    pub reasons: HashMap<String, String>,
}

const EUROPEAN: &[&str] = &["de", "fr", "es", "it", "pt", "nl", "pl", "sv", "da", "fi", "cs", "ro", "hu", "el", "bg", "hr", "sk", "sl", "et", "lv", "lt", "mt", "uk", "ru"];
const ASIAN: &[&str] = &["zh", "yue", "ja", "ko", "ms", "id", "th", "vi", "fil", "hi"];

/// Hardware- and language-aware starting points. These are suggestions, not guarantees.
pub fn recommend(languages: &[String], ram_gb: f64) -> Recommendation {
    let mut reasons = HashMap::new();
    let langs: Vec<&str> = if languages.is_empty() { vec!["en"] } else { languages.iter().map(|s| s.as_str()).collect() };
    let mut asr = Vec::new();
    if langs.iter().all(|l| *l == "en") {
        asr.push("parakeet-unified-en-0.6b");
        reasons.insert("parakeet-unified-en-0.6b".into(), "Fast, accurate English".into());
        asr.push("whisper-large-v3-turbo");
    } else if langs.iter().any(|l| ASIAN.contains(l)) {
        if ram_gb >= 16.0 {
            asr.push("Qwen3-ASR-1.7B");
            reasons.insert("Qwen3-ASR-1.7B".into(), "Most accurate for Chinese, Cantonese, Malay and other Asian languages".into());
            asr.push("Qwen3-ASR-0.6B");
        } else {
            asr.push("Qwen3-ASR-0.6B");
            reasons.insert("Qwen3-ASR-0.6B".into(), "Chinese, Cantonese and Asian languages with English, sized for this Mac".into());
            asr.push("Qwen3-ASR-1.7B");
        }
        asr.push("whisper-large-v3-turbo");
    } else if langs.iter().all(|l| *l == "en" || EUROPEAN.contains(l)) {
        asr.push("parakeet-ultra");
        reasons.insert("parakeet-ultra".into(), "Fast transcription for English and 24 European languages".into());
        asr.push("whisper-large-v3-turbo");
    } else {
        asr.push("whisper-large-v3-turbo");
        reasons.insert("whisper-large-v3-turbo".into(), "Broadest language coverage".into());
        asr.push("whisper-medium");
    }
    let llm = if ram_gb >= 12.0 { "qwen3-4b-instruct-2507" } else { "qwen3-1.7b" };
    reasons.insert(llm.into(), if ram_gb >= 12.0 { "Good notes quality for this Mac's memory".into() } else { "Fits in limited memory".into() });
    Recommendation { asr: asr.into_iter().map(String::from).collect(), llm: llm.into(), embed: "qwen3-embedding-0.6b".into(), reasons }
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct Downloads {
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

pub fn model_dir(models_root: &Path, m: &CatalogModel) -> PathBuf {
    models_root.join(&m.role).join(m.id.replace('/', "_"))
}

fn sha256_file(path: &Path) -> Result<(Sha256, u64)> {
    sha256_file_progress(path, |_| {})
}

fn sha256_file_progress(path: &Path, mut progress: impl FnMut(u64)) -> Result<(Sha256, u64)> {
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 4 << 20];
    let mut n = 0u64;
    let mut last = Instant::now();
    loop {
        let k = f.read(&mut buf)?;
        if k == 0 {
            break;
        }
        h.update(&buf[..k]);
        n += k as u64;
        if last.elapsed().as_millis() > 200 {
            last = Instant::now();
            progress(n);
        }
    }
    Ok((h, n))
}

/// Hash a (possibly multi-GB) file on a blocking thread, reporting "verifying" progress to the UI.
async fn hash_with_progress(path: PathBuf, id: String, total: u64, emit: Emit) -> Result<(Sha256, u64)> {
    tokio::task::spawn_blocking(move || {
        sha256_file_progress(&path, |n| emit("model-download", json!({"id": id, "state": "verifying", "downloaded": n, "total": total})))
    })
    .await?
}

pub fn free_space(path: &Path) -> Option<u64> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let p = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    disks
        .list()
        .iter()
        .filter(|d| p.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map(|d| d.available_space())
}

impl Downloads {
    pub fn cancel(&self, id: &str) -> bool {
        if let Some(flag) = self.active.lock().unwrap().get(id) {
            flag.store(true, Ordering::SeqCst);
            return true;
        }
        false
    }

    pub fn is_active(&self, id: &str) -> bool {
        self.active.lock().unwrap().contains_key(id)
    }

    /// An interrupted download of any quant of this model: (quant, bytes so far).
    pub fn partial(models_root: &Path, m: &CatalogModel) -> Option<(String, u64)> {
        let dir = model_dir(models_root, m);
        m.quants.iter().find_map(|q| std::fs::metadata(dir.join(format!("{}.part", q.filename))).ok().map(|x| (q.quant.clone(), x.len())))
    }

    /// Download (or resume) a catalog model, verify its SHA-256, and register it.
    /// `local_only`: use a verified copy already on this Mac or nothing; never touches the network.
    pub async fn download(&self, db: &Db, models_root: &Path, id: &str, quant: Option<&str>, found: &[crate::local::Found], local_only: bool, emit: &Emit) -> Result<InstalledModel> {
        let m = &get(id).ok_or_else(|| anyhow!("unknown model {id}"))?.variant(quant);
        let local = crate::local::best_for(found, get(id).unwrap(), Some(&m.quant)).cloned();
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut a = self.active.lock().unwrap();
            if a.contains_key(id) {
                bail!("already downloading");
            }
            a.insert(id.to_string(), cancel.clone());
        }
        // A verified copy already on this Mac (Handy, Hugging Face, Ollama, …) beats any download.
        let mut result = Err(anyhow!("no local copy"));
        if let Some(f) = &local {
            result = adopt(db, models_root, m, f, emit).await;
            if let Err(e) = &result {
                emit("model-download", json!({"id": m.id, "state": "local-rejected", "error": e.to_string()}));
            }
        }
        if result.is_err() && !local_only {
            result = self.download_inner(db, models_root, m, &cancel, emit).await;
        }
        self.active.lock().unwrap().remove(id);
        match &result {
            Ok(_) => emit("model-download", json!({"id": id, "state": "ready"})),
            // A rejected local copy in local-only mode ends quietly; the user can still download.
            Err(e) if cancel.load(Ordering::SeqCst) || local_only => {
                let _ = e;
                emit("model-download", json!({"id": id, "state": "cancelled"}))
            }
            Err(e) => emit("model-download", json!({"id": id, "state": "failed", "error": e.to_string()})),
        }
        result
    }

    async fn download_inner(&self, db: &Db, models_root: &Path, m: &CatalogModel, cancel: &AtomicBool, emit: &Emit) -> Result<InstalledModel> {
        let dir = model_dir(models_root, m);
        std::fs::create_dir_all(&dir)?;
        let dest = dir.join(&m.filename);
        let part = dir.join(format!("{}.part", m.filename));

        // Already on disk (e.g. a previous install whose DB row was lost): verify instead of re-downloading.
        if dest.exists() && std::fs::metadata(&dest)?.len() == m.size {
            emit("model-download", json!({"id": m.id, "state": "verifying", "downloaded": 0, "total": m.size}));
            let (h, _) = hash_with_progress(dest.clone(), m.id.clone(), m.size, emit.clone()).await?;
            if hex::encode(h.finalize()) == m.sha256 {
                return register(db, m, &dest);
            }
            std::fs::remove_file(&dest)?;
        }

        let mut offset = std::fs::metadata(&part).map(|x| x.len()).unwrap_or(0);
        if offset > m.size {
            std::fs::remove_file(&part)?;
            offset = 0;
        }
        let need = m.size - offset + 256 * 1024 * 1024;
        if let Some(free) = free_space(&dir) {
            if free < need {
                bail!("Not enough storage: {:.1} GB needed, {:.1} GB free", need as f64 / 1e9, free as f64 / 1e9);
            }
        }

        let mut hasher = if offset > 0 { hash_with_progress(part.clone(), m.id.clone(), m.size, emit.clone()).await?.0 } else { Sha256::new() };
        let client = reqwest::Client::builder().user_agent("Grain/0.1 (model downloader)").build()?;
        let mut req = client.get(m.url());
        if offset > 0 {
            req = req.header(reqwest::header::RANGE, format!("bytes={offset}-"));
        }
        let resp = req.send().await.context("Could not reach the model server. Check your internet connection.")?;
        let status = resp.status();
        if !(status.is_success()) {
            bail!("Download failed: HTTP {}", status.as_u16());
        }
        if offset > 0 && status.as_u16() != 206 {
            // Server ignored the range request: start over.
            offset = 0;
            hasher = Sha256::new();
        }
        let mut file = std::fs::OpenOptions::new().create(true).write(true).append(offset > 0).truncate(offset == 0).open(&part)?;
        let mut done = offset;
        let mut last = Instant::now();
        let started = Instant::now();
        let mut stream = resp.bytes_stream();
        emit("model-download", json!({"id": m.id, "state": "downloading", "downloaded": done, "total": m.size}));
        while let Some(chunk) = stream.next().await {
            if cancel.load(Ordering::SeqCst) {
                file.flush()?;
                bail!("cancelled");
            }
            let chunk = chunk.context("Connection interrupted. Download can be resumed.")?;
            file.write_all(&chunk)?;
            hasher.update(&chunk);
            done += chunk.len() as u64;
            if last.elapsed().as_millis() > 250 {
                last = Instant::now();
                let speed = (done - offset) as f64 / started.elapsed().as_secs_f64().max(0.001);
                emit("model-download", json!({"id": m.id, "state": "downloading", "downloaded": done, "total": m.size, "bytesPerSec": speed}));
            }
        }
        file.flush()?;
        file.sync_all()?;
        drop(file);
        if done != m.size {
            bail!("Download incomplete ({} of {} bytes). Try again to resume.", done, m.size);
        }
        emit("model-download", json!({"id": m.id, "state": "verifying"}));
        let digest = hex::encode(hasher.finalize());
        if digest != m.sha256 {
            std::fs::remove_file(&part)?;
            bail!("Integrity check failed (SHA-256 mismatch). The file was discarded.");
        }
        std::fs::rename(&part, &dest)?;
        // Switching quantisation replaces the previous file instead of keeping both.
        for q in m.quants.iter().filter(|q| q.filename != m.filename) {
            let _ = std::fs::remove_file(dir.join(&q.filename));
        }
        register(db, m, &dest)
    }
}

/// Use a copy found elsewhere on this Mac: verify its SHA-256, then clone it into Grain's
/// folder (APFS, no extra space) or, on another volume, use it in place. The original is never changed.
async fn adopt(db: &Db, models_root: &Path, m: &CatalogModel, f: &crate::local::Found, emit: &Emit) -> Result<InstalledModel> {
    emit("model-download", json!({"id": m.id, "state": "verifying", "downloaded": 0, "total": m.size, "source": f.source}));
    let (h, n) = hash_with_progress(PathBuf::from(&f.path), m.id.clone(), m.size, emit.clone()).await?;
    if n != m.size || hex::encode(h.finalize()) != m.sha256 {
        bail!("The copy in {} does not match the expected file (it may be incomplete or modified). Downloading instead.", f.source);
    }
    let dir = model_dir(models_root, m);
    let (path, how) = crate::local::materialize(Path::new(&f.path), &dir.join(&m.filename))?;
    for q in m.quants.iter().filter(|q| q.filename != m.filename) {
        let _ = std::fs::remove_file(dir.join(&q.filename));
    }
    let _ = std::fs::remove_file(dir.join(format!("{}.part", m.filename))); // an interrupted download is no longer needed
    let im = register(db, m, &path)?;
    db.set_model_origin(&m.id, &json!({"source": f.source, "how": how, "from": f.path}))?;
    Ok(im)
}

fn register(db: &Db, m: &CatalogModel, path: &Path) -> Result<InstalledModel> {
    let im = InstalledModel {
        id: m.id.clone(),
        role: m.role.clone(),
        name: m.name.clone(),
        family: Some(m.family.clone()),
        version: Some(m.revision.clone()),
        path: path.to_string_lossy().into(),
        quant: Some(m.quant.clone()),
        size: m.size as i64,
        sha256: m.sha256.clone(),
        status: "ready".into(),
        installed_at: now_ms(),
    };
    db.upsert_model(&im)?;
    Ok(im)
}

/// Remove a model's files (including partial downloads) and its registry row.
pub fn delete(db: &Db, models_root: &Path, id: &str) -> Result<()> {
    let dir = match get(id) {
        Some(m) => Some(model_dir(models_root, m)),
        None => db.installed_models()?.into_iter().find(|m| m.id == id).and_then(|m| Path::new(&m.path).parent().map(Path::to_path_buf)),
    };
    // Only ever delete inside Grain's own models folder.
    if let Some(dir) = dir.filter(|d| d.starts_with(models_root) && d.exists()) {
        std::fs::remove_dir_all(&dir)?;
    }
    db.delete_model(id)
}

fn slug(s: &str) -> String {
    let s: String = s.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() || c == '.' { c } else { '-' }).collect();
    s.trim_matches('-').chars().take(60).collect()
}

/// Add a GGUF file the user already has (like Handy's custom models). The file is
/// copied into Grain's models folder; no network access. Whether it actually runs
/// is checked when it is first loaded.
pub fn import(db: &Db, models_root: &Path, role: &str, src: &Path) -> Result<InstalledModel> {
    import_as(db, models_root, role, src, None)
}

/// `found_in`: the app/location a file was found in. Such files are cloned or used in place, never copied.
pub fn import_as(db: &Db, models_root: &Path, role: &str, src: &Path, found_in: Option<&str>) -> Result<InstalledModel> {
    if !["asr", "llm", "embed"].contains(&role) {
        bail!("unknown model type {role}");
    }
    let mut magic = [0u8; 4];
    std::fs::File::open(src).context("Could not open the file")?.read_exact(&mut magic).context("The file is too small to be a model")?;
    if &magic != b"GGUF" {
        bail!("This is not a GGUF model file. Grain can import .gguf files only.");
    }
    let stem = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "model".into());
    let id = format!("custom-{}", slug(&stem));
    let filename = src.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| format!("{stem}.gguf"));
    let dir = models_root.join(role).join(&id);
    std::fs::create_dir_all(&dir)?;
    let dest = dir.join(&filename);
    let size = std::fs::metadata(src)?.len();
    let _ = std::fs::remove_file(&dest);
    let (dest, how) = if crate::local::clone_file(src, &dest) {
        (dest, "clone")
    } else if found_in.is_some() {
        (std::fs::canonicalize(src)?, "reference")
    } else {
        if let Some(free) = free_space(&dir) {
            if free < size + 256 * 1024 * 1024 {
                bail!("Not enough storage to copy this model ({:.1} GB)", size as f64 / 1e9);
            }
        }
        std::fs::copy(src, &dest)?;
        (dest, "copy")
    };
    let (h, _) = sha256_file(&dest)?;
    let quant = ["Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0", "F16", "BF16", "Q4_0", "IQ4_XS"].iter().find(|q| stem.to_uppercase().contains(*q)).map(|q| q.to_string());
    let im = InstalledModel {
        id,
        role: role.into(),
        name: stem,
        family: Some("custom".into()),
        version: None,
        path: dest.to_string_lossy().into(),
        quant,
        size: size as i64,
        sha256: hex::encode(h.finalize()),
        status: "ready".into(),
        installed_at: now_ms(),
    };
    db.upsert_model(&im)?;
    db.set_model_origin(&im.id, &json!({"source": found_in.unwrap_or("A file you added"), "how": how, "from": src}))?;
    Ok(im)
}

/// Installed models whose file disappeared are marked missing, so the UI can offer a re-download.
pub fn reconcile(db: &Db) -> Result<()> {
    for mut m in db.installed_models()? {
        if !Path::new(&m.path).exists() && m.status == "ready" {
            m.status = "missing".into();
            db.upsert_model(&m)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_required_models_with_hashes() {
        for id in ["parakeet-unified-en-0.6b", "parakeet-tdt-0.6b-v2", "parakeet-ultra", "Qwen3-ASR-0.6B", "Qwen3-ASR-1.7B", "whisper-small", "whisper-medium", "canary-1b-v2", "qwen3-4b-instruct-2507", "qwen3-embedding-0.6b"] {
            let m = get(id).unwrap_or_else(|| panic!("{id} missing"));
            assert_eq!(m.sha256.len(), 64, "{id}");
            assert!(m.size > 1_000_000, "{id}");
            assert!(m.url().starts_with("https://huggingface.co/"));
        }
    }

    #[test]
    fn quant_variants() {
        let m = get("Qwen3-ASR-0.6B").unwrap();
        assert!(m.quants.len() >= 4);
        assert!(!m.quants.iter().any(|q| q.quant == "F32"));
        let small = m.variant(Some("Q4_K_M"));
        assert!(small.size < m.size);
        assert!(small.filename.contains("Q4_K_M"));
        assert_eq!(m.variant(Some("nope")).quant, m.quant);
    }

    #[tokio::test]
    async fn local_only_rejects_a_bad_copy_without_downloading() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::memory().unwrap();
        let root = dir.path().join("models");
        let m = get("parakeet-unified-en-0.6b").unwrap();
        let fake = dir.path().join("blob");
        std::fs::write(&fake, b"not the model").unwrap();
        let f = crate::local::Found { path: fake.to_string_lossy().into(), size: 13, source: "Test".into(), model_id: Some(m.id.clone()), quant: Some(m.quant.clone()), hash_named: true, arch: None, name: None, role: None };
        let states = Arc::new(Mutex::new(Vec::new()));
        let s2 = states.clone();
        let emit: Emit = Arc::new(move |_, v| s2.lock().unwrap().push(v["state"].as_str().unwrap_or_default().to_string()));
        assert!(Downloads::default().download(&db, &root, &m.id, None, &[f], true, &emit).await.is_err());
        let states = states.lock().unwrap();
        assert!(!states.iter().any(|s| s == "downloading"), "no network in local-only mode: {states:?}");
        assert_eq!(states.last().map(String::as_str), Some("cancelled"));
        assert!(db.installed_model(&m.id).unwrap().is_none());
    }

    #[test]
    fn import_and_delete_custom_model() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::memory().unwrap();
        let root = dir.path().join("models");
        let not_gguf = dir.path().join("x.bin");
        std::fs::write(&not_gguf, b"ggml1234").unwrap();
        assert!(import(&db, &root, "asr", &not_gguf).is_err());
        let src = dir.path().join("my-whisper-Q5_K_M.gguf");
        std::fs::write(&src, b"GGUF\x03\x00\x00\x00rest").unwrap();
        let m = import(&db, &root, "asr", &src).unwrap();
        assert_eq!(m.id, "custom-my-whisper-q5-k-m");
        assert_eq!(m.quant.as_deref(), Some("Q5_K_M"));
        assert!(Path::new(&m.path).starts_with(&root));
        assert!(db.installed_model(&m.id).unwrap().is_some());
        delete(&db, &root, &m.id).unwrap();
        assert!(!Path::new(&m.path).exists());
        assert!(src.exists(), "original file untouched");
    }

    #[test]
    fn recommendations_follow_languages_and_ram() {
        assert_eq!(recommend(&["en".into()], 16.0).asr[0], "parakeet-unified-en-0.6b");
        assert_eq!(recommend(&["en".into(), "zh".into()], 8.0).asr[0], "Qwen3-ASR-0.6B");
        assert_eq!(recommend(&["en".into(), "ms".into()], 24.0).asr[0], "Qwen3-ASR-1.7B");
        assert_eq!(recommend(&["fr".into()], 16.0).asr[0], "parakeet-ultra");
        assert_eq!(recommend(&["sw".into()], 16.0).asr[0], "whisper-large-v3-turbo");
        assert_eq!(recommend(&[], 8.0).llm, "qwen3-1.7b");
        // every recommendation exists in the catalog
        for langs in [vec!["en"], vec!["zh"], vec!["fr"], vec!["sw"]] {
            let r = recommend(&langs.iter().map(|s| s.to_string()).collect::<Vec<_>>(), 16.0);
            for id in r.asr.iter().chain([&r.llm, &r.embed]) {
                assert!(get(id).is_some(), "{id}");
            }
        }
    }
}
