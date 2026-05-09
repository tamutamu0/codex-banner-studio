import { NextResponse } from "next/server";
import { readHistory } from "@/app/lib/files";

export async function GET() {
  const history = await readHistory();
  return NextResponse.json({ history });
}
