import { NextRequest, NextResponse } from "next/server";
import { getSQLiteStore } from "@/lib/sqlite-store";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  getSQLiteStore().archiveSession(sessionId);
  return NextResponse.json({ status: "archived", sessionId });
}
