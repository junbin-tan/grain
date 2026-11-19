//! Ask Grain: local retrieval-augmented answers over meeting history.
//!
//! Retrieval = SQLite FTS5 (always) + optional semantic search (local embedding
//! model), merged with reciprocal-rank fusion, plus date filters ("yesterday",
//! "this week") and open action items when the question asks about tasks. The
//! LLM sees only numbered sources and must cite them; with no sources, Grain says
//! it found nothing instead of calling the model.

use crate::db::{ChatMessage, SearchHit};
use crate::notes::fmt_ts;
use crate::Core;
use anyhow::Result;
use chrono::{Datelike, Duration, Local, TimeZone};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub n: usize,
    pub meeting_id: String,
    pub meeting_title: String,
    pub meeting_date: i64,
    pub kind: String,
    pub ref_id: i64,
    pub start_ms: Option<i64>,
    pub excerpt: String,
    #[serde(skip)]
    pub text: String,
}

const STOP: &[&str] = &[
    "what", "which", "who", "whom", "when", "where", "why", "how", "did", "does", "do", "is", "are", "was", "were", "the", "a", "an", "of", "to", "in", "on", "for",
    "about", "and", "or", "we", "i", "me", "my", "our", "you", "it", "that", "this", "with", "from", "any", "all", "say", "said", "tell", "there", "be", "been",
    "have", "has", "had", "can", "could", "would", "should", "will", "meeting", "meetings", "yesterday", "today", "week", "last", "please", "summarise", "summarize",
];

pub fn keywords(q: &str) -> String {
    q.split(|c: char| c.is_whitespace() || "?,.!;:'\"()".contains(c))
        .filter(|w| !w.is_empty() && !STOP.contains(&w.to_lowercase().as_str()))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Date range (ms) implied by the question, in local time.
pub fn date_range(q: &str, now: chrono::DateTime<Local>) -> Option<(i64, i64)> {
    let q = q.to_lowercase();
    let day = |d: chrono::NaiveDate| Local.from_local_datetime(&d.and_hms_opt(0, 0, 0).unwrap()).single().map(|t| t.timestamp_millis()).unwrap_or(0);
    let today = now.date_naive();
    let monday = today - Duration::days(today.weekday().num_days_from_monday() as i64);
    if q.contains("yesterday") || q.contains("昨天") {
        Some((day(today - Duration::days(1)), day(today)))
    } else if q.contains("today") || q.contains("今天") {
        Some((day(today), day(today + Duration::days(1))))
    } else if q.contains("last week") || q.contains("上周") {
        Some((day(monday - Duration::days(7)), day(monday)))
    } else if q.contains("this week") || q.contains("本周") || q.contains("这周") {
        Some((day(monday), day(today + Duration::days(1))))
    } else {
        None
    }
}

fn wants_tasks(q: &str) -> bool {
    let q = q.to_lowercase();
    ["action", "todo", "to-do", "task", "assigned", "commit", "follow up", "follow-up", "owe", "待办", "任务"].iter().any(|k| q.contains(k))
}

/// Reciprocal-rank fusion of keyword and semantic results.
fn fuse(lists: &[Vec<SearchHit>]) -> Vec<SearchHit> {
    let mut score: HashMap<(String, String, i64), (f64, SearchHit)> = HashMap::new();
    for list in lists {
        for (rank, h) in list.iter().enumerate() {
            let k = (h.meeting_id.clone(), h.kind.clone(), h.ref_id);
            let e = score.entry(k).or_insert((0.0, h.clone()));
            e.0 += 1.0 / (60.0 + rank as f64);
        }
    }
    let mut v: Vec<(f64, SearchHit)> = score.into_values().collect();
    v.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    v.into_iter().map(|(_, h)| h).collect()
}

const EMBED_QUERY: &str = "Instruct: Given a question about past meetings, retrieve transcript passages and notes that answer it\nQuery: ";

pub async fn retrieve(core: &Core, question: &str, meeting_id: Option<&str>, budget_chars: usize) -> Result<Vec<Source>> {
    let range = date_range(question, Local::now());
    let in_range = |date: i64| range.map(|(a, b)| date >= a && date < b).unwrap_or(true);
    let kw = keywords(question);
    let mut lists = vec![core.db.search(&kw, meeting_id, None, 30)?];
    if let Some(embed_id) = core.db.setting_str("embedModel").filter(|id| core.db.installed_model(id).ok().flatten().is_some()) {
        if let Ok(ep) = core.llm.endpoint(core, "embed").await {
            if let Ok(v) = core.llm.embed(&ep, &[format!("{EMBED_QUERY}{question}")]).await {
                if let Some(q) = v.first() {
                    lists.push(core.db.vector_search(q, meeting_id, &embed_id, 30)?);
                }
            }
        }
    }
    let mut hits: Vec<SearchHit> = fuse(&lists).into_iter().filter(|h| in_range(h.meeting_date)).collect();

    // Date-only questions ("what happened yesterday?") with no keyword hits: use those meetings' notes.
    let meetings = core.db.list_meetings()?;
    let scoped: Vec<_> = meetings.iter().filter(|m| meeting_id.map(|id| id == m.id).unwrap_or(true) && in_range(m.started_at.unwrap_or(m.created_at))).collect();
    let mut extra: Vec<SearchHit> = Vec::new();
    if meeting_id.is_some() || (range.is_some() && hits.len() < 3) {
        for m in scoped.iter().take(6) {
            for kind in ["enhanced", "manual"] {
                if let Some(n) = core.db.latest_note(&m.id, kind)? {
                    if !n.content.trim().is_empty() {
                        extra.push(SearchHit { meeting_id: m.id.clone(), meeting_title: m.title.clone(), meeting_date: m.started_at.unwrap_or(m.created_at), kind: kind.into(), ref_id: n.id, start_ms: None, snippet: String::new(), text: n.content.clone(), score: 0.0 });
                        break;
                    }
                }
            }
        }
    }
    if wants_tasks(question) {
        for a in core.db.action_items(meeting_id)?.into_iter().filter(|a| a.status == "open") {
            if let Some(m) = meetings.iter().find(|m| m.id == a.meeting_id).filter(|m| in_range(m.started_at.unwrap_or(m.created_at))) {
                let text = format!("Action item: {}{}{}{}", a.description, a.owner.as_ref().map(|o| format!(" — owner: {o}")).unwrap_or_default(), a.deadline.as_ref().map(|d| format!(" — due: {d}")).unwrap_or_default(), if a.kind == "suggestion" { " (suggested, not agreed)" } else { "" });
                extra.push(SearchHit { meeting_id: m.id.clone(), meeting_title: m.title.clone(), meeting_date: m.started_at.unwrap_or(m.created_at), kind: "action".into(), ref_id: a.id, start_ms: None, snippet: String::new(), text, score: 0.0 });
            }
        }
    }
    hits.splice(0..0, extra);

    // Expand transcript hits with neighbouring lines, dedupe, and fit the budget.
    let mut out: Vec<Source> = Vec::new();
    let mut used = 0usize;
    let mut seg_cache: HashMap<String, Vec<crate::db::Segment>> = HashMap::new();
    for h in hits {
        if out.iter().any(|s| s.meeting_id == h.meeting_id && s.kind == h.kind && s.ref_id == h.ref_id) {
            continue;
        }
        let mut text = h.text.clone();
        let mut start = h.start_ms;
        if h.kind == "segment" {
            let segs = seg_cache.entry(h.meeting_id.clone()).or_insert_with(|| core.db.segments(&h.meeting_id).unwrap_or_default());
            if let Some(i) = segs.iter().position(|s| s.id == h.ref_id) {
                let lo = i.saturating_sub(1);
                let hi = (i + 2).min(segs.len());
                if out.iter().any(|s| s.meeting_id == h.meeting_id && s.kind == "segment" && segs[lo..hi].iter().any(|x| x.id == s.ref_id)) {
                    continue;
                }
                text = segs[lo..hi].iter().map(|s| format!("[{} {}] {}", fmt_ts(s.start_ms), s.speaker.as_deref().unwrap_or(""), s.text)).collect::<Vec<_>>().join("\n");
                start = Some(segs[lo].start_ms);
            }
        }
        let text: String = text.chars().take(2400).collect();
        if used + text.len() > budget_chars {
            if out.is_empty() {
                continue;
            }
            break;
        }
        used += text.len();
        out.push(Source {
            n: out.len() + 1,
            excerpt: plain(&text).chars().take(220).collect(),
            meeting_id: h.meeting_id,
            meeting_title: h.meeting_title,
            meeting_date: h.meeting_date,
            kind: h.kind,
            ref_id: h.ref_id,
            start_ms: start,
            text,
        });
        if out.len() >= 12 {
            break;
        }
    }
    Ok(out)
}

/// Markdown -> readable one-line excerpt (headings, emphasis, timestamp links removed).
pub fn plain(md: &str) -> String {
    let mut out = String::with_capacity(md.len());
    let mut rest = md;
    while let Some(i) = rest.find("](#t=") {
        out.push_str(&rest[..i + 1]);
        rest = rest[i..].find(')').map(|j| &rest[i + j + 1..]).unwrap_or("");
    }
    out.push_str(rest);
    out.lines()
        .map(|l| l.trim().trim_start_matches('#').trim_start_matches("- [ ]").trim_start_matches("- ").trim())
        .filter(|l| !l.is_empty() && *l != "Summary")
        .collect::<Vec<_>>()
        .join(" ")
        .replace("**", "")
        .replace('*', "")
}

pub fn format_sources(sources: &[Source]) -> String {
    sources
        .iter()
        .map(|s| {
            let date = chrono::DateTime::from_timestamp_millis(s.meeting_date).map(|d| d.with_timezone(&Local).format("%a %d %b %Y").to_string()).unwrap_or_default();
            let what = match s.kind.as_str() {
                "segment" => format!("transcript at {}", s.start_ms.map(fmt_ts).unwrap_or_default()),
                "enhanced" => "AI meeting notes".into(),
                "manual" => "the user's own notes".into(),
                "action" => "action item".into(),
                "title" => "meeting title".into(),
                k => k.into(),
            };
            format!("[{}] Meeting \"{}\" ({date}), {what}:\n{}", s.n, s.meeting_title, s.text)
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

const REFUSAL: &str = "I couldn't find that in your meetings.";

const SYSTEM: &str = "You are Grain, a private assistant that answers questions about the user's own meetings.
Answer using only the numbered sources provided, and answer only what was asked.
After each claim, cite the one to three sources that directly support it, like [2] or [1][4]. Never cite a source that does not support the claim.
If the sources do not answer the question, reply exactly: I couldn't find that in your meetings. Do not guess or use outside knowledge.
\"Me\" in transcripts is the user; refer to them as \"you\". \"Them\" is the other side of the call. Distinguish agreed decisions and commitments from suggestions.
Be concise. Answer in the language of the question. When asked to draft something (e.g. a follow-up email), base every fact on the sources.";

pub async fn ask(core: Arc<Core>, thread_id: Option<String>, meeting_id: Option<String>, question: String) -> Result<Value> {
    let question = question.trim().to_string();
    let thread_id = match thread_id {
        Some(t) => t,
        None => core.db.create_thread(meeting_id.as_deref(), &question.chars().take(80).collect::<String>())?,
    };
    let history: Vec<ChatMessage> = core.db.messages(&thread_id)?;
    core.db.add_message(&thread_id, "user", &question, &json!([]))?;
    let emit_token = |t: &str| (core.emit)("chat-token", json!({"threadId": thread_id, "token": t}));

    // Follow-up questions ("and who owns that?") retrieve with the previous question for context.
    let retrieval_q = match history.iter().rev().find(|m| m.role == "user") {
        Some(prev) if question.split_whitespace().count() < 8 => format!("{} {}", prev.content, question),
        _ => question.clone(),
    };
    let ep = core.llm.endpoint(&core, "llm").await;
    let budget = ep.as_ref().map(|e| (e.ctx as usize).saturating_sub(2500) * 3).unwrap_or(12000).min(36000);
    let sources = retrieve(&core, &retrieval_q, meeting_id.as_deref(), budget).await?;
    if sources.is_empty() {
        let msg = REFUSAL;
        emit_token(msg);
        let m = core.db.add_message(&thread_id, "assistant", msg, &json!([]))?;
        return Ok(json!({"threadId": thread_id, "message": m}));
    }
    let ep = ep?;
    let who = core.db.setting_str("userName").filter(|n| !n.trim().is_empty()).map(|n| format!("\nThe user's name is {n}; questions about \"me\" or \"I\" mean {n} or \"Me\".")).unwrap_or_default();
    let mut messages = vec![json!({"role": "system", "content": format!("{SYSTEM}{who}")})];
    for m in history.iter().rev().take(6).collect::<Vec<_>>().into_iter().rev() {
        messages.push(json!({"role": m.role, "content": m.content}));
    }
    let today = Local::now().format("%A %d %B %Y").to_string();
    messages.push(json!({"role": "user", "content": format!("Today is {today}.\n\nSources:\n{}\n\nQuestion: {question}", format_sources(&sources))}));
    let answer = core.llm.chat_stream(&ep, &messages, 1200, |t| emit_token(t)).await?;
    // Keep only sources the answer cites (fall back to all if it cited none).
    // Show only the sources the answer cites; a refusal shows none.
    let shown: Vec<&Source> = sources.iter().filter(|s| answer.contains(&format!("[{}]", s.n))).collect();
    let m = core.db.add_message(&thread_id, "assistant", &answer, &serde_json::to_value(&shown)?)?;
    Ok(json!({"threadId": thread_id, "message": m}))
}

/// Build/refresh the semantic index for one meeting (no-op without an embedding model).
pub async fn index_meeting(core: &Core, meeting_id: &str) -> Result<usize> {
    let Some(embed_id) = core.db.setting_str("embedModel").filter(|id| core.db.installed_model(id).ok().flatten().is_some()) else {
        return Ok(0);
    };
    let mut rows: Vec<(String, i64, Option<i64>, String)> = Vec::new();
    // Transcript windows of ~600 chars of consecutive segments.
    let segs = core.db.segments(meeting_id)?;
    let mut buf = String::new();
    let mut first: Option<&crate::db::Segment> = None;
    for s in &segs {
        first.get_or_insert(s);
        buf.push_str(&format!("{}: {}\n", s.speaker.as_deref().unwrap_or(""), s.text));
        if buf.len() > 600 {
            let f = first.take().unwrap();
            rows.push(("segment".into(), f.id, Some(f.start_ms), std::mem::take(&mut buf)));
        }
    }
    if let Some(f) = first {
        rows.push(("segment".into(), f.id, Some(f.start_ms), buf));
    }
    for kind in ["enhanced", "manual"] {
        if let Some(n) = core.db.latest_note(meeting_id, kind)? {
            for para in n.content.split("\n## ").filter(|p| p.trim().len() > 20) {
                rows.push((kind.into(), n.id, None, para.chars().take(1500).collect()));
            }
        }
    }
    if rows.is_empty() {
        return Ok(0);
    }
    let ep = core.llm.endpoint(core, "embed").await?;
    let vecs = core.llm.embed(&ep, &rows.iter().map(|r| r.3.clone()).collect::<Vec<_>>()).await?;
    let full: Vec<_> = rows.into_iter().zip(vecs).map(|((k, r, s, t), v)| (k, r, s, t, v)).collect();
    core.db.replace_embeddings(meeting_id, &full, &embed_id)?;
    Ok(full.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_excerpt() {
        assert_eq!(plain("## Summary\n\nShip **Friday** [00:07](#t=7760).\n- [ ] Notes — **Priya**"), "Ship Friday [00:07]. Notes — Priya");
    }

    #[test]
    fn keyword_extraction() {
        assert_eq!(keywords("What did the customer say about pricing?"), "customer pricing");
    }

    #[test]
    fn date_ranges() {
        let now = Local.with_ymd_and_hms(2026, 11, 19, 15, 0, 0).unwrap(); // Thursday
        let (a, b) = date_range("what did we decide yesterday?", now).unwrap();
        assert_eq!(b - a, 86_400_000);
        assert_eq!(Local.timestamp_millis_opt(a).unwrap().day(), 18);
        let (a, _) = date_range("blockers this week", now).unwrap();
        assert_eq!(Local.timestamp_millis_opt(a).unwrap().day(), 16); // Monday
        assert!(date_range("pricing", now).is_none());
    }
}
