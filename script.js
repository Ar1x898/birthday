/* Clean-room implementation
   Requirements met:
   - 17 candles by default
   - one valid blow extinguishes ALL candles at once
   - recipient has no inputs besides enabling mic (required by browser) + blowing
   - message + photos are hard-coded in this file
*/

/* 1) EDIT THESE THREE POINTS */
const BIRTHDAY_NAME = "Francesca";

const BIRTHDAY_MESSAGE = `Happy birthday darling! Congrats on making it to 17, guess I can now say we're the same age.
Sorry that I can't be there physically to celebrate your birthday or our anniversary, it greatly saddens me. I hope that this little 
half-baked project can suffice for a while. You'll get your present when I return soon, don't worry about it. Anyway, all I can say 
is thank you. Thank you for your love and affection, something which I do not deserve. Thank you for making JC1 enjoyable for me. 
It's been a great pleasure and I look forward for the coming year. Stay strong and don't let what others say get too much to you 
(pshh tianna pshh). Guess you can call me Newton instead, since I do calculus much and our school is near Newton haha. But the punch 
line was supposed to be I'm Newton because I would discover gravity just to explain how I fell for you. That sounded better in my head...
Uhh yea all the best and here's to a fruitful relationship and year! 
P.S: i still dont like him (just had to put it here ;))`;

// Use either relative paths (recommended for GitHub Pages) or full URLs.
// Example relative: "photos/pic1.jpg" if you create /photos folder next to index.html
const PHOTO_URLS = [
  "photos/ice-skate.jpg",
  "photos/pic2.jpg",
  "photos/pic3.jpg",
  // "https://example.com/your-photo.jpg"
];

/* 2) OPTIONAL: tweak detection without exposing UI */
const SENSITIVITY_LEVEL = 6; // 1..10 (higher = more sensitive)

const els = {
  nameSlot: document.getElementById("nameSlot"),
  messagePreviewText: document.getElementById("messagePreviewText"),
  sidebarMessageText: document.getElementById("sidebarMessageText"),

  // mic + cake
  candlesWrap: document.getElementById("candles"),
  btnStart: document.getElementById("btnStart"),
  statusText: document.getElementById("statusText"),
  micDot: document.getElementById("micDot"),
  doneText: document.getElementById("doneText"),

  // sidebar
  sidebarToggle: document.getElementById("sidebarToggle"),
  sidebarBody: document.getElementById("sidebarBody"),
  tabMessageBtn: document.getElementById("tabMessageBtn"),
  tabPhotosBtn: document.getElementById("tabPhotosBtn"),
  tabMessage: document.getElementById("tabMessage"),
  tabPhotos: document.getElementById("tabPhotos"),
  photoGrid: document.getElementById("photoGrid"),
};

let audioCtx = null;
let analyser = null;
let micStream = null;
let rafId = null;

let baseline = 0.02;
let blowHoldMs = 0;
let lastTs = 0;
let extinguished = false;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function setStatus(text, mode = "off") {
  els.statusText.textContent = text;
  els.micDot.classList.remove("on", "warn");
  if (mode === "on") els.micDot.classList.add("on");
  if (mode === "warn") els.micDot.classList.add("warn");
}

function makeCandle(i, n) {
  const c = document.createElement("div");
  c.className = "candle";
  c.setAttribute("data-lit", "1");

  const baseH = 54;
  const variance = 16 * Math.sin((i / Math.max(1, n - 1)) * Math.PI);
  c.style.height = `${Math.round(baseH + variance)}px`;

  const flame = document.createElement("div");
  flame.className = "flame";
  c.appendChild(flame);
  return c;
}

function renderCandles(n) {
  els.candlesWrap.innerHTML = "";
  for (let i = 0; i < n; i++) els.candlesWrap.appendChild(makeCandle(i, n));
  els.doneText.hidden = true;
  extinguished = false;
}

function extinguishAll() {
  for (const c of els.candlesWrap.querySelectorAll(".candle")) {
    c.classList.add("out");
    c.setAttribute("data-lit", "0");
  }
  els.doneText.hidden = false;
  extinguished = true;
}

function computeRms(analyserNode) {
  const buf = new Float32Array(analyserNode.fftSize);
  analyserNode.getFloatTimeDomainData(buf);
  let sumSq = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    sumSq += x * x;
  }
  return Math.sqrt(sumSq / buf.length);
}

function sensitivityMultiplier() {
  // 1..10 -> 1.35..0.65 (higher number => more sensitive)
  const s = clamp(Number(SENSITIVITY_LEVEL), 1, 10);
  const t = (s - 1) / 9;
  return 1.35 - 0.70 * t;
}

function tick(ts) {
  if (!analyser) return;

  if (!lastTs) lastTs = ts;
  const dt = ts - lastTs;
  lastTs = ts;

  const rms = computeRms(analyser);

  // adapt baseline only when not in a blow
  const alpha = (blowHoldMs > 0) ? 0.0 : 0.015;
  baseline = (1 - alpha) * baseline + alpha * rms;

  const mult = sensitivityMultiplier();
  const threshold = clamp(baseline * (2.25 * mult), 0.010, 0.26);

  if (rms > threshold) blowHoldMs += dt;
  else blowHoldMs = Math.max(0, blowHoldMs - dt * 1.6);

  const pct = Math.round(clamp((rms / Math.max(threshold, 1e-6)) * 100, 0, 350));

  if (extinguished) setStatus("Mic is on. Candles are out.", "on");
  else if (rms > threshold) setStatus(`Mic is on. Blow detected (${pct}%).`, "warn");
  else setStatus(`Mic is on. Listening…`, "on");

  if (!extinguished && blowHoldMs >= 170) {
    extinguishAll();
    blowHoldMs = 0;
  }

  rafId = requestAnimationFrame(tick);
}

async function startMic() {
  try {
    setStatus("Requesting microphone permission…", "warn");

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false
      }
    });

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(micStream);

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.4;

    src.connect(analyser);

    // quick calibration (~0.9s)
    baseline = 0.02;
    let samples = 0;
    let acc = 0;
    const start = performance.now();
    while (performance.now() - start < 900) {
      const r = computeRms(analyser);
      acc += r;
      samples++;
      await new Promise(rsv => setTimeout(rsv, 30));
    }
    baseline = Math.max(0.008, acc / Math.max(1, samples));

    els.btnStart.disabled = true;
    setStatus("Mic is on. Listening…", "on");

    if (rafId) cancelAnimationFrame(rafId);
    lastTs = 0;
    blowHoldMs = 0;

    rafId = requestAnimationFrame(tick);
  } catch (err) {
    console.error(err);
    setStatus("Mic permission denied or unavailable. Use HTTPS/localhost.", "warn");
  }
}

function stopMic() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;

  if (micStream) {
    for (const t of micStream.getTracks()) t.stop();
  }
  micStream = null;

  if (audioCtx) audioCtx.close().catch(() => {});
  audioCtx = null;
  analyser = null;

  els.btnStart.disabled = false;
  setStatus("Mic is off.");
}

/* Sidebar tabs */
function setActiveTab(which) {
  const messageActive = which === "message";

  els.tabMessageBtn.classList.toggle("active", messageActive);
  els.tabPhotosBtn.classList.toggle("active", !messageActive);

  els.tabMessageBtn.setAttribute("aria-selected", String(messageActive));
  els.tabPhotosBtn.setAttribute("aria-selected", String(!messageActive));

  els.tabMessage.classList.toggle("active", messageActive);
  els.tabPhotos.classList.toggle("active", !messageActive);
}

function setSidebarOpen(open) {
  els.sidebarBody.style.display = open ? "block" : "none";
  els.sidebarToggle.textContent = open ? "Hide" : "Show";
  els.sidebarToggle.setAttribute("aria-expanded", String(open));
}

function renderPhotos() {
  els.photoGrid.innerHTML = "";

  for (const url of PHOTO_URLS) {
    const tile = document.createElement("div");
    tile.className = "thumb";

    const img = document.createElement("img");
    img.src = url;
    img.alt = "Photo";

    tile.appendChild(img);
    els.photoGrid.appendChild(tile);
  }
}

function init() {
  // Set name + message (both shown immediately)
  els.nameSlot.textContent = BIRTHDAY_NAME;
  els.messagePreviewText.textContent = BIRTHDAY_MESSAGE;
  els.sidebarMessageText.textContent = BIRTHDAY_MESSAGE;

  // 17 candles fixed
  renderCandles(17);

  // Sidebar defaults
  setActiveTab("message");
  setSidebarOpen(true);

  renderPhotos();

  // Only required “input” for recipient: enabling mic permission
  els.btnStart.addEventListener("click", startMic);

  // Tabs + sidebar toggle are view controls; remove them if you want absolute minimal UI.
  els.tabMessageBtn.addEventListener("click", () => setActiveTab("message"));
  els.tabPhotosBtn.addEventListener("click", () => setActiveTab("photos"));

  els.sidebarToggle.addEventListener("click", () => {
    const isOpen = els.sidebarToggle.getAttribute("aria-expanded") === "true";
    setSidebarOpen(!isOpen);
  });

  window.addEventListener("beforeunload", stopMic);
}

init();
