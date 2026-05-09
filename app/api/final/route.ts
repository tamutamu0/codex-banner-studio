import path from "node:path";
import { NextResponse } from "next/server";
import { generatedDir, type ProductInput, type Variant } from "@/app/lib/files";
import { generateImageWithCodex } from "@/app/lib/codex-image";
import { appendRequestLog } from "@/app/lib/request-log";

type Body = {
  input: ProductInput;
  variant: Variant;
  editInstruction?: string;
  instruction?: string;
  aspectRatio?: string;
  cancelKey?: string;
  codexSettings?: {
    model?: string;
    effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
    serviceTier?: "fast" | "auto" | "flex";
  };
};

export async function POST(request: Request) {
  const startedAt = Date.now();
  const { input, variant, editInstruction, instruction, aspectRatio = "1:1", cancelKey, codexSettings } = (await request.json()) as Body;
  const userInstruction = editInstruction ?? instruction ?? "";
  const jobId = `final-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const imagePath = variant.cropUrl?.startsWith("/generated/")
    ? path.join(generatedDir, variant.cropUrl.replace("/generated/", ""))
    : undefined;
  const finalPrompt = `
添付した選択画像をもとに、広告バナー画像を再生成して。
再生成する比率は ${aspectRatio}。

指定の内容以外は維持する。
オリジナル画像の構成内容を変えない。
オリジナル画像にない要素を加えない。
構図、商品配置、色味、雰囲気、訴求、文字の有無、価格表示の有無はできるだけ維持する。
グリッドの枠線、分割シートの余白、番号、セル境界など、候補シート由来の不要な要素だけを取り除く。
プロデザイナーが仕上げたような高品質な単体バナーに整える。

${userInstruction.trim() ? `修正指示:\n${userInstruction.trim()}\n\n上記の修正指示だけを反映し、それ以外は変えない。書き加えない。構成を変更しない。` : "追加の修正指示はなし。選択画像の内容をそのまま維持し、単体バナーとして綺麗に仕上げる。"}

商品情報:
- ブランド: ${input.brandName || "不明"}
- 商品名: ${input.productName}
- 価格情報: ${input.priceInfo || "なし"}
- 選択画像の価格表示: ${variant.priceTreatment === "with_price" ? "価格あり。既存の価格表示を維持する。" : "価格なし。価格文言を追加しない。"}
- 商品画像説明:
${input.productImages?.map((image, index) => `  画像${index + 1}: ${image.description}`).join("\n") || "  なし"}
  `.trim();

  const imagePaths = [
    imagePath,
    ...(input.productImages?.map((image) => image.path) || (input.productImagePath ? [input.productImagePath] : [])),
  ].filter(Boolean) as string[];

  await appendRequestLog({
    jobId,
    step: "api-final",
    status: "start",
    message: "Step 3 final request received",
    detail: { aspectRatio, cancelKey, imagePaths, variant, prompt: finalPrompt },
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
