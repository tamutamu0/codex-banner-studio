import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { cropSheet } from "@/app/lib/crop";
import { makeId, type ProductInput, type Variant } from "@/app/lib/files";
import { generateImageWithCodex } from "@/app/lib/codex-image";
import { appendRequestLog } from "@/app/lib/request-log";

type Body = {
  input: ProductInput;
  variants: Variant[];
  divisions?: number;
  runIndex?: number;
};

export async function POST(request: Request) {
  const startedAt = Date.now();
  const { input, variants, divisions = 4, runIndex = 1 } = (await request.json()) as Body;
  const count = Math.min(Math.max(Number(divisions) || 4, 1), 9);
  const selected = variants.slice(0, count).map((variant, index) => ({ ...variant, index: index + 1 }));
  const id = makeId("sheet");
  const jobId = `sheet-${runIndex}-${id}`;

  const sheetPrompt = `
${input.brandName ? `${input.brandName} ` : ""}${input.productName}を検索し、調べた内容と添付した商品画像を参考にして、ハイクオリティの広告バナー画像を生成して。
生成時にも改めて商品名・ブランド名・商品カテゴリを検索/確認し、商品特徴・価格・画像説明と矛盾しない広告表現にする。
上質、ブランド感、大人向け。プロのWEB広告デザイナーが作成したような完成度に仕上げて。
普通の美容広告、無難な商品紹介、清潔感だけの広告にはしない。競争の激しいWEB広告の中で埋もれず、スクロールを止める強い表現にする。
比率は全パターン1:1で、${count}パターン作成し、上下左右に並べて1枚にする。
それぞれデザイン・構図・訴求・見た目・画像テイストを大きく変えて差別化すること。
作成するバナーの種類は以下のリストに従う。
ただし、商品メモ・追加指示に具体的な手動プロンプトがある場合は、その内容を最優先し、手動プロンプトのネタ・口調・価格表示指定・構図指定を弱めずに反映する。
リストは完成プロンプトではなくラフな方向性。「黒板チョーク」「TVで紹介されている風」「新聞/雑誌風」「漫画風」のようなテイスト指定だけの案では、商品調査からその商品に合う訴求を画像生成時に自分で決める。

${selected.map((variant) => `${variant.index}. 訴求案: ${variant.appeal || "自由案"}
   テイスト/構図: ${variant.prompt}
   価格表示: ${variant.priceTreatment === "with_price" ? `あり。「${input.productName}」と「${input.priceInfo || ""}」を見やすく入れる。` : "なし。ただし商品メモ・追加指示で全パターンに価格表示と明示されている場合は、その指示を優先して価格を入れる。"}`).join("\n")}

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

重要:
- 商品メモ・追加指示に手動プロンプトが書かれている場合、その原文の勢いを最優先する。
- 「たらこ」「7つ集めると願いが叶うカプセル」のような具体的なネタは、一般的な美容広告表現に丸めない。
- ユーザーが「全てのパターンには商品名と価格を入れる」と書いている場合、価格表示なし設定よりその指示を優先する。
- 画像2などの参照指定がある場合、下の画像説明の番号に従って解釈する。

価格情報:
${input.priceInfo || "なし"}

禁止事項:
- ${count}個の各案は、必ず別々のセルとして分ける。
- セルの境界が分かるように、各パターンをきれいに分割して並べる。
- UI、透かし、余計なロゴ、意味不明な文字は入れない。
- 小さすぎて読めない文字を入れない。
- 無難で量産型の美容広告にしない。
- 商品と無関係な派手ワードを足して、別商品に見える広告にしない。
- 全セルが同じ色味、構図、写真調にならないようにする。
- 価格表示なしの案には価格文言を入れない。
- 価格表示ありの案では、商品名と価格以外の余計な広告コピーを増やしすぎない。

最終出力は、${count}パターンが1枚にまとまったPNG画像だけにする。
  `.trim();

  const imagePaths = input.productImages?.length ? input.productImages.map((image) => image.path) : input.productImagePath ? [input.productImagePath] : [];
  await appendRequestLog({
    jobId,
    step: "api-sheet",
    status: "start",
    message: `Step 2 sheet ${runIndex} request received`,
    detail: { id, runIndex, count, imagePaths, selected, prompt: sheetPrompt },
  });

  try {
    const generated = await generateImageWithCodex(sheetPrompt, {
      prefix: "sheet",
      images: imagePaths,
    });
    await appendRequestLog({
      jobId,
      step: "api-sheet",
      status: "progress",
      message: `Step 2 sheet ${runIndex} image generated`,
      durationMs: Date.now() - startedAt,
      detail: { sheetUrl: generated.imageUrl, imagePath: generated.imagePath, codexJobId: generated.jobId, events: generated.events, revisedPrompt: generated.revisedPrompt },
    });
    const buffer = await readFile(generated.imagePath);
    const crops = await cropSheet(buffer, id, count);
    const sheetUrl = generated.imageUrl;
    const enriched = selected.map((variant) => ({
      ...variant,
      sheetRun: runIndex,
      globalIndex: (runIndex - 1) * count + variant.index,
      cropUrl: crops.find((crop) => crop.index === variant.index)?.cropUrl,
    }));

    await appendRequestLog({
      jobId,
      step: "api-sheet",
      status: "success",
      message: `Step 2 sheet ${runIndex} completed`,
      durationMs: Date.now() - startedAt,
      detail: { sheetUrl, cropCount: crops.length, crops, variants: enriched },
    });

    return NextResponse.json({
      id,
      mode: "codex",
      sheetUrl,
      variants: enriched,
      debug: {
        step: `sheet-${runIndex}`,
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
      step: "api-sheet",
      status: "error",
      message,
      durationMs: Date.now() - startedAt,
      detail: { id, runIndex, count, imagePaths, selected, prompt: sheetPrompt },
    });
    return NextResponse.json(
      {
        id,
        mode: "error",
        message,
        debug: {
          step: `sheet-${runIndex}`,
          durationMs: Date.now() - startedAt,
          jobId,
        },
      },
      { status: 500 },
    );
  }
}
