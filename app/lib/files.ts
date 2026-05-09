import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type Variant = {
  index: number;
  appeal?: string;
  prompt: string;
  cropUrl?: string;
  sheetRun?: number;
  globalIndex?: number;
  priceTreatment?: "with_price" | "without_price";
};

export type ProjectRecord = {
  id: string;
  createdAt: string;
  input: ProductInput;
  ideas: Variant[];
  sheetUrl?: string;
  sheetUrls?: string[];
  finalUrl?: string;
  selectedIndex?: number;
};

export type ProductInput = {
  productId?: string;
  brandName?: string;
  productName: string;
  audience?: string;
  benefit?: string;
  mood?: string;
  format: string;
  productImageUrl?: string;
  productImagePath?: string;
  productImages?: ProductImage[];
  notes?: string;
  priceInfo?: string;
  priceMode?: "all" | "mixed" | "none";
};

export type ProductImage = {
  id: string;
  url: string;
  path: string;
  description: string;
};

export type ProductMaster = {
  id: string;
  brandName: string;
  name: string;
  images: ProductImage[];
  imageUrl?: string;
  imagePath?: string;
  notes?: string;
  priceInfo?: string;
  createdAt: string;
};

export const generatedDir = path.join(process.cwd(), "public", "generated");
export const masterImagesDir = path.join(process.cwd(), "public", "master-images");
export const dataDir = path.join(process.cwd(), "public", "data");
const historyPath = path.join(generatedDir, "history.json");
const productsPath = path.join(dataDir, "products.json");
const legacyProductsPath = path.join(generatedDir, "products.json");

export function makeId(prefix = "job") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function publicUrl(fileName: string) {
  return `/generated/${fileName}`;
}

export function masterImagePublicUrl(fileName: string) {
  return `/master-images/${fileName}`;
}

export function resolvePublicAssetPath(urlOrPath?: string) {
  if (!urlOrPath) return "";
  if (urlOrPath.startsWith("/master-images/")) return path.join(masterImagesDir, urlOrPath.replace("/master-images/", ""));
  if (urlOrPath.startsWith("/generated/")) return path.join(generatedDir, urlOrPath.replace("/generated/", ""));
  if (urlOrPath.startsWith("/")) return urlOrPath;
  return path.join(process.cwd(), "public", urlOrPath);
}

export async function ensureGeneratedDir() {
  await mkdir(generatedDir, { recursive: true });
}

export async function ensureMasterDirs() {
  await mkdir(masterImagesDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
}

export async function writeGenerated(fileName: string, buffer: Buffer) {
  await ensureGeneratedDir();
  const target = path.join(generatedDir, fileName);
  await writeFile(target, buffer);
  return publicUrl(fileName);
}

export async function copyGenerated(sourcePath: string, fileName: string) {
  await ensureGeneratedDir();
  const target = path.join(generatedDir, fileName);
  await copyFile(sourcePath, target);
  return publicUrl(fileName);
}

export async function writeMasterImage(fileName: string, buffer: Buffer) {
  await ensureMasterDirs();
  const target = path.join(masterImagesDir, fileName);
  await writeFile(target, buffer);
  return masterImagePublicUrl(fileName);
}

function normalizeProduct(product: ProductMaster & { imageUrl?: string; imagePath?: string }): ProductMaster {
  const rawImages = product.images?.length
    ? product.images
    : product.imageUrl && product.imagePath
      ? [{ id: `${product.id}-image`, url: product.imageUrl, path: product.imagePath, description: "商品画像" }]
      : [];
  const images = rawImages.map((image) => ({
    ...image,
    path: resolvePublicAssetPath(image.url || image.path),
  }));

  return {
    ...product,
    brandName: product.brandName || "",
    priceInfo: product.priceInfo || "",
    images,
    imageUrl: images[0]?.url,
    imagePath: images[0]?.path,
  };
}

export async function readHistory(): Promise<ProjectRecord[]> {
  await ensureGeneratedDir();
  try {
    const raw = await readFile(historyPath, "utf8");
    return JSON.parse(raw) as ProjectRecord[];
  } catch {
    return [];
  }
}

export async function saveHistory(record: ProjectRecord) {
  const history = await readHistory();
  const next = [record, ...history.filter((item) => item.id !== record.id)].slice(0, 50);
  await writeFile(historyPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export async function readProducts(): Promise<ProductMaster[]> {
  await ensureMasterDirs();
  try {
    const raw = await readFile(productsPath, "utf8");
    const products = JSON.parse(raw) as Array<ProductMaster & { imageUrl?: string; imagePath?: string }>;
    return products.map(normalizeProduct);
  } catch {
    try {
      const legacyRaw = await readFile(legacyProductsPath, "utf8");
      const legacyProducts = JSON.parse(legacyRaw) as Array<ProductMaster & { imageUrl?: string; imagePath?: string }>;
      return legacyProducts.map(normalizeProduct);
    } catch {
      return [];
    }
  }
}

export async function saveProduct(product: ProductMaster) {
  await ensureMasterDirs();
  const products = await readProducts();
  const next = [product, ...products.filter((item) => item.id !== product.id)];
  await writeFile(productsPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}
