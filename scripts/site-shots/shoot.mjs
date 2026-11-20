// Captures website screenshots of the real Grain UI with demo data (demo.js), then frames them
// in a macOS window and builds an OG image. Needs the Vite dev server running (URL below).
//   PW=/path/to/playwright/index.mjs URL=http://localhost:5179 node scripts/site-shots/shoot.mjs out/
import { readFileSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PW ?? "playwright");
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const URL = process.env.URL ?? "http://localhost:5179";
const OUT = process.argv[2] ?? join(root, "site-assets");
const W = 1280, H = 800;
for (const d of ["screenshots/raw", "screenshots/framed", "brand", "social"]) mkdirSync(join(OUT, d), { recursive: true });

// Same mapping as src-tauri/src/models.rs catalog(), so the Models screen shows the real catalogue.
const asr = JSON.parse(readFileSync(join(root, "src-tauri/catalog/asr.json"), "utf8"));
const llm = JSON.parse(readFileSync(join(root, "src-tauri/catalog/llm.json"), "utf8"));
const CATALOG = [
  ...asr.models.filter((m) => m.role === "asr" && m.files?.[m.quant]).map((m) => {
    const f = m.files[m.quant], r = asr.results?.[m.id] ?? {};
    return {
      id: m.id, name: m.name, description: m.description, role: "asr", family: m.family, params: m.parameters, languages: m.languages, license: m.license,
      repo: m.repository, filename: f.filename, quant: m.quant, size: f.size, sha256: f.sha256, curated: !!m.curated, capabilities: m.capabilities ?? {},
      accuracy: Object.fromEntries(Object.entries(r.accuracy ?? {}).map(([k, v]) => [k, v.error])), speed: r.performance?.accelerated ?? null,
      minRamGb: Math.ceil((f.size / 1e9) * 2 + 2), ctx: 0, thinking: false, recommended: false, status: "available", partialBytes: 0,
      quants: Object.entries(m.files).filter(([q]) => q !== "F32").map(([quant, x]) => ({ quant, filename: x.filename, size: x.size, sha256: x.sha256 })),
    };
  }),
  ...llm.models.map((m) => ({
    id: m.id, name: m.name, description: m.description, role: m.role, family: "qwen3", params: m.params, languages: [], license: m.license, repo: m.repo,
    filename: m.filename, quant: m.quant, size: m.size, sha256: m.sha256, curated: true, capabilities: {}, accuracy: {}, speed: null, minRamGb: m.minRamGb ?? 8,
    ctx: m.ctx ?? 8192, thinking: !!m.thinking, recommended: !!m.recommended, status: "available", partialBytes: 0,
    quants: [{ quant: m.quant, filename: m.filename, size: m.size, sha256: m.sha256 }],
  })),
];
const demo = readFileSync(join(here, "demo.js"), "utf8");
const t = (mmss) => { const [m, s] = mmss.split(":").map(Number); return (m * 60 + s) * 1000; };

const shots = [
  { name: "01-enhanced-notes", route: { name: "meeting", id: "m-atlas", tab: "enhanced" }, caption: "Your notes and the transcript, written up on your Mac. Every point links to the moment it was said." },
  { name: "02-enhanced-notes-dark", theme: "dark", route: { name: "meeting", id: "m-atlas", tab: "enhanced" }, caption: "Enhanced notes in the dark theme." },
  { name: "03-live-recording", recording: true, route: { name: "meeting", id: "m-live", tab: "notes", ui: { side: "live" } }, caption: "Record any call or in-person meeting. No bot joins. Me and Them are kept apart." },
  { name: "04-live-recording-dark", theme: "dark", recording: true, route: { name: "meeting", id: "m-live", tab: "notes", ui: { side: "live" } }, caption: "Live transcript while you take notes, dark theme." },
  { name: "05-my-notes", route: { name: "meeting", id: "m-atlas", tab: "notes" }, caption: "Jot short phrases. Grain fills in the rest from the transcript and never overwrites your notes." },
  { name: "06-transcript-cited", route: { name: "meeting", id: "m-atlas", tab: "transcript", at: t("03:45") }, caption: "Click a citation and land on the exact line, with marked moments along the way." },
  { name: "07-ask-this-meeting", route: { name: "meeting", id: "m-atlas", tab: "enhanced", ui: { side: "ask" } }, ask: "What did we decide on pricing?", caption: "Ask about a meeting. Answers cite the transcript, numbered and clickable." },
  { name: "08-ask-grain", route: { name: "chat", threadId: "t-global" }, caption: "Ask across every meeting. A local model answers using only your meetings." },
  { name: "09-meetings", route: { name: "home" }, caption: "All your meetings in one place, stored on this Mac." },
  { name: "10-meetings-dark", theme: "dark", route: { name: "home" }, caption: "Meetings, dark theme." },
  { name: "11-search", route: { name: "home", search: true, ui: { query: "starter tier" } }, caption: "Search titles, notes, transcripts and action items, on device. ⌘K from anywhere." },
  { name: "12-action-items", route: { name: "actions" }, caption: "Action items with owners and deadlines, each linked back to where it was agreed." },
  { name: "13-models", route: { name: "models", role: "asr" }, caption: "Pick the speech model that suits your languages. Everything runs locally." },
  { name: "14-export", route: { name: "meeting", id: "m-atlas", tab: "enhanced", ui: { export: true } }, caption: "Export to Markdown, PDF and more. Plain files you own." },
  { name: "15-settings-privacy", route: { name: "settings", section: "privacy" }, caption: "Your data stays in one folder on your Mac. Delete audio, or everything, any time." },
  { name: "16-onboarding-welcome", onboarding: true, route: { onboarding: true, ui: { step: 0 } }, caption: "Set up in a minute: no account, no sign-in." },
  { name: "17-onboarding-privacy", onboarding: true, route: { onboarding: true, ui: { step: 1 } }, caption: "What stays on your Mac, stated plainly." },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
for (const s of shots) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error(`  ${s.name}: ${e.message}`));
  const cfg = { route: s.route, theme: s.theme, recording: s.recording, onboarding: s.onboarding };
  await page.addInitScript({ content: `window.__SHOT=${JSON.stringify(cfg)};window.__CATALOG=${JSON.stringify(CATALOG)};\n${demo}` });
  await page.emulateMedia({ colorScheme: s.theme === "dark" ? "dark" : "light", reducedMotion: "reduce" });
  await page.goto(URL);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  if (s.ask) {
    const box = page.locator("aside textarea");
    await box.fill(s.ask);
    await box.press("Enter");
    await page.waitForTimeout(600);
  }
  await page.mouse.move(W - 2, H - 2); // no hover states
  await page.evaluate(() => (document.activeElement)?.blur?.());
  await page.waitForTimeout(s.recording ? 1200 : 300);
  await page.screenshot({ path: join(OUT, "screenshots/raw", `${s.name}.png`) });
  await page.close();
  console.log("shot", s.name);
}

// ── Framed: the screenshot in a macOS window on the brand ground ──────────
const tokens = readFileSync(join(root, "design/tokens.css"), "utf8");
const b64 = (p) => readFileSync(p).toString("base64");
const frame = (img, dark) => `<!doctype html><html data-theme="${dark ? "dark" : "light"}"><style>${tokens}
html,body{margin:0;background:var(--paper-sunken)}
.stage{width:1440px;height:960px;display:grid;place-items:center}
.win{position:relative;width:${W}px;height:${H}px;border-radius:12px;overflow:hidden;border:1px solid var(--line-strong);box-shadow:0 30px 80px -20px rgb(30 26 21 / .35),0 8px 24px -8px rgb(30 26 21 / .18)}
.win img{display:block;width:100%;height:100%}
/* macOS traffic lights, where tauri.conf.json puts them (x 16, y 20) */
.tl{position:absolute;top:20px;left:16px;display:flex;gap:8px}
.tl i{width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 .5px rgb(0 0 0 / .18)}
.tl i:nth-child(1){background:#FF5F57}.tl i:nth-child(2){background:#FEBC2E}.tl i:nth-child(3){background:#28C840}
</style><div class="stage"><div class="win"><img src="data:image/png;base64,${img}"><div class="tl"><i></i><i></i><i></i></div></div></div></html>`;

const fpage = await (await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 })).newPage();
for (const s of shots) {
  await fpage.setContent(frame(b64(join(OUT, "screenshots/raw", `${s.name}.png`)), s.theme === "dark"));
  await fpage.screenshot({ path: join(OUT, "screenshots/framed", `${s.name}.png`), omitBackground: false });
  console.log("framed", s.name);
}

// ── Social / OG image 1200×630: lockup, line, hero screenshot ─────────────
const lockup = readFileSync(join(root, "design/assets/Logos/grain-lockup.svg"), "utf8");
const og = (await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 }));
const ogp = await og.newPage();
await ogp.goto(URL); // for bundled fonts
await ogp.evaluate(({ html }) => { document.open(); document.write(html); document.close(); }, { html: `<!doctype html><html data-theme="light"><head><link rel="stylesheet" href="/src/styles.css"></head><style>${tokens}
html,body{margin:0;background:var(--paper);color:var(--ink);font-family:"Inter Variable",Inter,sans-serif}
.og{width:1200px;height:630px;position:relative;overflow:hidden}
.copy{position:absolute;left:72px;top:84px;width:470px}
.copy svg{height:52px;width:auto}
h1{font-family:"Newsreader Variable",Newsreader,serif;font-weight:500;font-size:50px;line-height:1.08;letter-spacing:-0.02em;margin:44px 0 18px}
p{font-size:21px;line-height:1.45;color:var(--ink-muted);margin:0}
.where{margin-top:30px;font-family:"JetBrains Mono Variable",monospace;font-size:15px;color:var(--sprout)}
.shot{position:absolute;left:590px;top:70px;width:900px;border-radius:12px;border:1px solid var(--line-strong);overflow:hidden;box-shadow:0 30px 80px -20px rgb(30 26 21 / .35)}
.shot img{display:block;width:100%}
</style><div class="og"><div class="copy">${lockup}<h1>The private notepad for your meetings.</h1><p>Grain records, transcribes and writes up your meetings on your Mac. No bot, no account, no cloud.</p><div class="where">Transcribed on this Mac</div></div>
<div class="shot"><img src="data:image/png;base64,${b64(join(OUT, "screenshots/raw", "01-enhanced-notes.png"))}"></div></div></html>` });
await ogp.waitForTimeout(800);
await ogp.evaluate(() => document.fonts.ready);
await ogp.screenshot({ path: join(OUT, "social", "og-image-1200x630.png") });
console.log("og image");
await browser.close();

// ── Brand files, copied as-is from design/assets (never redrawn) ──────────
for (const dir of ["Logos", "Icon"]) for (const f of readdirSync(join(root, "design/assets", dir))) if (!f.endsWith(".md")) copyFileSync(join(root, "design/assets", dir, f), join(OUT, "brand", f));
copyFileSync(join(root, "design/assets/Grain-logo-sheet.png"), join(OUT, "brand", "grain-logo-sheet.png"));
console.log("captions:\n" + shots.map((s) => `${s.name}\t${s.caption}`).join("\n"));
