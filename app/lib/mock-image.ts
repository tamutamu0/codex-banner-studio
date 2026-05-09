import sharp from "sharp";
import type { ProductInput, Variant } from "./files";
import { gridForCount } from "./crop";

const palettes = [
  ["#f7d154", "#146c94", "#0f172a"],
  ["#eb6f92", "#57b8a5", "#22223b"],
  ["#b7e4c7", "#40916c", "#1b4332"],
  ["#ffc857", "#e9724c", "#2b2d42"],
];

function safeText(value: string) {
  return value.replace(/[<>&"]/g, "").slice(0, 58);
}

function quadrantSvg(variant: Variant, input: ProductInput, width: number, height: number, x: number, y: number) {
  const palette = palettes[(variant.index - 1) % palettes.length];
  return `
    <g transform="translate(${x} ${y})">
      <rect width="${width}" height="${height}" rx="0" fill="${palette[0]}"/>
      <circle cx="${width * 0.78}" cy="${height * 0.22}" r="${width * 0.22}" fill="${palette[1]}" opacity="0.92"/>
      <rect x="${width * 0.08}" y="${height * 0.12}" width="${width * 0.36}" height="${height * 0.56}" rx="30" fill="#fffaf0" opacity="0.94"/>
      <rect x="${width * 0.14}" y="${height * 0.22}" width="${width * 0.24}" height="${height * 0.32}" rx="22" fill="${palette[2]}" opacity="0.92"/>
      <path d="M ${width * 0.1} ${height * 0.78} C ${width * 0.32} ${height * 0.62}, ${width * 0.62} ${height * 0.98}, ${width * 0.9} ${height * 0.72}" stroke="${palette[2]}" stroke-width="24" fill="none" opacity="0.6"/>
      <text x="${width * 0.08}" y="${height * 0.84}" font-size="34" font-family="Arial, sans-serif" font-weight="700" fill="${palette[2]}">${safeText(input.productName || "Product")}</text>
      <text x="${width * 0.08}" y="${height * 0.91}" font-size="20" font-family="Arial, sans-serif" fill="${palette[2]}" opacity="0.8">${safeText(variant.prompt)}</text>
    </g>
  `;
}

export async function createMockSheet(input: ProductInput, variants: Variant[]) {
  const { columns, rows } = gridForCount(variants.length);
  const cell = variants.length > 4 ? 512 : 768;
  const totalWidth = cell * columns;
  const totalHeight = cell * rows;
  const svg = `
    <svg width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f8fafc"/>
      ${variants.map((variant, index) => quadrantSvg(variant, input, cell, cell, (index % columns) * cell, Math.floor(index / columns) * cell)).join("")}
      ${Array.from({ length: columns - 1 }, (_, index) => `<line x1="${cell * (index + 1)}" x2="${cell * (index + 1)}" y1="0" y2="${totalHeight}" stroke="#ffffff" stroke-width="24"/>`).join("")}
      ${Array.from({ length: rows - 1 }, (_, index) => `<line x1="0" x2="${totalWidth}" y1="${cell * (index + 1)}" y2="${cell * (index + 1)}" stroke="#ffffff" stroke-width="24"/>`).join("")}
    </svg>
  `;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function createMockFinal(input: ProductInput, variant: Variant) {
  const palette = palettes[(variant.index - 1) % palettes.length];
  const svg = `
    <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1024" fill="${palette[0]}"/>
      <circle cx="790" cy="210" r="240" fill="${palette[1]}" opacity="0.92"/>
      <rect x="95" y="116" width="366" height="594" rx="48" fill="#fffaf0" opacity="0.96"/>
      <rect x="156" y="218" width="242" height="350" rx="36" fill="${palette[2]}" opacity="0.94"/>
      <path d="M120 780 C310 620, 640 980, 918 706" stroke="${palette[2]}" stroke-width="34" fill="none" opacity="0.58"/>
      <text x="94" y="875" font-size="48" font-family="Arial, sans-serif" font-weight="700" fill="${palette[2]}">${safeText(input.productName || "Product")}</text>
      <text x="96" y="934" font-size="28" font-family="Arial, sans-serif" fill="${palette[2]}" opacity="0.78">${safeText(variant.prompt)}</text>
    </svg>
  `;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
