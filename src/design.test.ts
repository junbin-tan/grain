// Guards the Grain design system (design/README.md, CLAUDE.md): fails the build when UI code drifts from it.
import { describe, expect, it } from "vitest";
import styles from "./styles.css?raw";
import components from "./components.css?raw";
import bundle from "../design/components/bundle.css?raw";

const sources = import.meta.glob<string>("./**/*.tsx", { query: "?raw", import: "default", eager: true });
const files = Object.entries(sources).map(([p, s]) => ({ p: p.replace("./", "src/"), s }));
const offenders = (re: RegExp) => files.filter(({ s }) => re.test(s)).map(({ p }) => p);
// The print view renders on paper, so it may use plain black on white.
const PRINT_OK = ["src/components/ExportDialog.tsx"];

describe("design system", () => {
  it("loads tokens and components from design/", () => {
    const css = styles;
    expect(css).toContain('@import "../design/tokens.css" layer(base)');
    expect(css).toContain('@import "./components.css" layer(components)');
  });

  it("keeps src/components.css in sync with design/components/bundle.css", () => {
    const rules = (s: string) => s.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("/*") && !l.startsWith("@import url") && !l.startsWith("body {"));
    expect(rules(components)).toEqual(rules(bundle));
  });

  it("never fetches fonts or assets from the network", () => {
    expect(offenders(/https?:\/\/(fonts\.googleapis|fonts\.gstatic|cdn\.)/)).toEqual([]);
    expect(styles).not.toMatch(/@import url\(/);
  });

  it("uses tokens, not raw colours", () => {
    expect(offenders(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])|\brgba?\(/)).toEqual([]);
    expect(offenders(/\b(bg|text|border|fill|stroke)-(white|black|(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|green|emerald|blue|indigo|violet|purple)-\d+)\b/).filter((p) => !PRINT_OK.includes(p))).toEqual([]);
  });

  it("does not use retired tokens", () => {
    expect(offenders(/\b(accent-(soft|ink)|-accent\b|ink-[23]\b|-wash\b|them-soft|rec-soft|rec-ink|warn(-soft|-ink)?\b(?!ings)|ink-ai|bg-sidebar|bg-highlight)/)).toEqual([]);
  });

  it("uses the mark for AI, never sparkles or emoji", () => {
    expect(offenders(/\bSparkles\b/)).toEqual([]);
    expect(offenders(/[\u{1F300}-\u{1FAFF}\u{2728}]/u)).toEqual([]);
  });
});
