//! Real end-to-end test of Grain's backend: real downloads, real capture, real
//! models, no mocks. Prints a JSON report.
//!
//!   cargo run --release --example e2e -- download <data_dir>
//!   cargo run --release --example e2e -- run <data_dir> <report.json> [--no-capture] [--asr a,b,c]
//!
//! `run` needs no network: run it under scripts/offline.sh to prove that.
//! Test audio is synthesised with macOS `say` voices, so error rates measured here
//! are on clean synthetic speech and are optimistic compared with real meetings.

use grain_lib::{audio, db::NewSegment, Core, Emit};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Instant;

const ASR_DEFAULT: &[&str] = &["parakeet-unified-en-0.6b", "Qwen3-ASR-0.6B"];
const LLM: &str = "qwen3-4b-instruct-2507";
const EMBED: &str = "qwen3-embedding-0.6b";

fn tts(voice: &str, text: &str, tmp: &Path) -> Vec<f32> {
    let aiff = tmp.join("tts.aiff");
    let wav = tmp.join("tts.wav");
    let ok = Command::new("say").args(["-v", voice, "-o"]).arg(&aiff).arg(text).status().unwrap().success();
    assert!(ok, "say failed for {voice}");
    let ok = Command::new("afconvert").args(["-f", "WAVE", "-d", "LEI16@16000", "-c", "1"]).arg(&aiff).arg(&wav).status().unwrap().success();
    assert!(ok, "afconvert failed");
    let mut r = hound::WavReader::open(&wav).unwrap();
    r.samples::<i16>().map(|s| s.unwrap() as f32 / 32768.0).collect()
}

fn write_pcm(path: &Path, pcm: &[f32]) {
    let bytes: Vec<u8> = pcm.iter().flat_map(|s| ((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes()).collect();
    std::fs::write(path, bytes).unwrap();
}

/// Mixed error rate: words for space-delimited scripts, characters for CJK/kana/hangul.
fn tokens(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut w = String::new();
    for c in s.to_lowercase().chars() {
        let cjk = matches!(c as u32, 0x3040..=0x30FF | 0x3400..=0x9FFF | 0xAC00..=0xD7AF | 0xF900..=0xFAFF);
        if c.is_alphanumeric() && !cjk {
            w.push(c);
            continue;
        }
        if !w.is_empty() {
            out.push(std::mem::take(&mut w));
        }
        if cjk {
            out.push(c.to_string());
        }
    }
    if !w.is_empty() {
        out.push(w);
    }
    out
}

/// Traditional -> Simplified for the characters used in the test references, so a
/// Cantonese transcript written in Simplified script is not scored as wrong.
fn simplify(s: &str) -> String {
    let pairs = [('個', '个'), ('禮', '礼'), ('報', '报'), ('場', '场'), ('兩', '两'), ('時', '时'), ('間', '间'), ('們', '们'), ('這', '这'), ('會', '会'), ('說', '说'), ('對', '对'), ('後', '后'), ('問', '问'), ('題', '题'), ('實', '实'), ('現', '现'), ('發', '发'), ('開', '开'), ('關', '关'), ('與', '与'), ('為', '为'), ('來', '来'), ('頭', '头'), ('週', '周'), ('貴', '贵')];
    s.chars().map(|c| pairs.iter().find(|p| p.0 == c).map(|p| p.1).unwrap_or(c)).collect()
}

fn error_rate(reference: &str, hyp: &str) -> f64 {
    let (r, h) = (tokens(reference), tokens(hyp));
    let mut d: Vec<usize> = (0..=h.len()).collect();
    for i in 1..=r.len() {
        let mut prev = d[0];
        d[0] = i;
        for j in 1..=h.len() {
            let tmp = d[j];
            d[j] = if r[i - 1] == h[j - 1] { prev } else { 1 + prev.min(d[j]).min(d[j - 1]) };
            prev = tmp;
        }
    }
    d[h.len()] as f64 / r.len().max(1) as f64
}

fn core(dir: &Path, quiet: bool) -> Arc<Core> {
    let emit: Emit = Arc::new(move |name: &str, v: Value| {
        if quiet && (name == "capture" || name == "transcript" || name == "chat-token") {
            return;
        }
        if name == "model-download" && v["state"] == "downloading" {
            let pct = v["downloaded"].as_f64().unwrap_or(0.0) / v["total"].as_f64().unwrap_or(1.0) * 100.0;
            if (pct as i64) % 10 != 0 {
                return;
            }
        }
        eprintln!("[event] {name} {}", v.to_string().chars().take(200).collect::<String>());
    });
    Core::new(dir, emit, Arc::new(|_| {})).unwrap()
}

async fn download(dir: &Path, ids: &[String]) {
    let c = core(dir, true);
    for id in ids {
        if c.db.installed_model(id).unwrap().is_some() {
            eprintln!("{id}: already installed");
            continue;
        }
        let t = Instant::now();
        match c.downloads.download(&c.db, &c.paths.models, id, None, &[], false, &c.emit).await {
            Ok(m) => eprintln!("{id}: installed ({} MB in {:.0}s, sha256 verified)", m.size / 1_000_000, t.elapsed().as_secs_f64()),
            Err(e) => eprintln!("{id}: FAILED {e}"),
        }
    }
}

fn arg_after(args: &[String], flag: &str) -> Option<String> {
    args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1).cloned())
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).cloned().unwrap_or_default();
    let dir = PathBuf::from(args.get(2).expect("data dir"));
    let asr_ids: Vec<String> = arg_after(&args, "--asr").map(|s| s.split(',').map(String::from).collect()).unwrap_or(ASR_DEFAULT.iter().map(|s| s.to_string()).collect());
    if mode == "download" {
        let mut ids = asr_ids.clone();
        ids.push(LLM.into());
        ids.push(EMBED.into());
        download(&dir, &ids).await;
        return;
    }
    let report_path = PathBuf::from(args.get(3).expect("report path"));
    let mut report = json!({"startedAt": chrono::Local::now().to_rfc3339(), "machine": grain_lib::hardware::detect(&dir)});
    let c = core(&dir, true);
    // Fresh meeting state each run; downloaded models are kept.
    for m in c.db.list_meetings().unwrap() {
        c.delete_meeting(&m.id).unwrap();
    }
    let tmp = tempfile::tempdir().unwrap();
    report["network"] = json!({"huggingfaceReachable": Command::new("curl").args(["-s", "-o", "/dev/null", "-m", "5", "-w", "%{http_code}", "https://huggingface.co"]).output().map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default()});

    // ---------- 1. capture: real system audio through ScreenCaptureKit ----------
    let capture_ref = "The quarterly report is due next Tuesday and the marketing team needs two more weeks to finish the campaign.";
    if !args.iter().any(|a| a == "--no-capture") {
        let m = c.db.create_meeting("Capture test", "general").unwrap();
        c.db.set_setting("transcriptionMode", &json!("after")).unwrap();
        c.db.set_setting("asrModel", &json!(asr_ids[0])).unwrap();
        c.db.set_setting("languages", &json!(["en"])).unwrap();
        let t = Instant::now();
        let r = grain_lib::capture::start(c.clone(), m.id.clone(), Some("none".into()), true).await;
        let mut res = json!({"started": r.is_ok(), "error": r.as_ref().err().map(|e| e.to_string())});
        if r.is_ok() {
            tokio::time::sleep(std::time::Duration::from_millis(800)).await;
            Command::new("say").args(["-v", "Samantha", capture_ref]).status().unwrap();
            grain_lib::capture::pause(&c).await.unwrap();
            Command::new("say").args(["-v", "Samantha", "This sentence is spoken while paused and must not be recorded."]).status().unwrap();
            grain_lib::capture::resume(&c).await.unwrap();
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
            grain_lib::capture::stop(&c).await.unwrap();
            for _ in 0..240 {
                if c.db.get_meeting(&m.id).unwrap().status != "processing" && c.capture.lock().await.is_none() && c.db.get_meeting(&m.id).unwrap().status != "recording" {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
            let meeting = c.db.get_meeting(&m.id).unwrap();
            let text: String = c.db.segments(&m.id).unwrap().iter().map(|s| s.text.clone()).collect::<Vec<_>>().join(" ");
            let recs = c.db.recordings(&m.id).unwrap();
            res = json!({
                "started": true, "status": meeting.status, "durationMs": meeting.duration_ms, "wallSeconds": t.elapsed().as_secs_f64(),
                "recordings": recs, "transcript": text, "wer": error_rate(capture_ref, &text),
                "pausedSpeechLeaked": text.to_lowercase().contains("paused"),
            });
        }
        eprintln!("capture: {res}");
        report["capture"] = res;
        c.db.set_setting("transcriptionMode", &json!("live")).unwrap();
    }

    // ---------- 2. ASR accuracy across languages and models ----------
    let clips: Vec<(&str, &str, &str)> = vec![
        ("en", "Samantha", capture_ref),
        ("zh", "Tingting", "我们下周二之前需要完成季度报告，市场团队还需要两周时间。"),
        ("yue", "Sinji", "我哋下個禮拜二之前要完成季度報告，市場部仲需要兩個禮拜。"),
        ("ms", "Amira", "Laporan suku tahunan perlu disiapkan sebelum hari Selasa depan."),
        ("id", "Damayanti", "Laporan triwulanan harus selesai sebelum hari Selasa depan."),
        ("ja", "Kyoko", "四半期報告書は来週の火曜日までに完成させる必要があります。"),
        ("ko", "Yuna", "분기 보고서는 다음 주 화요일까지 완성해야 합니다."),
    ];
    let mut audio_cache: Vec<(String, String, Vec<f32>)> = clips.iter().map(|(l, v, t)| (l.to_string(), t.to_string(), tts(v, t, tmp.path()))).collect();
    // English-only speech with an English+Mandarin preference: must stay English.
    audio_cache.push(("en~hint:en+zh".into(), capture_ref.into(), audio_cache[0].2.clone()));
    // Code-switching: English and Mandarin in one clip (inter-sentential switching).
    let mut cs = tts("Samantha", "Let's finalise the budget today.", tmp.path());
    cs.extend(vec![0.0; 4000]);
    cs.extend(tts("Tingting", "我觉得这个价格太贵了。", tmp.path()));
    cs.extend(vec![0.0; 4000]);
    cs.extend(tts("Samantha", "Can we get a discount?", tmp.path()));
    audio_cache.push(("en+zh".into(), "Let's finalise the budget today. 我觉得这个价格太贵了。 Can we get a discount?".into(), cs));
    // Malay-English code-switching (Singapore/Malaysia style).
    let mut cs2 = tts("Samantha", "Okay team, the deadline is Friday.", tmp.path());
    cs2.extend(vec![0.0; 4000]);
    cs2.extend(tts("Amira", "Saya akan siapkan laporan itu.", tmp.path()));
    audio_cache.push(("en+ms".into(), "Okay team, the deadline is Friday. Saya akan siapkan laporan itu.".into(), cs2));
    // Background noise: English clip + white noise at ~15 dB SNR.
    let clean = audio_cache[0].2.clone();
    let rms = (clean.iter().map(|x| x * x).sum::<f32>() / clean.len() as f32).sqrt();
    let mut seed = 12345u32;
    let noisy: Vec<f32> = clean
        .iter()
        .map(|x| {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            x + (seed as f32 / u32::MAX as f32 - 0.5) * 2.0 * rms * 0.18 * 1.732
        })
        .collect();
    audio_cache.push(("en-noise15dB".into(), capture_ref.into(), noisy));

    let mut asr_results = Vec::new();
    for id in &asr_ids {
        let Some(m) = c.db.installed_model(id).unwrap() else {
            asr_results.push(json!({"model": id, "error": "not installed"}));
            continue;
        };
        let langs = grain_lib::models::get(id).map(|m| m.languages.clone()).unwrap_or_default();
        // Silence must produce nothing (gated before the model).
        let silence_gated = audio::speech_seconds(&vec![0.0; 16000 * 5]) < 0.3;
        let mut rows = Vec::new();
        for (lang, reference, pcm) in &audio_cache {
            let spec = lang.split("~hint:").last().unwrap();
            let base: Vec<String> = spec.split('+').map(|l| l.split('-').next().unwrap().to_string()).collect();
            if !base.iter().all(|l| langs.contains(l)) {
                continue;
            }
            // Same language-hint policy as the app (asr::pick_language runs inside the engine).
            let hint = base.clone();
            let t = Instant::now();
            let r = c.asr.transcribe(Path::new(&m.path), pcm.clone(), hint).await;
            let secs = t.elapsed().as_secs_f64();
            let audio_s = pcm.len() as f64 / 16000.0;
            match r {
                Ok(p) => {
                    let text = p.iter().map(|x| x.text.clone()).collect::<Vec<_>>().join(" ");
                    rows.push(json!({"clip": lang, "reference": reference, "hypothesis": text, "errorRate": error_rate(reference, &text), "errorRateScriptNormalized": error_rate(&simplify(reference), &simplify(&text)), "audioSeconds": audio_s, "seconds": secs, "realtimeFactor": audio_s / secs, "language": p.first().and_then(|x| x.language.clone())}));
                }
                Err(e) => rows.push(json!({"clip": lang, "error": e.to_string()})),
            }
        }
        eprintln!("asr {id}: {}", serde_json::to_string(&rows).unwrap());
        asr_results.push(json!({"model": id, "silenceGated": silence_gated, "clips": rows}));
    }
    report["asr"] = json!(asr_results);

    // ---------- 3. Meeting pipeline: two-track conversation -> transcript -> notes ----------
    let script: Vec<(&str, &str)> = vec![
        ("system", "Thanks for joining everyone. Let's review the Atlas launch. The beta build passed QA yesterday."),
        ("mic", "Great news. I think we should ship the beta to customers on Friday."),
        ("system", "Agreed. Let's ship the beta on Friday. Priya will write the release notes by Thursday."),
        ("mic", "I'll update the pricing page before the launch."),
        ("system", "One open question is whether we offer an annual discount. We haven't decided that yet."),
        ("mic", "Maybe someone could look into a referral program at some point."),
        ("system", "The customer from Northwind said the price of forty dollars per seat is too high for small teams."),
        ("mic", "Okay. So the decision is we keep forty dollars for now and revisit pricing in January."),
    ];
    let (mut mic, mut sys) = (Vec::new(), Vec::new());
    for (who, line) in &script {
        let pcm = tts(if *who == "mic" { "Daniel" } else { "Samantha" }, line, tmp.path());
        let gap = vec![0.0f32; 8000];
        let (me, other) = if *who == "mic" { (&mut mic, &mut sys) } else { (&mut sys, &mut mic) };
        other.extend(vec![0.0; pcm.len()]);
        me.extend(pcm);
        me.extend(gap.clone());
        other.extend(gap);
    }
    let m = c.db.create_meeting("", "product").unwrap();
    let mdir = grain_lib::asr::meeting_dir(&c, &m.id);
    std::fs::create_dir_all(&mdir).unwrap();
    write_pcm(&mdir.join("mic.pcm"), &mic);
    write_pcm(&mdir.join("system.pcm"), &sys);
    c.db.upsert_recording(&m.id, "mic", &mdir.join("mic.pcm").to_string_lossy(), (mic.len() / 16) as i64, "complete").unwrap();
    c.db.upsert_recording(&m.id, "system", &mdir.join("system.pcm").to_string_lossy(), (sys.len() / 16) as i64, "complete").unwrap();
    c.db.mark_started(&m.id).unwrap();
    c.db.mark_ended(&m.id, (mic.len() / 16) as i64).unwrap();
    c.db.set_status(&m.id, "done").unwrap();
    c.db.save_manual_note(&m.id, "Atlas launch\n- ship date?\n- pricing feedback from Northwind").unwrap();
    c.db.set_setting("asrModel", &json!(asr_ids[0])).unwrap();
    c.db.set_setting("languages", &json!(["en"])).unwrap();
    c.db.set_setting("llmModel", &json!(LLM)).unwrap();
    if c.db.installed_model(EMBED).unwrap().is_some() {
        c.db.set_setting("embedModel", &json!(EMBED)).unwrap();
    }
    let t = Instant::now();
    let n = grain_lib::asr::transcribe_meeting(c.clone(), m.id.clone()).await;
    let segs = c.db.segments(&m.id).unwrap();
    let full_ref = script.iter().map(|x| x.1).collect::<Vec<_>>().join(" ");
    let full_hyp = segs.iter().map(|s| s.text.clone()).collect::<Vec<_>>().join(" ");
    report["meetingTranscript"] = json!({
        "segments": n.as_ref().ok(), "error": n.as_ref().err().map(|e| e.to_string()), "seconds": t.elapsed().as_secs_f64(),
        "wer": error_rate(&full_ref, &full_hyp),
        "speakers": segs.iter().map(|s| format!("{}: {}", s.speaker.clone().unwrap_or_default(), s.text)).collect::<Vec<_>>(),
    });
    eprintln!("meeting transcript: {}", report["meetingTranscript"]);

    let t = Instant::now();
    let note = grain_lib::notes::enhance(c.clone(), &m.id, None).await;
    let actions = c.db.action_items(Some(&m.id)).unwrap();
    report["enhance"] = json!({
        "seconds": t.elapsed().as_secs_f64(),
        "error": note.as_ref().err().map(|e| e.to_string()),
        "title": c.db.get_meeting(&m.id).unwrap().title,
        "markdown": note.as_ref().ok().map(|n| n.content.clone()),
        "structured": note.as_ref().ok().and_then(|n| n.structured.clone()),
        "actionItems": actions,
    });
    eprintln!("enhance: {:.1}s\n{}", t.elapsed().as_secs_f64(), note.as_ref().map(|n| n.content.clone()).unwrap_or_else(|e| e.to_string()));

    // Long-meeting path (map-reduce): same meeting with a small context window forces windowing.
    if std::env::var("GRAIN_E2E_SKIP_LONG").is_err() {
        let long = c.db.create_meeting("Long meeting (map-reduce test)", "general").unwrap();
        let mut ls: Vec<NewSegment> = Vec::new();
        for rep in 0..6 {
            for (i, s) in segs.iter().enumerate() {
                ls.push(NewSegment { source: s.source.clone(), speaker: s.speaker.clone(), start_ms: rep * 60_000 + i as i64 * 6000, end_ms: rep * 60_000 + i as i64 * 6000 + 5000, text: s.text.clone(), language: s.language.clone(), model_id: s.model_id.clone() });
            }
        }
        c.db.insert_segments(&long.id, &ls).unwrap();
        c.llm.stop_all().await;
        std::env::set_var("GRAIN_LLM_CTX", "4096");
        let t = Instant::now();
        let r = grain_lib::notes::enhance(c.clone(), &long.id, None).await;
        std::env::remove_var("GRAIN_LLM_CTX");
        c.llm.stop_all().await;
        let la = c.db.action_items(Some(&long.id)).unwrap();
        report["enhanceLong"] = json!({"seconds": t.elapsed().as_secs_f64(), "segments": ls.len(), "error": r.as_ref().err().map(|e| e.to_string()), "actionItems": la.iter().map(|a| &a.description).collect::<Vec<_>>(), "markdown": r.ok().map(|n| n.content)});
        eprintln!("long: {}", report["enhanceLong"]);
    }

    // ---------- 4. Search, semantic index, Ask Grain ----------
    let fts = c.db.search("Northwind", None, None, 10).unwrap();
    let indexed = grain_lib::chat::index_meeting(&c, &m.id).await;
    let mut asks = Vec::new();
    for q in ["What did we decide about the beta launch?", "What did the customer say about pricing?", "What action items are there?", "What is the budget for the office party?"] {
        let t = Instant::now();
        let r = grain_lib::chat::ask(c.clone(), None, None, q.into()).await;
        asks.push(match r {
            Ok(v) => json!({"question": q, "seconds": t.elapsed().as_secs_f64(), "answer": v["message"]["content"], "sources": v["message"]["sources"].as_array().map(|a| a.iter().map(|s| json!({"n": s["n"], "kind": s["kind"], "meeting": s["meetingTitle"], "startMs": s["startMs"]})).collect::<Vec<_>>())}),
            Err(e) => json!({"question": q, "error": e.to_string()}),
        });
        eprintln!("ask: {}", asks.last().unwrap());
    }
    report["search"] = json!({"ftsHits": fts.len(), "firstSnippet": fts.first().map(|h| h.snippet.clone()), "semanticChunks": indexed.as_ref().ok(), "semanticError": indexed.err().map(|e| e.to_string())});
    report["ask"] = json!(asks);

    // ---------- 5. Export ----------
    let out = tmp.path().join("export.md");
    grain_lib::export::write(&c, &m.id, "md", &out).unwrap();
    let wav = tmp.path().join("export.wav");
    grain_lib::export::write(&c, &m.id, "wav", &wav).unwrap();
    let md = std::fs::read_to_string(&out).unwrap();
    report["export"] = json!({"markdownBytes": md.len(), "hasTranscript": md.contains("## Transcript"), "wavBytes": std::fs::metadata(&wav).unwrap().len()});

    c.llm.stop_all().await;
    report["finishedAt"] = json!(chrono::Local::now().to_rfc3339());
    std::fs::write(&report_path, serde_json::to_string_pretty(&report).unwrap()).unwrap();
    eprintln!("report written to {}", report_path.display());
}
