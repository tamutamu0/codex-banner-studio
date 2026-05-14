import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { generatedDir, makeId, type ProductInput, type Variant } from "@/app/lib/files";

type Body = {
  action?: "createFolder" | "saveImage" | "moveFile" | "moveFolder" | "deleteFolder" | "deleteFile" | "reorderFolder" | "updateMeta" | "setDisplayVersion" | "manualUpload";
  sourceUrl?: string;
  sourceLibraryUrl?: string;
  fileUrl?: string;
  input?: ProductInput;
  variant?: Variant | null;
  stage?: "candidate" | "final" | "manual";
  aspectRatio?: string;
  editInstruction?: string;
  generationPrompt?: string;
  folder?: string;
  name?: string;
  targetFolder?: string;
  sourceFolder?: string;
  beforeFolder?: string;
  confirm?: boolean;
  displayName?: string;
  rating?: number;
};

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

type SavedBanner = {
  url: string;
  filePath: string;
  propertyUrl?: string;
  propertyPath?: string;
  folderPath: string;
  folder?: string;
};

const savedRoot = path.join(process.cwd(), "public", "saved-banners");
const folderOrderFile = ".folder-order.json";

function safeSegment(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|#%{}^~[\]`;\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "banner";
}

function dateSegment() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeFolder(value: string) {
  return value
    .split("/")
    .filter((part) => part.trim())
    .map((part) => safeSegment(part))
    .filter(Boolean)
    .join("/");
}

function resolveSavedFolder(folder: string) {
  const normalized = normalizeFolder(folder);
  const target = path.resolve(savedRoot, normalized);
  if (target !== path.resolve(savedRoot) && !target.startsWith(path.resolve(savedRoot) + path.sep)) {
    throw new Error("保存先フォルダが不正です");
  }
  return { normalized, target };
}

function parentFolderOf(folder: string) {
  const normalized = normalizeFolder(folder);
  const parts = normalized.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function basenameFolder(folder: string) {
  return path.basename(normalizeFolder(folder));
}

function isSameOrDescendant(folder: string, ancestor: string) {
  const normalized = normalizeFolder(folder);
  const parent = normalizeFolder(ancestor);
  return normalized === parent || normalized.startsWith(`${parent}/`);
}

async function readFolderOrder(folder: string) {
  const { target } = resolveSavedFolder(folder);
  try {
    const value = JSON.parse(await readFile(path.join(target, folderOrderFile), "utf8"));
    return Array.isArray(value.order) ? value.order.filter((item: unknown) => typeof item === "string") as string[] : [];
  } catch {
    return [];
  }
}

async function writeFolderOrder(folder: string, order: string[]) {
  const { target } = resolveSavedFolder(folder);
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, folderOrderFile), JSON.stringify({ order }, null, 2), "utf8");
}

function sortFolders(children: SavedNode[], order: string[]) {
  const position = new Map(order.map((name, index) => [name, index]));
  return children.sort((a, b) => {
    const aPos = position.has(a.name) ? position.get(a.name)! : Number.MAX_SAFE_INTEGER;
    const bPos = position.has(b.name) ? position.get(b.name)! : Number.MAX_SAFE_INTEGER;
    if (aPos !== bPos) return aPos - bPos;
    return a.name.localeCompare(b.name, "ja");
  });
}

function resolveSavedFileFromUrl(url: string) {
  if (!url.startsWith("/saved-banners/")) throw new Error("移動する画像が不正です");
  const decoded = decodeURIComponent(url.replace("/saved-banners/", ""));
  const parts = decoded.split("/").filter((part) => part.trim());
  const fileName = parts.pop();
  if (!fileName || !/\.(png|jpe?g|webp)$/i.test(fileName)) throw new Error("移動する画像が不正です");
  const folder = normalizeFolder(parts.join("/"));
  const relative = folder ? `${folder}/${fileName}` : fileName;
  const target = path.resolve(savedRoot, relative);
  if (!target.startsWith(path.resolve(savedRoot) + path.sep)) throw new Error("移動する画像が不正です");
  return { relative, target, name: path.basename(target) };
}

function sidecarPathForImage(imagePath: string) {
  return imagePath.replace(/\.(png|jpe?g|webp)$/i, ".json");
}

function sidecarUrlForImage(imageUrl: string) {
  return imageUrl.replace(/\.(png|jpe?g|webp)$/i, ".json");
}

function publicSafeMetadata(body: Body, fileName: string, folder: string, assetId: string, lineage: Record<string, any>) {
  const variant = body.variant || undefined;
  const isManualUpload = body.stage === "manual";
  return {
    schemaVersion: 1,
    assetId,
    savedAt: new Date().toISOString(),
    fileName,
    displayName: fileName.replace(/\.(png|jpe?g|webp)$/i, ""),
    rating: 0,
    sourceUrl: body.sourceUrl || "",
    folder,
    stage: body.stage || "banner",
    sourceType: isManualUpload ? "manual_upload" : "generated",
    aspectRatio: body.aspectRatio || "candidate",
    product: {
      brandName: body.input?.brandName || "",
      productName: body.input?.productName || "",
      priceInfo: body.input?.priceInfo || "",
      priceMode: body.input?.priceMode || "none",
    },
    creative: {
      index: variant?.globalIndex || variant?.index || null,
      sheetRun: variant?.sheetRun || null,
      appeal: variant?.appeal || (isManualUpload ? "手動アップロード" : ""),
      stylePrompt: variant?.prompt || (isManualUpload ? "ライブラリに手動追加した画像です。" : ""),
      priceTreatment: variant?.priceTreatment || "unknown",
    },
    lineage,
    note: "This sidecar stores public-safe creative metadata for library organization. It intentionally excludes local file paths and full internal request prompts.",
  };
}

async function readSidecar(imagePath: string) {
  try {
    return JSON.parse(await readFile(sidecarPathForImage(imagePath), "utf8")) as Record<string, any>;
  } catch {
    return {};
  }
}

async function writeSidecar(imagePath: string, patch: Record<string, any>) {
  const current = await readSidecar(imagePath);
  const next = {
    schemaVersion: 1,
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(sidecarPathForImage(imagePath), JSON.stringify(next, null, 2), "utf8");
  return next;
}

async function findDuplicateInFolder(targetDir: string, sourceUrl: string) {
  if (!sourceUrl) return null;
  try {
    const entries = await readdir(targetDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(png|jpe?g|webp)$/i.test(entry.name)) continue;
      const imagePath = path.join(targetDir, entry.name);
      const meta = await readSidecar(imagePath);
      if (meta.sourceUrl === sourceUrl) return { fileName: entry.name, imagePath };
    }
  } catch {
    return null;
  }
  return null;
}

function savedFileFromMeta(entryName: string, imagePath: string, imageUrl: string, meta: Record<string, any>): SavedFile {
  const assetId = typeof meta.assetId === "string" && meta.assetId ? meta.assetId : entryName.replace(/\.(png|jpe?g|webp)$/i, "");
  const rootId = typeof meta.lineage?.rootId === "string" && meta.lineage.rootId ? meta.lineage.rootId : assetId;
  return {
    name: entryName,
    displayName: typeof meta.displayName === "string" ? meta.displayName : undefined,
    rating: Number.isFinite(Number(meta.rating)) ? Number(meta.rating) : 0,
    appeal: typeof meta.creative?.appeal === "string" ? meta.creative.appeal : "",
    stylePrompt: typeof meta.creative?.stylePrompt === "string" ? meta.creative.stylePrompt : "",
    url: imageUrl,
    path: imagePath,
    propertyUrl: sidecarUrlForImage(imageUrl),
    propertyPath: sidecarPathForImage(imagePath),
    assetId,
    rootId,
    parentUrl: typeof meta.lineage?.parentUrl === "string" ? meta.lineage.parentUrl : "",
    sourceUrl: typeof meta.sourceUrl === "string" ? meta.sourceUrl : "",
    sourceType: typeof meta.sourceType === "string" ? meta.sourceType : "",
    aspectRatio: typeof meta.aspectRatio === "string" ? meta.aspectRatio : typeof meta.lineage?.aspectRatio === "string" ? meta.lineage.aspectRatio : "",
    editInstruction: typeof meta.lineage?.editInstruction === "string" ? meta.lineage.editInstruction : "",
    generationPrompt: typeof meta.lineage?.generationPrompt === "string" ? meta.lineage.generationPrompt : "",
    product: meta.product && typeof meta.product === "object" ? {
      brandName: typeof meta.product.brandName === "string" ? meta.product.brandName : "",
      productName: typeof meta.product.productName === "string" ? meta.product.productName : "",
      priceInfo: typeof meta.product.priceInfo === "string" ? meta.product.priceInfo : "",
      priceMode: typeof meta.product.priceMode === "string" ? meta.product.priceMode : "",
    } : undefined,
    savedAt: typeof meta.savedAt === "string" ? meta.savedAt : typeof meta.updatedAt === "string" ? meta.updatedAt : "",
    isDisplay: Boolean(meta.lineage?.display),
  };
}

function sortVersions(files: SavedFile[]) {
  return [...files].sort((a, b) => {
    const aTime = a.savedAt || a.name;
    const bTime = b.savedAt || b.name;
    return bTime.localeCompare(aTime, "ja");
  });
}

async function collectSavedImagePaths(dir = savedRoot): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collectSavedImagePaths(target));
    else if (entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name)) files.push(target);
  }
  return files;
}

async function buildLineage(body: Body, assetId: string) {
  const now = new Date().toISOString();
  if (body.stage === "manual") {
    return {
      rootId: assetId,
      parentAssetId: "",
      parentUrl: "",
      generatedFromUrl: "",
      aspectRatio: body.aspectRatio || "manual",
      editInstruction: "",
      generationPrompt: "手動アップロード",
      display: true,
      createdAt: now,
      sourceType: "manual_upload",
    };
  }
  if (!body.sourceLibraryUrl) {
    return {
      rootId: assetId,
      parentAssetId: "",
      parentUrl: "",
      generatedFromUrl: body.sourceUrl || "",
      aspectRatio: body.aspectRatio || "candidate",
      editInstruction: body.editInstruction || "",
      generationPrompt: body.generationPrompt || body.variant?.prompt || "",
      display: true,
      createdAt: now,
    };
  }

  const parent = resolveSavedFileFromUrl(body.sourceLibraryUrl);
  const parentMeta = await readSidecar(parent.target);
  const parentAssetId = typeof parentMeta.assetId === "string" && parentMeta.assetId ? parentMeta.assetId : parent.name.replace(/\.(png|jpe?g|webp)$/i, "");
  const rootId = typeof parentMeta.lineage?.rootId === "string" && parentMeta.lineage.rootId ? parentMeta.lineage.rootId : parentAssetId;
  return {
    rootId,
    parentAssetId,
    parentUrl: body.sourceLibraryUrl,
    generatedFromUrl: body.sourceUrl || "",
    aspectRatio: body.aspectRatio || "final",
    editInstruction: body.editInstruction || "",
    generationPrompt: body.generationPrompt || body.variant?.prompt || "",
    display: true,
    createdAt: now,
  };
}

async function readSavedNode(relativePath = ""): Promise<SavedNode> {
  const { normalized, target } = resolveSavedFolder(relativePath);
  await mkdir(target, { recursive: true });
  const entries = await readdir(target, { withFileTypes: true });
  const folderOrder = await readFolderOrder(normalized);
  const children: SavedNode[] = [];
  const fileVersions: SavedFile[] = [];

  for (const entry of entries) {
    const childRelative = normalized ? `${normalized}/${entry.name}` : entry.name;
    const childPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      children.push(await readSavedNode(childRelative));
    } else if (entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name)) {
      const imageUrl = `/saved-banners/${childRelative}`;
      const meta = await readSidecar(childPath);
      fileVersions.push(savedFileFromMeta(entry.name, childPath, imageUrl, meta));
    }
  }

  const groups = new Map<string, SavedFile[]>();
  for (const file of fileVersions) {
    const key = file.rootId || file.assetId || file.name;
    groups.set(key, [...(groups.get(key) || []), file]);
  }
  const files = Array.from(groups.values()).map((group) => {
    const versions = sortVersions(group);
    const display = sortVersions(versions.filter((file) => file.isDisplay))[0] || versions[0];
    return {
      ...display,
      versionCount: versions.length,
      versions,
    };
  });

  return {
    name: normalized ? path.basename(normalized) : "saved-banners",
    path: normalized,
    children: sortFolders(children, folderOrder),
    files: files.sort((a, b) => b.name.localeCompare(a.name, "ja")),
  };
}

export async function GET() {
  const tree = await readSavedNode();
  return NextResponse.json({ tree, rootPath: savedRoot });
}

async function handleManualUpload(request: Request) {
  const form = await request.formData();
  const files = form.getAll("images").filter((item): item is File => item instanceof File && item.type.startsWith("image/"));
  if (!files.length) return NextResponse.json({ message: "追加する画像がありません" }, { status: 400 });
  const folder = String(form.get("folder") || "");
  const { normalized: targetFolder, target: targetDir } = resolveSavedFolder(folder);
  await mkdir(targetDir, { recursive: true });
  const saved: SavedBanner[] = [];
  for (const [index, file] of files.entries()) {
    const ext = path.extname(file.name || "") || (file.type === "image/webp" ? ".webp" : file.type === "image/jpeg" ? ".jpg" : ".png");
    const originalName = safeSegment(path.basename(file.name || `manual-${index + 1}`, ext));
    const fileName = `manual-${originalName}-${makeId("img").replace("img-", "")}${ext.toLowerCase()}`;
    const targetPath = path.join(targetDir, fileName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(targetPath, buffer);
    const assetId = makeId("asset");
    const body: Body = {
      action: "manualUpload",
      stage: "manual",
      folder: targetFolder,
      sourceUrl: "",
      aspectRatio: "manual",
      variant: {
        index: index + 1,
        appeal: "手動アップロード",
        prompt: `手動でライブラリに追加。元ファイル名: ${file.name || "unknown"}`,
        priceTreatment: "without_price",
      },
    };
    const lineage = await buildLineage(body, assetId);
    const propertyPath = sidecarPathForImage(targetPath);
    await writeFile(propertyPath, JSON.stringify({
      ...publicSafeMetadata(body, fileName, targetFolder, assetId, lineage),
      originalFileName: file.name || "",
      mimeType: file.type || "",
      manualUpload: true,
    }, null, 2), "utf8");
    const url = `/saved-banners/${targetFolder ? `${targetFolder}/` : ""}${fileName}`;
    saved.push({
      url,
      filePath: targetPath,
      propertyUrl: sidecarUrlForImage(url),
      propertyPath,
      folderPath: targetDir,
      folder: targetFolder,
    });
  }
  const tree = await readSavedNode();
  return NextResponse.json({ saved, tree, rootPath: savedRoot, folder: targetFolder });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) return handleManualUpload(request);
  const body = (await request.json()) as Body;
  if (body.action === "createFolder") {
    const parent = normalizeFolder(body.folder || "");
    const name = safeSegment(String(body.name || ""));
    if (!name) return NextResponse.json({ message: "フォルダ名を入力してください" }, { status: 400 });
    const { target, normalized } = resolveSavedFolder(parent ? `${parent}/${name}` : name);
    await mkdir(target, { recursive: true });
    const tree = await readSavedNode();
    return NextResponse.json({ folder: normalized, folderPath: target, tree, rootPath: savedRoot });
  }

  if (body.action === "deleteFolder") {
    const folder = normalizeFolder(body.folder || "");
    if (!folder) return NextResponse.json({ message: "ルートフォルダは削除できません" }, { status: 400 });
    const { target } = resolveSavedFolder(folder);
    // Count files inside
    async function countFilesRecursive(dir: string): Promise<number> {
      let count = 0;
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name)) count++;
          else if (entry.isDirectory()) count += await countFilesRecursive(path.join(dir, entry.name));
        }
      } catch { /* empty */ }
      return count;
    }
    const fileCount = await countFilesRecursive(target);
    if (fileCount > 0 && !body.confirm) {
      return NextResponse.json({ needsConfirm: true, fileCount, folder });
    }
    await rm(target, { recursive: true, force: true });
    const tree = await readSavedNode();
    return NextResponse.json({ deleted: true, folder, tree, rootPath: savedRoot });
  }

  if (body.action === "reorderFolder") {
    try {
      const sourceFolder = normalizeFolder(body.sourceFolder || body.folder || "");
      const beforeFolder = normalizeFolder(body.beforeFolder || "");
      if (!sourceFolder) return NextResponse.json({ message: "移動するフォルダが不正です" }, { status: 400 });
      const parent = parentFolderOf(sourceFolder);
      if (beforeFolder && parentFolderOf(beforeFolder) !== parent) {
        return NextResponse.json({ message: "同じ階層内で並び替えてください" }, { status: 400 });
      }
      const sourceName = basenameFolder(sourceFolder);
      const beforeName = beforeFolder ? basenameFolder(beforeFolder) : "";
      const { target: parentDir } = resolveSavedFolder(parent);
      const entries = await readdir(parentDir, { withFileTypes: true });
      const folderNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
      const currentOrder = await readFolderOrder(parent);
      const ordered = [
        ...currentOrder.filter((name) => folderNames.includes(name)),
        ...folderNames.filter((name) => !currentOrder.includes(name)).sort((a, b) => a.localeCompare(b, "ja")),
      ].filter((name) => name !== sourceName);
      const insertAt = beforeName ? Math.max(0, ordered.indexOf(beforeName)) : ordered.length;
      ordered.splice(insertAt === -1 ? ordered.length : insertAt, 0, sourceName);
      await writeFolderOrder(parent, ordered);
      const tree = await readSavedNode();
      return NextResponse.json({ reordered: true, folder: sourceFolder, parent, order: ordered, tree, rootPath: savedRoot });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ message }, { status: 400 });
    }
  }

  if (body.action === "moveFolder") {
    try {
      const sourceFolder = normalizeFolder(body.sourceFolder || body.folder || "");
      const targetParent = normalizeFolder(body.targetFolder || "");
      const beforeFolder = normalizeFolder(body.beforeFolder || "");
      if (!sourceFolder) return NextResponse.json({ message: "移動するフォルダが不正です" }, { status: 400 });
      if (isSameOrDescendant(targetParent, sourceFolder)) {
        return NextResponse.json({ message: "自分自身または配下には移動できません" }, { status: 400 });
      }
      if (beforeFolder && parentFolderOf(beforeFolder) !== targetParent) {
        return NextResponse.json({ message: "移動先の階層が不正です" }, { status: 400 });
      }

      const sourceName = basenameFolder(sourceFolder);
      const sourceParent = parentFolderOf(sourceFolder);
      const { target: sourcePath } = resolveSavedFolder(sourceFolder);
      const { target: targetDir } = resolveSavedFolder(targetParent);
      await mkdir(targetDir, { recursive: true });
      const targetPath = path.join(targetDir, sourceName);
      if (sourcePath === targetPath) {
        const tree = await readSavedNode();
        return NextResponse.json({ moved: false, folder: sourceFolder, tree, rootPath: savedRoot });
      }
      try {
        await readdir(targetPath);
        return NextResponse.json({ message: "同名フォルダが移動先にあります" }, { status: 400 });
      } catch {
        // Missing target is expected.
      }
      await rename(sourcePath, targetPath);

      const oldOrder = (await readFolderOrder(sourceParent)).filter((name) => name !== sourceName);
      await writeFolderOrder(sourceParent, oldOrder);
      const targetEntries = await readdir(targetDir, { withFileTypes: true });
      const targetFolderNames = targetEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
      const currentTargetOrder = await readFolderOrder(targetParent);
      const ordered = [
        ...currentTargetOrder.filter((name) => targetFolderNames.includes(name) && name !== sourceName),
        ...targetFolderNames.filter((name) => !currentTargetOrder.includes(name) && name !== sourceName).sort((a, b) => a.localeCompare(b, "ja")),
      ];
      const beforeName = beforeFolder ? basenameFolder(beforeFolder) : "";
      const insertAt = beforeName ? ordered.indexOf(beforeName) : ordered.length;
      ordered.splice(insertAt >= 0 ? insertAt : ordered.length, 0, sourceName);
      await writeFolderOrder(targetParent, ordered);
      const movedFolder = targetParent ? `${targetParent}/${sourceName}` : sourceName;
      const tree = await readSavedNode();
      return NextResponse.json({ moved: true, folder: movedFolder, tree, rootPath: savedRoot });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ message }, { status: 400 });
    }
  }

  if (body.action === "moveFile") {
    try {
      const source = resolveSavedFileFromUrl(String(body.sourceUrl || ""));
      const { normalized: targetFolder, target: targetDir } = resolveSavedFolder(body.targetFolder || body.folder || "");
      await mkdir(targetDir, { recursive: true });
      const targetPath = path.join(targetDir, source.name);
      await rename(source.target, targetPath);
      try {
        await rename(sidecarPathForImage(source.target), sidecarPathForImage(targetPath));
        await writeSidecar(targetPath, { folder: targetFolder });
      } catch {
        // Older saved images may not have a sidecar property file.
      }
      const tree = await readSavedNode();
      return NextResponse.json({
        url: `/saved-banners/${targetFolder ? `${targetFolder}/` : ""}${source.name}`,
        filePath: targetPath,
        propertyUrl: sidecarUrlForImage(`/saved-banners/${targetFolder ? `${targetFolder}/` : ""}${source.name}`),
        propertyPath: sidecarPathForImage(targetPath),
        folderPath: targetDir,
        folder: targetFolder,
        tree,
        rootPath: savedRoot,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ message }, { status: 400 });
    }
  }

  if (body.action === "deleteFile") {
    try {
      const file = resolveSavedFileFromUrl(String(body.fileUrl || body.sourceUrl || ""));
      await rm(file.target, { force: true });
      await rm(sidecarPathForImage(file.target), { force: true });
      const tree = await readSavedNode();
      return NextResponse.json({ deleted: true, fileUrl: body.fileUrl || body.sourceUrl, tree, rootPath: savedRoot });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ message }, { status: 400 });
    }
  }

  if (body.action === "updateMeta") {
    try {
      const file = resolveSavedFileFromUrl(String(body.fileUrl || body.sourceUrl || ""));
      const patch: Record<string, any> = {};
      if (body.displayName !== undefined) patch.displayName = String(body.displayName || "").trim().slice(0, 120) || file.name.replace(/\.(png|jpe?g|webp)$/i, "");
      if (body.rating !== undefined) patch.rating = Math.min(5, Math.max(0, Number(body.rating) || 0));
      await writeSidecar(file.target, patch);
      const tree = await readSavedNode();
      return NextResponse.json({ updated: true, tree, rootPath: savedRoot });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ message }, { status: 400 });
    }
  }

  if (body.action === "setDisplayVersion") {
    try {
      const file = resolveSavedFileFromUrl(String(body.fileUrl || body.sourceUrl || ""));
      const targetMeta = await readSidecar(file.target);
      const targetAssetId = typeof targetMeta.assetId === "string" && targetMeta.assetId ? targetMeta.assetId : file.name.replace(/\.(png|jpe?g|webp)$/i, "");
      const rootId = typeof targetMeta.lineage?.rootId === "string" && targetMeta.lineage.rootId ? targetMeta.lineage.rootId : targetAssetId;
      const imagePaths = await collectSavedImagePaths();
      for (const imagePath of imagePaths) {
        const meta = await readSidecar(imagePath);
        const assetId = typeof meta.assetId === "string" && meta.assetId ? meta.assetId : path.basename(imagePath).replace(/\.(png|jpe?g|webp)$/i, "");
        const currentRootId = typeof meta.lineage?.rootId === "string" && meta.lineage.rootId ? meta.lineage.rootId : assetId;
        if (currentRootId !== rootId) continue;
        await writeSidecar(imagePath, {
          lineage: {
            ...(meta.lineage || {}),
            rootId,
            display: imagePath === file.target,
          },
        });
      }
      const tree = await readSavedNode();
      return NextResponse.json({ updated: true, fileUrl: body.fileUrl || body.sourceUrl, tree, rootPath: savedRoot });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ message }, { status: 400 });
    }
  }

  const sourceUrl = String(body.sourceUrl || "");
  if (!sourceUrl.startsWith("/generated/")) {
    return NextResponse.json({ message: "保存できる生成画像が見つかりません" }, { status: 400 });
  }

  const sourceName = decodeURIComponent(sourceUrl.replace("/generated/", ""));
  const sourcePath = path.resolve(generatedDir, sourceName);
  if (!sourcePath.startsWith(path.resolve(generatedDir) + path.sep)) {
    return NextResponse.json({ message: "画像パスが不正です" }, { status: 400 });
  }

  const defaultFolder = `${safeSegment(`${body.input?.brandName || "brand"}-${body.input?.productName || "product"}`)}/${dateSegment()}`;
  const { normalized: targetFolder, target: targetDir } = resolveSavedFolder(body.folder || defaultFolder);
  await mkdir(targetDir, { recursive: true });

  const duplicate = await findDuplicateInFolder(targetDir, sourceUrl);
  if (duplicate) {
    const tree = await readSavedNode();
    const url = `/saved-banners/${targetFolder ? `${targetFolder}/` : ""}${duplicate.fileName}`;
    return NextResponse.json({
      duplicated: true,
      url,
      filePath: duplicate.imagePath,
      propertyUrl: sidecarUrlForImage(url),
      propertyPath: sidecarPathForImage(duplicate.imagePath),
      folderPath: targetDir,
      folder: targetFolder,
      tree,
    });
  }

  const ext = path.extname(sourceName) || ".png";
  const index = body.variant?.globalIndex || body.variant?.index || 0;
  const price = body.variant?.priceTreatment === "with_price" ? "price" : "no-price";
  const ratio = safeSegment(body.aspectRatio || "candidate");
  const fileName = `${body.stage || "banner"}-${ratio}-${price}-${index || "x"}-${makeId("img").replace("img-", "")}${ext}`;
  const targetPath = path.join(targetDir, fileName);
  await copyFile(sourcePath, targetPath);
  const propertyPath = sidecarPathForImage(targetPath);
  const assetId = makeId("asset");
  const lineage = await buildLineage(body, assetId);
  await writeFile(propertyPath, JSON.stringify(publicSafeMetadata(body, fileName, targetFolder, assetId, lineage), null, 2), "utf8");
  const tree = await readSavedNode();
  const url = `/saved-banners/${targetFolder ? `${targetFolder}/` : ""}${fileName}`;

  return NextResponse.json({
    url,
    filePath: targetPath,
    propertyUrl: sidecarUrlForImage(url),
    propertyPath,
    folderPath: targetDir,
    folder: targetFolder,
    tree,
  });
}
