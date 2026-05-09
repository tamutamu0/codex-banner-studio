import { NextResponse } from "next/server";
import os from "node:os";
import { checkCodexLoginStatus, getCodexBin, parseCodexJson, runCodexTurn } from "@/app/lib/codex-app-server";
import { appendRequestLog } from "@/app/lib/request-log";

export async function POST() {
  const startedAt = Date.now();
  const jobId = `codex-check-${Date.now()}`;

  try {
    await appendRequestLog({
      jobId,
      step: "codex-check",
      status: "start",
      message: "Codex connection test started",
      detail: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        cwd: process.cwd(),
        osRelease: os.release(),
        codexBin: getCodexBin(),
        env: {
          CODEX_BIN: process.env.CODEX_BIN || "",
          npm_lifecycle_event: process.env.npm_lifecycle_event || "",
          BANNER_TOOL_STARTER: process.env.BANNER_TOOL_STARTER || "",
          PATH: process.env.PATH || "",
        },
      },
    });

    const login = await checkCodexLoginStatus();
    await appendRequestLog({
      jobId,
      step: "codex-check-login",
      status: login.ok ? "success" : "error",
      message: login.ok ? "Codex login status OK" : "Codex login status failed",
      durationMs: Date.now() - startedAt,
      detail: login,
    });
    if (!login.ok) {
      return NextResponse.json(
        {
          ok: false,
          mode: "login-required",
          message: "Codexにログインしていません。ターミナルまたは起動ファイルの案内に従って `codex login` を実行し、ログイン後にこのアプリを再起動してください。",
          debug: {
            codexBin: getCodexBin(),
            durationMs: Date.now() - startedAt,
            loginMessage: login.message,
            stderr: login.stderr,
          },
        },
        { status: 401 },
      );
    }

    const text = await runCodexTurn({
      timeoutMs: 60_000,
      logLabel: "codex-check-turn",
      jobId,
      prompt: `
Return JSON only. No markdown.
Schema: { "ok": true, "message": "short Japanese status" }
Say that Codex App Server is connected.
      `.trim(),
    });
    const parsed = parseCodexJson<{ ok: boolean; message: string }>(text);
    await appendRequestLog({
      jobId,
      step: "codex-check",
      status: "success",
      message: "Codex connection test completed",
      durationMs: Date.now() - startedAt,
      detail: { parsed },
    });
    return NextResponse.json({
      ok: Boolean(parsed.ok),
      mode: "codex",
      message: parsed.message || "Codex App Server connected",
      debug: {
        codexBin: getCodexBin(),
        durationMs: Date.now() - startedAt,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendRequestLog({
      jobId,
      step: "codex-check",
      status: "error",
      message,
      durationMs: Date.now() - startedAt,
      detail: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        cwd: process.cwd(),
        codexBin: getCodexBin(),
      },
    });
    return NextResponse.json(
      {
        ok: false,
        mode: "error",
        message,
        debug: {
          codexBin: getCodexBin(),
          durationMs: Date.now() - startedAt,
        },
      },
      { status: 500 },
    );
  }
}
