/* Single-blow -> extinguish ALL candles (clean-room implementation).
   Edit the name here:
*/
const BIRTHDAY_NAME = "Name Here";

// localStorage key for message
const LS_MESSAGE_KEY = "cake_blow_birthday_message_v1";

const els = {
  nameSlot: document.getElementById("nameSlot"),
  messagePreviewText: document.getElementById("messagePreviewText"),

  // mic + cake
  candlesWrap: document.getElementById("candles"),
  btnStart: document.getElementById("btnStart"),
  btnRelight: document.getElementById("btnRelight"),
  candleCount: document.getElementById("candleCount"),
  candleCountVal: document.getElementById("candleCountVal"),
  sensitivity: document.getElementById("sensitivity"),
  sensitivityVal: document.getElementById("sensitivityVal"),
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

  birthdayMessage: document.getElementById("birthdayMessage"),
  btnClearMessage: document.getElementById("btnClearMessage"),
  btnCopyMessage: document.getElementById("btnCopyMessage"),

  photoInput: document.getElementById("photoInput"),
  btnClearPhotos: document.getElementById("btnClearPhotos"),
  photoGrid: document.getElementById("photoGrid"),
};

let audioCtx = null;
let analyser = null;
let micStream = null;
let rafId = null;

// Running estimates for detection
let baseline = 0.02;     // ambient noise floor
let blowHoldMs = 0;      // accumulated ms above threshold
let lastTs = 0;
let extinguished = false;

// Photo object URLs for cleanup
let photoUrls = [];

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

  // slight variation for visual texture
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

function relightAll() {
  for (const c of els.candlesWrap.querySelectorAll(".candle")) {
    c.classList.remove("out");
    c.setAttribute("data-lit", "1");
  }
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
  // Slider 1..10 -> multiplier 1.35..0.65 (higher slider => more sensitive)
  const s = Number(els.sensitivity.value);
  const t = (s - 1) / 9;          // 0..1
  return 1.35 - 0.70 * t;         // 1.35 -> 0.65
}

function tick(ts) {
  if (!analyser) return;

  if (!lastTs) lastTs = ts;
  const dt = ts - lastTs;
  lastTs = ts;

  const rms = computeRms(analyser);

  // When NOT currently detecting a blow, slowly adapt baseline to room noise
  const alpha = (blowHoldMs > 0) ? 0.0 : 0.015;
  baseline = (1 - alpha) * baseline + alpha * rms;

  const mult = sensitivityMultiplier();
  const threshold = clamp(baseline * (2.25 * mult), 0.010, 0.26);

  // Require sustained energy above threshold (helps avoid random clicks)
  if (rms > threshold) {
    blowHoldMs += dt;
  } else {
    blowHoldMs = Math.max(0, blowHoldMs - dt * 1.6);
  }

  const pct = Math.round(clamp((rms / Math.max(threshold, 1e-6)) * 100, 0, 350));

  if (extinguished) {
    setStatus("Mic is on. Candles are out.", "on");
  } else if (rms > threshold) {
    setStatus(`Mic is on. Blow detected (${pct}%).`, "warn");
  } else {
    setStatus(`Mic is on. Listening… (level ${pct}% of blow threshold)`, "on");
  }

  // Trigger: once, then extinguish all
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

    // Quick calibration over ~0.9s
    baseline = 0.02;
    let samples = 0;
    let acc = 0;
    const start = performance.now();
    while (performance.now() - start < 900) {
      const rms = computeRms(analyser);
      acc += rms;
      samples++;
      await new Promise(r => setTimeout(r, 30));
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

/* Sidebar: tabs */
function setActiveTab(which) {
  const messageActive = which === "message";

  els.tabMessageBtn.classList.toggle("active", messageActive);
  els.tabPhotosBtn.classList.toggle("active", !messageActive);

  els.tabMessageBtn.setAttribute("aria-selected", String(messageActive));
  els.tabPhotosBtn.setAttribute("aria-selected", String(!messageActive));

  els.tabMessage.classList.toggle("active", messageActive);
  els.tabPhotos.classList.toggle("active", !messageActive);
}

/* Sidebar: collapse */
function setSidebarOpen(open) {
  els.sidebarBody.style.display = open ? "block" : "none";
  els.sidebarToggle.textContent = open ? "Hide" : "Show";
  els.sidebarToggle.setAttribute("aria-expanded", String(open));
}

/* Message: load/save + preview */
function loadMessage() {
  const msg = localStorage.getItem(LS_MESSAGE_KEY) || "";
  els.birthdayMessage.value = msg;
  updateMessagePreview(msg);
}

function saveMessage(msg) {
  localStorage.setItem(LS_MESSAGE_KEY, msg);
}

function updateMessagePreview(msg) {
  const trimmed = (msg || "").trim();
  els.messagePreviewText.textContent = trimmed.length ? trimmed : "Write a message in the sidebar.";
}

/* Photos: preview thumbnails */
function clearPhotos() {
  for (const url of photoUrls) URL.revokeObjectURL(url);
  photoUrls = [];
  els.photoGrid.innerHTML = "";
  els.photoInput.value = "";
}

function addPhotos(files) {
  const list = Array.from(files || []).filter(f => f && f.type && f.type.startsWith("image/"));
  for (const f of list) {
    const url = URL.createObjectURL(f);
    photoUrls.push(url);

    const tile = document.createElement("div");
    tile.className = "thumb";

    const img = document.createElement("img");
    img.src = url;
    img.alt = "Uploaded photograph";

    tile.appendChild(img);
    els.photoGrid.appendChild(tile);
  }
}

function init() {
  // Name point
  els.nameSlot.textContent = BIRTHDAY_NAME;

  // Start with 17 candles
  renderCandles(Number(els.candleCount.value));
  els.candleCountVal.textContent = els.candleCount.value;
  els.sensitivityVal.textContent = els.sensitivity.value;

  // Default tab
  setActiveTab("message");
  setSidebarOpen(true);

  // Load saved message
  loadMessage();

  // Mic controls
  els.btnStart.addEventListener("click", startMic);
  els.btnRelight.addEventListener("click", relightAll);

  // Sliders
  els.candleCount.addEventListener("input", () => {
    els.candleCountVal.textContent = els.candleCount.value;
    renderCandles(Number(els.candleCount.value));
  });
  els.sensitivity.addEventListener("input", () => {
    els.sensitivityVal.textContent = els.sensitivity.value;
  });

  // Tabs
  els.tabMessageBtn.addEventListener("click", () => setActiveTab("message"));
  els.tabPhotosBtn.addEventListener("click", () => setActiveTab("photos"));

  // Sidebar toggle
  els.sidebarToggle.addEventListener("click", () => {
    const isOpen = els.sidebarToggle.getAttribute("aria-expanded") === "true";
    setSidebarOpen(!isOpen);
  });

  // Message events
  els.birthdayMessage.addEventListener("input", () => {
    const msg = els.birthdayMessage.value;
    updateMessagePreview(msg);
    saveMessage(msg);
  });

  els.btnClearMessage.addEventListener("click", () => {
    els.birthdayMessage.value = "";
    updateMessagePreview("");
    saveMessage("");
  });

  els.btnCopyMessage.addEventListener("click", async () => {
    const msg = els.birthdayMessage.value || "";
    try {
      await navigator.clipboard.writeText(msg);
      // lightweight feedback in status line without disrupting mic
      const prev = els.statusText.textContent;
      setStatus("Message copied to clipboard.", analyser ? "on" : "off");
      setTimeout(() => setStatus(prev, analyser ? "on" : "off"), 1200);
    } catch {
      const prev = els.statusText.textContent;
      setStatus("Copy failed (clipboard permission).", "warn");
      setTimeout(() => setStatus(prev, analyser ? "on" : "off"), 1400);
    }
  });

  // Photos events
  els.photoInput.addEventListener("change", (e) => {
    addPhotos(e.target.files);
  });

  els.btnClearPhotos.addEventListener("click", clearPhotos);

  // Clean up
  window.addEventListener("beforeunload", () => {
    stopMic();
    clearPhotos();
  });
}

init();
