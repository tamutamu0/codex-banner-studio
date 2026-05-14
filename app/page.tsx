"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ProductImage = { id: string; url: string; path: string; description: string };
type Product = {
  id: string;
  brandName: string;
  name: string;
  images: ProductImage[];
  imageUrl?: string;
  imagePath?: string;
  notes?: string;
  priceInfo?: string;
};
type Brand = { id: string; name: string; createdAt: string };

type ProductInput = {
  productId?: string;
  brandName?: string;
  productName: string;
  format: string;
  productImageUrl?: string;
  productImagePath?: string;
  productImages?: ProductImage[];
  notes?: string;
  priceInfo?: string;
  priceMode?: "all" | "mixed" | "none";
};

type Variant = {
  index: number;
  appeal?: string;
  prompt: string;
  cropUrl?: string;
  sheetRun?: number;
  globalIndex?: number;
  priceTreatment?: "with_price" | "without_price";
};

type Mode = "codex" | "local-fallback";
type Tab = "generate" | "products" | "library" | "settings";
type CreateMode = "product" | "image";

type ApiDebug = {
  step?: string;
  durationMs?: number;
  fallbackReason?: string;
  codexBin?: string;
  revisedPrompt?: string;
  events?: string[];
  jobId?: string;
  codexJobId?: string;
  requestedSheets?: number;
  returnedImages?: number;
};

type DebugEntry = { id: string; time: string; level: "info" | "success" | "warn" | "error"; title: string; detail?: string };
type RequestLogEntry = { time?: string; message?: string; detail?: any };
type RateLimitWindow = { label: string; usedPercent: number; resetsAt?: number };
type RateLimitInfo = { updatedAt: string; planType?: string; reachedType?: string | null; primary?: RateLimitWindow; secondary?: RateLimitWindow };
type NewImageRow = { id: string; file: File | null; description: string; previewUrl?: string; existing?: ProductImage };
type SavedNode = {
  name: string;
  path: string;
  children: SavedNode[];
  files: SavedFile[];
};
type SavedFile = {
  name: string;
  displayName?: string;
  rating?: number;
  appeal?: string;
  stylePrompt?: string;
  url: string;
  path: string;
  propertyUrl?: string;
  propertyPath?: string;
  assetId?: string;
  rootId?: string;
  parentUrl?: string;
  sourceUrl?: string;
  sourceType?: string;
  aspectRatio?: string;
  editInstruction?: string;
  generationPrompt?: string;
  product?: {
    brandName?: string;
    productName?: string;
    priceInfo?: string;
    priceMode?: string;
  };
  savedAt?: string;
  isDisplay?: boolean;
  versionCount?: number;
  versions?: SavedFile[];
};
type SavedBanner = { url: string; filePath: string; propertyUrl?: string; propertyPath?: string; folderPath: string; folder?: string; tree?: SavedNode; duplicated?: boolean };
type ManualUploadResponse = { saved: SavedBanner[]; tree: SavedNode; rootPath: string; folder: string };
type UnsavedBanner = { url: string; product: string; createdAt: string; historyId: string; variant: Variant };
type LibraryDetailItem = {
  kind: "saved" | "unsaved";
  url: string;
  title: string;
  fileName: string;
  folder: string;
  rating?: number;
  appeal?: string;
  stylePrompt?: string;
  prompt?: string;
  path?: string;
  propertyPath?: string;
  assetId?: string;
  rootId?: string;
  parentUrl?: string;
  sourceType?: string;
  aspectRatio?: string;
  editInstruction?: string;
  generationPrompt?: string;
  versions?: SavedFile[];
  versionCount?: number;
  product?: string;
  createdAt?: string;
  historyId?: string;
};
type BannerPreset = { count: number; divisions: number; sheetRuns: number };
type CodexSettings = {
  model: string;
  effort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  serviceTier: "fast" | "auto";
};
type PromptStep = "ideas" | "sheets" | "final";
type PromptPreset = {
  id: string;
  step: PromptStep;
  name: string;
  template: string;
  builtIn?: boolean;
  createdAt: string;
  updatedAt: string;
};
type IdeaGenerationSettings = {
  chunkSize: number;
  themeMode: "balanced" | "wide";
  overlapAvoidance: "normal" | "strong";
};
type BannerAnalysisItem = {
  id: string;
  category: string;
  item: string;
  content: string;
  locked?: boolean;
};
type BannerAnalysisResult = {
  summary: string;
  items: BannerAnalysisItem[];
};
type HistoryRecord = {
  id: string;
  createdAt: string;
  input: ProductInput;
  generationSettings?: {
    productId?: string;
    direction?: string;
    priceInfo?: string;
    priceMode?: "all" | "mixed" | "none";
    divisions?: number;
    sheetRuns?: number;
    imagesPerRequest?: number;
    ideaChunkSize?: number;
    ideaThemeMode?: IdeaGenerationSettings["themeMode"];
    ideaOverlapAvoidance?: IdeaGenerationSettings["overlapAvoidance"];
  };
  ideas: Variant[];
  sheetUrl?: string;
  sheetUrls?: string[];
  finalUrl?: string;
  selectedIndex?: number;
};

const INITIAL_BRAND_OPTIONS = (process.env.NEXT_PUBLIC_BRAND_OPTIONS || "Brand A,Brand B")
  .split(",")
  .map((brand) => brand.trim())
  .filter(Boolean);
const DEFAULT_BRAND = INITIAL_BRAND_OPTIONS[0] || "";
const promptStepLabels: Record<PromptStep, string> = {
  ideas: "Step 1 案生成",
  sheets: "Step 2 画像生成",
  final: "Step 3 仕上げ",
};
const promptVariableHelp: Record<PromptStep, Array<{ key: string; label: string; description: string; required?: boolean }>> = {
  ideas: [
    { key: "count", label: "案数", description: "作成する訴求案の数", required: true },
    { key: "totalCount", label: "総案数", description: "全体で作成する候補数" },
    { key: "chunkContext", label: "分割文脈", description: "何回目の案生成か、全体のどこを担当するか" },
    { key: "themeDirective", label: "担当テーマ", description: "このチャンクで散らす訴求・見た目の方向性" },
    { key: "previousIdeasSummary", label: "既出案", description: "前チャンクまでの案要約。重複回避に使う" },
    { key: "priceInfo", label: "価格情報", description: "生成画面の価格文言" },
    { key: "priceMode", label: "価格モード", description: "all / mixed / none" },
    { key: "productInputJson", label: "商品入力JSON", description: "商品名、画像説明、メモなど", required: true },
  ],
  sheets: [
    { key: "brandProductName", label: "商品名", description: "ブランド名 + 商品名", required: true },
    { key: "count", label: "分割数", description: "1シートの候補数", required: true },
    { key: "runCount", label: "画像枚数", description: "1回で作るPNG枚数", required: true },
    { key: "totalCandidates", label: "候補総数", description: "分割数 × 画像枚数", required: true },
    { key: "sheetBlocks", label: "案リスト", description: "Step1で作った訴求案・テイスト一覧", required: true },
    { key: "productImageDescriptions", label: "画像説明", description: "商品画像ごとの説明", required: true },
    { key: "productNotes", label: "商品メモ", description: "商品メモと追加指示", required: true },
    { key: "priceInfo", label: "価格情報", description: "価格表示に使う文言", required: true },
  ],
  final: [
    { key: "aspectRatio", label: "比率", description: "仕上げ生成の比率", required: true },
    { key: "editBlock", label: "修正指示", description: "修正指示あり/なしの文章", required: true },
    { key: "brandName", label: "ブランド", description: "商品ブランド", required: true },
    { key: "productName", label: "商品名", description: "商品名", required: true },
    { key: "priceInfo", label: "価格情報", description: "価格文言", required: true },
    { key: "priceTreatmentText", label: "価格方針", description: "価格あり/なしの維持指示", required: true },
    { key: "productImageDescriptions", label: "画像説明", description: "商品画像ごとの説明", required: true },
  ],
};
const promptRequiredVariables = Object.fromEntries(
  Object.entries(promptVariableHelp).map(([step, vars]) => [step, vars.filter((item) => item.required).map((item) => item.key)]),
) as Record<PromptStep, string[]>;
const fixedPromptVariableCoverage: Record<PromptStep, string[]> = {
  ideas: ["count", "productInputJson"],
  sheets: ["brandProductName", "count", "runCount", "totalCandidates", "sheetBlocks", "productImageDescriptions", "productNotes", "priceInfo"],
  final: ["aspectRatio", "editBlock", "brandName", "productName", "priceInfo", "priceTreatmentText", "productImageDescriptions"],
};
const fixedPromptGuardrailSummary: Record<PromptStep, string[]> = {
  ideas: ["JSONだけで返す", "指定数ぴったり案を返す", "商品情報と矛盾する案を出さない", "大量生成時はチャンクごとの担当テーマと既出案を使う"],
  sheets: ["指定枚数のPNGを作る", "出力PNGは必ず1:1正方形", "指定分割の均等グリッドにする", "案リスト・商品画像説明・価格方針を必ず使う"],
  final: ["選択画像ベースで仕上げる", "指定比率で再生成する", "指定外の構図・訴求・価格表示を変えない"],
};
const DEFAULT_CODEX_SETTINGS: CodexSettings = { model: "gpt-5.5", effort: "medium", serviceTier: "auto" };
const DEFAULT_IDEA_GENERATION_SETTINGS: IdeaGenerationSettings = { chunkSize: 20, themeMode: "balanced", overlapAvoidance: "strong" };
const IDEA_CHUNK_THEMES = [
  "直球の王道訴求、商品特徴、価格オファー、悩み解決。広告として分かりやすい勝ち筋を中心にする。",
  "テクスチャー、成分感、マクロ質感、商品画像の見た目フック。商品と無関係な成分・カテゴリは足さない。",
  "漫画、ツッコミ、ミーム、違和感コピー。笑えるが商品特徴から外れない表現にする。",
  "TV紹介風、新聞・雑誌風、話題化・比較・ランキング風。ただし実在メディア掲載の断定はしない。",
  "高級感、ブランド感、大人の美容広告、綺麗な人物モデルを一部混ぜる。人物だらけにはしない。",
  "使用シーン、生活導線、Before/After風、悩みのある瞬間。ただし効果の断定や過剰表現は避ける。",
  "競合広告の中で埋もれない強いビジュアルフック、誤認ネタ、意外な見立て。商品事実に接地する。",
  "自由枠。前のチャンクと違う別角度で、モデル自身に大胆な勝ちバナー案を考えさせる。",
];
const imageAspectOptions = [
  { value: "1024x1024", label: "1:1 正方形" },
  { value: "1536x1024", label: "3:2 横長" },
  { value: "1024x1536", label: "2:3 縦長" },
  { value: "4:5", label: "4:5 SNS縦" },
  { value: "5:4", label: "5:4 横" },
  { value: "9:16", label: "9:16 縦長" },
  { value: "16:9", label: "16:9 横長" },
  { value: "3:4", label: "3:4 縦" },
  { value: "4:3", label: "4:3 横" },
  { value: "auto", label: "自動" },
];
function defaultStepCodexSettings(): Record<PromptStep, CodexSettings> {
  return {
    ideas: { ...DEFAULT_CODEX_SETTINGS },
    sheets: { ...DEFAULT_CODEX_SETTINGS },
    final: { ...DEFAULT_CODEX_SETTINGS },
  };
}
function normalizeCodexSettings(value?: Partial<CodexSettings>): CodexSettings {
  const model = value?.model || DEFAULT_CODEX_SETTINGS.model;
  const effortOptions: CodexSettings["effort"][] = ["low", "medium", "high", "xhigh"];
  const serviceTierOptions: CodexSettings["serviceTier"][] = ["auto", "fast"];
  return {
    model: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"].includes(model) ? model : DEFAULT_CODEX_SETTINGS.model,
    effort: value?.effort && effortOptions.includes(value.effort) ? value.effort : DEFAULT_CODEX_SETTINGS.effort,
    serviceTier: value?.serviceTier && serviceTierOptions.includes(value.serviceTier) ? value.serviceTier : DEFAULT_CODEX_SETTINGS.serviceTier,
  };
}
function normalizeIdeaGenerationSettings(value?: Partial<IdeaGenerationSettings>): IdeaGenerationSettings {
  const chunkSize = Math.min(40, Math.max(4, Math.round(Number(value?.chunkSize) || DEFAULT_IDEA_GENERATION_SETTINGS.chunkSize)));
  return {
    chunkSize,
    themeMode: value?.themeMode === "wide" ? "wide" : DEFAULT_IDEA_GENERATION_SETTINGS.themeMode,
    overlapAvoidance: value?.overlapAvoidance === "normal" ? "normal" : DEFAULT_IDEA_GENERATION_SETTINGS.overlapAvoidance,
  };
}
type ProgressState = {
  active: boolean;
  title: string;
  detail: string;
  current: number;
  total: number;
};
type HoverPreview = {
  url: string;
  caption?: string;
  x: number;
  y: number;
  placement: "above" | "below";
};
type RefineAnnotation = {
  id: string;
  kind: "pin" | "box";
  x: number;
  y: number;
  width?: number;
  height?: number;
  text: string;
};
type RefineAnnotationDraft = {
  startX: number;
  startY: number;
  x: number;
  y: number;
  width: number;
  height: number;
} | null;
type FolderDropZone = "inside" | "before" | "after";
type FolderDragState = {
  source: string;
  target: string;
  zone: FolderDropZone | "";
  movedTo?: string;
};
type MarqueeSelectionState = {
  active: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

const bannerPresets: BannerPreset[] = [
  { count: 4, divisions: 4, sheetRuns: 1 },
  { count: 8, divisions: 4, sheetRuns: 2 },
  { count: 12, divisions: 4, sheetRuns: 3 },
  { count: 16, divisions: 4, sheetRuns: 4 },
  { count: 20, divisions: 4, sheetRuns: 5 },
  { count: 24, divisions: 4, sheetRuns: 6 },
  { count: 32, divisions: 4, sheetRuns: 8 },
  { count: 36, divisions: 4, sheetRuns: 9 },
  { count: 40, divisions: 4, sheetRuns: 10 },
  { count: 48, divisions: 4, sheetRuns: 12 },
  { count: 60, divisions: 4, sheetRuns: 15 },
  { count: 80, divisions: 4, sheetRuns: 20 },
  { count: 100, divisions: 4, sheetRuns: 25 },
  { count: 200, divisions: 4, sheetRuns: 50 },
  { count: 300, divisions: 4, sheetRuns: 75 },
];

const HISTORY_UPDATE_SHEET_INTERVAL = 5;
const LOG_VARIANT_DETAIL_LIMIT = 24;

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

function formatDebug(debug?: ApiDebug) {
  if (!debug) return "";
  const parts = [];
  if (debug.step) parts.push(`step=${debug.step}`);
  if (typeof debug.durationMs === "number") parts.push(`${debug.durationMs}ms`);
  if (debug.codexBin) parts.push(`codex=${debug.codexBin}`);
  if (debug.jobId) parts.push(`job=${debug.jobId}`);
  if (debug.codexJobId) parts.push(`codexJob=${debug.codexJobId}`);
  if (typeof debug.requestedSheets === "number") parts.push(`requestedSheets=${debug.requestedSheets}`);
  if (typeof debug.returnedImages === "number") parts.push(`returnedImages=${debug.returnedImages}`);
  if (debug.events?.length) parts.push(`events=${debug.events.join(",")}`);
  if (debug.revisedPrompt) parts.push(`revised=${debug.revisedPrompt.slice(0, 240)}`);
  if (debug.fallbackReason) parts.push(`fallback=${debug.fallbackReason}`);
  return parts.join(" / ");
}

function formatVariantsForLog(variants: Variant[]) {
  const visible = variants.slice(0, LOG_VARIANT_DETAIL_LIMIT);
  const lines = visible.map((variant) => `${variant.globalIndex || variant.index}. ${variant.appeal || ""} / ${variant.prompt}`);
  if (variants.length > visible.length) lines.push(`...ほか${variants.length - visible.length}案`);
  return lines.join("\n");
}

function previousIdeasSummary(variants: Variant[], max = 28) {
  if (!variants.length) return "なし";
  const recent = variants.slice(-max);
  const lines = recent.map((variant) => `${variant.globalIndex || variant.index}. ${variant.appeal || ""} / ${variant.prompt}`.slice(0, 220));
  if (variants.length > recent.length) lines.unshift(`既出案は合計${variants.length}件。以下は直近${recent.length}件の要約。`);
  return lines.join("\n");
}

function ideaChunkTheme(chunkIndex: number, chunkCount: number, settings: IdeaGenerationSettings) {
  if (chunkCount <= 1) return "全体バランスを見て、王道・変化球・テイスト主導・商品特徴主導を混ぜる。";
  const base = IDEA_CHUNK_THEMES[(chunkIndex - 1) % IDEA_CHUNK_THEMES.length];
  const spread = settings.themeMode === "wide"
    ? "このチャンクでは前後のチャンクと見た目の系統を大きく変え、広告表現の幅を最大化する。"
    : "このチャンクでは品質と実用性を保ちながら、前後のチャンクと訴求・見た目が被らないようにする。";
  return `チャンク${chunkIndex}/${chunkCount}の担当テーマ: ${base}\n${spread}`;
}

function rateLimitLabel(windowDurationMins?: number) {
  if (windowDurationMins === 300) return "5時間";
  if (windowDurationMins === 10080) return "週あたり";
  if (!windowDurationMins) return "制限";
  if (windowDurationMins % 1440 === 0) return `${windowDurationMins / 1440}日`;
  if (windowDurationMins % 60 === 0) return `${windowDurationMins / 60}時間`;
  return `${windowDurationMins}分`;
}

function formatRateReset(seconds?: number) {
  if (!seconds) return "";
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameDate = sameYear && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDate) return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("ja-JP", sameYear ? { month: "numeric", day: "numeric" } : { year: "numeric", month: "numeric", day: "numeric" });
}

function toRateWindow(window: any): RateLimitWindow | undefined {
  if (!window || typeof window.usedPercent !== "number") return undefined;
  return {
    label: rateLimitLabel(window.windowDurationMins),
    usedPercent: Math.max(0, Math.min(100, Math.round(window.usedPercent))),
    resetsAt: typeof window.resetsAt === "number" ? window.resetsAt : undefined,
  };
}

function makeClientId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function yieldToBrowser() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

  function parentFolderOf(folder: string) {
    const parts = folder.split("/").filter(Boolean);
    parts.pop();
    return parts.join("/");
  }

function isSameOrDescendantFolder(folder: string, ancestor: string) {
  return folder === ancestor || folder.startsWith(`${ancestor}/`);
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function safeDownloadName(value: string) {
  return (value || "banners").replace(/[\\/:*?"<>|#%{}^~[\]`;\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "banners";
}

function makeImageRow(): NewImageRow {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file: null, description: "" };
}

function revokePreview(row: NewImageRow) {
  if (row.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(row.previewUrl);
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("generate");
  const [products, setProducts] = useState<Product[]>([]);
  const [brands, setBrands] = useState<Brand[]>(INITIAL_BRAND_OPTIONS.map((name, index) => ({ id: `initial-${index}`, name, createdAt: "" })));
  const [selectedProductId, setSelectedProductId] = useState("");
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [newBrandName, setNewBrandName] = useState(DEFAULT_BRAND);
  const [newBrandDraft, setNewBrandDraft] = useState("");
  const [editingBrandId, setEditingBrandId] = useState("");
  const [editingBrandName, setEditingBrandName] = useState("");
  const [brandModalOpen, setBrandModalOpen] = useState(false);
  const [newProductName, setNewProductName] = useState("");
  const [newProductNotes, setNewProductNotes] = useState("");
  const [newProductPriceInfo, setNewProductPriceInfo] = useState("");
  const [newImages, setNewImages] = useState<NewImageRow[]>([makeImageRow()]);
  const newImagesRef = useRef<NewImageRow[]>(newImages);
  const historyAutoRestoredRef = useRef(false);
  const activeCancelKeyRef = useRef("");
  const activeAbortRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  const libraryUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [sheetUrls, setSheetUrls] = useState<string[]>([]);
  const [sheetVariants, setSheetVariants] = useState<Variant[]>([]);
  const [selected, setSelected] = useState<Variant | null>(null);
  const [finalUrl, setFinalUrl] = useState("");
  const [savedBanners, setSavedBanners] = useState<SavedBanner[]>([]);
  const [saveTree, setSaveTree] = useState<SavedNode | null>(null);
  const [saveRootPath, setSaveRootPath] = useState("");
  const [selectedSaveFolder, setSelectedSaveFolder] = useState("");
  const [libraryView, setLibraryView] = useState<"saved" | "unsaved">("saved");
  const [unsavedHistoryFilter, setUnsavedHistoryFilter] = useState("");
  const [newSaveFolderName, setNewSaveFolderName] = useState("");
  const [libraryFolderWidth, setLibraryFolderWidth] = useState(340);
  const [libraryThumbSize, setLibraryThumbSize] = useState(72);
  const [genLibraryHeight, setGenLibraryHeight] = useState(300);
  const [genSettingsWidth, setGenSettingsWidth] = useState(320);
  const [historyRecords, setHistoryRecords] = useState<HistoryRecord[]>([]);
  const [orphanHistoryRecords, setOrphanHistoryRecords] = useState<HistoryRecord[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState("");
  const [direction, setDirection] = useState("");
  const [priceInfo, setPriceInfo] = useState("");
  const [priceMode, setPriceMode] = useState<"all" | "mixed" | "none">("all");
  const [createMode, setCreateMode] = useState<CreateMode>("product");
  const [imageSourcePickerOpen, setImageSourcePickerOpen] = useState(false);
  const [imageSourceFolder, setImageSourceFolder] = useState("");
  const [imageSourceSearch, setImageSourceSearch] = useState("");
  const [imageSourceUrl, setImageSourceUrl] = useState("");
  const [imageAnalysis, setImageAnalysis] = useState<BannerAnalysisResult | null>(null);
  const [imageAnalysisBusy, setImageAnalysisBusy] = useState(false);
  const [editInstruction, setEditInstruction] = useState("");
  const [finalEditInstruction, setFinalEditInstruction] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1024x1024");
  const [status, setStatus] = useState("商品を選んでスタート");
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [libraryRefineBusy, setLibraryRefineBusy] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>("default");
  const [progress, setProgress] = useState<ProgressState>({ active: false, title: "待機中", detail: "", current: 0, total: 0 });
  const [divisions, setDivisions] = useState(4);
  const [sheetRuns, setSheetRuns] = useState(2);
  const [imagesPerRequest, setImagesPerRequest] = useState(1);
  const [stepCodexSettings, setStepCodexSettings] = useState<Record<PromptStep, CodexSettings>>(defaultStepCodexSettings);
  const [ideaGenerationSettings, setIdeaGenerationSettings] = useState<IdeaGenerationSettings>(DEFAULT_IDEA_GENERATION_SETTINGS);
  const [promptPresets, setPromptPresets] = useState<PromptPreset[]>([]);
  const [selectedPromptPresetIds, setSelectedPromptPresetIds] = useState<Record<PromptStep, string>>({ ideas: "default-ideas", sheets: "default-sheets", final: "default-final" });
  const [promptDraftStep, setPromptDraftStep] = useState<PromptStep>("ideas");
  const [promptDraftId, setPromptDraftId] = useState("");
  const [promptDraftName, setPromptDraftName] = useState("");
  const [promptDraftTemplate, setPromptDraftTemplate] = useState("");
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [logs, setLogs] = useState<DebugEntry[]>([
    { id: "init", time: "--:--:--", level: "info", title: "準備OK", detail: "商品を選んでバナーを作りましょう" },
  ]);
  const [previewVariant, setPreviewVariant] = useState<Variant | null>(null);
  const [libSelectedUrl, setLibSelectedUrl] = useState("");
  const [libSelectedUrls, setLibSelectedUrls] = useState<Set<string>>(new Set());
  const [libSelectionAnchorUrl, setLibSelectionAnchorUrl] = useState("");
  const [libAspectRatio, setLibAspectRatio] = useState("1024x1024");
  const [libEditInstruction, setLibEditInstruction] = useState("");
  const [libFinalUrl, setLibFinalUrl] = useState("");
  const [libRefineOpen, setLibRefineOpen] = useState(false);
  const [refineAnnotations, setRefineAnnotations] = useState<RefineAnnotation[]>([]);
  const [refineAnnotationTool, setRefineAnnotationTool] = useState<"pin" | "box">("pin");
  const [refineAnnotationDraft, setRefineAnnotationDraft] = useState<RefineAnnotationDraft>(null);
  const [activeRefineAnnotationId, setActiveRefineAnnotationId] = useState("");
  const [versionModalUrl, setVersionModalUrl] = useState("");
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryRatingFilter, setLibraryRatingFilter] = useState("all");
  const [libraryDetailCollapsed, setLibraryDetailCollapsed] = useState(false);
  const [ratingHover, setRatingHover] = useState<{ url: string; rating: number } | null>(null);
  const [selectedCropUrls, setSelectedCropUrls] = useState<Set<string>>(new Set());
  const [cropSelectionAnchorUrl, setCropSelectionAnchorUrl] = useState("");
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null);
  const [folderDrag, setFolderDrag] = useState<FolderDragState>({ source: "", target: "", zone: "" });
  const [libraryFileDropTarget, setLibraryFileDropTarget] = useState<string | null>(null);
  const [marqueeSelection, setMarqueeSelection] = useState<MarqueeSelectionState>({ active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 });

  const selectedProduct = products.find((product) => product.id === selectedProductId) || products[0];
  const totalCandidates = divisions * sheetRuns;
  const generationTotal = totalCandidates;
  const matchedPreset = bannerPresets.find((preset) => preset.count === totalCandidates && preset.divisions === divisions && preset.sheetRuns === sheetRuns);
  const productInput: ProductInput | null = useMemo(() => {
    if (!selectedProduct) return null;
    const firstImage = selectedProduct.images?.[0];
    return {
      productId: selectedProduct.id,
      brandName: selectedProduct.brandName,
      productName: selectedProduct.name,
      productImageUrl: firstImage?.url || selectedProduct.imageUrl,
      productImagePath: firstImage?.path || selectedProduct.imagePath,
      productImages: selectedProduct.images || [],
      notes: [selectedProduct.notes, direction].filter(Boolean).join("\n"),
      priceInfo: priceInfo.trim(),
      priceMode: priceInfo.trim() ? priceMode : "none",
      format: "WEB広告バナー候補",
    };
  }, [selectedProduct, direction, priceInfo, priceMode]);

  const brandOptions = brands.map((brand) => brand.name);
  const activePromptTemplates = useMemo(() => {
    const findTemplate = (step: PromptStep) => promptPresets.find((preset) => preset.id === selectedPromptPresetIds[step] && preset.step === step)?.template;
    return {
      ideas: findTemplate("ideas"),
      sheets: findTemplate("sheets"),
      final: findTemplate("final"),
    };
  }, [promptPresets, selectedPromptPresetIds]);

  useEffect(() => { void loadBrands(); void loadProducts(); void loadSaveTree(); void loadHistory(true); void loadPromptPresets(); loadStepCodexSettings(); loadIdeaGenerationSettings(); }, []);

  useEffect(() => {
    void loadRateLimitInfo();
    const timer = window.setInterval(() => void loadRateLimitInfo(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  useEffect(() => {
    newImagesRef.current = newImages;
  }, [newImages]);

  useEffect(() => () => {
    for (const row of newImagesRef.current) {
      revokePreview(row);
    }
  }, []);

  async function loadProducts() {
    const response = await fetch("/api/products");
    const data = (await response.json()) as { products: Product[] };
    setProducts(data.products);
    if (data.products[0]) {
      setSelectedProductId(data.products[0].id);
      setPriceInfo(data.products[0].priceInfo || "");
    }
  }

  async function loadBrands() {
    const response = await fetch("/api/brands");
    const data = (await response.json()) as { brands: Brand[] };
    const next = data.brands?.length ? data.brands : INITIAL_BRAND_OPTIONS.map((name, index) => ({ id: `initial-${index}`, name, createdAt: "" }));
    setBrands(next);
    setNewBrandName((current) => current || next[0]?.name || "");
  }

  async function loadPromptPresets() {
    try {
      const response = await fetch("/api/prompt-presets", { cache: "no-store" });
      const data = (await response.json()) as { presets: PromptPreset[] };
      const presets = data.presets || [];
      setPromptPresets(presets);
      setSelectedPromptPresetIds((current) => {
        const stored = typeof window !== "undefined" ? window.localStorage.getItem("selectedPromptPresetIds") : "";
        let parsed: Partial<Record<PromptStep, string>> = {};
        try {
          parsed = stored ? JSON.parse(stored) as Partial<Record<PromptStep, string>> : {};
        } catch {
          parsed = {};
        }
        const next = { ...current, ...parsed };
        for (const step of Object.keys(promptStepLabels) as PromptStep[]) {
          if (!presets.some((preset) => preset.step === step && preset.id === next[step])) next[step] = `default-${step}`;
        }
        return next;
      });
    } catch (error) {
      addLog({ level: "error", title: "プロンプト設定の読み込み失敗", detail: error instanceof Error ? error.message : String(error) });
    }
  }

  function promptPresetsFor(step: PromptStep) {
    return promptPresets.filter((preset) => preset.step === step);
  }

  function selectedPromptPreset(step: PromptStep) {
    return promptPresetsFor(step).find((preset) => preset.id === selectedPromptPresetIds[step]) || promptPresetsFor(step)[0];
  }

  function promptMissingVariables(step: PromptStep, template = promptDraftTemplate) {
    return promptRequiredVariables[step].filter((key) => !template.includes(`{{${key}}}`) && !fixedPromptVariableCoverage[step].includes(key));
  }

  function choosePromptPreset(step: PromptStep, id: string) {
    const next = { ...selectedPromptPresetIds, [step]: id };
    setSelectedPromptPresetIds(next);
    if (typeof window !== "undefined") window.localStorage.setItem("selectedPromptPresetIds", JSON.stringify(next));
    setStatus(`${promptStepLabels[step]} のプリセットを切り替えました`);
  }

  function loadStepCodexSettings() {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("stepCodexSettings");
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as Partial<Record<PromptStep, Partial<CodexSettings>>>;
      setStepCodexSettings((current) => {
        const next = { ...current };
        for (const step of Object.keys(promptStepLabels) as PromptStep[]) {
          next[step] = normalizeCodexSettings({ ...current[step], ...(parsed[step] || {}) });
        }
        return next;
      });
    } catch {
      window.localStorage.removeItem("stepCodexSettings");
    }
  }

  function updateStepCodexSettings(step: PromptStep, patch: Partial<CodexSettings>) {
    setStepCodexSettings((current) => {
      const next = { ...current, [step]: { ...current[step], ...patch } };
      if (typeof window !== "undefined") window.localStorage.setItem("stepCodexSettings", JSON.stringify(next));
      return next;
    });
  }

  function loadIdeaGenerationSettings() {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("ideaGenerationSettings");
    if (!stored) return;
    try {
      setIdeaGenerationSettings(normalizeIdeaGenerationSettings(JSON.parse(stored) as Partial<IdeaGenerationSettings>));
    } catch {
      window.localStorage.removeItem("ideaGenerationSettings");
    }
  }

  function updateIdeaGenerationSettings(patch: Partial<IdeaGenerationSettings>) {
    setIdeaGenerationSettings((current) => {
      const next = normalizeIdeaGenerationSettings({ ...current, ...patch });
      if (typeof window !== "undefined") window.localStorage.setItem("ideaGenerationSettings", JSON.stringify(next));
      return next;
    });
  }

  function openPromptPresetEditor(step: PromptStep, mode: "create" | "edit" | "copy", preset?: PromptPreset) {
    const base = preset || selectedPromptPreset(step) || promptPresetsFor(step)[0];
    setPromptDraftStep(step);
    setPromptDraftId(mode === "edit" && base ? base.id : "");
    setPromptDraftName(mode === "create" ? "" : base ? mode === "copy" ? `${base.name}のコピー` : base.name : "");
    setPromptDraftTemplate(mode === "create" ? base?.template || "" : base?.template || "");
    setPromptEditorOpen(true);
  }

  function closePromptPresetEditor() {
    setPromptEditorOpen(false);
    setPromptDraftId("");
    setPromptDraftName("");
    setPromptDraftTemplate("");
  }

  function editPromptPreset(preset: PromptPreset, copy = false) {
    setPromptDraftStep(preset.step);
    setPromptDraftId(copy ? "" : preset.id);
    setPromptDraftName(copy ? `${preset.name}のコピー` : preset.name);
    setPromptDraftTemplate(preset.template);
    setTab("settings");
    setPromptEditorOpen(true);
  }

  function insertPromptVariable(key: string) {
    setPromptDraftTemplate((current) => `${current}${current.endsWith("\n") || !current ? "" : "\n"}{{${key}}}`);
  }

  async function savePromptPreset() {
    const missing = promptMissingVariables(promptDraftStep);
    if (missing.length) {
      setStatus(`必須変数が不足しています: ${missing.map((key) => `{{${key}}}`).join(", ")}`);
      return;
    }
    if (!promptDraftName.trim() || !promptDraftTemplate.trim()) {
      setStatus("プリセット名とプロンプトを入力してください");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/prompt-presets", {
        method: promptDraftId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(promptDraftId
          ? { id: promptDraftId, name: promptDraftName, template: promptDraftTemplate }
          : { step: promptDraftStep, name: promptDraftName, template: promptDraftTemplate }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as { presets: PromptPreset[]; preset?: PromptPreset };
      setPromptPresets(data.presets || []);
      if (data.preset?.id) choosePromptPreset(data.preset.step, data.preset.id);
      setPromptDraftId(data.preset?.id || promptDraftId);
      setPromptEditorOpen(false);
      setStatus("プロンプトプリセットを保存しました");
      addLog({ level: "success", title: "プロンプト保存", detail: `${promptStepLabels[promptDraftStep]} / ${promptDraftName}` });
    } catch (error) {
      setStatus("プロンプト保存エラー");
      addLog({ level: "error", title: "プロンプト保存エラー", detail: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function deletePromptPreset(preset: PromptPreset) {
    if (preset.builtIn) {
      setStatus("デフォルトプリセットは削除できません");
      return;
    }
    const ok = window.confirm(`プリセット「${preset.name}」を削除しますか？`);
    if (!ok) return;
    setBusy(true);
    try {
      const response = await fetch("/api/prompt-presets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: preset.id }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as { presets: PromptPreset[] };
      setPromptPresets(data.presets || []);
      if (selectedPromptPresetIds[preset.step] === preset.id) choosePromptPreset(preset.step, `default-${preset.step}`);
      if (promptDraftId === preset.id) {
        setPromptDraftId("");
        setPromptDraftName("");
        setPromptDraftTemplate("");
      }
      setStatus("プロンプトプリセットを削除しました");
    } catch (error) {
      setStatus("プロンプト削除エラー");
      addLog({ level: "error", title: "プロンプト削除エラー", detail: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function createBrand() {
    const name = newBrandDraft.trim();
    if (!name) {
      setStatus("ブランド名を入力してください");
      return;
    }
    try {
      const response = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as { brands: Brand[] };
      setBrands(data.brands);
      setNewBrandName(name);
      setNewBrandDraft("");
      setBrandModalOpen(false);
      setStatus("ブランドを追加しました");
    } catch (error) {
      setStatus("ブランド追加エラー");
      addLog({ level: "error", title: "ブランド追加エラー", detail: error instanceof Error ? error.message : String(error) });
    }
  }

  async function updateBrand() {
    const name = editingBrandName.trim();
    if (!editingBrandId || !name) {
      setStatus("編集するブランドを選んでください");
      return;
    }
    const current = brands.find((brand) => brand.id === editingBrandId);
    try {
      const response = await fetch("/api/brands", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingBrandId, oldName: current?.name, name }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as { brands: Brand[]; affectedProducts: number };
      setBrands(data.brands);
      if (newBrandName === current?.name) setNewBrandName(name);
      if (current?.name) {
        setProducts((items) => items.map((product) => product.brandName === current.name ? { ...product, brandName: name } : product));
      }
      setEditingBrandId("");
      setEditingBrandName("");
      setStatus(data.affectedProducts ? `ブランド名を更新しました。既存商品${data.affectedProducts}件にも反映しました` : "ブランド名を更新しました");
    } catch (error) {
      setStatus("ブランド更新エラー");
      addLog({ level: "error", title: "ブランド更新エラー", detail: error instanceof Error ? error.message : String(error) });
    }
  }

  async function deleteBrand(brand: Brand) {
    const ok = window.confirm(`ブランド「${brand.name}」を削除しますか？`);
    if (!ok) return;
    try {
      const response = await fetch("/api/brands", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: brand.id }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as { brands: Brand[] };
      setBrands(data.brands);
      if (newBrandName === brand.name) setNewBrandName(data.brands[0]?.name || "");
      if (editingBrandId === brand.id) {
        setEditingBrandId("");
        setEditingBrandName("");
      }
      setStatus("ブランドを削除しました");
    } catch (error) {
      setStatus("ブランド削除エラー");
      addLog({ level: "error", title: "ブランド削除エラー", detail: error instanceof Error ? error.message : String(error) });
    }
  }

  async function loadRateLimitInfo() {
    try {
      const response = await fetch("/api/logs?limit=500", { cache: "no-store" });
      const data = (await response.json()) as { logs: RequestLogEntry[] };
      const latest = [...(data.logs || [])].reverse().find((log) => log.message?.includes("account/rateLimits/updated") || log.detail?.method === "account/rateLimits/updated");
      if (!latest) return;
      const rateLimits = latest.detail?.params?.rateLimits;
      if (!rateLimits) return;
      setRateLimitInfo({
        updatedAt: latest.time || "",
        planType: rateLimits.planType,
        reachedType: rateLimits.rateLimitReachedType,
        primary: toRateWindow(rateLimits.primary),
        secondary: toRateWindow(rateLimits.secondary),
      });
    } catch {
      // 状態表示だけなので、ログ取得失敗は無視する。
    }
  }

  async function loadSaveTree() {
    const response = await fetch("/api/export");
    const data = (await response.json()) as { tree: SavedNode; rootPath: string };
    setSaveTree(data.tree);
    setSaveRootPath(data.rootPath);
  }

  async function loadHistory(autoRestore = false) {
    const response = await fetch("/api/history");
    const data = (await response.json()) as { history: HistoryRecord[]; orphanHistory?: HistoryRecord[] };
    setHistoryRecords(data.history || []);
    setOrphanHistoryRecords(data.orphanHistory || []);
    if (autoRestore && !historyAutoRestoredRef.current && data.history?.length) {
      historyAutoRestoredRef.current = true;
      const lastId = typeof window !== "undefined" ? window.localStorage.getItem("lastGenerationHistoryId") : "";
      const record = data.history.find((item) => item.id === lastId) || data.history[0];
      applyHistoryRecord(record, true);
    }
  }

  function selectProductForGeneration(productId: string) {
    const product = products.find((item) => item.id === productId);
    setSelectedProductId(productId);
    setPriceInfo(product?.priceInfo || "");
    resetGenerated();
  }

  function applyBannerPreset(preset: BannerPreset) {
    setDivisions(preset.divisions);
    setSheetRuns(preset.sheetRuns);
    resetGenerated();
  }

  function addLog(entry: Omit<DebugEntry, "id" | "time">) {
    setLogs((current) => [{ ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, time: new Date().toLocaleTimeString() }, ...current].slice(0, 120));
  }

  function startProgress(title: string, detail: string, total: number) {
    setProgress({ active: true, title, detail, current: 0, total });
  }

  function updateProgress(patch: Partial<ProgressState>) {
    setProgress((current) => ({ ...current, ...patch, active: patch.active ?? current.active }));
  }

  function finishProgress(title: string, detail = "") {
    setProgress((current) => ({
      active: false,
      title,
      detail,
      current: current.total || current.current,
      total: current.total,
    }));
  }

  async function ensureDesktopNotificationPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      addLog({ level: "warn", title: "デスクトップ通知", detail: "このブラウザは通知に対応していません" });
      return false;
    }
    if (Notification.permission === "granted") {
      setNotificationPermission("granted");
      return true;
    }
    if (Notification.permission === "denied") {
      setNotificationPermission("denied");
      addLog({ level: "warn", title: "デスクトップ通知", detail: "ブラウザ側で通知が拒否されています。サイト設定から通知を許可してください。" });
      return false;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    addLog({
      level: permission === "granted" ? "success" : "warn",
      title: "デスクトップ通知",
      detail: permission === "granted" ? "生成完了時に通知します" : "通知が許可されませんでした",
    });
    return permission === "granted";
  }

  function notifyDesktop(title: string, body: string) {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    new Notification(title, {
      body,
      tag: "banner-generation-status",
    });
  }

  function resetGenerated() {
    setSheetUrls([]);
    setSheetVariants([]);
    setSelected(null);
    clearCropSelection();
    setSelectedHistoryId("");
    setEditInstruction("");
    resetFinalOnly();
  }

  function clearCropSelection() {
    setSelectedCropUrls(new Set());
    setCropSelectionAnchorUrl("");
  }

  function historyLabel(record: HistoryRecord) {
    const date = new Date(record.createdAt);
    const dateText = Number.isNaN(date.getTime()) ? record.createdAt : date.toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    const product = [record.input?.brandName, record.input?.productName].filter(Boolean).join(" / ");
    return `${dateText}  ${product || "商品不明"}  ${record.ideas?.length || 0}案`;
  }

  function applyHistoryRecord(record: HistoryRecord, silent = false) {
    setSelectedHistoryId(record.id);
    if (!record) return;
    const urls = record.sheetUrls?.length ? record.sheetUrls : record.sheetUrl ? [record.sheetUrl] : [];
    setSheetUrls(urls);
    setSheetVariants(record.ideas || []);
    setSelected(null);
    clearCropSelection();
    setEditInstruction("");
    setFinalUrl(record.finalUrl || "");
    setFinalEditInstruction("");
    const settings = record.generationSettings;
    if (settings?.productId || record.input?.productId) setSelectedProductId(settings?.productId || record.input.productId || "");
    if (settings?.direction !== undefined) setDirection(settings.direction || "");
    if (settings?.priceInfo !== undefined) setPriceInfo(settings.priceInfo || "");
    else if (record.input?.priceInfo !== undefined) setPriceInfo(record.input.priceInfo || "");
    if (settings?.priceMode) setPriceMode(settings.priceMode);
    else if (record.input?.priceMode) setPriceMode(record.input.priceMode);
    if (settings?.divisions) setDivisions(settings.divisions);
    if (settings?.sheetRuns) setSheetRuns(settings.sheetRuns);
    if (settings?.imagesPerRequest) setImagesPerRequest(settings.imagesPerRequest);
    if (settings?.ideaChunkSize || settings?.ideaThemeMode || settings?.ideaOverlapAvoidance) {
      setIdeaGenerationSettings(normalizeIdeaGenerationSettings({
        chunkSize: settings.ideaChunkSize,
        themeMode: settings.ideaThemeMode,
        overlapAvoidance: settings.ideaOverlapAvoidance,
      }));
    }
    if (typeof window !== "undefined") window.localStorage.setItem("lastGenerationHistoryId", record.id);
    setStatus(silent ? `${historyLabel(record)} を復元しました` : `${historyLabel(record)} を再表示しました`);
    addLog({
      level: "success",
      title: silent ? "前回の生成結果を復元" : "履歴を再表示",
      detail: `${historyLabel(record)}
シート=${urls.length}枚 / 候補=${record.ideas?.length || 0}案
設定=${settings ? `${settings.divisions || "-"}分割 × ${settings.sheetRuns || "-"}回 / 1度で${settings.imagesPerRequest || "-"}枚` : "旧履歴のため作成設定なし"}`,
    });
  }

  function loadHistoryRecord(recordId: string) {
    const record = historyRecords.find((item) => item.id === recordId);
    setSelectedHistoryId(recordId);
    if (!record) return;
    applyHistoryRecord(record);
  }

  async function saveGenerationHistory(input: ProductInput, variants: Variant[], urls: string[], recordId?: string) {
    const result = await postJson<{ record: HistoryRecord; history: HistoryRecord[] }>("/api/save", {
      id: recordId,
      input,
      generationSettings: {
        productId: input.productId,
        direction,
        priceInfo,
        priceMode,
        divisions,
        sheetRuns,
        imagesPerRequest,
        ideaChunkSize: ideaGenerationSettings.chunkSize,
        ideaThemeMode: ideaGenerationSettings.themeMode,
        ideaOverlapAvoidance: ideaGenerationSettings.overlapAvoidance,
      },
      ideas: variants,
      sheetUrl: urls[0],
      sheetUrls: urls,
    });
    setHistoryRecords(result.history || []);
    setSelectedHistoryId(result.record.id);
    if (typeof window !== "undefined") window.localStorage.setItem("lastGenerationHistoryId", result.record.id);
    return result.record;
  }

  function resetFinalOnly() {
    setFinalUrl("");
    setFinalEditInstruction("");
  }

  function updateImageRow(id: string, patch: Partial<NewImageRow>) {
    setNewImages((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function resetProductForm() {
    setEditingProductId(null);
    setNewBrandName(brandOptions[0] || DEFAULT_BRAND);
    setNewProductName("");
    setNewProductNotes("");
    setNewProductPriceInfo("");
    setNewImages((rows) => {
      for (const row of rows) revokePreview(row);
      return [makeImageRow()];
    });
  }

  function removeProductImageRow(row: NewImageRow, index: number) {
    const ok = window.confirm(`商品画像${index + 1}を削除しますか？`);
    if (!ok) return;
    setNewImages((rows) => {
      revokePreview(row);
      const next = rows.filter((item) => item.id !== row.id);
      return next.length ? next : [makeImageRow()];
    });
  }

  function loadProductForEdit(product: Product) {
    setTab("products");
    setEditingProductId(product.id);
    setSelectedProductId(product.id);
    setNewBrandName(product.brandName || brandOptions[0] || DEFAULT_BRAND);
    setNewProductName(product.name);
    setNewProductNotes(product.notes || "");
    setNewProductPriceInfo(product.priceInfo || "");
    setNewImages((rows) => {
      for (const row of rows) revokePreview(row);
      const imageRows = (product.images || []).map((image) => ({
        id: image.id,
        file: null,
        description: image.description || "",
        previewUrl: image.url,
        existing: image,
      }));
      return imageRows.length ? imageRows : [makeImageRow()];
    });
    setStatus("商品を編集中");
  }

  function addImageFiles(files: File[]) {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;
    setNewImages((rows) => {
      const next = [...rows];
      for (const file of imageFiles) {
        const emptyIndex = next.findIndex((row) => !row.file && !row.existing && !row.previewUrl);
        const row = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, description: "", previewUrl: URL.createObjectURL(file) };
        if (emptyIndex >= 0) {
          revokePreview(next[emptyIndex]);
          next[emptyIndex] = { ...next[emptyIndex], file, previewUrl: row.previewUrl, existing: undefined };
        }
        else next.push(row);
      }
      return next;
    });
    setStatus(`画像を${imageFiles.length}枚追加しました`);
  }

  function handlePaste(event: React.ClipboardEvent) {
    const files = Array.from(event.clipboardData.files);
    addImageFiles(files);
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    addImageFiles(Array.from(event.dataTransfer.files));
  }

  async function addProduct() {
    const rowsWithFiles = newImages.filter((row) => row.file);
    const existingImages = newImages
      .filter((row) => row.existing && !row.file)
      .map((row) => ({ ...row.existing!, description: row.description }));
    if (!newProductName || (!existingImages.length && !rowsWithFiles.length)) {
      setStatus("商品名と画像を入力してください");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      if (editingProductId) form.set("id", editingProductId);
      form.set("brandName", newBrandName);
      form.set("name", newProductName);
      form.set("notes", newProductNotes);
      form.set("priceInfo", newProductPriceInfo);
      form.set("existingImages", JSON.stringify(existingImages));
      for (const row of rowsWithFiles) {
        if (row.file) {
          form.append("images", row.file);
          form.append("descriptions", row.description);
        }
      }
      const response = await fetch("/api/products", { method: "POST", body: form });
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as { product: Product; products: Product[] };
      setProducts(data.products);
      setSelectedProductId(data.product.id);
      setPriceInfo(data.product.priceInfo || "");
      resetProductForm();
      resetGenerated();
      setStatus(editingProductId ? "商品を更新しました" : "商品を登録しました");
      addLog({ level: "success", title: editingProductId ? "商品更新" : "商品登録", detail: `${data.product.brandName} ${data.product.name} / 画像${data.product.images.length}枚` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("商品登録エラー");
      addLog({ level: "error", title: "商品登録エラー", detail: message });
    } finally {
      setBusy(false);
    }
  }

  async function checkCodex() {
    setBusy(true);
    setStatus("接続テスト中…");
    try {
      const response = await fetch("/api/codex-check", { method: "POST" });
      const result = (await response.json()) as { ok: boolean; mode?: string; message: string; debug?: ApiDebug & { loginMessage?: string; stderr?: string } };
      if (!response.ok || !result.ok) {
        const loginHint = result.mode === "login-required"
          ? "\n\n対処: ターミナルで `codex login` を実行してログインし、このアプリを再起動してください。"
          : "";
        throw new Error(`${result.message || "Codex接続に失敗しました"}${loginHint}${result.debug?.loginMessage ? `\n\n詳細: ${result.debug.loginMessage}` : ""}`);
      }
      setStatus(result.message);
      addLog({ level: "success", title: "接続OK", detail: formatDebug(result.debug) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("接続テスト失敗");
      addLog({ level: "error", title: "接続テスト失敗", detail: message });
    } finally {
      setBusy(false);
    }
  }

  async function stopGeneration() {
    const cancelKey = activeCancelKeyRef.current;
    stopRequestedRef.current = true;
    activeAbortRef.current?.abort();
    setStopping(true);
    setStatus("停止しています…");
    finishProgress("停止中", "現在のCodex生成を停止しています");
    addLog({ level: "warn", title: "停止リクエスト", detail: cancelKey || "実行中の生成IDなし" });
    if (!cancelKey) {
      setBusy(false);
      setStopping(false);
      setStatus("停止しました");
      return;
    }
    try {
      const result = await postJson<{ cancelled: number }>("/api/cancel", { cancelKey });
      addLog({ level: "warn", title: "生成停止", detail: `停止対象プロセス=${result.cancelled}` });
    } catch (error) {
      addLog({ level: "error", title: "停止エラー", detail: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
      setStopping(false);
      setStatus("停止しました。途中までの候補は残しています");
      activeCancelKeyRef.current = "";
      activeAbortRef.current = null;
    }
  }

  async function generateBanners() {
    if (!productInput) {
      setStatus("まず商品を登録してください");
      setTab("products");
      return;
    }
    setBusy(true);
    setStopping(false);
    stopRequestedRef.current = false;
    const cancelKey = `generation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeCancelKeyRef.current = cancelKey;
    activeAbortRef.current = new AbortController();
    void ensureDesktopNotificationPermission();
    resetGenerated();
    const targetCount = generationTotal;
    const chunkDivision = divisions;
    const plannedSheets = Math.ceil(targetCount / chunkDivision);
    const requestImageCount = Math.min(2, Math.max(1, imagesPerRequest));
    const plannedRequests = Math.ceil(plannedSheets / requestImageCount);
    const requestModeLabel = `${divisions}分割シートを${requestImageCount}枚ずつ直列生成`;
    const ideaChunkSize = Math.min(targetCount, ideaGenerationSettings.chunkSize);
    const ideaChunkCount = Math.ceil(targetCount / ideaChunkSize);
    const totalProgressSteps = ideaChunkCount + plannedSheets;
    const historyId = makeClientId("project");
    type SheetResponse = { sheetUrl: string; variants: Variant[]; mode: Mode; debug?: ApiDebug; runIndex: number };
    const generatedSheetUrls: string[] = [];
    const generatedVariants: Variant[] = [];
    let lastHistorySaveSheetCount = 0;
    setStatus(`${targetCount}パターンを作成中…`);
    startProgress("バナー作成中", `訴求案を分割生成しています… 0/${ideaChunkCount}`, totalProgressSteps);
    addLog({
      level: "info",
      title: "バナー作成開始",
      detail: `${productInput.brandName || ""} ${productInput.productName} / ${targetCount}パターン
Step1=${stepCodexSettings.ideas.model} / ${stepCodexSettings.ideas.effort} / ${stepCodexSettings.ideas.serviceTier}
Step2=${stepCodexSettings.sheets.model} / ${stepCodexSettings.sheets.effort} / ${stepCodexSettings.sheets.serviceTier}
Step3=${stepCodexSettings.final.model} / ${stepCodexSettings.final.effort} / ${stepCodexSettings.final.serviceTier}
Step1分割=${ideaChunkSize}案ずつ × ${ideaChunkCount}回 / ${ideaGenerationSettings.themeMode} / ${ideaGenerationSettings.overlapAvoidance}
${requestModeLabel}`,
    });
    try {
      const ideaVariants: Variant[] = [];
      let ideaMode: Mode = "codex";
      let ideaOffset = 0;
      for (let chunkIndex = 1; ideaOffset < targetCount; chunkIndex += 1) {
        if (stopRequestedRef.current) throw new Error("ユーザーが生成を停止しました");
        const currentIdeaCount = Math.min(ideaChunkSize, targetCount - ideaOffset);
        const themeDirective = ideaChunkTheme(chunkIndex, ideaChunkCount, ideaGenerationSettings);
        updateProgress({ current: chunkIndex - 1, detail: `訴求案を分割生成しています… ${chunkIndex - 1}/${ideaChunkCount}` });
        const ideaResult = await postJson<{ variants: Variant[]; mode: Mode; debug?: ApiDebug }>("/api/ideas", {
          ...productInput,
          count: currentIdeaCount,
          totalCount: targetCount,
          chunkIndex,
          chunkCount: ideaChunkCount,
          startIndex: ideaOffset + 1,
          divisions: chunkDivision,
          sheetRuns: plannedSheets,
          previousIdeasSummary: previousIdeasSummary(ideaVariants),
          themeDirective,
          ideaSettings: ideaGenerationSettings,
          cancelKey,
          codexSettings: stepCodexSettings.ideas,
          promptTemplates: activePromptTemplates,
        }, activeAbortRef.current?.signal);
        if (stopRequestedRef.current) throw new Error("ユーザーが生成を停止しました");
        if (ideaResult.mode !== "codex") ideaMode = ideaResult.mode;
        const normalizedIdeas = ideaResult.variants.slice(0, currentIdeaCount).map((variant, index) => ({
          ...variant,
          index: index + 1,
          globalIndex: ideaOffset + index + 1,
        }));
        if (normalizedIdeas.length < currentIdeaCount) throw new Error(`訴求案が不足しました: chunk ${chunkIndex} returned ${normalizedIdeas.length}/${currentIdeaCount}`);
        ideaVariants.push(...normalizedIdeas);
        ideaOffset += normalizedIdeas.length;
        updateProgress({ current: chunkIndex, detail: `訴求案を分割生成しています… ${chunkIndex}/${ideaChunkCount}` });
        addLog({ level: "success", title: `Step 1: 案生成チャンク完了`, detail: `チャンク=${chunkIndex}/${ideaChunkCount}\n案=${ideaVariants.length}/${targetCount}\nテーマ=${themeDirective}\n${formatDebug(ideaResult.debug)}\n${formatVariantsForLog(normalizedIdeas)}` });
        await yieldToBrowser();
        if (!normalizedIdeas.length) throw new Error("訴求案生成が空で返りました");
      }
      if (ideaVariants.length < targetCount) throw new Error(`訴求案が不足しました: ${ideaVariants.length}/${targetCount}`);
      updateProgress({ current: ideaChunkCount, detail: `画像を生成しています… 0/${plannedSheets}シート` });
      addLog({ level: "success", title: `訴求案生成完了: ${ideaMode}`, detail: `案数=${ideaVariants.length}\n${formatVariantsForLog(ideaVariants)}` });
      addLog({ level: "info", title: "Step 2: 画像生成開始", detail: `Codexリクエストを直列実行\n予定リクエスト=${plannedRequests}回\n1度での画像生成数=${requestImageCount}枚\n1シート=${chunkDivision}分割\n合計=${targetCount}案` });
      let variantOffset = 0;
      let sheetOffset = 0;
      while (variantOffset < targetCount) {
        if (stopRequestedRef.current) throw new Error("ユーザーが生成を停止しました");
        const remaining = targetCount - variantOffset;
        const currentDivisions = remaining < chunkDivision ? remaining : chunkDivision;
        const remainingSheets = Math.ceil(remaining / currentDivisions);
        const currentSheetRuns = Math.min(requestImageCount, remainingSheets);
        const take = currentDivisions * currentSheetRuns;
        const chunkVariants = ideaVariants.slice(variantOffset, variantOffset + take);
        const sheetsResult = await postJson<{ sheets: SheetResponse[]; mode: Mode; debug?: ApiDebug }>("/api/sheets", {
          input: productInput,
          variants: chunkVariants,
          divisions: currentDivisions,
          sheetRuns: currentSheetRuns,
          cancelKey,
          codexSettings: stepCodexSettings.sheets,
          promptTemplates: activePromptTemplates,
        }, activeAbortRef.current?.signal);
        if (stopRequestedRef.current) throw new Error("ユーザーが生成を停止しました");
        const chunkSheets = sheetsResult.sheets.sort((a, b) => a.runIndex - b.runIndex).map((sheet) => ({
          ...sheet,
          runIndex: sheet.runIndex + sheetOffset,
          variants: sheet.variants.map((variant) => ({
            ...variant,
            sheetRun: (variant.sheetRun || sheet.runIndex) + sheetOffset,
            globalIndex: (variant.globalIndex || variant.index) + variantOffset,
          })),
        }));
        generatedSheetUrls.push(...chunkSheets.map((sheet) => sheet.sheetUrl));
        generatedVariants.push(...chunkSheets.flatMap((sheet) => sheet.variants));
        const partialVariants = generatedVariants.slice(0, targetCount);
        setSheetUrls([...generatedSheetUrls]);
        setSheetVariants(partialVariants);
        variantOffset += take;
        sheetOffset += currentSheetRuns;
        const shouldSaveHistory = sheetOffset === currentSheetRuns || sheetOffset - lastHistorySaveSheetCount >= HISTORY_UPDATE_SHEET_INTERVAL || variantOffset >= targetCount;
        if (shouldSaveHistory) {
          try {
            const partialRecord = await saveGenerationHistory(productInput, partialVariants, generatedSheetUrls, historyId);
            lastHistorySaveSheetCount = sheetOffset;
            addLog({ level: "success", title: "生成履歴を更新", detail: `${historyLabel(partialRecord)}\n途中結果=${partialVariants.length}/${targetCount}候補` });
          } catch (historyError) {
            addLog({ level: "warn", title: "生成履歴の途中保存に失敗", detail: historyError instanceof Error ? historyError.message : String(historyError) });
          }
        }
        updateProgress({ current: ideaChunkCount + sheetOffset, detail: `画像を生成しています… ${Math.min(sheetOffset, plannedSheets)}/${plannedSheets}シート` });
        addLog({ level: "success", title: `Step 2: 画像生成チャンク完了`, detail: `シート=${sheetOffset}/${plannedSheets}\n候補=${Math.min(variantOffset, targetCount)}/${targetCount}\n${formatDebug(sheetsResult.debug)}` });
        await yieldToBrowser();
      }
      if (!generatedSheetUrls.length) throw new Error(`画像生成がすべて失敗しました。詳細は実行状況と public/data/request-log.jsonl を確認してください。`);
      const allVariants = generatedVariants.slice(0, targetCount);
      const urls = [...generatedSheetUrls];
      setSheetUrls(urls);
      setSheetVariants(allVariants);
      addLog({ level: "success", title: `Step 2: 画像生成完了`, detail: `シート=${urls.length}枚\n候補=${allVariants.length}案\n${urls.slice(0, 20).map((url, index) => `シート${index + 1}: ${url}`).join("\n")}${urls.length > 20 ? `\n...ほか${urls.length - 20}シート` : ""}` });
      try {
        const record = await saveGenerationHistory(productInput, allVariants, urls, historyId);
        addLog({ level: "success", title: "生成履歴を保存", detail: `${historyLabel(record)}\n${record.id}` });
      } catch (historyError) {
        addLog({ level: "warn", title: "生成履歴の保存に失敗", detail: historyError instanceof Error ? historyError.message : String(historyError) });
      }
      setStatus(`${allVariants.length}パターン完成！ 良いものを選んでください`);
      finishProgress("作成完了", `${allVariants.length}パターンできました`);
      notifyDesktop("バナー作成完了", `${productInput.brandName || ""} ${productInput.productName}：${allVariants.length}パターンできました`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (stopRequestedRef.current || message.includes("abort") || message.includes("停止")) {
        const partialVariants = generatedVariants.slice(0, targetCount);
        const partialUrls = [...generatedSheetUrls];
        if (partialVariants.length || partialUrls.length) {
          try {
            const record = await saveGenerationHistory(productInput, partialVariants, partialUrls, historyId);
            addLog({ level: "success", title: "停止時の履歴を保存", detail: `${historyLabel(record)}\n候補=${partialVariants.length}` });
          } catch (historyError) {
            addLog({ level: "warn", title: "停止時の履歴保存に失敗", detail: historyError instanceof Error ? historyError.message : String(historyError) });
          }
        }
        setStatus("停止しました。途中までの候補は残しています");
        finishProgress("停止しました", "途中までできた候補はそのまま残しています");
        addLog({ level: "warn", title: "生成停止", detail: message });
      } else {
        setStatus("エラーが発生しました");
        finishProgress("エラー", message);
        addLog({ level: "error", title: "生成エラー", detail: message });
        notifyDesktop("バナー作成エラー", message);
      }
    } finally {
      setBusy(false);
      setStopping(false);
      activeCancelKeyRef.current = "";
      activeAbortRef.current = null;
    }
  }

  async function regenerateFinal(instruction = editInstruction) {
    if (!productInput || !selected) return;
    setBusy(true);
    setStopping(false);
    stopRequestedRef.current = false;
    const cancelKey = `final-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeCancelKeyRef.current = cancelKey;
    activeAbortRef.current = new AbortController();
    setStatus("選んだバナーを仕上げています…");
    startProgress("仕上げ中", `${aspectRatio} の画像を作成中`, 1);
    try {
      const result = await postJson<{ finalUrl: string; mode: Mode; variant: Variant; debug?: ApiDebug }>("/api/final", {
        input: productInput,
        variant: selected,
        editInstruction: instruction,
        aspectRatio,
        cancelKey,
        codexSettings: stepCodexSettings.final,
        promptTemplates: activePromptTemplates,
      }, activeAbortRef.current?.signal);
    setFinalUrl(result.finalUrl);
      setSelected(result.variant);
      setStatus("仕上げ完了！ 確認してください");
      finishProgress("仕上げ完了", "右のパネルで確認できます");
      addLog({ level: "success", title: `仕上げ完了: ${result.mode}`, detail: `${formatDebug(result.debug)} / ${result.finalUrl}` });
      notifyDesktop("仕上げ完了", `${aspectRatio} のバナーができました`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (stopRequestedRef.current || message.includes("abort") || message.includes("停止")) {
        setStatus("停止しました");
        finishProgress("停止しました", "仕上げ生成を停止しました");
        addLog({ level: "warn", title: "仕上げ停止", detail: message });
      } else {
        setStatus("仕上げ時にエラーが発生しました");
        finishProgress("エラー", message);
        addLog({ level: "error", title: "仕上げエラー", detail: message });
      }
    } finally {
      setBusy(false);
      setStopping(false);
      activeCancelKeyRef.current = "";
      activeAbortRef.current = null;
    }
  }

  async function saveFinal() {
    if (!productInput || !finalUrl) return;
    await postJson("/api/save", {
      input: productInput,
      ideas: sheetVariants,
      sheetUrl: sheetUrls[0],
      sheetUrls,
      finalUrl,
      selectedIndex: selected?.globalIndex || selected?.index,
    });
    await loadHistory();
    setStatus("保存しました");
    addLog({ level: "success", title: "保存", detail: finalUrl });
  }

  async function exportBanner(sourceUrl?: string, variant?: Variant | null, stage: "candidate" | "final" = "final", folder = selectedSaveFolder) {
    if (!productInput || !sourceUrl) return;
    setBusy(true);
    setStatus("ライブラリへ保存中");
    try {
      const saved = await postJson<SavedBanner>("/api/export", {
        sourceUrl,
        input: productInput,
        variant,
        stage,
        aspectRatio: stage === "final" ? aspectRatio : "candidate",
        folder,
      });
      setSavedBanners((items) => [saved, ...items].slice(0, 30));
      if (saved.tree) setSaveTree(saved.tree);
      if (saved.folder) setSelectedSaveFolder(saved.folder);
      setStatus(saved.duplicated ? "同じ画像は既に保存済みです" : "ライブラリに保存しました");
      addLog({ level: "success", title: saved.duplicated ? "重複保存をスキップ" : "画像保存", detail: [saved.filePath, saved.propertyPath ? `property=${saved.propertyPath}` : ""].filter(Boolean).join("\n") });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("画像保存エラー");
      addLog({ level: "error", title: "画像保存エラー", detail: message });
    } finally {
      setBusy(false);
    }
  }

  async function createSaveFolder() {
    if (!newSaveFolderName.trim()) return;
    setBusy(true);
    setStatus("フォルダ作成中");
    try {
      const result = await postJson<{ folder: string; folderPath: string; tree: SavedNode; rootPath: string }>("/api/export", {
        action: "createFolder",
        folder: selectedSaveFolder,
        name: newSaveFolderName,
      });
      setSaveTree(result.tree);
      setSaveRootPath(result.rootPath);
      setSelectedSaveFolder(result.folder);
      setNewSaveFolderName("");
      setStatus("フォルダを作成しました");
      addLog({ level: "success", title: "フォルダ作成", detail: result.folderPath });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("フォルダ作成エラー");
      addLog({ level: "error", title: "フォルダ作成エラー", detail: message });
    } finally {
      setBusy(false);
    }
  }

  async function deleteSaveFolder(folder?: string) {
    const target = folder || selectedSaveFolder;
    if (!target) { setStatus("削除するフォルダを選択してください"); return; }
    setBusy(true);
    setStatus("フォルダ情報を確認中…");
    try {
      const check = await postJson<{ needsConfirm?: boolean; fileCount?: number; deleted?: boolean; tree?: SavedNode; rootPath?: string }>("/api/export", {
        action: "deleteFolder", folder: target,
      });
      if (check.needsConfirm) {
        const ok = window.confirm(`このフォルダには${check.fileCount}枚の画像が含まれています。\n本当に削除しますか？`);
        if (!ok) { setStatus("削除をキャンセルしました"); setBusy(false); return; }
        const result = await postJson<{ deleted: boolean; tree: SavedNode; rootPath: string }>("/api/export", {
          action: "deleteFolder", folder: target, confirm: true,
        });
        setSaveTree(result.tree);
        setSaveRootPath(result.rootPath);
      } else if (check.deleted && check.tree) {
        setSaveTree(check.tree);
        setSaveRootPath(check.rootPath!);
      }
      if (selectedSaveFolder === target || selectedSaveFolder.startsWith(target + "/")) {
        setSelectedSaveFolder("");
      }
      setStatus("フォルダを削除しました");
      addLog({ level: "success", title: "フォルダ削除", detail: target });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("フォルダ削除エラー");
      addLog({ level: "error", title: "フォルダ削除エラー", detail: message });
    } finally {
      setBusy(false);
    }
  }

  async function moveLibraryFile(sourceUrl: string, targetFolder: string) {
    setBusy(true);
    setStatus("ライブラリ内で移動中");
    try {
      const moved = await postJson<SavedBanner>("/api/export", {
        action: "moveFile",
        sourceUrl,
        targetFolder,
      });
      if (moved.tree) setSaveTree(moved.tree);
      setSelectedSaveFolder(moved.folder || targetFolder);
      setStatus("ライブラリ内で移動しました");
      addLog({ level: "success", title: "ライブラリ移動", detail: moved.filePath });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("ライブラリ移動エラー");
      addLog({ level: "error", title: "ライブラリ移動エラー", detail: message });
    } finally {
      setBusy(false);
    }
  }

  async function deleteLibraryFile(fileUrl: string, displayName?: string) {
    const ok = window.confirm(`「${displayName || decodeURIComponent(fileUrl.split("/").pop() || "画像")}」をライブラリから削除しますか？`);
    if (!ok) return;
    setBusy(true);
    setStatus("ライブラリ画像を削除中");
    try {
      const result = await postJson<{ deleted: boolean; tree: SavedNode; rootPath: string }>("/api/export", {
        action: "deleteFile",
        fileUrl,
      });
      setSaveTree(result.tree);
      setSaveRootPath(result.rootPath);
      if (libSelectedUrl === fileUrl) {
        setLibSelectedUrl("");
        setLibFinalUrl("");
      }
      setLibSelectedUrls((current) => {
        const next = new Set(current);
        next.delete(fileUrl);
        return next;
      });
      if (libSelectionAnchorUrl === fileUrl) setLibSelectionAnchorUrl("");
      setHoverPreview(null);
      setStatus("ライブラリ画像を削除しました");
      addLog({ level: "success", title: "ライブラリ画像削除", detail: fileUrl });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("ライブラリ画像削除エラー");
      addLog({ level: "error", title: "ライブラリ画像削除エラー", detail: message });
    } finally {
      setBusy(false);
    }
  }

  async function reorderSaveFolder(sourceFolder: string, beforeFolder?: string) {
    if (!sourceFolder || sourceFolder === beforeFolder) return;
    try {
      const result = await postJson<{ tree: SavedNode; rootPath: string }>("/api/export", {
        action: "reorderFolder",
        sourceFolder,
        beforeFolder: beforeFolder || "",
      });
      setSaveTree(result.tree);
      setSaveRootPath(result.rootPath);
      addLog({ level: "success", title: "フォルダ並び替え", detail: beforeFolder ? `${sourceFolder} → ${beforeFolder} の前` : `${sourceFolder} → 末尾` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("フォルダ並び替えエラー");
      addLog({ level: "error", title: "フォルダ並び替えエラー", detail: message });
    }
  }

  async function moveSaveFolder(sourceFolder: string, targetFolder: string, beforeFolder = "") {
    if (!sourceFolder) return;
    const sourceName = sourceFolder.split("/").filter(Boolean).pop() || sourceFolder;
    setFolderDrag((current) => ({ ...current, movedTo: targetFolder ? `${targetFolder}/${sourceName}` : sourceName }));
    try {
      const result = await postJson<{ folder: string; tree: SavedNode; rootPath: string }>("/api/export", {
        action: "moveFolder",
        sourceFolder,
        targetFolder,
        beforeFolder,
      });
      setSaveTree(result.tree);
      setSaveRootPath(result.rootPath);
      if (selectedSaveFolder === sourceFolder || selectedSaveFolder.startsWith(`${sourceFolder}/`)) {
        selectSavedFolder(result.folder || targetFolder);
      }
      setStatus("フォルダを移動しました");
      addLog({ level: "success", title: "フォルダ移動", detail: `${sourceFolder} → ${result.folder || targetFolder}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("フォルダ移動エラー");
      addLog({ level: "error", title: "フォルダ移動エラー", detail: message });
    } finally {
      window.setTimeout(() => setFolderDrag({ source: "", target: "", zone: "" }), 450);
    }
  }

  function setSubtleDragImage(event: React.DragEvent, imageUrl?: string, label = "移動") {
    if (typeof document === "undefined") return;
    const ghost = document.createElement("div");
    ghost.className = "dragGhost";
    if (imageUrl) ghost.style.backgroundImage = `url("${imageUrl}")`;
    ghost.innerHTML = `<span>${label}</span>`;
    document.body.appendChild(ghost);
    event.dataTransfer.setDragImage(ghost, 24, 24);
    window.setTimeout(() => ghost.remove(), 0);
  }

  function startImageDrag(event: React.DragEvent, sourceUrl?: string, variant?: Variant | null, stage: "candidate" | "final" = "candidate") {
    if (!sourceUrl) return;
    const count = selectedCropUrls.size > 1 && selectedCropUrls.has(sourceUrl) ? selectedCropUrls.size : 1;
    setSubtleDragImage(event, sourceUrl, count > 1 ? `${count}枚` : "保存");
    // If multi-selected, drag all selected
    if (selectedCropUrls.size > 1 && selectedCropUrls.has(sourceUrl)) {
      const items = sheetVariants.filter(v => v.cropUrl && selectedCropUrls.has(v.cropUrl)).map(v => ({ sourceUrl: v.cropUrl, variant: v, stage }));
      event.dataTransfer.setData("application/json", JSON.stringify({ multi: true, items }));
    } else {
      event.dataTransfer.setData("application/json", JSON.stringify({ sourceUrl, variant, stage }));
    }
    event.dataTransfer.effectAllowed = "copy";
  }

  function showHoverPreview(event: React.MouseEvent, url?: string, caption?: string) {
    if (!url) return;
    const size = 380;
    const margin = 18;
    const x = Math.min(window.innerWidth - size / 2 - margin, Math.max(size / 2 + margin, event.clientX));
    const canShowBelow = event.clientY + size + 28 < window.innerHeight;
    const placement: HoverPreview["placement"] = canShowBelow ? "below" : "above";
    const y = placement === "below"
      ? Math.min(window.innerHeight - size - margin, event.clientY + 18)
      : Math.max(margin, event.clientY - size - 18);
    setHoverPreview({ url, caption, x, y, placement });
  }

  function variantCaption(variant: Variant) {
    return [variant.appeal, variant.prompt].filter(Boolean).join("\n");
  }

  function handleCropClick(event: React.MouseEvent, variant: Variant) {
    if (!variant.cropUrl) return;
    const orderedUrls = sheetVariants.map((item) => item.cropUrl).filter(Boolean) as string[];

    if (event.shiftKey && cropSelectionAnchorUrl) {
      const anchorIndex = orderedUrls.indexOf(cropSelectionAnchorUrl);
      const targetIndex = orderedUrls.indexOf(variant.cropUrl);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        setSelectedCropUrls(new Set(orderedUrls.slice(start, end + 1)));
        return;
      }
    }

    setSelectedCropUrls((current) => {
      const next = new Set(current);
      if (next.has(variant.cropUrl!)) next.delete(variant.cropUrl!);
      else next.add(variant.cropUrl!);
      return next;
    });
    setCropSelectionAnchorUrl(variant.cropUrl);
  }

  function libraryCaption(item: SavedFile) {
    return [item.appeal, item.stylePrompt].filter(Boolean).join("\n");
  }

  async function dropToSave(event: React.DragEvent, folder = selectedSaveFolder) {
    event.preventDefault();
    const droppedFiles = Array.from(event.dataTransfer.files || []).filter((file) => file.type.startsWith("image/"));
    if (droppedFiles.length) {
      await uploadManualLibraryFiles(droppedFiles, folder);
      return;
    }
    const libraryUrl = event.dataTransfer.getData("application/library-file");
    if (libraryUrl) {
      void moveLibraryFile(libraryUrl, folder);
      return;
    }
    const raw = event.dataTransfer.getData("application/json");
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as { multi?: boolean; items?: { sourceUrl?: string; variant?: Variant; stage?: string }[]; sourceUrl?: string; variant?: Variant; stage?: string };
      if (data.multi && data.items) {
        // Save all selected images
        for (const item of data.items) {
          await exportBanner(item.sourceUrl, item.variant as Variant, (item.stage as "candidate" | "final") || "candidate", folder);
        }
        clearCropSelection();
      } else {
        void exportBanner(data.sourceUrl, data.variant, (data.stage as "candidate" | "final") || "candidate", folder);
      }
    } catch {
      setStatus("ドラッグした画像を読み取れませんでした");
    }
  }

  async function uploadManualLibraryFiles(files: File[], folder = selectedSaveFolder) {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;
    setBusy(true);
    setStatus("ライブラリへ画像を追加中");
    try {
      const form = new FormData();
      form.append("folder", folder);
      for (const file of imageFiles) form.append("images", file);
      const response = await fetch("/api/export", { method: "POST", body: form });
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as ManualUploadResponse;
      setSaveTree(result.tree);
      setSaveRootPath(result.rootPath);
      setSelectedSaveFolder(result.folder || folder);
      setLibraryView("saved");
      setLibSelectedUrls(new Set(result.saved.map((item) => item.url)));
      setLibSelectedUrl(result.saved[0]?.url || "");
      setStatus(`${result.saved.length}枚をライブラリに追加しました`);
      addLog({ level: "success", title: "手動アップロード", detail: result.saved.map((item) => item.filePath).join("\n") });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("画像追加エラー");
      addLog({ level: "error", title: "画像追加エラー", detail: message });
    } finally {
      setBusy(false);
      if (libraryUploadInputRef.current) libraryUploadInputRef.current.value = "";
    }
  }

  function startLibraryFileDrag(event: React.DragEvent, sourceUrl: string) {
    const count = libSelectedUrls.size > 1 && libSelectedUrls.has(sourceUrl) ? libSelectedUrls.size : 1;
    setSubtleDragImage(event, sourceUrl, count > 1 ? `${count}枚` : "移動");
    event.dataTransfer.setData("application/library-file", sourceUrl);
    event.dataTransfer.effectAllowed = "move";
  }

  function countFiles(node: SavedNode): number {
    return node.files.length + node.children.reduce((sum, child) => sum + countFiles(child), 0);
  }

  function folderCountLabel(node: SavedNode) {
    const own = node.files.length;
    const total = countFiles(node);
    return total > own ? `${own} (${total})` : String(own);
  }

  function selectedSaveNode(node: SavedNode | null = saveTree): SavedNode | null {
    if (!node) return null;
    if (node.path === selectedSaveFolder) return node;
    for (const child of node.children) {
      const found = selectedSaveNode(child);
      if (found) return found;
    }
    return null;
  }

  function findNodeByPath(path: string, node: SavedNode | null = saveTree): SavedNode | null {
    if (!node) return null;
    if (node.path === path) return node;
    for (const child of node.children) {
      const found = findNodeByPath(path, child);
      if (found) return found;
    }
    return null;
  }

  function nextSiblingFolderPath(parentPath: string, folderPath: string) {
    const parent = findNodeByPath(parentPath);
    const index = parent?.children.findIndex((child) => child.path === folderPath) ?? -1;
    return index >= 0 ? parent?.children[index + 1]?.path || "" : "";
  }

  function collectLibraryFiles(node: SavedNode | null): SavedNode["files"] {
    if (!node) return [];
    return [...node.files, ...node.children.flatMap((child) => collectLibraryFiles(child))];
  }

  function currentLibraryFiles() {
    const node = selectedSaveNode();
    const files = selectedSaveFolder ? node?.files || [] : collectLibraryFiles(saveTree);
    const query = librarySearch.trim().toLowerCase();
    return files.filter((file) => {
      const nameMatch = !query || [file.displayName, file.name, file.url].filter(Boolean).join(" ").toLowerCase().includes(query);
      const rating = file.rating || 0;
      const ratingMatch = libraryRatingFilter === "all"
        || (libraryRatingFilter === "unrated" ? rating === 0 : rating >= Number(libraryRatingFilter));
      return nameMatch && ratingMatch;
    });
  }

  function imageSourcePickerFiles() {
    const node = imageSourceFolder ? findNodeByPath(imageSourceFolder) : saveTree;
    const files = imageSourceFolder ? node?.files || [] : collectLibraryFiles(saveTree);
    const query = imageSourceSearch.trim().toLowerCase();
    return files.filter((file) => !query || [file.displayName, file.name, file.url, file.generationPrompt, file.stylePrompt].filter(Boolean).join(" ").toLowerCase().includes(query));
  }

  function selectedImageSourceFile() {
    if (!imageSourceUrl) return null;
    return findSavedFileGroup(imageSourceUrl);
  }

  function selectImageSource(url: string) {
    setImageSourceUrl(url);
    setImageAnalysis(null);
  }

  async function analyzeImageSource() {
    if (!imageSourceUrl || imageAnalysisBusy) return;
    setImageAnalysisBusy(true);
    setStatus("画像を分解中…");
    addLog({ level: "info", title: "画像分解開始", detail: imageSourceUrl });
    try {
      const sourceFile = selectedImageSourceFile();
      const result = await postJson<BannerAnalysisResult>("/api/analyze-banner", {
        imageUrl: imageSourceUrl,
        fileName: sourceFile?.displayName || sourceFile?.name || fileNameFromUrl(imageSourceUrl),
        meta: {
          generationPrompt: sourceFile?.generationPrompt || sourceFile?.stylePrompt || "",
          editInstruction: sourceFile?.editInstruction || "",
          aspectRatio: sourceFile?.aspectRatio || "",
        },
        codexSettings: stepCodexSettings.ideas,
      });
      setImageAnalysis(result);
      setStatus("画像の分解が完了しました");
      addLog({ level: "success", title: "画像分解完了", detail: `${result.items.length}項目` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`画像分解エラー: ${message}`);
      addLog({ level: "error", title: "画像分解エラー", detail: message });
    } finally {
      setImageAnalysisBusy(false);
    }
  }

  function updateImageAnalysisItem(id: string, patch: Partial<BannerAnalysisItem>) {
    setImageAnalysis((current) => current
      ? { ...current, items: current.items.map((item) => item.id === id ? { ...item, ...patch } : item) }
      : current);
  }

  function savedSourceUrls() {
    const urls = new Set<string>();
    const walk = (node: SavedNode | null) => {
      if (!node) return;
      for (const file of node.files) {
        for (const version of file.versions?.length ? file.versions : [file]) {
          if (version.url) urls.add(version.url);
          if (version.sourceUrl) urls.add(version.sourceUrl);
          if (version.url.startsWith("/saved-banners/")) urls.add(version.url.replace("/saved-banners/", "/generated/"));
        }
      }
      for (const child of node.children) walk(child);
    };
    walk(saveTree);
    return urls;
  }

  function unsavedLibraryFiles(): UnsavedBanner[] {
    const saved = savedSourceUrls();
    const seen = new Set<string>();
    const items: UnsavedBanner[] = [];
    for (const record of [...historyRecords, ...orphanHistoryRecords]) {
      const product = [record.input?.brandName, record.input?.productName].filter(Boolean).join(" / ") || "商品不明";
      for (const variant of record.ideas || []) {
        if (!variant.cropUrl || seen.has(variant.cropUrl) || saved.has(variant.cropUrl)) continue;
        seen.add(variant.cropUrl);
        items.push({ url: variant.cropUrl, product, createdAt: record.createdAt, historyId: record.id, variant });
      }
    }
    const query = librarySearch.trim().toLowerCase();
    return items.filter((item) => {
      const historyMatch = !unsavedHistoryFilter || (unsavedHistoryFilter === "__orphan__" ? item.historyId.startsWith("orphan-") : item.historyId === unsavedHistoryFilter);
      const queryMatch = !query || [item.product, item.variant.appeal, item.variant.prompt, item.url].filter(Boolean).join(" ").toLowerCase().includes(query);
      return historyMatch && queryMatch;
    });
  }

  function fileNameFromUrl(url: string) {
    return decodeURIComponent(url.split("/").pop()?.split("?")[0] || "banner.png");
  }

  function folderLabelFromSavedUrl(url: string) {
    const folder = decodeURIComponent(url.replace("/saved-banners/", "").split("/").slice(0, -1).join("/"));
    return folder || "保存済み";
  }

  function folderPathFromSavedUrl(url: string) {
    return decodeURIComponent(url.replace("/saved-banners/", "").split("/").slice(0, -1).join("/"));
  }

  function findSavedFileGroup(url: string) {
    for (const file of collectLibraryFiles(saveTree)) {
      if (file.url === url || file.versions?.some((version) => version.url === url)) return file;
    }
    return null;
  }

  function findSavedFileVersion(url: string) {
    const group = findSavedFileGroup(url);
    return group?.versions?.find((version) => version.url === url) || (group?.url === url ? group : null);
  }

  function productInputForLibraryUrl(url: string): ProductInput {
    const group = findSavedFileGroup(url);
    const sourceVersion = findSavedFileVersion(url);
    const rootVersion = group?.versions?.find((version) => !version.parentUrl) || group;
    const productMeta = rootVersion?.product?.productName ? rootVersion.product : sourceVersion?.product;
    const folderParts = folderPathFromSavedUrl(url).split("/").filter(Boolean);
    const folderBrand = folderParts[0] || "";
    const folderProduct = folderParts[1] || "";
    const productName = productMeta?.productName || folderProduct || "バナー";
    const brandName = productMeta?.brandName || folderBrand || "";
    const matchedProduct = products.find((product) => {
      const sameName = product.name === productName;
      const sameBrand = !brandName || product.brandName === brandName;
      return sameName && sameBrand;
    }) || products.find((product) => product.name === productName);
    const firstImage = matchedProduct?.images?.[0];
    return {
      productId: matchedProduct?.id,
      brandName: matchedProduct?.brandName || brandName,
      productName: matchedProduct?.name || productName,
      format: "WEB広告バナー候補",
      productImageUrl: firstImage?.url || matchedProduct?.imageUrl,
      productImagePath: firstImage?.path || matchedProduct?.imagePath,
      productImages: matchedProduct?.images || [],
      notes: matchedProduct?.notes || "",
      priceInfo: productMeta?.priceInfo || matchedProduct?.priceInfo || "",
      priceMode: (productMeta?.priceMode === "mixed" || productMeta?.priceMode === "none" || productMeta?.priceMode === "all")
        ? productMeta.priceMode
        : "all",
    };
  }

  function savedVersionLabel(version: SavedFile, index: number) {
    if (!version.parentUrl) return "オリジナル";
    return `派生 ${index}`;
  }

  function sortSavedVersionsForUi(versions: SavedFile[]) {
    return [...versions].sort((a, b) => (b.savedAt || b.name).localeCompare(a.savedAt || a.name, "ja"));
  }

  function parentVersionFor(group: SavedFile | null, version: SavedFile) {
    if (!version.parentUrl) return null;
    return group?.versions?.find((item) => item.url === version.parentUrl) || null;
  }

  function renderSourcePreview(url?: string, label?: string) {
    if (!url) return null;
    return (
      <span
        className="sourcePreviewLink"
        onMouseEnter={(event) => showHoverPreview(event, url, label || "生成元")}
        onMouseMove={(event) => showHoverPreview(event, url, label || "生成元")}
        onMouseLeave={() => setHoverPreview(null)}
      >
        <img src={url} alt="" />
        <span>{label || "生成元"}</span>
      </span>
    );
  }

  function selectedLibraryDetails(): LibraryDetailItem[] {
    if (!libSelectedUrls.size) return [];
    if (libraryView === "saved") {
      return currentLibraryFiles()
        .filter((file) => libSelectedUrls.has(file.url))
        .map((file) => ({
          kind: "saved" as const,
          url: file.url,
          title: file.displayName || file.name.replace(/\.(png|jpe?g|webp)$/i, ""),
          fileName: file.name,
          folder: folderLabelFromSavedUrl(file.url),
          rating: file.rating || 0,
          appeal: file.appeal || "",
          stylePrompt: file.stylePrompt || "",
          path: file.path,
          propertyPath: file.propertyPath || "",
          assetId: file.assetId,
          rootId: file.rootId,
          parentUrl: file.parentUrl,
          sourceType: file.sourceType,
          aspectRatio: file.aspectRatio,
          editInstruction: file.editInstruction,
          generationPrompt: file.generationPrompt,
          versions: file.versions || [file],
          versionCount: file.versionCount || 1,
        }));
    }
    return unsavedLibraryFiles()
      .filter((item) => libSelectedUrls.has(item.url))
      .map((item) => ({
        kind: "unsaved" as const,
        url: item.url,
        title: item.variant.appeal || "未保存候補",
        fileName: fileNameFromUrl(item.url),
        folder: "未保存",
        appeal: item.variant.appeal || "",
        stylePrompt: item.variant.prompt || "",
        prompt: item.variant.prompt || "",
        product: item.product,
        createdAt: item.createdAt,
        historyId: item.historyId,
      }));
  }

  function commonValue(values: Array<string | undefined>) {
    const unique = Array.from(new Set(values.filter(Boolean) as string[]));
    if (!unique.length) return "-";
    return unique.length === 1 ? unique[0] : `複数（${unique.length}種類）`;
  }

  function ratingSummary(items: LibraryDetailItem[]) {
    const rated = items.map((item) => item.rating || 0).filter((rating) => rating > 0);
    if (!rated.length) return "未評価";
    const average = rated.reduce((sum, rating) => sum + rating, 0) / rated.length;
    return `平均 ${average.toFixed(1)} / ${rated.length}件評価済み`;
  }

  function clearLibrarySelection() {
    setLibSelectedUrl("");
    setLibSelectedUrls(new Set());
    setLibSelectionAnchorUrl("");
    setLibFinalUrl("");
    setLibRefineOpen(false);
  }

  function openLibraryRefine(url?: string) {
    const target = url || Array.from(libSelectedUrls)[0] || libSelectedUrl;
    if (!target || libraryView !== "saved") return;
    setLibSelectedUrl(target);
    setLibFinalUrl("");
    setRefineAnnotations([]);
    setRefineAnnotationDraft(null);
    setActiveRefineAnnotationId("");
    setLibRefineOpen(true);
  }

  function refinePointFromEvent(event: React.PointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  }

  function addRefineAnnotation(mark: Omit<RefineAnnotation, "id" | "text">) {
    const id = `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setRefineAnnotations((items) => [...items, { ...mark, id, text: "" }]);
    setActiveRefineAnnotationId(id);
  }

  function startRefineAnnotation(event: React.PointerEvent<HTMLDivElement>) {
    if (libraryRefineBusy || libFinalUrl) return;
    event.preventDefault();
    const point = refinePointFromEvent(event);
    if (refineAnnotationTool === "pin") {
      addRefineAnnotation({ kind: "pin", x: point.x, y: point.y });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setRefineAnnotationDraft({ startX: point.x, startY: point.y, x: point.x, y: point.y, width: 0, height: 0 });
  }

  function moveRefineAnnotation(event: React.PointerEvent<HTMLDivElement>) {
    if (!refineAnnotationDraft || refineAnnotationTool !== "box") return;
    const point = refinePointFromEvent(event);
    const x = Math.min(refineAnnotationDraft.startX, point.x);
    const y = Math.min(refineAnnotationDraft.startY, point.y);
    const width = Math.abs(point.x - refineAnnotationDraft.startX);
    const height = Math.abs(point.y - refineAnnotationDraft.startY);
    setRefineAnnotationDraft({ ...refineAnnotationDraft, x, y, width, height });
  }

  function finishRefineAnnotation(event: React.PointerEvent<HTMLDivElement>) {
    if (!refineAnnotationDraft || refineAnnotationTool !== "box") return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const draft = refineAnnotationDraft;
    setRefineAnnotationDraft(null);
    if (draft.width < 0.025 && draft.height < 0.025) return;
    addRefineAnnotation({ kind: "box", x: draft.x, y: draft.y, width: draft.width, height: draft.height });
  }

  function updateRefineAnnotation(id: string, text: string) {
    setRefineAnnotations((items) => items.map((item) => item.id === id ? { ...item, text } : item));
  }

  function removeRefineAnnotation(id: string) {
    setRefineAnnotations((items) => items.filter((item) => item.id !== id));
    if (activeRefineAnnotationId === id) setActiveRefineAnnotationId("");
  }

  function annotationPromptList() {
    return refineAnnotations.map((item, index) => {
      const position = item.kind === "box"
        ? `範囲 x=${Math.round(item.x * 100)}%, y=${Math.round(item.y * 100)}%, w=${Math.round((item.width || 0) * 100)}%, h=${Math.round((item.height || 0) * 100)}%`
        : `ピン x=${Math.round(item.x * 100)}%, y=${Math.round(item.y * 100)}%`;
      return `${index + 1}. ${position}: ${item.text.trim() || "この位置を自然に調整する"}`;
    }).join("\n");
  }

  function loadImageForCanvas(url: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("修正メモ画像を作れませんでした"));
      image.src = url;
    });
  }

  async function renderAnnotatedImageDataUrl(sourceUrl: string, annotations: RefineAnnotation[]) {
    const image = await loadImageForCanvas(sourceUrl);
    const canvas = document.createElement("canvas");
    const width = image.naturalWidth || image.width || 1200;
    const height = image.naturalHeight || image.height || 1200;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("修正メモ画像を作れませんでした");
    ctx.drawImage(image, 0, 0, width, height);
    const scale = Math.max(width, height);
    const line = Math.max(4, Math.round(scale * 0.004));
    const radius = Math.max(22, Math.round(scale * 0.025));
    const fontSize = Math.max(24, Math.round(scale * 0.028));
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    annotations.forEach((item, index) => {
      const number = String(index + 1);
      ctx.lineWidth = line;
      ctx.strokeStyle = "#ef4444";
      ctx.fillStyle = "rgba(239, 68, 68, 0.14)";
      if (item.kind === "box") {
        const x = item.x * width;
        const y = item.y * height;
        const w = (item.width || 0) * width;
        const h = (item.height || 0) * height;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      } else {
        ctx.beginPath();
        ctx.arc(item.x * width, item.y * height, radius, 0, Math.PI * 2);
      }
      ctx.fillStyle = "#ef4444";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(3, Math.round(line * 0.8));
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
      const labelX = item.kind === "box" ? item.x * width : item.x * width;
      const labelY = item.kind === "box" ? item.y * height : item.y * height;
      ctx.fillText(number, labelX, labelY);
    });
    return canvas.toDataURL("image/png");
  }

  function handleLibraryTileClick(event: React.MouseEvent, url: string, orderedUrls: string[]) {
    setLibSelectedUrl(url);
    setLibFinalUrl("");
    const additive = event.ctrlKey || event.metaKey;

    if (event.shiftKey && libSelectionAnchorUrl) {
      const anchorIndex = orderedUrls.indexOf(libSelectionAnchorUrl);
      const targetIndex = orderedUrls.indexOf(url);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        setLibSelectedUrls(new Set(orderedUrls.slice(start, end + 1)));
        return;
      }
    }

    if (libraryView === "saved" && !additive) {
      setLibSelectedUrls(new Set([url]));
      setLibSelectionAnchorUrl(url);
      return;
    }

    setLibSelectedUrls((current) => {
      const next = new Set(current);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
    setLibSelectionAnchorUrl(url);
  }

  function updateMarqueeSelection(container: HTMLElement, startX: number, startY: number, currentX: number, currentY: number) {
    const left = Math.min(startX, currentX);
    const right = Math.max(startX, currentX);
    const top = Math.min(startY, currentY);
    const bottom = Math.max(startY, currentY);
    const selected: string[] = [];
    container.querySelectorAll<HTMLElement>(".bannerTile[data-url]").forEach((tile) => {
      const rect = tile.getBoundingClientRect();
      const intersects = rect.left <= right && rect.right >= left && rect.top <= bottom && rect.bottom >= top;
      if (intersects) selected.push(tile.dataset.url || "");
    });
    const urls = selected.filter(Boolean);
    setLibSelectedUrls(new Set(urls));
    setLibSelectedUrl(urls[0] || "");
    setLibSelectionAnchorUrl(urls[0] || "");
    setLibFinalUrl("");
  }

  function startLibraryMarquee(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.preventDefault();
    const container = event.currentTarget;
    container.setPointerCapture(event.pointerId);
    setHoverPreview(null);
    clearLibrarySelection();
    const startX = event.clientX;
    const startY = event.clientY;
    setMarqueeSelection({ active: true, startX, startY, currentX: startX, currentY: startY });
  }

  function moveLibraryMarquee(event: React.PointerEvent<HTMLDivElement>) {
    if (!marqueeSelection.active) return;
    event.preventDefault();
    const currentX = event.clientX;
    const currentY = event.clientY;
    setMarqueeSelection((current) => ({ ...current, currentX, currentY }));
    updateMarqueeSelection(event.currentTarget, marqueeSelection.startX, marqueeSelection.startY, currentX, currentY);
  }

  function endLibraryMarquee(event: React.PointerEvent<HTMLDivElement>) {
    if (!marqueeSelection.active) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
    setMarqueeSelection((current) => ({ ...current, active: false }));
  }

  async function updateLibraryFileMeta(fileUrl: string, patch: { displayName?: string; rating?: number }) {
    try {
      const result = await postJson<{ tree: SavedNode }>("/api/export", {
        action: "updateMeta",
        fileUrl,
        ...patch,
      });
      setSaveTree(result.tree);
      addLog({ level: "success", title: "ライブラリ情報を更新", detail: fileUrl });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("ライブラリ情報の更新エラー");
      addLog({ level: "error", title: "ライブラリ情報の更新エラー", detail: message });
    }
  }

  async function setLibraryDisplayVersion(fileUrl: string) {
    try {
      const result = await postJson<{ tree: SavedNode }>("/api/export", {
        action: "setDisplayVersion",
        fileUrl,
      });
      setSaveTree(result.tree);
      setVersionModalUrl(fileUrl);
      setLibSelectedUrl(fileUrl);
      setLibSelectedUrls(new Set([fileUrl]));
      setStatus("ライブラリに表示する画像を切り替えました");
      addLog({ level: "success", title: "表示バージョン切替", detail: fileUrl });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("表示バージョンの切替エラー");
      addLog({ level: "error", title: "表示バージョンの切替エラー", detail: message });
    }
  }

  function saveBreadcrumb() {
    const parts = selectedSaveFolder.split("/").filter(Boolean);
    return [{ name: "保存済み", path: "" }, ...parts.map((part, index) => ({ name: part, path: parts.slice(0, index + 1).join("/") }))];
  }

  function startFolderResize(event: React.PointerEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = libraryFolderWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.min(560, Math.max(260, startWidth + moveEvent.clientX - startX));
      setLibraryFolderWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startGenerateSplitResize(event: React.PointerEvent) {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = genLibraryHeight;
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.min(560, Math.max(200, startHeight - (moveEvent.clientY - startY)));
      setGenLibraryHeight(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startGenerateSettingsResize(event: React.PointerEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = genSettingsWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.min(560, Math.max(280, startWidth + moveEvent.clientX - startX));
      setGenSettingsWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function renderSaveNode(node: SavedNode, level = 0) {
    const isActive = node.path === selectedSaveFolder;
    const parentPath = node.path.split("/").slice(0, -1).join("/");
    const canDropFolder = (source: string) => Boolean(source && source !== node.path && (!node.path || !isSameOrDescendantFolder(node.path, source)));
    const folderDropZone = (event: React.DragEvent) => {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const ratio = (event.clientY - rect.top) / rect.height;
      if (!node.path) return "inside";
      if (ratio < 0.28) return "before";
      if (ratio > 0.72) return "after";
      return "inside";
    };
    const handleFolderDrop = (event: React.DragEvent, source: string) => {
      const zone = folderDropZone(event);
      if (zone === "inside") void moveSaveFolder(source, node.path);
      else if (zone === "before") void moveSaveFolder(source, parentPath, node.path);
      else void moveSaveFolder(source, parentPath, nextSiblingFolderPath(parentPath, node.path));
    };
    const isDragging = folderDrag.source === node.path && Boolean(node.path);
    const isDropTarget = folderDrag.target === node.path && Boolean(folderDrag.zone);
    const isMoved = folderDrag.movedTo === node.path;
    const rowClass = [
      isDragging ? "dragging" : "",
      isDropTarget ? `drop-${folderDrag.zone}` : "",
      libraryFileDropTarget === node.path ? "file-drop-target" : "",
      isMoved ? "justMoved" : "",
    ].filter(Boolean).join(" ");
    return (
      <div className="folderNode" key={node.path || "root"}>
        <div className={`folderNodeRow ${rowClass}`}>
          <button
            className={isActive ? "active" : ""}
            type="button"
            draggable={Boolean(node.path)}
            onDragStart={(event) => {
              if (!node.path) return;
              event.dataTransfer.setData("application/library-folder", node.path);
              event.dataTransfer.effectAllowed = "move";
              setFolderDrag({ source: node.path, target: "", zone: "" });
              setStatus(`フォルダ「${node.name}」を移動中`);
            }}
            onDragEnd={() => setFolderDrag((current) => current.movedTo ? current : { source: "", target: "", zone: "" })}
            onClick={() => selectSavedFolder(node.path)}
            onDragOver={(event) => {
              const folderPath = event.dataTransfer.types.includes("application/library-folder");
              if (folderPath) {
                const source = event.dataTransfer.getData("application/library-folder");
                if (canDropFolder(source)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setLibraryFileDropTarget(null);
                  setFolderDrag({ source, target: node.path, zone: folderDropZone(event) });
                }
                return;
              }
              const imageDrop = event.dataTransfer.types.includes("application/library-file") || event.dataTransfer.types.includes("application/json");
              if (imageDrop) {
                event.preventDefault();
                event.dataTransfer.dropEffect = event.dataTransfer.types.includes("application/library-file") ? "move" : "copy";
                setHoverPreview(null);
                setFolderDrag((current) => current.source ? current : { source: "", target: "", zone: "" });
                setLibraryFileDropTarget(node.path);
              }
            }}
            onDragLeave={(event) => {
              const next = event.relatedTarget as Node | null;
              if (next && event.currentTarget.contains(next)) return;
              setFolderDrag((current) => current.target === node.path ? { ...current, target: "", zone: "" } : current);
              setLibraryFileDropTarget((current) => current === node.path ? null : current);
            }}
            onDrop={(event) => {
              const source = event.dataTransfer.getData("application/library-folder");
              if (source) {
                event.preventDefault();
                setLibraryFileDropTarget(null);
                if (canDropFolder(source)) handleFolderDrop(event, source);
                return;
              }
              setLibraryFileDropTarget(null);
              dropToSave(event, node.path);
            }}
          >
            <span>{node.path ? node.name : "保存済み"}</span>
            <small>{folderCountLabel(node)}</small>
          </button>
          {node.path && (
            <button className="folderDelete" type="button" aria-label={`${node.name}を削除`} title="フォルダを削除" onClick={(e) => { e.stopPropagation(); deleteSaveFolder(node.path); }}>×</button>
          )}
        </div>
        {node.children.map((child) => renderSaveNode(child, level + 1))}
      </div>
    );
  }

  function selectSavedFolder(path: string) {
    setLibraryView("saved");
    setSelectedSaveFolder(path);
    setLibrarySearch("");
    setLibraryRatingFilter("all");
    setUnsavedHistoryFilter("");
    clearLibrarySelection();
  }

  function selectUnsavedLibrary() {
    setLibraryView("unsaved");
    setLibrarySearch("");
    setLibraryRatingFilter("all");
    setUnsavedHistoryFilter("");
    clearLibrarySelection();
  }

  function renderLibraryAxis(showUnsaved = true) {
    return (
      <>
        <div className="folderTree">
          {saveTree ? renderSaveNode(saveTree) : <div className="empty small">読み込み中</div>}
        </div>
        {showUnsaved && (
          <>
            <div className="libraryAxisDivider">
              <span>生成履歴</span>
            </div>
            <div className="libraryAxis">
              <button className={libraryView === "unsaved" ? "active" : ""} type="button" onClick={selectUnsavedLibrary}>
                <span>未保存</span>
                <small>{unsavedLibraryFiles().length}</small>
              </button>
              <p>整理前の生成候補。使う画像はフォルダへドラッグして保存します。</p>
            </div>
          </>
        )}
      </>
    );
  }

  function renderImageSourceFolderNode(node: SavedNode, depth = 0) {
    const active = imageSourceFolder === node.path || (!imageSourceFolder && !node.path);
    const label = depth === 0 ? "保存済み" : node.name;
    return (
      <div className="folderNode imageSourceFolderNode" key={node.path || "root"}>
        <button
          className={active ? "active" : ""}
          type="button"
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => setImageSourceFolder(node.path)}
        >
          <span>{label || "保存済み"}</span>
          <small>{folderCountLabel(node)}枚</small>
        </button>
        {node.children.map((child) => renderImageSourceFolderNode(child, depth + 1))}
      </div>
    );
  }

  async function quickSave(variant: Variant) {
    if (!variant.cropUrl) return;
    await exportBanner(variant.cropUrl, variant, "candidate");
  }

  async function saveSelectedCrops(folder = selectedSaveFolder) {
    const selectedVariants = sheetVariants.filter((variant) => variant.cropUrl && selectedCropUrls.has(variant.cropUrl));
    if (!selectedVariants.length) {
      setStatus("保存する候補を選択してください");
      return;
    }
    for (const variant of selectedVariants) {
      await exportBanner(variant.cropUrl, variant, "candidate", folder);
    }
    clearCropSelection();
    setStatus(`${selectedVariants.length}枚をライブラリに保存しました`);
  }

  async function downloadFilesDirect(files: Array<{ url?: string; name?: string }>) {
    const targets = files.filter((file) => file.url).map((file) => ({ url: file.url!, name: file.name }));
    if (!targets.length) {
      setStatus("ダウンロードする画像がありません");
      return;
    }
    setStatus(`${targets.length}枚をダウンロード中…`);
    for (const [index, file] of targets.entries()) {
      const link = document.createElement("a");
      const ext = file.url.split("?")[0].match(/\.(png|jpe?g|webp)$/i)?.[0] || ".png";
      link.href = file.url;
      link.download = `${String(index + 1).padStart(3, "0")}-${safeDownloadName(file.name || "banner")}${ext}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // 連続クリック扱いの詰まりを避けるため、ほんの少し間隔を空ける。
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
    setStatus(`${targets.length}枚をダウンロードしました`);
    addLog({ level: "success", title: "一括ダウンロード", detail: `${targets.length}枚` });
  }

  function downloadGeneratedCandidates() {
    const targets = selectedCropUrls.size
      ? sheetVariants.filter((variant) => variant.cropUrl && selectedCropUrls.has(variant.cropUrl))
      : sheetVariants;
    void downloadFilesDirect(targets.map((variant) => ({
      url: variant.cropUrl,
      name: `${String(variant.globalIndex || variant.index).padStart(3, "0")}-${variant.appeal || variant.prompt || "candidate"}`,
    })));
  }

  function downloadCurrentLibraryView() {
    if (libraryView === "saved") {
      const files = currentLibraryFiles();
      const targets = libSelectedUrls.size ? files.filter((file) => libSelectedUrls.has(file.url)) : files;
      void downloadFilesDirect(targets.map((file) => ({
        url: file.url,
        name: file.displayName || file.name,
      })));
    } else {
      const files = unsavedLibraryFiles();
      const targets = libSelectedUrls.size ? files.filter((item) => libSelectedUrls.has(item.url)) : files;
      void downloadFilesDirect(targets.map((item) => ({
        url: item.url,
        name: `${formatShortDate(item.createdAt)}-${item.product}-${item.variant.appeal || item.variant.prompt || "candidate"}`,
      })));
    }
  }

  async function refineLibraryImage() {
    if (!libSelectedUrl || libraryRefineBusy) return;
    const sourceLibraryUrl = libSelectedUrl;
    const libraryProductInput = productInputForLibraryUrl(sourceLibraryUrl);
    setLibraryRefineBusy(true);
    const cancelKey = `library-final-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const controller = new AbortController();
    setStatus("仕上げ生成中…");
    addLog({ level: "info", title: "仕上げ生成開始", detail: `${libAspectRatio}\nsource=${sourceLibraryUrl}` });
    try {
      const annotationImageDataUrl = refineAnnotations.length
        ? await renderAnnotatedImageDataUrl(sourceLibraryUrl, refineAnnotations)
        : "";
      const result = await postJson<{ finalUrl: string; mode: Mode; variant: Variant; debug?: ApiDebug }>("/api/final", {
        input: libraryProductInput,
        variant: { index: 0, prompt: libEditInstruction || "この画像をベースに仕上げてください", cropUrl: sourceLibraryUrl, priceTreatment: "without_price" as const },
        aspectRatio: libAspectRatio,
        instruction: libEditInstruction,
        annotations: refineAnnotations,
        annotationImageDataUrl,
        cancelKey,
        codexSettings: stepCodexSettings.final,
        promptTemplates: activePromptTemplates,
      }, controller.signal);
      const saved = await postJson<SavedBanner>("/api/export", {
        sourceUrl: result.finalUrl,
        sourceLibraryUrl,
        input: libraryProductInput,
        variant: {
          ...result.variant,
          prompt: libEditInstruction || result.debug?.revisedPrompt || result.variant.prompt || "仕上げ生成",
          cropUrl: result.finalUrl,
        },
        stage: "final",
        aspectRatio: libAspectRatio,
        editInstruction: [libEditInstruction, annotationPromptList()].filter(Boolean).join("\n\n"),
        generationPrompt: result.debug?.revisedPrompt || "",
        folder: folderPathFromSavedUrl(sourceLibraryUrl) || selectedSaveFolder,
      });
      if (saved.tree) setSaveTree(saved.tree);
      if (saved.folder !== undefined) setSelectedSaveFolder(saved.folder);
      setLibFinalUrl(saved.url);
      setLibSelectedUrl(saved.url);
      setLibSelectedUrls(new Set([saved.url]));
      setVersionModalUrl(saved.url);
      setStatus("仕上げ生成をライブラリに保存しました");
      addLog({ level: "success", title: `仕上げ保存完了: ${result.mode}`, detail: `${formatDebug(result.debug)}\n${saved.filePath}` });
      notifyDesktop("仕上げ完了", `${libAspectRatio} のバナーができました`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("仕上げ時にエラーが発生しました");
      addLog({ level: "error", title: "仕上げエラー", detail: message });
    } finally {
      setLibraryRefineBusy(false);
    }
  }

  function renderLibraryDetail(items: LibraryDetailItem[]) {
    if (libraryDetailCollapsed) {
      return (
        <aside className="panel libraryDetailPane collapsed">
          <button type="button" onClick={() => setLibraryDetailCollapsed(false)} title="画像詳細を開く" aria-label="画像詳細を開く">
            <span className="collapseIcon">‹</span>
            <span className="collapseLabel">画像詳細</span>
          </button>
        </aside>
      );
    }
    if (!items.length) {
      return (
        <aside className="panel libraryDetailPane emptyDetail">
          <div className="detailHead">
            <div>
              <h2>画像詳細</h2>
              <p>画像を選択するとここに詳細が表示されます。</p>
            </div>
            <button className="paneCollapseButton" type="button" onClick={() => setLibraryDetailCollapsed(true)} title="画像詳細を折りたたむ" aria-label="画像詳細を折りたたむ">›</button>
          </div>
          <div className="detailEmptyBox">
            <strong>未選択</strong>
            <span>ファイル名、評価、生成指示、バージョン情報をここで確認できます。</span>
          </div>
        </aside>
      );
    }
    if (items.length === 1) {
      const item = items[0];
      const promptText = [item.appeal, item.stylePrompt || item.prompt].filter(Boolean).join("\n\n");
      return (
        <aside className="panel libraryDetailPane">
          <div className="detailHead">
          <div>
            <h2>画像詳細</h2>
              <p>{item.kind === "saved" ? `${item.versionCount || 1}バージョン` : "未保存の生成候補"}</p>
            </div>
            <div className="detailHeadActions">
              {item.kind === "saved" ? <button className="ghostIconButton" type="button" onClick={() => openLibraryRefine(item.url)}>仕上げ生成</button> : null}
              <button className="paneCollapseButton" type="button" onClick={() => setLibraryDetailCollapsed(true)} title="画像詳細を折りたたむ" aria-label="画像詳細を折りたたむ">›</button>
            </div>
          </div>
          <img className="libraryDetailPreview" src={item.url} alt={item.title} />
          <dl className="detailList">
            <div><dt>表示名</dt><dd>{item.title}</dd></div>
            <div><dt>ファイル名</dt><dd className="breakText">{item.fileName}</dd></div>
            <div><dt>フォルダ</dt><dd>{item.folder}</dd></div>
            {item.kind === "saved" ? (
              <>
                <div><dt>評価</dt><dd className="detailStars">{item.rating ? "★".repeat(item.rating) : "未評価"}</dd></div>
                <div><dt>追加方法</dt><dd>{item.sourceType === "manual_upload" ? "手動アップロード" : "生成画像"}</dd></div>
                <div><dt>比率</dt><dd>{item.aspectRatio || "-"}</dd></div>
                {item.parentUrl ? <div><dt>生成元</dt><dd>{renderSourcePreview(item.parentUrl, fileNameFromUrl(item.parentUrl))}</dd></div> : null}
              </>
            ) : (
              <>
                <div><dt>商品</dt><dd>{item.product || "-"}</dd></div>
                <div><dt>生成日時</dt><dd>{item.createdAt ? formatShortDate(item.createdAt) : "-"}</dd></div>
              </>
            )}
            <div><dt>訴求・スタイル</dt><dd className="detailPrompt">{promptText || "保存されたプロンプト情報はありません"}</dd></div>
            {item.path ? <div><dt>保存パス</dt><dd className="breakText">{item.path}</dd></div> : null}
            {item.propertyPath ? <div><dt>プロパティ</dt><dd className="breakText">{item.propertyPath}</dd></div> : null}
          </dl>
          {item.kind === "saved" && (item.versionCount || 1) > 1 ? (
            <button className="detailDownload" type="button" onClick={() => setVersionModalUrl(item.url)}>バージョンを表示</button>
          ) : null}
          <a className="detailDownload" href={item.url} download>この画像をダウンロード</a>
        </aside>
      );
    }

    const folders = items.map((item) => item.folder);
    const products = items.map((item) => item.product);
    return (
      <aside className="panel libraryDetailPane">
        <div className="detailHead">
          <div>
            <h2>{items.length}件選択中</h2>
            <p>{items[0].kind === "saved" ? "保存済みバナーの一括選択" : "未保存候補の一括選択"}</p>
          </div>
          <button className="paneCollapseButton" type="button" onClick={() => setLibraryDetailCollapsed(true)} title="画像詳細を折りたたむ" aria-label="画像詳細を折りたたむ">›</button>
        </div>
        <div className="detailThumbGrid">
          {items.slice(0, 12).map((item) => <img key={item.url} src={item.url} alt={item.title} />)}
          {items.length > 12 ? <span>+{items.length - 12}</span> : null}
        </div>
        <dl className="detailList compact">
          <div><dt>場所</dt><dd>{commonValue(folders)}</dd></div>
          {items[0].kind === "saved" ? <div><dt>評価</dt><dd>{ratingSummary(items)}</dd></div> : <div><dt>商品</dt><dd>{commonValue(products)}</dd></div>}
          <div><dt>操作</dt><dd>一括ダウンロード、フォルダ移動、削除などは選択状態のまま実行できます。</dd></div>
        </dl>
        <div className="detailFileList">
          {items.map((item) => (
            <div key={item.url}>
              <strong>{item.title}</strong>
              <span>{item.folder} / {item.fileName}</span>
            </div>
          ))}
        </div>
      </aside>
    );
  }

  function openRefineFromVersion(url: string) {
    setLibSelectedUrl(url);
    setLibFinalUrl("");
    setRefineAnnotations([]);
    setRefineAnnotationDraft(null);
    setActiveRefineAnnotationId("");
    setLibRefineOpen(true);
    setVersionModalUrl("");
  }

  function renderVersionModal() {
    const group = versionModalUrl ? findSavedFileGroup(versionModalUrl) : null;
    if (!group?.versions?.length) return null;
    const versions = sortSavedVersionsForUi(group.versions);
    return (
      <div className="preview-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setVersionModalUrl(""); }}>
        <div className="versionModal" onMouseDown={(event) => event.stopPropagation()}>
          <div className="modalHead">
            <div>
              <h2>バージョン</h2>
              <p>オリジナルと仕上げ生成の履歴をまとめて確認できます。</p>
            </div>
            <button type="button" onClick={() => setVersionModalUrl("")}>閉じる</button>
          </div>
          <div className="versionList">
            {versions.map((version, index) => {
              const isCurrentDisplay = version.url === group.url;
              const parent = parentVersionFor(group, version);
              const promptText = [version.editInstruction, version.generationPrompt || version.stylePrompt].filter(Boolean).join("\n\n");
              return (
                <div className={`versionItem ${isCurrentDisplay ? "active" : ""}`} key={version.url}>
                  <img
                    className="versionThumb"
                    src={version.url}
                    alt={version.displayName || version.name}
                    onMouseEnter={(event) => showHoverPreview(event, version.url, version.displayName || version.name)}
                    onMouseMove={(event) => showHoverPreview(event, version.url, version.displayName || version.name)}
                    onMouseLeave={() => setHoverPreview(null)}
                    onFocus={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      showHoverPreview({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 } as React.MouseEvent, version.url, version.displayName || version.name);
                    }}
                    onBlur={() => setHoverPreview(null)}
                    tabIndex={0}
                  />
                  <div className="versionMeta">
                    <div className="versionTitle">
                      <strong>{savedVersionLabel(version, versions.length - index)}</strong>
                      {isCurrentDisplay ? <span>ライブラリ表示中</span> : null}
                    </div>
                    <input
                      className="versionNameInput"
                      defaultValue={version.displayName || version.name.replace(/\.(png|jpe?g|webp)$/i, "")}
                      onBlur={(event) => {
                        const next = event.target.value.trim();
                        const current = version.displayName || version.name.replace(/\.(png|jpe?g|webp)$/i, "");
                        if (next && next !== current) void updateLibraryFileMeta(version.url, { displayName: next });
                      }}
                    />
                    <dl>
                      <div><dt>比率</dt><dd>{version.aspectRatio || "-"}</dd></div>
                      <div><dt>保存日時</dt><dd>{version.savedAt ? formatShortDate(version.savedAt) : "-"}</dd></div>
                      {version.parentUrl ? <div><dt>生成元</dt><dd>{renderSourcePreview(version.parentUrl, parent?.displayName || parent?.name || fileNameFromUrl(version.parentUrl))}</dd></div> : null}
                    </dl>
                    <div className="versionPrompt">{promptText || "保存された生成指示はありません"}</div>
                    <div className="versionActions">
                      <button type="button" disabled={isCurrentDisplay} onClick={() => void setLibraryDisplayVersion(version.url)}>トップに表示</button>
                      <button type="button" onClick={() => openRefineFromVersion(version.url)}>これを元に再生成</button>
                      <a href={version.url} download>DL</a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const libraryDetailItems = selectedLibraryDetails();

  return (
    <div className="app">
      {/* ===== Sidebar ===== */}
      <aside className="sidebar">
        <div className="sidebar-brand">バナー作成ツール</div>
        <nav className="sidebar-nav">
          <button className={tab === "generate" ? "active" : ""} type="button" onClick={() => setTab("generate")}>バナー作成</button>
          <button className={tab === "library" ? "active" : ""} type="button" onClick={() => setTab("library")}>ライブラリ</button>
          <button className={tab === "products" ? "active" : ""} type="button" onClick={() => setTab("products")}>商品管理</button>
        </nav>
        <div className="sidebar-footer">
          <button className={tab === "settings" ? "active sidebarSettingsButton" : "sidebarSettingsButton"} type="button" onClick={() => setTab("settings")}>設定</button>
          <button type="button" disabled={busy} onClick={checkCodex}>接続テスト</button>
          <div className="status">{busy ? `処理中: ${status}` : status}</div>
          <div className="notifyStatus">
            通知: {notificationPermission === "granted" ? "ON" : notificationPermission === "denied" ? "拒否中" : "初回生成時に確認"}
          </div>
          <div className="rateLimitStatus">
            <div className="rateLimitTitle"><span>残りのレート制限</span>{rateLimitInfo?.planType && <em>{rateLimitInfo.planType}</em>}</div>
            {rateLimitInfo?.reachedType && <div className="rateLimitWarning">制限に到達: {rateLimitInfo.reachedType}</div>}
            {rateLimitInfo?.primary || rateLimitInfo?.secondary ? (
              <div className="rateLimitRows">
                {[rateLimitInfo.primary, rateLimitInfo.secondary].filter(Boolean).map((item) => {
                  const limit = item as RateLimitWindow;
                  const remaining = Math.max(0, 100 - limit.usedPercent);
                  return (
                    <div className="rateLimitRow" key={limit.label}>
                      <span>{limit.label}</span>
                      <b>{remaining}%</b>
                      <small>{formatRateReset(limit.resetsAt)}</small>
                    </div>
                  );
                })}
              </div>
            ) : <span className="rateLimitEmpty">未取得</span>}
          </div>
          <div className="sidebarLog">
            <button type="button" onClick={() => setDebugOpen((value) => !value)}>{debugOpen ? "ログを閉じる" : "ログを見る"}</button>
            {debugOpen && (
              <div className="logList sidebarLogList">
                {logs.map((log) => (
                  <div className={`logItem ${log.level}`} key={log.id}>
                    <div className="logMeta"><span>{log.time}</span><strong>{log.title}</strong></div>
                    {log.detail && <pre>{log.detail}</pre>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ===== Main content ===== */}
      <main className={`main ${tab === "generate" ? "generateMain" : ""}`}>

      {progress.active && (
        <section className={`progressPanel ${progress.active ? "running" : ""}`}>
          <div className="progressMeta"><div className="spinner" /><div><strong>{progress.title}</strong><p>{progress.detail}</p></div>{progress.total > 0 && <b>{progress.current}/{progress.total}</b>}</div>
          {progress.total > 0 && <div className="progressTrack"><div className="progressBar" style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }} /></div>}
        </section>
      )}

      {/* ===== Generate tab ===== */}
      {tab === "generate" ? (
        <>
          <div className="main-header"><div><h1>バナー作成</h1></div></div>
          <div className="historyBar generateHistoryTop">
            <label>過去の作成結果
              <select value={selectedHistoryId} onChange={(event) => { if (event.target.value) loadHistoryRecord(event.target.value); else { setSelectedHistoryId(""); } }}>
                <option value="">過去の結果を読み込む</option>
                {historyRecords.map((record) => <option value={record.id} key={record.id}>{historyLabel(record)}</option>)}
              </select>
            </label>
          </div>
          <div className="gen-layout" style={{ "--settings-width": `${genSettingsWidth}px` } as React.CSSProperties}>
            {/* Settings panel */}
            <div className="gen-left">
              <div className="panel gen-settings form">
                <div className="createModeTabs" role="tablist" aria-label="作成方法">
                  <button
                    className={createMode === "product" ? "active" : ""}
                    type="button"
                    role="tab"
                    aria-selected={createMode === "product"}
                    data-tip="商品を選び、訴求案から大量にバナー候補を作る時に使います"
                    onClick={() => setCreateMode("product")}
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6.5 8.5h11l1 12h-13l1-12Z" /><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" /></svg>
                    <span>商品から作る</span>
                  </button>
                  <button
                    className={createMode === "image" ? "active" : ""}
                    type="button"
                    role="tab"
                    aria-selected={createMode === "image"}
                    data-tip="既存バナーの構成やテイストを参考にして作る時に使います"
                    onClick={() => setCreateMode("image")}
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M7 16l4-4 3 3 2-2 3 3" /><circle cx="9" cy="9" r="1.5" /></svg>
                    <span>画像から作る</span>
                  </button>
                </div>
              <div className="createModePanel">
                <div className="createModeContent">
                  {createMode === "product" ? (
                    <>
                      <label>対象商品
                        <select value={selectedProduct?.id || ""} onChange={(event) => selectProductForGeneration(event.target.value)}>
                          {products.map((product) => <option value={product.id} key={product.id}>{product.brandName ? `${product.brandName} / ` : ""}{product.name}</option>)}
                        </select>
                      </label>
                      {selectedProduct ? (
                        <div className="productPreview">
                          <button
                            className="productMainImage"
                            type="button"
                            onMouseEnter={(event) => showHoverPreview(event, selectedProduct.images?.[0]?.url || selectedProduct.imageUrl, selectedProduct.images?.[0]?.description || "商品画像")}
                            onMouseMove={(event) => showHoverPreview(event, selectedProduct.images?.[0]?.url || selectedProduct.imageUrl, selectedProduct.images?.[0]?.description || "商品画像")}
                            onMouseLeave={() => setHoverPreview(null)}
                            onFocus={(event) => {
                              const rect = event.currentTarget.getBoundingClientRect();
                              showHoverPreview({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 } as React.MouseEvent, selectedProduct.images?.[0]?.url || selectedProduct.imageUrl, selectedProduct.images?.[0]?.description || "商品画像");
                            }}
                            onBlur={() => setHoverPreview(null)}
                          >
                            <img src={selectedProduct.images?.[0]?.url || selectedProduct.imageUrl} alt={selectedProduct.name} />
                          </button>
                          <div>
                            <strong>{selectedProduct.brandName ? `${selectedProduct.brandName} / ` : ""}{selectedProduct.name}</strong>
                            <p>{selectedProduct.notes || "商品情報をもとに作成"}</p>
                            <div className="miniImages">
                              {(selectedProduct.images || []).map((image, index) => (
                                <button
                                  type="button"
                                  key={image.id}
                                  title={image.description || `画像${index + 1}`}
                                  onMouseEnter={(event) => showHoverPreview(event, image.url, image.description || `画像${index + 1}`)}
                                  onMouseMove={(event) => showHoverPreview(event, image.url, image.description || `画像${index + 1}`)}
                                  onMouseLeave={() => setHoverPreview(null)}
                                  onFocus={(event) => {
                                    const rect = event.currentTarget.getBoundingClientRect();
                                    showHoverPreview({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 } as React.MouseEvent, image.url, image.description || `画像${index + 1}`);
                                  }}
                                  onBlur={() => setHoverPreview(null)}
                                >
                                  <img src={image.url} alt={image.description || `商品画像${index + 1}`} />
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : <div className="empty small">商品が未登録です。「商品管理」で追加してください</div>}

                      <label className="mt">作りたいイメージ（任意）
                        <textarea value={direction} onChange={(event) => { setDirection(event.target.value); resetGenerated(); }} placeholder="例: 高級感を出したい、夏っぽく。空欄ならおまかせで作ります" />
                      </label>

                      <div className={`priceBox mt ${priceInfo.trim() ? "hasPrice" : ""}`}>
                        <label>価格<input value={priceInfo} onChange={(event) => { setPriceInfo(event.target.value); resetGenerated(); }} placeholder="例: 初回価格1,000円(税込)" /></label>
                        <div className="priceModeRow">
                          <button className={priceMode === "all" ? "active" : ""} type="button" disabled={!priceInfo.trim()} onClick={() => { setPriceMode("all"); resetGenerated(); }}>価格あり</button>
                          <button className={priceMode === "mixed" ? "active" : ""} type="button" disabled={!priceInfo.trim()} onClick={() => { setPriceMode("mixed"); resetGenerated(); }}>混ぜる</button>
                          <button className={priceMode === "none" ? "active" : ""} type="button" onClick={() => { setPriceMode("none"); resetGenerated(); }}>価格なし</button>
                        </div>
                        <small>
                          {!priceInfo.trim()
                            ? "価格欄が空なら、価格なしで作成します。"
                            : priceMode === "all"
                              ? "全候補に価格を入れます。価格訴求を強めたい時。"
                              : priceMode === "mixed"
                                ? "価格あり・なしを混ぜます。表現の幅を出したい時。"
                                : "価格を入れません。世界観や訴求を優先したい時。"}
                        </small>
                      </div>
                    </>
                  ) : (
                    <div className="imageCreateShell">
                      {imageSourceUrl ? (
                        <div className="imageSourcePreview">
                          <img src={imageSourceUrl} alt="選択した参考画像" />
                          <div>
                            <strong>{selectedImageSourceFile()?.displayName || selectedImageSourceFile()?.name || fileNameFromUrl(imageSourceUrl)}</strong>
                            <button type="button" onClick={() => setImageSourcePickerOpen(true)}>選び直す</button>
                          </div>
                        </div>
                      ) : (
                        <button className="imageSourceSelectButton" type="button" onClick={() => setImageSourcePickerOpen(true)}>
                          ライブラリから選ぶ
                        </button>
                      )}
                      {imageSourceUrl ? (
                        <>
                          <button className="imageAnalysisStartButton" type="button" disabled={imageAnalysisBusy} onClick={analyzeImageSource}>
                            {imageAnalysisBusy ? <span className="miniSpinner" aria-hidden="true" /> : null}
                            {imageAnalysisBusy ? "構成分析中…" : imageAnalysis ? "もう一度分析する" : "構成分析開始"}
                          </button>
                          {imageAnalysisBusy ? (
                            <div className="imageAnalysisLoading">
                              <div className="spinner" />
                              <div>
                                <strong>構成を分析しています</strong>
                                <p>レイアウト、訴求、色、文字、デザイン要素をCodexが分解中です。</p>
                              </div>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                      {imageAnalysis ? (
                        <div className="imageAnalysisPanel">
                          {imageAnalysis.summary ? <p className="imageAnalysisSummary">{imageAnalysis.summary}</p> : null}
                          <div className="imageAnalysisList">
                            {imageAnalysis.items.map((item) => (
                              <div className="imageAnalysisItem" key={item.id}>
                                <div className="imageAnalysisItemHead">
                                  <span>{item.category}</span>
                                  <strong>{item.item}</strong>
                                  <label>
                                    <input
                                      type="checkbox"
                                      checked={Boolean(item.locked)}
                                      onChange={(event) => updateImageAnalysisItem(item.id, { locked: event.target.checked })}
                                    />
                                    固定
                                  </label>
                                </div>
                                <textarea value={item.content} onChange={(event) => updateImageAnalysisItem(item.id, { content: event.target.value })} />
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                {createMode === "product" ? (
                  <>
                    <div className="bannerCountBox mt">
                      <label>作成数
                        <select value={matchedPreset?.count || "custom"} onChange={(event) => { const found = bannerPresets.find((p) => String(p.count) === event.target.value); if (found) { setDivisions(found.divisions); setSheetRuns(found.sheetRuns); resetGenerated(); } }}>
                          {bannerPresets.map((preset) => <option value={preset.count} key={preset.count}>{preset.count}パターン</option>)}
                          {!matchedPreset ? <option value="custom">カスタム: {totalCandidates}パターン</option> : null}
                        </select>
                      </label>
                    </div>

                    <details className="advancedSettings">
                      <summary>詳細設定</summary>
                      <div className="controlGrid mt">
                        <label>1回あたりの分割数
                          <select value={divisions} onChange={(event) => { setDivisions(Number(event.target.value)); resetGenerated(); }}>
                            <option value={1}>1分割</option><option value={2}>2分割</option><option value={4}>4分割</option>
                          </select>
                        </label>
                        <label>生成回数<input min={1} max={100} type="number" value={sheetRuns} onChange={(event) => { setSheetRuns(Math.min(100, Math.max(1, Number(event.target.value) || 1))); resetGenerated(); }} /></label>
                      </div>
                      <div className="bulkBox mt">
                        <label>1度での画像生成数
                          <select value={imagesPerRequest} onChange={(event) => setImagesPerRequest(Math.min(2, Math.max(1, Number(event.target.value) || 1)))}>
                            <option value={1}>1枚（推奨）</option>
                            <option value={2}>2枚</option>
                          </select>
                        </label>
                        <small>基本は1枚ずつ直列生成します。2枚は少しまとめたい時だけ。作成数が多いほど時間がかかります。</small>
                      </div>
                      <small className="settingHint">モデル・推論強度・速度は左下の「設定」でステップごとに調整できます。</small>
                    </details>

                    {busy ? (
                      <button className="danger" type="button" style={{marginTop:8,width:"100%"}} disabled={stopping} onClick={stopGeneration}>{stopping ? "停止中…" : "生成を停止"}</button>
                    ) : (
                      <button className="primary" type="button" style={{marginTop:8,width:"100%"}} disabled={!selectedProduct} onClick={generateBanners}>バナーを作成する</button>
                    )}
                  </>
                ) : null}
              </div>
              </div>
            </div>
            <button className="folderResizeHandle generateSettingsResize" type="button" aria-label="作成設定の幅を変更" onPointerDown={startGenerateSettingsResize} />

            {/* Right side: candidates + inline library */}
            <div className="gen-right" style={{ "--gen-library-height": `${genLibraryHeight}px` } as React.CSSProperties}>
              {/* Candidate grid with multi-select */}
              <div className="gen-candidates">
                {sheetVariants.length ? (
                  <>
                    <div className="gen-candidates-header">
                      <span>{sheetVariants.length}件の候補{selectedCropUrls.size > 0 && ` — ${selectedCropUrls.size}件選択中`}</span>
                      <div className="headerActions">
                        <button className="ghostIconButton" type="button" disabled={!sheetVariants.some((variant) => variant.cropUrl)} onClick={downloadGeneratedCandidates}>一括ダウンロード</button>
                        {selectedCropUrls.size > 0 && <button type="button" onClick={clearCropSelection}>選択解除</button>}
                      </div>
                    </div>
                    <div className="candidateScroll">
                      <div className="cropGrid">
                        {sheetVariants.map((variant) => {
                          const isSelected = variant.cropUrl ? selectedCropUrls.has(variant.cropUrl) : false;
                          return (
                            <button
                              className={`crop ${isSelected ? "active" : ""}`}
                              key={variant.cropUrl}
                              type="button"
                              draggable
                              onClick={(event) => handleCropClick(event, variant)}
                              onDoubleClick={() => { setSelected(variant); setPreviewVariant(variant); }}
                              onDragStart={(e) => startImageDrag(e, variant.cropUrl, variant, "candidate")}
                              onMouseEnter={(e) => showHoverPreview(e, variant.cropUrl, variantCaption(variant))}
                              onMouseMove={(e) => showHoverPreview(e, variant.cropUrl, variantCaption(variant))}
                              onMouseLeave={() => setHoverPreview(null)}
                              onFocus={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                showHoverPreview({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 } as React.MouseEvent, variant.cropUrl, variantCaption(variant));
                              }}
                              onBlur={() => setHoverPreview(null)}
                            >
                              <img src={variant.cropUrl} alt={`candidate ${variant.globalIndex || variant.index}`} />
                              <span className="crop-index">{variant.globalIndex || variant.index}</span>
                              {variant.cropUrl && (
                                <a
                                  className="tileDownload"
                                  href={variant.cropUrl}
                                  download
                                  title="ダウンロード"
                                  aria-label="画像をダウンロード"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  ↓
                                </a>
                              )}
                              {isSelected && <span className="crop-check">✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                ) : <div className="empty">「バナーを作成する」で候補が表示されます</div>}

              </div>

              <button className="genSplitHandle" type="button" aria-label="生成画像一覧とライブラリの高さを変更" onPointerDown={startGenerateSplitResize} />

              {/* Inline mini library */}
              <div className="gen-library">
                <div className="gen-library-header">
                  <h2>ライブラリ</h2>
                </div>
                <div className="gen-library-body" style={{ "--folder-width": `${Math.min(libraryFolderWidth, 420)}px` } as React.CSSProperties}>
                  <div className="gen-library-folders">
                    <div className="folderToolbar">
                      <input value={newSaveFolderName} onChange={(event) => setNewSaveFolderName(event.target.value)} placeholder={selectedSaveFolder ? "配下に作るフォルダ名" : "新規フォルダ名"} />
                      <button type="button" disabled={busy || !newSaveFolderName.trim()} onClick={createSaveFolder}>作成</button>
                    </div>
                    {renderLibraryAxis(false)}
                  </div>
                  <button className="folderResizeHandle" type="button" aria-label="フォルダ幅を変更" onPointerDown={startFolderResize} />
                  <div
                    className="gen-library-drop"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => dropToSave(event)}
                  >
                    <div className="saveDrop">
                      <strong>ここへドラッグして保存</strong>
                      <span>画像ファイルを直接追加できます</span>
                      {selectedCropUrls.size > 0 && (
                        <button className="saveSelectedButton" type="button" disabled={busy} onClick={() => void saveSelectedCrops()}>
                          選択した{selectedCropUrls.size}枚をここに保存
                        </button>
                      )}
                    </div>
                    {selectedSaveNode()?.files.length ? (
                      <>
                        <div className="thumbSizeRow">
                          <span>画像サイズ</span>
                          <input type="range" min={48} max={132} step={4} value={libraryThumbSize} onChange={(event) => setLibraryThumbSize(Number(event.target.value))} />
                        </div>
                        <div className="gen-library-files" style={{ "--thumb-size": `${libraryThumbSize}px` } as React.CSSProperties}>
                          {selectedSaveNode()?.files.map((item) => (
                            <a
                              href={item.url}
                              className="gen-lib-thumb"
                              key={item.path}
                              target="_blank"
                              onMouseEnter={(event) => showHoverPreview(event, item.url, libraryCaption(item))}
                              onMouseMove={(event) => showHoverPreview(event, item.url, libraryCaption(item))}
                              onMouseLeave={() => setHoverPreview(null)}
                              onFocus={(event) => {
                                const rect = event.currentTarget.getBoundingClientRect();
                                showHoverPreview({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 } as React.MouseEvent, item.url, libraryCaption(item));
                              }}
                              onBlur={() => setHoverPreview(null)}
                            >
                              <img src={item.url} alt={item.name} />
                            </a>
                          ))}
                        </div>
                        <button
                          className="lib-open-link"
                          type="button"
                          onClick={() => { setTab("library"); }}
                        >
                          このフォルダをライブラリタブで開く →
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Preview modal */}
          {previewVariant && (
            <div className="preview-overlay" onClick={() => setPreviewVariant(null)}>
              <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
                <img src={previewVariant.cropUrl} alt="preview" />
                <div className="preview-actions">
                  <h2>候補 {previewVariant.globalIndex || previewVariant.index}</h2>
                  <p style={{color:"var(--sub)",fontSize:13,lineHeight:1.5,marginTop:4}}>{previewVariant.appeal || previewVariant.prompt}</p>
                  {previewVariant.priceTreatment === "with_price" && <span className="priceChip">価格あり</span>}
                  <button className="primary" type="button" onClick={() => { quickSave(previewVariant); }}>ライブラリに保存</button>
                  <button type="button" onClick={() => setPreviewVariant(null)}>閉じる</button>
                </div>
              </div>
            </div>
          )}
          {imageSourcePickerOpen && (
            <div className="preview-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) { setHoverPreview(null); setImageSourcePickerOpen(false); } }}>
              <div className="imageSourcePickerModal" onMouseDown={(event) => event.stopPropagation()}>
                <div className="modalHead">
                  <div>
                    <h2>ライブラリから選ぶ</h2>
                    <p>参考にする既存バナーを1枚選択します。</p>
                  </div>
                  <button type="button" onClick={() => { setHoverPreview(null); setImageSourcePickerOpen(false); }}>閉じる</button>
                </div>
                <div className="imageSourcePickerBody">
                  <aside className="imageSourceFolderPane">
                    <div className="folderTree">
                      {saveTree ? renderImageSourceFolderNode(saveTree) : <div className="empty small">読み込み中</div>}
                    </div>
                  </aside>
                  <section className="imageSourceListPane">
                    <div className="libraryFilters">
                      <div className="filterSearchBox">
                        <input value={imageSourceSearch} onChange={(event) => setImageSourceSearch(event.target.value)} placeholder="画像名・プロンプトで検索" />
                        {imageSourceSearch ? <button type="button" aria-label="検索をクリア" onClick={() => setImageSourceSearch("")}>×</button> : null}
                      </div>
                    </div>
                    {imageSourcePickerFiles().length ? (
                      <div className="imageSourceGrid">
                        {imageSourcePickerFiles().map((item) => (
                          <button
                            className={imageSourceUrl === item.url ? "active" : ""}
                            type="button"
                            key={item.path}
                            onClick={() => selectImageSource(item.url)}
                            onDoubleClick={() => { selectImageSource(item.url); setHoverPreview(null); setImageSourcePickerOpen(false); }}
                            onMouseEnter={(event) => showHoverPreview(event, item.url, libraryCaption(item))}
                            onMouseMove={(event) => showHoverPreview(event, item.url, libraryCaption(item))}
                            onMouseLeave={() => setHoverPreview(null)}
                          >
                            <img src={item.url} alt={item.displayName || item.name} />
                            <span>{item.displayName || item.name.replace(/\.(png|jpe?g|webp)$/i, "")}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="empty">条件に合う画像がありません</div>
                    )}
                  </section>
                </div>
                <div className="imageSourcePickerActions">
                  <button type="button" onClick={() => { setHoverPreview(null); setImageSourcePickerOpen(false); }}>キャンセル</button>
                  <button className="primary" type="button" disabled={!imageSourceUrl} onClick={() => { setHoverPreview(null); setImageSourcePickerOpen(false); }}>この画像を使う</button>
                </div>
              </div>
            </div>
          )}
          {hoverPreview && !previewVariant && (
            <div
              className={`floatingHoverPreview ${hoverPreview.placement}`}
              style={{ left: hoverPreview.x, top: hoverPreview.y } as React.CSSProperties}
              aria-hidden="true"
            >
              <img src={hoverPreview.url} alt="" />
              {hoverPreview.caption ? <p>{hoverPreview.caption}</p> : null}
            </div>
          )}
        </>

      ) : tab === "library" ? (
        <>
          <div className="main-header"><div><h1>ライブラリ</h1><p>保存したバナーを整理・仕上げできます</p></div></div>
          <div className={`lib-layout ${libraryDetailCollapsed ? "detail-collapsed" : ""}`} style={{ "--folder-width": `${libraryFolderWidth}px` } as React.CSSProperties}>
            {/* Folder tree */}
            <div className="panel folderPane">
              <div className="sectionHead"><h2>フォルダ</h2></div>
              <div className="folderToolbar">
                <input value={newSaveFolderName} onChange={(event) => setNewSaveFolderName(event.target.value)} placeholder={selectedSaveFolder ? "配下に作るフォルダ名" : "新規フォルダ名"} />
                <button type="button" disabled={busy || !newSaveFolderName.trim()} onClick={createSaveFolder}>作成</button>
              </div>
              {renderLibraryAxis()}
            </div>
            <button className="folderResizeHandle libraryResize" type="button" aria-label="フォルダ幅を変更" onPointerDown={startFolderResize} />

            {/* Banner grid */}
            <div className="panel libraryContentPane" onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropToSave(event)}>
              <div className="sectionHead">
                <div><h2>{libraryView === "saved" ? selectedSaveFolder || "保存済み" : "未保存"}</h2></div>
                <div className="headerActions">
                  {libraryView === "saved" && (
                    <>
                      <button className="ghostIconButton" type="button" disabled={busy} onClick={() => libraryUploadInputRef.current?.click()}>画像を追加</button>
                      <input
                        ref={libraryUploadInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        hidden
                        onChange={(event) => void uploadManualLibraryFiles(Array.from(event.target.files || []))}
                      />
                    </>
                  )}
                  <button className="ghostIconButton" type="button" disabled={libraryView === "saved" ? !currentLibraryFiles().length : !unsavedLibraryFiles().length} onClick={downloadCurrentLibraryView}>一括ダウンロード</button>
                  <span className="badge">
                    {libraryView === "saved" ? currentLibraryFiles().length : unsavedLibraryFiles().length}枚
                    {libSelectedUrls.size > 0 ? ` / ${libSelectedUrls.size}枚選択中` : ""}
                  </span>
                  {libraryView === "saved" && libSelectedUrls.size === 1 && <button className="ghostIconButton" type="button" onClick={() => openLibraryRefine()}>仕上げ生成</button>}
                  {libSelectedUrls.size > 0 && <button type="button" onClick={clearLibrarySelection}>選択解除</button>}
                </div>
              </div>
              {libraryView === "saved" ? (
                <div className="libraryFilters">
                  <div className="filterSearchBox">
                    <input value={librarySearch} onChange={(event) => { setLibrarySearch(event.target.value); clearLibrarySelection(); }} placeholder="ファイル名・表示名で検索" />
                    {librarySearch ? <button type="button" aria-label="検索をクリア" onClick={() => { setLibrarySearch(""); clearLibrarySelection(); }}>×</button> : null}
                  </div>
                  <select value={libraryRatingFilter} onChange={(event) => { setLibraryRatingFilter(event.target.value); clearLibrarySelection(); }}>
                    <option value="all">評価すべて</option>
                    <option value="unrated">未評価のみ</option>
                    <option value={1}>★1以上</option>
                    <option value={2}>★2以上</option>
                    <option value={3}>★3以上</option>
                    <option value={4}>★4以上</option>
                    <option value={5}>★5</option>
                  </select>
                </div>
              ) : (
                <div className="libraryFilters">
                  <div className="filterSearchBox">
                    <input value={librarySearch} onChange={(event) => { setLibrarySearch(event.target.value); clearLibrarySelection(); }} placeholder="商品名・訴求案で検索" />
                    {librarySearch ? <button type="button" aria-label="検索をクリア" onClick={() => { setLibrarySearch(""); clearLibrarySelection(); }}>×</button> : null}
                  </div>
                  <select value={unsavedHistoryFilter} onChange={(event) => { setUnsavedHistoryFilter(event.target.value); clearLibrarySelection(); }}>
                    <option value="">生成履歴すべて</option>
                    {historyRecords.map((record) => <option value={record.id} key={record.id}>{historyLabel(record)}</option>)}
                    {orphanHistoryRecords.length ? <option value="__orphan__">履歴なしの未保存画像</option> : null}
                  </select>
                </div>
              )}
              <div className="breadcrumb">
                {(libraryView === "saved" ? saveBreadcrumb() : [{ name: "未保存", path: "__unsaved__" }]).map((item, index) => (
                  <button type="button" key={item.path || "root"} onClick={() => item.path === "__unsaved__" ? selectUnsavedLibrary() : selectSavedFolder(item.path)}>{index > 0 ? " / " : ""}{item.name}</button>
                ))}
              </div>
              {libraryView === "saved" && selectedSaveNode()?.children.length ? (
                <div className="folderSummary">
                  {selectedSaveNode()?.children.map((folder) => (
                    <button type="button" key={folder.path} onClick={() => selectSavedFolder(folder.path)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropToSave(event, folder.path)}>
                      <strong>{folder.name}</strong><span>{folderCountLabel(folder)}枚</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {libraryView === "saved" ? (currentLibraryFiles().length ? (
                <div
                  className={`bannerGrid selectionSurface ${marqueeSelection.active ? "selecting" : ""}`}
                  onPointerDown={startLibraryMarquee}
                  onPointerMove={moveLibraryMarquee}
                  onPointerUp={endLibraryMarquee}
                  onPointerCancel={endLibraryMarquee}
                >
                  {currentLibraryFiles().map((item) => (
                    <div
                      className={`bannerTile ${libSelectedUrls.has(item.url) ? "active" : ""}`}
                      key={item.path}
                      data-url={item.url}
                      draggable
                      onDragStart={(event) => startLibraryFileDrag(event, item.url)}
                      onClick={(event) => handleLibraryTileClick(event, item.url, currentLibraryFiles().map((file) => file.url))}
                    >
                      <div
                        className="bannerImageWrap"
                        onDoubleClick={() => openLibraryRefine(item.url)}
                        onMouseEnter={(event) => showHoverPreview(event, item.url, libraryCaption(item))}
                        onMouseMove={(event) => showHoverPreview(event, item.url, libraryCaption(item))}
                        onMouseLeave={() => setHoverPreview(null)}
                      >
                        <img src={item.url} alt={item.name} />
                        <button
                          className="bannerDelete"
                          type="button"
                          aria-label={`${item.displayName || item.name}を削除`}
                          title="削除"
                          onClick={(event) => {
                            event.stopPropagation();
                            void deleteLibraryFile(item.url, item.displayName || item.name);
                          }}
                        >
                          ×
                        </button>
                        <a
                          className="tileDownload"
                          href={item.url}
                          download
                          title="ダウンロード"
                          aria-label={`${item.displayName || item.name}をダウンロード`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          ↓
                        </a>
                        {(item.versionCount || 1) > 1 && (
                          <button
                            className="versionBadge"
                            type="button"
                            title="バージョンを表示"
                            aria-label={`${item.versionCount}件のバージョンを表示`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setVersionModalUrl(item.url);
                            }}
                          >
                            {item.versionCount}
                          </button>
                        )}
                      </div>
                      {!selectedSaveFolder && item.url.includes("/") ? <small className="folderLabel">{decodeURIComponent(item.url.replace("/saved-banners/", "").split("/").slice(0, -1).join("/")) || "ルート"}</small> : null}
                      <input
                        className="bannerNameInput"
                        defaultValue={item.displayName || item.name.replace(/\.(png|jpe?g|webp)$/i, "")}
                        onClick={(event) => event.stopPropagation()}
                        onBlur={(event) => {
                          const next = event.target.value.trim();
                          const current = item.displayName || item.name.replace(/\.(png|jpe?g|webp)$/i, "");
                          if (next && next !== current) void updateLibraryFileMeta(item.url, { displayName: next });
                        }}
                      />
                      <div className="ratingRow" onClick={(event) => event.stopPropagation()} onMouseLeave={() => setRatingHover(null)}>
                        {[1, 2, 3, 4, 5].map((rating) => (
                          <button
                            type="button"
                            className={rating <= (ratingHover?.url === item.url ? ratingHover.rating : item.rating || 0) ? "active" : ""}
                            key={rating}
                            title={`評価${rating}`}
                            onMouseEnter={() => setRatingHover({ url: item.url, rating })}
                            onFocus={() => setRatingHover({ url: item.url, rating })}
                            onBlur={() => setRatingHover(null)}
                            onClick={() => void updateLibraryFileMeta(item.url, { rating: rating === item.rating ? 0 : rating })}
                          >
                            ★
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div className="empty">条件に合うバナーがありません</div>) : (unsavedLibraryFiles().length ? (
                <div
                  className={`bannerGrid selectionSurface ${marqueeSelection.active ? "selecting" : ""}`}
                  onPointerDown={startLibraryMarquee}
                  onPointerMove={moveLibraryMarquee}
                  onPointerUp={endLibraryMarquee}
                  onPointerCancel={endLibraryMarquee}
                >
                  {unsavedLibraryFiles().map((item) => (
                    <div
                      className={`bannerTile ${libSelectedUrls.has(item.url) ? "active" : ""}`}
                      key={item.url}
                      data-url={item.url}
                      draggable
                      onDragStart={(event) => startImageDrag(event, item.url, item.variant, "candidate")}
                      onClick={(event) => handleLibraryTileClick(event, item.url, unsavedLibraryFiles().map((file) => file.url))}
                    >
                      <div
                        className="bannerImageWrap"
                        onMouseEnter={(event) => showHoverPreview(event, item.url, [item.variant.appeal, item.variant.prompt].filter(Boolean).join("\n"))}
                        onMouseMove={(event) => showHoverPreview(event, item.url, [item.variant.appeal, item.variant.prompt].filter(Boolean).join("\n"))}
                        onMouseLeave={() => setHoverPreview(null)}
                      >
                        <img src={item.url} alt={item.variant.appeal || item.product} />
                        <a
                          className="tileDownload"
                          href={item.url}
                          download
                          title="ダウンロード"
                          aria-label="画像をダウンロード"
                          onClick={(event) => event.stopPropagation()}
                        >
                          ↓
                        </a>
                      </div>
                      <small className="folderLabel">{formatShortDate(item.createdAt)} / {item.product}</small>
                      <div className="unsavedMeta">
                        <strong>{item.variant.appeal || "未保存候補"}</strong>
                        <span>{item.variant.prompt}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div className="empty">未保存の候補はありません</div>)}
            </div>
            {renderLibraryDetail(libraryDetailItems)}
          </div>
          {libRefineOpen && libSelectedUrl && libraryView === "saved" && (
            <div className="preview-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setLibRefineOpen(false); }}>
              <div className="libraryRefineModal form" onMouseDown={(event) => event.stopPropagation()}>
                <div className="modalHead">
                  <div>
                    <h2>バナーを仕上げる</h2>
                    <p>選択した画像をもとに、指定比率で単体バナーへ再生成します。</p>
                  </div>
                  <button type="button" onClick={() => setLibRefineOpen(false)}>閉じる</button>
                </div>
                <div className="libraryRefineBody">
                  <div className="refineAnnotator">
                    <div className="refineCanvas">
                      <img className="refine-preview" src={libFinalUrl || libSelectedUrl} alt="selected" />
                      {!libFinalUrl && (
                        <div
                          className={`refineAnnotationLayer tool-${refineAnnotationTool}`}
                          onPointerDown={startRefineAnnotation}
                          onPointerMove={moveRefineAnnotation}
                          onPointerUp={finishRefineAnnotation}
                          onPointerCancel={() => setRefineAnnotationDraft(null)}
                        >
                          {refineAnnotations.map((mark, index) => (
                            mark.kind === "box" ? (
                              <span
                                className={`refineMark refineBox ${activeRefineAnnotationId === mark.id ? "active" : ""}`}
                                key={mark.id}
                                style={{
                                  left: `${mark.x * 100}%`,
                                  top: `${mark.y * 100}%`,
                                  width: `${(mark.width || 0) * 100}%`,
                                  height: `${(mark.height || 0) * 100}%`,
                                }}
                              >
                                <b>{index + 1}</b>
                              </span>
                            ) : (
                              <span
                                className={`refineMark refinePin ${activeRefineAnnotationId === mark.id ? "active" : ""}`}
                                key={mark.id}
                                style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }}
                              >
                                {index + 1}
                              </span>
                            )
                          ))}
                          {refineAnnotationDraft && (
                            <span
                              className="refineMark refineBox drafting"
                              style={{
                                left: `${refineAnnotationDraft.x * 100}%`,
                                top: `${refineAnnotationDraft.y * 100}%`,
                                width: `${refineAnnotationDraft.width * 100}%`,
                                height: `${refineAnnotationDraft.height * 100}%`,
                              }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                    <p className="annotationHint">{libFinalUrl ? "生成済み画像です。再度メモする場合はこのバージョンから仕上げ生成を開いてください。" : "必要な時だけ、画像上に修正メモを置けます。赤い番号や枠は生成結果には入れません。"}</p>
                  </div>
                  <div className="libraryRefineControls">
                    <div className="annotationPanel">
                      <div className="annotationPanelHead">
                        <div>
                          <strong>修正メモ</strong>
                          <span>任意</span>
                        </div>
                        {refineAnnotations.length > 0 && <button type="button" onClick={() => { setRefineAnnotations([]); setActiveRefineAnnotationId(""); }}>クリア</button>}
                      </div>
                      <div className="annotationTools">
                        <button type="button" className={refineAnnotationTool === "pin" ? "active" : ""} onClick={() => setRefineAnnotationTool("pin")} disabled={Boolean(libFinalUrl)}>ピン</button>
                        <button type="button" className={refineAnnotationTool === "box" ? "active" : ""} onClick={() => setRefineAnnotationTool("box")} disabled={Boolean(libFinalUrl)}>範囲</button>
                      </div>
                      <p>{refineAnnotationTool === "pin" ? "画像をクリックして、直したい場所に番号を置きます。" : "画像をドラッグして、直したい範囲を囲みます。"}</p>
                      {refineAnnotations.length ? (
                        <div className="annotationList">
                          {refineAnnotations.map((mark, index) => (
                            <div className={`annotationItem ${activeRefineAnnotationId === mark.id ? "active" : ""}`} key={mark.id}>
                              <button className="annotationNumber" type="button" onClick={() => setActiveRefineAnnotationId(mark.id)}>{index + 1}</button>
                              <input
                                value={mark.text}
                                onFocus={() => setActiveRefineAnnotationId(mark.id)}
                                onChange={(event) => updateRefineAnnotation(mark.id, event.target.value)}
                                placeholder={mark.kind === "box" ? "例: この範囲の文字を大きく" : "例: ここに価格を移動"}
                              />
                              <button className="annotationRemove" type="button" onClick={() => removeRefineAnnotation(mark.id)} aria-label={`${index + 1}を削除`}>×</button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="annotationEmpty">メモなしでも生成できます。</div>
                      )}
                    </div>
                    <label>サイズ
                      <select value={libAspectRatio} onChange={(event) => { setLibAspectRatio(event.target.value); setLibFinalUrl(""); }}>
                        {imageAspectOptions.map((option) => (
                          <option value={option.value} key={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>調整メモ（任意）
                      <textarea value={libEditInstruction} onChange={(event) => setLibEditInstruction(event.target.value)} placeholder="例: 背景を明るく、商品を大きく" />
                    </label>
                    <button className="primary" type="button" disabled={libraryRefineBusy} onClick={refineLibraryImage}>
                      {libraryRefineBusy ? "仕上げ生成中…" : `${libAspectRatio}で仕上げ生成`}
                    </button>
                    {libFinalUrl && (
                      <>
                        <div className="savedNotice">新しいバージョンとして保存済み</div>
                        <a href={libFinalUrl} download style={{display:"block",textAlign:"center",color:"var(--accent)",fontSize:11,marginTop:4}}>ダウンロード</a>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          {renderVersionModal()}
          {hoverPreview && (
            <div
              className={`floatingHoverPreview ${hoverPreview.placement}`}
              style={{ left: hoverPreview.x, top: hoverPreview.y } as React.CSSProperties}
              aria-hidden="true"
            >
              <img src={hoverPreview.url} alt="" />
              {hoverPreview.caption ? <p>{hoverPreview.caption}</p> : null}
            </div>
          )}
          {marqueeSelection.active && (
            <div
              className="marqueeSelectionBox"
              style={{
                left: Math.min(marqueeSelection.startX, marqueeSelection.currentX),
                top: Math.min(marqueeSelection.startY, marqueeSelection.currentY),
                width: Math.abs(marqueeSelection.currentX - marqueeSelection.startX),
                height: Math.abs(marqueeSelection.currentY - marqueeSelection.startY),
              } as React.CSSProperties}
              aria-hidden="true"
            />
          )}
        </>

      ) : tab === "settings" ? (
        <>
          <div className="main-header">
            <div>
              <h1>設定</h1>
              <p>生成ステップごとのプロンプトとCodex設定を管理します</p>
            </div>
          </div>
          <section className="settingsLayout compact">
            <div className="panel ideaStrategyPanel">
              <div className="sectionHead">
                <h2>大量生成の案設計</h2>
                <span className="mutedText">100件以上でも案が薄まらないよう、Step 1を小さく分けてテーマを散らします。</span>
              </div>
              <div className="ideaStrategyGrid">
                <label>1回の案生成数
                  <input
                    min={4}
                    max={40}
                    type="number"
                    value={ideaGenerationSettings.chunkSize}
                    onChange={(event) => updateIdeaGenerationSettings({ chunkSize: Number(event.target.value) || DEFAULT_IDEA_GENERATION_SETTINGS.chunkSize })}
                  />
                  <small>推奨20。小さいほど濃くなりやすく、大量時も止まりにくいです。</small>
                </label>
                <label>テーマ分散
                  <select value={ideaGenerationSettings.themeMode} onChange={(event) => updateIdeaGenerationSettings({ themeMode: event.target.value as IdeaGenerationSettings["themeMode"] })}>
                    <option value="balanced">バランス重視</option>
                    <option value="wide">幅広さ重視</option>
                  </select>
                  <small>幅広さ重視はチャンクごとの見た目・訴求をより大きく変えます。</small>
                </label>
                <label>重複回避
                  <select value={ideaGenerationSettings.overlapAvoidance} onChange={(event) => updateIdeaGenerationSettings({ overlapAvoidance: event.target.value as IdeaGenerationSettings["overlapAvoidance"] })}>
                    <option value="strong">強め</option>
                    <option value="normal">標準</option>
                  </select>
                  <small>既出案の要約を渡して、似たコピーや構図の言い換えを抑えます。</small>
                </label>
              </div>
              <div className="ideaStrategyPreview">
                <strong>現在の設計</strong>
                <span>作成数 {generationTotal}件なら Step 1 は約 {Math.ceil(generationTotal / Math.max(1, ideaGenerationSettings.chunkSize))} 回に分けて考えます。</span>
              </div>
            </div>
            <div className="panel promptPresetList">
              <div className="sectionHead">
                <h2>ステップ別設定</h2>
                <span className="mutedText">プロンプトはプリセットから選択し、編集はポップアップで行います。</span>
              </div>
              {(Object.keys(promptStepLabels) as PromptStep[]).map((step) => {
                const currentPreset = selectedPromptPreset(step);
                return (
                  <div className="promptStepCard compact" key={step}>
                    <div className="promptStepHead">
                      <div>
                        <strong>{promptStepLabels[step]}</strong>
                        <p>{currentPreset?.builtIn ? "デフォルトプリセット" : "カスタムプリセット"}</p>
                      </div>
                      <span>{currentPreset?.name || "未選択"}</span>
                    </div>
                    <div className="promptPresetSelectRow">
                      <label>プロンプト
                        <select value={selectedPromptPresetIds[step]} onChange={(event) => choosePromptPreset(step, event.target.value)}>
                          {promptPresetsFor(step).map((preset) => <option value={preset.id} key={preset.id}>{preset.name}{preset.builtIn ? "（デフォルト）" : ""}</option>)}
                        </select>
                      </label>
                      <div className="promptActionBar">
                        <button type="button" onClick={() => openPromptPresetEditor(step, "create")}>追加</button>
                        <button type="button" disabled={!currentPreset} onClick={() => currentPreset && openPromptPresetEditor(step, "edit", currentPreset)}>編集</button>
                        <button type="button" disabled={!currentPreset} onClick={() => currentPreset && openPromptPresetEditor(step, "copy", currentPreset)}>コピー</button>
                        {currentPreset && !currentPreset.builtIn ? <button className="dangerText" type="button" onClick={() => deletePromptPreset(currentPreset)}>削除</button> : null}
                      </div>
                    </div>
                    <div className="stepModelSettings">
                      <label>モデル
                        <select value={stepCodexSettings[step].model} onChange={(event) => updateStepCodexSettings(step, { model: event.target.value })}>
                          <option value="gpt-5.5">gpt-5.5</option>
                          <option value="gpt-5.4">gpt-5.4</option>
                          <option value="gpt-5.4-mini">gpt-5.4-mini</option>
                        </select>
                      </label>
                      <label>推論強度
                        <select value={stepCodexSettings[step].effort} onChange={(event) => updateStepCodexSettings(step, { effort: event.target.value as CodexSettings["effort"] })}>
                          <option value="low">低</option>
                          <option value="medium">中（標準）</option>
                          <option value="high">高</option>
                          <option value="xhigh">非常に高い</option>
                        </select>
                      </label>
                      <label>速度
                        <select value={stepCodexSettings[step].serviceTier} onChange={(event) => updateStepCodexSettings(step, { serviceTier: event.target.value as CodexSettings["serviceTier"] })}>
                          <option value="auto">通常</option>
                          <option value="fast">速い</option>
                        </select>
                      </label>
                    </div>
                    <small className="stepSettingHint">このステップのCodexリクエストだけに適用します。分割や商品情報など必須条件は実行時に固定で追加されます。</small>
                  </div>
                );
              })}
            </div>
          </section>

          {promptEditorOpen && (
            <div className="preview-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closePromptPresetEditor(); }}>
              <div className="promptEditorModal form" onMouseDown={(event) => event.stopPropagation()}>
                <div className="modalHead">
                  <div>
                    <h2>{promptDraftId ? "プロンプト編集" : "プロンプト追加"}</h2>
                    <p>{promptStepLabels[promptDraftStep]} のプリセットを調整します</p>
                  </div>
                  <button type="button" onClick={closePromptPresetEditor}>閉じる</button>
                </div>
                <div className="controlGrid">
                  <label>ステップ
                    <select value={promptDraftStep} onChange={(event) => {
                      const step = event.target.value as PromptStep;
                      const base = selectedPromptPreset(step) || promptPresetsFor(step)[0];
                      setPromptDraftStep(step);
                      setPromptDraftId("");
                      setPromptDraftName(base ? `${base.name}のコピー` : "");
                      setPromptDraftTemplate(base?.template || "");
                    }}>
                      {(Object.keys(promptStepLabels) as PromptStep[]).map((step) => <option value={step} key={step}>{promptStepLabels[step]}</option>)}
                    </select>
                  </label>
                  <label>プリセット名
                    <input value={promptDraftName} onChange={(event) => setPromptDraftName(event.target.value)} placeholder="例: 攻めた美容バナー用" />
                  </label>
                </div>

                <div className="variablePanel">
                  <div>
                    <strong>変数</strong>
                    <p>クリックするとプロンプト末尾に挿入します。破綻防止の必須条件は固定ルールとして自動で追加されます。</p>
                  </div>
                  <div className="variableChips">
                    {promptVariableHelp[promptDraftStep].map((item) => (
                      <button type="button" key={item.key} title={item.description} onClick={() => insertPromptVariable(item.key)}>
                        {`{{${item.key}}}`}{item.required ? <b>固定</b> : null}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="fixedGuardrailPanel">
                  <strong>固定で必ず入る条件</strong>
                  <div>
                    {fixedPromptGuardrailSummary[promptDraftStep].map((item) => <span key={item}>{item}</span>)}
                  </div>
                  <p>カスタム本文を短くしても、実行時にこのステップの最低限のルールを末尾へ自動追加します。</p>
                </div>

                <label>プロンプトテンプレート
                  <textarea className="promptTextarea" value={promptDraftTemplate} onChange={(event) => setPromptDraftTemplate(event.target.value)} placeholder="デフォルトをコピーして編集してください" />
                </label>

                {promptMissingVariables(promptDraftStep).length ? (
                  <div className="promptValidation error">
                    不足している必須変数: {promptMissingVariables(promptDraftStep).map((key) => `{{${key}}}`).join(", ")}
                  </div>
                ) : (
                  <div className="promptValidation ok">固定ルール込みで必須条件は入ります</div>
                )}

                <div className="buttonRow">
                  <button type="button" onClick={closePromptPresetEditor}>キャンセル</button>
                  <button className="primary" type="button" disabled={busy || !!promptMissingVariables(promptDraftStep).length || !promptDraftName.trim() || !promptDraftTemplate.trim()} onClick={savePromptPreset}>
                    保存
                  </button>
                </div>
              </div>
            </div>
          )}
        </>

      ) : (
        <>
          <div className="main-header"><div><h1>商品管理</h1><p>バナー作成に使う商品情報を管理します</p></div></div>
          <section className="masterGrid" onPaste={handlePaste}>
            {/* Left: product list */}
            <div className="panel">
              <div className="sectionHead">
                <h2>商品一覧</h2>
                <button type="button" onClick={resetProductForm}>＋ 新規追加</button>
              </div>
              {products.length ? (
                <div className="productList">
                  {products.map((product) => (
                    <button
                      className={`productCard ${editingProductId === product.id ? "active" : ""}`}
                      key={product.id}
                      type="button"
                      onClick={() => loadProductForEdit(product)}
                    >
                      <img src={product.images?.[0]?.url || product.imageUrl} alt={product.name} />
                      <span>{product.brandName ? `${product.brandName} / ` : ""}{product.name}</span>
                      <small>画像{product.images?.length || 0}枚{product.priceInfo ? ` / ${product.priceInfo}` : ""}</small>
                    </button>
                  ))}
                </div>
              ) : <div className="empty small">まだ商品が登録されていません</div>}
            </div>

            {/* Right: edit/register form */}
            <div className="panel form">
              <div className="sectionHead">
                <h2>{editingProductId ? "商品を編集" : "新しい商品を追加"}</h2>
                {editingProductId && (
                  <button className="createBannerButton" type="button" onClick={() => { selectProductForGeneration(editingProductId); setTab("generate"); }}>
                    この商品のバナーを作る
                  </button>
                )}
              </div>
              <div className="brandSelectRow">
                <label>ブランド<select value={newBrandName} onChange={(event) => setNewBrandName(event.target.value)}>
                    {brandOptions.map((brand) => <option value={brand} key={brand}>{brand}</option>)}
                  </select></label>
                <button type="button" onClick={() => setBrandModalOpen(true)}>管理</button>
              </div>
              <label>商品名<input value={newProductName} onChange={(event) => setNewProductName(event.target.value)} placeholder="例: スカルプケアシャンプー" /></label>
              <label>価格情報<input value={newProductPriceInfo} onChange={(event) => setNewProductPriceInfo(event.target.value)} placeholder="例: 初回価格1,000円(税込)" /></label>
              <label>メモ<textarea value={newProductNotes} onChange={(event) => setNewProductNotes(event.target.value)} placeholder="ターゲットやトーンなど、バナーに反映したい情報" /></label>
              <div className="dropZone" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
                <strong>商品画像を追加</strong>
                <span>ドラッグ&ドロップ、ペースト、ファイル選択OK</span>
                <input type="file" accept="image/*" multiple onChange={(event) => addImageFiles(Array.from(event.target.files || []))} />
              </div>
              <div className="imageRows">
                {newImages.map((row, index) => (
                  <div className="imageRow" key={row.id}>
                    <div className="thumbPreview">{row.previewUrl ? <img src={row.previewUrl} alt={`new image ${index + 1}`} /> : <span>画像{index + 1}</span>}</div>
                    <label>この画像の説明<input value={row.description} onChange={(event) => updateImageRow(row.id, { description: event.target.value })} placeholder="例: 正面パッケージ、質感アップ" /></label>
                    <button className="imageRemove" type="button" aria-label={`画像${index + 1}を削除`} title="画像を削除" onClick={() => removeProductImageRow(row, index)}>×</button>
                  </div>
                ))}
              </div>
              <div className="buttonRow">
                <button type="button" onClick={() => setNewImages((rows) => [...rows, makeImageRow()])}>画像を追加</button>
                <button className="primary" type="button" disabled={busy} onClick={addProduct}>{editingProductId ? "保存" : "追加"}</button>
              </div>
            </div>
          </section>
          {brandModalOpen && (
            <div className="preview-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setBrandModalOpen(false); }}>
              <div className="brandModal">
                <div className="sectionHead">
                  <h2>ブランド管理</h2>
                  <button type="button" onClick={() => setBrandModalOpen(false)}>閉じる</button>
                </div>
                <div className="brandAdd">
                  <input value={newBrandDraft} onChange={(event) => setNewBrandDraft(event.target.value)} placeholder="ブランド名を追加" />
                  <button type="button" onClick={createBrand}>追加</button>
                </div>
                <div className="brandList">
                  {brands.map((brand) => (
                    <div className={`brandItem ${editingBrandId === brand.id ? "editing" : ""}`} key={brand.id}>
                      {editingBrandId === brand.id ? (
                        <>
                          <input value={editingBrandName} onChange={(event) => setEditingBrandName(event.target.value)} />
                          <button type="button" onClick={updateBrand}>保存</button>
                          <button type="button" onClick={() => { setEditingBrandId(""); setEditingBrandName(""); }}>取消</button>
                        </>
                      ) : (
                        <>
                          <button className="brandNameButton" type="button" onClick={() => { setNewBrandName(brand.name); setBrandModalOpen(false); }}>{brand.name}</button>
                          <button type="button" onClick={() => { setEditingBrandId(brand.id); setEditingBrandName(brand.name); }}>編集</button>
                          <button className="brandDeleteButton" type="button" aria-label={`${brand.name}を削除`} title="削除" onClick={() => deleteBrand(brand)}>×</button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
      </main>
    </div>
  );
}
