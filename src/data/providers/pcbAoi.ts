import type { BoardImage, DatasetProvider, Rect } from '../types';

/** Shape of the build-time generated boards.json (see scripts/build-boards.mjs). */
export interface BoardJsonEntry {
  id: string;
  file: string;
  label: string;
  class: string;
  padRois?: Rect[];
  defects?: { class: string; rect: Rect }[];
}

interface BoardJson {
  dataset: string;
  attribution: string;
  boards: BoardJsonEntry[];
}

let cache: BoardImage[] | null = null;

/**
 * PCB-AoI dataset provider (KubeEdge-Ianvs; China Telecom Research Institute
 * + Raisecom Technology). Reads the build-time-converted boards.json so pad
 * annotations arrive pre-parsed and no XML parsing runs in the browser.
 */
export class PcbAoiProvider implements DatasetProvider {
  readonly id = 'pcb-aoi';
  readonly name = 'PCB-AoI (solder paste)';
  readonly attribution =
    'PCB-AoI dataset, KubeEdge-Ianvs project; released by China Telecom Research Institute and Raisecom Technology.';

  async list(): Promise<BoardImage[]> {
    if (cache) return cache;
    const res = await fetch('boards/boards.json');
    if (!res.ok) {
      cache = [];
      return cache;
    }
    const json = (await res.json()) as BoardJson;
    cache = json.boards.map((b) => ({
      id: b.id,
      src: `boards/${b.file}`,
      label: b.label,
      dataset: json.dataset,
      class: (b.class as BoardImage['class']) || 'unknown',
      padRois: b.padRois,
      defects: b.defects?.map((d) => ({ class: d.class as BoardImage['class'], rect: d.rect })),
    }));
    return cache;
  }
}
