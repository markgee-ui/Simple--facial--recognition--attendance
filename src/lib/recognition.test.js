import { describe, it, expect, vi } from "vitest";
import {
  distanceToConfidence, coverTransform, projectBox, projectPoints,
  paddedCropRect, buildMatcher, resolveMatch, MATCH_DISTANCE_THRESHOLD,
} from "./recognition";

describe("distanceToConfidence", () => {
  it("maps distance to a 0–100 score", () => {
    expect(distanceToConfidence(0)).toBe(100);
    expect(distanceToConfidence(0.35)).toBe(65);
  });
  it("clamps out-of-range distances", () => {
    expect(distanceToConfidence(1.4)).toBe(0);
    expect(distanceToConfidence(-0.2)).toBe(100);
  });
});

describe("coverTransform", () => {
  it("is identity when display matches the video", () => {
    expect(coverTransform(640, 480, 640, 480)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });

  it("crops vertically when the element is wider than the video aspect", () => {
    // 640x480 video shown in a 560x300 box with object-fit: cover
    const t = coverTransform(640, 480, 560, 300);
    expect(t.scale).toBeCloseTo(0.875);
    expect(t.offsetX).toBeCloseTo(0);
    expect(t.offsetY).toBeCloseTo((300 - 480 * 0.875) / 2); // negative: top is cropped
  });

  it("falls back to identity before metadata has loaded", () => {
    expect(coverTransform(0, 0, 560, 300)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });

  it("projects boxes and points consistently", () => {
    const t = { scale: 2, offsetX: 10, offsetY: -5 };
    expect(projectBox({ x: 1, y: 2, width: 3, height: 4 }, t)).toEqual({ left: 12, top: -1, width: 6, height: 8 });
    expect(projectPoints([{ x: 1, y: 2 }], t)).toEqual([{ x: 12, y: -1 }]);
  });
});

describe("paddedCropRect", () => {
  it("pads around the face", () => {
    expect(paddedCropRect({ x: 100, y: 100, width: 50, height: 60 }, 20, 640, 480))
      .toEqual({ x: 80, y: 80, width: 90, height: 100 });
  });

  it("clamps to the frame when the face is at the edge", () => {
    expect(paddedCropRect({ x: 5, y: 450, width: 40, height: 40 }, 50, 640, 480))
      .toEqual({ x: 0, y: 400, width: 95, height: 80 });
  });
});

function fakeFaceApi() {
  return {
    LabeledFaceDescriptors: vi.fn(function (label, descriptors) { this.label = label; this.descriptors = descriptors; }),
    FaceMatcher: vi.fn(function (labeled, threshold) { this.labeled = labeled; this.threshold = threshold; }),
  };
}

describe("buildMatcher", () => {
  const students = [{ id: 1, name: "A" }, { id: 2, name: "B" }];

  it("returns null when nobody is enrolled", () => {
    const api = fakeFaceApi();
    expect(buildMatcher(api, students, {})).toBeNull();
    expect(api.FaceMatcher).not.toHaveBeenCalled();
  });

  it("labels descriptors by student id and uses the configured threshold", () => {
    const api = fakeFaceApi();
    const d = new Float32Array(128);
    const m = buildMatcher(api, students, { 2: { descriptor: d } });
    expect(m.threshold).toBe(MATCH_DISTANCE_THRESHOLD);
    expect(m.labeled).toHaveLength(1);
    expect(m.labeled[0].label).toBe("2");
    expect(m.labeled[0].descriptors[0]).toBe(d);
  });

  it("skips enrolment entries for students not on the roster", () => {
    const api = fakeFaceApi();
    expect(buildMatcher(api, students, { 99: { descriptor: [] } })).toBeNull();
  });
});

describe("resolveMatch", () => {
  const students = [{ id: 7, name: "Grace" }];
  it("returns null for unknown faces", () => {
    expect(resolveMatch({ label: "unknown", distance: 0.7 }, students)).toBeNull();
  });
  it("returns null when the matched student was removed", () => {
    expect(resolveMatch({ label: "8", distance: 0.3 }, students)).toBeNull();
  });
  it("returns the student with confidence", () => {
    expect(resolveMatch({ label: "7", distance: 0.3 }, students)).toEqual({ student: students[0], conf: 70 });
  });
});
