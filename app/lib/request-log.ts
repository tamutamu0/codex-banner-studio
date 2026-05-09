import { appendFile } from "node:fs/promises";
import path from "node:path";
import { dataDir, ensureMasterDirs, makeId } from "./files";

export type RequestLogEntry = {
  id?: string;
  jobId?: string;
  step: string;
  status: "start" | "progress" | "success" | "error";
  message: string;
  durationMs?: number;
  detail?: unknown;
};

export const requestLogPath = path.join(dataDir, "request-log.jsonl");

export async function appendRequestLog(entry: RequestLogEntry) {
  const row = {
    id: entry.id || makeId("log"),
    time: new Date().toISOString(),
    ...entry,
  };
  try {
    await ensureMasterDirs();
    await appendFile(requestLogPath, `${JSON.stringify(row)}\n`, "utf8");
  } catch (error) {
    console.warn("request log write failed:", error);
  }
  return row;
}
