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
  files: Array<{ name: string; displayName?: string; rating?: number; appeal?: string; stylePrompt?: string; url: string; path: string; propertyUrl?: string; propertyPath?: string }>;
};
type SavedBanner = { url: string; filePath: string; propertyUrl?: string; propertyPath?: string; folderPath: string; folder?: string; tree?: SavedNode; duplicated?: boolean };
type UnsavedBanner = { url: string; product: string; createdAt: string; historyId: string; variant: Variant };
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
type HistoryRecord = {
  id: string;
  createdAt: string;
  input: ProductInput;
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

const bannerPresets: BannerPreset[] = [
  { count: 1, divisions: 1, sheetRuns: 1 },
  { count: 4, divisions: 4, sheetRuns: 1 },
  { count: 8, divisions: 4, sheetRuns: 2 },
  { count: 9, divisions: 9, sheetRuns: 1 },
  { count: 12, divisions: 4, sheetRuns: 3 },
  { count: 16, divisions: 4, sheetRuns: 4 },
  { count: 20, divisions: 4, sheetRuns: 5 },
  { count: 24, divisions: 4, sheetRuns: 6 },
  { count: 36, divisions: 4, sheetRuns: 9 },
  { count: 48, divisions: 4, sheetRuns: 12 },
  { count: 60, divisions: 4, sheetRuns: 15 },
  { count: 100, divisions: 4, sheetRuns: 25 },
];

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
  const [historyRecords, setHistoryRecords] = useState<HistoryRecord[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState("");
  const [direction, setDirection] = useState("");
  const [priceInfo, setPriceInfo] = useState("");
  const [priceMode, setPriceMode] = useState<"all" | "mixed" | "none">("all");
  const [editInstruction, setEditInstruction] = useState("");
  const [finalEditInstruction, setFinalEditInstruction] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [status, setStatus] = useState("商品を選んでスタート");
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>("default");
  const [progress, setProgress] = useState<ProgressState>({ active: false, title: "待機中", detail: "", current: 0, total: 0 });
  const [divisions, setDivisions] = useState(4);
  const [sheetRuns, setSheetRuns] = useState(2);
  const [imagesPerRequest, setImagesPerRequest] = useState(1);
  const [codexSettings, setCodexSettings] = useState<CodexSettings>({ model: "gpt-5.5", effort: "medium", serviceTier: "auto" });
  const [promptPresets, setPromptPresets] = useState<PromptPreset[]>([]);
  const [selectedPromptPresetIds, setSelectedPromptPresetIds] = useState<Record<PromptStep, string>>({ ideas: "default-ideas", sheets: "default-sheets", final: "default-final" });
  const [promptDraftStep, setPromptDraftStep] = useState<PromptStep>("ideas");
  const [promptDraftId, setPromptDraftId] = useState("");
  const [promptDraftName, setPromptDraftName] = useState("");
  const [promptDraftTemplate, setPromptDraftTemplate] = useState("");
  const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [logs, setLogs] = useState<DebugEntry[]>([
    { id: "init", time: "--:--:--", level: "info", title: "準備OK", detail: "商品を選んでバナーを作りましょう" },
  ]);
  const [previewVariant, setPreviewVariant] = useState<Variant | null>(null);
  const [libSelectedUrl, setLibSelectedUrl] = useState("");
  const [libSelectedUrls, setLibSelectedUrls] = useState<Set<string>>(new Set());
  const [libSelectionAnchorUrl, setLibSelectionAnchorUrl] = useState("");
  const [libAspectRatio, setLibAspectRatio] = useState("1:1");
  const [libEditInstruction, setLibEditInstruction] = useState("");
  const [libFinalUrl, setLibFinalUrl] = useState("");
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryRatingFilter, setLibraryRatingFilter] = useState(0);
  const [ratingHover, setRatingHover] = useState<{ url: string; rating: number } | null>(null);
  const [selectedCropUrls, setSelectedCropUrls] = useState<Set<string>>(new Set());
  const [cropSelectionAnchorUrl, setCropSelectionAnchorUrl] = useState("");
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null);

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

  useEffect(() => { void loadBrands(); void loadProducts(); void loadSaveTree(); void loadHistory(true); void loadPromptPresets(); }, []);

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

  useEffect(() => {
    if (tab !== "settings" || promptDraftTemplate || !promptPresets.length) return;
    const base = promptPresets.find((preset) => preset.step === promptDraftStep && preset.builtIn) || promptPresets.find((preset) => preset.step === promptDraftStep);
    if (!base) return;
    setPromptDraftName(`${base.name}のコピー`);
    setPromptDraftTemplate(base.template);
  }, [tab, promptDraftStep, promptDraftTemplate, promptPresets]);

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

  function promptMissingVariables(step: PromptStep, template = promptDraftTemplate) {
    return promptRequiredVariables[step].filter((key) => !template.includes(`{{${key}}}`));
  }

  function choosePromptPreset(step: PromptStep, id: string) {
    const next = { ...selectedPromptPresetIds, [step]: id };
    setSelectedPromptPresetIds(next);
    if (typeof window !== "undefined") window.localStorage.setItem("selectedPromptPresetIds", JSON.stringify(next));
    setStatus(`${promptStepLabels[step]} のプリセットを切り替えました`);
  }

  function editPromptPreset(preset: PromptPreset, copy = false) {
    setPromptDraftStep(preset.step);
    setPromptDraftId(copy || preset.builtIn ? "" : preset.id);
    setPromptDraftName(copy || preset.builtIn ? `${preset.name}のコピー` : preset.name);
    setPromptDraftTemplate(preset.template);
    setTab("settings");
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
        body: JSON.stringify({ id: editingBrandId, name }),
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
    const data = (await response.json()) as { history: HistoryRecord[] };
    setHistoryRecords(data.history || []);
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
    if (record.input?.productId) setSelectedProductId(record.input.productId);
    if (record.input?.priceInfo !== undefined) setPriceInfo(record.input.priceInfo || "");
    if (record.input?.priceMode) setPriceMode(record.input.priceMode);
    if (typeof window !== "undefined") window.localStorage.setItem("lastGenerationHistoryId", record.id);
    setStatus(silent ? `${historyLabel(record)} を復元しました` : `${historyLabel(record)} を再表示しました`);
    addLog({ level: "success", title: silent ? "前回の生成結果を復元" : "履歴を再表示", detail: `${historyLabel(record)}\nシート=${urls.length}枚 / 候補=${record.ideas?.length || 0}案` });
  }

  function loadHistoryRecord(recordId: string) {
    const record = historyRecords.find((item) => item.id === recordId);
    setSelectedHistoryId(recordId);
    if (!record) return;
    applyHistoryRecord(record);
  }

  async function saveGenerationHistory(input: ProductInput, variants: Variant[], urls: string[]) {
    const result = await postJson<{ record: HistoryRecord; history: HistoryRecord[] }>("/api/save", {
      input,
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
    setStatus(`${targetCount}パターンを作成中…`);
    startProgress("バナー作成中", "デザイン案を準備しています", 1 + plannedSheets);
    addLog({ level: "info", title: "バナー作成開始", detail: `${productInput.brandName || ""} ${productInput.productName} / ${targetCount}パターン\n設定=${codexSettings.model} / ${codexSettings.effort} / ${codexSettings.serviceTier}\n${requestModeLabel}` });
    try {
      const ideaResult = await postJson<{ variants: Variant[]; mode: Mode; debug?: ApiDebug }>("/api/ideas", { ...productInput, count: targetCount, divisions: chunkDivision, sheetRuns: plannedSheets, cancelKey, promptTemplates: activePromptTemplates }, activeAbortRef.current?.signal);
      if (stopRequestedRef.current) throw new Error("ユーザーが生成を停止しました");
      updateProgress({ current: 1, detail: `画像を生成しています… 0/${plannedSheets}シート` });
      addLog({ level: "success", title: `訴求案生成完了: ${ideaResult.mode}`, detail: `${formatDebug(ideaResult.debug)}\n案数=${ideaResult.variants.length}\n${ideaResult.variants.map((variant) => `${variant.index}. ${variant.appeal || ""} / ${variant.prompt}`).join("\n")}` });
      type SheetResponse = { sheetUrl: string; variants: Variant[]; mode: Mode; debug?: ApiDebug; runIndex: number };
      addLog({ level: "info", title: "Step 2: 画像生成開始", detail: `Codexリクエストを直列実行\n予定リクエスト=${plannedRequests}回\n1度での画像生成数=${requestImageCount}枚\n1シート=${chunkDivision}分割\n合計=${targetCount}案` });
      const sheets: SheetResponse[] = [];
      let variantOffset = 0;
      let sheetOffset = 0;
      while (variantOffset < targetCount) {
        if (stopRequestedRef.current) throw new Error("ユーザーが生成を停止しました");
        const remaining = targetCount - variantOffset;
        const currentDivisions = remaining < chunkDivision ? remaining : chunkDivision;
        const remainingSheets = Math.ceil(remaining / currentDivisions);
        const currentSheetRuns = Math.min(requestImageCount, remainingSheets);
        const take = currentDivisions * currentSheetRuns;
        const chunkVariants = ideaResult.variants.slice(variantOffset, variantOffset + take);
        const sheetsResult = await postJson<{ sheets: SheetResponse[]; mode: Mode; debug?: ApiDebug }>("/api/sheets", {
          input: productInput,
          variants: chunkVariants,
          divisions: currentDivisions,
          sheetRuns: currentSheetRuns,
          cancelKey,
          codexSettings,
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
        sheets.push(...chunkSheets);
        const partialVariants = sheets.flatMap((sheet) => sheet.variants).slice(0, targetCount);
        setSheetUrls(sheets.map((sheet) => sheet.sheetUrl));
        setSheetVariants(partialVariants);
        variantOffset += take;
        sheetOffset += currentSheetRuns;
        updateProgress({ current: 1 + sheetOffset, detail: `画像を生成しています… ${Math.min(sheetOffset, plannedSheets)}/${plannedSheets}シート` });
        addLog({ level: "success", title: `Step 2: 画像生成チャンク完了`, detail: `シート=${sheetOffset}/${plannedSheets}\n候補=${Math.min(variantOffset, targetCount)}/${targetCount}\n${formatDebug(sheetsResult.debug)}` });
      }
      if (!sheets.length) throw new Error(`画像生成がすべて失敗しました。詳細は実行状況と public/data/request-log.jsonl を確認してください。`);
      const allVariants = sheets.flatMap((sheet) => sheet.variants).slice(0, targetCount);
      const urls = sheets.map((sheet) => sheet.sheetUrl);
      setSheetUrls(urls);
      setSheetVariants(allVariants);
      addLog({ level: "success", title: `Step 2: 画像生成完了`, detail: `シート=${sheets.length}枚\n候補=${allVariants.length}案\n${sheets.map((sheet) => `シート${sheet.runIndex}: ${sheet.sheetUrl} / ${sheet.variants.length}候補`).join("\n")}` });
      try {
        const record = await saveGenerationHistory(productInput, allVariants, urls);
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
        codexSettings,
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
      addLog({ level: "success", title: "フォルダ移動", detail: `${sourceFolder} → ${result.folder || targetFolder}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("フォルダ移動エラー");
      addLog({ level: "error", title: "フォルダ移動エラー", detail: message });
    }
  }

  function startImageDrag(event: React.DragEvent, sourceUrl?: string, variant?: Variant | null, stage: "candidate" | "final" = "candidate") {
    if (!sourceUrl) return;
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

    if (event.metaKey || event.ctrlKey) {
      setSelectedCropUrls((current) => {
        const next = new Set(current);
        if (next.has(variant.cropUrl!)) next.delete(variant.cropUrl!);
        else next.add(variant.cropUrl!);
        return next;
      });
      setCropSelectionAnchorUrl(variant.cropUrl);
      return;
    }

    setSelectedCropUrls(new Set([variant.cropUrl]));
    setCropSelectionAnchorUrl(variant.cropUrl);
  }

  function libraryCaption(item: SavedNode["files"][number]) {
    return [item.appeal, item.stylePrompt].filter(Boolean).join("\n");
  }

  async function dropToSave(event: React.DragEvent, folder = selectedSaveFolder) {
    event.preventDefault();
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

  function startLibraryFileDrag(event: React.DragEvent, sourceUrl: string) {
    event.dataTransfer.setData("application/library-file", sourceUrl);
    event.dataTransfer.effectAllowed = "move";
  }

  function countFiles(node: SavedNode): number {
    return node.files.length + node.children.reduce((sum, child) => sum + countFiles(child), 0);
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
      const ratingMatch = !libraryRatingFilter || (file.rating || 0) >= libraryRatingFilter;
      return nameMatch && ratingMatch;
    });
  }

  function savedSourceUrls() {
    const urls = new Set<string>();
    const walk = (node: SavedNode | null) => {
      if (!node) return;
      for (const file of node.files) {
        if (file.url) urls.add(file.url);
        if (file.url.startsWith("/saved-banners/")) urls.add(file.url.replace("/saved-banners/", "/generated/"));
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
    for (const record of historyRecords) {
      const product = [record.input?.brandName, record.input?.productName].filter(Boolean).join(" / ") || "商品不明";
      for (const variant of record.ideas || []) {
        if (!variant.cropUrl || seen.has(variant.cropUrl) || saved.has(variant.cropUrl)) continue;
        seen.add(variant.cropUrl);
        items.push({ url: variant.cropUrl, product, createdAt: record.createdAt, historyId: record.id, variant });
      }
    }
    const query = librarySearch.trim().toLowerCase();
    return items.filter((item) => {
      const historyMatch = !unsavedHistoryFilter || item.historyId === unsavedHistoryFilter;
      const queryMatch = !query || [item.product, item.variant.appeal, item.variant.prompt, item.url].filter(Boolean).join(" ").toLowerCase().includes(query);
      return historyMatch && queryMatch;
    });
  }

  function clearLibrarySelection() {
    setLibSelectedUrl("");
    setLibSelectedUrls(new Set());
    setLibSelectionAnchorUrl("");
    setLibFinalUrl("");
  }

  function handleLibraryTileClick(event: React.MouseEvent, url: string, orderedUrls: string[]) {
    setLibSelectedUrl(url);
    setLibFinalUrl("");

    if (event.shiftKey && libSelectionAnchorUrl) {
      const anchorIndex = orderedUrls.indexOf(libSelectionAnchorUrl);
      const targetIndex = orderedUrls.indexOf(url);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        setLibSelectedUrls(new Set(orderedUrls.slice(start, end + 1)));
        return;
      }
    }

    if (event.metaKey || event.ctrlKey) {
      setLibSelectedUrls((current) => {
        const next = new Set(current);
        if (next.has(url)) next.delete(url);
        else next.add(url);
        return next;
      });
      setLibSelectionAnchorUrl(url);
      return;
    }

    setLibSelectedUrls(new Set([url]));
    setLibSelectionAnchorUrl(url);
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
    return (
      <div className="folderNode" key={node.path || "root"}>
        <div className="folderNodeRow">
          <button
            className={isActive ? "active" : ""}
            type="button"
            draggable={Boolean(node.path)}
            onDragStart={(event) => {
              if (!node.path) return;
              event.dataTransfer.setData("application/library-folder", node.path);
              event.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => selectSavedFolder(node.path)}
            onDragOver={(event) => {
              const folderPath = event.dataTransfer.types.includes("application/library-folder");
              if (folderPath) {
                const source = event.dataTransfer.getData("application/library-folder");
                if (canDropFolder(source)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }
                return;
              }
              event.preventDefault();
            }}
            onDrop={(event) => {
              const source = event.dataTransfer.getData("application/library-folder");
              if (source) {
                event.preventDefault();
                if (canDropFolder(source)) handleFolderDrop(event, source);
                return;
              }
              dropToSave(event, node.path);
            }}
          >
            <span>{node.path ? node.name : "保存済み"}</span>
            <small>{countFiles(node)}</small>
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
    clearLibrarySelection();
  }

  function renderLibraryAxis() {
    return (
      <>
        <div className="folderTree">
          {saveTree ? renderSaveNode(saveTree) : <div className="empty small">読み込み中</div>}
        </div>
        <div className="libraryAxis">
          <button className={libraryView === "unsaved" ? "active" : ""} type="button" onClick={() => { setLibraryView("unsaved"); clearLibrarySelection(); }}>
            <span>未保存</span>
            <small>{unsavedLibraryFiles().length}</small>
          </button>
        </div>
      </>
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
    if (!libSelectedUrl) return;
    setBusy(true);
    setStopping(false);
    stopRequestedRef.current = false;
    const cancelKey = `library-final-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeCancelKeyRef.current = cancelKey;
    activeAbortRef.current = new AbortController();
    setStatus("仕上げ中…");
    startProgress("仕上げ中", `${libAspectRatio} の画像を作成中`, 1);
    try {
      const result = await postJson<{ finalUrl: string; mode: Mode; variant: Variant; debug?: ApiDebug }>("/api/final", {
        input: productInput || { productName: "バナー", productImages: [] },
        variant: { index: 0, prompt: libEditInstruction || "この画像をベースに仕上げてください", cropUrl: libSelectedUrl, priceTreatment: "no_price" as const },
        aspectRatio: libAspectRatio,
        instruction: libEditInstruction,
        cancelKey,
        codexSettings,
        promptTemplates: activePromptTemplates,
      }, activeAbortRef.current?.signal);
      setLibFinalUrl(result.finalUrl);
      setStatus("仕上げ完了！");
      finishProgress("仕上げ完了", "ライブラリで確認できます");
      addLog({ level: "success", title: `仕上げ完了: ${result.mode}`, detail: `${formatDebug(result.debug)} / ${result.finalUrl}` });
      notifyDesktop("仕上げ完了", `${libAspectRatio} のバナーができました`);
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
      <main className="main">

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
          <div className="gen-layout">
            {/* Settings panel */}
            <div className="panel gen-settings form">
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
                      <option value={1}>1分割</option><option value={2}>2分割</option><option value={4}>4分割</option><option value={9}>9分割</option>
                    </select>
                  </label>
                  <label>生成回数<input min={1} max={40} type="number" value={sheetRuns} onChange={(event) => { setSheetRuns(Math.min(40, Math.max(1, Number(event.target.value) || 1))); resetGenerated(); }} /></label>
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
                <div className="controlGrid mt">
                  <label>モデル
                    <select value={codexSettings.model} onChange={(event) => setCodexSettings((current) => ({ ...current, model: event.target.value }))}>
                      <option value="gpt-5.5">gpt-5.5</option>
                      <option value="gpt-5.4">gpt-5.4</option>
                      <option value="gpt-5.4-mini">gpt-5.4-mini</option>
                    </select>
                  </label>
                  <label>推論強度
                    <select value={codexSettings.effort} onChange={(event) => setCodexSettings((current) => ({ ...current, effort: event.target.value as CodexSettings["effort"] }))}>
                      <option value="low">低</option>
                      <option value="medium">中（標準）</option>
                      <option value="high">高</option>
                      <option value="xhigh">非常に高い</option>
                    </select>
                  </label>
                  <label>速度
                    <select value={codexSettings.serviceTier} onChange={(event) => setCodexSettings((current) => ({ ...current, serviceTier: event.target.value as CodexSettings["serviceTier"] }))}>
                      <option value="fast">速い</option>
                      <option value="auto">通常</option>
                    </select>
                  </label>
                </div>
                <small className="settingHint">画像生成・仕上げ生成に使うCodex App Serverの設定です。標準は gpt-5.5 / 中 / 通常。</small>
              </details>

              {busy ? (
                <button className="danger" type="button" style={{marginTop:8,width:"100%"}} disabled={stopping} onClick={stopGeneration}>{stopping ? "停止中…" : "生成を停止"}</button>
              ) : (
                <button className="primary" type="button" style={{marginTop:8,width:"100%"}} disabled={!selectedProduct} onClick={generateBanners}>バナーを作成する</button>
              )}
            </div>

            {/* Right side: candidates + inline library */}
            <div className="gen-right">
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

                <div className="historyBar mt">
                  <label>過去の作成結果
                    <select value={selectedHistoryId} onChange={(event) => { if (event.target.value) loadHistoryRecord(event.target.value); else { setSelectedHistoryId(""); } }}>
                      <option value="">過去の結果を読み込む</option>
                      {historyRecords.map((record) => <option value={record.id} key={record.id}>{historyLabel(record)}</option>)}
                    </select>
                  </label>
                </div>
              </div>

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
                    {renderLibraryAxis()}
                  </div>
                  <button className="folderResizeHandle" type="button" aria-label="フォルダ幅を変更" onPointerDown={startFolderResize} />
                  <div
                    className="gen-library-drop"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => dropToSave(event)}
                  >
                    <div className="saveDrop">
                      <strong>{selectedSaveFolder || "保存済み"}にドロップして保存</strong>
                      <span>候補を選択してここにドラッグ</span>
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
                            <a href={item.url} className="gen-lib-thumb" key={item.path} target="_blank">
                              <img src={item.url} alt={item.name} />
                              <span className="gen-lib-preview" aria-hidden="true">
                                <img src={item.url} alt="" />
                                {libraryCaption(item) ? <p>{libraryCaption(item)}</p> : null}
                              </span>
                            </a>
                          ))}
                        </div>
                        <button
                          className="lib-open-link"
                          type="button"
                          onClick={() => { setTab("library"); }}
                        >
                          {selectedSaveNode()?.files.length}枚を仕上げ・編集する →
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
          <div className={`lib-layout ${libSelectedUrl ? "" : "no-refine"}`} style={{ "--folder-width": `${libraryFolderWidth}px` } as React.CSSProperties}>
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
            <div className="panel" onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropToSave(event)}>
              <div className="sectionHead">
                <div><h2>{libraryView === "saved" ? selectedSaveFolder || "保存済み" : "未保存"}</h2></div>
                <div className="headerActions">
                  <button className="ghostIconButton" type="button" disabled={libraryView === "saved" ? !currentLibraryFiles().length : !unsavedLibraryFiles().length} onClick={downloadCurrentLibraryView}>一括ダウンロード</button>
                  <span className="badge">
                    {libraryView === "saved" ? currentLibraryFiles().length : unsavedLibraryFiles().length}枚
                    {libSelectedUrls.size > 0 ? ` / ${libSelectedUrls.size}枚選択中` : ""}
                  </span>
                  {libSelectedUrls.size > 0 && <button type="button" onClick={clearLibrarySelection}>選択解除</button>}
                </div>
              </div>
              {libraryView === "saved" ? (
                <div className="libraryFilters">
                  <input value={librarySearch} onChange={(event) => { setLibrarySearch(event.target.value); clearLibrarySelection(); }} placeholder="ファイル名・表示名で検索" />
                  <select value={libraryRatingFilter} onChange={(event) => { setLibraryRatingFilter(Number(event.target.value)); clearLibrarySelection(); }}>
                    <option value={0}>評価すべて</option>
                    <option value={1}>★1以上</option>
                    <option value={2}>★2以上</option>
                    <option value={3}>★3以上</option>
                    <option value={4}>★4以上</option>
                    <option value={5}>★5</option>
                  </select>
                </div>
              ) : (
                <div className="libraryFilters">
                  <input value={librarySearch} onChange={(event) => { setLibrarySearch(event.target.value); clearLibrarySelection(); }} placeholder="商品名・訴求案で検索" />
                  <select value={unsavedHistoryFilter} onChange={(event) => { setUnsavedHistoryFilter(event.target.value); clearLibrarySelection(); }}>
                    <option value="">生成履歴すべて</option>
                    {historyRecords.map((record) => <option value={record.id} key={record.id}>{historyLabel(record)}</option>)}
                  </select>
                </div>
              )}
              <div className="breadcrumb">
                {(libraryView === "saved" ? saveBreadcrumb() : [{ name: "未保存", path: "__unsaved__" }]).map((item, index) => (
                  <button type="button" key={item.path || "root"} onClick={() => item.path === "__unsaved__" ? (setLibraryView("unsaved"), clearLibrarySelection()) : selectSavedFolder(item.path)}>{index > 0 ? " / " : ""}{item.name}</button>
                ))}
              </div>
              {libraryView === "saved" && <div className="saveDrop">
                <strong>ここにドロップして保存</strong>
                <span>{selectedSaveFolder ? "このフォルダに保存します" : "自動でフォルダを作って保存します"}</span>
              </div>}
              {libraryView === "saved" && selectedSaveNode()?.children.length ? (
                <div className="folderSummary">
                  {selectedSaveNode()?.children.map((folder) => (
                    <button type="button" key={folder.path} onClick={() => selectSavedFolder(folder.path)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropToSave(event, folder.path)}>
                      <strong>{folder.name}</strong><span>{countFiles(folder)}枚</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {libraryView === "saved" ? (currentLibraryFiles().length ? (
                <div className="bannerGrid">
                  {currentLibraryFiles().map((item) => (
                    <div
                      className={`bannerTile ${libSelectedUrls.has(item.url) ? "active" : ""}`}
                      key={item.path}
                      draggable
                      onDragStart={(event) => startLibraryFileDrag(event, item.url)}
                      onClick={(event) => handleLibraryTileClick(event, item.url, currentLibraryFiles().map((file) => file.url))}
                      onMouseEnter={(event) => showHoverPreview(event, item.url, libraryCaption(item))}
                      onMouseMove={(event) => showHoverPreview(event, item.url, libraryCaption(item))}
                      onMouseLeave={() => setHoverPreview(null)}
                    >
                      <div className="bannerImageWrap">
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
                <div className="bannerGrid">
                  {unsavedLibraryFiles().map((item) => (
                    <div
                      className={`bannerTile ${libSelectedUrls.has(item.url) ? "active" : ""}`}
                      key={item.url}
                      draggable
                      onDragStart={(event) => startImageDrag(event, item.url, item.variant, "candidate")}
                      onClick={(event) => handleLibraryTileClick(event, item.url, unsavedLibraryFiles().map((file) => file.url))}
                      onMouseEnter={(event) => showHoverPreview(event, item.url, [item.variant.appeal, item.variant.prompt].filter(Boolean).join("\n"))}
                      onMouseMove={(event) => showHoverPreview(event, item.url, [item.variant.appeal, item.variant.prompt].filter(Boolean).join("\n"))}
                      onMouseLeave={() => setHoverPreview(null)}
                    >
                      <div className="bannerImageWrap">
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

            {/* Refine panel */}
            {libSelectedUrl && (
              <div className="panel refine-panel form">
                <div className="sectionHead"><h2>仕上げ</h2><button type="button" onClick={clearLibrarySelection}>✕</button></div>
                <img className="refine-preview" src={libFinalUrl || libSelectedUrl} alt="selected" />
                <label>サイズ
                  <select value={libAspectRatio} onChange={(event) => { setLibAspectRatio(event.target.value); setLibFinalUrl(""); }}>
                    <option value="1:1">1:1 正方形</option><option value="4:5">4:5 SNS縦</option><option value="9:16">9:16 縦長</option><option value="16:9">16:9 横長</option>
                  </select>
                </label>
                <label>調整メモ（任意）
                  <textarea value={libEditInstruction} onChange={(event) => setLibEditInstruction(event.target.value)} placeholder="例: 背景を明るく、商品を大きく" />
                </label>
                <button className="primary" type="button" disabled={busy} onClick={refineLibraryImage}>{libAspectRatio}で仕上げる</button>
                {libFinalUrl && (
                  <>
                    <button type="button" onClick={() => exportBanner(libFinalUrl, null, "final")}>フォルダへ保存</button>
                    <a href={libFinalUrl} download style={{display:"block",textAlign:"center",color:"var(--accent)",fontSize:11,marginTop:4}}>ダウンロード</a>
                  </>
                )}
              </div>
            )}
          </div>
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
        </>

      ) : tab === "settings" ? (
        <>
          <div className="main-header">
            <div>
              <h1>設定</h1>
              <p>生成ステップごとのプロンプトプリセットを管理します</p>
            </div>
          </div>
          <section className="settingsLayout">
            <div className="panel promptPresetList">
              <div className="sectionHead"><h2>使用するプリセット</h2></div>
              {(Object.keys(promptStepLabels) as PromptStep[]).map((step) => (
                <div className="promptStepCard" key={step}>
                  <div className="promptStepHead">
                    <strong>{promptStepLabels[step]}</strong>
                    <span>{promptPresetsFor(step).find((preset) => preset.id === selectedPromptPresetIds[step])?.name || "デフォルト"}</span>
                  </div>
                  <select value={selectedPromptPresetIds[step]} onChange={(event) => choosePromptPreset(step, event.target.value)}>
                    {promptPresetsFor(step).map((preset) => <option value={preset.id} key={preset.id}>{preset.name}{preset.builtIn ? "（固定）" : ""}</option>)}
                  </select>
                  <div className="promptPresetButtons">
                    {promptPresetsFor(step).map((preset) => (
                      <div className={`promptPresetRow ${selectedPromptPresetIds[step] === preset.id ? "active" : ""}`} key={preset.id}>
                        <button type="button" onClick={() => choosePromptPreset(step, preset.id)}>{preset.name}</button>
                        {preset.builtIn ? <span>固定</span> : <button type="button" onClick={() => editPromptPreset(preset)}>編集</button>}
                        <button type="button" onClick={() => editPromptPreset(preset, true)}>コピー</button>
                        {!preset.builtIn && <button className="dangerText" type="button" onClick={() => deletePromptPreset(preset)}>削除</button>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="panel promptEditor form">
              <div className="sectionHead">
                <h2>{promptDraftId ? "プリセット編集" : "プリセット作成"}</h2>
                <button type="button" onClick={() => {
                  const base = promptPresetsFor(promptDraftStep)[0];
                  if (base) editPromptPreset(base, true);
                }}>デフォルトから作成</button>
              </div>
              <div className="controlGrid">
                <label>ステップ
                  <select value={promptDraftStep} onChange={(event) => {
                    const step = event.target.value as PromptStep;
                    setPromptDraftStep(step);
                    const base = promptPresetsFor(step)[0];
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
                  <p>クリックするとプロンプト末尾に挿入します。必須変数がないと保存できません。</p>
                </div>
                <div className="variableChips">
                  {promptVariableHelp[promptDraftStep].map((item) => (
                    <button type="button" key={item.key} title={item.description} onClick={() => insertPromptVariable(item.key)}>
                      {`{{${item.key}}}`}{item.required ? <b>必須</b> : null}
                    </button>
                  ))}
                </div>
              </div>

              <label>プロンプトテンプレート
                <textarea className="promptTextarea" value={promptDraftTemplate} onChange={(event) => setPromptDraftTemplate(event.target.value)} placeholder="デフォルトをコピーして編集してください" />
              </label>

              {promptMissingVariables(promptDraftStep).length ? (
                <div className="promptValidation error">
                  不足している必須変数: {promptMissingVariables(promptDraftStep).map((key) => `{{${key}}}`).join(", ")}
                </div>
              ) : (
                <div className="promptValidation ok">必須変数は入っています</div>
              )}

              <div className="buttonRow">
                <button type="button" onClick={() => {
                  setPromptDraftId("");
                  setPromptDraftName("");
                  setPromptDraftTemplate("");
                }}>クリア</button>
                <button className="primary" type="button" disabled={busy || !!promptMissingVariables(promptDraftStep).length || !promptDraftName.trim() || !promptDraftTemplate.trim()} onClick={savePromptPreset}>
                  保存
                </button>
              </div>
            </div>
          </section>
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
                  <div style={{display:"flex",gap:6}}>
                    <button type="button" onClick={() => { selectProductForGeneration(editingProductId); setTab("generate"); }}>バナーを作る</button>
                    <button type="button" onClick={resetProductForm}>新規追加に戻る</button>
                  </div>
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
