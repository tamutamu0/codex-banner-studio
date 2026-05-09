import { readFile } from "node:fs/promises";
import path from "node:path";
import { copyGenerated, generatedDir, makeId, publicUrl, writeGenerated } from "./files";
import { runCodexTurnDetailed } from "./codex-app-server";

function decodeImageResult(result: string) {
  const cleaned = result.startsWith("data:") ? result.slice(result.indexOf(",") + 1) : result;
  return Buffer.from(cleaned, "base64");
}

type SavedCodexImage = {
  imageUrl: string;
  imagePath: string;
  revisedPrompt: string;
  publicPath: string;
};

async function saveCodexImage(image: { result?: string; savedPath?: string; revisedPrompt?: string | null }, prefix: string) {
  const id = makeId(prefix);
  let imageUrl = "";
  let imagePath = "";

  if (image.savedPath) {
    imageUrl = await copyGenerated(image.savedPath, `${id}.png`);
    imagePath = path.join(generatedDir, `${id}.png`);
  } else if (image.result) {
    const buffer = decodeImageResult(image.result);
    imageUrl = await writeGenerated(`${id}.png`, buffer);
    imagePath = path.join(generatedDir, `${id}.png`);
  }

  await readFile(imagePath);

  return {
    imageUrl,
    imagePath,
    revisedPrompt: image.revisedPrompt || "",
    publicPath: publicUrl(`${id}.png`),
  };
}

type CodexServiceTier = "fast" | "auto" | "flex";

function normalizeServiceTier(serviceTier?: CodexServiceTier) {
  return serviceTier === "fast" ? "fast" : "auto";
}

export async function generateImagesWithCodex(prompt: string, options: { images?: string[]; prefix?: string; timeoutMs?: number; cancelKey?: string; model?: string; effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh"; serviceTier?: CodexServiceTier } = {}) {
  const turn = await runCodexTurnDetailed({
    prompt,
    images: options.images,
    timeoutMs: options.timeoutMs || 300_000,
    cancelKey: options.cancelKey,
    logLabel: options.prefix ? `image-${options.prefix}` : "image-generation",
    model: options.model || "gpt-5.5",
    effort: options.effort || "medium",
    serviceTier: normalizeServiceTier(options.serviceTier || "fast"),
  });
  const images = turn.images.filter((item) => item.result || item.savedPath);

  if (!images.length) {
    throw new Error(`Codex completed but did not return an image. Events: ${[...new Set(turn.events)].join(", ")}. Final: ${turn.finalText}`);
  }

  const savedImages: SavedCodexImage[] = [];
  for (const image of images) {
    savedImages.push(await saveCodexImage(image, options.prefix || "codex-image"));
  }

  return {
    images: savedImages,
    finalText: turn.finalText,
    events: [...new Set(turn.events)],
    jobId: turn.jobId,
    durationMs: turn.durationMs,
  };
}

export async function generateImageWithCodex(prompt: string, options: { images?: string[]; prefix?: string; timeoutMs?: number; cancelKey?: string; model?: string; effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh"; serviceTier?: CodexServiceTier } = {}) {
  const result = await generateImagesWithCodex(prompt, options);
  const image = result.images[0];

  return {
    imageUrl: image.imageUrl,
    imagePath: image.imagePath,
    revisedPrompt: image.revisedPrompt,
    finalText: result.finalText,
    events: result.events,
    jobId: result.jobId,
    durationMs: result.durationMs,
    publicPath: image.publicPath,
  };
}
