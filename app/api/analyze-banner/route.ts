import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { parseCodexJson, runCodexTurn } from "@/app/lib/codex-app-server";
import { dataDir } from "@/app/lib/files";
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
  stream?: boolean;
  force?: boolean;
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

type AnalysisCacheRecord = {
  schemaVersion: 1;
  imageUrl: string;
  fileName?: string;
  updatedAt: string;
  latest: AnalysisResponse;
  history: Array<{
    analyzedAt: string;
    result: AnalysisResponse;
    meta?: Body["meta"];
    codexSettings?: Body["codexSettings"];
  }>;
};

type AnalysisStreamMessage =
  | { type?: "summary"; content?: string; summary?: string }
  | AnalysisItem & { type?: "item"; seq?: number }
  | { type?: "done"; expectedItems?: number };

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

function sidecarPathForImage(imagePath: string) {
  return imagePath.replace(/\.(png|jpe?g|webp)$/i, ".json");
}

function fileCachePathForUrl(imageUrl: string) {
  const digest = createHash("sha256").update(imageUrl).digest("hex").slice(0, 32);
  return path.join(dataDir, "image-analysis-cache", `${digest}.json`);
}

function imageAnalysisCacheLocation(imageUrl: string, imagePath: string) {
  return imageUrl.startsWith("/saved-banners/")
    ? { kind: "sidecar" as const, path: sidecarPathForImage(imagePath) }
    : { kind: "cache-file" as const, path: fileCachePathForUrl(imageUrl) };
}

async function readJsonFile(filePath: string) {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Record<string, any>;
  } catch {
    return {};
  }
}

async function readAnalysisCache(imageUrl: string, imagePath: string) {
  const location = imageAnalysisCacheLocation(imageUrl, imagePath);
  const data = await readJsonFile(location.path);
  const record = location.kind === "sidecar" ? data.analysisCache : data;
  if (!record || record.schemaVersion !== 1 || !record.latest) return null;
  return normalizeAnalysis(record.latest as AnalysisResponse);
}

async function writeAnalysisCache(imageUrl: string, imagePath: string, fileName: string, meta: Body["meta"], codexSettings: Body["codexSettings"], result: AnalysisResponse) {
  const location = imageAnalysisCacheLocation(imageUrl, imagePath);
  const current = await readJsonFile(location.path);
  const previous = location.kind === "sidecar" ? current.analysisCache : current;
  const history = Array.isArray(previous?.history) ? previous.history : [];
  const record: AnalysisCacheRecord = {
    schemaVersion: 1,
    imageUrl,
    fileName,
    updatedAt: new Date().toISOString(),
    latest: result,
    history: [
      {
        analyzedAt: new Date().toISOString(),
        result,
        meta,
        codexSettings,
      },
      ...history,
    ].slice(0, 20),
  };
  await mkdir(path.dirname(location.path), { recursive: true });
  const next = location.kind === "sidecar"
    ? { schemaVersion: 1, ...current, analysisCache: record, updatedAt: new Date().toISOString() }
    : record;
  await writeFile(location.path, JSON.stringify(next, null, 2), "utf8");
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
  if (x <= 0.001 && y <= 0.001 && x + width >= 0.999 && y + height >= 0.999) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const pad = 0.015;
  const left = Math.max(0, x - pad);
  const top = Math.max(0, y - pad);
  const right = Math.min(1, x + width + pad);
  const bottom = Math.min(1, y + height + pad);
  return {
    x: left,
    y: top,
    width: Math.max(0.02, right - left),
    height: Math.max(0.02, bottom - top),
  };
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

function normalizeAnalysisItem(item: AnalysisItem, index: number): NormalizedAnalysisItem {
  return {
    id: item.id || `analysis-${index + 1}`,
    category: item.category || "要素",
    item: item.item || `項目${index + 1}`,
    content: item.content || "",
    bounds: normalizeBounds(item.bounds),
    locked: Boolean(item.locked),
  };
}

function normalizeAnalysis(data: AnalysisResponse) {
  const fallbackItems: AnalysisItem[] = [
    { category: "全体", item: "コンセプト", content: data.summary || "画像全体の狙いを確認してください。" },
  ];
  const items = (data.items?.length ? data.items : fallbackItems).map(normalizeAnalysisItem);
  return {
    summary: data.summary || "",
    items: ensurePriceOverview(items),
  };
}

function parseAnalysisNdjson(text: string): AnalysisResponse {
  const lines = text.split(/\r?\n/);
  let summary = "";
  const items: AnalysisItem[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("```")) continue;
    try {
      const data = JSON.parse(line) as AnalysisStreamMessage;
      if (data.type === "summary") {
        summary = data.content || data.summary || summary;
      } else if (data.type === "item" || ("category" in data && "item" in data)) {
        const item = data as AnalysisItem;
        items.push(item);
      }
    } catch {
      // Keep parsing later lines; a single malformed streamed line should not lose the whole analysis.
    }
  }
  return { summary, items };
}

function buildAnalysisPrompt(fileName: string, meta: Body["meta"] = {}, format: "json" | "ndjson") {
  const outputContract = format === "ndjson"
    ? `
Return NDJSON only. No markdown, no code fence, no explanation.
Each line must be one complete JSON object.
Use this order:
{"type":"summary","content":"このバナーの狙い・印象・勝ち筋を短く日本語で要約"}
{"type":"item","seq":1,"id":"overall","category":"全体","item":"全体コンセプト","content":"変更・固定しやすい粒度で具体的に説明","bounds":{"x":0.0,"y":0.0,"width":1.0,"height":1.0},"locked":false}
{"type":"done","expectedItems":24}
`
    : `
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
`;
  return `
あなたはWEB広告バナーを分解し、再生成しやすい設計図にするプロのアートディレクターです。
添付画像を見て、構成要素を多角的に分解してください。

${outputContract}

分解する観点:
- まず大括りの設計として、全体コンセプト、背景/舞台、デザインテイスト、配色/光、構図/レイアウト、質感/素材感を整理する
- 画像全体のコンセプト / 広告としての狙い
- メインコピー、サブコピー、商品名、ブランド名、価格、注釈、CTAなど、画像内の文字要素を広告上の意味単位で分ける
- 商品写真、人物、手、顔、パッケージ、テクスチャー、背景、小物、装飾、吹き出し、フレーム、価格枠など、画像特有のオブジェクトを編集しやすいまとまりで分ける
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
- その後で、メインコピー、価格の金額/条件/ラベル、商品、人物、装飾、小物などを、ユーザーが変更対象として扱いやすい編集単位に分解する。
- category は「全体」「背景」「テイスト」「色」「構成」「質感」「訴求」「コピー」「価格」「商品」「人物」「装飾」「文字」「変更余地」など短い分類。
- item は「メインコピー」「サブコピー」「価格枠」「商品イメージ」「背景色」「左上装飾」のように、ユーザーが変更対象として選びやすい名前にする。
- content はユーザーが後で編集できるように、具体的だが長すぎない日本語。現在の値・表記・見た目・変更時の注意が分かる粒度にする。
- 大括り項目の content は、後で別バナーへ流用/変更できるよう「何を維持すべきか」「変えるならどこか」が分かる粒度にする。
- コピー要素は細かく割りすぎない。1つの見出しとして読ませている大きな文字群は、複数行・記号・英単語に分かれていても「メインコピー」として1項目にまとめる。
- メインコピー内の単語、記号、改行ごとの断片を別項目にしない。分けるのは、独立したラベル、バッジ、注釈、商品カテゴリ、CTAなど、別々に編集する意味がある場合だけ。
- 小さなラベル、丸囲み、吹き出し、バッジが近接して同じ訴求を補強している場合は、左右・上下・個数で分けず「訴求ラベル群」「成分訴求ラベル群」「補足バッジ群」のような1つの構成要素にまとめる。
- ラベル群をまとめる時の content には、含まれる主要文言を列挙し、それぞれが同じ役割の補足訴求であることを書く。ラベル同士の位置違いだけを理由に別項目へ分割しない。
- ただし、価格、商品名、ブランド名、CTA、法定注記、明らかに別の意味を持つ強い見出しはラベル群に混ぜず、別項目として扱う。
- 商品は原則「商品イメージ」1項目にする。ボトル、容器、ポンプ、キャップ、ラベル面、商品影、反射を個別項目に分けない。
- 「商品イメージ」は物理的な商品本体だけを指す。背景、人物、コピー、価格欄、装飾、キャンペーン全体の世界観は含めない。
- 商品項目の content は短く、商品本体の配置、角度、サイズ感、光、ラベル可読性だけを書く。ポンプやラベルなどの細部は同じ文の中の注意点に留める。
- 商品名やブランド名が商品ラベル上に見える場合でも、ラベルだけを別項目にしない。商品名テキストを広告コピーとして独立表示している場合だけ、別の「商品名」項目にする。
- 商品の一部だけを別項目にするのは、その部品だけが広告上の主役として大きく拡大されている、別素材として独立配置されている、または部分だけを差し替える明確な意味がある場合だけ。
- 文字の装飾やレイアウト上の特徴は、コピー本文と同じ項目の content に含める。書体・サイズ・縦横配置だけを理由にコピーを分割しない。
- 価格は「価格欄」大枠を必ず作り、必要ならその後に金額、条件、注釈などを追加で分ける。ただし金額の桁や税込表記を不必要に細切れにしない。
- bounds は画像左上を (0,0)、右下を (1,1) とした正規化座標で必ず入れる。該当箇所が画像全体なら {x:0,y:0,width:1,height:1}。
- bounds は構成要素の見た目上の外接矩形をできるだけ正確に囲う。メインコピーは見出しとして読ませる文字群全体、ラベル群は含まれる複数ラベル全体、文字は文字列全体と装飾の余白、価格欄は価格背景・ラベル・注釈を含む価格エリア全体、商品イメージは商品本体だけ、小物は小物単体の輪郭を囲う。商品イメージのboundsを画像全体や背景込みにしない。
- bounds は狭すぎるより、対象が切れないように外側へほんの少し広めに取る。ただし隣の別要素を大きく巻き込まない。
- bounds の x/y/width/height は 0.01 単位くらいまで意識して、全項目で同じ曖昧な範囲を使い回さない。
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
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const { imageUrl, fileName = "", meta = {}, codexSettings, stream = false, force = false } = (await request.json()) as Body;
  const jobId = `analyze-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const imagePath = resolveImagePath(imageUrl);
    const prompt = buildAnalysisPrompt(fileName, meta, stream ? "ndjson" : "json");
    const cached = force ? null : await readAnalysisCache(imageUrl, imagePath);

    if (stream) {
      const encoder = new TextEncoder();
      let buffer = "";
      let summary = "";
      let processedAnyLine = false;
      const streamedItems: AnalysisItem[] = [];
      const responseStream = new ReadableStream({
        start(controller) {
          const write = (message: unknown) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
          };
          const handleLine = (rawLine: string) => {
            const line = rawLine.trim();
            if (!line || line.startsWith("```")) return;
            let data: AnalysisStreamMessage;
            try {
              data = JSON.parse(line) as AnalysisStreamMessage;
            } catch {
              return;
            }
            processedAnyLine = true;
            if (data.type === "summary") {
              summary = data.content || data.summary || summary;
              write({ type: "summary", content: summary });
              return;
            }
            if (data.type === "item" || ("category" in data && "item" in data)) {
              const item = data as AnalysisItem;
              streamedItems.push(item);
              write({ type: "item", item: normalizeAnalysisItem(item, streamedItems.length - 1) });
            }
          };
          const handleDelta = (delta: string) => {
            buffer += delta;
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || "";
            for (const line of lines) handleLine(line);
          };

          void (async () => {
            try {
              if (cached) {
                write({ type: "status", message: "保存済みの構成分析を読み込み中" });
                write({ type: "final", result: cached, cached: true });
                await appendRequestLog({
                  jobId,
                  step: "api-analyze-banner",
                  status: "success",
                  message: "Streaming image source analysis cache hit",
                  durationMs: Date.now() - startedAt,
                  detail: { imageUrl, fileName, itemCount: cached.items.length },
                });
                controller.close();
                return;
              }
              write({ type: "status", message: "画像全体を確認中" });
              await appendRequestLog({
                jobId,
                step: "api-analyze-banner",
                status: "start",
                message: "Streaming image source analysis request received",
                detail: { imageUrl, imagePath, fileName, meta, codexSettings, prompt },
              });
              const text = await runCodexTurn({
                jobId,
                logLabel: "analyze-banner-stream",
                images: [imagePath],
                timeoutMs: 180_000,
                model: codexSettings?.model,
                effort: codexSettings?.effort,
                serviceTier: codexSettings?.serviceTier,
                prompt,
                onTextDelta: handleDelta,
              });
              if (buffer.trim()) handleLine(buffer);
              if (!processedAnyLine) {
                const parsed = parseAnalysisNdjson(text);
                summary = parsed.summary || summary;
                streamedItems.push(...(parsed.items || []));
              }
              const normalized = normalizeAnalysis({ summary, items: streamedItems });
              await writeAnalysisCache(imageUrl, imagePath, fileName, meta, codexSettings, normalized);
              await appendRequestLog({
                jobId,
                step: "api-analyze-banner",
                status: "success",
                message: "Streaming image source analysis completed",
                durationMs: Date.now() - startedAt,
                detail: normalized,
              });
              write({ type: "final", result: normalized });
              controller.close();
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              await appendRequestLog({
                jobId,
                step: "api-analyze-banner",
                status: "error",
                message,
                durationMs: Date.now() - startedAt,
                detail: { imageUrl, fileName, meta, stream: true },
              });
              write({ type: "error", message });
              controller.close();
            }
          })();
        },
      });
      return new Response(responseStream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      });
    }

    if (cached) {
      await appendRequestLog({
        jobId,
        step: "api-analyze-banner",
        status: "success",
        message: "Image source analysis cache hit",
        durationMs: Date.now() - startedAt,
        detail: { imageUrl, fileName, itemCount: cached.items.length },
      });
      return NextResponse.json({ ...cached, cached: true });
    }

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
    await writeAnalysisCache(imageUrl, imagePath, fileName, meta, codexSettings, normalized);

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
