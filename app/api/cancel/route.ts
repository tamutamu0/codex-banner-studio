import { NextResponse } from "next/server";
import { cancelCodexGroup } from "@/app/lib/codex-app-server";
import { appendRequestLog } from "@/app/lib/request-log";

export async function POST(request: Request) {
  const { cancelKey } = (await request.json()) as { cancelKey?: string };
  if (!cancelKey) return NextResponse.json({ ok: false, message: "cancelKey is required" }, { status: 400 });
  const cancelled = cancelCodexGroup(cancelKey);
  await appendRequestLog({
    jobId: cancelKey,
    step: "cancel",
    status: "success",
    message: "User requested generation stop",
    detail: { cancelKey, cancelled },
  });
  return NextResponse.json({ ok: true, cancelKey, cancelled });
}
