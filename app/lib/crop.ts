import sharp from "sharp";
import { writeGenerated } from "./files";

export function gridForCount(count: number) {
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  return { columns, rows };
}

export async function cropSheet(sheetBuffer: Buffer, baseName: string, count: number) {
  const image = sharp(sheetBuffer);
  const meta = await image.metadata();
  const { columns, rows } = gridForCount(count);
  const width = Math.floor((meta.width || 0) / columns);
  const height = Math.floor((meta.height || 0) / rows);

  if (!width || !height) {
    throw new Error("Could not read sheet dimensions");
  }

  const cells = Array.from({ length: count }, (_, index) => ({
    index: index + 1,
    left: (index % columns) * width,
    top: Math.floor(index / columns) * height,
  }));

  const crops = [];
  for (const cell of cells) {
    const buffer = await sharp(sheetBuffer)
      .extract({ left: cell.left, top: cell.top, width, height })
      .png()
      .toBuffer();
    const cropUrl = await writeGenerated(`${baseName}-crop-${cell.index}.png`, buffer);
    crops.push({ index: cell.index, cropUrl });
  }
  return crops;
}
