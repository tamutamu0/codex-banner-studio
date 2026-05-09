import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { generatedDir, makeId, type ProductInput, type Variant } from "@/app/lib/files";
import { generateImageWithCodex } from "@/app/lib/codex-image";
import { appendRequestLog } from "@/app/lib/request-log";
import { renderPromptWithGuardrails, type PromptTemplateMap } from "@/app/lib/prompt-presets";

type RefineAnnotation = {
  id: string;
  kind: "pin" | "box";
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
};

type Body = {
  input: ProductInput;
  variant: Variant;
  editInstruction?: string;
  instruction?: string;
  annotations?: RefineAnnotation[];
  annotationImageDataUrl?: string;
  aspectRatio?: string;
  cancelKey?: string;
  codexSettings?: {
    model?: string;
    effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
    serviceTier?: "fast" | "auto";
  };
  promptTemplates?: PromptTemplateMap;
};

async function saveAnnotationImage(dataUrl?: string) {
  if (!dataUrl) return "";
  const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("修正メモ画像の形式が不正です");
  await mkdir(generatedDir, { recursive: true });
  const fileName = `${makeId("annotation")}.png`;
  const target = path.join(generatedDir, fileName);
  await writeFile(target, Buffer.from(match[1], "base64"));
  return target;
}

function annotationInstructionBlock(annotations: RefineAnnotation[], hasAnnotationImage: boolean) {
  if (!annotations.length) return "";
  const list = annotations.map((item, index) => {
    const position = item.kind === "box"
      ? `範囲 x=${Math.round(item.x * 100)}%, y=${Math.round(item.y * 100)}%, w=${Math.round((item.width || 0) * 100)}%, h=${Math.round((item.height || 0) * 100)}%`
      : `ピン x=${Math.round(item.x * 100)}%, y=${Math.round(item.y * 100)}%`;
    return `${index + 1}. ${position}: ${(item.text || "").trim() || "この位置を自然に調整する"}`;
  }).join("\n");
  return `
修正メモ:
${hasAnnotationImage ? "- 添付画像1枚目はオリジナルの選択画像。添付画像2枚目は赤い番号と枠を載せた修正メモ用画像です。" : "- 下の番号付き修正メモを参照してください。"}
- 修正メモ用画像の赤い番号・枠・マークは指示のためだけに使い、最終画像には絶対に表示しない。
- 番号に対応する下記内容に沿って自然に修正する。
- 修正メモの文章をそのまま画像内テキストとして表示しない。
${list}
  `.trim();
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const { input, variant, editInstruction, instruction, annotations = [], annotationImageDataUrl, aspectRatio = "1024x1024", cancelKey, codexSettings, promptTemplates } = (await request.json()) as Body;
  const userInstruction = editInstruction ?? instruction ?? "";
  const jobId = `final-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const annotationImagePath = await saveAnnotationImage(annotationImageDataUrl);

  const imagePath = variant.cropUrl?.startsWith("/generated/")
    ? path.join(generatedDir, variant.cropUrl.replace("/generated/", ""))
    : variant.cropUrl?.startsWith("/saved-banners/")
      ? path.join(process.cwd(), "public", variant.cropUrl.replace(/^\//, ""))
      : undefined;
  const editBlock = userInstruction.trim()
    ? `修正指示:\n${userInstruction.trim()}\n\n上記の修正指示だけを反映し、それ以外は変えない。書き加えない。構成を変更しない。`
    : "追加の修正指示はなし。選択画像の内容をそのまま維持し、単体バナーとして綺麗に仕上げる。";
  const combinedEditBlock = [editBlock, annotationInstructionBlock(annotations, Boolean(annotationImagePath))].filter(Boolean).join("\n\n");
  const priceTreatmentText = variant.priceTreatment === "with_price" ? "価格あり。既存の価格表示を維持する。" : "価格なし。価格文言を追加しない。";
  const productImageDescriptions = input.productImages?.map((image, index) => `  画像${index + 1}: ${image.description}`).join("\n") || "  なし";
  const defaultFinalPrompt = `
添付した選択画像をもとに、広告バナー画像を再生成して。
再生成する画像サイズ/比率は ${aspectRatio}。

指定の内容以外は維持する。
オリジナル画像の構成内容を変えない。
オリジナル画像にない要素を加えない。
構図、商品配置、色味、雰囲気、訴求、文字の有無、価格表示の有無はできるだけ維持する。
グリッドの枠線、分割シートの余白、番号、セル境界など、候補シート由来の不要な要素だけを取り除く。
プロデザイナーが仕上げたような高品質な単体バナーに整える。

${combinedEditBlock}

商品情報:
- ブランド: ${input.brandName || "不明"}
- 商品名: ${input.productName}
- 価格情報: ${input.priceInfo || "なし"}
- 選択画像の価格表示: ${priceTreatmentText}
- 商品画像説明:
${productImageDescriptions}
  `.trim();
  const finalPrompt = renderPromptWithGuardrails("final", promptTemplates?.final || defaultFinalPrompt, {
    aspectRatio,
    editBlock: combinedEditBlock,
    brandName: input.brandName || "不明",
    productName: input.productName,
    priceInfo: input.priceInfo || "なし",
    priceTreatmentText,
    productImageDescriptions,
  });

  const imagePaths = [
    imagePath,
    annotationImagePath,
    ...(input.productImages?.map((image) => image.path) || (input.productImagePath ? [input.productImagePath] : [])),
  ].filter(Boolean) as string[];

  await appendRequestLog({
    jobId,
    step: "api-final",
    status: "start",
    message: "Step 3 final request received",
    detail: { aspectRatio, cancelKey, imagePaths, variant, annotations, prompt: finalPrompt },
  });

  try {
    const generated = await generateImageWithCodex(finalPrompt, {
      prefix: "final",
      images: imagePaths,
      cancelKey,
      model: codexSettings?.model,
      effort: codexSettings?.effort,
      serviceTier: codexSettings?.serviceTier,
    });
    const finalUrl = generated.imageUrl;
    await appendRequestLog({
      jobId,
      step: "api-final",
      status: "success",
      message: "Step 3 final completed",
      durationMs: Date.now() - startedAt,
      detail: { finalUrl, imagePath: generated.imagePath, codexJobId: generated.jobId, events: generated.events, revisedPrompt: generated.revisedPrompt },
    });
    return NextResponse.json({
      id: finalUrl,
      mode: "codex",
      finalUrl,
      variant,
      debug: {
        step: "final",
        durationMs: Date.now() - startedAt,
        revisedPrompt: generated.revisedPrompt,
        events: generated.events,
        jobId,
        codexJobId: generated.jobId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendRequestLog({
      jobId,
      step: "api-final",
      status: "error",
      message,
      durationMs: Date.now() - startedAt,
      detail: { aspectRatio, imagePaths, variant, prompt: finalPrompt },
    });
    return NextResponse.json({ mode: "error", message, debug: { step: "final", durationMs: Date.now() - startedAt, jobId } }, { status: 500 });
  }
}
