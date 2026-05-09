import { NextResponse } from "next/server";
import type { ProductInput, Variant } from "@/app/lib/files";
import { parseCodexJson, runCodexTurn } from "@/app/lib/codex-app-server";
import { appendRequestLog } from "@/app/lib/request-log";
import { DEFAULT_PROMPT_PRESETS, renderPromptTemplate, type PromptTemplateMap } from "@/app/lib/prompt-presets";

const angles = [
  "黒板チョークで書いた手書きテイスト。訴求は商品調査から自然に決める",
  "TVで紹介されている風。あくまで風と分かる演出で、商品名と価格を強く見せる",
  "新聞・雑誌で紹介されている風。あくまで風と分かる紙面デザイン",
  "漫画風。デフォルメされた30代の人物と商品を絡める",
  "商品の見た目やテクスチャーを活かした誤認ネタ。ただし実物特徴に接地する",
  "価格や初回オファーを大きく見せるWEB広告らしい即反応訴求",
  "上質でブランド感ある商品メイン。大人向けの完成度で見せる",
  "マクロ/質感/成分ビジュアルをド派手に見せる。ただし未確認成分は出さない",
];

function freeVariant(index: number, input: ProductInput): Variant {
  const priceTreatment = input.priceInfo && input.priceMode === "all"
    ? "with_price"
    : input.priceInfo && input.priceMode === "mixed"
      ? "with_price"
      : "without_price";
  const priceInstruction = priceTreatment === "with_price" ? `価格「${input.priceInfo}」も見せる前提。` : "価格文言なしでもよい。";
  return {
    index,
    appeal: "自由枠: 別角度のぶっ飛んだ勝ちバナー",
    priceTreatment,
    prompt: `その他は自由に考えて別の角度でぶっ飛んだやつ。${priceInstruction}商品調査と商品画像から外れず、この商材ジャンルで埋もれない独創的な表現を自由に考える。訴求内容を細かく指定しすぎず、プロのWEB広告ディレクター/デザイナーとしてCTRとCVRを最大化する勝ちバナーにする。`,
  };
}

function straightVariant(index: number, input: ProductInput): Variant {
  const priceTreatment = input.priceInfo && input.priceMode === "all"
    ? "with_price"
    : "without_price";
  const priceInstruction = priceTreatment === "with_price" ? `価格「${input.priceInfo}」も見せる前提。` : "価格文言なしでもよい。";
  return {
    index,
    appeal: "直球: 商品特徴を押さえた王道の勝ちバナー",
    priceTreatment,
    prompt: `直球の商品特徴訴求。細かい案指定はしない。${priceInstruction}商品名、商品画像、商品説明、検索で分かる特徴を画像生成時に整理し、この商品の魅力が一瞬で伝わる王道のWEB広告バナーにする。無難にしすぎず、プロの広告デザイナーとして品質高く仕上げる。`,
  };
}

function ensureRequiredVariants(variants: Variant[], input: ProductInput) {
  if (!variants.length) return variants;
  const next = variants.slice();
  if (next.length > 1) next[0] = straightVariant(1, input);
  next[next.length - 1] = freeVariant(next.length, input);
  return next;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const input = (await request.json()) as ProductInput & { count?: number; divisions?: number; sheetRuns?: number; cancelKey?: string; promptTemplates?: PromptTemplateMap };
  const count = Math.min(Math.max(Number(input.count || 8), 1), 120);
  const jobId = `ideas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let fallbackReason = "";
  const customPrompt = input.promptTemplates?.ideas
    ? renderPromptTemplate(input.promptTemplates.ideas, {
      count,
      priceInfo: input.priceInfo || "none",
      priceMode: input.priceMode || "none",
      productInputJson: JSON.stringify(input, null, 2),
    })
    : "";
  const defaultPromptTemplate = DEFAULT_PROMPT_PRESETS.find((preset) => preset.id === "default-ideas")?.template || "";
  const defaultPrompt = renderPromptTemplate(defaultPromptTemplate, {
    count,
    priceInfo: input.priceInfo || "none",
    priceMode: input.priceMode || "none",
    productInputJson: JSON.stringify(input, null, 2),
  });

  await appendRequestLog({
    jobId,
    step: "api-ideas",
    status: "start",
    message: "Step 1 ideas request received",
    detail: { count, divisions: input.divisions, sheetRuns: input.sheetRuns, cancelKey: input.cancelKey, input },
  });

  try {
    const text = await runCodexTurn({
      jobId,
      logLabel: "ideas",
      cancelKey: input.cancelKey,
      prompt: customPrompt || defaultPrompt || `
あなたはWEB広告バナーのラフ案を考えるプロの広告ディレクターです。
Return JSON only. No markdown, no explanation.
Schema:
{
  "variants": [
    { "index": 1, "appeal": "短い日本語の訴求案", "priceTreatment": "with_price or without_price", "prompt": "日本語のバナーテイスト案。細かすぎず、だいたい絵が分かる粒度" }
  ]
}

やること:
1. 商品名・ブランド名・商品画像説明・メモをもとに、必要なら商品やカテゴリについて検索/調査/推測する。
2. 調べた内容から、WEB広告バナー案をちょうど ${count} 個作る。
3. 各案は「訴求案」と「バナーのテイスト/構図のざっくり指定」を日本語で書く。

考え方:
- 全案を細かい訴求指定にしすぎない。
- 「黒板チョーク」「TV紹介風」「新聞/雑誌風」「漫画風」のように、表現テイストだけを強く指定し、訴求は画像生成時に商品調査から自然に決める案も混ぜる。
- 具体的な商品特徴や面白い見た目がある場合だけ、それを訴求フックとして指定する。
- 目安として、半分くらいはテイスト主導、半分くらいは商品特徴/価格/悩み主導にする。
- ${count}個すべてを細かい案で埋めなくてよい。生成案数が1以上なら、少なくとも1つは「その他は自由に考えて別の角度でぶっ飛んだやつ」という自由枠にする。
- 自由枠は、訴求内容を下手に指定しすぎず、商品調査と商品画像から外れない範囲で、モデル自身に別角度の勝ちバナーを考えさせる余白にする。
- 複数案の場合、少なくとも1つは「直球の商品特徴訴求」にする。ここは案を細かく指定せず、画像生成時に商品特徴を整理して王道の勝ちバナーを考えさせる。

標準トーン:
- 上質、ブランド感、大人向け。
- 普通、無難、清潔感だけ、よくある美容広告、商品を置いただけの案にはしない。
- 商品特徴、成分、テクスチャー、見た目、価格、悩みのどれかを起点に、目に止まるフックを作る。ただし商品と関係ない飛躍はしない。
- WEB広告なので、文字を使う案では小さすぎる文字に頼らず、ひと目で読める大きなコピーを想定する。
- ${count} 個の案は、写真、コラージュ、ミーム風、ポップ、ラグジュアリー、科学/成分、マクロ質感、漫画的ツッコミなど、画像テイストも大きく散らす。
- 人物/モデル訴求は一部だけ。人物だらけにせず、商品・質感・テイスト主導の案とバランスを取る。

商品接地ルール:
- すべての案は、商品名・商品画像・画像説明・商品メモ・検索で確認できた情報に接地する。
- 未確認の成分、効能、商品カテゴリ、素材、色、別商品の特徴を勝手に作らない。
- 「金の泥パック」「クレイパック」「金箔美容」「泥洗顔」など、商品と無関係な別カテゴリの訴求は禁止。商品調査で明確に関係が確認できる場合だけ使える。
- 攻めるのは表現、構図、見せ方、比喩であって、商品事実を捏造しない。

ユーザー指示の扱い:
- Product input の notes に具体的な手動プロンプトや作りたい案が書かれている場合、それを最優先する。
- 手動プロンプト内に「1つは...」「もう1つは...」「その他は...」のような案がある場合、その案を必ず先頭から variants に採用する。
- 面白い比喩、違和感、口調、ぶっ飛んだ方向性は弱めずに残す。
- 手動プロンプトに書かれた価格表示・全パターンへの表示指定は、priceMode より優先して解釈する。
- 手動プロンプトの案数が足りない場合だけ、不足分を追加で考える。

粒度:
- 手動でバナー作成を依頼するときのラフ指示くらいでよい。
- 細かいライティング、背景、小物、構図を長々と指定しすぎない。
- 「レチノールカプセルを面白く見せる」「たらこっぽい見た目をフックにする」「高級感ある商品メイン」くらい、だいたい絵が分かる粒度でよい。
- 「黒板チョークで書いた手書きテイスト」「TVで紹介されている風」「新聞・雑誌で紹介されている風」「漫画風」くらいのテイスト指定だけの案も歓迎する。
- ただし ${count} 個の案は、訴求・構図・テイストができるだけ被らないようにする。
- 目を止めるWEB広告らしい、CTRが上がりそうな強い案を中心にする。

価格ルール:
- priceInfo: ${input.priceInfo || "none"}
- priceMode: ${input.priceMode || "none"}
- priceMode が "mixed" なら with_price と without_price をバランスよく混ぜる。
- priceMode が "all" ならすべて with_price。
- priceMode が "none" または priceInfo が空ならすべて without_price。
- with_price の案は、価格文言を入れる前提の案にする。
- without_price の案は、価格文言や広告コピーに頼らない案にする。

注意:
- 質問せずに作る。
- prompt は画像生成の完成プロンプトではなく、日本語のラフなバナー案でよい。
- ユーザーが明示したネタや言い回しを、一般的な美容広告に丸めない。
- 商品パッケージの実在テキストは、商品画像に自然に写る範囲なら許可。
- 商品と無関係な派手ワードを足して、別商品に見える案にしない。

Product input:
${JSON.stringify(input, null, 2)}
      `.trim(),
    });
    const parsed = parseCodexJson<{ variants: Variant[] }>(text);
    const variants = ensureRequiredVariants(parsed.variants.slice(0, count).map((variant: Variant & { appeal?: string }, index) => ({
      index: index + 1,
      appeal: String(variant.appeal || "").trim(),
      priceTreatment: input.priceInfo && input.priceMode !== "none"
        ? variant.priceTreatment === "with_price" ? "with_price" : "without_price"
        : "without_price",
      prompt: String(variant.prompt || "").trim(),
    })), input);
    if (variants.length >= count && variants.every((variant) => variant.prompt)) {
      await appendRequestLog({
        jobId,
        step: "api-ideas",
        status: "success",
        message: "Step 1 ideas completed",
        durationMs: Date.now() - startedAt,
        detail: { mode: "codex", variantCount: variants.length, variants },
      });
      return NextResponse.json({
        variants,
        mode: "codex",
        debug: { step: "ideas", durationMs: Date.now() - startedAt, jobId },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fallbackReason = message;
    console.warn("Codex App Server ideas failed, falling back locally:", message);
  }

  const variants: Variant[] = ensureRequiredVariants(Array.from({ length: count }, (_, index) => {
    const angle = angles[index % angles.length];
    const mood = input.mood ? `, ${input.mood} mood` : "";
    const priceTreatment = input.priceInfo && input.priceMode === "all"
      ? "with_price"
      : input.priceInfo && input.priceMode === "mixed" && index % 2 === 0
        ? "with_price"
        : "without_price";
    const priceInstruction = priceTreatment === "with_price" ? `。価格「${input.priceInfo}」も見せる前提` : "。価格文言なしで絵だけで引きつける";
    return {
      index: index + 1,
      appeal: angle,
      priceTreatment,
      prompt: `${angle}${mood ? `。${mood}` : ""}${priceInstruction}`,
    };
  }), input);

  await appendRequestLog({
    jobId,
    step: "api-ideas",
    status: fallbackReason ? "error" : "success",
    message: fallbackReason ? "Step 1 fell back to local ideas" : "Step 1 local ideas completed",
    durationMs: Date.now() - startedAt,
    detail: { fallbackReason, variantCount: variants.length, variants },
  });

  return NextResponse.json({
    variants,
    mode: "local-fallback",
    debug: { step: "ideas", durationMs: Date.now() - startedAt, fallbackReason, jobId },
  });
}
