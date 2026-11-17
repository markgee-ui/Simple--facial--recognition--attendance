// Versioned localStorage persistence. Everything stays in this browser —
// there is no server, so nothing (including face descriptors) leaves the device.

export const STORAGE_KEY = "face-attendance:v1";
const VERSION = 1;

/** Local calendar day, e.g. "2026-11-17". Attendance is scoped to one day. */
export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function serialize({ students, enrolled, attendance }, day = dayKey()) {
  const enrolledOut = {};
  for (const [id, e] of Object.entries(enrolled)) {
    // Float32Array doesn't survive JSON.stringify as an array.
    enrolledOut[id] = { photo: e.photo, descriptor: Array.from(e.descriptor) };
  }
  return JSON.stringify({ version: VERSION, day, students, enrolled: enrolledOut, attendance });
}

/**
 * Parse persisted state. Returns null for missing/corrupt/unknown-version
 * data. Attendance from a previous day is dropped; roster and enrolments carry over.
 */
export function deserialize(raw, day = dayKey()) {
  if (!raw) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || data.version !== VERSION || !Array.isArray(data.students)) return null;

  const enrolled = {};
  for (const [id, e] of Object.entries(data.enrolled ?? {})) {
    if (Array.isArray(e?.descriptor) && e.descriptor.length === 128) {
      enrolled[id] = { photo: e.photo, descriptor: new Float32Array(e.descriptor) };
    }
  }
  const attendanceValid = data.day === day && data.attendance && typeof data.attendance === "object";
  return {
    students: data.students.filter((s) => s && s.id != null && typeof s.name === "string"),
    enrolled,
    attendance: attendanceValid ? data.attendance : {},
  };
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // access can throw in privacy modes / sandboxed iframes
  }
}

export function loadState(storage = defaultStorage(), day = dayKey()) {
  try {
    return deserialize(storage?.getItem(STORAGE_KEY), day);
  } catch {
    return null;
  }
}

/** Returns false if the write failed (e.g. quota exceeded); the app keeps working in memory. */
export function saveState(state, storage = defaultStorage(), day = dayKey()) {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, serialize(state, day));
    return true;
  } catch {
    return false;
  }
}

export function clearState(storage = defaultStorage()) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}
