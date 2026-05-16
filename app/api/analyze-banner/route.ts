import path from "node:path";
import { NextResponse } from "next/server";
import { parseCodexJson, runCodexTurn } from "@/app/lib/codex-app-server";
import { appendRequestLog } from "@/app/lib/request-log";

type Body = {
  imageUrl: string;
  fileName?: string;
  meta?: {
    generationPrompt?: string;
    editInstruction?: string;
    aspectRatio?: string;
  };
  codexSettings?: {
    model?: string;
    effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
    serviceTier?: "fast" | "auto";
  };
};

type AnalysisItem = {
  id?: string;
  category?: string;
  item?: string;
  content?: string;
  bounds?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  } | null;
  locked?: boolean;
};

type AnalysisResponse = {
  summary?: string;
  items?: AnalysisItem[];
};

type NormalizedAnalysisItem = Required<Pick<AnalysisItem, "id" | "category" | "item" | "content" | "locked">> & {
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

function resolveImagePath(imageUrl: string) {
  if (!imageUrl.startsWith("/")) throw new Error("ローカル画像URLだけ対応しています");
  return path.join(process.cwd(), "public", imageUrl.replace(/^\//, ""));
}

function clamp01(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

function normalizeBounds(bounds: AnalysisItem["bounds"]) {
  if (!bounds) return undefined;
  const x = clamp01(bounds.x);
  const y = clamp01(bounds.y);
  const width = Math.min(1 - x, Math.max(0.02, clamp01(bounds.width)));
  const height = Math.min(1 - y, Math.max(0.02, clamp01(bounds.height)));
  return { x, y, width, height };
}

function isPriceLike(item: Pick<NormalizedAnalysisItem, "category" | "item" | "content">) {
  return [item.category, item.item, item.content].some((value) => /価格|値段|税込|税抜|円|¥|￥|オファー|割引|初回|定期|送料無料/.test(value || ""));
}

function hasPriceOverview(items: NormalizedAnalysisItem[]) {
  return items.some((item) => item.category === "価格" && /価格欄|価格枠|価格オファー|価格エリア/.test(item.item));
}

function unionBounds(items: NormalizedAnalysisItem[]) {
  const bounded = items.map((item) => item.bounds).filter(Boolean) as NonNullable<NormalizedAnalysisItem["bounds"]>[];
  if (!bounded.length) return undefined;
  const left = Math.min(...bounded.map((bounds) => bounds.x));
  const top = Math.min(...bounded.map((bounds) => bounds.y));
  const right = Math.max(...bounded.map((bounds) => bounds.x + bounds.width));
  const bottom = Math.max(...bounded.map((bounds) => bounds.y + bounds.height));
  return {
    x: clamp01(left),
    y: clamp01(top),
    width: Math.max(0.02, Math.min(1 - left, right - left)),
    height: Math.max(0.02, Math.min(1 - top, bottom - top)),
  };
}

function ensurePriceOverview(items: NormalizedAnalysisItem[]) {
  if (hasPriceOverview(items)) return items;
  const priceItems = items.filter(isPriceLike);
  if (!priceItems.length) return items;
  const priceTexts = priceItems
    .map((item) => item.content.trim())
    .filter(Boolean)
    .slice(0, 4);
  const overview: NormalizedAnalysisItem = {
    id: "price-area",
    category: "価格",
    item: "価格欄",
    content: `価格表示エリア全体。${priceTexts.length ? `含まれる表記: ${priceTexts.join(" / ")}。` : ""}金額、税込/税抜、初回/定期などの条件、背景枠や強調装飾をまとめて扱う。価格だけ差し替える場合も、この欄全体の可読性と配置を維持する。`,
    bounds: unionBounds(priceItems),
    locked: false,
  };
  const insertAt = Math.min(6, items.length);
  return [...items.slice(0, insertAt), overview, ...items.slice(insertAt)];
}

function normalizeAnalysis(data: AnalysisResponse) {
  const fallbackItems: AnalysisItem[] = [
    { category: "全体", item: "コンセプト", content: data.summary || "画像全体の狙いを確認してください。" },
  ];
  const items = (data.items?.length ? data.items : fallbackItems).map((item, index) => ({
    id: item.id || `analysis-${index + 1}`,
    category: item.category || "要素",
    item: item.item || `項目${index + 1}`,
    content: item.content || "",
    bounds: normalizeBounds(item.bounds),
    locked: Boolean(item.locked),
  }));
  return {
    summary: data.summary || "",
    items: ensurePriceOverview(items),
  };
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const { imageUrl, fileName = "", meta = {}, codexSettings } = (await request.json()) as Body;
  const jobId = `analyze-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const imagePath = resolveImagePath(imageUrl);
    const prompt = `
あなたはWEB広告バナーを分解し、再生成しやすい設計図にするプロのアートディレクターです。
添付画像を見て、構成要素を多角的に分解してください。

Return JSON only. No markdown, no explanation.
Schema:
{
  "summary": "このバナーの狙い・印象・勝ち筋を短く日本語で要約",
  "items": [
    {
      "id": "layout",
      "category": "構成",
      "item": "レイアウト",
      "content": "変更・固定しやすい粒度で具体的に説明",
      "bounds": { "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0 },
      "locked": false
    }
  ]
}

分解する観点:
- まず大括りの設計として、全体コンセプト、背景/舞台、デザインテイスト、配色/光、構図/レイアウト、質感/素材感を整理する
- 画像全体のコンセプト / 広告としての狙い
- メインコピー、サブコピー、商品名、ブランド名、価格、注釈、CTAなど、画像内の文字要素をできるだけ個別に分ける
- 商品写真、人物、手、顔、パッケージ、テクスチャー、背景、小物、装飾、吹き出し、フレーム、価格枠など、画像特有のオブジェクトを個別に分ける
- レイアウト、視線誘導、余白、主役/脇役の配置、重なり、前景/背景
- 色、光、雰囲気、ブランド感、トーン、コントラスト、質感
- 文字量、文字サイズ感、可読性、書体、装飾、強調表現
- 写真/漫画/紙面/TV風/高級感/ミーム感などのデザインテイスト
- 変えない方がよい核と、差し替えやすい要素
- 次に別バナーへ展開する時に調整できるレバー

出力ルール:
- items は 18〜28 件程度。最初に大括りの設計項目、その後に細かい文字・オブジェクト・デザイン要素を出す。
- items の先頭 6 件は必ず大括りの項目にする:
  1. category「全体」 item「全体コンセプト」
  2. category「背景」 item「背景/舞台」
  3. category「テイスト」 item「デザインテイスト」
  4. category「色」 item「配色/光」
  5. category「構成」 item「大枠レイアウト」
  6. category「質感」 item「質感/素材感」
- 画像内に価格表示がある場合、7件目付近に必ず category「価格」 item「価格欄」を入れる。これは金額文字だけではなく、金額、税込/税抜、初回/定期などの条件、背景枠、ラベル、装飾、配置をまとめた価格表示エリア全体の大枠項目にする。
- その後で、メインコピー、価格の金額/条件/ラベル、商品、人物、装飾、小物などを今まで通り細かく分解する。
- category は「全体」「背景」「テイスト」「色」「構成」「質感」「訴求」「コピー」「価格」「商品」「人物」「装飾」「文字」「変更余地」など短い分類。
- item は「メインコピー」「サブコピー」「価格枠」「商品ボトル」「背景色」「左上装飾」のように、ユーザーが変更対象として選びやすい名前にする。
- content はユーザーが後で編集できるように、具体的だが長すぎない日本語。現在の値・表記・見た目・変更時の注意が分かる粒度にする。
- 大括り項目の content は、後で別バナーへ流用/変更できるよう「何を維持すべきか」「変えるならどこか」が分かる粒度にする。
- bounds は画像左上を (0,0)、右下を (1,1) とした正規化座標で必ず入れる。該当箇所が画像全体なら {x:0,y:0,width:1,height:1}。
- bounds はその構成要素が占める見た目上の範囲をざっくりでよいので囲う。文字や価格はその文字の周辺、商品は商品本体、小物は小物だけを囲う。
- 画像内に存在するコピー文言や価格表記は、できるだけ見たまま content に書く。読めない場合は「判読困難」と明記する。
- 画像に書かれていない商品事実や効能は作らない。
- 見たまま分かることと、広告デザインとしての推定を分けて自然に書く。

参考メタ情報:
- ファイル名: ${fileName || "不明"}
- 比率: ${meta.aspectRatio || "不明"}
- 生成時プロンプト/スタイル情報:
${meta.generationPrompt || "なし"}
- 修正指示:
${meta.editInstruction || "なし"}
    `.trim();

    await appendRequestLog({
      jobId,
      step: "api-analyze-banner",
      status: "start",
      message: "Image source analysis request received",
      detail: { imageUrl, imagePath, fileName, meta, codexSettings, prompt },
    });

    const text = await runCodexTurn({
      jobId,
      logLabel: "analyze-banner",
      images: [imagePath],
      timeoutMs: 180_000,
      model: codexSettings?.model,
      effort: codexSettings?.effort,
      serviceTier: codexSettings?.serviceTier,
      prompt,
    });
    const parsed = parseCodexJson<AnalysisResponse>(text);
    const normalized = normalizeAnalysis(parsed);

    await appendRequestLog({
      jobId,
      step: "api-analyze-banner",
      status: "success",
      message: "Image source analysis completed",
      durationMs: Date.now() - startedAt,
      detail: normalized,
    });

    return NextResponse.json(normalized);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendRequestLog({
      jobId,
      step: "api-analyze-banner",
      status: "error",
      message,
      durationMs: Date.now() - startedAt,
      detail: { imageUrl, fileName, meta },
    });
    return NextResponse.json({ message }, { status: 500 });
  }
}
