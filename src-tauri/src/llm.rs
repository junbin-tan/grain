//! Local LLM runtime: manages `llama-server` (llama.cpp, Metal) child processes.
//!
//! Why a separate process: transcribe.cpp and llama.cpp each vendor their own
//! ggml, which cannot be linked into one binary; a child process also returns
//! all model memory to the OS when it exits and isolates native crashes.
//!
//! Security: bound to 127.0.0.1 on a random port, with a random per-launch API key
//! read from a 0600 file (not visible in `ps`), `--offline` (no network), and the
//! built-in web UI disabled. Servers stop after a period of inactivity.

use crate::Core;
use anyhow::{anyhow, bail, Context, Result};
use futures_util::StreamExt;
use rand::Rng;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::process::{Child, Command};

const IDLE_STOP: Duration = Duration::from_secs(600);

struct Server {
    model_path: PathBuf,
    base: String,
    key: String,
    ctx: u32,
    child: Child,
    last_used: Instant,
}

#[derive(Default)]
pub struct LlmManager {
    servers: tokio::sync::Mutex<HashMap<&'static str, Server>>,
    http: reqwest::Client,
}

#[derive(Clone)]
pub struct Endpoint {
    pub base: String,
    pub key: String,
    pub ctx: u32,
    pub model_id: String,
}

fn free_port() -> Result<u16> {
    Ok(std::net::TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}

pub fn strip_think(s: &str) -> String {
    let mut out = s.to_string();
    while let (Some(a), Some(b)) = (out.find("<think>"), out.find("</think>")) {
        if b < a {
            break;
        }
        out.replace_range(a..b + 8, "");
    }
    out.trim().to_string()
}

impl LlmManager {
    /// Start (or reuse) the server for `role` ("llm" or "embed") using the model selected in settings.
    pub async fn endpoint(&self, core: &Core, role: &'static str) -> Result<Endpoint> {
        let key_name = if role == "llm" { "llmModel" } else { "embedModel" };
        let id = core.db.setting_str(key_name).ok_or_else(|| {
            anyhow!(if role == "llm" { "No notes model selected. Download one in Models." } else { "No embedding model installed." })
        })?;
        let installed = core.db.installed_model(&id)?.ok_or_else(|| anyhow!("The model {id} is not installed. Download it in Models."))?;
        let cat = crate::models::get(&id);
        let (cat_ctx, min_ram, name) = cat.map(|c| (c.ctx, c.min_ram_gb, c.name.clone())).unwrap_or((8192, 0.0, installed.name.clone())); // custom import: conservative defaults
        let path = PathBuf::from(&installed.path);
        let ram_gb = crate::hardware::total_ram_gb();
        let mut ctx = if ram_gb < 16.0 { cat_ctx.min(8192) } else { cat_ctx };
        if let Some(c) = std::env::var("GRAIN_LLM_CTX").ok().and_then(|v| v.parse().ok()).filter(|_| role == "llm") {
            ctx = c; // test hook: forces the long-meeting (map-reduce) path on short inputs
        }

        let mut servers = self.servers.lock().await;
        if let Some(s) = servers.get_mut(role) {
            let alive = matches!(s.child.try_wait(), Ok(None));
            if alive && s.model_path == path && s.ctx == ctx {
                s.last_used = Instant::now();
                return Ok(Endpoint { base: s.base.clone(), key: s.key.clone(), ctx: s.ctx, model_id: id });
            }
            let _ = s.child.kill().await;
            servers.remove(role);
        }
        if ram_gb > 0.0 && ram_gb < min_ram {
            (core.emit)("llm-status", json!({"warning": format!("{name} recommends {min_ram} GB of memory; this Mac has {ram_gb:.0} GB. It may be slow or fail.")}));
        }
        (core.emit)("llm-status", json!({"state": "loading", "role": role, "model": name}));
        let port = free_port()?;
        let key: String = rand::rng().sample_iter(&rand::distr::Alphanumeric).take(40).map(char::from).collect();
        let key_file = core.paths.root.join(format!(".llama-{role}.key"));
        std::fs::write(&key_file, &key)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&key_file, std::fs::Permissions::from_mode(0o600))?;
        }
        let mut cmd = Command::new(crate::capture::sidecar("llama-server")?);
        cmd.arg("-m").arg(&path)
            .args(["--host", "127.0.0.1", "--port", &port.to_string()])
            .arg("--api-key-file").arg(&key_file)
            .args(["-c", &ctx.to_string(), "-ngl", "999", "-fa", "auto", "--parallel", "1"])
            .args(["--no-webui", "--offline", "--no-mmproj", "--log-disable"]);
        if role == "embed" {
            cmd.args(["--embedding", "--pooling", "last", "-ub", "4096", "-b", "4096"]);
        } else {
            cmd.args(["--jinja", "--reasoning", "off"]);
        }
        let mut child = cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).kill_on_drop(true).spawn().context("Could not start the local AI runtime")?;
        let base = format!("http://127.0.0.1:{port}");
        let started = Instant::now();
        loop {
            if let Ok(Some(st)) = child.try_wait() {
                bail!("The local AI runtime exited while loading the model ({st}). The model may be too large for available memory.");
            }
            if let Ok(r) = self.http.get(format!("{base}/health")).send().await {
                if r.status().is_success() {
                    break;
                }
            }
            if started.elapsed() > Duration::from_secs(180) {
                let _ = child.kill().await;
                bail!("The local AI runtime did not become ready in time");
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
        let _ = std::fs::remove_file(&key_file); // read at startup; no need to keep it on disk
        (core.emit)("llm-status", json!({"state": "ready", "role": role, "model": name, "loadSeconds": started.elapsed().as_secs_f64()}));
        servers.insert(role, Server { model_path: path, base: base.clone(), key: key.clone(), ctx, child, last_used: Instant::now() });
        Ok(Endpoint { base, key, ctx, model_id: id })
    }

    /// Load the notes and embedding models ahead of use (e.g. after a recording ends), so the
    /// GPU-heavy load does not happen while the user waits on Enhance or scrolls.
    // shortcut: only on Macs with >= 16 GB; smaller machines load on demand to keep memory free.
    pub async fn warm(&self, core: &Core) {
        if crate::hardware::total_ram_gb() < 16.0 {
            return;
        }
        for role in ["embed", "llm"] {
            let key = if role == "llm" { "llmModel" } else { "embedModel" };
            if core.db.setting_str(key).and_then(|id| core.db.installed_model(&id).ok().flatten()).is_some() {
                let _ = self.endpoint(core, role).await;
            }
        }
    }

    pub async fn stop_idle(&self) {
        let mut servers = self.servers.lock().await;
        let idle: Vec<&'static str> = servers.iter().filter(|(_, s)| s.last_used.elapsed() > IDLE_STOP).map(|(k, _)| *k).collect();
        for k in idle {
            if let Some(mut s) = servers.remove(k) {
                let _ = s.child.kill().await;
            }
        }
    }

    pub async fn stop_all(&self) {
        let mut servers = self.servers.lock().await;
        for (_, mut s) in servers.drain() {
            let _ = s.child.kill().await;
        }
    }

    pub async fn count_tokens(&self, ep: &Endpoint, text: &str) -> Result<usize> {
        let r: Value = self.http.post(format!("{}/tokenize", ep.base)).bearer_auth(&ep.key).json(&json!({"content": text})).send().await?.json().await?;
        Ok(r["tokens"].as_array().map(|a| a.len()).unwrap_or(text.len() / 3))
    }

    /// One chat completion. With `schema`, output is grammar-constrained to that JSON schema.
    pub async fn chat(&self, ep: &Endpoint, messages: &[Value], schema: Option<&Value>, max_tokens: u32) -> Result<String> {
        let mut body = json!({
            "messages": messages, "temperature": 0.2, "top_p": 0.9, "max_tokens": max_tokens, "stream": false,
            "chat_template_kwargs": {"enable_thinking": false},
        });
        if let Some(s) = schema {
            body["response_format"] = json!({"type": "json_schema", "json_schema": {"name": "output", "strict": true, "schema": s}});
        }
        let resp = self.http.post(format!("{}/v1/chat/completions", ep.base)).bearer_auth(&ep.key).json(&body).timeout(Duration::from_secs(900)).send().await.context("Local AI runtime is not responding")?;
        let status = resp.status();
        let v: Value = resp.json().await?;
        if !status.is_success() {
            bail!("Local AI error: {}", v["error"]["message"].as_str().unwrap_or(&v.to_string()));
        }
        Ok(strip_think(v["choices"][0]["message"]["content"].as_str().unwrap_or_default()))
    }

    /// Streaming chat completion; calls `on_token` with each new piece of text.
    pub async fn chat_stream(&self, ep: &Endpoint, messages: &[Value], max_tokens: u32, mut on_token: impl FnMut(&str)) -> Result<String> {
        let body = json!({
            "messages": messages, "temperature": 0.3, "max_tokens": max_tokens, "stream": true,
            "chat_template_kwargs": {"enable_thinking": false},
        });
        let resp = self.http.post(format!("{}/v1/chat/completions", ep.base)).bearer_auth(&ep.key).json(&body).send().await.context("Local AI runtime is not responding")?;
        if !resp.status().is_success() {
            bail!("Local AI error: HTTP {}", resp.status());
        }
        let mut stream = resp.bytes_stream();
        let mut buf = String::new();
        let mut full = String::new();
        while let Some(chunk) = stream.next().await {
            buf.push_str(&String::from_utf8_lossy(&chunk?));
            while let Some(i) = buf.find('\n') {
                let line = buf[..i].trim().to_string();
                buf.drain(..=i);
                let Some(data) = line.strip_prefix("data:") else { continue };
                let data = data.trim();
                if data == "[DONE]" {
                    continue;
                }
                if let Ok(v) = serde_json::from_str::<Value>(data) {
                    if let Some(t) = v["choices"][0]["delta"]["content"].as_str() {
                        full.push_str(t);
                        on_token(t);
                    }
                }
            }
        }
        Ok(strip_think(&full))
    }

    pub async fn embed(&self, ep: &Endpoint, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        let mut out = Vec::new();
        for batch in texts.chunks(16) {
            let r: Value = self
                .http
                .post(format!("{}/v1/embeddings", ep.base))
                .bearer_auth(&ep.key)
                .json(&json!({"input": batch}))
                .send()
                .await?
                .json()
                .await?;
            let data = r["data"].as_array().ok_or_else(|| anyhow!("embedding error: {r}"))?;
            for d in data {
                out.push(d["embedding"].as_array().into_iter().flatten().filter_map(|x| x.as_f64().map(|f| f as f32)).collect());
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn strips_thinking() {
        assert_eq!(super::strip_think("<think>hmm</think>\n\nAnswer"), "Answer");
        assert_eq!(super::strip_think("plain"), "plain");
    }
}
