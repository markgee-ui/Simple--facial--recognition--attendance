import { describe, it, expect } from "vitest";
import {
  PRESENT, ABSENT, summarize, percent, markPresent, markAbsent, clearMark,
  addStudent, initials, avatarColor,
} from "./attendance";

const roster = [
  { id: 1, name: "Ada Lovelace" },
  { id: 2, name: "Alan Turing" },
  { id: 3, name: "Grace Hopper" },
];

describe("summarize", () => {
  it("counts present, absent, unmarked and enrolled", () => {
    const attendance = { 1: { status: PRESENT, at: 1 }, 2: { status: ABSENT, at: 2 } };
    const enrolled = { 1: { descriptor: [] }, 3: { descriptor: [] } };
    expect(summarize(roster, attendance, enrolled)).toEqual({
      total: 3, present: 1, absent: 1, unmarked: 1, enrolledCount: 2,
    });
  });

  it("ignores records for students no longer on the roster", () => {
    const attendance = { 99: { status: PRESENT, at: 1 } };
    const enrolled = { 99: { descriptor: [] } };
    const s = summarize(roster, attendance, enrolled);
    expect(s.present).toBe(0);
    expect(s.unmarked).toBe(3);
    expect(s.enrolledCount).toBe(0);
  });

  it("handles an empty roster", () => {
    expect(summarize([], {}, {})).toEqual({ total: 0, present: 0, absent: 0, unmarked: 0, enrolledCount: 0 });
  });
});

describe("percent", () => {
  it("rounds to an integer", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
  });
  it("returns 0 instead of NaN for an empty roster", () => {
    expect(percent(0, 0)).toBe(0);
  });
});

describe("markPresent", () => {
  it("records status and the time of marking", () => {
    expect(markPresent({}, 1, 1000)).toEqual({ 1: { status: PRESENT, at: 1000 } });
  });

  it("is idempotent — a re-scan keeps the original check-in time", () => {
    const first = markPresent({}, 1, 1000);
    const second = markPresent(first, 1, 5000);
    expect(second).toBe(first);
    expect(second[1].at).toBe(1000);
  });

  it("overrides an absent mark", () => {
    const a = markAbsent({}, 1, 1000);
    expect(markPresent(a, 1, 2000)[1]).toEqual({ status: PRESENT, at: 2000 });
  });

  it("does not mutate the input", () => {
    const a = Object.freeze({});
    expect(() => markPresent(a, 1, 1)).not.toThrow();
  });
});

describe("clearMark", () => {
  it("removes a record", () => {
    expect(clearMark({ 1: { status: ABSENT, at: 1 } }, 1)).toEqual({});
  });
  it("returns the same object when there is nothing to clear", () => {
    const a = {};
    expect(clearMark(a, 1)).toBe(a);
  });
});

describe("addStudent", () => {
  it("trims and collapses whitespace", () => {
    const { students, error } = addStudent(roster, "  Katherine   Johnson ", 4);
    expect(error).toBeNull();
    expect(students.at(-1)).toEqual({ id: 4, name: "Katherine Johnson" });
  });

  it("rejects empty names", () => {
    const res = addStudent(roster, "   ");
    expect(res.error).toMatch(/empty/i);
    expect(res.students).toBe(roster);
  });

  it("rejects case-insensitive duplicates", () => {
    const res = addStudent(roster, "ada lovelace");
    expect(res.error).toMatch(/already on the roster/);
    expect(res.students).toHaveLength(3);
  });

  it("rejects overly long names", () => {
    expect(addStudent(roster, "x".repeat(61)).error).toMatch(/too long/);
  });
});

describe("initials / avatarColor", () => {
  it("takes up to two uppercase initials", () => {
    expect(initials("ada byron lovelace")).toBe("AB");
    expect(initials("Cher")).toBe("C");
    expect(initials("  Leila  Ndung'u ")).toBe("LN");
  });
  it("is deterministic per name", () => {
    expect(avatarColor("Ada")).toBe(avatarColor("Ada"));
    expect(avatarColor("")).toMatch(/^#/);
  });
});
