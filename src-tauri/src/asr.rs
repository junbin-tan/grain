//! Speech recognition: a dedicated engine thread owning the loaded transcribe.cpp
//! model, plus the meeting transcription pipeline (live chunked + post-meeting).
//!
//! Live mode is *chunked*, not native streaming: audio is cut at pauses into
//! 4–28 s pieces and each piece is transcribed as soon as it is complete, so text
//! appears a few seconds behind speech. This works with every model family.

use crate::audio::{self, RATE};
use crate::db::NewSegment;
use crate::Core;
use anyhow::{anyhow, Result};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};
use transcribe_cpp::{Model, RunOptions};

const IDLE_UNLOAD: Duration = Duration::from_secs(300);
const LIVE_MIN: usize = 4 * RATE;
const LIVE_MAX: usize = 28 * RATE;

#[derive(Debug, Clone)]
pub struct Piece {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub language: Option<String>,
}

struct Job {
    model_path: PathBuf,
    pcm: Vec<f32>,
    languages: Vec<String>,
    reply: tokio::sync::oneshot::Sender<Result<Vec<Piece>>>,
}

enum Msg {
    Job(Job),
    Unload,
}

/// Owns the native model on one thread; heavy inference never runs on the UI or capture path.
pub struct AsrEngine {
    tx: mpsc::Sender<Msg>,
}

impl Default for AsrEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl AsrEngine {
    pub fn new() -> AsrEngine {
        let (tx, rx) = mpsc::channel::<Msg>();
        std::thread::Builder::new()
            .name("grain-asr".into())
            .spawn(move || {
                let mut loaded: Option<(PathBuf, Model, transcribe_cpp::Session)> = None;
                loop {
                    let msg = match rx.recv_timeout(IDLE_UNLOAD) {
                        Ok(m) => m,
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            loaded = None; // release model memory when idle
                            continue;
                        }
                        Err(_) => break,
                    };
                    match msg {
                        Msg::Unload => loaded = None,
                        Msg::Job(job) => {
                            let r = run_job(&mut loaded, &job);
                            let _ = job.reply.send(r);
                        }
                    }
                }
            })
            .expect("spawn asr thread");
        AsrEngine { tx }
    }

    pub async fn transcribe(&self, model_path: &Path, pcm: Vec<f32>, languages: Vec<String>) -> Result<Vec<Piece>> {
        let (reply, rx) = tokio::sync::oneshot::channel();
        self.tx
            .send(Msg::Job(Job { model_path: model_path.to_path_buf(), pcm, languages, reply }))
            .map_err(|_| anyhow!("speech engine stopped"))?;
        rx.await.map_err(|_| anyhow!("speech engine crashed"))?
    }

    pub fn unload(&self) {
        let _ = self.tx.send(Msg::Unload);
    }
}

fn run_job(loaded: &mut Option<(PathBuf, Model, transcribe_cpp::Session)>, job: &Job) -> Result<Vec<Piece>> {
    if loaded.as_ref().map(|l| &l.0) != Some(&job.model_path) {
        *loaded = None;
        let model = Model::load(&job.model_path).map_err(|e| anyhow!("Could not load speech model: {e}"))?;
        let session = model.session().map_err(|e| anyhow!("Could not start speech model: {e}"))?;
        *loaded = Some((job.model_path.clone(), model, session));
    }
    let (_, model, session) = loaded.as_mut().unwrap();
    let caps = model.capabilities().ok();
    let supported: Vec<String> = caps.as_ref().map(|c| c.languages.clone()).unwrap_or_default();
    let detects = caps.as_ref().map(|c| c.supports_language_detect).unwrap_or(false);
    let language = pick_language(&job.languages, &supported, detects);
    let opts = RunOptions { language: language.clone(), ..Default::default() };
    let mut t = session.run(&job.pcm, &opts).map_err(|e| anyhow!("Transcription failed: {e}"))?;
    let mut lang = t.language.clone().or(language.clone());
    // Auto-detect keeps short English chunks English but, when a chunk is mostly English,
    // translates the CJK sentences in it. A CJK hint keeps those, but translates short
    // English-only chunks into CJK. So when auto-detect found no CJK, retry with the hint
    // and keep that result only if it is genuinely mixed (it kept the English words).
    if language.is_none() && !t.text.chars().any(is_cjk) {
        if let Some(cjk) = job.languages.iter().find(|l| KEEP_MIXED.contains(&l.as_str()) && supported.contains(l)) {
            if let Ok(t2) = session.run(&job.pcm, &RunOptions { language: Some(cjk.clone()), ..Default::default() }) {
                if kept_as_spoken(&t.text, &t2.text) {
                    t = t2;
                    lang = Some(cjk.clone());
                }
            }
        }
    }
    let dur = (job.pcm.len() * 1000 / RATE) as i64;
    let words: Vec<(i64, i64, String)> = t.words.iter().filter(|w| w.t1_ms > 0).map(|w| (w.t0_ms, w.t1_ms, w.text.clone())).collect();
    let mut out: Vec<Piece> = if !words.is_empty() {
        sentences(&words).into_iter().map(|(a, b, text)| Piece { start_ms: a, end_ms: b.min(dur), text, language: lang.clone() }).collect()
    } else {
        t.segments
            .iter()
            .filter(|s| !s.text.trim().is_empty() && s.t1_ms > s.t0_ms)
            .map(|s| Piece { start_ms: s.t0_ms, end_ms: s.t1_ms.min(dur), text: s.text.trim().to_string(), language: lang.clone() })
            .collect()
    };
    if out.is_empty() && !t.text.trim().is_empty() {
        // Families without timestamps (e.g. Qwen3-ASR) return chunk-level text.
        out.push(Piece { start_ms: 0, end_ms: dur, text: t.text.trim().to_string(), language: lang });
    }
    Ok(out)
}

fn latin_words(s: &str) -> usize {
    s.split(|c: char| !c.is_ascii_alphabetic()).filter(|w| !w.is_empty()).count()
}

/// True if `hinted` (a CJK-hinted run) holds CJK speech that `auto` translated away,
/// rather than being a CJK translation of English speech: it kept most English words
/// and has a real CJK phrase, not a single translated word like "或" for "Or".
fn kept_as_spoken(auto: &str, hinted: &str) -> bool {
    hinted.chars().filter(|c| is_cjk(*c)).count() >= 4 && latin_words(hinted) * 2 >= latin_words(auto)
}

fn is_cjk(c: char) -> bool {
    matches!(c as u32, 0x3040..=0x30FF | 0x3400..=0x9FFF | 0xAC00..=0xD7AF | 0xF900..=0xFAFF | 0xFF00..=0xFFEF)
}

/// Join word tokens into sentence-level pieces. Word timings from transcribe.cpp
/// absorb trailing silence into the last word, so sentence-final punctuation is
/// the reliable boundary; a sentence ends where the next one starts.
pub fn sentences(words: &[(i64, i64, String)]) -> Vec<(i64, i64, String)> {
    let mut out: Vec<(i64, i64, String)> = Vec::new();
    let mut cur = String::new();
    let mut start = 0;
    for (i, (t0, t1, w)) in words.iter().enumerate() {
        if cur.is_empty() {
            start = *t0;
        }
        let needs_space = !cur.is_empty()
            && !w.starts_with(char::is_whitespace)
            && !cur.ends_with(char::is_whitespace)
            && !(cur.chars().last().map(is_cjk).unwrap_or(false) && w.chars().next().map(is_cjk).unwrap_or(false));
        if needs_space {
            cur.push(' ');
        }
        cur.push_str(w);
        let end_sentence = w.trim_end().ends_with(['.', '?', '!', '。', '？', '！']);
        let last = i + 1 == words.len();
        if (end_sentence && cur.trim().chars().count() >= 2) || last {
            let end = if last { *t1 } else { words[i + 1].0.min(*t1) };
            out.push((start, end.max(start), cur.trim().to_string()));
            cur.clear();
        }
    }
    out
}

/// Languages for which a hint keeps mixed English speech in place: with an English
/// hint (or English auto-detected), Qwen3-ASR was observed translating the other
/// language into English; with a Chinese hint it kept both languages as spoken, but
/// translated short English-only chunks into Chinese (see `run_job`).
const KEEP_MIXED: &[&str] = &["zh", "yue", "ja", "ko"];

/// The language hint to pass: a single preferred language the model supports; otherwise
/// let the model detect it (or, for models that cannot detect, its first supported language).
pub fn pick_language(preferred: &[String], supported: &[String], detects: bool) -> Option<String> {
    let usable: Vec<&String> = preferred.iter().filter(|l| supported.iter().any(|s| s == *l)).collect();
    if preferred.len() == 1 && usable.len() == 1 {
        return Some(usable[0].clone());
    }
    // Models that detect language auto-detect; `run_job` retries with the CJK hint.
    if usable.len() > 1 && !detects {
        if let Some(l) = usable.iter().find(|l| KEEP_MIXED.contains(&l.as_str())) {
            return Some((*l).clone());
        }
    }
    if detects || supported.len() <= 1 {
        return if supported.len() == 1 { Some(supported[0].clone()) } else { None };
    }
    usable.first().map(|s| (*s).clone()).or_else(|| supported.first().cloned())
}

fn speaker_for(source: &str, has_both: bool) -> &'static str {
    match (source, has_both) {
        ("system", _) => "Them",
        (_, true) => "Me",
        _ => "Room",
    }
}

pub fn meeting_dir(core: &Core, meeting_id: &str) -> PathBuf {
    core.paths.recordings.join(meeting_id)
}

/// For deleting: an id like "", ".." or "/x" would point outside the meeting's own folder.
pub fn checked_meeting_dir(core: &Core, meeting_id: &str) -> Result<PathBuf> {
    if uuid::Uuid::parse_str(meeting_id).is_err() {
        return Err(anyhow!("Not a meeting id: {meeting_id:?}"));
    }
    Ok(meeting_dir(core, meeting_id))
}

/// The speech model to use and the language hints, from settings.
pub fn asr_config(core: &Core) -> Result<(String, PathBuf, Vec<String>)> {
    let id = core.db.setting_str("asrModel").ok_or_else(|| anyhow!("No speech model selected. Download one in Models."))?;
    let m = core.db.installed_model(&id)?.ok_or_else(|| anyhow!("The speech model {id} is not installed. Download it in Models."))?;
    let lang = core.db.setting_str("asrLanguage").unwrap_or_else(|| "auto".into());
    let langs: Vec<String> = if lang == "auto" {
        core.db.get_setting("languages").ok().flatten().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
    } else {
        vec![lang]
    };
    Ok((id, PathBuf::from(m.path), langs))
}

/// Transcribe one chunk of one track and store the resulting segments.
async fn transcribe_piece(core: &Arc<Core>, meeting_id: &str, source: &str, has_both: bool, path: &Path, from: usize, to: usize, cfg: &(String, PathBuf, Vec<String>)) -> Result<usize> {
    let mut pcm = audio::read_pcm(path, from, to)?;
    if source == "mic" && has_both {
        let system = audio::read_pcm(&path.with_file_name("system.pcm"), from, to)?;
        audio::suppress_echo(&mut pcm, &system);
    }
    if audio::speech_seconds(&pcm) < 0.3 {
        return Ok(0); // silence: skip (prevents hallucinated text on quiet tracks)
    }
    let offset = (from * 1000 / RATE) as i64;
    let pieces = core.asr.transcribe(&cfg.1, pcm, cfg.2.clone()).await?;
    let segs: Vec<NewSegment> = pieces
        .into_iter()
        .map(|p| NewSegment {
            source: source.into(),
            speaker: Some(speaker_for(source, has_both).into()),
            start_ms: offset + p.start_ms,
            end_ms: offset + p.end_ms,
            text: p.text,
            language: p.language,
            model_id: cfg.0.clone(),
        })
        .collect();
    let n = segs.len();
    if n > 0 {
        let saved = core.db.insert_segments(meeting_id, &segs)?;
        (core.emit)("transcript", json!({"meetingId": meeting_id, "segments": saved}));
    }
    Ok(n)
}

fn tracks(core: &Core, meeting_id: &str) -> Vec<(String, PathBuf)> {
    let dir = meeting_dir(core, meeting_id);
    ["mic", "system"].iter().map(|s| (s.to_string(), dir.join(format!("{s}.pcm")))).filter(|(_, p)| p.exists()).collect()
}

/// Live loop: runs while recording, transcribing completed chunks as they appear.
/// When `stop` flips, flushes the remaining audio and returns.
pub async fn live_loop(core: Arc<Core>, meeting_id: String, start_at: std::collections::HashMap<String, usize>, mut stop: tokio::sync::watch::Receiver<bool>) {
    let cfg = match asr_config(&core) {
        Ok(c) => c,
        Err(e) => {
            (core.emit)("transcription-status", json!({"meetingId": meeting_id, "state": "unavailable", "error": e.to_string()}));
            return;
        }
    };
    let mut cursors = start_at;
    loop {
        let finishing = *stop.borrow();
        let ts = tracks(&core, &meeting_id);
        let has_both = ts.len() > 1;
        for (source, path) in &ts {
            let cursor = cursors.entry(source.clone()).or_insert(0);
            loop {
                let len = audio::pcm_samples(path);
                let pending = len.saturating_sub(*cursor);
                let cut = if finishing {
                    if pending == 0 {
                        break;
                    }
                    if pending <= LIVE_MAX {
                        pending
                    } else {
                        let pcm = audio::read_pcm(path, *cursor, *cursor + LIVE_MAX).unwrap_or_default();
                        audio::find_cut(&pcm, LIVE_MIN, LIVE_MAX).unwrap_or(LIVE_MAX)
                    }
                } else {
                    if pending < LIVE_MIN {
                        break;
                    }
                    let pcm = audio::read_pcm(path, *cursor, *cursor + pending.min(LIVE_MAX)).unwrap_or_default();
                    // Only cut at a pause that has finished (leave 300 ms of look-ahead).
                    match audio::find_cut(&pcm, LIVE_MIN, pcm.len().saturating_sub(RATE * 3 / 10)) {
                        Some(c) => c,
                        None if pending >= LIVE_MAX => LIVE_MAX,
                        None => break,
                    }
                };
                if let Err(e) = transcribe_piece(&core, &meeting_id, source, has_both, path, *cursor, *cursor + cut, &cfg).await {
                    (core.emit)("transcription-status", json!({"meetingId": meeting_id, "state": "error", "error": e.to_string()}));
                }
                *cursor += cut;
                if !finishing {
                    break; // one chunk per track per tick keeps both tracks moving
                }
            }
        }
        if finishing {
            break;
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_millis(1000)) => {}
            _ = stop.changed() => {}
        }
    }
    dedupe(&core, &meeting_id);
}

pub fn dedupe(core: &Core, meeting_id: &str) {
    if let Ok(segs) = core.db.segments(meeting_id) {
        let dup = audio::echo_duplicates(&segs);
        if !dup.is_empty() {
            let _ = core.db.delete_segment_ids(&dup);
        }
    }
}

/// Post-meeting (re)transcription of the full recording with the selected model.
/// Replaces the existing transcript (user corrections are lost; the UI warns first).
pub async fn transcribe_meeting(core: Arc<Core>, meeting_id: String) -> Result<usize> {
    let cfg = asr_config(&core)?;
    let ts = tracks(&core, &meeting_id);
    if ts.is_empty() {
        return Err(anyhow!("This meeting has no audio recording to transcribe."));
    }
    core.db.delete_segments(&meeting_id)?;
    let has_both = ts.len() > 1;
    let mut plans = Vec::new();
    for (source, path) in &ts {
        let pcm = audio::read_pcm(path, 0, audio::pcm_samples(path))?;
        for (a, b) in audio::plan_chunks(&pcm, LIVE_MAX) {
            plans.push((source.clone(), path.clone(), a, b));
        }
    }
    let total: usize = plans.iter().map(|p| p.3 - p.2).sum::<usize>().max(1);
    let mut done = 0usize;
    let mut n = 0;
    let started = Instant::now();
    (core.emit)("transcription-status", json!({"meetingId": meeting_id, "state": "running", "progress": 0.0}));
    for (source, path, a, b) in plans {
        n += transcribe_piece(&core, &meeting_id, &source, has_both, &path, a, b, &cfg).await?;
        done += b - a;
        (core.emit)("transcription-status", json!({"meetingId": meeting_id, "state": "running", "progress": done as f64 / total as f64}));
    }
    dedupe(&core, &meeting_id);
    let audio_s = total as f64 / RATE as f64;
    (core.emit)(
        "transcription-status",
        json!({"meetingId": meeting_id, "state": "done", "segments": n, "audioSeconds": audio_s, "elapsedSeconds": started.elapsed().as_secs_f64(), "modelId": cfg.0}),
    );
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::pick_language;

    fn v(x: &[&str]) -> Vec<String> {
        x.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn language_hint() {
        // single preferred, supported -> force it
        assert_eq!(pick_language(&v(&["zh"]), &v(&["en", "zh"]), true), Some("zh".into()));
        // English + Chinese, detecting model: auto-detect (run_job retries with the zh hint)
        assert_eq!(pick_language(&v(&["en", "zh"]), &v(&["en", "zh"]), true), None);
        // English + Chinese, non-detecting model: hint Chinese so Chinese is not translated
        assert_eq!(pick_language(&v(&["en", "zh"]), &v(&["en", "zh"]), false), Some("zh".into()));
        // English + Malay with detection -> autodetect
        assert_eq!(pick_language(&v(&["en", "ms"]), &v(&["en", "ms"]), true), None);
        // english-only model
        assert_eq!(pick_language(&v(&["en", "zh"]), &v(&["en"]), false), Some("en".into()));
        // multilingual model without detection -> first usable preference
        assert_eq!(pick_language(&v(&["fr", "en"]), &v(&["en", "de", "fr"]), false), Some("fr".into()));
        // preference unsupported, no detection -> model default
        assert_eq!(pick_language(&v(&["zh"]), &v(&["en", "de"]), false), Some("en".into()));
    }

    #[test]
    fn mixed_retry_choice() {
        // Outputs observed from Qwen3-ASR 1.7B on real and synthetic clips.
        let auto_mixed = "Okay, let's review the launch plan for next week. I think the design part still needs to be changed. Sure, I will send the updated mockups tomorrow.";
        let zh_mixed = "Okay, let's review the launch plan for next week. 我觉得设计部分还需要再改一下，客户不太满意。 Sure, I will send the updated mockups tomorrow.";
        assert!(super::kept_as_spoken(auto_mixed, zh_mixed));
        let auto_en = "Or how the application should actually work, the AI will do all of that for you.";
        assert!(!super::kept_as_spoken(auto_en, "或如何应用应该实际工作，AI将做所有这些对于你。"));
        assert!(!super::kept_as_spoken("It will generate an image.", "它将生成一个。"));
        assert!(!super::kept_as_spoken("Or just skip all that.", "或，just skip all that."));
    }

    #[test]
    fn sentence_pieces() {
        let w = |a, b, t: &str| (a, b, t.to_string());
        let words = vec![w(640, 720, "Thanks"), w(720, 800, "for"), w(880, 3040, "joining."), w(3120, 3680, "Agreed,"), w(3840, 3920, "ship"), w(4000, 7120, "Friday."), w(7120, 7440, "Priya"), w(7440, 9120, "writes.")];
        let s = super::sentences(&words);
        assert_eq!(s.len(), 3);
        assert_eq!(s[0], (640, 3040, "Thanks for joining.".to_string()));
        assert_eq!(s[1].0, 3120);
        assert_eq!(s[2], (7120, 9120, "Priya writes.".to_string()));
        let cjk = super::sentences(&[w(0, 100, "我们"), w(100, 200, "发布。"), w(300, 400, "OK")]);
        assert_eq!(cjk[0].2, "我们发布。");
        assert_eq!(cjk[1].2, "OK");
    }
}
