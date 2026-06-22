import { NextRequest, NextResponse } from "next/server";
import { getSQLiteStore } from "@/lib/sqlite-store";

interface TranscriptEntryBody {
  id?: unknown;
  text?: unknown;
  language?: unknown;
  final?: unknown;
  timestamp?: unknown;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const language = req.nextUrl.searchParams.get("language") || undefined;
  const limitParam = Number(req.nextUrl.searchParams.get("limit") || "500");
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 1000) : 500;

  const entries = getSQLiteStore().getTranscriptEntries(sessionId, language, limit);
  return NextResponse.json({ entries });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const body = (await req.json().catch(() => null)) as TranscriptEntryBody | null;

  if (!body || typeof body.id !== "string" || typeof body.text !== "string" || typeof body.language !== "string") {
    return NextResponse.json({ error: "Invalid transcript entry" }, { status: 400 });
  }

  getSQLiteStore().appendTranscriptEntry(sessionId, {
    id: body.id,
    text: body.text,
    language: body.language,
    final: Boolean(body.final),
    timestamp: typeof body.timestamp === "number" ? body.timestamp : Date.now(),
  });

  return NextResponse.json({ success: true });
}
