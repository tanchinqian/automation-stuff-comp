import { analyzeImage, CLASS_LABELS, imageDataFromCanvas } from '../vision/analyzeImage';
import { qualityScore } from '../vision/qualityScore';
import { makeLiveSimulator } from '../vision/syntheticGenerator';
import { el, clear, panel, button, emptyState } from './dom';

type LiveSource = 'sim' | 'webcam' | 'esp32';

let running = false;
let rafId = 0;
let stream: MediaStream | null = null;
let simTick: (() => { canvas: HTMLCanvasElement; canvasToImageData: () => ImageData }) | null = null;

const ESP32_PLACEHOLDER = 'http://192.168.4.1/stream';

export function renderLive(host: HTMLElement): void {
  clear(host);
  const layout = el('div', 'layout cols');
  host.appendChild(layout);

  const left = panel('Live Inspection', 'ESP32-CAM · webcam · simulator');
  const right = panel('Live CV Feed', 'per-frame analysis');

  const lBody = left.querySelector('.panel-body')!;
  const rBody = right.querySelector('.panel-body')!;

  const toolbar = el('div', 'live-toolbar');
  const srcLabel = el('div', 'question-label', 'Source');
  lBody.appendChild(srcLabel);
  lBody.appendChild(toolbar);

  const badge = el('span', 'live-badge stub', 'ESP32: PLACEHOLDER - WIRING PENDING');
  toolbar.appendChild(badge);

  const btnSim = button('SIMULATOR', 'btn primary sm');
  const btnWebcam = button('WEBCAM', 'btn sm');
  const btnStop = button('STOP', 'btn sm');
  toolbar.appendChild(btnSim);
  toolbar.appendChild(btnWebcam);
  toolbar.appendChild(btnStop);

  const urlRow = el('div', 'freetext-row');
  const urlInput = el('input', 'live-url') as HTMLInputElement;
  urlInput.value = ESP32_PLACEHOLDER;
  const btnEsp = button('CONNECT ESP32', 'btn sm');
  btnEsp.title = 'Placeholder - ESP32-CAM wiring is stubbed. See src/live/README.md';
  urlRow.appendChild(urlInput);
  urlRow.appendChild(btnEsp);
  lBody.appendChild(urlRow);

  const frameWrap = el('div', 'canvas-frame');
  const liveCanvas = document.createElement('canvas');
  liveCanvas.width = 320;
  liveCanvas.height = 240;
  frameWrap.appendChild(liveCanvas);
  lBody.appendChild(frameWrap);

  const statusLine = el('div', 'nlu-note', 'Status: idle');
  lBody.appendChild(statusLine);

  layout.appendChild(left);
  layout.appendChild(right);

  const rBodyStatic = el('div', 'metric-grid');
  const metric = (k: string, v: string, cls = '') => {
    const x = el('div', 'metric');
    x.appendChild(el('div', 'k', k));
    const val = el('div', 'v', v);
    if (cls) val.classList.add(cls);
    x.appendChild(val);
    rBodyStatic.appendChild(x);
  };
  metric('Frames analyzed', '0');
  metric('Current defect', '-');
  metric('Dots / frame', '0');
  metric('Missing', '0');
  metric('Quality', '-');
  metric('Size CV', '-');
  const liveStatus = el('div', 'nlu-note', '');
  rBody.appendChild(rBodyStatic);
  rBody.appendChild(liveStatus);

  let frames = 0;

  const stopAll = () => {
    running = false;
    cancelAnimationFrame(rafId);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    simTick = null;
    liveCanvas.getContext('2d')!.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
    statusLine.textContent = 'Status: idle';
  };

  const processFrame = (img: ImageData) => {
    frames++;
    const a = analyzeImage(img);
    const q = qualityScore(a);
    // Update metrics in place
    const cells = rBodyStatic.querySelectorAll('.metric .v');
    const set = (i: number, v: string, cls = '') => {
      const c = cells[i] as HTMLElement;
      c.textContent = v;
      c.className = 'v' + (cls ? ` ${cls}` : '');
    };
    set(0, `${frames}`);
    set(1, CLASS_LABELS[a.dominantClass], a.defectDetected ? 'warn' : 'good');
    set(2, `${a.metrics.count}`);
    set(3, `${a.metrics.missingCount}`, a.metrics.missingCount > 0 ? 'warn' : 'good');
    set(4, `${q.overall}`, q.overall >= 75 ? 'good' : q.overall >= 50 ? 'warn' : '');
    set(5, `${(a.metrics.areaCv * 100).toFixed(1)}%`);
    liveStatus.textContent = `Pipeline: Otsu threshold → connected components → ${a.blobs.length} blob(s) classified.`;
  };

  const loop = () => {
    if (!running) return;
    if (simTick) {
      const f = simTick();
      liveCanvas.width = f.canvas.width;
      liveCanvas.height = f.canvas.height;
      const ctx = liveCanvas.getContext('2d')!;
      ctx.drawImage(f.canvas, 0, 0);
      processFrame(f.canvasToImageData());
    } else if (stream) {
      const ctx = liveCanvas.getContext('2d')!;
      const v = document.querySelector('video') as HTMLVideoElement | null;
      if (v && v.readyState >= 2) {
        ctx.drawImage(v, 0, 0, liveCanvas.width, liveCanvas.height);
        processFrame(ctx.getImageData(0, 0, liveCanvas.width, liveCanvas.height));
      }
    }
    rafId = requestAnimationFrame(loop);
  };

  const startSim = () => {
    stopAll();
    running = true;
    simTick = makeLiveSimulator('mixed');
    statusLine.textContent = 'Status: synthetic simulator stream - every 8th frame introduces a defect mix';
    frames = 0;
    loop();
  };

  const startWebcam = async () => {
    stopAll();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      const v = el('video', '') as HTMLVideoElement;
      v.srcObject = stream;
      v.autoplay = true;
      v.muted = true;
      v.style.display = 'none';
      document.body.appendChild(v);
      running = true;
      statusLine.textContent = 'Status: webcam live - analysis running on every frame';
      frames = 0;
      loop();
    } catch (e) {
      statusLine.textContent = `Status: webcam unavailable (${(e as Error).message})`;
    }
  };

  const startEsp32 = () => {
    stopAll();
    statusLine.innerHTML = 'Status: <b style="color:var(--warn)">ESP32-CAM stream - PLACEHOLDER.</b> Wiring pending. The UI is ready: point it at the ESP32 MJPEG URL (default 192.168.4.1/stream) once the camera firmware is flashed. See the stub in <span class="mono">src/live/esp32.ts</span>.';
  };

  btnSim.onclick = startSim;
  btnWebcam.onclick = startWebcam;
  btnStop.onclick = stopAll;
  btnEsp.onclick = startEsp32;
}