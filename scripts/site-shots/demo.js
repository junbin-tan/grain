// Browser stand-in for Grain's Rust backend, used only to capture marketing screenshots.
// Injected by shoot.mjs before the app loads. window.__SHOT (route, theme, recording) and
// window.__CATALOG (built from src-tauri/catalog) are set by the runner just before this file.
(() => {
  // Newer Chromium returns a Promise here; React would treat it as an effect cleanup. WebKit returns undefined.
  const siv = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (...a) { siv.apply(this, a); };
  // Pin the clock to 4:47 PM today so times read like a working day whenever this runs.
  const RealDate = Date;
  const pinned = new RealDate(); pinned.setHours(16, 47, 0, 0);
  const shift = pinned.getTime() - RealDate.now();
  window.Date = class extends RealDate { constructor(...a) { a.length ? super(...a) : super(RealDate.now() + shift); } static now() { return RealDate.now() + shift; } };
  const SHOT = window.__SHOT ?? {};
  const MIN = 60000;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const at = (dayOffset, h, m) => today.getTime() - dayOffset * 86400000 + (h * 60 + m) * MIN;
  const s = (mmss) => { const [m, sec] = mmss.split(":").map(Number); return (m * 60 + sec) * 1000; };

  // ── Meetings ──────────────────────────────────────────────────────────────
  const meeting = (id, title, startedAt, mins, templateId, status = "done") => ({
    id, title, createdAt: startedAt, updatedAt: startedAt + mins * MIN, startedAt, endedAt: startedAt + mins * MIN,
    durationMs: mins * MIN, status, templateId, folder: null, language: "en", metadata: {},
  });
  const M = {
    northwind: meeting("m-northwind", "Customer call: Northwind Logistics", at(0, 14, 30), 41, "customer"),
    atlas: meeting("m-atlas", "Atlas beta launch review", at(0, 10, 0), 32, "product"),
    sync: meeting("m-sync", "Weekly product sync", at(1, 11, 0), 28, "general"),
    critique: meeting("m-critique", "Design critique: onboarding flow", at(1, 15, 30), 46, "general"),
    oneone: meeting("m-1on1", "1:1 with Priya", at(2, 9, 30), 25, "oneone"),
    hiring: meeting("m-hiring", "Hiring debrief: senior iOS engineer", at(3, 16, 0), 34, "interview"),
    pricing: meeting("m-pricing", "Pricing workshop", at(4, 13, 0), 58, "product"),
    planning: meeting("m-planning", "Q1 planning kickoff", at(8, 10, 0), 63, "general"),
    live: meeting("m-live", "Roadmap review with design", Date.now() - 18 * MIN, 0, "product", "recording"),
  };
  const PREVIEW = {
    "m-northwind": "Renewal is due in March. They asked for SSO and a cheaper plan for small teams.",
    "m-atlas": "The Atlas beta ships Friday. Pricing stays at $40 per seat until a review in January.",
    "m-sync": "Search by meaning is ready for QA. Export to PDF slips one week.",
    "m-critique": "The permission screen tested well. Cut the third onboarding step.",
    "m-1on1": "Priya wants to own the release process. Check in on hiring load.",
    "m-hiring": "Strong on SwiftUI and audio. Second system-design round on Tuesday.",
    "m-pricing": "Three options on the table. Starter tier for five seats or fewer.",
    "m-planning": "Three bets for Q1: Windows research, team sharing, better speakers.",
    "m-live": "",
  };

  // ── The showcase meeting: transcript, notes, actions ──────────────────────
  let seq = 0;
  const seg = (meetingId, speaker, start, text) => ({
    id: ++seq, meetingId, source: speaker === "Me" ? "mic" : "system", speaker, startMs: s(start), endMs: s(start) + 6500,
    text, originalText: text, language: "en", modelId: "parakeet-unified-en-0.6b", status: "final", edited: false,
  });
  const atlasSegs = [
    seg("m-atlas", "Me", "00:04", "Okay, let's start. The main question today is whether the Atlas beta still ships on Friday."),
    seg("m-atlas", "Them", "00:11", "It does. QA signed off on the build last night, and the two crash reports from Tuesday are fixed."),
    seg("m-atlas", "Them", "00:19", "The only thing left is the release notes. Priya can have a draft by Thursday."),
    seg("m-atlas", "Me", "00:27", "Good. I'll update the pricing page before we send the invite email."),
    seg("m-atlas", "Them", "03:12", "On pricing, Northwind pushed back again. They think forty dollars a seat is too much for teams under ten people."),
    seg("m-atlas", "Me", "03:24", "Is that just Northwind, or are we hearing it from others too?"),
    seg("m-atlas", "Them", "03:31", "Three of the last five sales calls brought it up. All small teams."),
    seg("m-atlas", "Me", "03:45", "Then let's keep forty for the beta and review it properly in January, once we have usage data."),
    seg("m-atlas", "Them", "04:02", "Agreed. Could we at least offer a starter tier for teams of five or fewer?"),
    seg("m-atlas", "Me", "04:10", "Maybe. Let's not promise anything to customers yet."),
    seg("m-atlas", "Them", "04:18", "Fine. I'd also like to look at a referral program at some point."),
    seg("m-atlas", "Me", "04:26", "Let's park that until after launch."),
    seg("m-atlas", "Them", "12:40", "On onboarding, the new permission screen tested well. Most people got through it in under a minute."),
    seg("m-atlas", "Me", "12:52", "Great. Marco, can you send me the test recordings by Monday?"),
    seg("m-atlas", "Them", "13:01", "Yes, I'll send them Monday morning."),
    seg("m-atlas", "Me", "21:15", "One more thing. Support needs a short FAQ about where recordings are stored."),
    seg("m-atlas", "Them", "21:24", "I can write that. It's basically: everything stays on the Mac, nothing goes to a server."),
    seg("m-atlas", "Me", "21:38", "Perfect. Let's have it in the help centre before the beta goes out."),
    seg("m-atlas", "Them", "30:02", "Who's sending the invite email?"),
    seg("m-atlas", "Me", "30:07", "I will, Friday at nine, once the pricing page is live."),
  ];
  const id = (start) => atlasSegs.find((x) => x.startMs === s(start)).id;
  const ts = (start) => `[${start}](#t=${s(start)})`;

  const atlasManual = `beta friday?
- QA ok, crashes fixed
- pricing: northwind again
- onboarding test results
- FAQ for support`;

  const atlasEnhanced = `## Summary

The Atlas beta ships to customers on Friday. QA has signed off and Tuesday's crash reports are fixed ${ts("00:11")}. Pricing stays at $40 per seat for the beta, with a proper review in January ${ts("03:45")}.

## Launch

- QA signed off on last night's build; both crash reports are fixed ${ts("00:11")}
- Priya drafts the release notes by Thursday ${ts("00:19")}
- Invite email goes out Friday at 9:00, after the pricing page is live ${ts("30:07")}

## Pricing

- Northwind says $40 per seat is too high for teams under ten ${ts("03:12")}
- Three of the last five sales calls raised the same concern, all small teams ${ts("03:31")}
- A starter tier for five seats or fewer was raised *(suggested, not agreed)* ${ts("04:02")}

## Decisions

- Keep $40 per seat for the beta and review in January with usage data ${ts("03:45")}
- Park the referral program until after launch ${ts("04:26")}

## Onboarding

- The new permission screen tested well; most people finished in under a minute ${ts("12:40")}

## Open questions

- Do we offer a starter tier for small teams?
`;

  let actionId = 0;
  const action = (meetingId, description, owner, deadline, evidence, kind = "commitment", status = "open") => ({
    id: ++actionId, meetingId, description, owner, deadline, kind, status, verified: true, evidence, createdAt: M.atlas.endedAt,
  });
  const atlasActions = [
    action("m-atlas", "Draft the Atlas beta release notes", "Priya", "Thursday", [id("00:19")]),
    action("m-atlas", "Update the pricing page before the invite email", "Me", "Friday", [id("00:27"), id("30:07")]),
    action("m-atlas", "Send the onboarding test recordings", "Marco", "Monday", [id("12:52"), id("13:01")]),
    action("m-atlas", "Write a support FAQ on where recordings are stored", null, "Before the beta", [id("21:15"), id("21:24")]),
    action("m-atlas", "Look into a referral program", null, null, [id("04:18")], "suggestion"),
  ];
  const otherActions = [
    { ...action("m-northwind", "Send Northwind the SSO timeline", "Me", "Next week", []), createdAt: M.northwind.endedAt },
    { ...action("m-northwind", "Share renewal options with their finance lead", "Me", "1 December", []), createdAt: M.northwind.endedAt },
    { ...action("m-sync", "Move PDF export to next sprint", "Dan", null, [], "commitment", "done"), createdAt: M.sync.endedAt },
    { ...action("m-critique", "Remove the third onboarding step", "Marco", "Wednesday", [], "commitment", "done"), createdAt: M.critique.endedAt },
    { ...action("m-hiring", "Schedule the second system-design round", "Priya", "Tuesday", []), createdAt: M.hiring.endedAt },
  ];

  // Live meeting (recording shot).
  const liveSegs = [
    seg("m-live", "Them", "15:02", "So the big change is that search moves into the sidebar instead of living in its own window."),
    seg("m-live", "Me", "15:10", "I like that. Does it still open with command K?"),
    seg("m-live", "Them", "15:15", "Yes, same shortcut. We just stop hiding the results behind a second click."),
    seg("m-live", "Me", "15:24", "What about people with hundreds of meetings? Does the list stay fast?"),
    seg("m-live", "Them", "15:31", "We tested with two thousand meetings on an M1 Air. Results come back in about forty milliseconds."),
    seg("m-live", "Me", "15:43", "Great. Let's put that in the release notes, people will ask."),
    seg("m-live", "Them", "15:50", "Next is the speaker labels. We want to let you rename Them to the actual person."),
    seg("m-live", "Me", "16:01", "Only if it's saved per meeting. I don't want it guessing names across calls."),
    seg("m-live", "Them", "16:09", "Agreed, per meeting only. Nothing is matched across recordings."),
    seg("m-live", "Me", "16:18", "Okay. And the timeline for both of these?"),
    seg("m-live", "Them", "16:24", "Search in two weeks. Speaker names right after, so early January."),
  ];
  const liveManual = `- search moves to sidebar, still ⌘K
- 2k meetings, ~40 ms
- rename speakers, per meeting only
- `;

  const notes = (mid, manual, enhanced) => ({
    manual: { id: 1, meetingId: mid, kind: "manual", version: 1, content: manual, structured: null, modelId: null, templateId: null, createdAt: Date.now() },
    enhanced: enhanced && { id: 2, meetingId: mid, kind: "enhanced", version: 2, content: enhanced, structured: null, modelId: "qwen3-4b-instruct-2507", templateId: "product", createdAt: M.atlas.endedAt + 2 * MIN },
  });

  const detail = (mid) => {
    const m = Object.values(M).find((x) => x.id === mid) ?? M.atlas;
    const rec = (src) => ({ id: `${mid}-${src}`, meetingId: mid, source: src, path: "", sampleRate: 16000, durationMs: m.durationMs, status: "done" });
    if (mid === "m-atlas") return {
      meeting: m, ...notes(mid, atlasManual, atlasEnhanced),
      enhancedVersions: [{ version: 1, createdAt: M.atlas.endedAt + MIN, modelId: "qwen3-4b-instruct-2507", templateId: "general" }, { version: 2, createdAt: M.atlas.endedAt + 2 * MIN, modelId: "qwen3-4b-instruct-2507", templateId: "product" }],
      segments: atlasSegs, actionItems: atlasActions, marks: [{ id: 1, meetingId: mid, atMs: s("03:40"), label: "Pricing decision" }], recordings: [rec("mic"), rec("system")],
    };
    if (mid === "m-live") return { meeting: m, ...notes(mid, liveManual, null), enhancedVersions: [], segments: liveSegs, actionItems: [], marks: [], recordings: [] };
    return { meeting: m, ...notes(mid, `- ${PREVIEW[mid]}`, `## Summary\n\n${PREVIEW[mid]}`), enhancedVersions: [], segments: [], actionItems: otherActions.filter((a) => a.meetingId === mid), marks: [], recordings: [rec("mic")] };
  };

  // ── Ask Grain threads ─────────────────────────────────────────────────────
  const src = (n, m, start, excerpt, kind = "segment") => ({ n, meetingId: m.id, meetingTitle: m.title, meetingDate: m.startedAt, kind, refId: 0, startMs: start == null ? null : s(start), excerpt });
  const threads = {
    "t-meeting": {
      meta: { id: "t-meeting", meetingId: "m-atlas", title: "What did we decide on pricing?", createdAt: Date.now() - 6 * MIN },
      messages: [
        { id: 1, threadId: "t-meeting", role: "user", content: "What did we decide on pricing?", sources: [], createdAt: Date.now() - 6 * MIN },
        { id: 2, threadId: "t-meeting", role: "assistant", createdAt: Date.now() - 6 * MIN,
          content: "You kept pricing at $40 per seat for the beta and agreed to review it in January, once there is usage data [1].\n\nThe pressure comes from small teams: Northwind pushed back again [2], and three of the last five sales calls raised the same concern [3]. A starter tier for five seats or fewer was suggested but not agreed [4].",
          sources: [
            src(1, M.atlas, "03:45", "Then let's keep forty for the beta and review it properly in January, once we have usage data."),
            src(2, M.atlas, "03:12", "On pricing, Northwind pushed back again. They think forty dollars a seat is too much for teams under ten people."),
            src(3, M.atlas, "03:31", "Three of the last five sales calls brought it up. All small teams."),
            src(4, M.atlas, "04:02", "Agreed. Could we at least offer a starter tier for teams of five or fewer?"),
          ] },
      ],
    },
    "t-global": {
      meta: { id: "t-global", meetingId: null, title: "What have customers said about pricing?", createdAt: Date.now() - 20 * MIN },
      messages: [
        { id: 3, threadId: "t-global", role: "user", content: "What have customers said about pricing this week?", sources: [], createdAt: Date.now() - 20 * MIN },
        { id: 4, threadId: "t-global", role: "assistant", createdAt: Date.now() - 20 * MIN,
          content: "Small teams think $40 per seat is too high. Northwind said it directly on today's call and asked for a cheaper plan for their regional offices [1]. The same concern came up in three of the last five sales calls [2].\n\nIn Monday's pricing workshop you sketched a starter tier for five seats or fewer [3], and in today's launch review you decided to keep $40 for the beta and revisit it in January [4].",
          sources: [
            src(1, M.northwind, "08:41", "Honestly the per-seat price is the blocker for our regional offices. Most of them are four or five people."),
            src(2, M.atlas, "03:31", "Three of the last five sales calls brought it up. All small teams."),
            src(3, M.pricing, null, "Starter: up to 5 seats, single workspace, no SSO. Priced to land under $25 per seat.", "enhanced"),
            src(4, M.atlas, "03:45", "Then let's keep forty for the beta and review it properly in January, once we have usage data."),
          ] },
      ],
    },
    "t-2": { meta: { id: "t-2", meetingId: null, title: "Action items assigned to me", createdAt: Date.now() - 26 * 3600000 }, messages: [] },
    "t-3": { meta: { id: "t-3", meetingId: null, title: "Summarise the hiring debriefs", createdAt: Date.now() - 50 * 3600000 }, messages: [] },
    "t-4": { meta: { id: "t-4", meetingId: null, title: "Draft a follow-up to Northwind", createdAt: Date.now() - 74 * 3600000 }, messages: [] },
  };

  const searchHits = [
    { meetingId: "m-pricing", meetingTitle: M.pricing.title, meetingDate: M.pricing.startedAt, kind: "enhanced", refId: 1, startMs: null, snippet: "«Starter tier»: up to 5 seats, single workspace, no SSO. Priced to land under $25 per seat.", text: "", score: 1 },
    { meetingId: "m-pricing", meetingTitle: M.pricing.title, meetingDate: M.pricing.startedAt, kind: "segment", refId: 2, startMs: s("22:10"), snippet: "If we do a «starter tier», it has to be self-serve. Sales can't spend time on five-seat deals.", text: "", score: 0.9 },
    { meetingId: "m-atlas", meetingTitle: M.atlas.title, meetingDate: M.atlas.startedAt, kind: "segment", refId: 9, startMs: s("04:02"), snippet: "Agreed. Could we at least offer a «starter tier» for teams of five or fewer?", text: "", score: 0.85 },
    { meetingId: "m-atlas", meetingTitle: M.atlas.title, meetingDate: M.atlas.startedAt, kind: "enhanced", refId: 2, startMs: null, snippet: "A «starter tier» for five seats or fewer was raised (suggested, not agreed)", text: "", score: 0.8 },
    { meetingId: "m-northwind", meetingTitle: M.northwind.title, meetingDate: M.northwind.startedAt, kind: "manual", refId: 1, startMs: null, snippet: "they'd move all 6 regional offices over if there's a «starter tier»", text: "", score: 0.7 },
  ];

  // ── Settings, hardware, catalog ───────────────────────────────────────────
  const settings = {
    onboardingDone: SHOT.onboarding ? false : true, theme: SHOT.theme ?? "light", languages: ["en"], userName: "Me",
    asrModel: "parakeet-unified-en-0.6b", llmModel: "qwen3-4b-instruct-2507", embedModel: "qwen3-embedding-0.6b",
    defaultTemplate: "general", captureSystem: true, micDevice: null, transcriptionMode: "live", asrLanguage: "auto",
    keepAudio: true, scanOtherApps: true, modelFolders: [], sidebarWidth: 232, sidebarCollapsed: false,
  };
  const READY = new Set(["parakeet-unified-en-0.6b", "qwen3-4b-instruct-2507", "qwen3-embedding-0.6b", "whisper-medium"]);
  const catalog = (window.__CATALOG ?? []).map((m) => (READY.has(m.id) ? { ...m, status: "ready", installedQuant: m.quant, installedSize: m.size } : m));
  const hardware = { os: "macOS", osVersion: "26.1", arch: "aarch64", chip: "Apple M3 Pro", appleSilicon: true, gpu: "Metal", totalRamGb: 36, availableRamGb: 21, freeDiskGb: 412, cpuCores: 12, supported: true, notes: [] };
  const storage = { models: 4_602_000_000, recordings: 1_240_000_000, database: 18_400_000, root: "~/Library/Application Support/Grain", freeDisk: 412_000_000_000 };
  const templates = [
    { id: "general", name: "General meeting", instructions: "", builtin: true },
    { id: "product", name: "Product discussion", instructions: "", builtin: true },
    { id: "customer", name: "Customer call", instructions: "", builtin: true },
    { id: "oneone", name: "1:1", instructions: "", builtin: true },
    { id: "interview", name: "Interview debrief", instructions: "", builtin: true },
    { id: "standup", name: "Stand-up", instructions: "", builtin: true },
  ];
  const listOrder = [M.northwind, M.atlas, M.critique, M.sync, M.oneone, M.hiring, M.pricing, M.planning];
  if (SHOT.recording) listOrder.unshift(M.live);

  // ── IPC shim ──────────────────────────────────────────────────────────────
  const handlers = {
    bootstrap: () => ({ settings, hardware, storage, recording: SHOT.recording ? "m-live" : null, initialRoute: SHOT.route ?? null, e2e: null }),
    set_setting: ({ key, value }) => { settings[key] = value; },
    list_meetings: () => listOrder.map((m) => ({ meeting: m, preview: PREVIEW[m.id] })),
    meeting_detail: ({ id }) => detail(id),
    list_templates: () => templates,
    list_catalog: () => catalog,
    storage: () => storage,
    list_action_items: () => [...atlasActions, ...otherActions].map((item) => {
      const m = Object.values(M).find((x) => x.id === item.meetingId);
      return { item, meetingTitle: m.title, meetingDate: m.startedAt };
    }),
    list_threads: ({ meetingId }) => Object.values(threads).map((t) => t.meta).filter((t) => (meetingId ? t.meetingId === meetingId : !t.meetingId)),
    thread_messages: ({ threadId }) => threads[threadId]?.messages ?? [],
    search: () => searchHits,
    ask: async ({ meetingId }) => { await new Promise((r) => setTimeout(r, 60)); const t = threads[meetingId ? "t-meeting" : "t-global"]; return { threadId: t.meta.id, message: t.messages[1] }; },
    recommend: () => ({ asr: ["parakeet-unified-en-0.6b", "parakeet-tdt-0.6b-v2"], llm: "qwen3-4b-instruct-2507", embed: "qwen3-embedding-0.6b", reasons: {} }),
    capture_permissions: () => ({ mic: "granted", screen: "granted" }),
    request_permission: () => ({ mic: "granted", screen: "granted" }),
    list_devices: () => [{ uid: "builtin", name: "MacBook Pro Microphone", default: true }, { uid: "airpods", name: "AirPods Pro", default: false }],
    rescan_local_models: () => [],
    export_preview: ({ id }) => `# ${detail(id).meeting.title}\n\n${atlasEnhanced}`,
    "plugin:event|listen": ({ event, handler }) => { (listeners[event] ??= []).push(handler); return handler; },
  };
  const listeners = {};
  const callbacks = new Map();
  let cbId = 1;
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args = {}) => (handlers[cmd] ? handlers[cmd](args) : null),
    transformCallback: (cb) => { const i = cbId++; callbacks.set(i, cb); return i; },
    unregisterCallback: (i) => callbacks.delete(i),
    convertFileSrc: (p) => p,
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (event, i) => { listeners[event] = (listeners[event] ?? []).filter((x) => x !== i); } };
  const emit = (event, payload) => (listeners[event] ?? []).forEach((i) => callbacks.get(i)?.({ event, id: i, payload }));

  // A believable live meter: speech-like bursts, alternating speakers.
  if (SHOT.recording) {
    const startElapsed = 16 * 60 + 31;
    let t = 0;
    setInterval(() => {
      t += 0.1;
      const wobble = (f, p) => Math.max(0, Math.sin(t * f + p) * 0.5 + 0.5);
      emit("capture", { event: "level", elapsed: startElapsed + t, mic: 0.08 + 0.15 * wobble(2.1, 1), system: 0.35 + 0.5 * wobble(5.3, 0) * wobble(1.7, 2), paused: false });
    }, 100);
    setTimeout(() => emit("capture", { event: "started", meetingId: "m-live", offsetMs: startElapsed * 1000, mic: true, system: true, micDevice: "MacBook Pro Microphone", errors: [] }), 300);
  }
  window.__emit = emit;
})();
