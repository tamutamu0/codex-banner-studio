import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir, ensureMasterDirs, makeId } from "./files";

export type PromptStep = "ideas" | "sheets" | "final";

export type PromptPreset = {
  id: string;
  step: PromptStep;
  name: string;
  template: string;
  builtIn?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PromptTemplateMap = Partial<Record<PromptStep, string>>;

export const STEP_LABELS: Record<PromptStep, string> = {
  ideas: "Step 1: 案生成",
  sheets: "Step 2: 画像生成",
  final: "Step 3: 仕上げ",
};

export const REQUIRED_VARIABLES: Record<PromptStep, string[]> = {
  ideas: ["count", "productInputJson"],
  sheets: ["brandProductName", "count", "runCount", "totalCandidates", "sheetBlocks", "productImageDescriptions", "productNotes", "priceInfo"],
  final: ["aspectRatio", "editBlock", "brandName", "productName", "priceInfo", "priceTreatmentText", "productImageDescriptions"],
};

export const REQUIRED_GUARDRAILS: Record<PromptStep, string> = {
  ideas: `
固定ルール（必ず守る）:
- JSONだけを返す。説明文、Markdown、コードブロックは禁止。
- variants を必ず {{count}} 個返す。
- 各 variants は index / appeal / priceTreatment / prompt を持つ。
- prompt は画像生成の完成プロンプトではなく、日本語のラフなバナー案にする。
- 商品入力と矛盾する訴求、未確認の成分・効能・別カテゴリの表現は入れない。
- 複数案の場合、直球の商品特徴訴求と、自由に考える変化球を少なくとも1つずつ混ぜる。

商品入力:
{{productInputJson}}
  `.trim(),
  sheets: `
固定ルール（必ず守る）:
- {{brandProductName}} のWEB広告バナー画像を生成する。
- PNG画像を必ず {{runCount}} 枚、別々の画像として生成する。
- 出力する各PNG画像そのものの比率は必ず 1:1 の正方形にする。
- 各PNG画像は「{{count}}パターンを上下左右に並べた1枚の分割シート」にする。
- 各セルも必ず 1:1 の正方形バナーにする。横長・縦長・余白付きのシートにしない。
- 1枚に {{totalCandidates}} 候補を全部詰め込まない。必ず {{count}} 分割シートを {{runCount}} 枚作る。
- 各セルは完全に均等なグリッドにし、セル境界と外枠には細い黒線を入れる。
- シート内の各案は、必ず別々のセルとして分ける。セルをまたぐ文字・商品・背景は禁止。
- 各シートは下のシート別案リストだけに対応する。
- 最終出力は画像だけ。説明文だけで終わらない。
- 商品名、商品画像、画像説明、商品メモ、価格情報と矛盾しない広告表現にする。
- 未確認の成分、効能、商品カテゴリ、素材、色、別商品の特徴を勝手に作らない。
- 価格表示なしの案には価格文言を入れない。価格表示ありの案は商品名と価格を見やすく入れる。

作成するバナーの種類:
{{sheetBlocks}}

商品画像の説明:
{{productImageDescriptions}}

商品メモ・追加指示:
{{productNotes}}

価格情報:
{{priceInfo}}
  `.trim(),
  final: `
固定ルール（必ず守る）:
- 添付した選択画像をもとに、広告バナー画像を再生成する。
- 再生成する画像サイズ/比率は {{aspectRatio}}。
- 指定の内容以外は維持する。
- オリジナル画像の構成内容を変えない。
- オリジナル画像にない要素を加えない。
- 構図、商品配置、色味、雰囲気、訴求、文字の有無、価格表示の有無はできるだけ維持する。
- グリッドの枠線、分割シートの余白、番号、セル境界など、候補シート由来の不要な要素だけを取り除く。
- {{priceTreatmentText}}

{{editBlock}}

商品情報:
- ブランド: {{brandName}}
- 商品名: {{productName}}
- 価格情報: {{priceInfo}}
- 商品画像説明:
{{productImageDescriptions}}
  `.trim(),
};

export const VARIABLE_HELP: Record<PromptStep, Array<{ key: string; label: string; description: string }>> = {
  ideas: [
    { key: "count", label: "案数", description: "作成する訴求案の数" },
    { key: "priceInfo", label: "価格情報", description: "生成画面で指定した価格文言" },
    { key: "priceMode", label: "価格モード", description: "all / mixed / none" },
    { key: "productInputJson", label: "商品入力JSON", description: "商品名、ブランド、画像説明、メモなど" },
  ],
  sheets: [
    { key: "brandProductName", label: "ブランド+商品名", description: "例: Brand Product" },
    { key: "count", label: "1シートの分割数", description: "1枚の分割シートに入れる候補数" },
    { key: "runCount", label: "生成画像枚数", description: "1回のCodexリクエストで作るPNG枚数" },
    { key: "totalCandidates", label: "候補総数", description: "分割数 × 生成画像枚数" },
    { key: "sheetBlocks", label: "シート別案リスト", description: "Step1で作った訴求案・テイスト・価格指定の一覧" },
    { key: "productImageDescriptions", label: "画像説明", description: "商品マスタ画像ごとの説明" },
    { key: "productNotes", label: "商品メモ", description: "商品メモと追加指示" },
    { key: "priceInfo", label: "価格情報", description: "価格表示に使う文言" },
  ],
  final: [
    { key: "aspectRatio", label: "比率", description: "仕上げ生成の比率" },
    { key: "editBlock", label: "修正指示ブロック", description: "ユーザー指示あり/なしに応じた文章" },
    { key: "brandName", label: "ブランド名", description: "選択商品のブランド名" },
    { key: "productName", label: "商品名", description: "選択商品の商品名" },
    { key: "priceInfo", label: "価格情報", description: "価格表示に使う文言" },
    { key: "priceTreatmentText", label: "価格表示方針", description: "選択候補が価格あり/なしのどちらか" },
    { key: "productImageDescriptions", label: "画像説明", description: "商品マスタ画像ごとの説明" },
  ],
};

const now = "built-in";

export const DEFAULT_PROMPT_PRESETS: PromptPreset[] = [
  {
    id: "default-ideas",
    step: "ideas",
    name: "デフォルト",
    builtIn: true,
    createdAt: now,
    updatedAt: now,
    template: `
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
2. 調べた内容から、WEB広告バナー案をちょうど {{count}} 個作る。
3. 各案は「訴求案」と「バナーのテイスト/構図のざっくり指定」を日本語で書く。

考え方:
- 全案を細かい訴求指定にしすぎない。
- 「黒板チョーク」「TV紹介風」「新聞/雑誌風」「漫画風」のように、表現テイストだけを強く指定し、訴求は画像生成時に商品調査から自然に決める案も混ぜる。
- 具体的な商品特徴や面白い見た目がある場合だけ、それを訴求フックとして指定する。
- 目安として、半分くらいはテイスト主導、半分くらいは商品特徴/価格/悩み主導にする。
- {{count}}個すべてを細かい案で埋めなくてよい。生成案数が1以上なら、少なくとも1つは「その他は自由に考えて別の角度でぶっ飛んだやつ」という自由枠にする。
- 自由枠は、訴求内容を下手に指定しすぎず、商品調査と商品画像から外れない範囲で、モデル自身に別角度の勝ちバナーを考えさせる余白にする。
- 複数案の場合、少なくとも1つは「直球の商品特徴訴求」にする。ここは案を細かく指定せず、画像生成時に商品特徴を整理して王道の勝ちバナーを考えさせる。

標準トーン:
- 上質、ブランド感、大人向け。
- 普通、無難、清潔感だけ、よくある美容広告、商品を置いただけの案にはしない。
- 商品特徴、成分、テクスチャー、見た目、価格、悩みのどれかを起点に、目に止まるフックを作る。ただし商品と関係ない飛躍はしない。
- WEB広告なので、文字を使う案では小さすぎる文字に頼らず、ひと目で読める大きなコピーを想定する。
- {{count}} 個の案は、写真、コラージュ、ミーム風、ポップ、ラグジュアリー、科学/成分、マクロ質感、漫画的ツッコミなど、画像テイストも大きく散らす。
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
- ただし {{count}} 個の案は、訴求・構図・テイストができるだけ被らないようにする。
- 目を止めるWEB広告らしい、CTRが上がりそうな強い案を中心にする。

価格ルール:
- priceInfo: {{priceInfo}}
- priceMode: {{priceMode}}
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
{{productInputJson}}
    `.trim(),
  },
  {
    id: "default-sheets",
    step: "sheets",
    name: "デフォルト",
    builtIn: true,
    createdAt: now,
    updatedAt: now,
    template: `
あなたはプロのWEB広告のディレクター・デザイナーです。
{{brandProductName}}を検索し、調べた内容と添付した商品画像を参考にして、ハイクオリティのWEB広告バナーを、合計{{runCount}}枚のPNG画像として生成してください。
各PNG画像そのものの比率は必ず1:1の正方形です。
各PNG画像は「1:1のバナーを{{count}}パターン、上下左右に並べた1枚の正方形分割シート」です。
各セルは完全に均等なグリッドにし、セル境界と外枠には細い黒線を入れてください。
合計で {{count}}分割 × {{runCount}}枚 = {{totalCandidates}} 候補を作成してください。
それぞれデザイン・構図・訴求を大きく変えて差別化すること。

超秀逸でCTRとCVR最大化するようなバナーに仕上げること。
今の時代でこの商材ジャンルの市場で埋もれない勝ちバナーにすること。
上質、ブランド感、大人向け。
AIっぽさを無くして、人間の凄腕広告クリエイターが作ったような自然な違和感、余白、質感、情報設計、コピーの強さにすること。
プロデザイナーが作成したクオリティに仕上げて。

重要:
- PNG画像を必ず{{runCount}}枚、別々の画像として生成する。
- 各PNG画像は必ず1:1の正方形。横長・縦長にしない。
- 1枚に{{totalCandidates}}候補を全部詰め込まない。必ず「{{count}}分割シート」を{{runCount}}枚作る。
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
{{sheetBlocks}}

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
{{productImageDescriptions}}

商品メモ・追加指示:
{{productNotes}}

価格情報:
{{priceInfo}}

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
    `.trim(),
  },
  {
    id: "default-final",
    step: "final",
    name: "デフォルト",
    builtIn: true,
    createdAt: now,
    updatedAt: now,
    template: `
添付した選択画像をもとに、広告バナー画像を再生成して。
再生成する画像サイズ/比率は {{aspectRatio}}。

指定の内容以外は維持する。
オリジナル画像の構成内容を変えない。
オリジナル画像にない要素を加えない。
構図、商品配置、色味、雰囲気、訴求、文字の有無、価格表示の有無はできるだけ維持する。
グリッドの枠線、分割シートの余白、番号、セル境界など、候補シート由来の不要な要素だけを取り除く。
プロデザイナーが仕上げたような高品質な単体バナーに整える。

{{editBlock}}

商品情報:
- ブランド: {{brandName}}
- 商品名: {{productName}}
- 価格情報: {{priceInfo}}
- 選択画像の価格表示: {{priceTreatmentText}}
- 商品画像説明:
{{productImageDescriptions}}
    `.trim(),
  },
];

const presetPath = path.join(dataDir, "prompt-presets.json");

export function missingRequiredVariables(step: PromptStep, template: string) {
  const checkedTemplate = `${template}\n${REQUIRED_GUARDRAILS[step]}`;
  return REQUIRED_VARIABLES[step].filter((key) => !checkedTemplate.includes(`{{${key}}}`));
}

export function renderPromptTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => {
    const value = values[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

export function renderPromptWithGuardrails(step: PromptStep, template: string, values: Record<string, string | number>) {
  const mainPrompt = renderPromptTemplate(template, values).trim();
  const guardrails = renderPromptTemplate(REQUIRED_GUARDRAILS[step], values).trim();
  return `${mainPrompt}\n\n---\n${guardrails}`.trim();
}

function normalizePromptPreset(item: Partial<PromptPreset>): PromptPreset | null {
  const id = item.id ? String(item.id) : makeId("prompt");
  const defaultPreset = DEFAULT_PROMPT_PRESETS.find((preset) => preset.id === id);
  const step = defaultPreset?.step || item.step;
  const name = String(item.name || "").trim();
  const template = String(item.template || "").trim();
  if (step !== "ideas" && step !== "sheets" && step !== "final") return null;
  if (!name || !template) return null;
  return {
    id,
    step,
    name,
    template,
    builtIn: Boolean(defaultPreset),
    createdAt: item.createdAt || defaultPreset?.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || new Date().toISOString(),
  };
}

export async function readPromptPresets() {
  await ensureMasterDirs();
  let stored: PromptPreset[] = [];
  try {
    const raw = await readFile(presetPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<PromptPreset>[];
    stored = Array.isArray(parsed) ? parsed.map(normalizePromptPreset).filter(Boolean) as PromptPreset[] : [];
  } catch {
    stored = [];
  }
  const defaults = DEFAULT_PROMPT_PRESETS.map((preset) => stored.find((item) => item.id === preset.id) || preset);
  const custom = stored.filter((item) => !item.builtIn);
  return [...defaults, ...custom];
}

export async function saveCustomPromptPresets(presets: PromptPreset[]) {
  await ensureMasterDirs();
  const normalized = presets.map(normalizePromptPreset).filter(Boolean) as PromptPreset[];
  const defaults = DEFAULT_PROMPT_PRESETS.map((preset) => normalized.find((item) => item.id === preset.id) || preset);
  const custom = normalized.filter((item) => !item.builtIn);
  const defaultOverrides = defaults.filter((preset) => {
    const original = DEFAULT_PROMPT_PRESETS.find((item) => item.id === preset.id);
    return original && (preset.name !== original.name || preset.template !== original.template);
  });
  const persisted = [...defaultOverrides, ...custom];
  await writeFile(presetPath, JSON.stringify(persisted, null, 2), "utf8");
  return [...defaults, ...custom];
}
