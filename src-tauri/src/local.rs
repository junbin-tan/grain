//! Finding models that are already on this Mac, so Grain never downloads a file
//! another app (Handy, Hugging Face tools, Ollama, LM Studio, llama.cpp, Jan,
//! GPT4All) or another account (via /Users/Shared) already has.
//!
//! Everything here is local and read-only: directory listings, file sizes and GGUF
//! headers. Other apps' files are never modified or deleted. A found file is used
//! by APFS clone (instant, no extra space, independent of the original) or, on a
//! different volume, by reference.

use crate::models::{self, CatalogModel};
use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub path: String,
    pub size: u64,
    /// Human label of where it was found, e.g. "Handy (Hugging Face cache)".
    pub source: String,
    /// Catalogue match (id, quant) if the file is a known model.
    pub model_id: Option<String>,
    pub quant: Option<String>,
    /// True when the file name itself is the SHA-256 we expect (HF / Ollama blobs).
    pub hash_named: bool,
    /// From the GGUF header, for files that are not in the catalogue.
    pub arch: Option<String>,
    pub name: Option<String>,
    pub role: Option<String>,
}

pub struct Location {
    pub dir: PathBuf,
    pub source: String,
    pub kind: Kind,
}

#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    HuggingFace,
    Ollama,
    Files,
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

/// Well-known model stores on macOS, plus folders the user added.
pub fn locations(extra: &[String]) -> Vec<Location> {
    let h = home();
    let mut v = Vec::new();
    let mut hf: Vec<PathBuf> = Vec::new();
    if let Some(p) = std::env::var_os("HF_HUB_CACHE") {
        hf.push(p.into());
    }
    if let Some(p) = std::env::var_os("HF_HOME") {
        hf.push(PathBuf::from(p).join("hub"));
    }
    hf.push(h.join(".cache/huggingface/hub"));
    for d in hf {
        v.push(Location { dir: d, source: "Hugging Face cache".into(), kind: Kind::HuggingFace });
    }
    let ollama = std::env::var_os("OLLAMA_MODELS").map(PathBuf::from).unwrap_or_else(|| h.join(".ollama/models"));
    v.push(Location { dir: ollama.join("blobs"), source: "Ollama".into(), kind: Kind::Ollama });
    for (d, s) in [
        (h.join(".lmstudio/models"), "LM Studio"),
        (h.join(".cache/lm-studio/models"), "LM Studio"),
        (h.join("Library/Caches/llama.cpp"), "llama.cpp"),
        (h.join("Library/Application Support/Jan/data/models"), "Jan"),
        (h.join("jan/models"), "Jan"),
        (h.join("Library/Application Support/nomic.ai/GPT4All"), "GPT4All"),
        (PathBuf::from("/Users/Shared"), "Shared folder"),
    ] {
        v.push(Location { dir: d, source: s.into(), kind: Kind::Files });
    }
    for e in extra {
        v.push(Location { dir: PathBuf::from(e), source: "Folder you added".into(), kind: Kind::Files });
    }
    v
}

/// Every downloadable catalogue file, by SHA-256 and by (file name, size).
struct Index {
    by_sha: HashMap<String, (String, String)>,
    by_name_size: HashMap<(String, u64), (String, String)>,
}

fn index() -> Index {
    let mut by_sha = HashMap::new();
    let mut by_name_size = HashMap::new();
    for m in models::catalog() {
        for q in &m.quants {
            by_sha.insert(q.sha256.clone(), (m.id.clone(), q.quant.clone()));
            by_name_size.insert((q.filename.to_lowercase(), q.size), (m.id.clone(), q.quant.clone()));
        }
    }
    Index { by_sha, by_name_size }
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth == 0 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') && depth < 6 {
            continue;
        }
        if ft.is_dir() {
            walk(&p, depth - 1, out);
        } else if (ft.is_file() || ft.is_symlink()) && name.to_lowercase().ends_with(".gguf") {
            out.push(p);
        }
    }
}

/// Scan all locations. Cheap: no hashing (exact matches come from hash-named blobs).
pub fn scan(extra: &[String], own_models: &Path) -> Vec<Found> {
    scan_locations(&locations(extra), own_models)
}

pub fn scan_locations(locs: &[Location], own_models: &Path) -> Vec<Found> {
    let idx = index();
    let mut out: Vec<Found> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let own = std::fs::canonicalize(own_models).unwrap_or_else(|_| own_models.to_path_buf());
    let mut push = |f: Found, out: &mut Vec<Found>| {
        let c = std::fs::canonicalize(&f.path).unwrap_or_else(|_| PathBuf::from(&f.path));
        if c.starts_with(&own) || !seen.insert(c) {
            return; // Grain's own files, or the same file reached twice (symlinks)
        }
        out.push(f);
    };
    for loc in locs {
        if !loc.dir.is_dir() {
            continue;
        }
        match loc.kind {
            Kind::HuggingFace => {
                for repo in std::fs::read_dir(&loc.dir).into_iter().flatten().flatten() {
                    let rname = repo.file_name().to_string_lossy().to_string();
                    let Some(rest) = rname.strip_prefix("models--") else { continue };
                    let owner = rest.split("--").next().unwrap_or_default();
                    let source = if owner == "handy-computer" { "Handy (Hugging Face cache)".to_string() } else { format!("Hugging Face cache ({})", rest.replacen("--", "/", 1)) };
                    for blob in std::fs::read_dir(repo.path().join("blobs")).into_iter().flatten().flatten() {
                        let sha = blob.file_name().to_string_lossy().to_string();
                        if let Some((id, quant)) = idx.by_sha.get(&sha) {
                            let size = blob.metadata().map(|m| m.len()).unwrap_or(0);
                            push(Found { path: blob.path().to_string_lossy().into(), size, source: source.clone(), model_id: Some(id.clone()), quant: Some(quant.clone()), hash_named: true, arch: None, name: None, role: None }, &mut out);
                        }
                    }
                }
            }
            Kind::Ollama => {
                for blob in std::fs::read_dir(&loc.dir).into_iter().flatten().flatten() {
                    let n = blob.file_name().to_string_lossy().to_string();
                    let Some(sha) = n.strip_prefix("sha256-") else { continue };
                    if let Some((id, quant)) = idx.by_sha.get(sha) {
                        let size = blob.metadata().map(|m| m.len()).unwrap_or(0);
                        push(Found { path: blob.path().to_string_lossy().into(), size, source: loc.source.clone(), model_id: Some(id.clone()), quant: Some(quant.clone()), hash_named: true, arch: None, name: None, role: None }, &mut out);
                    }
                }
            }
            Kind::Files => {
                let mut files = Vec::new();
                walk(&loc.dir, if loc.source == "Shared folder" { 4 } else { 6 }, &mut files);
                for p in files {
                    let Ok(meta) = std::fs::metadata(&p) else { continue };
                    let size = meta.len();
                    let fname = p.file_name().map(|f| f.to_string_lossy().to_lowercase()).unwrap_or_default();
                    // Exact name, or llama.cpp's cache names ("owner_repo_<file>").
                    let hit = idx.by_name_size.get(&(fname.clone(), size)).cloned().or_else(|| {
                        idx.by_name_size.iter().find(|((n, s), _)| *s == size && fname.ends_with(&format!("_{n}"))).map(|(_, v)| v.clone())
                    });
                    let f = if let Some((id, quant)) = hit {
                        Found { path: p.to_string_lossy().into(), size, source: loc.source.clone(), model_id: Some(id), quant: Some(quant), hash_named: false, arch: None, name: None, role: None }
                    } else {
                        // Not in the catalogue: describe it from its header so it can be offered.
                        if size < 20_000_000 || fname.contains("mmproj") || fname.contains("-of-0") {
                            continue; // too small to be useful, vision projectors, split shards
                        }
                        let Ok(h) = gguf_header(&p) else { continue };
                        let role = role_for(&h.arch, &fname, h.pooling);
                        Found { path: p.to_string_lossy().into(), size, source: loc.source.clone(), model_id: None, quant: None, hash_named: false, name: h.name, role, arch: Some(h.arch) }
                    };
                    push(f, &mut out);
                }
            }
        }
    }
    out
}

/// transcribe.cpp model families (GGUF `general.architecture`).
const ASR_ARCHS: &[&str] = &["parakeet", "whisper", "canary", "qwen3_asr", "qwen3-asr", "moonshine", "sensevoice", "granite_speech", "voxtral", "gigaam", "cohere_transcribe", "fun_asr", "nemotron", "moss"];

fn role_for(arch: &str, fname: &str, pooling: bool) -> Option<String> {
    let a = arch.to_lowercase();
    if ASR_ARCHS.iter().any(|x| a.contains(x)) {
        return Some("asr".into());
    }
    if pooling || fname.contains("embed") || a.contains("bert") {
        return Some("embed".into());
    }
    if a.is_empty() || a == "clip" {
        return None;
    }
    Some("llm".into())
}

pub struct Header {
    pub arch: String,
    pub name: Option<String>,
    pub pooling: bool,
}

/// Read `general.architecture` / `general.name` from a GGUF header (stops early; never reads weights).
pub fn gguf_header(path: &Path) -> Result<Header> {
    let file = std::fs::File::open(path)?;
    if !file.metadata()?.is_file() {
        bail!("not a regular file");
    }
    // Files here can come from other accounts (/Users/Shared): never read more than a header's worth.
    let mut f = std::io::BufReader::new(file).take(16 << 20);
    let mut magic = [0u8; 4];
    f.read_exact(&mut magic)?;
    if &magic != b"GGUF" {
        bail!("not a GGUF file");
    }
    let rd_u32 = |f: &mut dyn Read| -> Result<u32> { let mut b = [0u8; 4]; f.read_exact(&mut b)?; Ok(u32::from_le_bytes(b)) };
    let rd_u64 = |f: &mut dyn Read| -> Result<u64> { let mut b = [0u8; 8]; f.read_exact(&mut b)?; Ok(u64::from_le_bytes(b)) };
    let version = rd_u32(&mut f)?;
    if version < 2 {
        bail!("unsupported GGUF version");
    }
    let _tensors = rd_u64(&mut f)?;
    let kv = rd_u64(&mut f)?;
    let rd_str = |f: &mut dyn Read| -> Result<String> {
        let n = rd_u64(f)?;
        if n > 1 << 20 {
            bail!("string too long");
        }
        let mut b = vec![0u8; n as usize];
        f.read_exact(&mut b)?;
        Ok(String::from_utf8_lossy(&b).into_owned())
    };
    fn skip(f: &mut dyn Read, t: u32, rd_u32: &dyn Fn(&mut dyn Read) -> Result<u32>, rd_u64: &dyn Fn(&mut dyn Read) -> Result<u64>) -> Result<()> {
        let fixed = match t {
            0 | 1 | 7 => 1,
            2 | 3 => 2,
            4 | 5 | 6 => 4,
            10..=12 => 8,
            _ => 0,
        };
        fn skip_bytes(f: &mut dyn Read, n: u64) -> Result<()> {
            if std::io::copy(&mut Read::take(&mut *f, n), &mut std::io::sink())? != n {
                bail!("truncated GGUF header");
            }
            Ok(())
        }
        if fixed > 0 {
            return skip_bytes(f, fixed);
        }
        match t {
            8 => {
                let n = rd_u64(f)?;
                skip_bytes(f, n)?;
            }
            9 => {
                let et = rd_u32(f)?;
                let n = rd_u64(f)?;
                if et == 9 {
                    bail!("nested GGUF arrays are not supported"); // real files never nest; unbounded recursion would overflow the stack
                }
                for _ in 0..n {
                    skip(f, et, rd_u32, rd_u64)?;
                }
            }
            _ => bail!("bad GGUF value type {t}"),
        }
        Ok(())
    }
    let (mut arch, mut name, mut pooling) = (String::new(), None, false);
    for _ in 0..kv.min(4096) {
        let key = rd_str(&mut f)?;
        let t = rd_u32(&mut f)?;
        if t == 8 && (key == "general.architecture" || key == "general.name") {
            let v = rd_str(&mut f)?;
            if key == "general.architecture" { arch = v } else { name = Some(v) }
        } else {
            if key.ends_with(".pooling_type") {
                pooling = true;
            }
            skip(&mut f, t, &rd_u32, &rd_u64)?;
        }
        if !arch.is_empty() && name.is_some() {
            break;
        }
    }
    if arch.is_empty() {
        bail!("no architecture in header");
    }
    Ok(Header { arch, name, pooling })
}

extern "C" {
    // macOS libSystem: copy-on-write clone on APFS (no data copied).
    fn clonefile(src: *const std::os::raw::c_char, dst: *const std::os::raw::c_char, flags: u32) -> std::os::raw::c_int;
}

/// Clone `src` to `dst` on APFS. Returns false if cloning is not possible (e.g. another volume).
pub fn clone_file(src: &Path, dst: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let (Ok(s), Ok(d)) = (std::ffi::CString::new(src.as_os_str().as_bytes()), std::ffi::CString::new(dst.as_os_str().as_bytes())) else { return false };
    unsafe { clonefile(s.as_ptr(), d.as_ptr(), 0) == 0 }
}

/// Make a found file available at `dest` without copying data where possible.
/// Returns how: "clone" (APFS clone inside Grain's folder) or "reference" (used in place).
pub fn materialize(src: &Path, dest: &Path) -> Result<(PathBuf, &'static str)> {
    let src = std::fs::canonicalize(src).context("The file is no longer there")?;
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let _ = std::fs::remove_file(dest);
    if clone_file(&src, dest) {
        return Ok((dest.to_path_buf(), "clone"));
    }
    // Using a file in place lets its owner change it later; only do that for our own files.
    use std::os::unix::fs::MetadataExt;
    let mine = dest.parent().and_then(|d| std::fs::metadata(d).ok()).map(|m| m.uid());
    if mine != Some(std::fs::metadata(&src)?.uid()) {
        bail!("This file belongs to another user on this Mac and cannot be used in place");
    }
    Ok((src, "reference"))
}

/// Pick the found copy to use for a catalogue model: the requested quant if present, else any.
pub fn best_for<'a>(found: &'a [Found], m: &CatalogModel, quant: Option<&str>) -> Option<&'a Found> {
    let mine: Vec<&Found> = found.iter().filter(|f| f.model_id.as_deref() == Some(m.id.as_str())).collect();
    match quant {
        Some(q) => mine.into_iter().find(|f| f.quant.as_deref() == Some(q)),
        None => mine.iter().find(|f| f.quant.as_deref() == Some(m.quant.as_str())).copied().or(mine.first().copied()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gguf(path: &Path, arch: &str, name: &str, extra_kv: bool) {
        let mut b: Vec<u8> = b"GGUF".to_vec();
        b.extend(3u32.to_le_bytes());
        b.extend(0u64.to_le_bytes());
        let n = if extra_kv { 3u64 } else { 2 };
        b.extend(n.to_le_bytes());
        let s = |b: &mut Vec<u8>, v: &str| { b.extend((v.len() as u64).to_le_bytes()); b.extend(v.as_bytes()); };
        if extra_kv {
            // an array before the keys we want, to exercise skipping
            s(&mut b, "tokenizer.ggml.scores");
            b.extend(9u32.to_le_bytes());
            b.extend(6u32.to_le_bytes());
            b.extend(3u64.to_le_bytes());
            for _ in 0..3 { b.extend(0.5f32.to_le_bytes()); }
        }
        s(&mut b, "general.architecture"); b.extend(8u32.to_le_bytes()); s(&mut b, arch);
        s(&mut b, "general.name"); b.extend(8u32.to_le_bytes()); s(&mut b, name);
        b.resize(b.len() + 21_000_000, 0); // big enough to be considered
        std::fs::write(path, b).unwrap();
    }

    #[test]
    fn reads_gguf_headers() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("m.gguf");
        gguf(&p, "gemma4", "Gemma 4 12B", true);
        let h = gguf_header(&p).unwrap();
        assert_eq!(h.arch, "gemma4");
        assert_eq!(h.name.as_deref(), Some("Gemma 4 12B"));
        assert_eq!(role_for("gemma4", "m.gguf", false).as_deref(), Some("llm"));
        assert_eq!(role_for("parakeet", "x.gguf", false).as_deref(), Some("asr"));
        assert_eq!(role_for("qwen3", "qwen3-embedding.gguf", true).as_deref(), Some("embed"));
    }

    #[test]
    fn hostile_headers_fail_fast() {
        let d = tempfile::tempdir().unwrap();
        let head = |kv_type: u32| { let mut b = b"GGUF".to_vec(); b.extend(3u32.to_le_bytes()); b.extend(0u64.to_le_bytes()); b.extend(1u64.to_le_bytes()); b.extend(1u64.to_le_bytes()); b.push(b'k'); b.extend(kv_type.to_le_bytes()); b };
        // Deeply nested arrays: used to overflow the stack and abort the app.
        let mut nested = head(9);
        for _ in 0..200_000 { nested.extend(9u32.to_le_bytes()); nested.extend(1u64.to_le_bytes()); }
        // An array claiming u64::MAX elements, then EOF: used to spin forever.
        let mut huge = head(9);
        huge.extend(0u32.to_le_bytes());
        huge.extend(u64::MAX.to_le_bytes());
        for (name, bytes) in [("nested.gguf", nested), ("huge.gguf", huge)] {
            let p = d.path().join(name);
            std::fs::write(&p, bytes).unwrap();
            assert!(gguf_header(&p).is_err(), "{name}");
        }
    }

    #[test]
    fn finds_models_in_other_apps() {
        let d = tempfile::tempdir().unwrap();
        let cat = models::get("parakeet-unified-en-0.6b").unwrap();
        // Hugging Face cache, as Handy leaves it: blob named by SHA-256.
        let hf = d.path().join("hf");
        let blobs = hf.join("models--handy-computer--parakeet-unified-en-0.6b-gguf/blobs");
        std::fs::create_dir_all(&blobs).unwrap();
        std::fs::write(blobs.join(&cat.sha256), b"x").unwrap();
        std::fs::write(blobs.join("unrelated"), b"y").unwrap();
        // Ollama blob for the embedding model.
        let emb = models::get("qwen3-embedding-0.6b").unwrap();
        let ol = d.path().join("ollama");
        std::fs::create_dir_all(&ol).unwrap();
        std::fs::write(ol.join(format!("sha256-{}", emb.sha256)), b"z").unwrap();
        // LM Studio-style folder: a non-catalogue LLM and a vision projector to ignore.
        let lm = d.path().join("lms/pub/repo");
        std::fs::create_dir_all(&lm).unwrap();
        gguf(&lm.join("gemma-4-12B-Q4_0.gguf"), "gemma4", "Gemma 4", false);
        gguf(&lm.join("mmproj-gemma.gguf"), "clip", "proj", false);
        let own = d.path().join("own");
        std::fs::create_dir_all(&own).unwrap();
        let locs = vec![
            Location { dir: hf, source: "Hugging Face cache".into(), kind: Kind::HuggingFace },
            Location { dir: ol, source: "Ollama".into(), kind: Kind::Ollama },
            Location { dir: d.path().join("lms"), source: "LM Studio".into(), kind: Kind::Files },
            Location { dir: d.path().join("missing"), source: "x".into(), kind: Kind::Files },
        ];
        let found = scan_locations(&locs, &own);
        let p = found.iter().find(|f| f.model_id.as_deref() == Some("parakeet-unified-en-0.6b")).unwrap();
        assert_eq!(p.source, "Handy (Hugging Face cache)");
        assert!(p.hash_named);
        assert_eq!(p.quant.as_deref(), Some("Q8_0"));
        assert!(found.iter().any(|f| f.model_id.as_deref() == Some("qwen3-embedding-0.6b") && f.source == "Ollama"));
        let g = found.iter().find(|f| f.model_id.is_none()).unwrap();
        assert_eq!(g.role.as_deref(), Some("llm"));
        assert_eq!(found.len(), 3, "mmproj and unrelated files ignored: {found:?}");
        assert!(best_for(&found, cat, None).is_some());
        assert!(best_for(&found, cat, Some("Q4_K_M")).is_none());
    }

    #[test]
    fn clone_is_independent_of_the_original() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("a.gguf");
        std::fs::write(&src, b"GGUF data").unwrap();
        let (p, how) = materialize(&src, &d.path().join("grain/models/x/a.gguf")).unwrap();
        assert_eq!(how, "clone");
        std::fs::remove_file(&src).unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"GGUF data");
    }
}
