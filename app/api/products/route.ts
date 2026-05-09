import path from "node:path";
import { NextResponse } from "next/server";
import { makeId, masterImagesDir, readProducts, saveProduct, writeMasterImage, type ProductImage, type ProductMaster } from "@/app/lib/files";

export async function GET() {
  const products = await readProducts();
  return NextResponse.json({ products });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const brandName = String(form.get("brandName") || "").trim();
  const name = String(form.get("name") || "").trim();
  const notes = String(form.get("notes") || "").trim();
  const priceInfo = String(form.get("priceInfo") || "").trim();
  const submittedId = String(form.get("id") || "").trim();
  const imageFiles = form.getAll("images");
  const descriptions = form.getAll("descriptions").map((item) => String(item || "").trim());
  const existingImagesRaw = String(form.get("existingImages") || "[]");

  if (!name) {
    return NextResponse.json({ message: "商品名を入力してください" }, { status: 400 });
  }

  let existingImages: ProductImage[] = [];
  try {
    const parsed = JSON.parse(existingImagesRaw) as ProductImage[];
    existingImages = Array.isArray(parsed)
      ? parsed
          .filter((image) => image?.id && image?.url && image?.path)
          .map((image, index) => ({
            id: image.id,
            url: image.url,
            path: image.path,
            description: String(image.description || "").trim() || `商品画像${index + 1}`,
          }))
      : [];
  } catch {
    return NextResponse.json({ message: "既存画像の形式が不正です" }, { status: 400 });
  }

  const files = imageFiles.filter((item): item is File => item instanceof File && item.size > 0);
  if (!existingImages.length && !files.length) {
    return NextResponse.json({ message: "商品画像を1枚以上選択してください" }, { status: 400 });
  }

  const products = await readProducts();
  const current = submittedId ? products.find((product) => product.id === submittedId) : undefined;
  const id = current?.id || submittedId || makeId("product");
  const images: ProductImage[] = [...existingImages];
  for (const [index, image] of files.entries()) {
    const ext = path.extname(image.name || "") || ".png";
    const imageIndex = existingImages.length + index + 1;
    const fileName = `${id}-${imageIndex}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}${ext}`;
    const buffer = Buffer.from(await image.arrayBuffer());
    const imageUrl = await writeMasterImage(fileName, buffer);
    images.push({
      id: `${id}-image-${imageIndex}-${Math.random().toString(36).slice(2, 6)}`,
      url: imageUrl,
      path: path.join(masterImagesDir, fileName),
      description: descriptions[index] || `商品画像${imageIndex}`,
    });
  }

  const product: ProductMaster = {
    id,
    brandName,
    name,
    notes,
    priceInfo,
    images,
    imageUrl: images[0]?.url,
    imagePath: images[0]?.path,
    createdAt: current?.createdAt || new Date().toISOString(),
  };

  const nextProducts = await saveProduct(product);
  return NextResponse.json({ product, products: nextProducts, url: images[0]?.url || "" });
}
