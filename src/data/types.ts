export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Ground-truth classes a dataset can label a board with.
 * These map onto the product's dispensing-defect language where possible.
 */
export type BoardClass =
  | 'good'
  | 'less-paste'
  | 'missing'
  | 'bridging'
  | 'misalignment'
  | 'unknown';

export interface BoardDefect {
  class: BoardClass;
  rect: Rect;
}

/**
 * A single inspection image from a dataset. Providers return these.
 * The detection pipeline only needs `src` + optional `padRois`.
 */
export interface BoardImage {
  id: string;
  src: string;
  label: string;
  dataset: string;
  class: BoardClass;
  padRois?: Rect[];
  defects?: BoardDefect[];
  reference?: string;
}

/**
 * A swappable source of inspection images. The rest of the app talks only
 * to this contract, never to a specific dataset, so changing datasets is a
 * registry/config change, not a CV-pipeline rewrite.
 */
export interface DatasetProvider {
  id: string;
  name: string;
  attribution: string;
  list(): Promise<BoardImage[]>;
}
