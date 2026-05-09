import { NextResponse } from "next/server";
import { makeId, readBrands, readProducts, replaceProductBrand, saveBrands, type BrandMaster } from "@/app/lib/files";

export async function GET() {
  const brands = await readBrands();
  return NextResponse.json({ brands });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { name?: string };
  const name = String(body.name || "").trim();
  if (!name) return NextResponse.json({ message: "ブランド名を入力してください" }, { status: 400 });

  const brands = await readBrands();
  if (brands.some((brand) => brand.name.toLowerCase() === name.toLowerCase())) {
    return NextResponse.json({ message: "同じブランド名がすでにあります" }, { status: 409 });
  }

  const next = await saveBrands([{ id: makeId("brand"), name, createdAt: new Date().toISOString() }, ...brands]);
  return NextResponse.json({ brands: next });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as { id?: string; name?: string };
  const id = String(body.id || "").trim();
  const name = String(body.name || "").trim();
  if (!id || !name) return NextResponse.json({ message: "ブランド名を入力してください" }, { status: 400 });

  const brands = await readBrands();
  const current = brands.find((brand) => brand.id === id);
  if (!current) return NextResponse.json({ message: "ブランドが見つかりません" }, { status: 404 });
  if (brands.some((brand) => brand.id !== id && brand.name.toLowerCase() === name.toLowerCase())) {
    return NextResponse.json({ message: "同じブランド名がすでにあります" }, { status: 409 });
  }

  const products = await readProducts();
  const affectedProducts = products.filter((product) => product.brandName === current.name).length;
  const nextBrands: BrandMaster[] = brands.map((brand) => brand.id === id ? { ...brand, name } : brand);
  const next = await saveBrands(nextBrands);
  if (affectedProducts) await replaceProductBrand(current.name, name);

  return NextResponse.json({
    brands: next,
    affectedProducts,
  });
}

export async function DELETE(request: Request) {
  const body = (await request.json()) as { id?: string };
  const id = String(body.id || "").trim();
  if (!id) return NextResponse.json({ message: "ブランドを選択してください" }, { status: 400 });

  const brands = await readBrands();
  const target = brands.find((brand) => brand.id === id);
  if (!target) return NextResponse.json({ message: "ブランドが見つかりません" }, { status: 404 });

  const products = await readProducts();
  const usedCount = products.filter((product) => product.brandName === target.name).length;
  if (usedCount > 0) {
    return NextResponse.json({ message: `このブランドを使っている商品が${usedCount}件あります` }, { status: 409 });
  }

  const next = await saveBrands(brands.filter((brand) => brand.id !== id));
  return NextResponse.json({ brands: next });
}
