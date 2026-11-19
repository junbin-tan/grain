import { describe, expect, it } from "vitest";
import { dayLabel, fmtBytes, fmtTs, grade, highlight, speedLevel } from "./format";

describe("format", () => {
  it("formats timestamps", () => {
    expect(fmtTs(0)).toBe("00:00");
    expect(fmtTs(65_000)).toBe("01:05");
    expect(fmtTs(3_725_000)).toBe("1:02:05");
  });
  it("formats sizes", () => {
    expect(fmtBytes(731_357_568)).toBe("731 MB");
    expect(fmtBytes(2_497_281_120)).toBe("2.5 GB");
  });
  it("groups days", () => {
    const now = new Date(2026, 10, 19, 15).getTime();
    expect(dayLabel(new Date(2026, 10, 19, 9).getTime(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 10, 18, 23).getTime(), now)).toBe("Yesterday");
  });
  it("grades and speeds", () => {
    expect(grade(3.9)).toBe("A");
    expect(grade(17)).toBe("D");
    expect(grade(undefined)).toBeNull();
    expect(speedLevel(25)).toBe(4);
    expect(speedLevel(null)).toBe(0);
  });
  it("escapes search snippets before highlighting", () => {
    expect(highlight("<b>«price»</b>")).toBe("&lt;b&gt;<mark>price</mark>&lt;/b&gt;");
  });
});
