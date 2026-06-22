import { NextRequest, NextResponse } from "next/server";
import { getSQLiteStore } from "@/lib/sqlite-store";
import TranslationSessionManager from "@/lib/translation-session-manager";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  getSQLiteStore().archiveSession(sessionId);
  // Also invalidate in-memory cache so broadcast page sees the archived status
  TranslationSessionManager.getInstance().invalidateSession(sessionId);
  return NextResponse.json({ status: "archived", sessionId });
}
