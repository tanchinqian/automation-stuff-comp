/**
 * ESP32-CAM LIVE STREAM — PLACEHOLDER
 * ===================================
 * This is the stubbed wiring point for the Bonus "Live Inspection" mode.
 *
 * TARGET HARDWARE:  ESP32-CAM (OV2640) running an MJPEG streamer firmware
 *                   (e.g. "esp32-cam-mjpeg" / arduino-cam-webserver).
 * STREAM URL:       http://<esp32-ip>/stream   (default AP IP 192.168.4.1)
 *
 * HOW IT WILL WORK (once hardware is available):
 *   1. The ESP32 serves a multipart/x-mixed-replace MJPEG stream.
 *   2. The browser fetches it with `fetch(streamUrl)` and parses the
 *      boundary-delimited JPEG frames, or an <img src> is pointed at the
 *      URL and each `load` event grabs the current frame onto a canvas.
 *   3. Each captured frame is pushed into `analyzeImage()` (the SAME
 *      computer-vision pipeline used for stills), giving live per-frame
 *      defect counts, size variance and quality score.
 *   4. A YOLO-style CNN (.tflite / onnx via ort-web) can be dropped in as
 *      the detector for the live path without touching the rest of the app.
 *
 * KNOWN LIMITATIONS (handled in the UI):
 *   - Mixed content: an https-served page cannot fetch an http://192.168.x.x
 *     stream. During judging, serve this app over http (vite preview /
 *     `npx vite --host`) or use a WebSocket relay on the ESP32.
 *   - The app's Live tab already falls back to webcam + synthetic simulator
 *     so a live demo always works even without the hardware.
 */
export interface Esp32StreamConfig {
  url: string;
  fps: number;
  useWifiAp: boolean;
}

export const DEFAULT_ESP32_CONFIG: Esp32StreamConfig = {
  url: 'http://192.168.4.1/stream',
  fps: 10,
  useWifiAp: true,
};

/** Grab the next frame from an <img> pointed at an MJPEG stream. */
export function captureFrameFromImg(img: HTMLImageElement, canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!;
  canvas.width = img.naturalWidth || 640;
  canvas.height = img.naturalHeight || 480;
  ctx.drawImage(img, 0, 0);
}

/** TODO(hardware): implement MJPEG frame parsing + YOLO detector here. */
export function connectEsp32Stream(_config: Esp32StreamConfig): Promise<{ close: () => void }> {
  return Promise.reject(new Error('ESP32 stream not implemented yet — hardware pending.'));
}