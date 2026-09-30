// @env node

import sharp from 'sharp';

interface FrameSlot {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;
const COLUMNS = 3;

export async function composeVisionFrames(frames: readonly Buffer[]): Promise<Buffer> {
  if (frames.length === 0 || frames.length > 9) {
    throw new Error('Vision composition requires between 1 and 9 frames');
  }

  const metadata = await Promise.all(frames.map(frame => sharp(frame).metadata()));
  const rows = Math.ceil(frames.length / COLUMNS);
  const rowHeight = Math.floor(OUTPUT_HEIGHT / rows);
  const slots: FrameSlot[] = [];

  for (let row = 0; row < rows; row += 1) {
    const count = Math.min(COLUMNS, frames.length - row * COLUMNS);
    const cellWidth = Math.floor(OUTPUT_WIDTH / count);

    for (let column = 0; column < count; column += 1) {
      const index = row * COLUMNS + column;
      const frame = metadata[index]!;
      const aspect = frame.width && frame.height ? frame.width / frame.height : 16 / 9;
      const width = Math.min(cellWidth, Math.floor(rowHeight * aspect));
      const height = Math.min(rowHeight, Math.floor(width / aspect));

      slots.push({
        width,
        height,
        left: column * cellWidth + Math.floor((cellWidth - width) / 2),
        top: row * rowHeight + Math.floor((rowHeight - height) / 2),
      });
    }
  }

  const resized = await Promise.all(
    slots.map((slot, index) =>
      sharp(frames[index]!)
        .resize(slot.width, slot.height, { fit: 'contain' })
        .jpeg({ quality: 85 })
        .toBuffer(),
    ),
  );

  return sharp({
    create: {
      width: OUTPUT_WIDTH,
      height: OUTPUT_HEIGHT,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite(
      resized.map((input, index) => ({
        input,
        left: slots[index]!.left,
        top: slots[index]!.top,
      })),
    )
    .jpeg({ quality: 85 })
    .toBuffer();
}
