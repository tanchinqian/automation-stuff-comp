import type { DatasetProvider } from './types';
import { PcbAoiProvider } from './providers/pcbAoi';
import { CustomProvider } from './providers/custom';

export type { BoardImage, BoardClass, BoardDefect, DatasetProvider, Rect } from './types';
export { PcbAoiProvider } from './providers/pcbAoi';
export { CustomProvider } from './providers/custom';

/**
 * Registry of all available dataset providers. The active dataset is chosen
 * here. Adding a new dataset later = add its provider + flip activeDataset.
 */
export function createRegistry(): Map<string, DatasetProvider> {
  const map = new Map<string, DatasetProvider>();
  const pcb = new PcbAoiProvider();
  const custom = new CustomProvider();
  map.set(pcb.id, pcb);
  map.set(custom.id, custom);
  return map;
}
