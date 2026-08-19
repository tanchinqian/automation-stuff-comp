export type SyntheticScene =
  | 'perfect'
  | 'undersized'
  | 'oversized'
  | 'missing'
  | 'irregular'
  | 'spread'
  | 'mixed';

export interface SyntheticOptions {
  cols: number;
  rows: number;
  gridGap: number;
  dotRadius: number;
  background: string;
  dotColor: string;
}

const DEFAULTS: SyntheticOptions = {
  cols: 5,
  rows: 4,
  gridGap: 42,
  dotRadius: 13,
  background: '#f2efe9',
  dotColor: '#22222a',
};

export interface GeneratedFrame {
  canvas: HTMLCanvasElement;
  scene: SyntheticScene;
  canvasToImageData: () => ImageData;
}

/**
 * Draws realistic-looking dispensing dots on a grid, applying a defect
 * pattern so the CV pipeline has guaranteed demo material on judging day.
 */
export function generateSyntheticImage(
  scene: SyntheticScene,
  opts: Partial<SyntheticOptions> = {},
): GeneratedFrame {
  const o: SyntheticOptions = { ...DEFAULTS, ...opts };
  const pad = 30;
  const w = pad * 2 + (o.cols - 1) * o.gridGap;
  const h = pad * 2 + (o.rows - 1) * o.gridGap;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = o.background;
  ctx.fillRect(0, 0, w, h);

  const addNoise = () => {
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '60,60,60' : '255,255,255'},${Math.random() * 0.06})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
  };
  addNoise();

  const dot = (x: number, y: number, r: number, color = o.dotColor) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
  };

  const irregular = (x: number, y: number, r: number) => {
    ctx.fillStyle = o.dotColor;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(0.4);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.5, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const spread = (x: number, y: number, r: number) => {
    ctx.fillStyle = o.dotColor;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.7, r * 1.4, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y + r);
    ctx.quadraticCurveTo(x + r * 2.2, y + r * 1.6, x + r * 1.2, y + r * 2.4);
    ctx.quadraticCurveTo(x, y + r * 1.4, x - r, y + r * 1.6);
    ctx.fill();
  };

  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

  for (let row = 0; row < o.rows; row++) {
    for (let col = 0; col < o.cols; col++) {
      const x = pad + col * o.gridGap;
      const y = pad + row * o.gridGap;
      const r = o.dotRadius + (Math.random() - 0.5) * 2;
      const jitter = (Math.random() - 0.5) * 1.6;

      let localScene = scene;
      if (scene === 'mixed') {
        const roll = Math.random();
        localScene = roll < 0.5 ? 'perfect' : pick<Exclude<SyntheticScene, 'mixed'>>(['undersized', 'oversized', 'irregular', 'missing', 'spread']);
      }

      switch (localScene) {
        case 'perfect':
          dot(x + jitter, y + jitter, r);
          break;
        case 'undersized':
          dot(x + jitter, y + jitter, r * (0.35 + Math.random() * 0.2));
          break;
        case 'oversized':
          dot(x + jitter, y + jitter, r * (1.45 + Math.random() * 0.25));
          break;
        case 'missing':
          if (Math.random() < 0.85) break; // skip entirely
          dot(x + jitter, y + jitter, r * 0.18);
          break;
        case 'irregular':
          irregular(x + jitter, y + jitter, r);
          break;
        case 'spread':
          spread(x + jitter, y + jitter, r);
          break;
      }
    }
  }

  return {
    canvas,
    scene,
    canvasToImageData: () => ctx.getImageData(0, 0, w, h),
  };
}

/** Live-stream simulator: produces a fresh frame with a random-ish defect mix. */
export function makeLiveSimulator(seedScene: SyntheticScene = 'mixed') {
  let frame = 0;
  return () => {
    frame++;
    const scene: SyntheticScene =
      frame % 8 === 0 ? 'mixed' : seedScene === 'mixed' ? pickSyntheticScene() : seedScene;
    return generateSyntheticImage(scene, {});
  };
}

function pickSyntheticScene(): SyntheticScene {
  const scenes: SyntheticScene[] = ['perfect', 'undersized', 'oversized', 'irregular', 'missing', 'spread'];
  return scenes[Math.floor(Math.random() * scenes.length)];
}