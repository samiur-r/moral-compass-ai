import { NextRequest, NextResponse } from "next/server";
import { buildMoralCompassPdf } from "@/lib/generatePdf";
import { savePdf } from "@/lib/pdfStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const bytes = await buildMoralCompassPdf(body);
    const id = savePdf(bytes);
    return NextResponse.json({ downloadUrl: `/api/log-pdf/${id}`, id });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "PDF generation failed" },
      { status: 500 }
    );
  }
}
