export function fmtTs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s / 60) % 60);
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

export function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}

export function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return ms > 0 ? "<1 min" : "";
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/** "Today", "Yesterday", or a date heading, for grouping the meeting list. */
export function dayLabel(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7 && diff > 0) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

export function relTime(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return fmtDate(ms);
}

/** Letter grade from a published error rate (%), like Handy's model table. */
export function grade(errorPct: number | undefined): "A" | "B" | "C" | "D" | "F" | null {
  if (errorPct == null) return null;
  if (errorPct <= 5) return "A";
  if (errorPct <= 9) return "B";
  if (errorPct <= 14) return "C";
  if (errorPct <= 22) return "D";
  return "F";
}

/** 1–4 speed dots from a published real-time factor. */
export function speedLevel(rtf: number | null): number {
  if (rtf == null) return 0;
  if (rtf >= 20) return 4;
  if (rtf >= 9) return 3;
  if (rtf >= 4) return 2;
  return 1;
}

export const LANGUAGES: Record<string, string> = {
  en: "English", zh: "Mandarin Chinese", yue: "Cantonese", ms: "Malay", id: "Indonesian", ja: "Japanese", ko: "Korean",
  ta: "Tamil", hi: "Hindi", th: "Thai", vi: "Vietnamese", fil: "Filipino", de: "German", fr: "French", es: "Spanish",
  pt: "Portuguese", it: "Italian", nl: "Dutch", ru: "Russian", uk: "Ukrainian", pl: "Polish", sv: "Swedish", da: "Danish",
  fi: "Finnish", cs: "Czech", el: "Greek", ro: "Romanian", hu: "Hungarian", tr: "Turkish", ar: "Arabic", fa: "Persian",
  he: "Hebrew", bg: "Bulgarian", hr: "Croatian", sk: "Slovak", sl: "Slovenian", et: "Estonian", lv: "Latvian", lt: "Lithuanian",
  mt: "Maltese", mk: "Macedonian", no: "Norwegian", ca: "Catalan",
};

export const PRIORITY_LANGUAGES = ["en", "zh", "yue", "ms", "id", "ja", "ko", "ta", "hi", "th", "vi", "fil", "de", "fr", "es", "pt", "it", "nl", "ru", "ar"];

const display = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "language" }) : null;
export function langName(code: string): string {
  if (LANGUAGES[code]) return LANGUAGES[code];
  try {
    return display?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "«x»" markers from the search backend -> safe <mark> HTML. */
export function highlight(snippet: string): string {
  const esc = snippet.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/«/g, "<mark>").replace(/»/g, "</mark>");
}
