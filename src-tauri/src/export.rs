//! Export a meeting as Markdown, plain text, JSON, or WAV audio.

use crate::notes::fmt_ts;
use crate::{asr, audio, Core};
use anyhow::{bail, Result};
use serde_json::json;
use std::path::Path;

fn date(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms).map(|d| d.with_timezone(&chrono::Local).format("%A %d %B %Y, %H:%M").to_string()).unwrap_or_default()
}

pub fn markdown(core: &Core, meeting_id: &str) -> Result<String> {
    let m = core.db.get_meeting(meeting_id)?;
    let mut md = format!("# {}\n\n", if m.title.is_empty() { "Untitled meeting" } else { &m.title });
    md.push_str(&format!("*{}* · {} min\n\n", date(m.started_at.unwrap_or(m.created_at)), m.duration_ms / 60000));
    if let Some(n) = core.db.latest_note(meeting_id, "enhanced")? {
        // Drop in-app timestamp links; keep the times. The model wrote this text, and other Markdown
        // viewers load images and render HTML without Grain's CSP, so neither survives export.
        let body = regex_lite_links(&n.content).replace("![", "\\![").replace('<', "\\<");
        md.push_str(&format!("{body}\n"));
    }
    if let Some(n) = core.db.latest_note(meeting_id, "manual")?.filter(|n| !n.content.trim().is_empty()) {
        md.push_str(&format!("## My notes\n\n{}\n\n", n.content.trim()));
    }
    let segs = core.db.segments(meeting_id)?;
    if !segs.is_empty() {
        md.push_str("## Transcript\n\n");
        for s in segs {
            md.push_str(&format!("**{}** {} — {}\n\n", fmt_ts(s.start_ms), s.speaker.unwrap_or_default(), s.text));
        }
    }
    Ok(md)
}

/// `[05:32](#t=332000)` -> `[05:32]`
fn regex_lite_links(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find("](#t=") {
        out.push_str(&rest[..i + 1]);
        let after = &rest[i + 5..];
        match after.find(')') {
            Some(j) => rest = &after[j + 1..],
            None => {
                rest = after;
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

pub fn plain_text(core: &Core, meeting_id: &str) -> Result<String> {
    let md = markdown(core, meeting_id)?;
    Ok(md
        .lines()
        .map(|l| {
            let l = l.trim_start_matches('#').trim_start();
            l.replace("**", "").replace("- [ ] ", "• ").replace("- ", "• ").replace('*', "").replace("\\<", "<").replace("\\![", "![")
        })
        .collect::<Vec<_>>()
        .join("\n"))
}

pub fn json_export(core: &Core, meeting_id: &str) -> Result<String> {
    let v = json!({
        "meeting": core.db.get_meeting(meeting_id)?,
        "myNotes": core.db.latest_note(meeting_id, "manual")?,
        "enhancedNotes": core.db.note_versions(meeting_id, "enhanced")?,
        "actionItems": core.db.action_items(Some(meeting_id))?,
        "marks": core.db.marks(meeting_id)?,
        "transcript": core.db.segments(meeting_id)?,
        "exportedBy": "Grain",
        "exportedAt": crate::db::now_ms(),
    });
    Ok(serde_json::to_string_pretty(&v)?)
}

pub fn write(core: &Core, meeting_id: &str, format: &str, dest: &Path) -> Result<()> {
    if !dest.is_absolute() {
        bail!("Export path must be absolute");
    }
    match format {
        "md" => std::fs::write(dest, markdown(core, meeting_id)?)?,
        "txt" => std::fs::write(dest, plain_text(core, meeting_id)?)?,
        "json" => std::fs::write(dest, json_export(core, meeting_id)?)?,
        "wav" | "wav-mic" | "wav-system" => {
            let dir = asr::meeting_dir(core, meeting_id);
            let sources: Vec<&str> = match format {
                "wav-mic" => vec!["mic"],
                "wav-system" => vec!["system"],
                _ => vec!["mic", "system"],
            };
            let mut tracks = Vec::new();
            for s in sources {
                let p = dir.join(format!("{s}.pcm"));
                if p.exists() {
                    tracks.push(audio::read_pcm(&p, 0, audio::pcm_samples(&p))?);
                }
            }
            if tracks.is_empty() {
                bail!("No audio is stored for this meeting");
            }
            audio::write_wav(dest, &tracks)?;
        }
        _ => bail!("Unknown export format {format}"),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn strips_internal_links() {
        assert_eq!(super::regex_lite_links("- a [05:32](#t=332000) [06:00](#t=360000)"), "- a [05:32] [06:00]");
    }
}
