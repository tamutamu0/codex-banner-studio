import { NextResponse } from "next/server";
import { makeId } from "@/app/lib/files";
import { DEFAULT_PROMPT_PRESETS, missingRequiredVariables, readPromptPresets, saveCustomPromptPresets, type PromptPreset, type PromptStep } from "@/app/lib/prompt-presets";

export async function GET() {
  const presets = await readPromptPresets();
  return NextResponse.json({ presets, defaults: DEFAULT_PROMPT_PRESETS });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { sourceId?: string; step?: PromptStep; name?: string; template?: string };
  const presets = await readPromptPresets();
  const source = body.sourceId ? presets.find((preset) => preset.id === body.sourceId) : undefined;
  const step = source?.step || body.step;
  if (step !== "ideas" && step !== "sheets" && step !== "final") return NextResponse.json({ message: "ステップを選択してください" }, { status: 400 });

  const template = String(body.template ?? source?.template ?? "").trim();
  const name = String(body.name || (source ? `${source.name}のコピー` : "")).trim();
  if (!name || !template) return NextResponse.json({ message: "プリセット名とプロンプトを入力してください" }, { status: 400 });

  const missing = missingRequiredVariables(step, template);
  if (missing.length) return NextResponse.json({ message: `必須変数が不足しています: ${missing.map((key) => `{{${key}}}`).join(", ")}` }, { status: 400 });

  const now = new Date().toISOString();
  const nextPreset: PromptPreset = {
    id: makeId("prompt"),
    step,
    name,
    template,
    builtIn: false,
    createdAt: now,
    updatedAt: now,
  };
  const next = await saveCustomPromptPresets([nextPreset, ...presets]);
  return NextResponse.json({ preset: nextPreset, presets: next });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as { id?: string; name?: string; template?: string };
  const id = String(body.id || "").trim();
  const presets = await readPromptPresets();
  const current = presets.find((preset) => preset.id === id);
  if (!current) return NextResponse.json({ message: "プリセットが見つかりません" }, { status: 404 });

  const name = String(body.name || "").trim();
  const template = String(body.template || "").trim();
  if (!name || !template) return NextResponse.json({ message: "プリセット名とプロンプトを入力してください" }, { status: 400 });

  const missing = missingRequiredVariables(current.step, template);
  if (missing.length) return NextResponse.json({ message: `必須変数が不足しています: ${missing.map((key) => `{{${key}}}`).join(", ")}` }, { status: 400 });

  const updated = presets.map((preset) => preset.id === id ? {
    ...preset,
    name,
    template,
    updatedAt: new Date().toISOString(),
  } : preset);
  const next = await saveCustomPromptPresets(updated);
  return NextResponse.json({ presets: next, preset: next.find((preset) => preset.id === id) });
}

export async function DELETE(request: Request) {
  const body = (await request.json()) as { id?: string };
  const id = String(body.id || "").trim();
  const presets = await readPromptPresets();
  const current = presets.find((preset) => preset.id === id);
  if (!current) return NextResponse.json({ message: "プリセットが見つかりません" }, { status: 404 });
  if (current.builtIn) return NextResponse.json({ message: "デフォルトプリセットは削除できません" }, { status: 400 });
  const next = await saveCustomPromptPresets(presets.filter((preset) => !preset.builtIn && preset.id !== id));
  return NextResponse.json({ presets: next });
}
