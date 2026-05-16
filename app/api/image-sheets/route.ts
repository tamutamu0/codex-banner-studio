import path from "node:path";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { cropSheet, gridForCount } from "@/app/lib/crop";
import { generatedDir, makeId, type ProductInput, type Variant } from "@/app/lib/files";
import { generateImagesWithCodex } from "@/app/lib/codex-image";
import { appendRequestLog } from "@/app/lib/request-log";

type ImageCreateMode = "reuse" | "edit";

type AnalysisItem = {
  id: string;
  category: string;
  item: string;
  content: string;
  originalContent?: string;
  locked?: boolean;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

type Body = {
  input: ProductInput;
  sourceImageUrl: string;
  sourceFileName?: string;
  sourceMeta?: {
    generationPrompt?: string;
    editInstruction?: string;
    aspectRatio?: string;
  };
  createMode: ImageCreateMode;
  analysisSummary?: string;
  analysisItems?: AnalysisItem[];
  aspectRatio?: string;
  startIndex?: number;
  divisions?: number;
  sheetRuns?: number;
  cancelKey?: string;
  codexSettings?: {
    model?: string;
    effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
    serviceTier?: "fast" | "auto";
  };
};

function resolvePublicImagePath(imageUrl: string) {
  if (!imageUrl.startsWith("/")) throw new Error("ローカル画像URLだけ対応しています");
  const publicRoot = path.resolve(process.cwd(), "public");
  const target = path.resolve(publicRoot, imageUrl.replace(/^\//, ""));
  if (!target.startsWith(publicRoot + path.sep)) throw new Error("画像パスが不正です");
  return target;
}

function aspectRatioLabel(value?: string) {
  const [width, height] = (value || "1024x1024").split("x").map((item) => Number(item));
  if (!width || !height) return value || "1:1";
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function boundsText(bounds?: AnalysisItem["bounds"]) {
  if (!bounds) return "";
  return `位置目安 x=${Math.round(bounds.x * 100)}%, y=${Math.round(bounds.y * 100)}%, w=${Math.round(bounds.width * 100)}%, h=${Math.round(bounds.height * 100)}%`;
}

function itemLine(item: AnalysisItem, index: number) {
  const original = (item.originalContent || item.content || "").trim();
  const current = (item.content || "").trim();
  const changed = original !== current;
  return `${index + 1}. [${item.category}] ${item.item}
   ${boundsText(item.bounds)}
   元: ${original || "記載なし"}
   ${changed ? `変更後: ${current || "記載なし"}` : `内容: ${current || "記載なし"}`}`;
}

function modeInstruction(mode: ImageCreateMode, selectedItems: AnalysisItem[], unselectedItems: AnalysisItem[]) {
  if (mode === "reuse") {
    return `
モード: 構成流用
- 添付画像1枚目は参考元バナーです。完全な複製や部分修正ではなく、下の「引き継ぐ構成要素」を使って、新しい別バリエーションを生成してください。
- 元画像の勝ち筋、情報設計、配置の考え方は借りるが、各候補は見た目・コピー・演出に違いを出す。
- チェックされていない要素は強く引き継がない。必要なら自然に省略・弱める。
- 参照画像の細部をそのままトレースせず、広告として成立する新案にする。

引き継ぐ構成要素:
${selectedItems.map(itemLine).join("\n\n")}

優先しない構成要素:
${unselectedItems.length ? unselectedItems.map((item, index) => `${index + 1}. [${item.category}] ${item.item}`).join("\n") : "なし"}
    `.trim();
  }

  return `
モード: 画像編集
- 添付画像1枚目の元画像をベースに、下の「変更する項目」だけを自然に編集してください。
- チェックされていない項目は、構図、商品位置、背景、価格欄、配色、質感、文字量をできるだけ維持する。
- 「元」と「変更後」が違う項目は、変更後を優先する。違いがない項目は、ユーザーが変更対象として選んだ箇所なので自然に整える。
- 元画像にない商品事実・効能・ブランド情報を勝手に追加しない。

変更する項目:
${selectedItems.map(itemLine).join("\n\n")}

維持する項目:
${unselectedItems.length ? unselectedItems.map((item, index) => `${index + 1}. [${item.category}] ${item.item}: ${(item.originalContent || item.content || "").trim() || "記載なし"}`).join("\n") : "なし"}
  `.trim();
}

function variantFor(mode: ImageCreateMode, startIndex: number, index: number, selectedItems: AnalysisItem[]): Variant {
  const labelIndex = startIndex + index;
  const itemNames = selectedItems.slice(0, 4).map((item) => item.item).join("、");
  return {
    index: index + 1,
    globalIndex: index + 1,
    appeal: mode === "reuse" ? `構成流用 ${labelIndex}` : `画像編集 ${labelIndex}`,
    prompt: mode === "reuse"
      ? `チェックした構成要素（${itemNames || "構成分析"}）を使った別バリエーション`
      : `チェックした項目（${itemNames || "変更対象"}）だけを編集した案`,
    priceTreatment: "without_price",
  };
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const {
    input,
    sourceImageUrl,
    sourceFileName = "",
    sourceMeta = {},
    createMode,
    analysisSummary = "",
    analysisItems = [],
    aspectRatio = "1024x1024",
    startIndex = 1,
    divisions = 4,
    sheetRuns = 1,
    cancelKey,
    codexSettings,
  } = (await request.json()) as Body;
  const jobId = `image-sheets-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const count = Math.min(Math.max(Number(divisions) || 4, 1), 9);
  const runCount = Math.min(Math.max(Number(sheetRuns) || 1, 1), 6);
  const selectedItems = analysisItems.filter((item) => item.locked);
  const unselectedItems = analysisItems.filter((item) => !item.locked);
  if (!selectedItems.length) {
    return NextResponse.json({ message: createMode === "reuse" ? "引き継ぐ項目を選んでください" : "変更する項目を選んでください" }, { status: 400 });
  }
  const sourceImagePath = resolvePublicImagePath(sourceImageUrl);
  const productImagePaths = input.productImages?.map((image) => image.path).filter(Boolean) || (input.productImagePath ? [input.productImagePath] : []);
  const { columns, rows } = gridForCount(count);
  const totalCandidates = count * runCount;
  const variants = Array.from({ length: totalCandidates }, (_, index) => variantFor(createMode, startIndex, index, selectedItems));
  const sheetBlocks = Array.from({ length: runCount }, (_, runOffset) => {
    const runIndex = runOffset + 1;
    const selected = variants.slice(runOffset * count, runOffset * count + count);
    return `シート${runIndex}:\n${selected.map((variant, index) => `${index + 1}. ${variant.prompt}`).join("\n")}`;
  }).join("\n\n");
  const prompt = `
あなたはWEB広告バナーを作るプロのアートディレクターです。
添付画像1枚目のバナーと構成分析をもとに、広告バナー候補を生成してください。

出力形式:
- PNG画像を必ず${runCount}枚、別々の画像として生成する。
- 各PNG画像は ${columns}列 × ${rows}行 の均等グリッドにし、合計${count}候補を入れる。
- 各セルは ${aspectRatioLabel(aspectRatio)} の単体バナーとして成立する見た目にする。
- セル境界と外枠には細い黒線を入れる。セルをまたいだ文字・商品・背景は禁止。
- 合計で ${count}分割 × ${runCount}枚 = ${totalCandidates} 候補を作る。
- 最終出力は画像だけ。説明文だけで終わらない。

品質:
- プロデザイナーが作ったような、情報設計、余白、可読性、質感のあるWEB広告にする。
- スマホでも読める文字サイズにする。小さすぎる文字や意味不明な文字を入れない。
- 商品と無関係な効能、成分、ブランド事実を勝手に作らない。
- 元画像内の赤い番号、UI、選択枠、注釈表示などがあっても最終画像には入れない。

${modeInstruction(createMode, selectedItems, unselectedItems)}

構成分析サマリー:
${analysisSummary || "なし"}

元画像メタ:
- ファイル名: ${sourceFileName || "不明"}
- 元比率: ${sourceMeta.aspectRatio || "不明"}
- 元の生成/スタイル情報: ${sourceMeta.generationPrompt || "なし"}
- 元の修正指示: ${sourceMeta.editInstruction || "なし"}

商品情報:
- ブランド: ${input.brandName || "不明"}
- 商品名: ${input.productName || "不明"}
- 価格情報: ${input.priceInfo || "なし"}
- 商品メモ: ${input.notes || "なし"}

作成する候補:
${sheetBlocks}
  `.trim();

  await appendRequestLog({
    jobId,
    step: "api-image-sheets",
    status: "start",
    message: "Image mode sheet request received",
    detail: { createMode, aspectRatio, count, runCount, sourceImageUrl, sourceImagePath, productImagePaths, selectedItems, unselectedItems, prompt },
  });

  try {
    const generated = await generateImagesWithCodex(prompt, {
      prefix: "image-sheet",
      images: [sourceImagePath, ...productImagePaths],
      timeoutMs: 600_000,
      cancelKey,
      model: codexSettings?.model,
      effort: codexSettings?.effort,
      serviceTier: codexSettings?.serviceTier,
    });
    const sheets = [];
    for (const [index, image] of generated.images.slice(0, runCount).entries()) {
      const runIndex = index + 1;
      const id = makeId(`image-sheet-${runIndex}`);
      const buffer = await readFile(image.imagePath);
      const crops = await cropSheet(buffer, id, count);
      const selected = variants.slice((runIndex - 1) * count, runIndex * count).map((variant, variantIndex) => ({
        ...variant,
        index: variantIndex + 1,
        sheetRun: runIndex,
        cropUrl: crops.find((crop) => crop.index === variantIndex + 1)?.cropUrl,
      }));
      sheets.push({
        id,
        runIndex,
        mode: "codex",
        sheetUrl: image.imageUrl,
        variants: selected,
        revisedPrompt: image.revisedPrompt,
        cropCount: crops.length,
      });
    }
    await appendRequestLog({
      jobId,
      step: "api-image-sheets",
      status: "success",
      message: "Image mode sheets completed",
      durationMs: Date.now() - startedAt,
      detail: { requestedSheets: runCount, returnedImages: generated.images.length, sheets },
    });
    return NextResponse.json({
      mode: "codex",
      sheets,
      debug: {
        step: "image-sheets",
        durationMs: Date.now() - startedAt,
        requestedSheets: runCount,
        returnedImages: generated.images.length,
        events: generated.events,
        jobId,
        codexJobId: generated.jobId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendRequestLog({
      jobId,
      step: "api-image-sheets",
      status: "error",
      message,
      durationMs: Date.now() - startedAt,
      detail: { createMode, aspectRatio, sourceImageUrl, prompt },
    });
    return NextResponse.json({ mode: "error", message, debug: { step: "image-sheets", durationMs: Date.now() - startedAt, jobId } }, { status: 500 });
  }
}
