import { NextResponse } from "next/server";
import { makeId, saveHistory, type ProjectRecord } from "@/app/lib/files";

export async function POST(request: Request) {
  const body = (await request.json()) as Omit<ProjectRecord, "id" | "createdAt"> & { id?: string };
  const record: ProjectRecord = {
    ...body,
    id: body.id || makeId("project"),
    createdAt: new Date().toISOString(),
  };
  const history = await saveHistory(record);
  return NextResponse.json({ record, history });
}
