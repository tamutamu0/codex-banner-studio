import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { cropSheet } from "@/app/lib/crop";
import { makeId, type ProductInput, type Variant } from "@/app/lib/files";
import { generateImagesWithCodex } from "@/app/lib/codex-image";
import { appendRequestLog } from "@/app/lib/request-log";

type Body = {
  input: ProductInput;
  variants: Variant[];
  divisions?: number;
  sheetRuns?: number;
  cancelKey?: string;
  codexSettings?: {
    model?: string;
    effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
    serviceTier?: "fast" | "auto" | "flex";
  };
};

function sheetBlock(variants: Variant[], input: ProductInput, divisions: number, runIndex: number) {
  const selected = variants.slice((runIndex - 1) * divisions, runIndex * divisions).map((variant, index) => ({ ...variant, index: index + 1 }));
  return `
シート${runIndex}:
${selected.map((variant) => `${variant.index}. 訴求案: ${variant.appeal || "自由案"}
   テイスト/構図: ${variant.prompt}
   価格表示: ${variant.priceTreatment === "with_price" ? `あり。「${input.productName}」と「${input.priceInfo || ""}」を見やすく入れる。` : "なし。ただし商品メモ・追加指示で全パターンに価格表示と明示されている場合は、その指示を優先して価格を入れる。"}`).join("\n")}
  `.trim();
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const { input, variants, divisions = 4, sheetRuns = 1, cancelKey, codexSettings } = (await request.json()) as Body;
  const count = Math.min(Math.max(Number(divisions) || 4, 1), 9);
  const runCount = Math.min(Math.max(Number(sheetRuns) || 1, 1), 6);
  const jobId = `sheets-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const imagePaths = input.productImages?.length ? input.productImages.map((image) => image.path) : input.productImagePath ? [input.productImagePath] : [];

  const prompt = `
あなたはプロのWEB広告のディレクター・デザイナーです。
${input.brandName ? `${input.brandName} ` : ""}${input.productName}を検索し、調べた内容と添付した商品画像を参考にして、ハイクオリティのWEB広告バナーを、合計${runCount}枚のPNG画像として生成してください。
各PNG画像は「${count}パターンを上下左右に並べた1枚の分割シート」です。
各セルは完全に均等なグリッドにし、セル境界と外枠には細い黒線を入れてください。
合計で ${count}分割 × ${runCount}枚 = ${count * runCount} 候補を作成してください。
それぞれデザイン・構図・訴求を大きく変えて差別化すること。

超秀逸でCTRとCVR最大化するようなバナーに仕上げること。
今の時代でこの商材ジャンルの市場で埋もれない勝ちバナーにすること。
上質、ブランド感、大人向け。
AIっぽさを無くして、人間の凄腕広告クリエイターが作ったような自然な違和感、余白、質感、情報設計、コピーの強さにすること。
プロデザイナーが作成したクオリティに仕上げて。

重要:
- PNG画像を必ず${runCount}枚、別々の画像として生成する。
- 1枚に${count * runCount}候補を全部詰め込まない。必ず「${count}分割シート」を${runCount}枚作る。
- 各シートは下のシート別リストだけに対応する。
- 最終出力は画像だけ。説明文だけで終わらない。

普通の美容広告、無難な商品紹介、清潔感だけの広告にはしない。競争の激しいWEB広告の中で埋もれず、スクロールを止める強い表現にする。
それぞれデザイン・構図・訴求・見た目・画像テイストを大きく変えて差別化すること。
ただし、商品メモ・追加指示に具体的な手動プロンプトがある場合は、その内容を最優先し、手動プロンプトのネタ・口調・価格表示指定・構図指定を弱めずに反映する。

案リストの扱い:
- 下のリストは完成プロンプトではなく、ラフな方向性として使う。
- 「黒板チョーク」「TVで紹介されている風」「新聞/雑誌風」「漫画風」のようなテイスト指定だけの案では、商品調査からその商品に合う訴求を画像生成時に自分で決める。
- 具体的な商品特徴やネタが書かれている案だけ、その訴求を優先する。
- 全セルを細かいコピー指定で固めすぎず、商品に合った自然な広告表現に仕上げる。

作成するバナーの種類:
${Array.from({ length: runCount }, (_, index) => sheetBlock(variants, input, count, index + 1)).join("\n\n")}

特にクオリティ高く、秀逸な作品に仕上げること。
CTRが上がるような、目に止まるバナーにすること。
商品特徴、成分、テクスチャー、見た目、価格、悩みのどれかを起点に、強い違和感やフックを入れる。ただし商品と関係ない飛躍はしない。
WEB広告なので文字は小さくしすぎず、入れる場合はスマホでも一瞬で読める大きさと強さにする。
各セルの画像テイストは大きく散らす。写真、コラージュ、ミーム風、ポップ、ラグジュアリー、科学/成分、マクロ質感、漫画的ツッコミなど、案に応じて大胆に変える。
商品の配置角度は自由。商品画像を参考にしつつ、各案の内容に応じて自由に加工して構わない。
添付した商品画像は、各画像の内容に応じて使う/使わないを自由に判断してよい。

商品接地ルール:
- すべての広告表現は、商品名・商品画像・画像説明・商品メモ・検索で確認できた情報に接地する。
- 未確認の成分、効能、商品カテゴリ、素材、色、別商品の特徴を勝手に作らない。
- 「金の泥パック」「クレイパック」「金箔美容」「泥洗顔」など、商品と無関係な別カテゴリの訴求は禁止。商品調査で明確に関係が確認できる場合だけ使える。
- 攻めるのは表現、構図、見せ方、比喩であって、商品事実を捏造しない。

商品画像の説明:
${input.productImages?.map((image, index) => `画像${index + 1}: ${image.description}`).join("\n") || "なし"}

商品メモ・追加指示:
${input.notes || "なし。商品やカテゴリを調べて、強い広告表現を自動で考える。"}

価格情報:
${input.priceInfo || "なし"}

禁止事項:
- シート内の各案は、必ず別々のセルとして分ける。
- セルをまたぐ文字・商品・背景表現は禁止。
- UI、透かし、余計なロゴ、意味不明な文字は入れない。
- 小さすぎて読めない文字を入れない。
- 無難で量産型の美容広告にしない。
- 商品と無関係な派手ワードを足して、別商品に見える広告にしない。
- 全セルが同じ色味、構図、写真調にならないようにする。
- 価格表示なしの案には価格文言を入れない。
- 価格表示ありの案では、商品名と価格以外の余計な広告コピーを増やしすぎない。
  `.trim();

  await appendRequestLog({
    jobId,
    step: "api-sheets",
    status: "start",
    message: "Step 2 multi-sheet request received",
    detail: { count, sheetRuns: runCount, totalCandidates: count * runCount, cancelKey, imagePaths, variants, prompt },
  });

  try {
    const generated = await generateImagesWithCodex(prompt, {
      prefix: "sheet",
      images: imagePaths,
      timeoutMs: 600_000,
      cancelKey,
      model: codexSettings?.model,
      effort: codexSettings?.effort,
      serviceTier: codexSettings?.serviceTier,
    });

    const sheets = [];
    for (const [index, image] of generated.images.slice(0, runCount).entries()) {
      const runIndex = index + 1;
      const id = makeId(`sheet-${runIndex}`);
      const buffer = await readFile(image.imagePath);
      const crops = await cropSheet(buffer, id, count);
      const selected = variants.slice((runIndex - 1) * count, runIndex * count).map((variant, variantIndex) => ({
        ...variant,
        index: variantIndex + 1,
        sheetRun: runIndex,
        globalIndex: (runIndex - 1) * count + variantIndex + 1,
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
      step: "api-sheets",
      status: "success",
      message: "Step 2 multi-sheet completed",
      durationMs: Date.now() - startedAt,
      detail: { requestedSheets: runCount, returnedImages: generated.images.length, sheets },
    });

    return NextResponse.json({
      mode: "codex",
      sheets,
      debug: {
        step: "sheets",
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
      step: "api-sheets",
      status: "error",
      message,
      durationMs: Date.now() - startedAt,
      detail: { count, sheetRuns: runCount, imagePaths, variants, prompt },
    });
    return NextResponse.json({ mode: "error", message, debug: { step: "sheets", durationMs: Date.now() - startedAt, jobId } }, { status: 500 });
  }
}
