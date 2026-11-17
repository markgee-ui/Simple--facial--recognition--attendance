import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// face-api needs WebGL + real model weights; the UI flow is tested against a stub.
const loadFromUri = vi.fn(() => Promise.resolve());
vi.mock("@vladmandic/face-api", () => ({
  nets: {
    ssdMobilenetv1: { loadFromUri: (...a) => loadFromUri(...a) },
    faceLandmark68Net: { loadFromUri: (...a) => loadFromUri(...a) },
    faceRecognitionNet: { loadFromUri: (...a) => loadFromUri(...a) },
  },
}));

import App from "./App";

function mockCamera(impl) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(impl) },
  });
}

const fakeStream = () => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] });

async function renderToMainScreen(user) {
  render(<App />);
  await user.click(await screen.findByRole("button", { name: /enable camera/i }, { timeout: 2000 }));
  return screen.findByRole("heading", { name: /face recognition attendance/i });
}

beforeEach(() => {
  loadFromUri.mockReset();
  loadFromUri.mockImplementation(() => Promise.resolve());
  mockCamera(fakeStream);
});

describe("App", () => {
  it("loads all three models then asks for camera permission", async () => {
    render(<App />);
    expect(screen.getByText(/loading ai models/i)).toBeInTheDocument();
    expect(await screen.findByText(/camera access required/i, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(loadFromUri).toHaveBeenCalledTimes(3);
  });

  it("shows an error when models fail to load", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    loadFromUri.mockImplementation(() => Promise.reject(new Error("404")));
    render(<App />);
    expect(await screen.findByText(/failed to load models/i)).toBeInTheDocument();
  });

  it("explains when camera permission is denied", async () => {
    const user = userEvent.setup();
    mockCamera(() => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })));
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /enable camera/i }, { timeout: 2000 }));
    expect(await screen.findByText(/camera permission denied/i)).toBeInTheDocument();
  });

  it("renders the roster with scanning disabled until someone is enrolled", async () => {
    const user = userEvent.setup();
    await renderToMainScreen(user);
    expect(screen.getByText("Mark Ngugi")).toBeInTheDocument();
    expect(screen.getAllByText(/not enrolled/i)).toHaveLength(8);
    expect(screen.getByRole("button", { name: /start scan/i })).toBeDisabled();
  });

  it("adds a student and rejects duplicates", async () => {
    const user = userEvent.setup();
    await renderToMainScreen(user);
    const input = screen.getByLabelText(/new student name/i);

    await user.type(input, "Ada Lovelace{Enter}");
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(input).toHaveValue("");

    await user.type(input, "ada lovelace{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent(/already on the roster/i);
    expect(screen.getAllByText("Ada Lovelace")).toHaveLength(1);
  });

  it("marks a student absent, updates counters, then clears the mark", async () => {
    const user = userEvent.setup();
    await renderToMainScreen(user);
    expect(screen.getByText("0 Absent")).toBeInTheDocument();

    const row = screen.getByRole("listitem", { name: "Mark Ngugi" });
    await user.click(within(row).getByRole("button", { name: /^absent$/i }));
    expect(screen.getByText("1 Absent")).toBeInTheDocument();
    expect(screen.getByText("7 Unmarked")).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: /clear/i }));
    expect(screen.getByText("0 Absent")).toBeInTheDocument();
  });

  it("summary percentages are well-formed", async () => {
    const user = userEvent.setup();
    await renderToMainScreen(user);
    await user.click(screen.getByRole("button", { name: /summary/i }));
    expect(screen.getAllByText("0%")).toHaveLength(2);
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});
