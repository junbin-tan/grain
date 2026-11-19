//! Capture session management. The macOS helper (`grain-capture`, Swift) does the
//! actual recording; this module starts it, relays its events, and finalises the
//! meeting when it stops. If Grain itself crashes, the helper sees stdin close,
//! flushes its files and exits; on next launch the meeting is marked
//! `interrupted` and its audio can still be transcribed.

use crate::{asr, audio, Core};
use anyhow::{anyhow, bail, Result};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};

pub struct CaptureSession {
    pub meeting_id: String,
    stdin: ChildStdin,
    stop_live: tokio::sync::watch::Sender<bool>,
}

/// Locate a bundled sidecar: next to the executable (bundled app / tauri dev), or in
/// src-tauri/binaries with the target triple (cargo test / CLI use).
pub fn sidecar(name: &str) -> Result<PathBuf> {
    let exe = std::env::current_exe()?;
    let dir = exe.parent().ok_or_else(|| anyhow!("no exe dir"))?;
    let triple = if cfg!(target_arch = "aarch64") { "aarch64-apple-darwin" } else { "x86_64-apple-darwin" };
    let candidates = [
        dir.join(name),
        dir.join(format!("{name}-{triple}")),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join(format!("{name}-{triple}")),
    ];
    candidates.into_iter().find(|p| p.exists()).ok_or_else(|| anyhow!("{name} helper not found; run scripts/build-capture.sh / build-llama-server.sh"))
}

async fn helper_json(args: &[&str]) -> Result<Value> {
    let out = Command::new(sidecar("grain-capture")?).args(args).stdin(Stdio::null()).output().await?;
    let line = String::from_utf8_lossy(&out.stdout);
    let last = line.lines().last().unwrap_or("{}");
    Ok(serde_json::from_str(last)?)
}

pub async fn permissions() -> Result<Value> {
    helper_json(&["permissions"]).await
}

pub async fn request_permission(kind: &str) -> Result<Value> {
    match kind {
        "mic" => helper_json(&["request-mic"]).await,
        "screen" => helper_json(&["request-screen"]).await,
        _ => bail!("unknown permission {kind}"),
    }
}

pub async fn devices() -> Result<Value> {
    Ok(helper_json(&["devices"]).await?["devices"].clone())
}

pub async fn start(core: Arc<Core>, meeting_id: String, mic: Option<String>, system: bool) -> Result<()> {
    // Held for the whole start-up so two concurrent starts cannot both spawn a helper.
    let mut slot = core.capture.lock().await;
    if let Some(s) = slot.as_ref() {
        bail!("Already recording a meeting ({})", s.meeting_id);
    }
    let meeting = core.db.get_meeting(&meeting_id)?;
    if meeting.status == "processing" {
        bail!("This meeting is still being processed");
    }
    let dir = asr::meeting_dir(&core, &meeting_id);
    std::fs::create_dir_all(&dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    // Resuming appends to existing files: live transcription starts where they end.
    let start_at: std::collections::HashMap<String, usize> =
        ["mic", "system"].iter().map(|s| (s.to_string(), audio::pcm_samples(&dir.join(format!("{s}.pcm"))))).collect();
    let mic_arg = mic.unwrap_or_else(|| "default".into());
    let mut cmd = Command::new(sidecar("grain-capture")?);
    cmd.arg("record").arg("--out").arg(&dir).arg("--mic").arg(&mic_arg);
    if system {
        cmd.arg("--system");
    }
    let mut child: Child = cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(false).spawn()?;
    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();

    // Wait for the helper to report which sources started.
    let mut lines = BufReader::new(stdout).lines();
    let mut errors = Vec::new();
    let started = loop {
        match lines.next_line().await? {
            Some(l) => {
                let v: Value = serde_json::from_str(&l).unwrap_or(Value::Null);
                match v["event"].as_str() {
                    Some("started") => break v,
                    Some("error") => {
                        errors.push(v["message"].as_str().unwrap_or("").to_string());
                        (core.emit)("capture", v);
                    }
                    _ => {}
                }
            }
            None => bail!("Recording could not start: {}", errors.join("; ")),
        }
    };

    let offset_ms = existing_offset_ms(&dir);
    core.db.mark_started(&meeting_id)?;
    for (src, on) in [("mic", started["mic"].as_bool() == Some(true)), ("system", started["system"].as_bool() == Some(true))] {
        if on {
            core.db.upsert_recording(&meeting_id, src, &dir.join(format!("{src}.pcm")).to_string_lossy(), 0, "recording")?;
        }
    }
    (core.emit)("capture", json!({"event": "started", "meetingId": meeting_id, "mic": started["mic"], "system": started["system"], "micDevice": started["micDevice"], "offsetMs": offset_ms, "errors": errors}));

    let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
    let live = core.db.setting_str("transcriptionMode").unwrap_or_else(|| "live".into()) == "live";
    let live_handle = if live { Some(tokio::spawn(asr::live_loop(core.clone(), meeting_id.clone(), start_at, stop_rx))) } else { None };
    *slot = Some(CaptureSession { meeting_id: meeting_id.clone(), stdin, stop_live: stop_tx });
    drop(slot);
    (core.on_recording)(Some(0.0));

    // Relay events until the helper exits, then finalise.
    let c = core.clone();
    tokio::spawn(async move {
        let mut clean = false;
        while let Ok(Some(l)) = lines.next_line().await {
            let mut v: Value = serde_json::from_str(&l).unwrap_or(Value::Null);
            if v["event"] == "stopped" {
                clean = true;
            }
            if v["event"] == "level" {
                (c.on_recording)(v["elapsed"].as_f64().map(|e| e + offset_ms as f64 / 1000.0));
            }
            v["meetingId"] = json!(meeting_id);
            if let Some(e) = v.get("elapsed").and_then(|e| e.as_f64()) {
                v["elapsed"] = json!(e + offset_ms as f64 / 1000.0);
            }
            (c.emit)("capture", v);
        }
        let _ = child.wait().await;
        finalize(c, meeting_id, live_handle, clean).await;
    });
    Ok(())
}

/// Resuming a stopped meeting appends to the same files; report the existing length.
fn existing_offset_ms(dir: &std::path::Path) -> i64 {
    ["mic", "system"].iter().map(|s| audio::pcm_samples(&dir.join(format!("{s}.pcm")))).max().unwrap_or(0) as i64 * 1000 / audio::RATE as i64
}

async fn finalize(core: Arc<Core>, meeting_id: String, live: Option<tokio::task::JoinHandle<()>>, clean: bool) {
    let session = core.capture.lock().await.take();
    (core.on_recording)(None);
    let dir = asr::meeting_dir(&core, &meeting_id);
    let dur = existing_offset_ms(&dir);
    for src in ["mic", "system"] {
        let p = dir.join(format!("{src}.pcm"));
        if p.exists() {
            let ms = audio::pcm_samples(&p) as i64 * 1000 / audio::RATE as i64;
            let _ = core.db.upsert_recording(&meeting_id, src, &p.to_string_lossy(), ms, "complete");
        }
    }
    let _ = core.db.mark_ended(&meeting_id, dur);
    let _ = core.db.set_status(&meeting_id, "processing");
    (core.emit)("meeting-status", json!({"meetingId": meeting_id, "status": "processing", "clean": clean}));
    if let Some(s) = session {
        let _ = s.stop_live.send(true);
    }
    let mut err = None;
    if let Some(h) = live {
        let _ = h.await; // flushes the remaining audio
    } else if asr::asr_config(&core).is_ok() {
        if let Err(e) = asr::transcribe_meeting(core.clone(), meeting_id.clone()).await {
            err = Some(e.to_string());
        }
    }
    // Retention policy: with "Keep audio" off, audio is deleted once the transcript exists.
    if !core.db.setting_bool("keepAudio", true) && err.is_none() && !core.db.segments(&meeting_id).map(|s| s.is_empty()).unwrap_or(true) {
        let _ = core.delete_audio(&meeting_id);
    }
    let _ = crate::chat::index_meeting(&core, &meeting_id).await;
    let warm = core.clone();
    tokio::spawn(async move { warm.llm.warm(&warm).await }); // the user usually enhances next
    let status = if clean { "done" } else { "interrupted" };
    let _ = core.db.set_status(&meeting_id, status);
    (core.emit)("meeting-status", json!({"meetingId": meeting_id, "status": status, "error": err}));
}

async fn send(core: &Core, cmd: &str) -> Result<()> {
    let mut g = core.capture.lock().await;
    let s = g.as_mut().ok_or_else(|| anyhow!("Not recording"))?;
    s.stdin.write_all(format!("{cmd}\n").as_bytes()).await?;
    s.stdin.flush().await?;
    if cmd == "pause" || cmd == "resume" {
        let status = if cmd == "pause" { "paused" } else { "recording" };
        core.db.set_status(&s.meeting_id, status)?;
    }
    Ok(())
}

pub async fn pause(core: &Core) -> Result<()> {
    send(core, "pause").await
}
pub async fn resume(core: &Core) -> Result<()> {
    send(core, "resume").await
}
pub async fn stop(core: &Core) -> Result<()> {
    send(core, "stop").await
}
pub async fn switch_mic(core: &Core, uid: &str) -> Result<()> {
    if uid.contains('\n') {
        bail!("invalid device id");
    }
    send(core, &format!("mic {uid}")).await
}

/// On launch: meetings left "recording" by a crash become "interrupted", keeping their audio.
pub fn recover(core: &Core) -> Result<Vec<String>> {
    let mut out = Vec::new();
    for m in core.db.meetings_with_status(&["recording", "paused", "processing"])? {
        let dir = asr::meeting_dir(core, &m.id);
        let dur = existing_offset_ms(&dir);
        for src in ["mic", "system"] {
            let p = dir.join(format!("{src}.pcm"));
            if p.exists() {
                core.db.upsert_recording(&m.id, src, &p.to_string_lossy(), audio::pcm_samples(&p) as i64 * 1000 / audio::RATE as i64, "complete")?;
            }
        }
        core.db.mark_ended(&m.id, dur)?;
        core.db.set_status(&m.id, "interrupted")?;
        out.push(m.id);
    }
    Ok(out)
}

/// Short throwaway recording to check levels (onboarding / settings). Files are deleted afterwards.
pub async fn audio_test(core: &Core, mic: Option<String>, system: bool, seconds: f64) -> Result<Value> {
    let dir = core.paths.root.join(".audio-test");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir)?;
    let mut cmd = Command::new(sidecar("grain-capture")?);
    cmd.arg("record").arg("--out").arg(&dir).arg("--mic").arg(mic.unwrap_or_else(|| "default".into())).arg("--duration").arg(seconds.clamp(1.0, 15.0).to_string());
    if system {
        cmd.arg("--system");
    }
    let mut child = cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true).spawn()?;
    let _keep_stdin_open = child.stdin.take();
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let (mut mic_peak, mut sys_peak) = (0f64, 0f64);
    let mut errors = Vec::new();
    while let Ok(Some(l)) = lines.next_line().await {
        let v: Value = serde_json::from_str(&l).unwrap_or(Value::Null);
        match v["event"].as_str() {
            Some("level") => {
                mic_peak = mic_peak.max(v["mic"].as_f64().unwrap_or(0.0));
                sys_peak = sys_peak.max(v["system"].as_f64().unwrap_or(0.0));
                (core.emit)("audio-test", v);
            }
            Some("error") => errors.push(v["message"].as_str().unwrap_or_default().to_string()),
            _ => {}
        }
    }
    let _ = child.wait().await;
    let _ = std::fs::remove_dir_all(&dir);
    Ok(json!({"mic": mic_peak, "system": sys_peak, "errors": errors}))
}
