//! Local SQLite store: schema, migrations, and typed queries.
//!
//! One file, `grain.db`, in the app data directory. Foreign keys cascade, so
//! deleting a meeting removes its recordings rows, segments, notes, action items,
//! marks, chat threads, embeddings and search rows (audio files are removed by
//! the caller; see `delete_meeting` in commands).

use anyhow::{anyhow, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

const MIGRATIONS: &[&str] = &[
    // v1
    r#"
CREATE TABLE meetings(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  template_id TEXT NOT NULL DEFAULT 'general',
  folder TEXT,
  language TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE recordings(
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  path TEXT NOT NULL,
  sample_rate INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  UNIQUE(meeting_id, source)
);
CREATE TABLE segments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  speaker TEXT,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  original_text TEXT NOT NULL,
  language TEXT,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'final',
  edited INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX segments_meeting ON segments(meeting_id, start_ms);
CREATE TABLE notes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('manual','enhanced')),
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  structured TEXT,
  model_id TEXT,
  template_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(meeting_id, kind, version)
);
CREATE TABLE action_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  owner TEXT,
  deadline TEXT,
  kind TEXT NOT NULL DEFAULT 'commitment',
  status TEXT NOT NULL DEFAULT 'open',
  verified INTEGER NOT NULL DEFAULT 0,
  evidence TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE TABLE marks(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  at_ms INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE models(
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  family TEXT,
  version TEXT,
  path TEXT NOT NULL,
  quant TEXT,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL,
  installed_at INTEGER NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE templates(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  instructions TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE chat_threads(
  id TEXT PRIMARY KEY,
  meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE chat_messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE TABLE embeddings(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref_id INTEGER NOT NULL,
  start_ms INTEGER,
  text TEXT NOT NULL,
  vector BLOB NOT NULL,
  model_id TEXT NOT NULL
);
CREATE INDEX embeddings_meeting ON embeddings(meeting_id);
-- Trigram tokenizer: substring search that works for CJK as well as Latin text.
CREATE VIRTUAL TABLE search_index USING fts5(
  meeting_id UNINDEXED, kind UNINDEXED, ref_id UNINDEXED, start_ms UNINDEXED, text,
  tokenize = 'trigram'
);
"#,
];

pub struct Db {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meeting {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub duration_ms: i64,
    pub status: String,
    pub template_id: String,
    pub folder: Option<String>,
    pub language: Option<String>,
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub id: i64,
    pub meeting_id: String,
    pub source: String,
    pub speaker: Option<String>,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub original_text: String,
    pub language: Option<String>,
    pub model_id: String,
    pub status: String,
    pub edited: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSegment {
    pub source: String,
    pub speaker: Option<String>,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub language: Option<String>,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: i64,
    pub meeting_id: String,
    pub kind: String,
    pub version: i64,
    pub content: String,
    pub structured: Option<Value>,
    pub model_id: Option<String>,
    pub template_id: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionItem {
    pub id: i64,
    pub meeting_id: String,
    pub description: String,
    pub owner: Option<String>,
    pub deadline: Option<String>,
    pub kind: String,
    pub status: String,
    pub verified: bool,
    pub evidence: Vec<i64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub id: String,
    pub meeting_id: String,
    pub source: String,
    pub path: String,
    pub sample_rate: i64,
    pub duration_ms: i64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mark {
    pub id: i64,
    pub meeting_id: String,
    pub at_ms: i64,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledModel {
    pub id: String,
    pub role: String,
    pub name: String,
    pub family: Option<String>,
    pub version: Option<String>,
    pub path: String,
    pub quant: Option<String>,
    pub size: i64,
    pub sha256: String,
    pub status: String,
    pub installed_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: String,
    pub name: String,
    pub instructions: String,
    pub builtin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: i64,
    pub thread_id: String,
    pub role: String,
    pub content: String,
    pub sources: Value,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub meeting_id: String,
    pub meeting_title: String,
    pub meeting_date: i64,
    pub kind: String,
    pub ref_id: i64,
    pub start_ms: Option<i64>,
    pub snippet: String,
    pub text: String,
    pub score: f64,
}

const MEETING_COLS: &str = "id,title,created_at,updated_at,started_at,ended_at,duration_ms,status,template_id,folder,language,metadata";
const SEGMENT_COLS: &str = "id,meeting_id,source,speaker,start_ms,end_ms,text,original_text,language,model_id,status,edited";

fn meeting_row(r: &rusqlite::Row) -> rusqlite::Result<Meeting> {
    let meta: String = r.get(11)?;
    Ok(Meeting {
        id: r.get(0)?,
        title: r.get(1)?,
        created_at: r.get(2)?,
        updated_at: r.get(3)?,
        started_at: r.get(4)?,
        ended_at: r.get(5)?,
        duration_ms: r.get(6)?,
        status: r.get(7)?,
        template_id: r.get(8)?,
        folder: r.get(9)?,
        language: r.get(10)?,
        metadata: serde_json::from_str(&meta).unwrap_or(Value::Object(Default::default())),
    })
}

fn segment_row(r: &rusqlite::Row) -> rusqlite::Result<Segment> {
    Ok(Segment {
        id: r.get(0)?,
        meeting_id: r.get(1)?,
        source: r.get(2)?,
        speaker: r.get(3)?,
        start_ms: r.get(4)?,
        end_ms: r.get(5)?,
        text: r.get(6)?,
        original_text: r.get(7)?,
        language: r.get(8)?,
        model_id: r.get(9)?,
        status: r.get(10)?,
        edited: r.get::<_, i64>(11)? != 0,
    })
}

fn note_row(r: &rusqlite::Row) -> rusqlite::Result<Note> {
    let s: Option<String> = r.get(5)?;
    Ok(Note {
        id: r.get(0)?,
        meeting_id: r.get(1)?,
        kind: r.get(2)?,
        version: r.get(3)?,
        content: r.get(4)?,
        structured: s.and_then(|s| serde_json::from_str(&s).ok()),
        model_id: r.get(6)?,
        template_id: r.get(7)?,
        created_at: r.get(8)?,
    })
}

fn action_row(r: &rusqlite::Row) -> rusqlite::Result<ActionItem> {
    let ev: String = r.get(8)?;
    Ok(ActionItem {
        id: r.get(0)?,
        meeting_id: r.get(1)?,
        description: r.get(2)?,
        owner: r.get(3)?,
        deadline: r.get(4)?,
        kind: r.get(5)?,
        status: r.get(6)?,
        verified: r.get::<_, i64>(7)? != 0,
        evidence: serde_json::from_str(&ev).unwrap_or_default(),
        created_at: r.get(9)?,
    })
}

pub const BUILTIN_TEMPLATES: &[(&str, &str, &str)] = &[
    ("general", "General meeting", "Organise notes by topic. Capture context, what was discussed, decisions and next steps."),
    ("one-on-one", "One-to-one", "Focus on the other person's updates, wins, blockers, feedback given in both directions, career or growth topics, and agreed follow-ups."),
    ("product", "Product discussion", "Focus on the problem, users affected, options considered with trade-offs, scope decisions, open product questions, and owners for next steps."),
    ("customer-discovery", "Customer discovery", "Focus on the customer's context, current workflow, pain points in their own words, budget/pricing signals, objections, buying process, and agreed next steps. Quote the customer where the transcript allows."),
    ("project-update", "Project update", "Focus on progress since last update, status against plan, risks and blockers, changes in scope or timeline, and decisions needed."),
    ("interview", "Interview", "Focus on the candidate's background, answers to each question, evidence for and against each competency discussed, candidate questions, and next steps. Do not make a hiring recommendation."),
    ("technical", "Technical meeting", "Focus on the technical problem, constraints, approaches discussed with trade-offs, chosen design, open technical questions, and implementation follow-ups."),
];

impl Db {
    pub fn open(path: &Path) -> Result<Db> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        let db = Db { conn: Mutex::new(conn) };
        db.migrate()?;
        db.seed()?;
        Ok(db)
    }

    #[cfg(test)]
    pub fn memory() -> Result<Db> {
        let conn = Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let db = Db { conn: Mutex::new(conn) };
        db.migrate()?;
        db.seed()?;
        Ok(db)
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn migrate(&self) -> Result<()> {
        let mut c = self.conn();
        let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(v as usize) {
            let tx = c.transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", (i + 1) as i64)?;
            tx.commit()?;
        }
        Ok(())
    }

    fn seed(&self) -> Result<()> {
        let c = self.conn();
        for (id, name, instr) in BUILTIN_TEMPLATES {
            c.execute(
                "INSERT INTO templates(id,name,instructions,builtin,created_at) VALUES(?,?,?,1,?)
                 ON CONFLICT(id) DO UPDATE SET name=excluded.name, instructions=excluded.instructions WHERE builtin=1",
                params![id, name, instr, now_ms()],
            )?;
        }
        Ok(())
    }

    // ---------- settings ----------

    pub fn get_setting(&self, key: &str) -> Result<Option<Value>> {
        let v: Option<String> = self
            .conn()
            .query_row("SELECT value FROM settings WHERE key=?", [key], |r| r.get(0))
            .optional()?;
        Ok(v.and_then(|s| serde_json::from_str(&s).ok()))
    }

    pub fn setting_str(&self, key: &str) -> Option<String> {
        self.get_setting(key).ok().flatten().and_then(|v| v.as_str().map(String::from))
    }

    pub fn setting_bool(&self, key: &str, default: bool) -> bool {
        self.get_setting(key).ok().flatten().and_then(|v| v.as_bool()).unwrap_or(default)
    }

    pub fn set_setting(&self, key: &str, value: &Value) -> Result<()> {
        self.conn().execute(
            "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value.to_string()],
        )?;
        Ok(())
    }

    pub fn all_settings(&self) -> Result<serde_json::Map<String, Value>> {
        let c = self.conn();
        let mut st = c.prepare("SELECT key,value FROM settings")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut m = serde_json::Map::new();
        for row in rows {
            let (k, v) = row?;
            m.insert(k, serde_json::from_str(&v).unwrap_or(Value::Null));
        }
        Ok(m)
    }

    // ---------- meetings ----------

    pub fn create_meeting(&self, title: &str, template_id: &str) -> Result<Meeting> {
        let id = uuid::Uuid::new_v4().to_string();
        let t = now_ms();
        self.conn().execute(
            "INSERT INTO meetings(id,title,created_at,updated_at,template_id) VALUES(?,?,?,?,?)",
            params![id, title, t, t, template_id],
        )?;
        self.reindex_meeting(&id)?;
        self.get_meeting(&id)
    }

    pub fn get_meeting(&self, id: &str) -> Result<Meeting> {
        self.conn()
            .query_row(&format!("SELECT {MEETING_COLS} FROM meetings WHERE id=?"), [id], meeting_row)
            .optional()?
            .ok_or_else(|| anyhow!("meeting not found"))
    }

    pub fn list_meetings(&self) -> Result<Vec<Meeting>> {
        let c = self.conn();
        let mut st = c.prepare(&format!(
            "SELECT {MEETING_COLS} FROM meetings ORDER BY COALESCE(started_at, created_at) DESC"
        ))?;
        let rows = st.query_map([], meeting_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn meetings_with_status(&self, status: &[&str]) -> Result<Vec<Meeting>> {
        Ok(self.list_meetings()?.into_iter().filter(|m| status.contains(&m.status.as_str())).collect())
    }

    pub fn update_meeting(&self, id: &str, patch: &Value) -> Result<Meeting> {
        {
            let c = self.conn();
            if let Some(t) = patch.get("title").and_then(|v| v.as_str()) {
                c.execute("UPDATE meetings SET title=?, updated_at=? WHERE id=?", params![t, now_ms(), id])?;
            }
            if let Some(t) = patch.get("templateId").and_then(|v| v.as_str()) {
                c.execute("UPDATE meetings SET template_id=?, updated_at=? WHERE id=?", params![t, now_ms(), id])?;
            }
            if let Some(f) = patch.get("folder") {
                c.execute("UPDATE meetings SET folder=?, updated_at=? WHERE id=?", params![f.as_str(), now_ms(), id])?;
            }
            if let Some(l) = patch.get("language") {
                c.execute("UPDATE meetings SET language=?, updated_at=? WHERE id=?", params![l.as_str(), now_ms(), id])?;
            }
            if let Some(m) = patch.get("metadata") {
                c.execute("UPDATE meetings SET metadata=?, updated_at=? WHERE id=?", params![m.to_string(), now_ms(), id])?;
            }
        }
        if patch.get("title").is_some() {
            self.reindex_meeting(id)?;
        }
        self.get_meeting(id)
    }

    pub fn set_status(&self, id: &str, status: &str) -> Result<()> {
        self.conn().execute("UPDATE meetings SET status=?, updated_at=? WHERE id=?", params![status, now_ms(), id])?;
        Ok(())
    }

    pub fn mark_started(&self, id: &str) -> Result<()> {
        self.conn().execute(
            "UPDATE meetings SET status='recording', started_at=COALESCE(started_at, ?), updated_at=? WHERE id=?",
            params![now_ms(), now_ms(), id],
        )?;
        Ok(())
    }

    pub fn mark_ended(&self, id: &str, duration_ms: i64) -> Result<()> {
        self.conn().execute(
            "UPDATE meetings SET ended_at=?, duration_ms=?, updated_at=? WHERE id=?",
            params![now_ms(), duration_ms, now_ms(), id],
        )?;
        Ok(())
    }

    pub fn delete_meeting(&self, id: &str) -> Result<()> {
        let c = self.conn();
        c.execute("DELETE FROM search_index WHERE meeting_id=?", [id])?;
        c.execute("DELETE FROM meetings WHERE id=?", [id])?;
        Ok(())
    }

    // ---------- recordings ----------

    pub fn upsert_recording(&self, meeting_id: &str, source: &str, path: &str, duration_ms: i64, status: &str) -> Result<()> {
        self.conn().execute(
            "INSERT INTO recordings(id,meeting_id,source,path,sample_rate,duration_ms,status) VALUES(?,?,?,?,16000,?,?)
             ON CONFLICT(meeting_id,source) DO UPDATE SET path=excluded.path, duration_ms=excluded.duration_ms, status=excluded.status",
            params![uuid::Uuid::new_v4().to_string(), meeting_id, source, path, duration_ms, status],
        )?;
        Ok(())
    }

    pub fn recordings(&self, meeting_id: &str) -> Result<Vec<Recording>> {
        let c = self.conn();
        let mut st = c.prepare("SELECT id,meeting_id,source,path,sample_rate,duration_ms,status FROM recordings WHERE meeting_id=? ORDER BY source")?;
        let rows = st
            .query_map([meeting_id], |r| {
                Ok(Recording {
                    id: r.get(0)?,
                    meeting_id: r.get(1)?,
                    source: r.get(2)?,
                    path: r.get(3)?,
                    sample_rate: r.get(4)?,
                    duration_ms: r.get(5)?,
                    status: r.get(6)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    // ---------- segments ----------

    pub fn insert_segments(&self, meeting_id: &str, segs: &[NewSegment]) -> Result<Vec<Segment>> {
        let mut out = Vec::new();
        {
            let mut c = self.conn();
            let tx = c.transaction()?;
            for s in segs {
                tx.execute(
                    "INSERT INTO segments(meeting_id,source,speaker,start_ms,end_ms,text,original_text,language,model_id) VALUES(?,?,?,?,?,?,?,?,?)",
                    params![meeting_id, s.source, s.speaker, s.start_ms, s.end_ms, s.text, s.text, s.language, s.model_id],
                )?;
                let id = tx.last_insert_rowid();
                tx.execute(
                    "INSERT INTO search_index(meeting_id,kind,ref_id,start_ms,text) VALUES(?,?,?,?,?)",
                    params![meeting_id, "segment", id, s.start_ms, s.text],
                )?;
                out.push(id);
            }
            tx.commit()?;
        }
        let all = self.segments(meeting_id)?;
        Ok(all.into_iter().filter(|s| out.contains(&s.id)).collect())
    }

    pub fn segments(&self, meeting_id: &str) -> Result<Vec<Segment>> {
        let c = self.conn();
        let mut st = c.prepare(&format!("SELECT {SEGMENT_COLS} FROM segments WHERE meeting_id=? ORDER BY start_ms, id"))?;
        let rows = st.query_map([meeting_id], segment_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn segments_by_ids(&self, ids: &[i64]) -> Result<Vec<Segment>> {
        let c = self.conn();
        let mut st = c.prepare(&format!("SELECT {SEGMENT_COLS} FROM segments WHERE id=?"))?;
        let mut out = Vec::new();
        for id in ids {
            if let Some(s) = st.query_row([id], segment_row).optional()? {
                out.push(s);
            }
        }
        Ok(out)
    }

    pub fn update_segment_text(&self, id: i64, text: &str) -> Result<()> {
        let c = self.conn();
        c.execute("UPDATE segments SET text=?1, edited=CASE WHEN ?1=original_text THEN 0 ELSE 1 END WHERE id=?2", params![text, id])?;
        c.execute("UPDATE search_index SET text=? WHERE kind='segment' AND ref_id=?", params![text, id])?;
        Ok(())
    }

    pub fn delete_segments(&self, meeting_id: &str) -> Result<()> {
        let c = self.conn();
        c.execute("DELETE FROM segments WHERE meeting_id=?", [meeting_id])?;
        c.execute("DELETE FROM search_index WHERE meeting_id=? AND kind='segment'", [meeting_id])?;
        c.execute("DELETE FROM embeddings WHERE meeting_id=? AND kind='segment'", [meeting_id])?;
        Ok(())
    }

    pub fn delete_segment_ids(&self, ids: &[i64]) -> Result<()> {
        let c = self.conn();
        for id in ids {
            c.execute("DELETE FROM segments WHERE id=?", [id])?;
            c.execute("DELETE FROM search_index WHERE kind='segment' AND ref_id=?", [id])?;
        }
        Ok(())
    }

    // ---------- notes ----------

    pub fn latest_note(&self, meeting_id: &str, kind: &str) -> Result<Option<Note>> {
        Ok(self
            .conn()
            .query_row(
                "SELECT id,meeting_id,kind,version,content,structured,model_id,template_id,created_at FROM notes
                 WHERE meeting_id=? AND kind=? ORDER BY version DESC LIMIT 1",
                params![meeting_id, kind],
                note_row,
            )
            .optional()?)
    }

    pub fn note_versions(&self, meeting_id: &str, kind: &str) -> Result<Vec<Note>> {
        let c = self.conn();
        let mut st = c.prepare(
            "SELECT id,meeting_id,kind,version,content,structured,model_id,template_id,created_at FROM notes
             WHERE meeting_id=? AND kind=? ORDER BY version DESC",
        )?;
        let rows = st.query_map(params![meeting_id, kind], note_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Manual notes are saved in place (one evolving row); enhanced notes append a new version.
    pub fn save_manual_note(&self, meeting_id: &str, content: &str) -> Result<()> {
        {
            let c = self.conn();
            let n = c.execute("UPDATE notes SET content=?, created_at=? WHERE meeting_id=? AND kind='manual'", params![content, now_ms(), meeting_id])?;
            if n == 0 {
                c.execute(
                    "INSERT INTO notes(meeting_id,kind,version,content,created_at) VALUES(?,'manual',1,?,?)",
                    params![meeting_id, content, now_ms()],
                )?;
            }
            c.execute("UPDATE meetings SET updated_at=? WHERE id=?", params![now_ms(), meeting_id])?;
        }
        self.reindex_notes(meeting_id)
    }

    pub fn add_enhanced_note(&self, meeting_id: &str, content: &str, structured: Option<&Value>, model_id: &str, template_id: &str) -> Result<Note> {
        {
            let c = self.conn();
            let v: i64 = c.query_row(
                "SELECT COALESCE(MAX(version),0)+1 FROM notes WHERE meeting_id=? AND kind='enhanced'",
                [meeting_id],
                |r| r.get(0),
            )?;
            c.execute(
                "INSERT INTO notes(meeting_id,kind,version,content,structured,model_id,template_id,created_at) VALUES(?,'enhanced',?,?,?,?,?,?)",
                params![meeting_id, v, content, structured.map(|s| s.to_string()), model_id, template_id, now_ms()],
            )?;
        }
        self.reindex_notes(meeting_id)?;
        Ok(self.latest_note(meeting_id, "enhanced")?.expect("just inserted"))
    }

    /// User edits to the current enhanced note: saved in place on the latest version.
    pub fn edit_enhanced_note(&self, meeting_id: &str, content: &str) -> Result<()> {
        self.conn().execute(
            "UPDATE notes SET content=? WHERE id=(SELECT id FROM notes WHERE meeting_id=? AND kind='enhanced' ORDER BY version DESC LIMIT 1)",
            params![content, meeting_id],
        )?;
        self.reindex_notes(meeting_id)
    }

    // ---------- action items ----------

    pub fn replace_action_items(&self, meeting_id: &str, items: &[ActionItem]) -> Result<()> {
        // Items already ticked off stay done when notes are regenerated (matched by wording).
        let done: Vec<String> = self.action_items(Some(meeting_id))?.into_iter().filter(|a| a.status == "done").map(|a| a.description).collect();
        {
            let mut c = self.conn();
            let tx = c.transaction()?;
            tx.execute("DELETE FROM action_items WHERE meeting_id=?", [meeting_id])?;
            for a in items {
                let mut a = a.clone();
                if done.iter().any(|d| crate::audio::similarity(d, &a.description) >= 0.7) {
                    a.status = "done".into();
                }
                tx.execute(
                    "INSERT INTO action_items(meeting_id,description,owner,deadline,kind,status,verified,evidence,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                    params![meeting_id, a.description, a.owner, a.deadline, a.kind, a.status, a.verified as i64, serde_json::to_string(&a.evidence)?, now_ms()],
                )?;
            }
            tx.commit()?;
        }
        self.reindex_actions(meeting_id)
    }

    pub fn action_items(&self, meeting_id: Option<&str>) -> Result<Vec<ActionItem>> {
        let c = self.conn();
        let sql = "SELECT id,meeting_id,description,owner,deadline,kind,status,verified,evidence,created_at FROM action_items";
        let rows = if let Some(m) = meeting_id {
            let mut st = c.prepare(&format!("{sql} WHERE meeting_id=? ORDER BY id"))?;
            let r = st.query_map([m], action_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
            r
        } else {
            let mut st = c.prepare(&format!("{sql} ORDER BY created_at DESC"))?;
            let r = st.query_map([], action_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
            r
        };
        Ok(rows)
    }

    pub fn set_action_status(&self, id: i64, status: &str) -> Result<()> {
        self.conn().execute("UPDATE action_items SET status=? WHERE id=?", params![status, id])?;
        Ok(())
    }

    // ---------- marks ----------

    pub fn add_mark(&self, meeting_id: &str, at_ms: i64, label: &str) -> Result<Mark> {
        let c = self.conn();
        c.execute("INSERT INTO marks(meeting_id,at_ms,label,created_at) VALUES(?,?,?,?)", params![meeting_id, at_ms, label, now_ms()])?;
        Ok(Mark { id: c.last_insert_rowid(), meeting_id: meeting_id.into(), at_ms, label: label.into() })
    }

    pub fn marks(&self, meeting_id: &str) -> Result<Vec<Mark>> {
        let c = self.conn();
        let mut st = c.prepare("SELECT id,meeting_id,at_ms,label FROM marks WHERE meeting_id=? ORDER BY at_ms")?;
        let rows = st
            .query_map([meeting_id], |r| Ok(Mark { id: r.get(0)?, meeting_id: r.get(1)?, at_ms: r.get(2)?, label: r.get(3)? }))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    // ---------- models ----------

    pub fn installed_models(&self) -> Result<Vec<InstalledModel>> {
        let c = self.conn();
        let mut st = c.prepare("SELECT id,role,name,family,version,path,quant,size,sha256,status,installed_at FROM models ORDER BY installed_at")?;
        let rows = st
            .query_map([], |r| {
                Ok(InstalledModel {
                    id: r.get(0)?,
                    role: r.get(1)?,
                    name: r.get(2)?,
                    family: r.get(3)?,
                    version: r.get(4)?,
                    path: r.get(5)?,
                    quant: r.get(6)?,
                    size: r.get(7)?,
                    sha256: r.get(8)?,
                    status: r.get(9)?,
                    installed_at: r.get(10)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn installed_model(&self, id: &str) -> Result<Option<InstalledModel>> {
        Ok(self.installed_models()?.into_iter().find(|m| m.id == id && m.status == "ready"))
    }

    pub fn upsert_model(&self, m: &InstalledModel) -> Result<()> {
        self.conn().execute(
            "INSERT INTO models(id,role,name,family,version,path,quant,size,sha256,status,installed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET path=excluded.path, size=excluded.size, sha256=excluded.sha256, status=excluded.status, installed_at=excluded.installed_at, version=excluded.version, quant=excluded.quant, name=excluded.name",
            params![m.id, m.role, m.name, m.family, m.version, m.path, m.quant, m.size, m.sha256, m.status, m.installed_at],
        )?;
        Ok(())
    }

    pub fn set_model_origin(&self, id: &str, origin: &Value) -> Result<()> {
        self.conn().execute("UPDATE models SET metadata=json_set(COALESCE(metadata,'{}'), '$.origin', json(?)) WHERE id=?", params![origin.to_string(), id])?;
        Ok(())
    }

    pub fn model_origin(&self, id: &str) -> Option<Value> {
        let s: Option<String> = self.conn().query_row("SELECT json_extract(metadata,'$.origin') FROM models WHERE id=?", [id], |r| r.get(0)).optional().ok().flatten().flatten();
        s.and_then(|s| serde_json::from_str(&s).ok())
    }

    pub fn delete_model(&self, id: &str) -> Result<()> {
        self.conn().execute("DELETE FROM models WHERE id=?", [id])?;
        Ok(())
    }

    // ---------- templates ----------

    pub fn templates(&self) -> Result<Vec<Template>> {
        let c = self.conn();
        let mut st = c.prepare("SELECT id,name,instructions,builtin FROM templates ORDER BY builtin DESC, created_at")?;
        let rows = st
            .query_map([], |r| Ok(Template { id: r.get(0)?, name: r.get(1)?, instructions: r.get(2)?, builtin: r.get::<_, i64>(3)? != 0 }))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn template(&self, id: &str) -> Result<Template> {
        self.templates()?
            .into_iter()
            .find(|t| t.id == id)
            .map(Ok)
            .unwrap_or_else(|| self.template("general"))
    }

    pub fn save_template(&self, id: Option<&str>, name: &str, instructions: &str) -> Result<Template> {
        let id = id.map(String::from).unwrap_or_else(|| format!("custom-{}", uuid::Uuid::new_v4()));
        let n = self.conn().execute(
            "INSERT INTO templates(id,name,instructions,builtin,created_at) VALUES(?,?,?,0,?)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, instructions=excluded.instructions WHERE builtin=0",
            params![id, name, instructions, now_ms()],
        )?;
        if n == 0 {
            return Err(anyhow!("built-in templates cannot be edited"));
        }
        self.template(&id)
    }

    pub fn delete_template(&self, id: &str) -> Result<()> {
        self.conn().execute("DELETE FROM templates WHERE id=? AND builtin=0", [id])?;
        Ok(())
    }

    // ---------- chat ----------

    pub fn create_thread(&self, meeting_id: Option<&str>, title: &str) -> Result<String> {
        let id = uuid::Uuid::new_v4().to_string();
        self.conn().execute(
            "INSERT INTO chat_threads(id,meeting_id,title,created_at) VALUES(?,?,?,?)",
            params![id, meeting_id, title, now_ms()],
        )?;
        Ok(id)
    }

    pub fn threads(&self, meeting_id: Option<&str>) -> Result<Vec<Value>> {
        let c = self.conn();
        let mut st = c.prepare(
            "SELECT id,meeting_id,title,created_at FROM chat_threads WHERE (?1 IS NULL AND meeting_id IS NULL) OR meeting_id=?1 ORDER BY created_at DESC",
        )?;
        let rows = st
            .query_map([meeting_id], |r| {
                Ok(serde_json::json!({"id": r.get::<_,String>(0)?, "meetingId": r.get::<_,Option<String>>(1)?, "title": r.get::<_,String>(2)?, "createdAt": r.get::<_,i64>(3)?}))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn add_message(&self, thread_id: &str, role: &str, content: &str, sources: &Value) -> Result<ChatMessage> {
        let c = self.conn();
        let t = now_ms();
        c.execute(
            "INSERT INTO chat_messages(thread_id,role,content,sources,created_at) VALUES(?,?,?,?,?)",
            params![thread_id, role, content, sources.to_string(), t],
        )?;
        Ok(ChatMessage { id: c.last_insert_rowid(), thread_id: thread_id.into(), role: role.into(), content: content.into(), sources: sources.clone(), created_at: t })
    }

    pub fn messages(&self, thread_id: &str) -> Result<Vec<ChatMessage>> {
        let c = self.conn();
        let mut st = c.prepare("SELECT id,thread_id,role,content,sources,created_at FROM chat_messages WHERE thread_id=? ORDER BY id")?;
        let rows = st
            .query_map([thread_id], |r| {
                let s: String = r.get(4)?;
                Ok(ChatMessage {
                    id: r.get(0)?,
                    thread_id: r.get(1)?,
                    role: r.get(2)?,
                    content: r.get(3)?,
                    sources: serde_json::from_str(&s).unwrap_or(Value::Array(vec![])),
                    created_at: r.get(5)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn delete_thread(&self, id: &str) -> Result<()> {
        self.conn().execute("DELETE FROM chat_threads WHERE id=?", [id])?;
        Ok(())
    }

    // ---------- search index ----------

    pub fn reindex_meeting(&self, id: &str) -> Result<()> {
        {
            let c = self.conn();
            c.execute("DELETE FROM search_index WHERE meeting_id=? AND kind='title'", [id])?;
            c.execute(
                "INSERT INTO search_index(meeting_id,kind,ref_id,start_ms,text) SELECT id,'title',0,NULL,title FROM meetings WHERE id=?",
                [id],
            )?;
        }
        Ok(())
    }

    fn reindex_notes(&self, id: &str) -> Result<()> {
        let c = self.conn();
        c.execute("DELETE FROM search_index WHERE meeting_id=? AND kind IN ('manual','enhanced')", [id])?;
        for kind in ["manual", "enhanced"] {
            c.execute(
                "INSERT INTO search_index(meeting_id,kind,ref_id,start_ms,text)
                 SELECT meeting_id, kind, id, NULL, content FROM notes WHERE meeting_id=? AND kind=? ORDER BY version DESC LIMIT 1",
                params![id, kind],
            )?;
        }
        Ok(())
    }

    fn reindex_actions(&self, id: &str) -> Result<()> {
        let c = self.conn();
        c.execute("DELETE FROM search_index WHERE meeting_id=? AND kind='action'", [id])?;
        c.execute(
            "INSERT INTO search_index(meeting_id,kind,ref_id,start_ms,text)
             SELECT meeting_id,'action',id,NULL, description || COALESCE(' — ' || owner,'') || COALESCE(' (' || deadline || ')','') FROM action_items WHERE meeting_id=?",
            [id],
        )?;
        Ok(())
    }

    /// Full-text search. The trigram tokenizer needs >= 3 characters per term, so
    /// shorter terms (common for Chinese words) fall back to a substring scan.
    pub fn search(&self, query: &str, meeting_id: Option<&str>, kinds: Option<&[String]>, limit: usize) -> Result<Vec<SearchHit>> {
        let terms: Vec<String> = query
            .split(|c: char| c.is_whitespace() || ",.?!;:\"'()，。？！；：「」".contains(c))
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
        if terms.is_empty() {
            return Ok(vec![]);
        }
        let long: Vec<&String> = terms.iter().filter(|t| t.chars().count() >= 3).collect();
        let short: Vec<&String> = terms.iter().filter(|t| t.chars().count() < 3).collect();
        let c = self.conn();
        let mut hits: Vec<SearchHit> = Vec::new();
        let base = "SELECT s.meeting_id, m.title, COALESCE(m.started_at, m.created_at), s.kind, s.ref_id, s.start_ms";
        if !long.is_empty() {
            let fts = long.iter().map(|t| format!("\"{}\"", t.replace('"', "\"\""))).collect::<Vec<_>>().join(" OR ");
            let sql = format!(
                "{base}, snippet(search_index, 4, '«', '»', '…', 64), s.text, bm25(search_index) FROM search_index s JOIN meetings m ON m.id=s.meeting_id
                 WHERE search_index MATCH ?1 AND (?2 IS NULL OR s.meeting_id=?2) ORDER BY bm25(search_index) LIMIT ?3"
            );
            let mut st = c.prepare(&sql)?;
            let rows = st.query_map(params![fts, meeting_id, (limit * 3) as i64], |r| {
                Ok(SearchHit {
                    meeting_id: r.get(0)?,
                    meeting_title: r.get(1)?,
                    meeting_date: r.get(2)?,
                    kind: r.get(3)?,
                    ref_id: r.get(4)?,
                    start_ms: r.get(5)?,
                    snippet: r.get(6)?,
                    text: r.get(7)?,
                    score: -r.get::<_, f64>(8)?,
                })
            })?;
            for r in rows {
                hits.push(r?);
            }
        }
        for t in short {
            let sql = format!(
                "{base}, s.text, s.text FROM search_index s JOIN meetings m ON m.id=s.meeting_id
                 WHERE s.text LIKE ?1 AND (?2 IS NULL OR s.meeting_id=?2) LIMIT ?3"
            );
            let mut st = c.prepare(&sql)?;
            let pat = format!("%{}%", t.replace('%', "\\%"));
            let rows = st.query_map(params![pat, meeting_id, (limit * 3) as i64], |r| {
                let text: String = r.get(7)?;
                Ok(SearchHit {
                    meeting_id: r.get(0)?,
                    meeting_title: r.get(1)?,
                    meeting_date: r.get(2)?,
                    kind: r.get(3)?,
                    ref_id: r.get(4)?,
                    start_ms: r.get(5)?,
                    snippet: excerpt(&text, t, 60),
                    text,
                    score: 0.5,
                })
            })?;
            for r in rows {
                let h = r?;
                if let Some(e) = hits.iter_mut().find(|x| x.kind == h.kind && x.ref_id == h.ref_id && x.meeting_id == h.meeting_id) {
                    e.score += 0.5;
                } else {
                    hits.push(h);
                }
            }
        }
        if let Some(k) = kinds {
            hits.retain(|h| k.iter().any(|x| x == &h.kind));
        }
        hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        hits.truncate(limit);
        Ok(hits)
    }

    // ---------- embeddings ----------

    pub fn replace_embeddings(&self, meeting_id: &str, rows: &[(String, i64, Option<i64>, String, Vec<f32>)], model_id: &str) -> Result<()> {
        let mut c = self.conn();
        let tx = c.transaction()?;
        tx.execute("DELETE FROM embeddings WHERE meeting_id=?", [meeting_id])?;
        for (kind, ref_id, start, text, v) in rows {
            let bytes: Vec<u8> = v.iter().flat_map(|f| f.to_le_bytes()).collect();
            tx.execute(
                "INSERT INTO embeddings(meeting_id,kind,ref_id,start_ms,text,vector,model_id) VALUES(?,?,?,?,?,?,?)",
                params![meeting_id, kind, ref_id, start, text, bytes, model_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn embedded_meetings(&self, model_id: &str) -> Result<Vec<String>> {
        let c = self.conn();
        let mut st = c.prepare("SELECT DISTINCT meeting_id FROM embeddings WHERE model_id=?")?;
        let rows = st.query_map([model_id], |r| r.get(0))?.collect::<rusqlite::Result<Vec<String>>>()?;
        Ok(rows)
    }

    /// Brute-force cosine similarity over stored vectors.
    // shortcut: linear scan is fine for thousands of chunks; add an ANN index past ~100k chunks.
    pub fn vector_search(&self, q: &[f32], meeting_id: Option<&str>, model_id: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let c = self.conn();
        let mut st = c.prepare(
            "SELECT e.meeting_id, m.title, COALESCE(m.started_at,m.created_at), e.kind, e.ref_id, e.start_ms, e.text, e.vector
             FROM embeddings e JOIN meetings m ON m.id=e.meeting_id WHERE e.model_id=?1 AND (?2 IS NULL OR e.meeting_id=?2)",
        )?;
        let qn = norm(q);
        let mut hits: Vec<SearchHit> = st
            .query_map(params![model_id, meeting_id], |r| {
                let bytes: Vec<u8> = r.get(7)?;
                let v: Vec<f32> = bytes.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
                let dot: f32 = v.iter().zip(q).map(|(a, b)| a * b).sum();
                let text: String = r.get(6)?;
                Ok(SearchHit {
                    meeting_id: r.get(0)?,
                    meeting_title: r.get(1)?,
                    meeting_date: r.get(2)?,
                    kind: r.get(3)?,
                    ref_id: r.get(4)?,
                    start_ms: r.get(5)?,
                    snippet: text.chars().take(160).collect(),
                    text,
                    score: (dot / (norm(&v) * qn).max(1e-6)) as f64,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        hits.truncate(limit);
        Ok(hits)
    }
}

fn norm(v: &[f32]) -> f32 {
    v.iter().map(|x| x * x).sum::<f32>().sqrt()
}

/// A short excerpt of `text` around the first occurrence of `term`.
pub fn excerpt(text: &str, term: &str, radius: usize) -> String {
    let lower = text.to_lowercase();
    let Some(byte) = lower.find(&term.to_lowercase()) else {
        return text.chars().take(radius * 2).collect();
    };
    let pos = lower[..byte].chars().count();
    let chars: Vec<char> = text.chars().collect();
    let start = pos.saturating_sub(radius);
    let end = (pos + term.chars().count() + radius).min(chars.len());
    let mut s: String = chars[start..end].iter().collect();
    if start > 0 {
        s = format!("…{s}");
    }
    if end < chars.len() {
        s.push('…');
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(text: &str, start: i64) -> NewSegment {
        NewSegment { source: "system".into(), speaker: Some("Them".into()), start_ms: start, end_ms: start + 1000, text: text.into(), language: None, model_id: "m".into() }
    }

    #[test]
    fn meeting_lifecycle_and_cascade() {
        let db = Db::memory().unwrap();
        let m = db.create_meeting("Pricing review", "general").unwrap();
        db.insert_segments(&m.id, &[seg("We agreed the price is 40 dollars", 0)]).unwrap();
        db.save_manual_note(&m.id, "price?").unwrap();
        db.add_mark(&m.id, 500, "important").unwrap();
        assert_eq!(db.segments(&m.id).unwrap().len(), 1);
        db.delete_meeting(&m.id).unwrap();
        let c = db.conn();
        for t in ["segments", "notes", "marks", "search_index"] {
            let n: i64 = c.query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get(0)).unwrap();
            assert_eq!(n, 0, "{t} not cleaned up");
        }
    }

    #[test]
    fn search_english_and_chinese() {
        let db = Db::memory().unwrap();
        let m = db.create_meeting("Weekly sync", "general").unwrap();
        db.insert_segments(&m.id, &[seg("The customer said pricing is too high", 0), seg("我们决定下周发布测试版", 2000)]).unwrap();
        let h = db.search("pricing", None, None, 10).unwrap();
        assert_eq!(h.len(), 1);
        assert!(h[0].snippet.contains("«pricing»"));
        // two-character Chinese term uses the substring fallback
        let h = db.search("发布", None, None, 10).unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].start_ms, Some(2000));
        let h = db.search("weekly", None, None, 10).unwrap();
        assert_eq!(h[0].kind, "title");
    }

    #[test]
    fn enhanced_notes_are_versioned_and_manual_notes_untouched() {
        let db = Db::memory().unwrap();
        let m = db.create_meeting("x", "general").unwrap();
        db.save_manual_note(&m.id, "my words").unwrap();
        db.add_enhanced_note(&m.id, "v1", None, "llm", "general").unwrap();
        db.add_enhanced_note(&m.id, "v2", None, "llm", "general").unwrap();
        assert_eq!(db.latest_note(&m.id, "enhanced").unwrap().unwrap().version, 2);
        assert_eq!(db.note_versions(&m.id, "enhanced").unwrap().len(), 2);
        assert_eq!(db.latest_note(&m.id, "manual").unwrap().unwrap().content, "my words");
    }

    #[test]
    fn segment_edit_keeps_original() {
        let db = Db::memory().unwrap();
        let m = db.create_meeting("x", "general").unwrap();
        let s = db.insert_segments(&m.id, &[seg("helo world", 0)]).unwrap();
        db.update_segment_text(s[0].id, "hello world").unwrap();
        let s = &db.segments(&m.id).unwrap()[0];
        assert_eq!(s.text, "hello world");
        assert_eq!(s.original_text, "helo world");
        assert!(s.edited);
    }

    #[test]
    fn model_upsert_updates_quant() {
        let db = Db::memory().unwrap();
        let mut m = InstalledModel { id: "x".into(), role: "asr".into(), name: "X".into(), family: None, version: None, path: "/a".into(), quant: Some("Q4_K_M".into()), size: 1, sha256: "h".into(), status: "ready".into(), installed_at: 0 };
        db.upsert_model(&m).unwrap();
        m.quant = Some("Q5_K_M".into());
        m.path = "/b".into();
        db.upsert_model(&m).unwrap();
        let got = db.installed_model("x").unwrap().unwrap();
        assert_eq!(got.quant.as_deref(), Some("Q5_K_M"));
        assert_eq!(got.path, "/b");
    }

    #[test]
    fn regenerating_keeps_done_status() {
        let db = Db::memory().unwrap();
        let m = db.create_meeting("x", "general").unwrap();
        let item = |d: &str| ActionItem { id: 0, meeting_id: m.id.clone(), description: d.into(), owner: None, deadline: None, kind: "commitment".into(), status: "open".into(), verified: true, evidence: vec![], created_at: 0 };
        db.replace_action_items(&m.id, &[item("Write the release notes"), item("Book the venue")]).unwrap();
        let first = db.action_items(Some(&m.id)).unwrap();
        db.set_action_status(first[0].id, "done").unwrap();
        db.replace_action_items(&m.id, &[item("write the release notes"), item("Update pricing page")]).unwrap();
        let after = db.action_items(Some(&m.id)).unwrap();
        assert_eq!(after.iter().find(|a| a.description == "write the release notes").unwrap().status, "done");
        assert_eq!(after.iter().find(|a| a.description == "Update pricing page").unwrap().status, "open");
    }

    #[test]
    fn builtin_templates_are_read_only() {
        let db = Db::memory().unwrap();
        assert!(db.save_template(Some("general"), "x", "y").is_err());
        let t = db.save_template(None, "Standup", "Yesterday / today / blockers").unwrap();
        assert!(!t.builtin);
    }
}
