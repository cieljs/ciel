// @env node

import sharp from 'sharp';

interface VisionDifference {
  readonly changed: boolean;
  commit(): void;
}

const FINGERPRINT_WIDTH = 64;
const FINGERPRINT_HEIGHT = 36;

export class VisionDiffer {
  private previous?: Buffer;

  constructor(private readonly threshold: number) {}

  async evaluate(data: Buffer): Promise<VisionDifference> {
    const current = await sharp(data)
      .resize(FINGERPRINT_WIDTH, FINGERPRINT_HEIGHT, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();

    const ratio = this.previous ? comparePixels(this.previous, current) : undefined;

    return {
      changed: ratio === undefined || ratio >= this.threshold,
      commit: () => {
        this.previous = current;
      },
    };
  }
}

function comparePixels(previous: Buffer, current: Buffer) {
  let difference = 0;

  for (let index = 0; index < current.length; index += 1) {
    difference += Math.abs(current[index]! - previous[index]!);
  }

  return difference / (current.length * 255);
}
