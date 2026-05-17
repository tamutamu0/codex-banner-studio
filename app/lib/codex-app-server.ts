import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { appendRequestLog } from "./request-log";

type RpcMessage = {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: { code?: number; message?: string };
};

type CodexRunOptions = {
  prompt: string;
  images?: string[];
  timeoutMs?: number;
  logLabel?: string;
  jobId?: string;
  cancelKey?: string;
  model?: string;
  effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  serviceTier?: "fast" | "auto";
  onTextDelta?: (delta: string, textSoFar: string) => void;
};

export type CodexGeneratedImage = {
  id: string;
  status: string;
  revisedPrompt?: string | null;
  result?: string;
  savedPath?: string;
};

export type CodexTurnResult = {
  finalText: string;
  images: CodexGeneratedImage[];
  events: string[];
  jobId: string;
  durationMs: number;
};

export function getCodexBin() {
  const configured = process.env.CODEX_BIN?.trim();
  if (process.platform === "win32") {
    if (configured) return configured;
    const npmCodex = process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "codex.cmd") : "";
    try {
      if (npmCodex && existsSync(npmCodex)) return npmCodex;
    } catch {
      // Fall back to PATH lookup below.
    }
    return "codex";
  }
  return configured || "codex";
}

function getCodexSpawnOptions() {
  return {
    cwd: process.cwd(),
    env: process.env,
  };
}

function quoteWindowsArg(value: string) {
  if (/^[A-Za-z0-9_./\\:-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function spawnCodex(args: string[], stdio: ["ignore" | "pipe", "pipe", "pipe"] | ["pipe", "pipe", "pipe"]) {
  const codexBin = getCodexBin();
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec || "cmd.exe";
    const commandLine = [codexBin, ...args].map(quoteWindowsArg).join(" ");
    return spawn(comspec, ["/d", "/c", commandLine], {
      stdio,
      windowsVerbatimArguments: true,
      ...getCodexSpawnOptions(),
    }) as ChildProcessWithoutNullStreams;
  }
  return spawn(codexBin, args, {
    stdio,
    ...getCodexSpawnOptions(),
  }) as ChildProcessWithoutNullStreams;
}

export type CodexLoginStatus = {
  ok: boolean;
  message: string;
  stdout?: string;
  stderr?: string;
};

export async function checkCodexLoginStatus(timeoutMs = 15_000): Promise<CodexLoginStatus> {
  const codexBin = getCodexBin();
  return new Promise((resolve) => {
    const proc = spawnCodex(["login", "status"], ["ignore", "pipe", "pipe"]);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill();
      resolve({
        ok: false,
        message: "Codex login status check timed out. Run `codex login`, then restart this app.",
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    }, timeoutMs);
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        message: `Codex CLI was not found or could not start. Install Codex CLI, then run \`codex login\`. (${error.message})`,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const out = stdout.trim();
      const err = stderr.trim();
      const combined = [out, err].filter(Boolean).join("\n");
      if (code === 0 && /logged in/i.test(combined)) {
        resolve({ ok: true, message: combined || "Codex is logged in.", stdout: out, stderr: err });
        return;
      }
      resolve({
        ok: false,
        message: combined || "Codex is not logged in. Run `codex login`, then restart this app.",
        stdout: out,
        stderr: err,
      });
    });
  });
}

const runningGroups = new Map<string, Set<ChildProcessWithoutNullStreams>>();

function registerProcess(cancelKey: string | undefined, proc: ChildProcessWithoutNullStreams) {
  if (!cancelKey) return;
  const group = runningGroups.get(cancelKey) || new Set<ChildProcessWithoutNullStreams>();
  group.add(proc);
  runningGroups.set(cancelKey, group);
  proc.once("close", () => {
    group.delete(proc);
    if (!group.size) runningGroups.delete(cancelKey);
  });
}

export function cancelCodexGroup(cancelKey: string) {
  const group = runningGroups.get(cancelKey);
  if (!group) return 0;
  let cancelled = 0;
  for (const proc of group) {
    if (!proc.killed) {
      proc.kill();
      cancelled += 1;
    }
  }
  runningGroups.delete(cancelKey);
  return cancelled;
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced?.[1] || text;
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("Codex did not return a JSON object");
  }
  return JSON.parse(source.slice(first, last + 1));
}

export function parseCodexJson<T>(text: string): T {
  return extractJsonObject(text) as T;
}

function summarizeRpcMessage(msg: RpcMessage) {
  if (msg.method === "account/rateLimits/updated") {
    return {
      method: msg.method,
      params: msg.params,
    };
  }
  const item = msg.params?.item;
  if (!item) return { method: msg.method };
  return {
    method: msg.method,
    itemType: item.type,
    status: item.status,
    id: item.id,
    hasImageResult: Boolean(item.result || item.savedPath),
  };
}

export async function runCodexTurnDetailed({ prompt, images = [], timeoutMs = 180_000, logLabel = "codex-turn", jobId = `${logLabel}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, cancelKey, model, effort, serviceTier, onTextDelta }: CodexRunOptions): Promise<CodexTurnResult> {
  const startedAt = Date.now();
  const codexBin = getCodexBin();
  const supportedServiceTier = serviceTier === "fast" ? "fast" : undefined;
  await appendRequestLog({
    jobId,
    step: logLabel,
    status: "start",
    message: "Codex App Server turn start",
    detail: { codexBin, timeoutMs, cancelKey, model, effort, serviceTier: supportedServiceTier || "auto", imageCount: images.length, images, prompt },
  });
  const proc = spawnCodex(["app-server"], ["pipe", "pipe", "pipe"]);
  registerProcess(cancelKey, proc);

  let nextId = 1;
  let stderr = "";
  let finalText = "";
  const generatedImages: CodexGeneratedImage[] = [];
  const events: string[] = [];

  const addGeneratedImage = (image: CodexGeneratedImage) => {
    const existingIndex = generatedImages.findIndex((item) => item.id === image.id);
    if (existingIndex >= 0) generatedImages[existingIndex] = { ...generatedImages[existingIndex], ...image };
    else generatedImages.push(image);
  };

  const rl = readline.createInterface({ input: proc.stdout });

  const send = (message: unknown) => {
    proc.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const waitFor = (id: number, label = `rpc-${id}`) =>
    new Promise<RpcMessage>((resolve, reject) => {
      const onLine = (line: string) => {
        let msg: RpcMessage;
        try {
          msg = JSON.parse(line) as RpcMessage;
        } catch (error) {
          void appendRequestLog({
            jobId,
            step: logLabel,
            status: "error",
            message: "Codex stdout JSON parse failed",
            detail: { label, line, error: error instanceof Error ? error.message : String(error) },
          });
          return;
        }
        if (msg.id !== id) return;
        rl.off("line", onLine);
        if (msg.error) reject(new Error(msg.error.message || `Codex RPC error ${msg.error.code}`));
        else resolve(msg);
      };
      rl.on("line", onLine);
    });

  let finishTurn: (() => void) | undefined;
  let failTurn: ((error: Error) => void) | undefined;
  const turnFinished = new Promise<void>((resolve, reject) => {
    let settled = false;
    finishTurn = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    failTurn = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    rl.on("line", (line) => {
      let msg: RpcMessage;
      try {
        msg = JSON.parse(line) as RpcMessage;
      } catch (error) {
        void appendRequestLog({
          jobId,
          step: logLabel,
          status: "error",
          message: "Codex event JSON parse failed",
          detail: { line, error: error instanceof Error ? error.message : String(error) },
        });
        return;
      }
      if (msg.method) {
        events.push(msg.method);
        void appendRequestLog({
          jobId,
          step: logLabel,
          status: "progress",
          message: `Codex event: ${msg.method}`,
          detail: summarizeRpcMessage(msg),
        });
      }
      if (msg.method === "item/completed" && msg.params?.item?.type === "agentMessage") {
        const text = msg.params.item.text;
        if (typeof text === "string") finalText = text;
      }
      if (msg.method === "item/completed" && msg.params?.item?.type === "imageGeneration") {
        addGeneratedImage({
          id: msg.params.item.id,
          status: msg.params.item.status,
          revisedPrompt: msg.params.item.revisedPrompt,
          result: msg.params.item.result,
          savedPath: msg.params.item.savedPath,
        });
      }
      if (msg.method === "rawResponseItem/completed" && msg.params?.item?.type === "image_generation_call") {
        addGeneratedImage({
          id: msg.params.item.id,
          status: msg.params.item.status,
          revisedPrompt: msg.params.item.revised_prompt,
          result: msg.params.item.result,
        });
      }
      if (msg.method === "item/agentMessage/delta" && typeof msg.params?.delta === "string") {
        finalText += msg.params.delta;
        onTextDelta?.(msg.params.delta, finalText);
      }
      if (msg.method === "turn/completed") {
        const status = msg.params?.turn?.status;
        if (status === "completed") finishTurn?.();
        else failTurn?.(new Error(msg.params?.turn?.error?.message || `Codex turn status: ${status}`));
      }
      if (msg.method === "error") {
        failTurn?.(new Error(msg.params?.error?.message || "Codex app-server emitted an error"));
      }
    });
  });

  proc.on("error", (error) => {
    failTurn?.(error);
  });
  proc.on("close", (code, signal) => {
    failTurn?.(new Error(signal ? `Codex app-server stopped: signal=${signal}` : `Codex app-server exited before turn completed: code=${code ?? "null"}`));
  });

  proc.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const timer = setTimeout(() => {
    failTurn?.(new Error(`Codex turn timed out after ${timeoutMs}ms`));
    proc.kill();
  }, timeoutMs);

  try {
    const initId = nextId++;
    send({
      method: "initialize",
      id: initId,
      params: {
        clientInfo: {
          name: "image_batch_prototype",
          title: "Image Batch Prototype",
          version: "0.1.0",
        },
      },
    });
    await waitFor(initId, "initialize");
    await appendRequestLog({ jobId, step: logLabel, status: "progress", message: "initialize completed" });
    send({ method: "initialized", params: {} });

    const threadIdRequest = nextId++;
    send({ method: "thread/start", id: threadIdRequest, params: {} });
    const threadResponse = await waitFor(threadIdRequest, "thread/start");
    const threadId = threadResponse.result?.thread?.id;
    if (!threadId) throw new Error("Codex did not return a thread id");
    await appendRequestLog({ jobId, step: logLabel, status: "progress", message: "thread started", detail: { threadId } });

    const turnIdRequest = nextId++;
    const input = [
      { type: "text", text: prompt, text_elements: [] },
      ...images.map((path) => ({ type: "localImage", path })),
    ];

    send({
      method: "turn/start",
      id: turnIdRequest,
      params: {
        threadId,
        cwd: process.cwd(),
        input,
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        ...(supportedServiceTier ? { serviceTier: supportedServiceTier } : {}),
      },
    });
    await waitFor(turnIdRequest, "turn/start");
    await appendRequestLog({ jobId, step: logLabel, status: "progress", message: "turn accepted", detail: { threadId, inputCount: input.length } });
    await turnFinished;

    if (!finalText.trim() && generatedImages.length === 0) throw new Error("Codex completed without a final message or image");
    await appendRequestLog({
      jobId,
      step: logLabel,
      status: "success",
      message: "Codex turn completed",
      durationMs: Date.now() - startedAt,
      detail: { imageCount: generatedImages.length, events: [...new Set(events)], finalText: finalText.trim() },
    });
    return { finalText: finalText.trim(), images: generatedImages, events, jobId, durationMs: Date.now() - startedAt };
  } catch (error) {
    const detail = stderr.trim();
    const message = error instanceof Error ? error.message : String(error);
    await appendRequestLog({
      jobId,
      step: logLabel,
      status: "error",
      message,
      durationMs: Date.now() - startedAt,
      detail: { stderr: detail, events: [...new Set(events)] },
    });
    throw new Error(detail ? `${message}\n${detail}` : message);
  } finally {
    clearTimeout(timer);
    rl.close();
    if (!proc.killed) proc.kill();
  }
}

export async function runCodexTurn(options: CodexRunOptions) {
  const result = await runCodexTurnDetailed(options);
  return result.finalText;
}
