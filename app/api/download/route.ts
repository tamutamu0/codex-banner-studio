import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

type Body = {
  name?: string;
  files?: Array<{ url: string; name?: string }>;
};

const publicRoot = path.join(process.cwd(), "public");
const allowedPrefixes = ["/generated/", "/saved-banners/"];

function safeName(value: string, fallback: string) {
  return (value || fallback)
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|#%{}^~[\]`;\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || fallback;
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dosDate };
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function resolvePublicFile(url: string) {
  if (!allowedPrefixes.some((prefix) => url.startsWith(prefix))) throw new Error("ダウンロードできない画像が含まれています");
  const decoded = decodeURIComponent(url.split("?")[0]);
  const target = path.resolve(publicRoot, decoded.replace(/^\//, ""));
  if (!target.startsWith(publicRoot + path.sep)) throw new Error("画像パスが不正です");
  return target;
}

export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  const files = (body.files || []).filter((file) => file.url).slice(0, 500);
  if (!files.length) return NextResponse.json({ message: "ダウンロードする画像がありません" }, { status: 400 });

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const { time, date } = dosDateTime();

  for (const [index, file] of files.entries()) {
    const filePath = resolvePublicFile(file.url);
    const data = await readFile(filePath);
    const ext = path.extname(filePath) || ".png";
    const name = `${String(index + 1).padStart(3, "0")}-${safeName(file.name || path.basename(filePath, ext), `banner-${index + 1}`)}${ext}`;
    const nameBuffer = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const size = data.length;
    const localHeader = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(crc), u32(size), u32(size), u16(nameBuffer.length), u16(0), nameBuffer,
    ]);
    const centralHeader = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(crc), u32(size), u32(size), u16(nameBuffer.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), nameBuffer,
    ]);
    localParts.push(localHeader, data);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(central.length), u32(centralOffset), u16(0),
  ]);
  const zip = Buffer.concat([...localParts, central, end]);
  const zipName = `${safeName(body.name || "banners", "banners")}.zip`;

  return new NextResponse(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
      "Content-Length": String(zip.length),
    },
  });
}
