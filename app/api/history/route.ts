import { NextResponse } from "next/server";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { generatedDir, readHistory, type ProjectRecord, type Variant } from "@/app/lib/files";

async function readOrphanGenerated(history: ProjectRecord[]) {
  const known = new Set<string>();
  for (const record of history) {
    for (const variant of record.ideas || []) {
      if (variant.cropUrl) known.add(variant.cropUrl);
    }
  }
  try {
    const entries = await readdir(generatedDir, { withFileTypes: true });
    const cropEntries = entries
      .filter((entry) => entry.isFile() && /-crop-\d+\.(png|jpe?g|webp)$/i.test(entry.name))
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, 1000);
    const records: ProjectRecord[] = [];
    for (const entry of cropEntries) {
      const url = `/generated/${entry.name}`;
      if (known.has(url)) continue;
      const fileStat = await stat(path.join(generatedDir, entry.name));
      const variant: Variant = {
        index: 1,
        globalIndex: 1,
        appeal: "履歴なしの生成画像",
        prompt: "生成履歴に残っていない未保存画像です。",
        cropUrl: url,
      };
      records.push({
        id: `orphan-${entry.name.replace(/\W+/g, "-")}`,
        createdAt: fileStat.mtime.toISOString(),
        input: { productName: "履歴なし", format: "WEB広告バナー候補" },
        ideas: [variant],
      });
    }
    return records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 200);
  } catch {
    return [];
  }
}

export async function GET() {
  const history = await readHistory();
  const orphanHistory = await readOrphanGenerated(history);
  return NextResponse.json({ history, orphanHistory });
}
