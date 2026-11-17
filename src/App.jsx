import { useState, useRef, useEffect, useCallback } from "react";
import * as faceapi from '@vladmandic/face-api';
import {
  PRESENT, ABSENT, summarize, percent, markPresent, markAbsent, clearMark,
  addStudent as addStudentToRoster, initials, avatarColor, formatTime, formatDate,
} from "./lib/attendance";
import {
  ENROLL_MIN_CONFIDENCE, SCAN_MIN_CONFIDENCE, SCAN_INTERVAL_MS,
  coverTransform, projectBox, projectPoints, paddedCropRect, buildMatcher as buildFaceMatcher, resolveMatch,
} from "./lib/recognition";

const INITIAL_STUDENTS = [
  { id: 1, name: "Mark Ngugi" },
  { id: 2, name: "David Kimani" },
  { id: 3, name: "Fatima Al-Hassan" },
  { id: 4, name: "James Mwangi" },
  { id: 5, name: "Leila Ndung'u" },
  { id: 6, name: "Michael Otieno" },
  { id: 7, name: "Naomi Wanjiku" },
  { id: 8, name: "Peter Kamau" },
];

function Avatar({ name, size = 40, photo }) {
  const bg = avatarColor(name);
  if (photo) return <img src={photo} alt={name} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />;
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: bg, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: size * 0.34, flexShrink: 0 }}>
      {initials(name)}
    </div>
  );
}

const sc = (s) => {
  if (s === PRESENT) return { dot: "#1D9E75", text: "#1D9E75", bg: "rgba(29,158,117,0.12)", label: "Present" };
  if (s === ABSENT)  return { dot: "#E24B4A", text: "#E24B4A", bg: "rgba(226,75,74,0.12)",  label: "Absent"  };
  return                       { dot: "#555",    text: "#666",    bg: "rgba(255,255,255,0.05)", label: "Not marked" };
};

const styles = {
  center: { minHeight: "100vh", background: "#0c0e18", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 },
  fullscreen: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, boxSizing: "border-box" },
  card: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 20, padding: 40, maxWidth: 400, width: "100%", textAlign: "center", fontFamily: "'DM Sans','Segoe UI',sans-serif" },
  btnGreen: { background: "#1D9E75", border: "none", color: "#fff", padding: "12px 28px", borderRadius: 11, cursor: "pointer", fontSize: 15, fontWeight: 700 },
  btnGhost: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#aaa", padding: "10px 20px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600 },
  closeBtn: { background: "rgba(255,255,255,0.07)", border: "none", color: "#aaa", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center" },
};

export default function App() {
  const [phase, setPhase] = useState("loading");
  const [loadProgress, setLoadProgress] = useState(0);
  const [permError, setPermError] = useState("");
  const [students, setStudents] = useState(INITIAL_STUDENTS);
  const [enrolled, setEnrolled] = useState({});
  const [attendance, setAttendance] = useState({});
  const [tab, setTab] = useState("roster");
  const [enrollTarget, setEnrollTarget] = useState(null);
  const [enrollMsg, setEnrollMsg] = useState("");
  const [enrollPhoto, setEnrollPhoto] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanMsg, setScanMsg] = useState("Point camera at a student");
  const [boxStyle, setBoxStyle] = useState(null);
  const [landmarks, setLandmarks] = useState(null);
  const [facingMode, setFacingMode] = useState("user");
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState("");

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scanLoopRef = useRef(null);
  const detectingRef = useRef(false);
  const matcherRef = useRef(null);

  const now = new Date();
  const { present, absent, unmarked, enrolledCount } = summarize(students, attendance, enrolled);

  // Load face-api models
  useEffect(() => {
    (async () => {
      try {
        const MODEL_URL = "/models";
        setLoadProgress(10);
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
        setLoadProgress(45);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        setLoadProgress(78);
        await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
        setLoadProgress(100);
        setTimeout(() => setPhase("permission"), 500);
      } catch(e) {
        console.error(e);
        setPhase("modelerror");
      }
    })();
  }, []);

  const stopStream = useCallback(() => {
    if (scanLoopRef.current) { clearInterval(scanLoopRef.current); scanLoopRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setScanning(false);
  }, []);

  useEffect(() => () => stopStream(), [stopStream]);
  useEffect(() => { matcherRef.current = null; }, [enrolled]);

  const startStream = async (facing) => {
    const fm = facing || facingMode;
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: fm, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    streamRef.current = s;
    return s;
  };

  const attachStream = (stream) => {
    setTimeout(() => {
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(()=>{}); }
    }, 100);
  };

  const requestPermission = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      s.getTracks().forEach(t => t.stop());
      setPhase("main");
    } catch(e) {
      setPermError(e.name === "NotAllowedError" ? "Camera permission denied. Allow it in browser settings and reload." : "Cannot access camera. Make sure no other app is using it.");
      setPhase("denied");
    }
  };

  const openEnroll = async (student) => {
    setEnrollTarget(student);
    setEnrollMsg("Position face clearly in frame, then capture");
    setEnrollPhoto(null);
    setPhase("enroll");
    try {
      const s = await startStream();
      attachStream(s);
    } catch { setEnrollMsg("Camera unavailable"); }
  };

  const captureEnroll = async () => {
    if (!videoRef.current) return;
    setEnrollMsg("Detecting face…");
    const video = videoRef.current;
    const opts = new faceapi.SsdMobilenetv1Options({ minConfidence: ENROLL_MIN_CONFIDENCE });
    const det = await faceapi.detectSingleFace(video, opts).withFaceLandmarks().withFaceDescriptor();
    if (!det) { setEnrollMsg("No face detected — adjust position and try again"); return; }
    const crop = paddedCropRect(det.detection.box, 50, video.videoWidth, video.videoHeight);
    const fc = document.createElement("canvas");
    fc.width = crop.width; fc.height = crop.height;
    fc.getContext("2d").drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const photo = fc.toDataURL("image/jpeg", 0.85);
    setEnrolled(prev => ({ ...prev, [enrollTarget.id]: { photo, descriptor: det.descriptor } }));
    setEnrollPhoto(photo);
    setEnrollMsg("Enrolled successfully!");
    matcherRef.current = null;
    stopStream();
    setTimeout(() => { setPhase("main"); setEnrollTarget(null); }, 1400);
  };

  const buildMatcher = useCallback(() => buildFaceMatcher(faceapi, students, enrolled), [students, enrolled]);

  const runScanLoop = useCallback(() => {
    if (scanLoopRef.current) clearInterval(scanLoopRef.current);
    setScanning(true);
    scanLoopRef.current = setInterval(async () => {
      // Inference can take longer than the interval on slow devices; skip a
      // tick instead of stacking concurrent detections on the GPU.
      if (detectingRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      const matcher = matcherRef.current || (matcherRef.current = buildMatcher());
      if (!matcher) { setScanMsg("No enrolled students — enrol first"); return; }
      detectingRef.current = true;
      try {
        const opts = new faceapi.SsdMobilenetv1Options({ minConfidence: SCAN_MIN_CONFIDENCE });
        const det = await faceapi.detectSingleFace(video, opts).withFaceLandmarks().withFaceDescriptor();
        if (!det) { setBoxStyle(null); setLandmarks(null); setScanResult(null); setScanMsg("Looking for a face…"); return; }
        const t = coverTransform(video.videoWidth, video.videoHeight, video.offsetWidth, video.offsetHeight);
        setBoxStyle(projectBox(det.detection.box, t));
        setLandmarks(projectPoints(det.landmarks.positions, t));
        const result = resolveMatch(matcher.findBestMatch(det.descriptor), students);
        if (!result) { setScanResult(null); setScanMsg("Face detected — not recognised"); return; }
        setScanResult(result);
        setScanMsg("Recognised: " + result.student.name + " (" + result.conf + "% confidence)");
      } catch (e) {
        console.error(e);
        setScanMsg("Detection error — retrying…");
      } finally {
        detectingRef.current = false;
      }
    }, SCAN_INTERVAL_MS);
  }, [buildMatcher, students]);

  const openScan = async () => {
    setScanResult(null); setBoxStyle(null); setLandmarks(null);
    setScanMsg("Starting camera…");
    setPhase("scan");
    try {
      const s = await startStream();
      attachStream(s);
      setTimeout(runScanLoop, 600);
    } catch { setScanMsg("Camera unavailable"); }
  };

  const confirmPresent = () => {
    if (!scanResult) return;
    setAttendance(a => markPresent(a, scanResult.student.id));
    setScanResult(null); setBoxStyle(null); setLandmarks(null);
    setScanMsg("Marked present! Scanning for next face…");
  };

  const closeScan = () => { stopStream(); setPhase("main"); };

  const flipCamera = async (inScan) => {
    const nf = facingMode === "user" ? "environment" : "user";
    setFacingMode(nf);
    try {
      const s = await startStream(nf);
      attachStream(s);
      if (inScan) setTimeout(runScanLoop, 500);
    } catch {
      const msg = "Could not switch camera — this device may only have one";
      if (inScan) setScanMsg(msg); else setEnrollMsg(msg);
    }
  };

  const addStudent = () => {
    const { students: next, error } = addStudentToRoster(students, newName);
    if (error) { setAddError(error); return; }
    setStudents(next);
    setNewName("");
    setAddError("");
  };

  // ── Loading screen ──
  if (phase === "loading" || phase === "modelerror") return (
    <div style={styles.center}>
      <div style={{ textAlign: "center", maxWidth: 320, fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
        <div style={{ fontSize: 56, marginBottom: 20 }}>🧠</div>
        <h2 style={{ color: "#fff", margin: "0 0 8px", fontSize: 22 }}>Loading AI Models</h2>
        <p style={{ color: "#555", fontSize: 14, margin: "0 0 24px", lineHeight: 1.6 }}>Downloading face recognition neural networks…</p>
        <div style={{ height: 6, background: "rgba(255,255,255,0.07)", borderRadius: 99, overflow: "hidden" }}>
          <div style={{ height: "100%", width: loadProgress + "%", background: "#1D9E75", borderRadius: 99, transition: "width 0.4s ease" }} />
        </div>
        <p style={{ color: "#444", fontSize: 12, marginTop: 8 }}>{loadProgress}%</p>
        {phase === "modelerror" && <p style={{ color: "#E24B4A", marginTop: 12 }}>Failed to load models. Check your internet connection and reload.</p>}
      </div>
    </div>
  );

  // ── Permission screen ──
  if (phase === "permission") return (
    <div style={styles.center}>
      <div style={styles.card}>
        <div style={{ fontSize: 52, marginBottom: 20 }}>📷</div>
        <h2 style={{ color: "#fff", margin: "0 0 10px", fontSize: 22, fontWeight: 800 }}>Camera Access Required</h2>
        <p style={{ color: "#666", fontSize: 14, lineHeight: 1.7, margin: "0 0 28px" }}>
          This app uses on-device AI to recognise student faces. Click <strong style={{ color: "#ddd" }}>Allow</strong> when the browser asks for camera permission.
        </p>
        <button onClick={requestPermission} style={{ ...styles.btnGreen, width: "100%" }}>Enable Camera</button>
        <p style={{ color: "#3a3a3a", fontSize: 12, marginTop: 14 }}>All processing is local — nothing leaves your device.</p>
      </div>
    </div>
  );

  // ── Denied screen ──
  if (phase === "denied") return (
    <div style={styles.center}>
      <div style={{ ...styles.card, borderColor: "rgba(226,75,74,0.3)" }}>
        <div style={{ fontSize: 52, marginBottom: 20 }}>🚫</div>
        <h2 style={{ color: "#E24B4A", margin: "0 0 10px", fontSize: 20 }}>Camera Blocked</h2>
        <p style={{ color: "#666", fontSize: 14, lineHeight: 1.6, margin: "0 0 24px" }}>{permError}</p>
        <button onClick={() => { setPermError(""); setPhase("permission"); }} style={{ ...styles.btnGhost, width: "100%" }}>Try Again</button>
      </div>
    </div>
  );

  // ── Enroll screen ──
  if (phase === "enroll" && enrollTarget) return (
    <div style={styles.fullscreen}>
      <div style={{ background: "#13151f", borderRadius: 20, overflow: "hidden", width: "100%", maxWidth: 500, border: "1px solid rgba(255,255,255,0.08)", fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar name={enrollTarget.name} size={38} photo={enrolled[enrollTarget.id]?.photo} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: "#fff", fontSize: 15 }}>{enrollTarget.name}</div>
            <div style={{ fontSize: 12, color: "#555" }}>Face enrolment</div>
          </div>
          <button onClick={() => { stopStream(); setPhase("main"); }} style={styles.closeBtn}>×</button>
        </div>
        <div style={{ position: "relative", background: "#000", minHeight: 280 }}>
          <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", display: "block", maxHeight: 380, objectFit: "cover" }} />
          {["tl","tr","bl","br"].map(c => (
            <div key={c} style={{ position: "absolute", width: 26, height: 26, pointerEvents: "none",
              borderTop:    c.includes("t") ? "3px solid #1D9E75" : "none",
              borderBottom: c.includes("b") ? "3px solid #1D9E75" : "none",
              borderLeft:   c.includes("l") ? "3px solid #1D9E75" : "none",
              borderRight:  c.includes("r") ? "3px solid #1D9E75" : "none",
              top:    c.includes("t") ? 18 : undefined, bottom: c.includes("b") ? 18 : undefined,
              left:   c.includes("l") ? 18 : undefined, right:  c.includes("r") ? 18 : undefined,
            }} />
          ))}
          {enrollPhoto && <img src={enrollPhoto} alt="captured" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
        </div>
        <div style={{ padding: "11px 20px", background: "rgba(0,0,0,0.4)", fontSize: 13, textAlign: "center", color: enrollMsg.startsWith("Enrolled") ? "#1D9E75" : enrollMsg.startsWith("No face") ? "#E24B4A" : "#888" }}>
          {enrollMsg}
        </div>
        <div style={{ padding: "14px 20px", display: "flex", gap: 10 }}>
          <button onClick={() => flipCamera(false)} style={styles.btnGhost}>Flip</button>
          <button onClick={captureEnroll} style={{ ...styles.btnGreen, flex: 1 }}>Capture Face</button>
        </div>
      </div>
    </div>
  );

  // ── Scan screen ──
  if (phase === "scan") return (
    <div style={styles.fullscreen}>
      <div style={{ background: "#13151f", borderRadius: 20, overflow: "hidden", width: "100%", maxWidth: 560, border: "1px solid rgba(255,255,255,0.08)", fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 800, color: "#fff", fontSize: 16 }}>Face Recognition Scanner</div>
            <div style={{ fontSize: 12, color: "#555" }}>AI detection active</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {scanning && <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#1D9E75", animation: "pulse 1.4s infinite" }} />
              <span style={{ fontSize: 12, color: "#1D9E75" }}>Scanning</span>
            </div>}
            <button onClick={closeScan} style={styles.closeBtn}>×</button>
          </div>
        </div>

        <div style={{ position: "relative", background: "#000", minHeight: 300 }}>
          <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", display: "block", maxHeight: 420, objectFit: "cover" }} />

          {landmarks && (
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} xmlns="http://www.w3.org/2000/svg">
              {landmarks.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2.2} fill="#1D9E75" opacity="0.9" />)}
              {landmarks.slice(0,16).map((p,i) => <line key={"jaw"+i} x1={p.x} y1={p.y} x2={landmarks[i+1].x} y2={landmarks[i+1].y} stroke="#1D9E75" strokeWidth="1.2" opacity="0.45" />)}
              {[landmarks.slice(17,22), landmarks.slice(22,27)].map((g,gi) => g.slice(0,-1).map((p,i) => <line key={"br"+gi+i} x1={p.x} y1={p.y} x2={g[i+1].x} y2={g[i+1].y} stroke="#7F77DD" strokeWidth="1.2" opacity="0.55" />))}
              {landmarks.slice(27,35).map((p,i) => <line key={"ns"+i} x1={p.x} y1={p.y} x2={landmarks[28+i].x} y2={landmarks[28+i].y} stroke="#378ADD" strokeWidth="1.2" opacity="0.55" />)}
              {[landmarks.slice(36,42), landmarks.slice(42,48)].map((g,gi) => [
                ...g.slice(0,-1).map((p,i) => <line key={"ey"+gi+i} x1={p.x} y1={p.y} x2={g[i+1].x} y2={g[i+1].y} stroke="#D4537E" strokeWidth="1.4" opacity="0.7" />),
                <line key={"eyc"+gi} x1={g[g.length-1].x} y1={g[g.length-1].y} x2={g[0].x} y2={g[0].y} stroke="#D4537E" strokeWidth="1.4" opacity="0.7" />
              ])}
              {landmarks.slice(48,67).map((p,i) => <line key={"mo"+i} x1={p.x} y1={p.y} x2={landmarks[49+i].x} y2={landmarks[49+i].y} stroke="#BA7517" strokeWidth="1.2" opacity="0.6" />)}
            </svg>
          )}

          {boxStyle && (
            <div style={{ position: "absolute", border: "2px solid " + (scanResult ? "#1D9E75" : "#378ADD"), borderRadius: 4, pointerEvents: "none", transition: "all 0.15s", ...boxStyle }} />
          )}

          {scanResult && (
            <div style={{ position: "absolute", bottom: 12, left: 12, right: 12, background: "rgba(15,25,20,0.95)", border: "1px solid rgba(29,158,117,0.5)", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
              <Avatar name={scanResult.student.name} size={40} photo={enrolled[scanResult.student.id]?.photo} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: "#fff", fontSize: 15 }}>{scanResult.student.name}</div>
                <div style={{ fontSize: 12, color: "#1D9E75" }}>{scanResult.conf}% confidence match</div>
              </div>
              <button onClick={confirmPresent} style={{ background: "#1D9E75", border: "none", color: "#fff", borderRadius: 9, padding: "9px 18px", fontWeight: 700, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" }}>
                ✓ Mark Present
              </button>
            </div>
          )}
        </div>

        <div style={{ padding: "10px 20px", background: "rgba(0,0,0,0.5)", fontSize: 13, textAlign: "center", color: scanResult ? "#1D9E75" : "#666" }}>
          {scanMsg}
        </div>

        <div style={{ padding: "14px 20px", display: "flex", gap: 10 }}>
          <button onClick={() => flipCamera(true)} style={styles.btnGhost}>Flip</button>
          <button onClick={closeScan} style={{ ...styles.btnGhost, flex: 1 }}>Close</button>
        </div>
      </div>
    </div>
  );

  // ── Main UI ──
  return (
    <div style={{ fontFamily: "'DM Sans','Segoe UI',sans-serif", minHeight: "100vh", background: "#0c0e18", color: "#ddd" }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.25}} * { box-sizing: border-box; }`}</style>

      <div style={{ background: "#13151f", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "18px 24px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#1D9E75", animation: "pulse 2s infinite" }} />
              <span style={{ fontSize: 11, color: "#1D9E75", letterSpacing: 1.6, fontWeight: 700, textTransform: "uppercase" }}>AI Powered</span>
            </div>
            <h1 style={{ margin: 0, fontSize: 21, fontWeight: 800, color: "#fff" }}>Face Recognition Attendance</h1>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#444" }}>{formatDate(now)}</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { label: present + " Present",  color: "#1D9E75", bg: "rgba(29,158,117,0.12)" },
              { label: absent  + " Absent",   color: "#E24B4A", bg: "rgba(226,75,74,0.12)" },
              { label: unmarked + " Unmarked", color: "#555",   bg: "rgba(255,255,255,0.04)" },
            ].map(b => <div key={b.label} style={{ background: b.bg, color: b.color, fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 20 }}>{b.label}</div>)}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 24px 0" }}>
        <div style={{ background: enrolledCount > 0 ? "linear-gradient(135deg,rgba(29,158,117,0.13),rgba(55,138,221,0.08))" : "rgba(255,255,255,0.02)", border: "1px solid " + (enrolledCount > 0 ? "rgba(29,158,117,0.2)" : "rgba(255,255,255,0.06)"), borderRadius: 16, padding: "18px 22px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: "#fff", fontSize: 15, marginBottom: 4 }}>Face Recognition Scanner</div>
            <div style={{ fontSize: 13, color: "#555" }}>
              {enrolledCount === 0 ? "Enrol at least one student below to start scanning" : enrolledCount + " of " + students.length + " students enrolled — ready to scan"}
            </div>
          </div>
          <button onClick={enrolledCount > 0 ? openScan : undefined} disabled={enrolledCount === 0}
            style={{ ...styles.btnGreen, opacity: enrolledCount === 0 ? 0.35 : 1, cursor: enrolledCount === 0 ? "not-allowed" : "pointer", padding: "11px 26px", fontSize: 14 }}>
            Start Scan
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "16px 24px 0" }}>
        <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 4, width: "fit-content" }}>
          {[["roster","👥 Roster"],["summary","Summary"]].map(([t,label]) => (
            <button key={t} onClick={() => setTab(t)} style={{ padding: "7px 18px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: tab === t ? "#1D9E75" : "transparent", color: tab === t ? "#fff" : "#555", transition: "all 0.2s" }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>

        {tab === "roster" && (
          <div>
            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              <input aria-label="New student name" value={newName} onChange={e => { setNewName(e.target.value); setAddError(""); }} onKeyDown={e => e.key === "Enter" && addStudent()}
                placeholder="Add new student name…"
                style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 14px", color: "#e0e0e0", fontSize: 14, outline: "none" }} />
              <button onClick={addStudent} style={{ ...styles.btnGreen, padding: "10px 20px", fontSize: 14 }}>+ Add</button>
            </div>
            {addError && <p role="alert" style={{ color: "#E24B4A", fontSize: 13, margin: "-10px 0 16px" }}>{addError}</p>}
            <div role="list" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {students.map(student => {
                const record = attendance[student.id];
                const status = record?.status;
                const isEnrolled = !!enrolled[student.id];
                const c = sc(status);
                return (
                  <div key={student.id} role="listitem" aria-label={student.name} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "13px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                    <Avatar name={student.name} size={46} photo={enrolled[student.id]?.photo} />
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={{ fontWeight: 600, color: "#e8e8e8", fontSize: 15 }}>{student.name}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                        {isEnrolled
                          ? <span style={{ fontSize: 11, color: "#1D9E75", fontWeight: 600, background: "rgba(29,158,117,0.1)", padding: "2px 8px", borderRadius: 20 }}>✓ Face enrolled</span>
                          : <span style={{ fontSize: 11, color: "#444", fontWeight: 600, background: "rgba(255,255,255,0.03)", padding: "2px 8px", borderRadius: 20 }}>Not enrolled</span>}
                        {status && <span style={{ fontSize: 11, color: c.text, fontWeight: 500 }}>· {status === PRESENT ? "Present " + formatTime(record.at) : c.label}</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={() => openEnroll(student)} style={{ background: isEnrolled ? "rgba(55,138,221,0.1)" : "rgba(127,119,221,0.12)", border: "1px solid " + (isEnrolled ? "rgba(55,138,221,0.25)" : "rgba(127,119,221,0.25)"), color: isEnrolled ? "#378ADD" : "#7F77DD", padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                        {isEnrolled ? "Re-enrol" : "Enrol"}
                      </button>
                      {status !== PRESENT && <button onClick={() => setAttendance(a => markAbsent(a, student.id))} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "#555", padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Absent</button>}
                      {status && <button onClick={() => setAttendance(a => clearMark(a, student.id))} style={{ background: "rgba(226,75,74,0.07)", border: "1px solid rgba(226,75,74,0.15)", color: "#E24B4A", padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Clear</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === "summary" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Present",  value: present,  color: "#1D9E75", bg: "rgba(29,158,117,0.09)" },
                { label: "Absent",   value: absent,   color: "#E24B4A", bg: "rgba(226,75,74,0.09)" },
                { label: "Unmarked", value: unmarked, color: "#555",    bg: "rgba(255,255,255,0.03)" },
              ].map(s => (
                <div key={s.label} style={{ background: s.bg, borderRadius: 14, padding: "18px 14px", textAlign: "center" }}>
                  <div style={{ fontSize: 34, fontWeight: 800, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 12, color: "#444", marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>
            {[
              { label: "Attendance", value: present, total: students.length, color: "#1D9E75" },
              { label: "Enrolled for AI", value: enrolledCount, total: students.length, color: "#7F77DD" },
            ].map(bar => (
              <div key={bar.label} style={{ background: "rgba(255,255,255,0.025)", borderRadius: 12, padding: 16, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: "#555" }}>{bar.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{percent(bar.value, bar.total)}%</span>
                </div>
                <div style={{ height: 7, background: "rgba(255,255,255,0.05)", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: percent(bar.value, bar.total) + "%", background: bar.color, borderRadius: 99, transition: "width 0.6s ease" }} />
                </div>
              </div>
            ))}
            {present > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 11, color: "#444", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 12 }}>Present Students</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(110px,1fr))", gap: 10 }}>
                  {students.filter(s => attendance[s.id]?.status === PRESENT).map(s => (
                    <div key={s.id} style={{ background: "rgba(29,158,117,0.07)", border: "1px solid rgba(29,158,117,0.15)", borderRadius: 12, padding: "14px 10px", textAlign: "center" }}>
                      <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
                        <Avatar name={s.name} size={48} photo={enrolled[s.id]?.photo} />
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#ccc" }}>{s.name.split(" ")[0]}</div>
                      <div style={{ fontSize: 11, color: "#1D9E75", marginTop: 2 }}>✓ {formatTime(attendance[s.id].at)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
