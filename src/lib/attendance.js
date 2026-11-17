// Pure attendance/roster helpers. No React, no DOM — unit tested in isolation.

export const PRESENT = "present";
export const ABSENT = "absent";

/** Count statuses for students currently on the roster (ignores stale ids). */
export function summarize(students, attendance, enrolled) {
  let present = 0;
  let absent = 0;
  let enrolledCount = 0;
  for (const s of students) {
    const status = attendance[s.id]?.status;
    if (status === PRESENT) present++;
    else if (status === ABSENT) absent++;
    if (enrolled[s.id]) enrolledCount++;
  }
  return {
    total: students.length,
    present,
    absent,
    unmarked: students.length - present - absent,
    enrolledCount,
  };
}

/** Integer percentage that is safe for an empty roster. */
export function percent(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

/**
 * Mark a student present. Re-scanning someone who is already present keeps
 * their original check-in time, so repeated recognitions are idempotent.
 */
export function markPresent(attendance, id, at = Date.now()) {
  if (attendance[id]?.status === PRESENT) return attendance;
  return { ...attendance, [id]: { status: PRESENT, at } };
}

export function markAbsent(attendance, id, at = Date.now()) {
  return { ...attendance, [id]: { status: ABSENT, at } };
}

export function clearMark(attendance, id) {
  if (!(id in attendance)) return attendance;
  const next = { ...attendance };
  delete next[id];
  return next;
}

/**
 * Validate and append a student. Returns { students, error }.
 * Names are trimmed, whitespace-collapsed and must be unique (case-insensitive).
 */
export function addStudent(students, rawName, id = Date.now()) {
  const name = String(rawName ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { students, error: "Name cannot be empty" };
  if (name.length > 60) return { students, error: "Name is too long" };
  const lower = name.toLocaleLowerCase();
  if (students.some((s) => s.name.toLocaleLowerCase() === lower)) {
    return { students, error: `"${name}" is already on the roster` };
  }
  return { students: [...students, { id, name }], error: null };
}

export function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0].toUpperCase())
    .join("")
    .slice(0, 2);
}

const AVATAR_PALETTE = ["#1D9E75", "#378ADD", "#7F77DD", "#D4537E", "#D85A30", "#BA7517", "#E24B4A", "#639922"];

export function avatarColor(name) {
  return AVATAR_PALETTE[(name.charCodeAt(0) || 0) % AVATAR_PALETTE.length];
}

export const formatTime = (d) =>
  new Date(d).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

export const formatDate = (d) =>
  new Date(d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
