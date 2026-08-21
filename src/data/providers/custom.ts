import type { BoardImage, DatasetProvider, Rect } from '../types';

/**
 * Custom / user-provided board images. This is the escape hatch that lets a
 * future dataset (or live photos) be dropped in without code changes: add a
 * BoardImage via the registry or load from a folder later.
 *
 * Currently exposes a static sample list that can be replaced by uploads.
 */
export class CustomProvider implements DatasetProvider {
  readonly id = 'custom';
  readonly name = 'Custom / uploaded';
  readonly attribution = 'User-supplied inspection images.';

  private images: BoardImage[] = [];

  async list(): Promise<BoardImage[]> {
    return this.images;
  }

  addImage(src: string, label: string, cls: BoardImage['class'], padRois?: Rect[]): void {
    this.images.push({
      id: `custom-${this.images.length + 1}`,
      src,
      label,
      dataset: 'custom',
      class: cls,
      padRois,
    });
  }
}
