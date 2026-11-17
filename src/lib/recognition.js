// Face-recognition helpers that sit between face-api.js and the UI.
// face-api is injected where needed so these functions stay unit-testable.

/** Detector confidence for enrolment — stricter, we want a clean reference. */
export const ENROLL_MIN_CONFIDENCE = 0.45;
/** Detector confidence while scanning — slightly looser to keep tracking stable. */
export const SCAN_MIN_CONFIDENCE = 0.42;
/**
 * Max euclidean distance between 128-d descriptors to count as a match.
 * face-api's default is 0.6; 0.52 trades a few more "not recognised" frames
 * for fewer false positives (marking the wrong student present is worse).
 */
export const MATCH_DISTANCE_THRESHOLD = 0.52;
/** Interval between detection passes while scanning. */
export const SCAN_INTERVAL_MS = 700;

/** Convert a descriptor distance into a 0–100 "confidence" for display. */
export function distanceToConfidence(distance) {
  const pct = Math.round((1 - distance) * 100);
  return Math.min(100, Math.max(0, pct));
}

/**
 * Map a point/box in intrinsic video pixels onto the rendered <video> element,
 * accounting for `object-fit: cover` (uniform scale + centred crop).
 */
export function coverTransform(videoWidth, videoHeight, displayWidth, displayHeight) {
  if (!videoWidth || !videoHeight || !displayWidth || !displayHeight) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.max(displayWidth / videoWidth, displayHeight / videoHeight);
  return {
    scale,
    offsetX: (displayWidth - videoWidth * scale) / 2,
    offsetY: (displayHeight - videoHeight * scale) / 2,
  };
}

export function projectBox(box, t) {
  return {
    left: box.x * t.scale + t.offsetX,
    top: box.y * t.scale + t.offsetY,
    width: box.width * t.scale,
    height: box.height * t.scale,
  };
}

export function projectPoints(points, t) {
  return points.map((p) => ({ x: p.x * t.scale + t.offsetX, y: p.y * t.scale + t.offsetY }));
}

/**
 * Padded crop rectangle around a detected face, clamped to the frame so faces
 * near the edge don't produce black borders in the avatar.
 */
export function paddedCropRect(box, pad, frameWidth, frameHeight) {
  const x = Math.max(0, Math.floor(box.x - pad));
  const y = Math.max(0, Math.floor(box.y - pad));
  const right = Math.min(frameWidth, Math.ceil(box.x + box.width + pad));
  const bottom = Math.min(frameHeight, Math.ceil(box.y + box.height + pad));
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

/** Build a FaceMatcher from enrolled roster students, or null if none enrolled. */
export function buildMatcher(faceapi, students, enrolled, threshold = MATCH_DISTANCE_THRESHOLD) {
  const labeled = students
    .filter((s) => enrolled[s.id]?.descriptor)
    .map((s) => new faceapi.LabeledFaceDescriptors(String(s.id), [enrolled[s.id].descriptor]));
  if (!labeled.length) return null;
  return new faceapi.FaceMatcher(labeled, threshold);
}

/** Resolve a FaceMatcher result to a roster student, or null if unknown/removed. */
export function resolveMatch(match, students) {
  if (!match || match.label === "unknown") return null;
  const student = students.find((s) => String(s.id) === match.label);
  if (!student) return null;
  return { student, conf: distanceToConfidence(match.distance) };
}
