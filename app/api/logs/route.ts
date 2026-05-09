import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { requestLogPath } from "@/app/lib/request-log";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 200), 1), 1000);
  try {
    const raw = await readFile(requestLogPath, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean).slice(-limit);
    const logs = lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
    return NextResponse.json({ path: requestLogPath, logs });
  } catch {
    return NextResponse.json({ path: requestLogPath, logs: [] });
  }
}
