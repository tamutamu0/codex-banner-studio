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
  locked?: boolean;
};

type AnalysisResponse = {
  summary?: string;
  items?: AnalysisItem[];
};

function resolveImagePath(imageUrl: string) {
  if (!imageUrl.startsWith("/")) throw new Error("ローカル画像URLだけ対応しています");
  return path.join(process.cwd(), "public", imageUrl.replace(/^\//, ""));
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
    locked: Boolean(item.locked),
  }));
  return {
    summary: data.summary || "",
    items,
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
      "locked": false
    }
  ]
}

分解する観点:
- 全体コンセプト / 広告としての狙い
- 訴求・コピー・価格表現
- レイアウト、視線誘導、主役/脇役の配置
- 商品や人物、背景、小物、質感などの構成要素
- 色、光、雰囲気、ブランド感、トーン
- 文字量、文字サイズ感、可読性、装飾
- 写真/漫画/紙面/TV風などのデザインテイスト
- 変えない方がよい核と、差し替えやすい要素
- 次に別バナーへ展開する時に調整できるレバー

出力ルール:
- items は 8〜14 件程度。
- category は「構成」「訴求」「コピー」「商品」「人物」「色」「背景」「質感」「文字」「変更余地」など短い分類。
- item は項目名だけを短く。
- content はユーザーが後で編集できるように、具体的だが長すぎない日本語。
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
