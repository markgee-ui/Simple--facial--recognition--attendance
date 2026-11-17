import { describe, it, expect } from "vitest";
import { STORAGE_KEY, dayKey, serialize, deserialize, loadState, saveState, clearState } from "./storage";

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _m: m,
  };
}

const descriptor = Float32Array.from({ length: 128 }, (_, i) => i / 128);
const state = {
  students: [{ id: 1, name: "Ada" }, { id: 2, name: "Alan" }],
  enrolled: { 1: { photo: "data:image/jpeg;base64,xx", descriptor } },
  attendance: { 1: { status: "present", at: 1000 } },
};

describe("dayKey", () => {
  it("formats the local date", () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("serialize / deserialize", () => {
  it("round-trips state and restores Float32Array descriptors", () => {
    const out = deserialize(serialize(state, "2026-11-17"), "2026-11-17");
    expect(out.students).toEqual(state.students);
    expect(out.attendance).toEqual(state.attendance);
    expect(out.enrolled[1].descriptor).toBeInstanceOf(Float32Array);
    expect(Array.from(out.enrolled[1].descriptor)).toEqual(Array.from(descriptor));
  });

  it("drops yesterday's attendance but keeps roster and enrolments", () => {
    const out = deserialize(serialize(state, "2026-11-16"), "2026-11-17");
    expect(out.attendance).toEqual({});
    expect(out.students).toHaveLength(2);
    expect(Object.keys(out.enrolled)).toEqual(["1"]);
  });

  it.each([
    ["missing", null],
    ["corrupt JSON", "{not json"],
    ["unknown version", JSON.stringify({ version: 99, students: [] })],
    ["bad shape", JSON.stringify({ version: 1, students: "nope" })],
  ])("returns null for %s data", (_, raw) => {
    expect(deserialize(raw)).toBeNull();
  });

  it("discards malformed descriptors and students", () => {
    const raw = JSON.stringify({
      version: 1,
      day: "x",
      students: [{ id: 1, name: "Ada" }, { name: 5 }, null],
      enrolled: { 1: { descriptor: [1, 2, 3] } },
    });
    const out = deserialize(raw, "y");
    expect(out.students).toEqual([{ id: 1, name: "Ada" }]);
    expect(out.enrolled).toEqual({});
  });
});

describe("loadState / saveState / clearState", () => {
  it("persists through a storage backend", () => {
    const s = memoryStorage();
    expect(saveState(state, s, "d")).toBe(true);
    expect(s._m.has(STORAGE_KEY)).toBe(true);
    expect(loadState(s, "d").students).toEqual(state.students);
    clearState(s);
    expect(loadState(s, "d")).toBeNull();
  });

  it("reports failure instead of throwing when the quota is exceeded", () => {
    const s = { setItem: () => { throw new DOMException("full", "QuotaExceededError"); } };
    expect(saveState(state, s)).toBe(false);
  });

  it("tolerates missing or throwing storage", () => {
    expect(saveState(state, null)).toBe(false);
    expect(loadState({ getItem: () => { throw new Error("denied"); } })).toBeNull();
    expect(() => clearState(null)).not.toThrow();
  });
});
