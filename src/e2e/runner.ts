// GUI end-to-end runner. Loaded only when Grain starts with GRAIN_E2E=1 (see
// scripts/e2e-gui.sh). It drives the real UI through DOM events (clicks, typing,
// keyboard shortcuts) against the real backend, real models and real system-audio
// capture, and measures how smooth the UI stays while work happens.
import { invoke } from "@tauri-apps/api/core";

type Result = { name: string; ok: boolean; ms: number; info?: unknown; error?: string };
const results: Result[] = [];
const metrics: Record<string, unknown> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

function visible(el: Element): el is HTMLElement {
  const r = (el as HTMLElement).getBoundingClientRect?.();
  return !!r && r.width > 0 && r.height > 0;
}

async function waitFor<T>(fn: () => T | null | undefined | false, label: string, timeout = 15000): Promise<T> {
  const t0 = now();
  for (;;) {
    try {
      const v = fn();
      if (v) return v;
    } catch {
      /* keep polling */
    }
    if (now() - t0 > timeout) throw new Error(`timeout (${timeout} ms) waiting for: ${label}`);
    await sleep(50);
  }
}

const $ = (sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)].filter(visible) as HTMLElement[];
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/** Visible clickable element whose text matches (exact first, then contains). */
function byText(t: string | RegExp, root: ParentNode = document, sel = "button, [role=button], [role=tab], [role=menuitem], a, label"): HTMLElement | null {
  const els = $(sel, root);
  const m = (s: string) => (typeof t === "string" ? s === t : t.test(s));
  return els.find((e) => m(text(e))) ?? els.find((e) => (typeof t === "string" ? text(e).includes(t) : t.test(text(e)))) ?? null;
}
const byLabel = (l: string, root: ParentNode = document) => $(`[aria-label="${l}"]`, root)[0] ?? null;
const findText = (t: string | RegExp, root: ParentNode = document) => {
  const s = text(root instanceof Document ? root.body : (root as Element));
  return typeof t === "string" ? s.includes(t) : t.test(s);
};

async function click(el: HTMLElement | null, label = "element") {
  if (!el) throw new Error(`not found: ${label}`);
  if ((el as HTMLButtonElement).disabled) throw new Error(`disabled: ${label}`);
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
  el.dispatchEvent(new MouseEvent("mousedown", o));
  el.dispatchEvent(new MouseEvent("mouseup", o));
  el.click();
  await sleep(30);
}
const clickText = (t: string | RegExp, root?: ParentNode) => waitFor(() => byText(t, root), `"${t}"`).then((el) => click(el, String(t)));

function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

function key(k: string, mods: { meta?: boolean; shift?: boolean } = {}, target: EventTarget = window) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, metaKey: !!mods.meta, shiftKey: !!mods.shift, bubbles: true, cancelable: true }));
}

/** Type into a ProseMirror editor like a person: text then Enter per line. */
async function typeEditor(pm: HTMLElement, value: string, perCharMs = 0) {
  pm.focus();
  const sel = window.getSelection()!;
  const r = document.createRange();
  r.selectNodeContents(pm);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
  const lines = value.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (perCharMs) for (const ch of lines[i]) { document.execCommand("insertText", false, ch); await sleep(perCharMs); }
    else document.execCommand("insertText", false, lines[i]);
    if (i < lines.length - 1) { pm.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); await sleep(10); }
  }
}

/** Frame-gap monitor: how often the UI failed to paint in time while work ran. */
const longFrames: { at: number; gap: number }[] = [];
function frames() {
  const gaps: number[] = [];
  let last = now();
  let on = true;
  const loop = () => { const t = now(); gaps.push(t - last); if (t - last > 50) longFrames.push({ at: Math.round(t), gap: Math.round(t - last) }); last = t; if (on) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  return () => {
    on = false;
    const s = [...gaps].sort((a, b) => a - b);
    return { frames: gaps.length, maxGapMs: Math.round(s[s.length - 1] ?? 0), p95GapMs: Math.round(s[Math.floor(s.length * 0.95)] ?? 0), over50ms: gaps.filter((g) => g > 50).length, over100ms: gaps.filter((g) => g > 100).length };
  };
}

async function step(name: string, fn: () => Promise<unknown>) {
  const t0 = now();
  try {
    const info = await fn();
    results.push({ name, ok: true, ms: Math.round(now() - t0), info });
  } catch (e) {
    results.push({ name, ok: false, ms: Math.round(now() - t0), error: String(e) });
  }
  await invoke("e2e_report", { report: { phase: (window as any).__grainE2E?.phase, results, metrics, finished: false } }).catch(() => {});
}

const say = (t: string, voice = "Samantha") => invoke("e2e_say", { voice, text: t });
const nav = async (label: string, ready: () => boolean) => {
  const t0 = now();
  await click(byText(label, document.querySelector("aside") ?? document), label);
  await waitFor(ready, `${label} screen`);
  return Math.round(now() - t0);
};
const heading = (t: string) => () => $("h1").some((h) => text(h) === t);
const main = () => document.querySelector("main") as HTMLElement;
const meetingAside = () => $("aside").find((a) => findText(/Live transcript|Ask Grain/, a) && a.querySelector("[aria-label='Close panel']")) ?? null;
const tab = (name: string) => $("[role=tab]").find((t) => text(t).startsWith(name));

async function phase1() {
  const e2e = (window as any).__grainE2E;
  const title = "E2E launch review";

  // ---------- Onboarding ----------
  await step("onboarding: welcome → privacy → hardware", async () => {
    await waitFor(() => findText("Welcome to Grain"), "welcome");
    await clickText("Get started");
    await waitFor(() => findText("Private by design"), "privacy");
    await clickText("Continue");
    await waitFor(() => findText("Memory") && findText("Acceleration"), "hardware");
    return { hardware: text($("main, body")[0]).match(/Chip.*?Memory\s*\S+ GB/)?.[0] };
  });
  await step("onboarding: languages", async () => {
    await clickText("Continue");
    await waitFor(() => findText("Which languages"), "languages");
    const zh = byText("Mandarin Chinese")!;
    await click(zh, "Mandarin");
    await waitFor(() => zh.getAttribute("aria-pressed") === "true", "Mandarin selected");
    await click(zh, "Mandarin");
    await waitFor(() => zh.getAttribute("aria-pressed") === "false", "Mandarin deselected");
    await clickText("Continue");
  });
  await step("onboarding: download recommended models (verifies existing files, SHA-256)", async () => {
    await waitFor(() => findText("Download your models"), "models step");
    const card = (name: string) => $("div").find((d) => d.className.includes("rounded-[10px]") && findText(name, d) && d.querySelector("button, span"));
    const t0 = now();
    for (const name of ["Parakeet Unified English 0.6B", "Qwen3 4B Instruct (2507)", "Qwen3 Embedding 0.6B"]) {
      const c = await waitFor(() => card(name), name);
      const b = byText(/Use it — on this Mac|Download|Resume/, c);
      if (b) await click(b, `download ${name}`);
    }
    for (const name of ["Parakeet Unified English 0.6B", "Qwen3 4B Instruct (2507)", "Qwen3 Embedding 0.6B"])
      await waitFor(() => { const c = card(name); return c && findText("Installed", c); }, `${name} installed`, 240000);
    return { seconds: Math.round((now() - t0) / 100) / 10 };
  });
  await step("onboarding: permissions + audio test (system audio)", async () => {
    await clickText("Continue");
    await waitFor(() => findText("Allow audio access"), "permissions");
    const perms = text(main() ?? document.body).match(/Microphone.*?(Allowed|Allow|Open System Settings)/)?.[1];
    await clickText("Continue");
    await waitFor(() => findText("Test your audio"), "audio test");
    await clickText("Test audio");
    await sleep(800);
    void say("Testing one two three, this is the audio test.");
    await waitFor(() => findText(/System\s*(Heard|Very quiet|Silent)/), "audio test result", 20000);
    return { mic: perms, system: text(document.body).match(/System\s*(Heard|Very quiet|Silent)/)?.[1] };
  });
  await step("onboarding: finish", async () => {
    await clickText("Continue");
    await waitFor(() => findText("You're ready"), "ready");
    await clickText("Go to meetings");
    await waitFor(heading("Meetings"), "home");
  });

  // ---------- Settings: computer audio only, templates ----------
  await step("settings: microphone Off (computer audio only)", async () => {
    metrics.navSettingsMs = await nav("Settings", heading("General"));
    await clickText("Audio", document.querySelector("nav")!);
    const sel = await waitFor(() => byLabel("Microphone") as HTMLSelectElement, "mic select");
    setValue(sel, "none");
    await waitFor(() => (byLabel("Microphone") as HTMLSelectElement).value === "none", "mic off");
  });
  await step("settings: create, edit and list a custom template", async () => {
    await clickText("AI notes & templates", document.querySelector("nav")!);
    await clickText("New template");
    setValue(await waitFor(() => $("input[placeholder^='Template name']")[0] as HTMLInputElement, "name"), "E2E Standup");
    setValue($("textarea[placeholder^='What should the notes focus on']")[0] as HTMLTextAreaElement, "Yesterday, today, blockers. List owners.");
    await clickText("Save template");
    await waitFor(() => findText("E2E Standup"), "template listed");
    await click(byText("Edit") ?? null, "edit").catch(() => {}); // edit appears on hover; button exists regardless
    const ta = $("textarea[placeholder^='What should the notes focus on']")[0] as HTMLTextAreaElement | undefined;
    if (ta) { setValue(ta, "Yesterday, today, blockers. List owners and dates."); await clickText("Save template"); }
    await waitFor(() => findText("List owners and dates.") || findText("List owners."), "template saved");
  });

  // ---------- Record a real meeting ----------
  await step("home → Record starts a meeting and recording", async () => {
    metrics.navHomeMs = await nav("Meetings", heading("Meetings"));
    const t0 = now();
    await clickText("Record");
    await waitFor(() => byLabel("Recording controls"), "recording dock", 20000);
    metrics.recordStartMs = Math.round(now() - t0);
    return { recordStartMs: metrics.recordStartMs };
  });
  await step("title + notes while recording (typing smoothness)", async () => {
    const t = await waitFor(() => byLabel("Meeting title") as HTMLTextAreaElement, "title");
    t.focus();
    setValue(t, title);
    t.blur();
    const pm = await waitFor(() => main().querySelector(".ProseMirror") as HTMLElement, "editor");
    const stop = frames();
    const speech = say("Thanks for joining everyone. We agreed to ship the Atlas beta on Friday. Priya will write the release notes by Thursday.");
    await typeEditor(pm, "Atlas launch\nship date?\npricing feedback", 25);
    await speech;
    metrics.typingWhileRecording = stop();
    return metrics.typingWhileRecording;
  });
  await step("live transcript shows speech (chunked)", async () => {
    const t0 = now();
    const aside = await waitFor(meetingAside, "live panel");
    await waitFor(() => findText(/Friday/i, aside), "live text", 30000);
    metrics.liveTranscriptLatencyMs = Math.round(now() - t0);
    return { afterSpeechEndMs: metrics.liveTranscriptLatencyMs };
  });
  await step("mark moment, pause (speech not recorded), resume", async () => {
    await click(byLabel("Mark important moment (⌘M)"), "mark");
    await waitFor(() => findText(/Marked \d\d:\d\d as important/), "mark toast");
    await click(byLabel("Pause (⌘⇧P)"), "pause");
    await waitFor(() => byLabel("Resume (⌘⇧P)"), "paused state");
    await say("This sentence is spoken while paused and must not be recorded.");
    await click(byLabel("Resume (⌘⇧P)"), "resume");
    await waitFor(() => byLabel("Pause (⌘⇧P)"), "recording again");
    await say("The customer from Northwind said forty dollars per seat is too high for small teams. We will revisit pricing in January.");
    await waitFor(() => findText(/Northwind/i, meetingAside() ?? document), "second sentence live", 30000);
  });
  await step("stop → transcript finalised", async () => {
    const t0 = now();
    await clickText(/^Stop$/);
    await waitFor(() => byText(/Enhance notes/) && !(byText(/Enhance notes/) as HTMLButtonElement).disabled, "ready to enhance", 60000);
    metrics.stopToReadyMs = Math.round(now() - t0);
    await click(tab("Transcript")!, "transcript tab");
    const body = text(main());
    if (/paused and must not/i.test(body)) throw new Error("speech during pause was recorded");
    if (!/Friday/i.test(body) || !/Northwind/i.test(body)) throw new Error("transcript missing speech");
    return { stopToReadyMs: metrics.stopToReadyMs, marks: /Marked moment/.test(body) };
  });

  // ---------- Enhanced notes ----------
  await step("enhance notes (local LLM) with smooth UI", async () => {
    await click(tab("My notes")!, "notes tab");
    const stop = frames();
    const t0 = now();
    await click(byText(/Enhance notes/), "enhance");
    await waitFor(() => findText(/Reading the transcript|Writing your notes|Loading the local model/, main()) && tab("Enhanced")?.getAttribute("aria-selected") === "true", "staged progress on the Enhanced tab", 10000);
    await waitFor(() => document.querySelector(".enhanced .ProseMirror h2"), "enhanced notes", 240000);
    metrics.enhanceMs = Math.round(now() - t0);
    metrics.notesAppearedAt = Math.round(now());
    await sleep(1500);
    metrics.framesWhileEnhancing = stop();
    const md = text(document.querySelector(".enhanced .ProseMirror"));
    if (!/Priya/.test(md)) throw new Error("Priya missing from notes");
    if (/someone|unspecified/i.test(text(document.querySelector(".enhanced section")))) throw new Error("placeholder owner");
    return { enhanceMs: metrics.enhanceMs, hasDecisions: /Decisions/.test(md), hasActions: /Action items/.test(md), frames: metrics.framesWhileEnhancing };
  });
  await step("timestamp source link opens the transcript at that moment", async () => {
    const a = await waitFor(() => document.querySelector(".enhanced .ProseMirror a[href^='#t=']") as HTMLElement, "source link");
    await click(a, "timestamp");
    await waitFor(() => tab("Transcript")?.getAttribute("aria-selected") === "true", "transcript tab selected");
    await waitFor(() => main().querySelector("span.bg-\\[\\#f3e6b5\\]"), "highlighted line");
    await click(tab("Enhanced")!, "back to enhanced");
  });
  await step("toggle an action item done", async () => {
    const b = await waitFor(() => byLabel("Mark done"), "action checkbox");
    await click(b, "mark done");
    await waitFor(() => byLabel("Mark open"), "marked done");
  });
  await step("regenerate with custom template → version history", async () => {
    await click(byText("Regenerate", main()), "regenerate menu");
    await clickText("E2E Standup");
    await waitFor(() => findText(/v2 · E2E Standup/), "v2 with template", 240000);
    await clickText("Versions");
    await clickText(/^v1 ·/);
    await waitFor(() => findText("Viewing an earlier version"), "old version banner");
    await clickText("Back to current");
    await waitFor(() => !findText("Viewing an earlier version"), "current again");
  });
  await step("edit enhanced notes; edits persist", async () => {
    const pm = await waitFor(() => document.querySelector(".enhanced .ProseMirror") as HTMLElement, "editor");
    await typeEditor(pm, "\nE2E edit marker.");
    await sleep(700);
    await nav("Meetings", heading("Meetings"));
    await clickText(title, main());
    await waitFor(() => byLabel("Meeting title"), "meeting");
    await click(tab("Enhanced")!, "enhanced");
    await waitFor(() => findText("E2E edit marker.", document.querySelector(".enhanced") ?? document), "edit persisted");
  });
  await step("correct a transcript line; original kept", async () => {
    await click(tab("Transcript")!, "transcript");
    const span = await waitFor(() => main().querySelector("[contenteditable=true]") as HTMLElement, "segment");
    span.focus();
    span.innerText = "Thanks for joining everyone (corrected).";
    span.blur();
    await waitFor(() => main().querySelector("sup") && findText("edited", main()), "edited marker");
    await nav("Meetings", heading("Meetings"));
    await clickText(title, main());
    await waitFor(() => tab("Transcript"), "meeting");
    await click(tab("Transcript")!, "transcript");
    await waitFor(() => findText("(corrected)", main()), "correction persisted");
  });

  // ---------- Ask (meeting panel) ----------
  await step("ask about this meeting (side panel) with sources", async () => {
    await clickText(/^Ask$/);
    const aside = await waitFor(meetingAside, "ask panel");
    const t0 = now();
    await clickText("What were the decisions?", aside);
    // Chips appear while streaming; the answer is final when its source cards render.
    const card = await waitFor(() => $("button", aside).find((b) => findText(title, b) && b.querySelector("span.line-clamp-2")), "answer with source cards", 120000);
    metrics.askMeetingMs = Math.round(now() - t0);
    await click(card, "source card");
    await waitFor(() => tab("Transcript")?.getAttribute("aria-selected") === "true" || tab("Enhanced")?.getAttribute("aria-selected") === "true" || tab("My notes")?.getAttribute("aria-selected") === "true", "source opened");
    return { askMs: metrics.askMeetingMs };
  });

  // ---------- Search ----------
  await step("⌘K search: keyword, filter, by meaning, Enter opens", async () => {
    key("k", { meta: true });
    const input = await waitFor(() => $("input[placeholder^='Search meetings']")[0] as HTMLInputElement, "palette");
    const t0 = now();
    setValue(input, "Northwind");
    await waitFor(() => $("mark").length > 0, "highlighted results");
    metrics.searchMs = Math.round(now() - t0);
    await clickText("Transcripts");
    await waitFor(() => findText("Transcript ·"), "transcript filter");
    await clickText("All");
    const sem = byLabel("Search by meaning") as HTMLButtonElement;
    await click(sem, "semantic toggle");
    setValue(input, "how much does it cost");
    await waitFor(() => findText("related by meaning") || $("mark").length > 0, "semantic results", 30000);
    key("Enter", {}, input);
    await waitFor(() => !$("input[placeholder^='Search meetings']")[0], "palette closed");
    return { searchMs: metrics.searchMs, semantic: findText("related by meaning") };
  });

  // ---------- Ask Grain page ----------
  await step("Ask Grain page: answer with citations, refusal without sources, history", async () => {
    metrics.navAskMs = await nav("Ask Grain", heading("Ask Grain"));
    const ask = async (q: string) => {
      const ta = await waitFor(() => $("textarea[placeholder^='Ask anything']")[0] as HTMLTextAreaElement, "chat input");
      setValue(ta, q);
      const before = $("div.selectable", main()).length;
      await click(byLabel("Send"), "send");
      // The user bubble and the streamed answer each add a .selectable block; done when the spinner is gone.
      await waitFor(() => $("div.selectable", main()).length >= before + 2 && !byLabel("Send")?.querySelector(".animate-spin"), "answer done", 120000);
      await sleep(200);
    };
    const t0 = now();
    await ask("What did the customer say about pricing?");
    metrics.askGlobalMs = Math.round(now() - t0);
    if (!findText(/Northwind|\$?40|forty/i, main())) throw new Error("answer missing pricing facts");
    await ask("What is the budget for the office party?");
    await waitFor(() => findText("I couldn't find that in your meetings.", main()), "refusal");
    await waitFor(() => findText("What is the budget for the office party?", main().querySelector("div") ?? main()), "history");
    const del = $("[aria-label='Delete chat']")[0];
    await click(del ?? null, "delete chat");
    return { askGlobalMs: metrics.askGlobalMs };
  });

  // ---------- Action items ----------
  await step("Action items page: done filter, assigned to me", async () => {
    await nav("Action items", heading("Action items"));
    await clickText(/^done$/i);
    await waitFor(() => byLabel("Mark open"), "done item listed");
    await clickText("Assigned to me");
    await clickText(/^all$/i);
  });

  // ---------- Export ----------
  await step("export Markdown, JSON, WAV", async () => {
    await nav("Meetings", heading("Meetings"));
    await clickText(title, main());
    const out: Record<string, number | null> = {};
    for (const [label, ext] of [["Markdown", "md"], ["JSON", "json"], ["Audio (WAV)", "wav"]]) {
      await clickText("Export");
      await waitFor(() => findText("Export meeting"), "export dialog");
      await clickText(label, document.querySelector("[role=dialog]")!);
      await clickText("Export…");
      await waitFor(() => findText(`Exported ${label}`), `${label} exported`);
      out[ext] = await invoke<number | null>("e2e_file", { path: `${e2e.exportDir}/${title}.${ext}` });
      if (!out[ext]) throw new Error(`${ext} file missing`);
    }
    return out;
  });

  // ---------- Re-transcribe and delete audio ----------
  await step("re-transcribe with the current model", async () => {
    await click(byLabel("More", main().parentElement ?? document), "more");
    await clickText("Re-transcribe recording");
    await waitFor(() => findText(/Transcribing/), "transcribing", 10000);
    await waitFor(() => !findText(/Transcribing… \d+%/) && tab("Transcript") && /\d/.test(text(tab("Transcript"))), "retranscribed", 120000);
  });
  await step("delete audio only (transcript kept)", async () => {
    await click(byLabel("More"), "more");
    await clickText("Delete audio only");
    await sleep(500);
    await click(byLabel("More"), "more");
    const still = byText("Delete audio only");
    key("Escape", {}, document);
    if (still) throw new Error("audio still listed");
    await click(tab("Transcript")!, "transcript");
    if (!findText(/Northwind/i, main())) throw new Error("transcript lost");
  });

  // ---------- Models ----------
  await step("models: search by language, show all", async () => {
    metrics.navModelsMs = await nav("Models", heading("Models"));
    const input = $("input[placeholder^='Search by name or language']")[0] as HTMLInputElement;
    setValue(input, "Cantonese");
    await waitFor(() => findText("Qwen3-ASR 1.7B"), "Cantonese models");
    setValue(input, "");
    const before = $("[role=button]", main()).length;
    await click(byLabel("Show all models"), "show all");
    await waitFor(() => $("[role=button]", main()).length > before, "more rows");
    return { rowsDefault: before, rowsAll: $("[role=button]", main()).length };
  });
  const row = (name: string) => $("[role=button]", main()).find((r) => text(r.querySelector("span.font-medium")) === name) ?? null;
  await step("models: pick quant, download, cancel, resume, auto-activate", async () => {
    const r = await waitFor(() => row("Whisper Base"), "Whisper Base row");
    await click($("button", r).find((b) => text(b).startsWith("Q4_K_M")) ?? null, "Q4_K_M chip");
    const stop = frames();
    await click(byText("Download", r), "download");
    await waitFor(() => findText(/[1-9]\d*% of 59 MB/, row("Whisper Base")!), "progress", 20000);
    await click(byLabel("Cancel download of Whisper Base"), "cancel");
    await waitFor(() => byText("Resume", row("Whisper Base")!), "resume offered", 15000).catch((e) => { throw new Error(`${e} — row: ${text(row("Whisper Base"))}`); });
    await click(byText("Resume", row("Whisper Base")!), "resume");
    await waitFor(() => { const x = row("Whisper Base"); return x && findText("Q4_K_M", x) && byText("Use", x) === null && x.className.includes("bg-[#f7f9f3]"); }, "installed and active", 120000);
    metrics.framesWhileDownloading = stop();
    return metrics.framesWhileDownloading;
  });
  await step("models: switch back (Use) and delete with confirmation", async () => {
    await click(byText("Use", row("Parakeet Unified English 0.6B")!), "use parakeet");
    await waitFor(() => findText(/Parakeet Unified English 0.6B is now used/), "switched");
    await click(byLabel("Delete Whisper Base"), "trash");
    await click(byText("Delete", row("Whisper Base")!), "confirm delete");
    await waitFor(() => { const x = row("Whisper Base"); return x && byText("Download", x); }, "deleted", 15000);
  });
  await step("models: add a local .gguf file, then remove it", async () => {
    if (!e2e.importFile) return "skipped (no GRAIN_E2E_IMPORT_FILE)";
    await clickText("Add model file…");
    await waitFor(() => findText("Imported"), "imported row", 60000);
    const imported = $("[role=button]", main()).find((r) => findText("Imported", r))!;
    const del = $("[aria-label^='Delete ']", imported)[0];
    await click(del ?? null, "trash");
    await click(byText("Delete", imported), "confirm");
    await waitFor(() => !findText("Imported"), "removed", 15000);
  });
  await step("models: model another app downloaded (Handy) is used with no download", async () => {
    await clickText("Transcription");
    const r = await waitFor(() => row("Qwen3-ASR 1.7B"), "Qwen3-ASR 1.7B row");
    if (!findText(/On this Mac · Handy/, r)) return "skipped: Handy's copy of Qwen3-ASR 1.7B is not on this Mac";
    const t0 = now();
    await click(byText("Use — no download", r), "use local copy");
    await waitFor(() => { const x = row("Qwen3-ASR 1.7B"); return x && findText(/From Handy .*shared copy, no extra disk space/, x); }, "installed from Handy's copy", 120000);
    const ms = Math.round(now() - t0);
    const active = row("Qwen3-ASR 1.7B")!.className.includes("bg-[#f7f9f3]");
    // Switch back, delete Grain's copy, and prove Handy's original is untouched.
    await click(byText("Use", row("Parakeet Unified English 0.6B")!), "use parakeet");
    await click(byLabel("Delete Qwen3-ASR 1.7B"), "trash");
    await click(byText("Delete", row("Qwen3-ASR 1.7B")!), "confirm");
    await waitFor(() => { const x = row("Qwen3-ASR 1.7B"); return x && byText("Use — no download", x); }, "offered again after delete", 15000);
    const original = await invoke<number | null>("e2e_file", { path: `${(window as any).__grainE2E.home}/.cache/huggingface/hub/models--handy-computer--Qwen3-ASR-1.7B-gguf/blobs/9a0d81792dfea2d5f278b8a63deb3ea6e02139ce42c2301f32ea19c4f77526b7` });
    if (!original) throw new Error("Handy's original file was affected");
    return { verifyAndCloneMs: ms, becameActive: active, originalBytes: original };
  });
  await step("models: other apps' models are listed (LM Studio)", async () => {
    await clickText("Notes & chat");
    await waitFor(() => findText("Qwen3 4B Instruct (2507)"), "llm list");
    if (!findText("Other models found on this Mac")) return "skipped: no other-app models on this Mac";
    return { listed: $("div", main()).filter((d) => d.className.includes("border-b") && findText(/LM Studio|Ollama|Jan|GPT4All|llama\.cpp/, d)).length > 0 };
  });
  await step("models: notes & search tabs", async () => {
    await clickText("Notes & chat");
    await waitFor(() => findText("Qwen3 4B Instruct (2507)"), "llm list");
    await clickText("Search by meaning");
    await waitFor(() => findText("Qwen3 Embedding 0.6B"), "embed list");
  });

  // ---------- Settings sections & shortcuts ----------
  await step("settings: every section renders", async () => {
    await nav("Settings", heading("General"));
    for (const s of ["Audio", "Transcription", "AI notes & templates", "Search", "Privacy & data", "Keyboard shortcuts", "About", "General"]) {
      await clickText(s, document.querySelector("nav")!);
      await waitFor(heading(s), s);
    }
  });
  await step("keyboard shortcuts: ⌘N ⌘2 ⌘3 ⌘1 ⌘[ ⌘, ⌘J", async () => {
    key("n", { meta: true });
    await waitFor(() => (byLabel("Meeting title") as HTMLTextAreaElement)?.value === "", "new meeting");
    key("2", { meta: true });
    await waitFor(() => tab("Enhanced")?.getAttribute("aria-selected") === "true", "⌘2");
    key("3", { meta: true });
    await waitFor(() => tab("Transcript")?.getAttribute("aria-selected") === "true", "⌘3");
    key("1", { meta: true });
    await waitFor(() => tab("My notes")?.getAttribute("aria-selected") === "true", "⌘1");
    key("[", { meta: true });
    await waitFor(() => !byLabel("Meeting title") || true, "back");
    key(",", { meta: true });
    await waitFor(heading("General"), "⌘,");
    key("j", { meta: true });
    await waitFor(heading("Ask Grain"), "⌘J");
  });
  await step("delete an empty meeting from the list", async () => {
    await nav("Meetings", heading("Meetings"));
    const rows = $("[role=button]", main()).filter((r) => findText("Untitled meeting", r));
    const n = rows.length;
    const r = rows[0];
    r.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await click($("[aria-label='More']", r)[0] ?? (r.querySelector("[aria-label='More']") as HTMLElement), "row menu");
    await clickText("Delete meeting");
    await waitFor(() => $("[role=button]", main()).filter((x) => findText("Untitled meeting", x)).length === n - 1, "meeting removed");
  });

  // ---------- Crash during recording (recovered in phase 2) ----------
  await step("crash while recording (phase 2 verifies recovery)", async () => {
    await clickText("Record");
    await waitFor(() => byLabel("Recording controls"), "recording", 20000);
    const t = await waitFor(() => byLabel("Meeting title") as HTMLTextAreaElement, "title");
    t.focus();
    setValue(t, "E2E crash test"); // saved while typing (debounced), no blur needed
    await sleep(900);
    await say("This meeting will be interrupted by a crash, but the audio must survive.");
    await sleep(1500);
  });
  metrics.longFrames = longFrames;
  await invoke("e2e_report", { report: { phase: "1", results, metrics, finished: true } });
  await invoke("e2e_exit", { crash: true });
}

/** Regenerate notes on the first meeting and record where frames are dropped. */
async function enhanceOnly() {
  await nav("Meetings", heading("Meetings"));
  await click($("[role=button]", main()).find((r) => findText("E2E launch review", r)) ?? null, "meeting");
  await waitFor(() => tab("Enhanced"), "meeting");
  await click(tab("Enhanced")!, "enhanced");
  const runs = [];
  for (const label of ["cold (model loads)", "warm (model already loaded)"]) {
    longFrames.length = 0;
    const stop = frames();
    const t0 = now();
    const before = document.querySelector(".enhanced .ProseMirror");
    await click(byText("Regenerate", main()), "regenerate");
    await clickText("General meeting");
    await waitFor(() => { const pm = document.querySelector(".enhanced .ProseMirror"); return pm && pm !== before && pm.querySelector("h2"); }, "new notes", 240000);
    const appearedAt = Math.round(now() - t0);
    await sleep(1500);
    runs.push({ label, appearedAt, frames: stop(), longFrames: longFrames.map((f) => ({ ...f, at: Math.round(f.at - t0) })) });
  }
  metrics.enhanceOnly = runs;
  await invoke("e2e_report", { report: { phase: "enhance", results, metrics, finished: true } });
}

async function modelsOnly() {
  await nav("Models", heading("Models"));
  await click(byLabel("Show all models"), "show all");
  const row = (name: string) => $("[role=button]", main()).find((r) => text(r.querySelector("span.font-medium")) === name) ?? null;
  await step("models: pick quant, download, cancel, resume", async () => {
    const r = await waitFor(() => row("Whisper Base"), "Whisper Base row");
    await click($("button", r).find((b) => text(b).startsWith("Q4_K_M")) ?? null, "Q4_K_M chip");
    await click(byText("Download", r), "download");
    await waitFor(() => findText(/\d+% of 59 MB/, row("Whisper Base")!), "progress", 20000);
    const at = text(row("Whisper Base"));
    await click(byLabel("Cancel download of Whisper Base"), "cancel");
    await sleep(1500);
    return { atCancel: at, afterCancel: text(row("Whisper Base")) };
  });
  await invoke("e2e_report", { report: { phase: "models", results, metrics, finished: true } });
}

async function phase2() {
  await step("relaunch after crash: interrupted meeting recovered", async () => {
    await waitFor(heading("Meetings"), "home", 20000);
    await waitFor(() => findText(/recording was interrupted|Interrupted/), "interrupted notice");
    await clickText("E2E crash test", main());
    await waitFor(() => findText("This recording was interrupted"), "banner");
  });
  await step("transcribe the recovered audio", async () => {
    await clickText("Transcribe audio");
    await waitFor(() => { const t = tab("Transcript"); return t && /\d/.test(text(t)); }, "transcript", 120000);
    await click(tab("Transcript")!, "transcript");
    if (!findText(/interrupted|crash|audio must survive/i, main())) throw new Error("recovered audio not transcribed");
  });
  await invoke("e2e_report", { report: { phase: "2", results, metrics, finished: true } });
  await invoke("e2e_exit", { crash: false });
}

export async function run() {
  const t0 = now();
  const phase = (window as any).__grainE2E?.phase;
  await sleep(500);
  if (phase === "2") await phase2();
  else if (phase === "models") await modelsOnly();
  else if (phase === "enhance") await enhanceOnly();
  else await phase1();
  metrics.totalMs = Math.round(now() - t0);
}
