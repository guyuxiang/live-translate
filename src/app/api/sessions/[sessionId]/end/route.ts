import { NextRequest, NextResponse } from "next/server";
import TranslationSessionManager from "@/lib/translation-session-manager";
import { getSQLiteStore } from "@/lib/sqlite-store";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const manager = TranslationSessionManager.getInstance();
  await manager.removeAllTranslations(sessionId);
  // Also end the session in SQLite even if no active translations remain
  getSQLiteStore().endSession(sessionId);
  return NextResponse.json({ status: "ended", sessionId });
}
