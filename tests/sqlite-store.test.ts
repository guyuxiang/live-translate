import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SQLiteStore } from "../src/lib/sqlite-store.ts";

test("persists sessions and transcripts across store instances", () => {
  const dir = mkdtempSync(join(tmpdir(), "live-translate-store-"));
  const dbPath = join(dir, "test.sqlite");

  try {
    const first = new SQLiteStore(dbPath);
    first.saveSession({
      sessionId: "session-1",
      organizerIdentity: "organizer-host",
      name: "Board Meeting",
      createdAt: new Date("2026-06-22T08:00:00.000Z"),
    });
    first.appendTranscriptEntry("session-1", {
      id: "zh-CN-0",
      language: "zh-CN",
      text: "你好",
      final: false,
      timestamp: 1_790_000_000_000,
    });
    first.appendTranscriptEntry("session-1", {
      id: "zh-CN-0",
      language: "zh-CN",
      text: "，欢迎",
      final: true,
      timestamp: 1_790_000_001_000,
    });
    first.close();

    const second = new SQLiteStore(dbPath);
    assert.deepEqual(second.getSession("session-1"), {
      sessionId: "session-1",
      organizerIdentity: "organizer-host",
      name: "Board Meeting",
      createdAt: new Date("2026-06-22T08:00:00.000Z"),
      endedAt: null,
      languageCount: 0,
      tokenCount: 0,
      inputTokenCount: 0,
      outputTokenCount: 0,
      costUsd: 0,
      status: "active",
      durationSeconds: 0,
      listenerPeakCount: 0,
      lastActivityAt: new Date("2026-06-22T08:00:00.000Z"),
    });
    assert.deepEqual(second.getTranscriptEntries("session-1", "zh-CN"), [
      {
        id: "zh-CN-0",
        language: "zh-CN",
        text: "你好，欢迎",
        final: true,
        timestamp: 1_790_000_001_000,
      },
    ]);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
